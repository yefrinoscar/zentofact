// Emisión automática de boletas Falabella.
// Flujo: webhook (o cron) -> cola en Postgres -> worker emite INDIVIDUAL -> sube a Falabella.
// Toda la lógica vive aquí (server); reusa @zentofact/core y el cliente Falabella. No toca el core.
import { Pool } from 'pg';
import {
  getCompany,
  listCompanies,
  processWorkflow,
  falabellaBuildBoletaVenta,
  falabellaResolveDocument,
  falabellaUploadBoletaPdf,
} from '@zentofact/core';
import { FalabellaApiClient } from '@zentofact/falabella-api';

const pool = new Pool({ connectionString: process.env.DATABASE_URL_POSTGRES });

// Estados de Falabella que habilitan la boleta (idéntico al Gestor de Sellers).
const READY_STATUSES = ['ready_to_ship', 'shipped', 'delivered'];
// El motor corre por defecto; solo se apaga si AUTO_EMIT_ENABLED=false (kill-switch de deploy).
// El control fino vive en la BD (pausar cola, cron on/off, simular/emitir).
const AUTO_ENABLED = process.env.AUTO_EMIT_ENABLED !== 'false';
const DRY_RUN = process.env.AUTO_EMIT_DRY_RUN === 'true';
const RECONCILE_ENABLED = process.env.AUTO_EMIT_RECONCILE !== 'false'; // red de seguridad; on por defecto

const log = (...a) => console.log('[auto-emit]', ...a);
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '_');
const today = () => new Date().toISOString().slice(0, 10);
const dateOnly = (value) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? today() : d.toISOString().slice(0, 10);
};

// Extrae identificadores de la orden del payload del webhook (defensivo: nombres variables).
function extractOrder(payload) {
  const p = payload || {};
  const body = p.data || p.payload || p.order || p.Order || p;
  const orderNumber = String(body.OrderNumber || body.orderNumber || body.order_number || p.orderNumber || '').trim();
  const orderId = String(body.OrderId || body.orderId || body.order_id || p.orderId || '').trim();
  return { orderNumber: orderNumber || orderId, orderId, raw: p };
}

// Estado de la orden. Falabella V2 devuelve Statuses: [{ Status: "shipped" }, ...].
function statusOfOrder(order) {
  const s = order?.Statuses?.Status ?? order?.Statuses ?? order?.status;
  const pick = (x) => (typeof x === 'object' && x ? (x.Status || x.Name || x.name || '') : x);
  if (Array.isArray(s)) return s.map(pick).join('|');
  if (s && typeof s === 'object') return String(pick(s) || '');
  return String(s || '');
}

// InvoiceRequired llega como boolean, número o string ("true"/"false"/"1"/"0").
function invoiceRequired(order) {
  const v = order?.InvoiceRequired;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1;
  if (typeof v === 'string') return v.toLowerCase() === 'true' || v === '1';
  return false;
}

function buildConfig(company) {
  return {
    companyId: company.id,
    ruc: company.ruc,
    razonSocial: company.razonSocial,
    direccion: company.direccion || '',
    ubigeo: company.ubigeo || '',
    usuarioSol: company.usuarioSol || '',
    claveSol: company.claveSol || '',
    certificadoBase64: company.certificado || '',
    certificadoPassword: company.certificadoPassword || '',
    modoProduccion: true, // el automático SIEMPRE es producción real
    serieBoleta: 'B001',
    outputDir: process.env.STORAGE_PATH || 'storage',
  };
}

// ── Esquema (idempotente, para deploys nuevos) ──
export async function ensureTables() {
  await pool.query(`
    create table if not exists webhook_events (
      id bigserial primary key,
      company_id integer,
      order_number text,
      event text,
      raw jsonb,
      processed boolean default false,
      received_at timestamptz not null default now()
    );
    create table if not exists emission_jobs (
      id bigserial primary key,
      company_id integer not null,
      order_number text not null,
      order_id text,
      status text not null default 'pending',
      attempts integer not null default 0,
      last_error text,
      result text,
      boleta_numero text,
      source text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (company_id, order_number)
    );
    alter table emission_jobs add column if not exists order_id text;
    create table if not exists auto_emission_config (
      company_id integer primary key,
      enabled boolean not null default false,
      updated_at timestamptz not null default now()
    );
    create table if not exists auto_emission_state (
      id integer primary key default 1,
      paused boolean not null default false,
      cron_enabled boolean not null default true,
      cron_interval_minutes integer not null default 60,
      cron_window_days integer not null default 3,
      updated_at timestamptz not null default now()
    );
    alter table auto_emission_state add column if not exists cron_enabled boolean not null default true;
    alter table auto_emission_state add column if not exists cron_interval_minutes integer not null default 60;
    alter table auto_emission_state add column if not exists cron_window_days integer not null default 3;
    alter table auto_emission_state add column if not exists dry_run boolean not null default true;
  `);
  // Semilla por ambiente: al crear el estado por primera vez, usa la env AUTO_EMIT_DRY_RUN de ESE ambiente.
  await pool.query(
    `insert into auto_emission_state (id, paused, dry_run) values (1, false, $1) on conflict (id) do nothing`,
    [DRY_RUN],
  );
}

