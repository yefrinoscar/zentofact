import { FalabellaApiClient, getFalabellaError, normalizeGetOrdersResult } from '@zentofact/falabella-api';

const PAGE_SIZE = 100;
const MAX_PAGES = 1000;
const OVERLAP_MS = 10 * 60_000;
const SAFETY_LAG_MS = 60_000;
const LOCK_NAMESPACE = 0x46414c41; // "FALA"
let corePromise;

function loadCore() {
  corePromise ||= import('@zentofact/core');
  return corePromise;
}

export function normalizeFalabellaStatus(statuses) {
  const visit = (value) => {
    if (value == null) return [];
    if (typeof value === 'string' || typeof value === 'number') return [String(value)];
    if (Array.isArray(value)) return value.flatMap(visit);
    if (typeof value === 'object') {
      if ('Status' in value) return visit(value.Status);
      if ('status' in value) return visit(value.status);
      if ('Name' in value) return visit(value.Name);
      if ('name' in value) return visit(value.name);
    }
    return [];
  };
  return visit(statuses).map((value) => value.trim()).filter(Boolean).join('|').toLowerCase();
}

export function normalizeFalabellaOrder(order) {
  const raw = order?.Order && typeof order.Order === 'object' ? order.Order : order;
  const orderNumber = String(raw?.OrderNumber || '').trim();
  const orderId = String(raw?.OrderId || orderNumber).trim();
  if (!orderNumber || !orderId) return null;
  const amount = Number(String(raw?.GrandTotal ?? raw?.Price ?? '').replace(/,/g, ''));
  const invoiceValue = raw?.InvoiceRequired;
  return {
    orderId,
    orderNumber,
    falabellaCreatedAt: validDate(raw?.CreatedAt),
    falabellaUpdatedAt: validDate(raw?.UpdatedAt),
    status: normalizeFalabellaStatus(raw?.Statuses),
    invoiceRequired: invoiceValue === true || invoiceValue === 1 || String(invoiceValue).toLowerCase() === 'true' || String(invoiceValue) === '1',
    grandTotal: Number.isFinite(amount) ? amount : null,
    currency: String(raw?.Currency || raw?.CurrencyCode || 'PEN').trim() || 'PEN',
    raw,
  };
}

function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function monthWindow(month) {
  const match = String(month || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) throw new Error('Mes inválido; usa YYYY-MM.');
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) throw new Error('Mes inválido; usa YYYY-MM.');
  return {
    from: new Date(Date.UTC(year, monthIndex, 1)),
    to: new Date(Date.UTC(year, monthIndex + 1, 1)),
  };
}

export async function fetchFalabellaPages(client, filters, onPage, pageSize = PAGE_SIZE) {
  let pages = 0;
  let received = 0;
  let completed = false;
  for (let offset = 0; pages < MAX_PAGES; offset += pageSize) {
    const response = await client.getOrdersV2({ ...filters, limit: pageSize, offset });
    const apiError = getFalabellaError(response.data);
    if (apiError) {
      throw new Error(apiError.Head?.ErrorMessage || apiError.Head?.ErrorCode || 'Falabella devolvió un error.');
    }
    if (!response.ok) throw new Error(`Falabella respondió HTTP ${response.status}.`);
    const orders = normalizeGetOrdersResult(response.data).orders || [];
    pages += 1;
    received += orders.length;
    await onPage(orders, { page: pages, offset });
    if (orders.length < pageSize) {
      completed = true;
      break;
    }
  }
  if (!completed) throw new Error('La sincronización excedió el límite seguro de páginas.');
  return { pages, received };
}

async function upsertOrders(db, companyId, orders) {
  let upserted = 0;
  for (const order of orders) {
    const normalized = normalizeFalabellaOrder(order);
    if (!normalized) continue;
    await db.query(
      `insert into falabella_orders (
         company_id, order_id, order_number, falabella_created_at, falabella_updated_at,
         status, invoice_required, grand_total, currency, raw_data,
         first_seen_at, last_seen_at, synchronized_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),now(),now())
       on conflict (company_id, order_number) do update set
         order_id=excluded.order_id,
         falabella_created_at=coalesce(excluded.falabella_created_at, falabella_orders.falabella_created_at),
         falabella_updated_at=coalesce(excluded.falabella_updated_at, falabella_orders.falabella_updated_at),
         status=excluded.status,
         invoice_required=excluded.invoice_required,
         grand_total=excluded.grand_total,
         currency=excluded.currency,
         raw_data=excluded.raw_data,
         last_seen_at=now(), synchronized_at=now()`,
      [companyId, normalized.orderId, normalized.orderNumber, normalized.falabellaCreatedAt,
        normalized.falabellaUpdatedAt, normalized.status, normalized.invoiceRequired,
        normalized.grandTotal, normalized.currency, JSON.stringify(normalized.raw)],
    );
    upserted += 1;
  }
  return upserted;
}

