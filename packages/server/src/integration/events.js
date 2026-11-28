// Outbox de la API de integración. Los cambios de estado del pedido los
// inserta el trigger de orders (migrate.ts). Aquí viven los eventos que no se
// ven en orders: comprobantes (aceptación asíncrona de SUNAT, notas de crédito)
// e inventario.

import { syncOrderDocuments } from '../order-documents.js';
import { storeOrderDocuments, withTransaction } from './store-orders.js';

let corePromise;
function loadCore() {
  corePromise ||= import('@zentofact/core');
  return corePromise;
}

export async function emitIntegrationEvent(db, { accountId, type, orderId = null, externalId = null, payload = {} }) {
  const result = await db.query(
    'select integration_emit_event($1, $2, $3, $4, $5::jsonb) as id',
    [accountId, type, orderId, externalId, JSON.stringify(payload)],
  );
  return Number(result.rows[0].id);
}

/**
 * Compara los comprobantes de un pedido con el último estado publicado y
 * devuelve los eventos document.* que corresponden. Puro: se prueba sin BD.
 */
export function documentTransitions(documents, previous) {
  const events = [];
  const states = [];
  for (const doc of documents) {
    const before = previous.get(doc.id) || null;
    if (doc.kind === 'credit_note') {
      if (before !== doc.status) states.push({ key: doc.id, status: doc.status });
      if (doc.status === 'accepted' && before !== 'accepted' && doc.cancels && doc.affects) {
        events.push({
          type: 'document.voided',
          data: { documentId: doc.affects, creditNoteId: doc.id, number: doc.number },
        });
      }
      continue;
    }
    if (before === doc.status) continue;
    states.push({ key: doc.id, status: doc.status });
    const base = { documentId: doc.id, kind: doc.kind, number: doc.number };
    if (!before) events.push({ type: 'document.issued', data: base });
    if (doc.status === 'accepted' && before !== 'accepted') events.push({ type: 'document.accepted', data: base });
    if (doc.status === 'rejected') events.push({ type: 'document.rejected', data: { ...base, reason: doc.reason || null } });
    // voided lo publica la nota de crédito (trae creditNoteId); aquí solo se guarda el estado.
  }
  return { events, states };
}

/** Re-sincroniza los comprobantes de un pedido de integración y publica sus cambios. */
async function publishOrderDocuments(db, orderRow) {
  await syncOrderDocuments({
    id: Number(orderRow.id),
    companyId: Number(orderRow.company_id),
    externalOrderNumber: orderRow.external_order_number,
    documentStatus: orderRow.document_status,
  }, db);
  await db.query(
    `insert into order_documents (order_id, document_kind, credit_note_id)
     select od.order_id, 'credit_note', cn.id
     from order_documents od join credit_notes cn
       on cn.affected_boleta_id=od.boleta_id or cn.affected_factura_id=od.factura_id
     where od.order_id=$1 on conflict do nothing`,
    [orderRow.id],
  );
  const documents = await storeOrderDocuments(db, orderRow);
  const previousRows = (await db.query(
    'select document_key, status from integration_document_state where order_id=$1',
    [orderRow.id],
  )).rows;
  const previous = new Map(previousRows.map((row) => [row.document_key, row.status]));
  const { events, states } = documentTransitions(documents, previous);
  for (const state of states) {
    await db.query(
      `insert into integration_document_state (order_id, document_key, status) values ($1,$2,$3)
       on conflict (order_id, document_key) do update set status=excluded.status, updated_at=now()`,
      [orderRow.id, state.key, state.status],
    );
  }
  for (const event of events) {
    await emitIntegrationEvent(db, {
      accountId: Number(orderRow.channel_account_id),
      type: event.type,
      orderId: Number(orderRow.id),
      externalId: orderRow.external_order_id,
      payload: { orderNumber: orderRow.external_order_number, ...event.data },
    });
  }
  return events;
}