// ── Modo del automático: simular vs emitir (runtime, por ambiente vía su propia BD) ──
export async function getDryRun() {
  const r = await pool.query('select dry_run from auto_emission_state where id=1');
  return r.rows[0]?.dry_run !== false;
}
export async function setDryRun(dryRun) {
  await pool.query(
    `insert into auto_emission_state (id, dry_run, updated_at) values (1, $1, now())
     on conflict (id) do update set dry_run=excluded.dry_run, updated_at=now()`,
    [!!dryRun],
  );
  log(dryRun ? 'MODO SIMULACIÓN (no emite)' : 'MODO EMISIÓN (emite de verdad)');
  return { dryRun: !!dryRun };
}

// ── Config del cron (red de seguridad): encender/apagar + frecuencia + ventana ──
export async function getCron() {
  const r = await pool.query('select cron_enabled, cron_interval_minutes, cron_window_days from auto_emission_state where id=1');
  const row = r.rows[0] || {};
  return {
    enabled: row.cron_enabled !== false,
    intervalMinutes: Number(row.cron_interval_minutes) || 60,
    windowDays: Number(row.cron_window_days) || 3,
  };
}
export async function setCron({ enabled, intervalMinutes, windowDays }) {
  const cur = await getCron();
  const next = {
    enabled: enabled === undefined ? cur.enabled : !!enabled,
    intervalMinutes: intervalMinutes === undefined ? cur.intervalMinutes : Math.max(5, Math.min(1440, Number(intervalMinutes) || cur.intervalMinutes)),
    windowDays: windowDays === undefined ? cur.windowDays : Math.max(1, Math.min(60, Number(windowDays) || cur.windowDays)),
  };
  await pool.query(
    `update auto_emission_state set cron_enabled=$1, cron_interval_minutes=$2, cron_window_days=$3, updated_at=now() where id=1`,
    [next.enabled, next.intervalMinutes, next.windowDays],
  );
  log(`cron: ${next.enabled ? 'ON' : 'OFF'} cada ${next.intervalMinutes}min, ventana ${next.windowDays}d`);
  return next;
}

// ── Pausa global de la cola (runtime, sin reiniciar) ──
export async function getPaused() {
  const r = await pool.query('select paused from auto_emission_state where id=1');
  return r.rows[0]?.paused === true;
}
export async function setPaused(paused) {
  await pool.query(
    `insert into auto_emission_state (id, paused, updated_at) values (1, $1, now())
     on conflict (id) do update set paused=excluded.paused, updated_at=now()`,
    [!!paused],
  );
  log(paused ? 'cola PAUSADA' : 'cola REANUDADA');
  return { paused: !!paused };
}

// Reintentar un job (fallido/omitido) → vuelve a pending, reinicia intentos.
export async function retryJob(id) {
  const r = await pool.query(
    `update emission_jobs set status='pending', attempts=0, last_error=null, updated_at=now()
     where id=$1 returning id, company_id, order_number, status`, [id]);
  return r.rows[0] || null;
}

