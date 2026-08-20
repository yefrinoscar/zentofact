import {
  applyInventoryMovement,
  InsufficientStockError,
  inventoryConfig,
} from './inventory-service.js';
import { resolveListing } from './sku-resolver.js';

export const STOCK_ELIGIBLE_FULFILLMENT = new Set(['ready_to_ship', 'shipped', 'delivered']);
const TERMINAL_STATUSES = new Set(['cancelled', 'failed']);
const MARKETPLACE_SOURCES = new Set(['provider', 'webhook', 'sync']);

export function isStockEligibleFulfillment(status) {
  return STOCK_ELIGIBLE_FULFILLMENT.has(String(status || '').trim().toLowerCase());
}

function orderRef(persisted) {
  return persisted?.external_order_number || persisted?.external_order_id || persisted?.id;
}

function restockReason(kind, persisted) {
  const pedido = orderRef(persisted);
  if (kind === 'return' || kind === 'returned' || kind === 'fulfillment_returned') {
    return `Devolución del pedido ${pedido}`;
  }
  if (kind === 'cancelled' || kind === 'canceled' || kind === 'order_cancelled') {
    return `Cancelación del pedido ${pedido}`;
  }
  if (kind === 'failed' || kind === 'order_failed') {
    return `Fallo del pedido ${pedido}`;
  }
  if (kind === 'items_complete_delete') return `Línea eliminada del pedido ${pedido}`;
  if (kind === 'invalid_quantity') return `Cantidad inválida del pedido ${pedido}`;
  return `Reintegro de stock del pedido ${pedido}`;
}