async function ensureState(db, companyId) {
  await db.query(
    `insert into falabella_sync_state (company_id, initial_sync_from)
     values ($1, (current_date - interval '12 months')::date)
     on conflict (company_id) do nothing`,
    [companyId],
  );
  return (await db.query('select * from falabella_sync_state where company_id=$1', [companyId])).rows[0];
}

function clientFor(company) {
  return new FalabellaApiClient({
    userId: company.falabellaApiUserId,
    apiKey: company.falabellaApiKey,
    version: '2.0',
    defaultFormat: 'JSON',
  });
}

export async function syncFalabellaOrders(companyId, options = {}, dependencies = {}) {
  const core = dependencies.pool && dependencies.getCompany ? null : await loadCore();
  const dbPool = dependencies.pool || core.pool;
  const loadCompany = dependencies.getCompany || core.getCompany;
  const makeClient = dependencies.clientFor || clientFor;
  const db = await dbPool.connect();
  let locked = false;
  let runId = null;
  const mode = options.mode === 'month' ? 'month' : 'incremental';
  try {
    const lock = await db.query('select pg_try_advisory_lock($1,$2) as locked', [LOCK_NAMESPACE, Number(companyId)]);
    locked = lock.rows[0]?.locked === true;
    if (!locked) return { status: 'already_running', companyId: Number(companyId) };

    const company = await loadCompany(Number(companyId));
    if (!company?.activo) throw new Error('Empresa no encontrada o inactiva.');
    if (!company.falabellaApiUserId?.trim() || !company.falabellaApiKey?.trim()) {
      throw new Error('La empresa no tiene credenciales de Falabella API configuradas.');
    }

    const state = await ensureState(db, companyId);
    const now = options.now ? new Date(options.now) : new Date();
    let windowFrom;
    let windowTo;
    let filters;
    if (mode === 'month') {
      ({ from: windowFrom, to: windowTo } = monthWindow(options.month));
      filters = { createdAfter: windowFrom.toISOString(), createdBefore: new Date(windowTo.getTime() - 1).toISOString(), sortDirection: 'ASC' };
    } else {
      windowTo = new Date(now.getTime() - SAFETY_LAG_MS);
      const cursor = state.cursor_updated_at ? new Date(state.cursor_updated_at) : new Date(now.getTime() - 31 * 86_400_000);
      windowFrom = new Date(cursor.getTime() - OVERLAP_MS);
      if (windowFrom >= windowTo) return { status: 'success', skipped: 'already_current', sync: await getFalabellaSyncStatus(companyId, db) };
      filters = { updatedAfter: windowFrom.toISOString(), updatedBefore: windowTo.toISOString(), sortDirection: 'ASC' };
    }

    const run = await db.query(
      `insert into falabella_sync_runs (company_id, mode, status, window_from, window_to)
       values ($1,$2,'running',$3,$4) returning id`,
      [companyId, mode, windowFrom.toISOString(), windowTo.toISOString()],
    );
    runId = run.rows[0].id;
    await db.query(
      `update falabella_sync_state set status='running', last_attempt_at=now(), last_started_at=now(),
       last_error=null, updated_at=now() where company_id=$1`,
      [companyId],
    );

    let upserted = 0;
    const stats = await fetchFalabellaPages(makeClient(company), filters, async (orders) => {
      upserted += await upsertOrders(db, companyId, orders);
    });

    await db.query(
      `update falabella_sync_runs set status='success', pages_processed=$2, orders_received=$3,
       orders_upserted=$4, finished_at=now() where id=$1`,
      [runId, stats.pages, stats.received, upserted],
    );
    await db.query(
      `update falabella_sync_state set status='success', last_finished_at=now(),
       last_successful_sync_at=now(), last_error=null, last_pages_processed=$2,
       last_orders_received=$3, last_orders_upserted=$4,
       cursor_updated_at=case when $5='incremental' then $6 else cursor_updated_at end,
       updated_at=now() where company_id=$1`,
      [companyId, stats.pages, stats.received, upserted, mode, windowTo.toISOString()],
    );
    if (mode === 'month') {
      await db.query(
        `insert into falabella_sync_windows (company_id, month, last_successful_sync_at, orders_received)
         values ($1,$2,now(),$3)
         on conflict (company_id, month) do update set
           last_successful_sync_at=now(), orders_received=excluded.orders_received`,
        [companyId, options.month, stats.received],
      );
    }
    return { status: 'success', runId, mode, ...stats, upserted, sync: await getFalabellaSyncStatus(companyId, db) };
  } catch (error) {
    const message = String(error?.message || error).slice(0, 2000);
    if (runId) await db.query(
      `update falabella_sync_runs set status='error', error=$2, finished_at=now() where id=$1`,
      [runId, message],
    ).catch(() => {});
    await db.query(
      `update falabella_sync_state set status='error', last_finished_at=now(), last_error=$2, updated_at=now()
       where company_id=$1`,
      [companyId, message],
    ).catch(() => {});
    throw error;
  } finally {
    if (locked) await db.query('select pg_advisory_unlock($1,$2)', [LOCK_NAMESPACE, Number(companyId)]).catch(() => {});
    db.release();
  }
}

