import {
  applyInventoryMovement,
  applyInventoryPendingReturn,
  applyInventoryReservation,
  InsufficientStockError,
  inventoryConfig,
} from './inventory-service.js';
import { resolveListing } from './sku-resolver.js';
import { isCatalogInventoryEnabled } from '../system-config.js';
import {
  isAfterInventoryListenFrom,
  orderListenAt,
  stockCommitmentAction,
} from './stock-commitment.js';

export const STOCK_ELIGIBLE_FULFILLMENT = new Set(['ready_to_ship', 'shipped', 'delivered']);
export const RETURN_STOCK_APPROVAL_FROM_AT = '2026-09-03T19:00:00.000Z';
const TERMINAL_STATUSES = new Set(['cancelled', 'failed']);
const MARKETPLACE_SOURCES = new Set(['provider', 'webhook', 'sync']);
const MARKETPLACE_CHANNELS = new Set(['falabella', 'ripley', 'mercado_libre']);

export function isStockEligibleFulfillment(status) {
  return STOCK_ELIGIBLE_FULFILLMENT.has(String(status || '').trim().toLowerCase());
}

function orderRef(persisted) {
  return persisted?.external_order_number || persisted?.external_order_id || persisted?.id;
}

export function needsReturnStockApproval(returnedAt) {
  if (!returnedAt) return false;
  const at = new Date(returnedAt).getTime();
  return Number.isFinite(at) && at >= Date.parse(RETURN_STOCK_APPROVAL_FROM_AT);
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
  if (value.includes('returned') || value.includes('return_shipped') || value.includes('refund')) return 'returned';
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
  if (item.stock_state === 'pending') {
    await applyInventoryReservation(db, {
      productId: item.product_id,
      quantityDelta: -already,
      allowNegative: true,
    });
    await writeStock(db, item, {
      stockState: 'reversed', appliedQuantity: 0, revision: item.stock_revision,
    });
    return { applied: true, reservedReleased: true };
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
    if (movementType === 'return' && needsReturnStockApproval(context.returnedAt) && item.product_id) {
      const queued = await db.query(
        `insert into return_stock_approvals (
           order_id, order_item_id, product_id, quantity, status, returned_at
         ) values ($1,$2,$3,$4,'pending',$5)
         on conflict (order_item_id) do nothing
         returning id`,
        [context.orderId, item.id, item.product_id, already, context.returnedAt],
      );
      if (queued.rows.length) {
        await applyInventoryPendingReturn(db, {
          productId: item.product_id,
          quantityDelta: already,
        });
      }
    }
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

async function resolveItemProduct(db, item, input) {
  const { companyId, channelCode, account, stats } = input;
  if (item.product_id) return true;
  if (companyId == null) {
    await writeResolution(db, item, { stockState: 'skipped_unmapped' });
    stats.skipped += 1;
    stats.unmapped += 1;
    return false;
  }
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
    stats.unmapped += 1;
    return false;
  }
  item.product_id = resolved.product.id;
  item.listing_id = resolved.listing.id;
  item.main_sku = resolved.product.mainSku;
  return true;
}

async function reserveItem(db, item, input) {
  const { context, stats, allowNegativeOverride, account, isMarketplace } = input;
  const quantity = Number(item.quantity);
  const already = number(item.stock_applied_quantity);
  if (item.stock_state === 'applied') return;
  if (!Number.isFinite(quantity) || quantity <= 0) {
    if (already > 0) {
      const reversed = await reverseItem(db, item, {
        ...context,
        reason: restockReason('invalid_quantity', context.persisted),
      });
      if (reversed.applied) stats.reversed += 1;
    }
    return;
  }
  if (already === quantity && item.stock_state === 'pending') return;
  const deltaUnits = quantity - already;
  if (deltaUnits === 0) return;
  try {
    await applyInventoryReservation(db, {
      productId: item.product_id,
      quantityDelta: deltaUnits,
      allowNegative: allowNegative({ account, isMarketplace, override: allowNegativeOverride }),
    });
    await writeStock(db, item, {
      productId: item.product_id,
      listingId: item.listing_id,
      mainSku: item.main_sku,
      stockState: 'pending',
      appliedQuantity: quantity,
      revision: item.stock_revision,
    });
    stats.reserved += 1;
  } catch (error) {
    if (!(error instanceof InsufficientStockError) || !isMarketplace) throw error;
    if (item.stock_state === 'none') {
      await writeResolution(db, item, {
        productId: item.product_id,
        listingId: item.listing_id,
        mainSku: item.main_sku,
        stockState: 'skipped_insufficient',
      });
    }
    stats.skipped += 1;
    stats.insufficient += 1;
    console.error(JSON.stringify({
      event: 'catalog.stock.insufficient_reserve', orderId: context.orderId, itemId: item.id,
      productId: item.product_id, already, target: quantity, available: error.onHand,
    }));
  }
}

async function commitItem(db, item, input) {
  const {
    context, stats, source, orderId, allowNegativeOverride, account, isMarketplace,
  } = input;
  const quantity = Number(item.quantity);
  let already = number(item.stock_applied_quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    if (already > 0 || item.stock_state === 'applied' || item.stock_state === 'pending') {
      const reversed = await reverseItem(db, item, {
        ...context,
        reason: restockReason('invalid_quantity', context.persisted),
      });
      if (reversed.applied) stats.reversed += 1;
    } else {
      console.warn(JSON.stringify({ event: 'catalog.stock.invalid_quantity', orderId, itemId: item.id, quantity: item.quantity }));
    }
    return;
  }

  const negative = allowNegative({ account, isMarketplace, override: allowNegativeOverride });
  if (item.stock_state === 'pending') {
    if (already !== quantity) {
      try {
        await applyInventoryReservation(db, {
          productId: item.product_id,
          quantityDelta: quantity - already,
          allowNegative: negative,
        });
        already = quantity;
        item.stock_applied_quantity = quantity;
      } catch (error) {
        if (!(error instanceof InsufficientStockError) || !isMarketplace) throw error;
        stats.skipped += 1;
        return;
      }
    }
    const nextRevision = item.stock_revision + 1;
    const key = `sale:order_item:${item.id}:rev:${nextRevision}`;
    try {
      const result = await applyInventoryMovement(db, {
        productId: item.product_id,
        quantityDelta: -quantity,
        movementType: 'sale',
        reason: movementReason(context.orderNumber),
        idempotencyKey: key,
        allowNegative: negative,
        orderId,
        orderItemId: item.id,
        listingId: item.listing_id,
        source,
        actorUserId: context.actorUserId,
        metadata: {
          externalItemId: item.external_item_id,
          orderNumber: context.orderNumber,
          sku: item.sku || item.provider_sku || null,
          from: 0,
          to: quantity,
          revision: nextRevision,
          fulfillmentStatus: context.persisted.fulfillment_status,
          reserved: true,
        },
      });
      if (result.applied === true || already === quantity) {
        await applyInventoryReservation(db, {
          productId: item.product_id,
          quantityDelta: -quantity,
          allowNegative: true,
        });
        await writeStock(db, item, {
          productId: item.product_id,
          listingId: item.listing_id,
          mainSku: item.main_sku,
          stockState: 'applied',
          appliedQuantity: quantity,
          revision: result.applied === true ? nextRevision : item.stock_revision,
        });
        if (result.applied === true) {
          stats.applied += 1;
          stats.committed += 1;
        }
      }
    } catch (error) {
      if (!(error instanceof InsufficientStockError) || !isMarketplace) throw error;
      stats.skipped += 1;
      console.error(JSON.stringify({
        event: 'catalog.stock.insufficient', orderId, itemId: item.id,
        productId: item.product_id, already, target: quantity, onHand: error.onHand,
      }));
    }
    return;
  }

  if (already === quantity && item.stock_state === 'applied') return;
  const deltaUnits = quantity - already;
  if (deltaUnits === 0) return;
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
      allowNegative: negative,
      orderId,
      orderItemId: item.id,
      listingId: item.listing_id,
      source,
      actorUserId: context.actorUserId,
      metadata: {
        externalItemId: item.external_item_id,
        orderNumber: context.orderNumber,
        sku: item.sku || item.provider_sku || null,
        from: already,
        to: quantity,
        revision: nextRevision,
        fulfillmentStatus: context.persisted.fulfillment_status,
      },
    });
    if (result.applied === true) {
      await writeStock(db, item, {
        productId: item.product_id,
        listingId: item.listing_id,
        mainSku: item.main_sku,
        stockState: 'applied',
        appliedQuantity: quantity,
        revision: nextRevision,
      });
      stats.applied += 1;
    } else if (already !== quantity) {
      console.warn(JSON.stringify({ event: 'catalog.stock.idempotency_mismatch', key, already, target: quantity, itemId: item.id }));
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
    stats.insufficient += 1;
    console.error(JSON.stringify({
      event: 'catalog.stock.insufficient', orderId, itemId: item.id,
      productId: item.product_id, already, target: quantity, onHand: error.onHand,
    }));
  }
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
  const companyId = persisted.company_id == null ? null : Number(persisted.company_id);
  const isMarketplace = MARKETPLACE_SOURCES.has(source)
    || MARKETPLACE_CHANNELS.has(String(channelCode || '').trim().toLowerCase());
  const currentFulfillment = persisted.fulfillment_status;
  const previousFulfillment = existing?.fulfillment_status;
  const action = stockCommitmentAction(currentFulfillment);
  const becameEligible = isStockEligibleFulfillment(currentFulfillment)
    && (!existing || !isStockEligibleFulfillment(previousFulfillment));
  const saleEnabled = input.enabled
    ?? (becameEligible ? true : await isCatalogInventoryEnabled(db));
  const afterCutoff = isAfterInventoryListenFrom(orderListenAt(persisted));
  const context = {
    orderId,
    orderNumber: orderNumberOf(persisted),
    source,
    actorUserId,
    persisted,
    returnedAt: persisted.returned_at || persisted.provider_updated_at || null,
  };
  const stats = {
    enabled: Boolean(saleEnabled),
    applied: 0,
    skipped: 0,
    unmapped: 0,
    insufficient: 0,
    reversed: 0,
    reserved: 0,
    committed: 0,
    becameEligible,
  };

  await db.query('select id from orders where id=$1 for update', [orderId]);
  if (persisted.items_status === 'pending' || persisted.items_status === 'error') return stats;

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

  if (action === 'none' && !upsertedItems.length) return stats;

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

  const itemInput = {
    context,
    stats,
    source,
    orderId,
    companyId,
    channelCode,
    account,
    isMarketplace,
    allowNegativeOverride: input.allowNegative,
  };

  for (const row of saleItems) {
    const item = mutableItem(row);
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
    if (action === 'none' || !saleEnabled) continue;
    if (item.stock_state === 'skipped_policy' && !afterCutoff) continue;
    if (item.stock_state === 'skipped_policy' && !input.includeSkippedPolicy && !becameEligible) continue;
    if ((item.stock_state === 'none' || item.stock_state === 'skipped_policy') && !afterCutoff) {
      if (item.stock_state === 'none') {
        await writeResolution(db, item, { stockState: 'skipped_policy' });
      }
      stats.skipped += 1;
      continue;
    }

    if (!await resolveItemProduct(db, item, itemInput)) continue;

    if (action === 'reserve') {
      await reserveItem(db, item, itemInput);
      continue;
    }
    await commitItem(db, item, itemInput);
  }
  return stats;
}