// ── Config por empresa (qué empresas emiten automáticamente) ──
export async function getConfig() {
  const companies = await listCompanies();
  const rows = (await pool.query('select company_id, enabled from auto_emission_config')).rows;
  const map = new Map(rows.map((r) => [r.company_id, r.enabled]));
  const paused = await getPaused();
  const cron = await getCron();
  const dryRun = await getDryRun();
  // A qué SUNAT emite realmente (lo decide el ambiente): local=beta, Railway=producción.
  const forced = (process.env.SUNAT_FORCE_ENV || '').trim().toLowerCase();
  const sunatEnv = forced.startsWith('prod') ? 'produccion' : forced === 'beta' ? 'beta' : 'segun-empresa';
  // Conteo por estado (resumen del panel).
  const stats = Object.fromEntries((await pool.query(
    'select status, count(*)::int as n from emission_jobs group by status')).rows.map((r) => [r.status, r.n]));
  return {
    globalEnabled: AUTO_ENABLED,
    dryRun,
    sunatEnv,
    reconcileEnabled: RECONCILE_ENABLED,
    paused,
    cron,
    stats,
    companies: companies.map((c) => ({
      id: c.id,
      nombre: c.nombre,
      ruc: c.ruc,
      hasFalabella: !!(c.falabellaApiUserId?.trim() && c.falabellaApiKey?.trim()),
      enabled: map.get(c.id) ?? false,
    })),
  };
}

export async function setCompanyEnabled(companyId, enabled) {
  await pool.query(
    `insert into auto_emission_config (company_id, enabled, updated_at) values ($1,$2,now())
     on conflict (company_id) do update set enabled=excluded.enabled, updated_at=now()`,
    [companyId, !!enabled],
  );
  return { companyId, enabled: !!enabled };
}

async function isCompanyEnabled(companyId) {
  const r = await pool.query('select enabled from auto_emission_config where company_id=$1', [companyId]);
  return r.rows[0]?.enabled === true;
}

// Últimos jobs y eventos (para el panel).
export async function recentJobs(limit = 50) {
  const r = await pool.query(
    `select j.id, j.company_id, c.nombre as company, coalesce(nullif(b.order_number, ''), j.order_number) as order_number, j.order_id, j.status, j.source,
            j.attempts, j.result, j.last_error, j.boleta_numero, j.created_at, j.updated_at
     from emission_jobs j left join companies c on c.id=j.company_id
     left join lateral (
       select order_number from boletas
       where company_id=j.company_id and numero_completo=j.boleta_numero
       order by id desc limit 1
     ) b on true
     order by j.updated_at desc limit $1`, [Math.min(limit, 200)]);
  return r.rows;
}

export async function recentEvents(limit = 50) {
  const r = await pool.query(
    `select e.id, e.company_id, c.nombre as company, e.order_number, e.event, e.processed, e.received_at
     from webhook_events e left join companies c on c.id=e.company_id
     order by e.received_at desc limit $1`, [Math.min(limit, 200)]);
  return r.rows;
}

// GetOrder puntual por OrderId (1 llamada). Devuelve la orden cruda o null.
async function fetchOrderById(client, orderId) {
  if (!orderId) return null;
  const r = await client.call({ action: 'GetOrder', params: { OrderId: orderId } });
  const body = r?.data?.SuccessResponse?.Body?.Orders?.Order ?? r?.data?.SuccessResponse?.Body?.Order;
  const ord = Array.isArray(body) ? body[0] : body;
  return ord && typeof ord === 'object' ? ord : null;
}

async function saveResolvedOrderNumber(job, orderNumber) {
  const resolved = String(orderNumber || '').trim();
  if (!resolved || resolved === String(job.order_number || '').trim()) return;
  await pool.query(
    `update emission_jobs j
     set order_number=$2, updated_at=now()
     where j.id=$1
       and not exists (
         select 1 from emission_jobs other
         where other.company_id=j.company_id and other.order_number=$2 and other.id<>j.id
       )`,
    [job.id, resolved],
  ).catch((e) => log(`no se pudo actualizar OrderNumber real para job ${job.id}:`, e.message));
}

function previewOrder(order) {
  const statuses = order?.Statuses?.Status ?? order?.Statuses ?? order?.status;
  const statusText = Array.isArray(statuses)
    ? statuses.map((entry) => (typeof entry === 'object' && entry ? (entry.Status || entry.Name || '') : entry)).filter(Boolean).join(', ')
    : (typeof statuses === 'object' && statuses ? (statuses.Status || statuses.Name || JSON.stringify(statuses)) : String(statuses || ''));
  return {
    orderId: String(order?.OrderId || ''),
    orderNumber: String(order?.OrderNumber || ''),
    customer: [order?.CustomerFirstName, order?.CustomerLastName].map((part) => String(part || '').trim()).filter(Boolean).join(' '),
    status: statusText || '-',
    total: order?.GrandTotal ?? order?.Price ?? null,
    createdAt: order?.CreatedAt || '',
    updatedAt: order?.UpdatedAt || '',
    paymentMethod: order?.PaymentMethod || '',
    itemsCount: order?.ItemsCount ?? '',
    invoiceRequired: invoiceRequired(order),
  };
}

