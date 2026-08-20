import { randomUUID } from 'node:crypto';
import {
  finiteNumber,
  httpError,
  inTransaction,
  jsonObject,
  loadCore,
  positiveInt,
  text,
} from './utils.js';

export const MOVEMENT_TYPES = [
  'sale', 'sale_adjust', 'sale_reversal', 'adjustment_in', 'adjustment_out',
  'return', 'initial', 'import',
];

function envBoolean(name, fallback = false) {
  const value = String(process.env[name] ?? '').trim().toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value);
}

export const inventoryConfig = Object.freeze({
  enabled: envBoolean('CATALOG_INVENTORY_ENABLED', false),
  allowNegativeMarketplace: envBoolean('CATALOG_ALLOW_NEGATIVE_MARKETPLACE', false),
  allowNegativeManual: envBoolean('CATALOG_ALLOW_NEGATIVE_MANUAL', false),
});

export class InsufficientStockError extends Error {
  constructor({ productId, onHand, quantityDelta, projected }) {
    super(`Stock insuficiente para el producto ${productId}. Disponible: ${onHand}.`);
    this.name = 'InsufficientStockError';
    this.code = 'insufficient_stock';
    this.status = 400;
    this.productId = Number(productId);
    this.onHand = Number(onHand);
    this.quantityDelta = Number(quantityDelta);
    this.projected = Number(projected);
  }
}

function mapMovement(row) {
  const metadata = row.metadata || {};
  return {
    id: Number(row.id),
    productId: Number(row.product_id),
    movementType: row.movement_type,
    quantityDelta: Number(row.quantity_delta),
    quantityAfter: Number(row.quantity_after),
    reason: row.reason,
    actorUserId: row.actor_user_id,
    source: row.source,
    orderId: row.order_id == null ? null : Number(row.order_id),
    orderNumber: row.external_order_number || metadata.orderNumber || null,
    orderItemId: row.order_item_id == null ? null : Number(row.order_item_id),
    listingId: row.listing_id == null ? null : Number(row.listing_id),
    sku: row.sku || metadata.sku || null,
    companyName: row.company_name || null,
    channelCode: row.channel_code || null,
    idempotencyKey: row.idempotency_key,
    metadata,
    createdAt: row.created_at,
  };
}

/**
 * Materializa en el producto principal el stock reportado por todas sus
 * publicaciones asociadas. La vendibilidad de una publicación no altera su
 * cantidad: estado comercial y stock son datos independientes.
 */
export async function syncProductInventoryFromListings(db, productIdsInput) {
  if (!db?.query) throw new Error('syncProductInventoryFromListings requiere una conexión abierta.');
  const productIds = [...new Set((productIdsInput || []).map((id) => positiveInt(id, 'productId')))];
  if (!productIds.length) return [];
  const result = await db.query(
    `with listing_totals as (
       select p.id as product_id,
         coalesce(sum(coalesce(l.marketplace_quantity, 0)), 0) as seller_stock_total
       from products p
       left join product_listings l on l.product_id=p.id
       where p.id = any($1::bigint[])
       group by p.id
     )
     insert into product_inventory (product_id, quantity_on_hand, quantity_reserved)
     select product_id, seller_stock_total, 0 from listing_totals
     on conflict (product_id) do update set
       quantity_on_hand=excluded.quantity_on_hand + product_inventory.quantity_reserved,
       updated_at=now()
     returning product_id, quantity_on_hand, quantity_reserved,
       quantity_on_hand - quantity_reserved as available`,
    [productIds],
  );
  return result.rows.map((row) => ({
    productId: Number(row.product_id),
    quantityOnHand: Number(row.quantity_on_hand),
    quantityReserved: Number(row.quantity_reserved),
    available: Number(row.available),
  }));
}

export async function applyInventoryMovement(db, input) {
  if (!db?.query) throw new Error('applyInventoryMovement requiere una transacción abierta.');
  const productId = positiveInt(input.productId, 'productId');
  const quantityDelta = finiteNumber(input.quantityDelta, 'quantityDelta');
  if (quantityDelta === 0) throw httpError('quantityDelta no puede ser cero.');
  const movementType = String(input.movementType || '').trim().toLowerCase();
  if (!MOVEMENT_TYPES.includes(movementType)) throw httpError('movementType inválido.');
  const idempotencyKey = text(input.idempotencyKey, 'idempotencyKey', 500);

  await db.query(
    `insert into product_inventory (product_id, quantity_on_hand, quantity_reserved)
     values ($1,0,0) on conflict (product_id) do nothing`,
    [productId],
  );
  const inventoryResult = await db.query(
    `select quantity_on_hand, quantity_reserved from product_inventory
     where product_id=$1 for update`,
    [productId],
  );
  if (!inventoryResult.rows.length) throw httpError('Producto no encontrado.', 404);
  const onHand = Number(inventoryResult.rows[0].quantity_on_hand);
  const existing = await db.query(
    'select * from inventory_movements where idempotency_key=$1 limit 1',
    [idempotencyKey],
  );
  if (existing.rows.length) {
    return { applied: false, quantityOnHand: onHand, movement: mapMovement(existing.rows[0]) };
  }

  const projected = onHand + quantityDelta;
  if (projected < 0 && input.allowNegative !== true) {
    throw new InsufficientStockError({ productId, onHand, quantityDelta, projected });
  }
  const inserted = await db.query(
    `insert into inventory_movements (
       product_id, movement_type, quantity_delta, quantity_after, reason, actor_user_id,
       source, order_id, order_item_id, listing_id, idempotency_key, metadata
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     on conflict (idempotency_key) do nothing returning *`,
    [
      productId,
      movementType,
      quantityDelta,
      projected,
      input.reason ? String(input.reason).trim().slice(0, 2000) : null,
      input.actorUserId ? String(input.actorUserId) : null,
      text(input.source || 'system', 'source', 100),
      input.orderId ? positiveInt(input.orderId, 'orderId') : null,
      input.orderItemId ? positiveInt(input.orderItemId, 'orderItemId') : null,
      input.listingId ? positiveInt(input.listingId, 'listingId') : null,
      idempotencyKey,
      JSON.stringify(jsonObject(input.metadata)),
    ],
  );
  if (!inserted.rows.length) {
    const raced = await db.query('select * from inventory_movements where idempotency_key=$1', [idempotencyKey]);
    return { applied: false, quantityOnHand: onHand, movement: raced.rows[0] ? mapMovement(raced.rows[0]) : undefined };
  }
  await db.query(
    'update product_inventory set quantity_on_hand=$1, updated_at=now() where product_id=$2',
    [projected, productId],
  );
  console.info(JSON.stringify({
    event: 'catalog.inventory.movement', productId, orderItemId: input.orderItemId || null,
    applied: true, key: idempotencyKey, quantityDelta, quantityOnHand: projected,
  }));
  return { applied: true, quantityOnHand: projected, movement: mapMovement(inserted.rows[0]) };
}