export async function upsertFalabellaWebhookOrder(companyId, order, db) {
  const target = db || (await loadCore()).pool;
  return upsertOrders(target, Number(companyId), [order]);
}

export async function getFalabellaSyncStatus(companyId, db) {
  const target = db || (await loadCore()).pool;
  const result = await target.query(
    `select company_id, enabled, status, full_sync_completed, initial_sync_from,
       backfill_cursor_date, cursor_updated_at, last_attempt_at, last_started_at,
       last_finished_at, last_successful_sync_at, last_error, last_pages_processed,
       last_orders_received, last_orders_upserted, sync_interval_minutes
     from falabella_sync_state where company_id=$1`,
    [companyId],
  );
  const row = result.rows[0] || null;
  if (!row) return null;
  return {
    companyId: row.company_id,
    enabled: row.enabled,
    status: row.status,
    fullSyncCompleted: row.full_sync_completed,
    initialSyncFrom: row.initial_sync_from,
    backfillCursorDate: row.backfill_cursor_date,
    dataUpdatedThrough: row.cursor_updated_at,
    lastAttemptAt: row.last_attempt_at,
    lastStartedAt: row.last_started_at,
    lastFinishedAt: row.last_finished_at,
    lastSuccessfulSyncAt: row.last_successful_sync_at,
    lastError: row.last_error,
    pagesProcessed: row.last_pages_processed,
    ordersReceived: row.last_orders_received,
    ordersUpserted: row.last_orders_upserted,
    syncIntervalMinutes: row.sync_interval_minutes,
  };
}

function documentFromRow(row) {
  const options = [];
  const boleta = row.boleta_id ? {
    id: row.boleta_id, numeroCompleto: row.boleta_numero, fechaEmision: row.boleta_fecha,
    pdfPath: row.boleta_pdf, xmlPath: row.boleta_xml, cdrPath: row.boleta_cdr,
    estadoSunat: row.boleta_estado, respuestaSunat: row.boleta_respuesta || '',
    canUploadPdf: String(row.boleta_estado).toUpperCase() === 'ACEPTADO', uploadBlockedReason: '',
  } : null;
  const factura = row.factura_id ? {
    id: row.factura_id, numeroCompleto: row.factura_numero, fechaEmision: row.factura_fecha,
    pdfPath: row.factura_pdf, xmlPath: row.factura_xml, cdrPath: row.factura_cdr,
    estadoSunat: row.factura_estado, respuestaSunat: row.factura_respuesta || '',
    canUploadPdf: String(row.factura_estado).toUpperCase() === 'ACEPTADO', uploadBlockedReason: '',
  } : null;
  const creditNote = row.credit_note_id ? {
    id: row.credit_note_id, numeroCompleto: row.credit_note_numero, fechaEmision: row.credit_note_fecha,
    pdfPath: row.credit_note_pdf, estadoSunat: row.credit_note_estado,
    respuestaSunat: row.credit_note_respuesta || '',
  } : null;
  if (boleta) options.push({ kind: 'BOLETA', source: 'local_boleta', boletaId: boleta.id, invoiceNumber: boleta.numeroCompleto, invoiceDate: boleta.fechaEmision, invoiceType: 'BOLETA', ...boleta });
  if (factura) options.push({ kind: 'FACTURA', source: 'local_factura', facturaId: factura.id, invoiceNumber: factura.numeroCompleto, invoiceDate: factura.fechaEmision, invoiceType: 'FACTURA', ...factura });
  if (creditNote) options.push({ kind: 'NOTA_DE_CREDITO', source: 'local_credit_note', creditNoteId: creditNote.id, invoiceNumber: creditNote.numeroCompleto, invoiceDate: creditNote.fechaEmision, invoiceType: 'NOTA_DE_CREDITO', ...creditNote });
  if (!factura) options.push({ kind: 'FACTURA', source: 'manual', invoiceNumber: '', invoiceDate: '', invoiceType: 'FACTURA' });
  return { orderNumber: row.order_number, boleta, factura, creditNote, options, defaultKind: boleta ? 'BOLETA' : factura ? 'FACTURA' : creditNote ? 'NOTA_DE_CREDITO' : 'FACTURA' };
}