async function fetchOrderForJob(company, job) {
  const client = new FalabellaApiClient({ userId: company.falabellaApiUserId, apiKey: company.falabellaApiKey, version: '2.0', defaultFormat: 'JSON' });
  const byId = await fetchOrderById(client, job.order_id);
  if (byId) return byId;

  const dates = Array.from(new Set([dateOnly(job.created_at), dateOnly(job.updated_at), today()]));
  for (const date of dates) {
    const found = await client.findOrderByOrderNumber(job.order_number, date);
    if (found?.raw) return found.raw;
  }
  return null;
}

export async function jobOrderPreview(id) {
  const job = (await pool.query('select * from emission_jobs where id=$1', [id])).rows[0];
  if (!job) return { error: 'No se encontró la emisión.' };
  const company = await getCompany(job.company_id);
  if (!company || !company.falabellaApiUserId?.trim() || !company.falabellaApiKey?.trim()) return { error: 'Empresa sin credenciales Falabella.' };
  const order = await fetchOrderForJob(company, job);
  if (!order) return { error: 'No se encontró la orden en Falabella.' };
  const orderNumber = String(order.OrderNumber || job.order_number || '').trim();
  await saveResolvedOrderNumber(job, orderNumber);
  const document = orderNumber ? await falabellaResolveDocument({ companyId: job.company_id, orderNumber }).catch(() => null) : null;
  return {
    jobId: job.id,
    source: job.source,
    order: previewOrder(order),
    document: document ? {
      boleta: document.boleta ? {
        numeroCompleto: document.boleta.numeroCompleto,
        estadoSunat: document.boleta.estadoSunat,
        total: document.boleta.total,
      } : null,
      factura: document.factura ? {
        numeroCompleto: document.factura.numeroCompleto,
        estadoSunat: document.factura.estadoSunat || document.factura.estado,
        total: document.factura.total,
      } : null,
    } : null,
  };
}

// ── Cola ──
export async function enqueue(companyId, orderNumber, source = 'webhook', orderId = null) {
  if (!orderNumber) return;
  await pool.query(
    `insert into emission_jobs (company_id, order_number, order_id, status, source, created_at, updated_at)
     values ($1, $2, $3, 'pending', $4, now(), now())
     on conflict (company_id, order_number) do update
       set status = case when emission_jobs.status in ('failed','skipped') then 'pending' else emission_jobs.status end,
           order_id = coalesce(excluded.order_id, emission_jobs.order_id),
           updated_at = now()`,
    [companyId, orderNumber, orderId || null, source],
  );
}

// ── Webhook ──
export async function handleWebhook(companyId, payload) {
  const { orderNumber, orderId } = extractOrder(payload);
  await pool.query(
    `insert into webhook_events (company_id, order_number, event, raw) values ($1,$2,$3,$4)`,
    [companyId, orderNumber || null, 'onOrderItemsStatusChanged', JSON.stringify(payload || {})],
  ).catch(() => {});
  const enabled = await isCompanyEnabled(companyId);
  log(`webhook company=${companyId} orden=${orderNumber || '?'} orderId=${orderId || '?'} ${enabled ? '' : '(empresa NO activa, se ignora)'}`);
  if (!enabled) return { ok: true, orderNumber, orderId, ignored: 'empresa no activa para emisión automática' };
  // Clave de dedup: OrderNumber si lo trae; si no, el OrderId (el worker resuelve el número real vía GetOrder).
  const key = orderNumber || orderId;
  if (key) await enqueue(companyId, key, 'webhook', orderId);
  return { ok: true, orderNumber, orderId };
}

