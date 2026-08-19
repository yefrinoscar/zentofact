// Emisión automática Falabella: boletas/facturas y notas de crédito.
// Flujo: webhook (o cron) -> cola en Postgres -> worker emite INDIVIDUAL.
// Cancelada/devuelta con comprobante aceptado -> nota de crédito.
// Toda la lógica vive aquí (server); reusa @zentofact/core y el cliente Falabella. No toca el core.
import { randomBytes, timingSafeEqual } from 'crypto';
import { Pool } from 'pg';
import {
  getCompany,
  listCompanies,
  listBranches,
  createBranch,
  processWorkflow,
  falabellaBuildBoletaVenta,
  falabellaBuildFacturaVenta,
  falabellaResolveDocument,
  falabellaUploadInvoicePdf,
  falabellaUploadBoletaPdf,
  createFactura,
  sendFacturaToSunat,
  createAndSendCreditNoteFromBoleta,
  createAndSendCreditNoteFromFactura,
} from '@zentofact/core';
import { FalabellaApiClient } from '@zentofact/falabella-api';
import { upsertFalabellaWebhookOrder } from './falabella-sync.js';
import {
  JOB_KIND_CREDIT_NOTE,
  JOB_KIND_INVOICE,
  decideCreditNoteJob,
  isPendingStatus,
  isReadyStatus,
  jobKindForStatus,
  normStatus,
} from './auto-emission-policy.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL_POSTGRES });

/** Secreto opaco por empresa (64 hex). No se usa un secret global en env. */
function generateWebhookSecret() {
  return randomBytes(32).toString('hex');
}

export function publicApiBaseUrl() {
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  if (process.env.AUTH_BASE_URL) {
    try { return new URL(process.env.AUTH_BASE_URL).origin; } catch { /* ignore */ }
  }
  return `http://localhost:${process.env.PORT || 3010}`;
}

/** URL que se registra en Falabella: token en path, nunca en ?secret= */
export function buildWebhookCallbackUrl(companyId, secret) {
  const token = encodeURIComponent(String(secret || ''));
  return `${publicApiBaseUrl()}/webhooks/falabella/${Number(companyId)}/${token}`;
}