function itemTerminalKind(status) {
  const value = String(status || '').toLowerCase();
  if (!value) return null;
  if (value.includes('cancel')) return 'cancelled';
  if (value.includes('failed')) return 'failed';
  if (value.includes('returned') || value.includes('return_shipped')) return 'returned';
  return null;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mutableItem(row) {
  return {
    ...row,
    id: Number(row.id),
    quantity: row.quantity,
    product_id: row.product_id == null ? null : Number(row.product_id),
    listing_id: row.listing_id == null ? null : Number(row.listing_id),
    stock_applied_quantity: number(row.stock_applied_quantity),
    stock_revision: Math.max(0, Number(row.stock_revision) || 0),
    stock_state: row.stock_state || 'none',
  };
}

async function writeResolution(db, item, input) {
  await db.query(
    `update order_items set product_id=$1, listing_id=$2, main_sku=$3,
       stock_state=$4, updated_at=now() where id=$5`,
    [
      input.productId ?? item.product_id ?? null,
      input.listingId ?? item.listing_id ?? null,
      input.mainSku ?? item.main_sku ?? null,
      input.stockState || item.stock_state,
      item.id,
    ],
  );
  if (input.productId !== undefined) item.product_id = input.productId;
  if (input.listingId !== undefined) item.listing_id = input.listingId;
  if (input.mainSku !== undefined) item.main_sku = input.mainSku;
  if (input.stockState) item.stock_state = input.stockState;
}

async function writeStock(db, item, input) {
  await db.query(
    `update order_items set product_id=$1, listing_id=$2, main_sku=$3,
       stock_state=$4, stock_applied_quantity=$5, stock_revision=$6, updated_at=now()
     where id=$7`,
    [
      input.productId ?? item.product_id,
      input.listingId ?? item.listing_id,
      input.mainSku ?? item.main_sku,
      input.stockState,
      input.appliedQuantity,
      input.revision,
      item.id,
    ],
  );
  item.product_id = input.productId ?? item.product_id;
  item.listing_id = input.listingId ?? item.listing_id;
  item.main_sku = input.mainSku ?? item.main_sku;
  item.stock_state = input.stockState;
  item.stock_applied_quantity = input.appliedQuantity;
  item.stock_revision = input.revision;
}

function orderNumberOf(order) {
  return String(order?.external_order_number || order?.external_order_id || '').trim() || null;
}

function movementReason(orderNumber) {
  return orderNumber ? `Pedido ${orderNumber}` : null;
}

async function reverseItem(db, itemInput, context, movementType = 'sale_reversal') {
  const item = mutableItem(itemInput);
  const already = number(item.stock_applied_quantity);
  if (already <= 0) {
    if (item.stock_state !== 'reversed') {
      await writeResolution(db, item, { stockState: 'reversed' });
    }
    return { applied: false, noChange: true };
  }
  if (!item.product_id) {
    const error = new Error(`La línea ${item.id} tiene stock aplicado sin product_id; no se puede revertir de forma segura.`);
    error.code = 'invalid_applied_stock_item';
    throw error;
  }
  const nextRevision = item.stock_revision + 1;
  const key = `${movementType}:order_item:${item.id}:rev:${nextRevision}`;
  const result = await applyInventoryMovement(db, {
    productId: item.product_id,
    quantityDelta: already,
    movementType,
    reason: context.reason || movementReason(context.orderNumber),
    idempotencyKey: key,
    allowNegative: true,
    orderId: context.orderId,
    orderItemId: item.id,
    listingId: item.listing_id,
    source: context.source,
    actorUserId: context.actorUserId,
    metadata: {
      externalItemId: item.external_item_id,
      orderNumber: context.orderNumber,
      sku: item.sku || item.provider_sku || null,
      from: already,
      to: 0,
      revision: nextRevision,
      reason: context.reason,
    },
  });
  if (result.applied === true) {
    await writeStock(db, item, {
      stockState: 'reversed', appliedQuantity: 0, revision: nextRevision,
    });
  } else {
    console.warn(JSON.stringify({ event: 'catalog.stock.idempotency_mismatch', key, already, target: 0, itemId: item.id }));
  }
  return result;
}

function allowNegative({ account, isMarketplace, override }) {
  if (typeof override === 'boolean') return override;
  if (typeof account?.settings?.allowNegative === 'boolean') return account.settings.allowNegative;
  return isMarketplace ? inventoryConfig.allowNegativeMarketplace : inventoryConfig.allowNegativeManual;
}

export async function stockPhase(input) {
  const {
    db,
    persisted,
    existing,
    account,
    upsertedItems = [],
    doomedItems = [],
  } = input;
  const source = String(input.source || 'system').toLowerCase();
  const actorUserId = input.actorUserId || null;
  const orderId = Number(persisted.id);
  const channelCode = account.channelCode || account.channel_code;
  const companyId = Number(persisted.company_id);
  const isMarketplace = MARKETPLACE_SOURCES.has(source);
  const currentFulfillment = persisted.fulfillment_status;
  const previousFulfillment = existing?.fulfillment_status;
  const becameEligible = isStockEligibleFulfillment(currentFulfillment)
    && (!existing || !isStockEligibleFulfillment(previousFulfillment));
  const saleEnabled = input.enabled ?? (becameEligible ? true : inventoryConfig.enabled);
  const context = {
    orderId,
    orderNumber: orderNumberOf(persisted),
    source,
    actorUserId,
    persisted,
  };
  const stats = { enabled: Boolean(saleEnabled), applied: 0, skipped: 0, reversed: 0, becameEligible };

  await db.query('select id from orders where id=$1 for update', [orderId]);

  // A. Revertir las líneas ausentes mientras sus FKs todavía existen.
  for (const row of doomedItems) {
    const result = await reverseItem(db, row, {
      ...context,
      reason: restockReason('items_complete_delete', persisted),
    });
    if (result.applied) stats.reversed += 1;
  }

  const currentStatus = persisted.order_status;
  const isReturned = persisted.fulfillment_status === 'returned';
  const isTerminalNow = TERMINAL_STATUSES.has(currentStatus) || isReturned;
  // Un pedido que llega terminal por primera vez nunca genera una venta.
  if (!existing && isTerminalNow) return stats;
  if (isTerminalNow) {
    const result = await db.query(
      `select id, external_item_id, product_id, listing_id, main_sku, stock_state,
         stock_applied_quantity, stock_revision
       from order_items where order_id=$1 and stock_applied_quantity > 0 for update`,
      [orderId],
    );
    const kind = isReturned ? 'return' : currentStatus;
    const movementType = isReturned ? 'return' : 'sale_reversal';
    for (const row of result.rows) {
      const reversed = await reverseItem(db, row, {
        ...context,
        reason: restockReason(kind, persisted),
      }, movementType);
      if (reversed.applied) stats.reversed += 1;
    }
    return stats;
  }

  if (!isStockEligibleFulfillment(currentFulfillment) && !upsertedItems.length) return stats;

  let saleItems = upsertedItems;
  if (!saleItems.length) {
    saleItems = (await db.query(
      `select id, external_item_id, sku, provider_sku, quantity, product_id, listing_id,
         main_sku, stock_state, stock_applied_quantity, stock_revision, provider_status
       from order_items
       where order_id=$1 and stock_state <> 'reversed'
       for update`,
      [orderId],
    )).rows;
  }

  for (const row of saleItems) {
    const item = mutableItem(row);
    // Las líneas históricas recuperadas bajo demanda para analítica de ventas no
    // deben convertirse después en movimientos de stock retroactivos, salvo que
    // el pedido acabe de pasar a listo para enviar o se pida explícitamente.
    if (item.stock_state === 'reversed') continue;
    const terminalKind = itemTerminalKind(item.provider_status);
    if (terminalKind) {
      const movementType = terminalKind === 'returned' ? 'return' : 'sale_reversal';
      const reversed = await reverseItem(db, item, {
        ...context,
        reason: restockReason(terminalKind, persisted),
      }, movementType);
      if (reversed.applied) stats.reversed += 1;
      continue;
    }
    if (!isStockEligibleFulfillment(currentFulfillment) || !saleEnabled) continue;
    if (item.stock_state === 'skipped_policy' && !input.includeSkippedPolicy && !becameEligible) continue;
    const quantity = Number(item.quantity);
    const already = number(item.stock_applied_quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      if (already > 0 || item.stock_state === 'applied') {
        const reversed = await reverseItem(db, item, {
          ...context,
          reason: restockReason('invalid_quantity', persisted),
        });
        if (reversed.applied) stats.reversed += 1;
      } else {
        console.warn(JSON.stringify({ event: 'catalog.stock.invalid_quantity', orderId, itemId: item.id, quantity: item.quantity }));
      }
      continue;
    }

    if (!item.product_id) {
      const resolved = await resolveListing(db, {
        channelCode,
        companyId,
        channelAccountId: account.id,
        sellerSku: item.sku,
        shopSku: item.provider_sku,
      });
      if (resolved.unmapped) {
        await writeResolution(db, item, { stockState: 'skipped_unmapped' });
        stats.skipped += 1;
        continue;
      }
      item.product_id = resolved.product.id;
      item.listing_id = resolved.listing.id;
      item.main_sku = resolved.product.mainSku;
    }

    const target = quantity;
    if (already === target && item.stock_state === 'applied') continue;
    const deltaUnits = target - already;
    if (deltaUnits === 0) continue;
    const movementType = already === 0 ? 'sale' : 'sale_adjust';
    const nextRevision = item.stock_revision + 1;
    const key = `${movementType}:order_item:${item.id}:rev:${nextRevision}`;
    try {
      const result = await applyInventoryMovement(db, {
        productId: item.product_id,
        quantityDelta: -deltaUnits,
        movementType,
        reason: movementReason(context.orderNumber),
        idempotencyKey: key,
        allowNegative: allowNegative({ account, isMarketplace, override: input.allowNegative }),
        orderId,
        orderItemId: item.id,
        listingId: item.listing_id,
        source,
        actorUserId,
        metadata: {
          externalItemId: item.external_item_id,
          orderNumber: context.orderNumber,
          sku: item.sku || item.provider_sku || null,
          from: already,
          to: target,
          revision: nextRevision,
          fulfillmentStatus: currentFulfillment,
        },
      });
      if (result.applied === true) {
        await writeStock(db, item, {
          productId: item.product_id,
          listingId: item.listing_id,
          mainSku: item.main_sku,
          stockState: 'applied',
          appliedQuantity: target,
          revision: nextRevision,
        });
        stats.applied += 1;
      } else if (already !== target) {
        console.warn(JSON.stringify({ event: 'catalog.stock.idempotency_mismatch', key, already, target, itemId: item.id }));
      }
    } catch (error) {
      if (!(error instanceof InsufficientStockError) || !isMarketplace) throw error;
      await writeResolution(db, item, {
        productId: item.product_id,
        listingId: item.listing_id,
        mainSku: item.main_sku,
        stockState: 'skipped_insufficient',
      });
      stats.skipped += 1;
      console.error(JSON.stringify({
        event: 'catalog.stock.insufficient', orderId, itemId: item.id,
        productId: item.product_id, already, target, onHand: error.onHand,
      }));
    }
  }
  return stats;
}
