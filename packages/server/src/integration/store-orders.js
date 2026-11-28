import { ingestOrder, cancelExternalStoreOrder, OrderAlreadyShippedError } from '../order-management.js';
import { listOrderDocuments, syncOrderDocuments } from '../order-documents.js';
import { ProblemError, validationProblem } from './problems.js';
import { validateBillingInput } from './fiscal-id.js';
import { storeSettings } from './settings.js';
import {
  fiscalFingerprint,
  mapStoreOrderToIngest,
  validateStoreOrderPayload,
} from './store-order-payload.js';
import { enqueueCreditNoteCommand } from './document-jobs.js';

let corePromise;
function loadCore() {
  corePromise ||= import('@zentofact/core');
  return corePromise;
}

async function poolOf(db) {
  return db || (await loadCore()).pool;
}

export async function withTransaction(db, work) {
  const pool = await poolOf(db);
  if (typeof pool.connect !== 'function') return work(pool);
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export function normalizeIntegrationAccount(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    companyId: Number(row.company_id),
    channelCode: row.channel_code,
    displayName: row.display_name,
    documentRequirement: row.document_requirement,
    documentTypePolicy: row.document_type_policy,
    settings: row.settings || {},
    active: row.active,
    updatedAt: row.updated_at,
  };
}

export async function loadIntegrationAccount(db, accountId) {
  const result = await (await poolOf(db)).query(
    `select a.*, ch.code as channel_code
     from order_channel_accounts a join order_channels ch on ch.id=a.channel_id
     where a.id=$1`,
    [accountId],
  );
  return normalizeIntegrationAccount(result.rows[0]);
}

// ── Recurso Order del contrato ──

const FULFILLMENT_MAP = {
  pending: 'pending',
  preparing: 'confirmed',
  ready_to_ship: 'ready',
  shipped: 'shipped',
  delivered: 'delivered',
  returned: 'delivered',
  cancelled: 'cancelled',
  failed: 'cancelled',
};

export function contractFulfillmentStatus(row) {
  if (row.order_status === 'cancelled' || row.fulfillment_status === 'cancelled') return 'cancelled';
  return FULFILLMENT_MAP[row.fulfillment_status] || 'pending';
}

export function contractDocumentStatus(status, { voided = false } = {}) {
  const value = String(status || '').toUpperCase();
  if (value === 'ANULADO' || voided) return 'voided';
  if (value === 'ACEPTADO') return 'accepted';
  if (value === 'RECHAZADO') return 'rejected';
  return 'issued';
}

function iso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function documentKey(kind, id) {
  return `${kind}:${id}`;
}

export function parseDocumentKey(value) {
  const match = /^(boleta|factura|credit_note):(\d{1,12})$/.exec(String(value || '').trim());
  return match ? { kind: match[1], id: Number(match[2]) } : null;
}

/** Comprobantes del pedido en el formato del contrato (incluye notas de crédito). */
export async function storeOrderDocuments(db, orderRow) {
  const order = {
    id: Number(orderRow.id),
    companyId: Number(orderRow.company_id),
    externalOrderNumber: orderRow.external_order_number,
  };
  const docs = await listOrderDocuments(order, db);
  const creditNoteIds = docs.filter((doc) => doc.kind === 'credit_note').map((doc) => doc.id);
  const affects = new Map();
  if (creditNoteIds.length) {
    const rows = (await db.query(
      'select id, affected_boleta_id, affected_factura_id from credit_notes where id = any($1::int[])',
      [creditNoteIds],
    )).rows;
    for (const row of rows) {
      affects.set(Number(row.id), row.affected_boleta_id
        ? documentKey('boleta', row.affected_boleta_id)
        : row.affected_factura_id ? documentKey('factura', row.affected_factura_id) : null);
    }
  }
  const voided = new Set(docs
    .filter((doc) => doc.kind === 'credit_note' && doc.status === 'ACEPTADO')
    .map((doc) => affects.get(doc.id))
    .filter(Boolean));
  return docs
    .filter((doc) => doc.status !== 'REEMPLAZADO')
    .map((doc) => {
      const id = documentKey(doc.kind, doc.id);
      return {
        id,
        kind: doc.kind,
        number: doc.number,
        status: doc.kind === 'credit_note'
          ? contractDocumentStatus(doc.status === 'ANULADO' ? 'RECHAZADO' : doc.status)
          : contractDocumentStatus(doc.status, { voided: voided.has(id) }),
        issuedAt: doc.issuedAt || null,
        total: Number.isFinite(doc.total) ? Math.round(doc.total * 100) / 100 : null,
        affects: doc.kind === 'credit_note' ? affects.get(doc.id) || null : null,
        reason: doc.status === 'RECHAZADO' ? doc.reason || null : undefined,
      };
    })
    .map(({ reason, ...doc }) => (reason ? { ...doc, reason } : doc));
}