// ── Worker ──
async function processJob(job) {
  if (!(await isCompanyEnabled(job.company_id))) {
    return { status: 'skipped', result: 'empresa no activa para emisión automática' };
  }
  const company = await getCompany(job.company_id);
  if (!company || !company.falabellaApiUserId?.trim() || !company.falabellaApiKey?.trim()) {
    return { status: 'skipped', result: 'empresa sin credenciales Falabella' };
  }

  // 1) Traer la orden de Falabella (estado autoritativo).
  //    Si el webhook nos dio OrderId → GetOrder puntual (1 llamada). Si no, fallback: escaneo por fecha.
  const client = new FalabellaApiClient({ userId: company.falabellaApiUserId, apiKey: company.falabellaApiKey, version: '2.0', defaultFormat: 'JSON' });
  let order = await fetchOrderById(client, job.order_id);
  if (!order) {
    const found = await client.findOrderByOrderNumber(job.order_number, today());
    if (!found) return { retry: true, error: 'orden aún no visible en Falabella' };
    order = found.raw || found;
  }
  // El número real (por si encolamos con el OrderId como clave).
  const orderNumber = String(order.OrderNumber || job.order_number).trim();
  await saveResolvedOrderNumber(job, orderNumber);

  // 2) Condiciones (mismas que el Gestor de Sellers).
  if (invoiceRequired(order)) return { status: 'skipped', result: 'requiere factura, no boleta' };
  const status = norm(statusOfOrder(order));
  const ready = READY_STATUSES.some((s) => status.includes(s));
  if (!ready) return { status: 'skipped', result: `estado "${status}" aún no habilita boleta` };

  // 3) ¿ya tiene boleta?
  const doc = await falabellaResolveDocument({ companyId: job.company_id, orderNumber });
  if (doc?.boleta) return { status: 'done', result: `ya tenía boleta ${doc.boleta.numeroCompleto}`, boletaNumero: doc.boleta.numeroCompleto };

  if (await getDryRun()) return { status: 'skipped', result: 'Simulación: cumpliría condiciones, no se emitió' };

  // 4) Construir venta + emitir INDIVIDUAL (producción).
  const built = await falabellaBuildBoletaVenta({ companyId: job.company_id, order });
  if (built.error) throw new Error(`build-venta: ${built.error}`);
  const result = await processWorkflow(buildConfig(company), [built.venta]);
  const b = result?.boletas?.[0];
  if (!b || String(b.estadoSunat).toUpperCase() !== 'ACEPTADO') {
    throw new Error(b?.error || 'SUNAT no aceptó la boleta');
  }
  log(`orden ${orderNumber} -> boleta ${b.numeroCompleto} ACEPTADA`);

  // 5) Subir la boleta a Falabella (necesita Chromium para el PDF; ver nota de deploy).
  let uploadNote = '';
  try {
    const emitted = (await pool.query(
      `select id, numero_completo, fecha_emision from boletas where company_id=$1 and order_number=$2 and estado_sunat='ACEPTADO' order by id desc limit 1`,
      [job.company_id, orderNumber],
    )).rows[0];
    if (emitted) {
      const up = await falabellaUploadBoletaPdf({
        companyId: job.company_id,
        boletaId: emitted.id,
        orderNumber,
        orderId: order.OrderId,
        invoiceNumber: emitted.numero_completo,
        invoiceDate: emitted.fecha_emision,
      });
      uploadNote = up?.ok && !up?.error ? ' + subida a Falabella' : ` (subida falló: ${up?.error?.Head?.ErrorMessage || up?.error || up?.skipped || 'ver logs'})`;
      log(`orden ${orderNumber} subida a Falabella:`, uploadNote);
    }
  } catch (e) {
    uploadNote = ` (subida falló: ${e.message})`;
  }

  return { status: 'done', result: `boleta ${b.numeroCompleto} ACEPTADA${uploadNote}`, boletaNumero: b.numeroCompleto };
}

export async function processQueue(limit = 3) {
  if (await getPaused()) return 0; // cola pausada desde el panel
  const client = await pool.connect();
  let jobs = [];
  try {
    // Toma jobs sin pisarse entre instancias.
    const res = await client.query(
      `update emission_jobs set status='processing', attempts=attempts+1, updated_at=now()
       where id in (
         select id from emission_jobs where status='pending' order by created_at asc limit $1 for update skip locked
       ) returning *`,
      [limit],
    );
    jobs = res.rows;
  } finally {
    client.release();
  }

  for (const job of jobs) {
    try {
      const r = await processJob(job);
      if (r.retry) {
        const failed = job.attempts >= 6;
        await pool.query(`update emission_jobs set status=$2, last_error=$3, updated_at=now() where id=$1`,
          [job.id, failed ? 'failed' : 'pending', r.error || 'retry']);
      } else {
        await pool.query(`update emission_jobs set status=$2, result=$3, boleta_numero=$4, last_error=null, updated_at=now() where id=$1`,
          [job.id, r.status, r.result || null, r.boletaNumero || null]);
      }
    } catch (e) {
      const failed = job.attempts >= 6;
      log(`ERROR orden ${job.order_number}:`, e.message);
      await pool.query(`update emission_jobs set status=$2, last_error=$3, updated_at=now() where id=$1`,
        [job.id, failed ? 'failed' : 'pending', String(e.message || e)]);
    }
  }
  return jobs.length;
}

