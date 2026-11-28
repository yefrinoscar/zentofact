// Trabajos de comprobante de pedidos de tienda, sobre order_commands:
//  - integration.credit_note: nota de crédito 01 (anulación) al cancelar.
//    Si el comprobante todavía no está aceptado, se difiere hasta que lo esté.
//  - integration.emit: emisión automática en modo "always" (pagado + pendiente).
// Cada comando se toma con FOR UPDATE SKIP LOCKED y un lease (locked_until).

import { getOrder } from '../order-management.js';
import {
  actOnOrderDocument,
  listOrderDocuments,
  orderBillingDefaults,
  prepareOrderEmission,
} from '../order-documents.js';
import { ANONYMOUS_BOLETA_MAX, ANONYMOUS_NAME } from './fiscal-id.js';

export const CREDIT_NOTE_COMMAND = 'integration.credit_note';
export const EMIT_COMMAND = 'integration.emit';
export const SYSTEM_ACTOR = 'sistema:integracion';
const LEASE_SECONDS = 300;
// La nota de crédito espera a que SUNAT acepte el comprobante hasta 10 días.
const CREDIT_NOTE_MAX_AGE_MS = 10 * 24 * 60 * 60 * 1000;
const EMIT_MAX_ATTEMPTS = 8;
const LIMA = 'America/Lima';

let corePromise;
function loadCore() {
  corePromise ||= import('@zentofact/core');
  return corePromise;
}

const log = (...args) => console.log('[integracion:comprobantes]', ...args);

export async function enqueueCreditNoteCommand(db, orderId, payload = {}) {
  await db.query(
    `insert into order_commands (order_id, command_type, idempotency_key, status, requested_by, request_payload)
     values ($1, $2, $3, 'pending', $4, $5)
     on conflict (order_id, idempotency_key) do nothing`,
    [orderId, CREDIT_NOTE_COMMAND, `credit_note:${orderId}`, SYSTEM_ACTOR, JSON.stringify(payload)],
  );
}

export function retryDelaySeconds(attempts) {
  return Math.min(60 * 60, 30 * (2 ** Math.max(0, Number(attempts || 1) - 1)));
}

export function limaDate(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: LIMA }).format(new Date(value));
}

// Errores que no se arreglan reintentando: faltan datos o el pedido no cuadra.
const PERMANENT_ERROR_RE = /(requiere|inválid|ingresa|selecciona|no se puede emitir|sincroniza|cancelado|deshabilitada|no corresponde|mayores a s\/)/i;
const ALREADY_HAS_DOCUMENT_RE = /ya tiene (un )?comprobante/i;

export function classifyEmissionError(error) {
  const message = String(error?.message || error || '');
  if (ALREADY_HAS_DOCUMENT_RE.test(message)) return 'reconcile';
  if (PERMANENT_ERROR_RE.test(message)) return 'permanent';
  return 'transient';
}

async function claimCommands(pool, commandType, limit) {
  const result = await pool.query(
    `update order_commands c set status='processing', attempts=c.attempts + 1,
       locked_until=now() + ($3::int * interval '1 second'), updated_at=now()
     where c.id in (
       select id from order_commands
       where command_type=$1
         and status in ('pending', 'processing')
         and next_attempt_at <= now()
         and (locked_until is null or locked_until < now())
       order by next_attempt_at, id
       limit $2
       for update skip locked
     )
     returning c.*`,
    [commandType, limit, LEASE_SECONDS],
  );
  return result.rows;
}

async function finishCommand(pool, id, { status, error = null, response = {}, delaySeconds = 0 }) {
  await pool.query(
    `update order_commands set status=$2, last_error=$3, error=$3,
       response_payload=$4, locked_until=null,
       next_attempt_at=now() + ($5::int * interval '1 second'),
       processed_at=case when $2 in ('succeeded', 'failed') then now() else processed_at end,
       updated_at=now()
     where id=$1`,
    [id, status, error, JSON.stringify(response), delaySeconds],
  );
}

async function linkCreditNote(pool, orderId, creditNoteId) {
  await pool.query(
    `insert into order_documents (order_id, document_kind, credit_note_id)
     values ($1, 'credit_note', $2) on conflict do nothing`,
    [orderId, creditNoteId],
  );
}

async function existingCreditNote(pool, doc) {
  const column = doc.kind === 'factura' ? 'affected_factura_id' : 'affected_boleta_id';
  return (await pool.query(
    `select id, estado_sunat from credit_notes where ${column}=$1 order by id desc limit 1`,
    [doc.id],
  )).rows[0] || null;
}