export function reconcileOrderDocuments(pool, orderId) {
  return withTransaction(pool, async (db) => {
    const row = (await db.query(
      `select o.* from orders o join order_channel_accounts a on a.id=o.channel_account_id
       where o.id=$1 and a.active and a.settings->>'integration' = 'true' for update of o`,
      [orderId],
    )).rows[0];
    return row ? publishOrderDocuments(db, row) : [];
  });
}

// Volvemos a revisar los comprobantes por orden de última consulta, incluidos
// los que SUNAT aceptó antes de su primer evento.
export async function reconcileIntegrationDocuments({ db, limit = 50 } = {}) {
  const pool = db || (await loadCore()).pool;
  const rows = (await pool.query(
    `select o.id from orders o
     join order_channel_accounts a on a.id=o.channel_account_id
     left join integration_document_checks c on c.order_id=o.id
     where a.active and a.settings->>'integration' = 'true'
       and (
         o.document_status in ('pending', 'issued', 'rejected')
         or (
           o.document_status = 'accepted' and (
             o.updated_at >= now() - interval '60 days'
             or not exists (select 1 from integration_document_state s where s.order_id=o.id)
           )
         )
         or exists (
           select 1 from order_commands cmd
           where cmd.order_id=o.id and cmd.command_type='integration.credit_note'
             and (cmd.status in ('pending', 'processing') or cmd.processed_at >= now() - interval '1 day')
         )
         or exists (
           select 1 from integration_document_state s
           where s.order_id=o.id and s.status not in ('accepted', 'voided')
         )
       )
     order by coalesce(c.checked_at, o.created_at), o.id
     limit $1`,
    [limit],
  )).rows;
  let published = 0;
  for (const { id } of rows) {
    try {
      published += (await reconcileOrderDocuments(pool, id)).length;
    } catch (error) {
      console.error('[integracion:documentos]', id, error?.message || error);
    } finally {
      await pool.query(
        `insert into integration_document_checks (order_id) values ($1)
         on conflict (order_id) do update set checked_at=now()`,
        [id],
      );
    }
  }
  return { checked: rows.length, published };
}

// ── Inventario: un evento por SKU por ráfaga ──
// El trigger marca el producto; aquí se espera a que la ráfaga se calme
// (quietMs) o a que pase maxWaitMs, y se publica un inventory.updated por SKU
// a cada cuenta con integración activa.
export async function flushInventoryChanges({ db, quietMs = 3_000, maxWaitMs = 15_000, limit = 200 } = {}) {
  const pool = db || (await loadCore()).pool;
  const client = typeof pool.connect === 'function' ? await pool.connect() : pool;
  try {
    if (client !== pool) await client.query('begin');
    const changed = (await client.query(
      `delete from integration_inventory_changes
       where product_id in (
         select product_id from integration_inventory_changes
         where changed_at <= now() - ($1::int * interval '1 millisecond')
            or first_changed_at <= now() - ($2::int * interval '1 millisecond')
         order by first_changed_at
         limit $3
         for update skip locked
       )
       returning product_id`,
      [quietMs, maxWaitMs, limit],
    )).rows.map((row) => Number(row.product_id));
    let published = 0;
    if (changed.length) {
      const accounts = (await client.query(
        `select id from order_channel_accounts where active and settings->>'integration' = 'true'`,
      )).rows.map((row) => Number(row.id));
      const products = (await client.query(
        `select p.main_sku,
           coalesce(i.quantity_on_hand, 0) - coalesce(i.quantity_reserved, 0)
             - coalesce(i.quantity_pending_return, 0) as available
         from products p left join product_inventory i on i.product_id=p.id
         where p.id = any($1::bigint[]) and nullif(trim(p.main_sku), '') is not null`,
        [changed],
      )).rows;
      for (const accountId of accounts) {
        for (const product of products) {
          await emitIntegrationEvent(client, {
            accountId,
            type: 'inventory.updated',
            payload: { sku: product.main_sku, available: Number(product.available) },
          });
          published += 1;
        }
      }
    }
    if (client !== pool) await client.query('commit');
    return { products: changed.length, published };
  } catch (error) {
    if (client !== pool) await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    if (client !== pool) client.release();
  }
}