export async function toOrderResource(db, row) {
  const progress = row.metadata?.storeFulfillment || {};
  const documents = await storeOrderDocuments(db, row);
  return {
    externalId: row.external_order_id,
    orderNumber: row.external_order_number,
    zentofactId: Number(row.id),
    fulfillment: {
      status: contractFulfillmentStatus(row),
      confirmedAt: iso(progress.confirmedAt),
      readyAt: iso(progress.readyAt),
      shippedAt: iso(progress.shippedAt),
      deliveredAt: iso(progress.deliveredAt),
      carrier: progress.carrier || null,
      trackingNumber: progress.trackingNumber || null,
      trackingUrl: progress.trackingUrl || null,
    },
    documents: documents.map(({ reason: _reason, ...doc }) => doc),
    updatedAt: iso(row.updated_at),
  };
}

async function findOrderRow(db, accountId, externalId, { lock = false } = {}) {
  const result = await db.query(
    `select * from orders where channel_account_id=$1 and external_order_id=$2 ${lock ? 'for update' : ''}`,
    [accountId, externalId],
  );
  return result.rows[0] || null;
}

export async function getStoreOrderResource(account, externalId, db) {
  const pool = await poolOf(db);
  const row = await findOrderRow(pool, account.id, String(externalId || '').trim());
  if (!row) throw new ProblemError('not_found', 'Pedido no encontrado.');
  return toOrderResource(pool, row);
}

async function productIdsForSkus(db, skus) {
  const unique = [...new Set(skus.filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = (await db.query(
    'select id, main_sku from products where main_sku = any($1::text[])',
    [unique],
  )).rows;
  return new Map(rows.map((row) => [row.main_sku, Number(row.id)]));
}

async function hasActiveDocument(db, row) {
  if (['issued', 'accepted', 'rejected'].includes(row.document_status)) return true;
  const docs = await listOrderDocuments({
    id: Number(row.id),
    companyId: Number(row.company_id),
    externalOrderNumber: row.external_order_number,
  }, db);
  return docs.some((doc) => doc.kind !== 'credit_note' && !['REEMPLAZADO', 'ANULADO'].includes(doc.status));
}

/**
 * PUT /orders/{externalId}. Crea o actualiza un pedido de la tienda alrededor
 * de ingestOrder, preservando lo que es de Zentofact (avance de despacho,
 * comprobantes). Versionado por updatedAt.
 */
export async function upsertStoreOrder(account, externalIdInput, body, db) {
  const { errors, value } = validateStoreOrderPayload(body, externalIdInput);
  if (errors.length) throw validationProblem(errors);
  const settings = storeSettings(account);
  return withTransaction(db, async (client) => {
    // Bloquea primero por identidad para serializar PUTs concurrentes del mismo pedido.
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `store-order:${account.id}:${value.externalId}`,
    ]);
    const existing = await findOrderRow(client, account.id, value.externalId, { lock: true });
    if (existing?.provider_updated_at
      && new Date(value.updatedAt).getTime() < new Date(existing.provider_updated_at).getTime()) {
      throw new ProblemError('stale_update', 'El pedido ya tiene una versión más reciente.');
    }
    if (existing && existing.metadata?.integrationFiscalHash
      && existing.metadata.integrationFiscalHash !== fiscalFingerprint(value)
      && await hasActiveDocument(client, existing)) {
      throw new ProblemError(
        'document_already_issued',
        'El pedido ya tiene comprobante: no se pueden cambiar productos, montos ni datos fiscales.',
      );
    }
    const productIdsBySku = settings.skuFallback
      ? await productIdsForSkus(client, value.items.map((item) => item.sku))
      : new Map();
    const input = mapStoreOrderToIngest(value, {
      account: { ...account, settings: { ...account.settings, allowNegative: settings.allowNegative } },
      existing,
      productIdsBySku,
      rawPayload: body,
    });
    const result = await ingestOrder(input, client);
    if (result.skipped) throw new Error(`Pedido omitido: ${result.reason}`);
    const row = await findOrderRow(client, account.id, value.externalId);
    return {
      created: !existing,
      order: await toOrderResource(client, row),
      unmatchedSkus: await unmatchedSkus(client, row.id),
    };
  });
}