/** Procesa un comando de nota de crédito. Devuelve el resultado para finishCommand. */
export async function processCreditNoteCommand(command, deps = {}) {
  const core = deps.core || await loadCore();
  const pool = deps.db || core.pool;
  const orderId = Number(command.order_id);
  const order = (await pool.query('select id, company_id, external_order_number, created_at from orders where id=$1', [orderId])).rows[0];
  if (!order) return { status: 'failed', error: 'Pedido no encontrado.' };
  const docs = await listOrderDocuments({
    id: orderId, companyId: Number(order.company_id), externalOrderNumber: order.external_order_number,
  }, pool);
  const active = docs.find((doc) => doc.kind !== 'credit_note' && !['REEMPLAZADO', 'ANULADO'].includes(doc.status));
  if (!active) return { status: 'succeeded', response: { skipped: 'sin comprobante vigente' } };
  if (active.status === 'RECHAZADO') {
    return { status: 'succeeded', response: { skipped: 'comprobante rechazado: no requiere nota de crédito' } };
  }
  const existing = await existingCreditNote(pool, active);
  if (existing) {
    await linkCreditNote(pool, orderId, existing.id);
    if (String(existing.estado_sunat).toUpperCase() === 'ACEPTADO') {
      return { status: 'succeeded', response: { creditNoteId: Number(existing.id), linked: true } };
    }
    // La nota existe pero SUNAT no la confirmó: se reconcilia, nunca se crea otra.
    const refreshed = await core.refreshCreditNoteStatus(Number(existing.id)).catch((error) => ({ error: error.message }));
    return {
      status: 'pending',
      delaySeconds: 15 * 60,
      error: refreshed?.error || 'Nota de crédito pendiente de confirmación SUNAT.',
      response: { creditNoteId: Number(existing.id) },
    };
  }
  if (active.status !== 'ACEPTADO') {
    const age = Date.now() - new Date(command.created_at).getTime();
    if (age > CREDIT_NOTE_MAX_AGE_MS) {
      return { status: 'failed', error: `El comprobante ${active.number} no fue aceptado a tiempo; emite la nota de crédito a mano.` };
    }
    return { status: 'pending', delaySeconds: 10 * 60, error: `Esperando aceptación SUNAT de ${active.number}.` };
  }
  const options = { codMotivo: '01', desMotivo: 'ANULACION DE LA OPERACION', usuarioCreacion: SYSTEM_ACTOR };
  const outcome = active.kind === 'factura'
    ? await core.createAndSendCreditNoteFromFactura(active.id, options)
    : await core.createAndSendCreditNoteFromBoleta(active.id, options);
  if (outcome?.creditNoteId && !outcome.rejected) await linkCreditNote(pool, orderId, outcome.creditNoteId);
  if (outcome?.success) return { status: 'succeeded', response: { creditNoteId: outcome.creditNoteId } };
  if (outcome?.rejected) {
    return { status: 'pending', delaySeconds: 30 * 60, error: outcome.error?.message || 'SUNAT rechazó la nota de crédito.' };
  }
  return {
    status: 'pending',
    delaySeconds: 15 * 60,
    error: outcome?.error?.message || 'Nota de crédito sin confirmar.',
    response: { creditNoteId: outcome?.creditNoteId || null },
  };
}

// ── Emisión automática (modo "always") ──

export async function enqueueAlwaysEmissions(pool) {
  const result = await pool.query(
    `insert into order_commands (order_id, command_type, idempotency_key, status, requested_by)
     select o.id, $1, 'emit:' || o.id, 'pending', $2
     from orders o
     join order_channel_accounts a on a.id=o.channel_account_id
     where a.active
       and a.settings->>'integration' = 'true'
       and a.settings->>'issuanceMode' = 'always'
       and o.payment_status='paid'
       and o.document_status='pending'
       and o.items_status='complete'
       and o.order_status not in ('cancelled', 'failed')
       and o.fulfillment_status not in ('cancelled', 'returned', 'failed')
     on conflict (order_id, idempotency_key) do nothing
     returning id`,
    [EMIT_COMMAND, SYSTEM_ACTOR],
  );
  return result.rowCount;
}

/** Datos del cliente para emitir sin operador: boleta anónima si no hay datos y cabe en el tope. */
export function automaticEmissionInput(order, defaults) {
  const customer = order.customer || {};
  const hasFiscalData = Boolean(String(customer.documentNumber || '').trim());
  if (defaults.kind === 'boleta' && !hasFiscalData) {
    if (Number(order.total) > ANONYMOUS_BOLETA_MAX) {
      const error = new Error(`Las boletas mayores a S/ ${ANONYMOUS_BOLETA_MAX} requieren identificar al cliente.`);
      error.needsCustomerData = true;
      throw error;
    }
    return { ...defaults, client: { documentType: '0', documentNumber: '', name: ANONYMOUS_NAME, address: '' } };
  }
  return defaults;
}