// ── Reconciliación (red de seguridad): barre órdenes listas sin boleta y las encola ──
// Solo empresas ACTIVAS en la config (auto_emission_config.enabled = true).
export async function reconcile() {
  const cron = await getCron();
  if (!cron.enabled) return;
  const enabledRows = (await pool.query('select company_id from auto_emission_config where enabled=true')).rows;
  const enabledIds = new Set(enabledRows.map((r) => r.company_id));
  const companies = (await listCompanies()).filter(
    (c) => enabledIds.has(c.id) && c.falabellaApiUserId?.trim() && c.falabellaApiKey?.trim(),
  );
  if (!companies.length) return;
  const { normalizeGetOrdersResult } = await import('@zentofact/falabella-api');
  const createdAfter = new Date(Date.now() - cron.windowDays * 24 * 3600 * 1000).toISOString().slice(0, 10) + 'T00:00:00+00:00';
  for (const company of companies) {
    try {
      // Dedup en memoria: 2 queries por empresa (no 3 por orden).
      //  - órdenes que ya tienen boleta
      //  - órdenes que ya están en la cola (cualquier estado) → no re-encolar, mata el bucle
      const [withBoleta, inQueue] = await Promise.all([
        pool.query("select distinct order_number from boletas where company_id=$1 and order_number is not null and order_number <> ''", [company.id]),
        pool.query('select order_number from emission_jobs where company_id=$1', [company.id]),
      ]);
      const known = new Set([
        ...withBoleta.rows.map((r) => String(r.order_number)),
        ...inQueue.rows.map((r) => String(r.order_number)),
      ]);

      const client = new FalabellaApiClient({ userId: company.falabellaApiUserId, apiKey: company.falabellaApiKey, version: '2.0', defaultFormat: 'JSON' });
      let enqueued = 0;
      for (let offset = 0; offset < cron.windowDays * 300 + 100; offset += 100) {
        const resp = await client.getOrdersV2({ createdAfter, limit: 100, offset });
        const orders = normalizeGetOrdersResult(resp.data).orders || [];
        for (const order of orders) {
          const on = String(order?.OrderNumber || '').trim();
          if (!on || known.has(on)) continue; // ya tiene boleta o ya está en la cola
          if (invoiceRequired(order)) continue;
          const status = norm(statusOfOrder(order));
          if (!READY_STATUSES.some((s) => status.includes(s))) continue;
          await enqueue(company.id, on, 'cron', order.OrderId ? String(order.OrderId) : null);
          known.add(on);
          enqueued++;
        }
        if (orders.length < 100) break;
      }
      if (enqueued) log(`cron ${company.nombre}: ${enqueued} órdenes nuevas encoladas`);
    } catch (e) {
      log(`cron ${company.nombre} error:`, e.message);
    }
  }
}

// ── Arranque de los loops ──
export function startAutoEmission() {
  if (!AUTO_ENABLED) { log('apagado por kill-switch (AUTO_EMIT_ENABLED=false)'); return; }
  log('activo. worker cada 20s. modo (simular/emitir) y cron se leen de la config.');
  setInterval(() => { processQueue().catch((e) => log('worker error:', e.message)); }, 20_000);
  if (!RECONCILE_ENABLED) { log('cron deshabilitado por env (AUTO_EMIT_RECONCILE=false)'); return; }

  // Cron auto-reprogramable: lee frecuencia de la config cada vez (encender/apagar/frecuencia en caliente).
  let lastRun = 0;
  const tick = async () => {
    let delayMs = 60_000;
    try {
      const cron = await getCron();
      if (cron.enabled && Date.now() - lastRun >= cron.intervalMinutes * 60_000) {
        lastRun = Date.now();
        await reconcile();
      }
      delayMs = 60_000; // revisa la config cada minuto; corre según intervalMinutes
    } catch (e) { log('cron tick error:', e.message); }
    setTimeout(tick, delayMs);
  };
  // Primer barrido a los 10s de arrancar (respeta cron.enabled dentro de reconcile).
  setTimeout(() => { lastRun = Date.now(); reconcile().catch(() => {}); setTimeout(tick, 60_000); }, 10_000);
}