async function unmatchedSkus(db, orderId) {
  const rows = (await db.query(
    `select coalesce(sku, external_item_id) as sku from order_items
     where order_id=$1 and product_id is null order by id`,
    [orderId],
  )).rows;
  return rows.map((row) => row.sku);
}

/** POST /orders/{externalId}/cancel (la idempotencia la resuelve el llamador). */
export async function cancelStoreOrder(account, externalIdInput, body = {}, db) {
  const externalId = String(externalIdInput || '').trim();
  const reasons = ['customer_request', 'payment_issue', 'out_of_stock', 'other'];
  const reason = String(body?.reason || '').trim();
  if (!reasons.includes(reason)) {
    throw validationProblem([{ path: 'reason', message: `reason debe ser uno de: ${reasons.join(', ')}.` }]);
  }
  if (body?.note != null && typeof body.note !== 'string') {
    throw validationProblem([{ path: 'note', message: 'note debe ser texto.' }]);
  }
  const settings = storeSettings(account);
  return withTransaction(db, async (client) => {
    const row = await findOrderRow(client, account.id, externalId);
    if (!row) throw new ProblemError('not_found', 'Pedido no encontrado.');
    const wasCancelled = row.order_status === 'cancelled' || row.fulfillment_status === 'cancelled';
    try {
      await cancelExternalStoreOrder(row.id, { reason, note: body.note }, client);
    } catch (error) {
      if (error instanceof OrderAlreadyShippedError) {
        throw new ProblemError('order_already_shipped', 'El pedido ya salió del almacén; no lo canceles ni reembolses.');
      }
      throw error;
    }
    if (!wasCancelled && settings.creditNoteOnCancel === 'auto') {
      const fresh = await findOrderRow(client, account.id, externalId);
      await syncOrderDocuments({
        id: Number(fresh.id),
        companyId: Number(fresh.company_id),
        externalOrderNumber: fresh.external_order_number,
        documentStatus: fresh.document_status,
      }, client);
      if (await hasActiveDocument(client, fresh)) {
        await enqueueCreditNoteCommand(client, Number(fresh.id), { reason });
      }
    }
    const updated = await findOrderRow(client, account.id, externalId);
    return toOrderResource(client, updated);
  });
}

/**
 * Datos fiscales que el operador carga en un pedido de tienda antes de emitir
 * (modo a demanda). Solo pedidos del canal externo sin comprobante vigente.
 */
export async function updateExternalOrderBilling(orderIdInput, input = {}, { actorUserId = null, db } = {}) {
  const orderId = Number(orderIdInput);
  if (!Number.isInteger(orderId) || orderId <= 0) throw new Error('Pedido inválido.');
  return withTransaction(db, async (client) => {
    const row = (await client.query(
      `select o.*, ch.code as channel_code from orders o
       join order_channel_accounts a on a.id=o.channel_account_id
       join order_channels ch on ch.id=a.channel_id
       where o.id=$1 for update of o`,
      [orderId],
    )).rows[0];
    if (!row) return null;
    if (row.channel_code !== 'external') throw new Error('Solo los pedidos de la tienda web se completan aquí.');
    if (row.order_status === 'cancelled' || row.fulfillment_status === 'cancelled') {
      throw new Error('No se puede emitir un pedido cancelado.');
    }
    if (await hasActiveDocument(client, row)) throw new Error('El pedido ya tiene un comprobante.');
    const { errors, value } = validateBillingInput(input, { total: Number(row.total) });
    if (errors.length) {
      const error = new Error(errors.map((item) => item.message).join(' '));
      error.errors = errors;
      throw error;
    }
    const customerPatch = {
      documentType: value.documentType,
      documentNumber: value.documentNumber,
      legalName: value.name,
      address: value.address || null,
    };
    const updated = (await client.query(
      `update orders set customer = customer || $2::jsonb,
         requested_document_type = $3,
         document_status = case when document_status in ('not_requested', 'pending') then 'pending' else document_status end,
         updated_at = now()
       where id=$1 returning *`,
      [orderId, JSON.stringify(customerPatch), value.kind],
    )).rows[0];
    await client.query(
      `insert into order_events (order_id, event_type, source, actor_user_id, idempotency_key,
         previous_values, new_values, payload)
       values ($1, 'order.billing_updated', 'user', $2, $3, $4, $5, '{}'::jsonb)
       on conflict (order_id, idempotency_key) do nothing`,
      [
        orderId,
        actorUserId,
        `order.billing_updated:${orderId}:${Date.now()}`,
        JSON.stringify({ requestedDocumentType: row.requested_document_type, customer: row.customer }),
        JSON.stringify({ requestedDocumentType: value.kind, customer: customerPatch }),
      ],
    );
    return updated;
  });
}