/** Redacta tokens de URL para UI/logs (path o query legacy). */
export function redactWebhookUrl(url) {
  return String(url || '')
    .replace(/([?&]secret=)[^&]*/gi, '$1***')
    .replace(/(\/webhooks\/falabella\/\d+\/)[^/?#]+/gi, '$1***');
}

function secretsEqual(expected, provided) {
  const a = Buffer.from(String(expected || ''), 'utf8');
  const b = Buffer.from(String(provided || ''), 'utf8');
  if (!a.length || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Crea el secret de la empresa si no existe. Nunca devuelve el valor a callers HTTP sin cuidado. */
export async function ensureCompanyWebhookSecret(companyId) {
  const id = Number(companyId);
  if (!Number.isFinite(id) || id <= 0) throw new Error('companyId inválido');

  const existing = await pool.query(
    'select webhook_secret from auto_emission_config where company_id=$1',
    [id],
  );
  const current = String(existing.rows[0]?.webhook_secret || '').trim();
  if (current) return current;

  const secret = generateWebhookSecret();
  const upserted = await pool.query(
    `insert into auto_emission_config (company_id, enabled, webhook_secret, updated_at)
     values ($1, false, $2, now())
     on conflict (company_id) do update
       set webhook_secret = coalesce(nullif(trim(auto_emission_config.webhook_secret), ''), excluded.webhook_secret),
           updated_at = now()
     returning webhook_secret`,
    [id, secret],
  );
  return String(upserted.rows[0]?.webhook_secret || secret);
}

export async function rotateCompanyWebhookSecret(companyId) {
  const id = Number(companyId);
  if (!Number.isFinite(id) || id <= 0) throw new Error('companyId inválido');
  const secret = generateWebhookSecret();
  await pool.query(
    `insert into auto_emission_config (company_id, enabled, webhook_secret, updated_at)
     values ($1, false, $2, now())
     on conflict (company_id) do update
       set webhook_secret = excluded.webhook_secret, updated_at = now()`,
    [id, secret],
  );
  log(`webhook secret rotado company=${id}`);
  return {
    companyId: id,
    rotated: true,
    hasWebhookSecret: true,
    webhookCallbackUrl: redactWebhookUrl(buildWebhookCallbackUrl(id, secret)),
  };
}

/** Fail-closed: sin secret en DB → no autorizado. */
export async function verifyCompanyWebhookAuth(companyId, providedSecret) {
  const id = Number(companyId);
  if (!Number.isFinite(id) || id <= 0) return false;
  const given = String(providedSecret || '').trim();
  if (!given) return false;
  const r = await pool.query(
    'select webhook_secret from auto_emission_config where company_id=$1',
    [id],
  );
  const expected = String(r.rows[0]?.webhook_secret || '').trim();
  if (!expected) return false;
  return secretsEqual(expected, given);
}

export async function getCompanyWebhookMeta(companyId) {
  const id = Number(companyId);
  const r = await pool.query(
    'select webhook_secret from auto_emission_config where company_id=$1',
    [id],
  );
  const secret = String(r.rows[0]?.webhook_secret || '').trim();
  return {
    companyId: id,
    hasWebhookSecret: !!secret,
    webhookCallbackUrl: secret ? redactWebhookUrl(buildWebhookCallbackUrl(id, secret)) : null,
  };
}

// El motor corre por defecto; solo se apaga si AUTO_EMIT_ENABLED=false (kill-switch de deploy).
// El control fino vive en la BD (pausar cola, cron on/off, simular/emitir).
const AUTO_ENABLED = process.env.AUTO_EMIT_ENABLED !== 'false';
const DRY_RUN = process.env.AUTO_EMIT_DRY_RUN === 'true';
const RECONCILE_ENABLED = process.env.AUTO_EMIT_RECONCILE !== 'false'; // red de seguridad; on por defecto
const DEV_FAST_CRON = !process.env.RAILWAY_PUBLIC_DOMAIN && process.env.NODE_ENV !== 'production';
const MIN_ORDER_DATE = new Date('2026-07-01T00:00:00+00:00');
const JOB_TIMEOUT_MS = Math.max(60_000, Number(process.env.AUTO_EMIT_JOB_TIMEOUT_MS || 3 * 60_000));
const CREDIT_NOTE_OPTIONS = {
  codMotivo: '01',
  desMotivo: 'ANULACION DE LA OPERACION',
  usuarioCreacion: 'auto-emission',
};

const log = (...a) => console.log('[auto-emit]', ...a);
const today = () => new Date().toISOString().slice(0, 10);
const dateOnly = (value) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? today() : d.toISOString().slice(0, 10);
};
const timeoutLabel = () => `${Math.round(JOB_TIMEOUT_MS / 60_000)} min`;
const retryDelaySeconds = (attempts) => Math.min(15 * 60, 60 * (2 ** Math.max(0, Number(attempts || 1) - 1)));
const jobKindOf = (job) => (job?.kind === JOB_KIND_CREDIT_NOTE ? JOB_KIND_CREDIT_NOTE : JOB_KIND_INVOICE);

async function hasAcceptedSalesDocument(companyId, orderNumber) {
  const number = String(orderNumber || '').trim();
  if (!number) return false;
  const r = await pool.query(
    `select 1
     from (
       select 1 from boletas where company_id=$1 and order_number=$2 and estado_sunat='ACEPTADO' limit 1
       union all
       select 1 from facturas where company_id=$1 and order_number=$2 and estado_sunat='ACEPTADO' limit 1
     ) docs
     limit 1`,
    [companyId, number],
  );
  return r.rows.length > 0;
}

async function enqueueIfNeeded(companyId, orderNumber, source, orderId, kind) {
  if (kind === JOB_KIND_CREDIT_NOTE && !(await hasAcceptedSalesDocument(companyId, orderNumber))) {
    log(`company=${companyId} orden=${orderNumber} no se encola NC: no hay boleta/factura aceptada`);
    return { enqueued: false, ignored: 'no hay documento emitido; no corresponde nota de crédito' };
  }
  await enqueue(companyId, orderNumber, source, orderId, kind);
  return { enqueued: true };
}

class JobTimeoutError extends Error {
  constructor(step) {
    super(`timeout ${timeoutLabel()} en etapa: ${step || 'sin etapa registrada'}`);
    this.name = 'JobTimeoutError';
    this.step = step || null;
  }
}

function withJobTimeout(promise, getStep) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new JobTimeoutError(getStep())), JOB_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Extrae identificadores de la orden del payload del webhook (defensivo: nombres variables).
function extractOrder(payload) {
  const p = payload || {};
  const body = p.data || p.payload || p.order || p.Order || p;
  const orderNumber = String(body.OrderNumber || body.orderNumber || body.order_number || p.orderNumber || '').trim();
  const orderId = String(body.OrderId || body.orderId || body.order_id || p.orderId || '').trim();
  return { orderNumber, orderId, body, raw: p };
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
  // Solo companyId: processWorkflow carga certificado/SOL desde la DB.
  // El modo SUNAT lo define el ambiente (SUNAT_FORCE_ENV).
  return {
    companyId: company.id,
    serieBoleta: 'B001',
    outputDir: process.env.STORAGE_PATH || 'storage',
  };
}

async function getOrCreateMainBranch(company) {
  const existing = await listBranches(company.id);
  // SUNAT valida el establecimiento anexo: el principal '0000' siempre está declarado.
  const zero = existing.find((b) => b.codigo === '0000');
  if (zero) return zero;
  return createBranch({
    companyId: company.id,
    codigo: '0000',
    nombre: 'Principal',
    direccion: company.direccion || '',
    ubigeo: company.ubigeo || '',
  });
}

function toFacturaInput({ company, branch, venta, orderNumber }) {
  return {
    company_id: company.id,
    branch_id: branch.id,
    order_number: orderNumber,
    serie: venta.serie || 'F001',
    fecha_emision: venta.fechaEmision || today(),
    moneda: venta.moneda || 'PEN',
    tipo_operacion: '0101',
    ubl_version: '2.1',
    metodo_envio: 'individual',
    client: {
      tipo_documento: venta.client.tipoDocumento,
      numero_documento: venta.client.numeroDocumento,
      razon_social: venta.client.razonSocial,
      direccion: venta.client.direccion || '',
    },
    detalles: venta.detalles,
    datos_adicionales: [
      { source: 'falabella-api', orderNumber, emission: 'auto' },
    ],
    usuario_creacion: 'auto-emission',
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
      kind text not null default 'invoice',
      status text not null default 'pending',
      attempts integer not null default 0,
      last_error text,
      result text,
      boleta_numero text,
      current_step text,
      source text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      next_attempt_at timestamptz
    );
    alter table emission_jobs add column if not exists order_id text;
    alter table emission_jobs add column if not exists current_step text;
    alter table emission_jobs add column if not exists next_attempt_at timestamptz;
    alter table emission_jobs add column if not exists kind text not null default 'invoice';
    do $$
    declare rec record;
    begin
      for rec in
        select c.conname
        from pg_constraint c
        join pg_class t on t.oid = c.conrelid
        where t.relname = 'emission_jobs'
          and c.contype = 'u'
          and pg_get_constraintdef(c.oid) like '%company_id%'
          and pg_get_constraintdef(c.oid) like '%order_number%'
          and pg_get_constraintdef(c.oid) not like '%kind%'
      loop
        execute format('alter table emission_jobs drop constraint if exists %I', rec.conname);
      end loop;
      for rec in
        select i.relname as idx
        from pg_index x
        join pg_class i on i.oid = x.indexrelid
        join pg_class t on t.oid = x.indrelid
        where t.relname = 'emission_jobs'
          and x.indisunique
          and not x.indisprimary
          and pg_get_indexdef(x.indexrelid) like '%(company_id, order_number)%'
          and pg_get_indexdef(x.indexrelid) not like '%kind%'
      loop
        execute format('drop index if exists %I', rec.idx);
      end loop;
    end $$;
    create unique index if not exists emission_jobs_company_order_kind_uidx
      on emission_jobs (company_id, order_number, kind);
    create table if not exists auto_emission_config (
      company_id integer primary key,
      enabled boolean not null default false,
      webhook_secret text,
      updated_at timestamptz not null default now()
    );
    alter table auto_emission_config add column if not exists webhook_secret text;
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
  const minInterval = DEV_FAST_CRON ? (10 / 60) : 5;
  const next = {
    enabled: enabled === undefined ? cur.enabled : !!enabled,
    intervalMinutes: intervalMinutes === undefined ? cur.intervalMinutes : Math.max(minInterval, Math.min(1440, Number(intervalMinutes) || cur.intervalMinutes)),
    windowDays: windowDays === undefined ? cur.windowDays : Math.max(1, Math.min(60, Number(windowDays) || cur.windowDays)),
  };
  await pool.query(
    `update auto_emission_state set cron_enabled=$1, cron_interval_minutes=$2, cron_window_days=$3, updated_at=now() where id=1`,
    [next.enabled, next.intervalMinutes, next.windowDays],
  );
  log(`cron: ${next.enabled ? 'ON' : 'OFF'} cada ${next.intervalMinutes < 1 ? `${Math.round(next.intervalMinutes * 60)}s` : `${next.intervalMinutes}min`}, ventana ${next.windowDays}d`);
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
    `update emission_jobs set status='pending', attempts=0, last_error=null, current_step=null, next_attempt_at=null, updated_at=now()
     where id=$1 returning id, company_id, order_number, status`, [id]);
  return r.rows[0] || null;
}

// ── Config por empresa (qué empresas emiten automáticamente) ──
export async function getConfig() {
  const companies = await listCompanies();
  const rows = (await pool.query(
    'select company_id, enabled, webhook_secret from auto_emission_config',
  )).rows;
  const map = new Map(rows.map((r) => [r.company_id, r]));
  const paused = await getPaused();
  const cron = await getCron();
  const dryRun = await getDryRun();
  // A qué SUNAT emite realmente (lo decide el ambiente).
  const forced = (process.env.SUNAT_FORCE_ENV || '').trim().toLowerCase();
  const sunatEnv = forced.startsWith('prod')
    ? 'produccion'
    : forced === 'beta'
      ? 'beta'
      : (process.env.RAILWAY_PUBLIC_DOMAIN || process.env.NODE_ENV === 'production')
        ? 'produccion'
        : 'beta';
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
    // Base sin secret ni companyId; la URL real se arma por empresa en el servidor.
    webhookBase: `${publicApiBaseUrl()}/webhooks/falabella`,
    companies: companies.map((c) => {
      const cfg = map.get(c.id);
      const secret = String(cfg?.webhook_secret || '').trim();
      return {
        id: c.id,
        nombre: c.nombre,
        ruc: c.ruc,
        hasFalabella: !!(c.falabellaApiUserId?.trim() && c.falabellaApiKey?.trim()),
        enabled: cfg?.enabled ?? false,
        hasWebhookSecret: !!secret,
        // Solo preview redactada; el token completo no sale al browser.
        webhookCallbackUrl: secret ? redactWebhookUrl(buildWebhookCallbackUrl(c.id, secret)) : null,
      };
    }),
  };
}