export async function processEmitCommand(command, deps = {}) {
  const core = deps.core || await loadCore();
  const pool = deps.db || core.pool;
  const act = deps.actOnOrderDocument || actOnOrderDocument;
  const order = await getOrder(Number(command.order_id), pool);
  if (!order) return { status: 'failed', error: 'Pedido no encontrado.' };
  if (order.orderStatus === 'cancelled' || ['cancelled', 'returned', 'failed'].includes(order.fulfillmentStatus)) {
    return { status: 'succeeded', response: { skipped: 'pedido cancelado' } };
  }
  const active = order.documents.find((doc) => doc.kind !== 'credit_note' && !['REEMPLAZADO', 'ANULADO'].includes(doc.status));
  if (active) return { status: 'succeeded', response: { documentId: active.id, existing: true } };
  try {
    const prepared = deps.prepareOrderEmission
      ? await deps.prepareOrderEmission(order)
      : await prepareOrderEmission(order, core);
    const input = automaticEmissionInput(order, { ...orderBillingDefaults(order), ...prepared });
    const paidAt = order.metadata?.paidAt;
    const result = await act(order.id, 'emit', { ...input, issueDate: paidAt ? limaDate(paidAt) : undefined }, SYSTEM_ACTOR, core);
    return { status: 'succeeded', response: { documentId: result?.documentId || null, numero: result?.numeroCompleto || null } };
  } catch (error) {
    const kind = classifyEmissionError(error);
    if (kind === 'reconcile') {
      const docs = await listOrderDocuments(order, pool);
      const doc = docs.find((item) => item.kind !== 'credit_note' && !['REEMPLAZADO', 'ANULADO'].includes(item.status));
      if (doc) await act(order.id, 'refresh', { kind: doc.kind, documentId: doc.id }, SYSTEM_ACTOR, core).catch(() => {});
      return { status: 'succeeded', response: { reconciled: true, documentId: doc?.id || null } };
    }
    if (kind === 'permanent' || error?.needsCustomerData) {
      if (error?.needsCustomerData) {
        await pool.query(
          `update orders set metadata = metadata || '{"needsCustomerData": true}'::jsonb, updated_at=now() where id=$1`,
          [order.id],
        );
      }
      return { status: 'failed', error: String(error.message || error), alert: true };
    }
    if (Number(command.attempts) >= EMIT_MAX_ATTEMPTS) {
      return { status: 'failed', error: String(error.message || error), alert: true };
    }
    return {
      status: 'pending',
      delaySeconds: retryDelaySeconds(command.attempts),
      error: String(error.message || error),
      alert: Number(command.attempts) >= 3,
    };
  }
}

async function alertCommand(command, outcome, deps) {
  try {
    const { notifyFailedEmissionIfNeeded } = await import('../auto-emission-alert.js');
    const { sendEmail } = await import('../mailer.js');
    const { listUsers } = await import('../users.js');
    const order = (await deps.pool.query('select external_order_number from orders where id=$1', [command.order_id])).rows[0];
    await notifyFailedEmissionIfNeeded({
      id: command.id,
      kind: 'invoice',
      attempts: Math.max(3, Number(command.attempts || 0)),
      orderNumber: order?.external_order_number,
      companyName: 'Tienda web',
      lastError: outcome.error,
      status: outcome.status,
      alerted_at: command.response_payload?.alertedAt || null,
    }, {
      sendEmail,
      listUsers,
      configuredEmails: process.env.AUTO_EMIT_ALERT_EMAIL,
      fallbackEmail: process.env.ADMIN_EMAIL,
      log,
      markAlerted: () => { outcome.response = { ...(outcome.response || {}), alertedAt: new Date().toISOString() }; },
    });
  } catch (error) {
    log('aviso de emisión error:', error?.message || error);
  }
}

export async function processDocumentCommands({ limit = 5, ...deps } = {}) {
  const core = deps.core || await loadCore();
  const pool = deps.db || core.pool;
  const stats = { creditNotes: 0, emissions: 0 };
  for (const [type, handler] of [[CREDIT_NOTE_COMMAND, processCreditNoteCommand], [EMIT_COMMAND, processEmitCommand]]) {
    const commands = await claimCommands(pool, type, limit);
    for (const command of commands) {
      let outcome;
      try {
        outcome = await handler(command, { ...deps, core, db: pool });
      } catch (error) {
        outcome = { status: 'pending', delaySeconds: retryDelaySeconds(command.attempts), error: String(error?.message || error) };
      }
      if (outcome.alert) await alertCommand(command, outcome, { pool });
      await finishCommand(pool, command.id, {
        status: outcome.status,
        error: outcome.error || null,
        response: { ...(command.response_payload || {}), ...(outcome.response || {}) },
        delaySeconds: outcome.delaySeconds || 0,
      });
      if (type === CREDIT_NOTE_COMMAND) stats.creditNotes += 1;
      else stats.emissions += 1;
      if (deps.onProcessed) await deps.onProcessed(command, outcome);
    }
  }
  return stats;
}