export async function getInventory(productIdInput, db) {
  const target = db || (await loadCore()).pool;
  const productId = positiveInt(productIdInput, 'productId');
  const result = await target.query(
    `select i.product_id, i.quantity_on_hand, i.quantity_reserved, i.reorder_point,
       i.quantity_on_hand - i.quantity_reserved as available, i.updated_at
     from product_inventory i where i.product_id=$1`,
    [productId],
  );
  if (!result.rows.length) throw httpError('Producto no encontrado.', 404);
  const row = result.rows[0];
  return {
    productId,
    quantityOnHand: Number(row.quantity_on_hand),
    quantityReserved: Number(row.quantity_reserved),
    available: Number(row.available),
    reorderPoint: row.reorder_point == null ? null : Number(row.reorder_point),
    updatedAt: row.updated_at,
  };
}

export async function listMovements(productIdInput, filters = {}, db) {
  const target = db || (await loadCore()).pool;
  const productId = positiveInt(productIdInput, 'productId');
  const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const result = await target.query(
    `select m.*,
       o.external_order_number,
       oi.sku,
       ch.code as channel_code,
       coalesce(nullif(c.nombre_comercial, ''), nullif(c.nombre, ''), c.razon_social) as company_name,
       count(*) over() as total_count
     from inventory_movements m
     left join orders o on o.id=m.order_id
     left join order_items oi on oi.id=m.order_item_id
     left join companies c on c.id=o.company_id
     left join order_channel_accounts a on a.id=o.channel_account_id
     left join order_channels ch on ch.id=a.channel_id
     where m.product_id=$1
     order by m.created_at desc, m.id desc
     limit $2 offset $3`,
    [productId, limit, offset],
  );
  return {
    movements: result.rows.map(mapMovement),
    totalCount: result.rows[0] ? Number(result.rows[0].total_count) : 0,
    limit,
    offset,
  };
}

export async function adjustInventory(productIdInput, input, actorUserId, db) {
  const productId = positiveInt(productIdInput, 'productId');
  const reason = text(input.reason, 'reason', 2000);
  const hasDelta = input.delta !== undefined && input.delta !== null && input.delta !== '';
  const hasAbsolute = input.absoluteTarget !== undefined && input.absoluteTarget !== null && input.absoluteTarget !== '';
  if (hasDelta === hasAbsolute) throw httpError('Envía delta o absoluteTarget, pero no ambos.');
  return inTransaction(db, async (client) => {
    await client.query(
      `insert into product_inventory (product_id, quantity_on_hand, quantity_reserved)
       values ($1,0,0) on conflict (product_id) do nothing`,
      [productId],
    );
    const locked = await client.query(
      'select quantity_on_hand from product_inventory where product_id=$1 for update',
      [productId],
    );
    if (!locked.rows.length) throw httpError('Producto no encontrado.', 404);
    const current = Number(locked.rows[0].quantity_on_hand);
    const absoluteTarget = hasAbsolute ? finiteNumber(input.absoluteTarget, 'absoluteTarget') : null;
    const delta = hasAbsolute ? absoluteTarget - current : finiteNumber(input.delta, 'delta');
    if (delta === 0) return { applied: false, quantityOnHand: current, noChange: true };
    const projected = current + delta;
    const allowNegative = input.allowNegative ?? inventoryConfig.allowNegativeManual;
    if (projected < 0 && !allowNegative) {
      throw new InsufficientStockError({ productId, onHand: current, quantityDelta: delta, projected });
    }
    return applyInventoryMovement(client, {
      productId,
      quantityDelta: delta,
      movementType: delta > 0 ? 'adjustment_in' : 'adjustment_out',
      reason,
      actorUserId,
      source: 'manual',
      idempotencyKey: text(input.idempotencyKey || `adjustment:${randomUUID()}`, 'idempotencyKey', 500),
      metadata: { mode: hasAbsolute ? 'absolute' : 'delta', previousQuantity: current, targetQuantity: projected },
      allowNegative,
    });
  });
}