export async function setCompanyEnabled(companyId, enabled) {
  // Al activar, asegura secret por empresa (fail-closed en el webhook público).
  if (enabled) await ensureCompanyWebhookSecret(companyId);
  await pool.query(
    `insert into auto_emission_config (company_id, enabled, updated_at) values ($1,$2,now())
     on conflict (company_id) do update set enabled=excluded.enabled, updated_at=now()`,
    [companyId, !!enabled],
  );
  let clearedSkipped = 0;
  if (enabled) {
    const deleted = await pool.query(
      `delete from emission_jobs where company_id=$1 and status='skipped'`,
      [companyId],
    );
    clearedSkipped = deleted.rowCount || 0;
    setTimeout(() => {
      reconcile().catch((e) => log('reconcile after company activation error:', e.message));
    }, 0);
  }
  return { companyId, enabled: !!enabled, clearedSkipped };
}

async function isCompanyEnabled(companyId) {
  const r = await pool.query('select enabled from auto_emission_config where company_id=$1', [companyId]);
  return r.rows[0]?.enabled === true;
}

// Últimos jobs y eventos (para el panel).
export async function recentJobs(limit = 50) {
  const r = await pool.query(
    `select j.id, j.company_id, c.nombre as company, coalesce(nullif(b.order_number, ''), nullif(f.order_number, ''), j.order_number) as order_number, j.order_id, j.status, j.source,
            j.kind, j.attempts, j.result, j.last_error, j.boleta_numero, j.current_step, j.created_at, j.updated_at
     from emission_jobs j left join companies c on c.id=j.company_id
     left join lateral (
       select order_number from boletas
       where company_id=j.company_id and numero_completo=j.boleta_numero
       order by id desc limit 1
     ) b on true
     left join lateral (
       select order_number from facturas
       where company_id=j.company_id and numero_completo=j.boleta_numero
       order by id desc limit 1
     ) f on true
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

// Confirma el estado autoritativo antes de crear un job desde un webhook.
// Si Falabella no responde, el cron de reconciliación será la red de seguridad.
async function fetchOrderForWebhook(companyId, orderId, orderNumber) {
  const company = await getCompany(companyId);
  if (!company?.falabellaApiUserId?.trim() || !company?.falabellaApiKey?.trim()) return null;
  const client = new FalabellaApiClient({
    userId: company.falabellaApiUserId,
    apiKey: company.falabellaApiKey,
    version: '2.0',
    defaultFormat: 'JSON',
  });
  if (orderId) {
    const byId = await fetchOrderById(client, orderId);
    if (byId) return byId;
  }
  if (orderNumber) {
    const dates = [today(), dateOnly(Date.now() - 24 * 60 * 60 * 1000)];
    for (const date of dates) {
      const found = await client.findOrderByOrderNumber(orderNumber, date);
      if (found?.raw) return found.raw;
    }
  }
  return null;
}

async function saveResolvedOrderNumber(job, orderNumber) {
  const resolved = String(orderNumber || '').trim();
  if (!resolved || resolved === String(job.order_number || '').trim()) return null;
  const kind = jobKindOf(job);
  const duplicate = (await pool.query(
    `select id, status, result, boleta_numero
     from emission_jobs
     where company_id=$1 and order_number=$2 and kind=$3 and id<>$4
     limit 1`,
    [job.company_id, resolved, kind, job.id],
  )).rows[0] || null;
  if (duplicate) return duplicate;
  await pool.query(
    `update emission_jobs j
     set order_number=$2, updated_at=now()
     where j.id=$1
       and not exists (
         select 1 from emission_jobs other
         where other.company_id=j.company_id and other.order_number=$2 and other.kind=$3 and other.id<>j.id
       )`,
    [job.id, resolved, kind],
  ).catch((e) => log(`no se pudo actualizar OrderNumber real para job ${job.id}:`, e.message));
  return null;
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
      creditNote: document.creditNote ? {
        numeroCompleto: document.creditNote.numeroCompleto,
        estadoSunat: document.creditNote.estadoSunat,
      } : null,
    } : null,
  };
}

// ── Cola ──
export async function enqueue(companyId, orderNumber, source = 'webhook', orderId = null, kind = JOB_KIND_INVOICE) {
  if (!orderNumber) return;
  const jobKind = kind === JOB_KIND_CREDIT_NOTE ? JOB_KIND_CREDIT_NOTE : JOB_KIND_INVOICE;
  await pool.query(
    `insert into emission_jobs (company_id, order_number, order_id, kind, status, source, created_at, updated_at)
     values ($1, $2, $3, $5, 'pending', $4, now(), now())
     on conflict (company_id, order_number, kind) do update
       set status = case
             when emission_jobs.status in ('failed') then 'pending'
             when emission_jobs.status = 'skipped' and emission_jobs.result like 'orden de % anterior a la fecha%' then 'skipped'
             when emission_jobs.status = 'skipped' then 'pending'
             else emission_jobs.status
           end,
           order_id = coalesce(excluded.order_id, emission_jobs.order_id),
           updated_at = now()`,
    [companyId, orderNumber, orderId || null, source, jobKind],
  );
}

// ── Webhook ──
export async function handleWebhook(companyId, payload) {
  const { orderNumber, orderId, body } = extractOrder(payload);
  await pool.query(
    `insert into webhook_events (company_id, order_number, event, raw) values ($1,$2,$3,$4)`,
    [companyId, orderNumber || null, 'onOrderItemsStatusChanged', JSON.stringify(payload || {})],
  ).catch(() => {});
  const enabled = await isCompanyEnabled(companyId);
  log(`webhook company=${companyId} orden=${orderNumber || '?'} orderId=${orderId || '?'} ${enabled ? '' : '(empresa NO activa, se ignora)'}`);
  if (!enabled) return { ok: true, orderNumber, orderId, ignored: 'empresa no activa para emisión automática' };

  const payloadStatus = normStatus(statusOfOrder(body));
  const payloadKind = payloadStatus ? jobKindForStatus(payloadStatus) : null;
  if (payloadStatus && !payloadKind) {
    log(`webhook company=${companyId} orden=${orderNumber || orderId || '?'} no se encola: estado "${payloadStatus}"`);
    return { ok: true, orderNumber, orderId, ignored: `estado "${payloadStatus}" no dispara emisión automática` };
  }

  let authoritative = null;
  try {
    authoritative = await fetchOrderForWebhook(companyId, orderId, orderNumber);
  } catch (e) {
    log(`webhook company=${companyId} no pudo confirmar orden:`, e.message);
  }
  if (authoritative) {
    // El webhook también mantiene la copia local de lectura; el cursor incremental
    // no avanza porque una orden puntual no prueba que recibimos todos los cambios.
    await upsertFalabellaWebhookOrder(companyId, authoritative).catch((e) => {
      log(`webhook company=${companyId} no pudo guardar orden local:`, e.message);
    });
    const currentStatus = normStatus(statusOfOrder(authoritative));
    const kind = jobKindForStatus(currentStatus);
    if (!kind) {
      log(`webhook company=${companyId} orden=${authoritative.OrderNumber || orderNumber || orderId || '?'} no se encola: estado "${currentStatus || 'desconocido'}"`);
      return {
        ok: true,
        orderNumber: String(authoritative.OrderNumber || orderNumber || '').trim(),
        orderId: String(authoritative.OrderId || orderId || '').trim(),
        ignored: `estado "${currentStatus || 'desconocido'}" no dispara emisión automática`,
      };
    }
    const resolvedNumber = String(authoritative.OrderNumber || orderNumber || '').trim();
    if (resolvedNumber) {
      const queued = await enqueueIfNeeded(companyId, resolvedNumber, 'webhook', authoritative.OrderId || orderId, kind);
      if (!queued.enqueued) {
        return {
          ok: true,
          orderNumber: resolvedNumber,
          orderId: String(authoritative.OrderId || orderId || ''),
          kind,
          ignored: queued.ignored,
        };
      }
    }
    return { ok: true, orderNumber: resolvedNumber, orderId: String(authoritative.OrderId || orderId || ''), kind };
  }

  // Un webhook sin estado verificable no debe crear un job a ciegas (ni usar OrderId como OrderNumber).
  // El cron consultará las órdenes listas y las encolará con su OrderNumber real.
  if (!payloadKind) {
    log(`webhook company=${companyId} orden=${orderNumber || orderId || '?'} no se encola: estado no confirmado`);
    return { ok: true, orderNumber, orderId, ignored: 'estado no confirmado; lo resolverá la reconciliación' };
  }
  if (orderNumber) {
    const queued = await enqueueIfNeeded(companyId, orderNumber, 'webhook', orderId, payloadKind);
    if (!queued.enqueued) return { ok: true, orderNumber, orderId, kind: payloadKind, ignored: queued.ignored };
  }
  return { ok: true, orderNumber, orderId, kind: payloadKind };
}

// ── Worker ──
async function processJob(job, setStep = async () => {}) {
  await setStep('validando empresa');
  if (!(await isCompanyEnabled(job.company_id))) {
    return { status: 'skipped', result: 'empresa no activa para emisión automática' };
  }
  const company = await getCompany(job.company_id);
  if (!company || !company.falabellaApiUserId?.trim() || !company.falabellaApiKey?.trim()) {
    return { status: 'skipped', result: 'empresa sin credenciales Falabella' };
  }

  // 1) Traer la orden de Falabella (estado autoritativo).
  //    Si el webhook nos dio OrderId → GetOrder puntual (1 llamada). Si no, fallback: escaneo por fecha.
  await setStep('consultando orden en Falabella');
  const client = new FalabellaApiClient({ userId: company.falabellaApiUserId, apiKey: company.falabellaApiKey, version: '2.0', defaultFormat: 'JSON' });
  let order = await fetchOrderById(client, job.order_id);
  if (!order) {
    const found = await client.findOrderByOrderNumber(job.order_number, today());
    if (!found) return { retry: true, error: 'orden aún no visible en Falabella' };
    order = found.raw || found;
  }
  // El número real (por si encolamos con el OrderId como clave).
  const orderNumber = String(order.OrderNumber || job.order_number).trim();
  const duplicateJob = await saveResolvedOrderNumber(job, orderNumber);
  if (duplicateJob) {
    if (duplicateJob.status === 'done') {
      return {
        status: 'done',
        result: duplicateJob.result || `orden ${orderNumber} ya procesada en job ${duplicateJob.id}`,
        boletaNumero: duplicateJob.boleta_numero || null,
      };
    }
    return {
      status: 'skipped',
      result: `orden ${orderNumber} ya existe en job ${duplicateJob.id} (${duplicateJob.status})`,
      boletaNumero: duplicateJob.boleta_numero || null,
    };
  }

  // 1.5) Omitir órdenes anteriores a la fecha mínima (julio 2026).
  const orderDate = order.CreatedAt ? new Date(order.CreatedAt) : null;
  if (orderDate && orderDate < MIN_ORDER_DATE) {
    return { status: 'skipped', result: `orden de ${orderDate.toISOString().slice(0, 10)} anterior a la fecha mínima (julio 2026), se omite` };
  }

  if (jobKindOf(job) === JOB_KIND_CREDIT_NOTE) {
    return processCreditNoteJob(job, { order, orderNumber, orderDate, setStep });
  }

  // 2) Condiciones (mismas que el Gestor de Sellers).
  const requiresInvoice = invoiceRequired(order);
  const status = normStatus(statusOfOrder(order));
  const ready = isReadyStatus(status);
  if (!ready) {
    // Un pending puede cambiar a delivered sin que Falabella reenvíe el webhook.
    // Se difiere el job; no se convierte en skipped ni bloquea la reconciliación.
    if (isPendingStatus(status)) return { retry: true, error: `estado "${status}" aún no habilita comprobante` };
    return { status: 'skipped', result: `estado "${status}" aún no habilita comprobante` };
  }

  // 3) ¿ya tiene documento? Solo cuenta como emitido si está ACEPTADO por SUNAT.
  //    Si existe pero está RECHAZADO/sin aceptar → falla visible (no se oculta como "Emitida").
  await setStep('revisando documento existente');
  const doc = await falabellaResolveDocument({ companyId: job.company_id, orderNumber });
  const existingDoc = requiresInvoice ? doc?.factura : doc?.boleta;
  if (existingDoc) {
    const est = String(existingDoc.estadoSunat || existingDoc.estado || '').toUpperCase();
    const tipo = requiresInvoice ? 'factura' : 'boleta';
    if (est === 'ACEPTADO') {
      return { status: 'done', result: `ya tenía ${tipo} ${existingDoc.numeroCompleto}`, boletaNumero: existingDoc.numeroCompleto };
    }
    return { status: 'failed', result: `${tipo} ${existingDoc.numeroCompleto} existe pero está ${est || 'SIN ACEPTAR'} en SUNAT — revisar (no se re-emite para evitar duplicados)`, boletaNumero: existingDoc.numeroCompleto };
  }

  if (await getDryRun()) return { status: 'skipped', result: 'Simulación: cumpliría condiciones, no se emitió' };

  if (requiresInvoice) {
    await setStep('construyendo factura');
    const built = await falabellaBuildFacturaVenta({ companyId: job.company_id, order });
    if (built.error) throw new Error(`build-factura: ${built.error}`);
    await setStep('creando factura');
    const branch = await getOrCreateMainBranch(company);
    const created = await createFactura(toFacturaInput({ company, branch, venta: built.venta, orderNumber }));
    await setStep('enviando factura a SUNAT');
    const sent = await sendFacturaToSunat(created.id);
    if (!sent?.success) throw new Error(sent?.message || 'SUNAT no aceptó la factura');
    log(`orden ${orderNumber} -> factura ${created.numeroCompleto} ACEPTADA`);

    let uploadNote = '';
    try {
      await setStep('subiendo factura a Falabella');
      const up = await falabellaUploadInvoicePdf({
        companyId: job.company_id,
        facturaId: created.id,
        orderNumber,
        orderItemIds: built.orderItemIds || [],
        invoiceNumber: created.numeroCompleto,
        invoiceDate: created.fechaEmision,
        invoiceType: 'FACTURA',
        source: 'local_factura',
      });
      uploadNote = up?.ok && !up?.error ? ' + subida a Falabella' : ` (subida falló: ${up?.error?.Head?.ErrorMessage || up?.error || 'ver logs'})`;
      log(`orden ${orderNumber} factura subida a Falabella:`, uploadNote);
    } catch (e) {
      uploadNote = ` (subida falló: ${e.message})`;
    }

    return { status: 'done', result: `factura ${created.numeroCompleto} ACEPTADA${uploadNote}`, boletaNumero: created.numeroCompleto };
  }

  // 4) Construir venta + emitir INDIVIDUAL (producción).
  await setStep('construyendo boleta');
  const built = await falabellaBuildBoletaVenta({ companyId: job.company_id, order });
  if (built.error) throw new Error(`build-venta: ${built.error}`);
  await setStep('emitiendo boleta en SUNAT');
  const result = await processWorkflow(buildConfig(company), [built.venta]);
  const b = result?.boletas?.[0];
  if (!b || String(b.estadoSunat).toUpperCase() !== 'ACEPTADO') {
    throw new Error(b?.error || 'SUNAT no aceptó la boleta');
  }
  log(`orden ${orderNumber} -> boleta ${b.numeroCompleto} ACEPTADA`);

  // 5) Subir la boleta a Falabella (necesita Chromium para el PDF; ver nota de deploy).
  let uploadNote = '';
  try {
    await setStep('subiendo boleta a Falabella');
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

async function processCreditNoteJob(job, { order, orderNumber, orderDate, setStep }) {
  const status = normStatus(statusOfOrder(order));
  await setStep('revisando documento existente');
  const doc = await falabellaResolveDocument({ companyId: job.company_id, orderNumber });
  const decided = decideCreditNoteJob({
    status,
    orderDate,
    minOrderDate: MIN_ORDER_DATE,
    boleta: doc?.boleta,
    factura: doc?.factura,
    creditNote: doc?.creditNote,
    dryRun: await getDryRun(),
  });

  if (decided.action === 'retry') return { retry: true, error: decided.error };
  if (decided.action === 'skip') return { status: 'skipped', result: decided.result, boletaNumero: decided.boletaNumero || null };
  if (decided.action === 'fail') return { status: 'failed', result: decided.result, boletaNumero: decided.boletaNumero || null };
  if (decided.action === 'done') return { status: 'done', result: decided.result, boletaNumero: decided.boletaNumero || null };

  await setStep(decided.source === 'factura' ? 'emitiendo nota de crédito de factura' : 'emitiendo nota de crédito de boleta');
  const sent = decided.source === 'factura'
    ? await createAndSendCreditNoteFromFactura(decided.documentId, CREDIT_NOTE_OPTIONS)
    : await createAndSendCreditNoteFromBoleta(decided.documentId, CREDIT_NOTE_OPTIONS);
  if (!sent?.success) {
    throw new Error(sent?.error?.message || sent?.message || 'SUNAT no aceptó la nota de crédito');
  }
  const numero = sent.numeroCompleto || decided.boletaNumero;
  log(`orden ${orderNumber} -> nota de crédito ${numero} ACEPTADA`);
  return { status: 'done', result: `nota de crédito ${numero} ACEPTADA`, boletaNumero: numero || null };
}

export async function processQueue(limit = 3) {
  if (await getPaused()) return 0; // cola pausada desde el panel
  const client = await pool.connect();
  let jobs = [];
  try {
    await client.query(
      `update emission_jobs
       set status='failed',
           last_error='timeout ${timeoutLabel()} en etapa: ' || coalesce(current_step, 'sin etapa registrada'),
           updated_at=now()
       where status='processing'
         and updated_at < now() - ($1::int * interval '1 millisecond')`,
      [JOB_TIMEOUT_MS],
    );
    // Toma jobs sin pisarse entre instancias.
    const res = await client.query(
      `update emission_jobs set status='processing', attempts=attempts+1, current_step='iniciando', updated_at=now()
       where id in (
         select id from emission_jobs
         where status='pending' and (next_attempt_at is null or next_attempt_at <= now())
         order by created_at asc limit $1 for update skip locked
       ) returning *`,
      [limit],
    );
    jobs = res.rows;
  } finally {
    client.release();
  }

  for (const job of jobs) {
    let currentStep = job.current_step || 'iniciando';
    const setStep = async (step) => {
      currentStep = step;
      await pool.query('update emission_jobs set current_step=$2, updated_at=now() where id=$1 and status=\'processing\'', [job.id, step]);
    };
    try {
      const r = await withJobTimeout(processJob(job, setStep), () => currentStep);
      if (r.retry) {
        const failed = job.attempts >= 6;
        const nextStatus = failed ? 'failed' : 'pending';
        await pool.query(`update emission_jobs
          set status=$2,
              last_error=$3,
              current_step=null,
              next_attempt_at=case when $2='pending' then now() + ($4::int * interval '1 second') else null end,
              updated_at=now()
          where id=$1`,
        [job.id, nextStatus, r.error || 'retry', retryDelaySeconds(job.attempts)]);
      } else {
        await pool.query(`update emission_jobs set status=$2, result=$3, boleta_numero=$4, last_error=null, current_step=null, next_attempt_at=null, updated_at=now() where id=$1`,
          [job.id, r.status, r.result || null, r.boletaNumero || null]);
      }
    } catch (e) {
      const isTimeout = e instanceof JobTimeoutError;
      const failed = isTimeout || job.attempts >= 6;
      log(`ERROR orden ${job.order_number}:`, e.message);
      const nextStatus = failed ? 'failed' : 'pending';
      await pool.query(`update emission_jobs
        set status=$2,
            last_error=$3,
            current_step=$4,
            next_attempt_at=case when $2='pending' then now() + ($5::int * interval '1 second') else null end,
            updated_at=now()
        where id=$1`,
      [job.id, nextStatus, String(e.message || e), isTimeout ? currentStep : null, retryDelaySeconds(job.attempts)]);
    }
  }
  return jobs.length;
}

async function enqueueLocalCreditNotes(companyId, alreadyQueued) {
  const rows = (await pool.query(
    `select distinct fo.order_number, fo.order_id
     from falabella_orders fo
     where fo.company_id=$1
       and fo.order_number is not null and fo.order_number <> ''
       and fo.status ~* '(canceled|cancelled|cancelada|returned|devuelta)'
       and coalesce(fo.falabella_created_at, fo.first_seen_at) >= $2
       and (
         exists (
           select 1 from boletas b
           where b.company_id=fo.company_id and b.order_number=fo.order_number and b.estado_sunat='ACEPTADO'
         )
         or exists (
           select 1 from facturas f
           where f.company_id=fo.company_id and f.order_number=fo.order_number and f.estado_sunat='ACEPTADO'
         )
       )
       and not exists (
         select 1 from credit_notes cn
         left join boletas b on b.id=cn.affected_boleta_id
         left join facturas f on f.id=cn.affected_factura_id
         where cn.company_id=fo.company_id
           and cn.estado_sunat='ACEPTADO'
           and (b.order_number=fo.order_number or f.order_number=fo.order_number)
       )`,
    [companyId, MIN_ORDER_DATE],
  )).rows;
  let enqueued = 0;
  for (const row of rows) {
    const orderNumber = String(row.order_number || '').trim();
    if (!orderNumber || alreadyQueued.has(orderNumber)) continue;
    await enqueue(companyId, orderNumber, 'cron', row.order_id ? String(row.order_id) : null, JOB_KIND_CREDIT_NOTE);
    alreadyQueued.add(orderNumber);
    enqueued++;
  }
  return enqueued;
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
  const rawAfter = new Date(Math.max(Date.now() - cron.windowDays * 24 * 3600 * 1000, MIN_ORDER_DATE.getTime()));
  const createdAfter = rawAfter.toISOString().slice(0, 10) + 'T00:00:00+00:00';
  for (const company of companies) {
    try {
      // Dedup en memoria: 3 queries por empresa.
      //  - órdenes que ya tienen boleta
      //  - órdenes que ya tienen factura
      //  - órdenes activas en la cola; los skipped sin documento sí deben poder recuperarse
      const [withBoleta, withFactura, invoiceQueue, creditNoteQueue] = await Promise.all([
        pool.query("select distinct order_number from boletas where company_id=$1 and order_number is not null and order_number <> ''", [company.id]),
        pool.query("select distinct order_number from facturas where company_id=$1 and order_number is not null and order_number <> ''", [company.id]),
        pool.query("select order_number from emission_jobs where company_id=$1 and coalesce(kind, 'invoice')='invoice' and status in ('pending','processing','done')", [company.id]),
        pool.query("select order_number from emission_jobs where company_id=$1 and kind='credit_note' and status in ('pending','processing','done')", [company.id]),
      ]);
      const invoiceKnown = new Set([
        ...withBoleta.rows.map((r) => String(r.order_number)),
        ...withFactura.rows.map((r) => String(r.order_number)),
        ...invoiceQueue.rows.map((r) => String(r.order_number)),
      ]);
      const creditNoteKnown = new Set(creditNoteQueue.rows.map((r) => String(r.order_number)));

      const client = new FalabellaApiClient({ userId: company.falabellaApiUserId, apiKey: company.falabellaApiKey, version: '2.0', defaultFormat: 'JSON' });
      let enqueued = 0;
      let creditNotesEnqueued = 0;
      for (let offset = 0; offset < cron.windowDays * 300 + 100; offset += 100) {
        const resp = await client.getOrdersV2({ createdAfter, limit: 100, offset });
        const orders = normalizeGetOrdersResult(resp.data).orders || [];
        for (const order of orders) {
          const on = String(order?.OrderNumber || '').trim();
          if (!on) continue;
          const status = normStatus(statusOfOrder(order));
          const kind = jobKindForStatus(status);
          if (kind === JOB_KIND_INVOICE && !invoiceKnown.has(on)) {
            await enqueue(company.id, on, 'cron', order.OrderId ? String(order.OrderId) : null, JOB_KIND_INVOICE);
            invoiceKnown.add(on);
            enqueued++;
          }
          if (kind === JOB_KIND_CREDIT_NOTE && !creditNoteKnown.has(on) && invoiceKnown.has(on)) {
            const queued = await enqueueIfNeeded(company.id, on, 'cron', order.OrderId ? String(order.OrderId) : null, JOB_KIND_CREDIT_NOTE);
            if (queued.enqueued) {
              creditNoteKnown.add(on);
              creditNotesEnqueued++;
            }
          }
        }
        if (orders.length < 100) break;
      }
      const creditNoteAfter = MIN_ORDER_DATE.toISOString().slice(0, 10) + 'T00:00:00+00:00';
      for (const falabellaStatus of ['canceled', 'returned']) {
        for (let offset = 0; offset < 3000; offset += 100) {
          const resp = await client.getOrdersV2({
            createdAfter: creditNoteAfter,
            limit: 100,
            offset,
            status: falabellaStatus,
          });
          const orders = normalizeGetOrdersResult(resp.data).orders || [];
          for (const order of orders) {
            const on = String(order?.OrderNumber || '').trim();
            if (!on || creditNoteKnown.has(on) || !invoiceKnown.has(on)) continue;
            const queued = await enqueueIfNeeded(company.id, on, 'cron', order.OrderId ? String(order.OrderId) : null, JOB_KIND_CREDIT_NOTE);
            if (queued.enqueued) {
              creditNoteKnown.add(on);
              creditNotesEnqueued++;
            }
          }
          if (orders.length < 100) break;
        }
      }
      const localCreditNotes = await enqueueLocalCreditNotes(company.id, creditNoteKnown);
      creditNotesEnqueued += localCreditNotes;
      if (enqueued || creditNotesEnqueued) {
        log(`cron ${company.nombre}: ${enqueued} comprobantes y ${creditNotesEnqueued} notas de crédito encolados`);
      }
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
      delayMs = Math.max(10_000, Math.min(60_000, cron.intervalMinutes * 60_000)); // en dev permite 10s; en prod sigue revisando como máximo cada minuto
    } catch (e) { log('cron tick error:', e.message); }
    setTimeout(tick, delayMs);
  };
  // Primer barrido a los 10s de arrancar (respeta cron.enabled dentro de reconcile).
  setTimeout(() => { lastRun = Date.now(); reconcile().catch(() => {}); setTimeout(tick, 60_000); }, 10_000);
}