export async function listLocalFalabellaOrders(companyId, filters = {}, db) {
  const target = db || (await loadCore()).pool;
  const limit = Math.min(Math.max(Number(filters.limit || 100), 1), 1000);
  const offset = Math.max(Number(filters.offset || 0), 0);
  const values = [Number(companyId)];
  const where = ['fo.company_id=$1'];
  if (filters.createdAfter) { values.push(filters.createdAfter); where.push(`fo.falabella_created_at >= $${values.length}`); }
  if (filters.createdBefore) { values.push(filters.createdBefore); where.push(`fo.falabella_created_at <= $${values.length}`); }
  values.push(limit, offset);
  const query = await target.query(
    `select fo.order_number, fo.raw_data,
       b.id boleta_id, b.numero_completo boleta_numero, b.fecha_emision boleta_fecha,
       b.pdf_path boleta_pdf, b.xml_path boleta_xml, b.cdr_path boleta_cdr,
       b.estado_sunat boleta_estado, b.respuesta_sunat boleta_respuesta,
       f.id factura_id, f.numero_completo factura_numero, f.fecha_emision factura_fecha,
       f.pdf_path factura_pdf, f.xml_path factura_xml, f.cdr_path factura_cdr,
       f.estado_sunat factura_estado, f.respuesta_sunat factura_respuesta,
       cn.id credit_note_id, cn.numero_completo credit_note_numero, cn.fecha_emision credit_note_fecha,
       cn.pdf_path credit_note_pdf, cn.estado_sunat credit_note_estado, cn.respuesta_sunat credit_note_respuesta,
       count(*) over()::int total_count
     from falabella_orders fo
     left join lateral (select * from boletas where company_id=fo.company_id and order_number=fo.order_number order by id desc limit 1) b on true
     left join lateral (select * from facturas where company_id=fo.company_id and order_number=fo.order_number order by id desc limit 1) f on true
     left join lateral (
       select cn.* from credit_notes cn join boletas ab on ab.id=cn.affected_boleta_id
       where cn.company_id=fo.company_id and ab.order_number=fo.order_number order by cn.id desc limit 1
     ) cn on true
     where ${where.join(' and ')}
     order by fo.falabella_created_at desc nulls last
     limit $${values.length - 1} offset $${values.length}`,
    values,
  );
  const orders = query.rows.map((row) => ({ ...row.raw_data, __resolved: documentFromRow(row) }));
  const month = String(filters.createdAfter || '').slice(0, 7);
  const coverage = /^\d{4}-\d{2}$/.test(month)
    ? (await target.query('select last_successful_sync_at, orders_received from falabella_sync_windows where company_id=$1 and month=$2', [companyId, month])).rows[0] || null
    : null;
  return { orders, totalCount: query.rows[0]?.total_count || 0, sync: await getFalabellaSyncStatus(companyId, target), coverage, source: 'postgres' };
}

export function startFalabellaSyncScheduler() {
  if (String(process.env.FALABELLA_SYNC_ENABLED || 'true').toLowerCase() === 'false') return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { listCompanies } = await loadCore();
      const companies = (await listCompanies()).filter((company) => company.activo && company.falabellaApiUserId?.trim() && company.falabellaApiKey?.trim());
      for (const company of companies) {
        const state = await getFalabellaSyncStatus(company.id);
        if (!state?.enabled) continue;
        const last = state.lastSuccessfulSyncAt ? new Date(state.lastSuccessfulSyncAt).getTime() : 0;
        const interval = Math.max(1, Number(state.syncIntervalMinutes || 30)) * 60_000;
        if (Date.now() - last >= interval) await syncFalabellaOrders(company.id).catch((error) => console.error('[FALABELLA SYNC]', company.id, error.message));
      }
    } finally { running = false; }
  };
  setTimeout(() => { tick().catch(() => {}); }, 30_000);
  setInterval(() => { tick().catch(() => {}); }, 60_000);
}
