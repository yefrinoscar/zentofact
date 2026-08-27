import { createHash } from 'node:crypto';
import { applyInventoryMovement } from './inventory-service.js';
import { HISTORICAL_SKU_TO_MASTER as HISTORICAL_SKU_MAP, historicalMasterForSku } from './historical-sku-map.js';

export const AUGUST_START = '2026-08-01T05:00:00.000Z';
export const AUGUST_END = '2026-09-01T05:00:00.000Z';
export const PHYSICAL_CUTOFF = '2026-08-21T19:50:00.000Z';

const ELIGIBLE = new Set(['ready_to_ship', 'shipped', 'delivered']);
const TERMINAL = new Set(['cancelled', 'canceled', 'failed', 'returned']);

export const HISTORICAL_SKU_TO_MASTER = HISTORICAL_SKU_MAP;

export const KNOWN_PRODUCT_BLOCKERS = Object.freeze({});

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function iso(value) {
  return new Date(value).toISOString();
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

export function normalizeAugustQuantity(item) {
  const stored = number(item.quantity);
  const rawData = item.raw_data || item.rawData || {};
  if (stored === 0 && !hasOwn(rawData, 'Quantity')) {
    return { quantity: 1, corrected: true };
  }
  return { quantity: stored, corrected: false };
}

export function eventStatus(event) {
  const values = event.new_values || event.newValues || {};
  const orderStatus = String(values.orderStatus || values.order_status || '').trim().toLowerCase();
  if (TERMINAL.has(orderStatus)) return orderStatus;
  return String(values.fulfillmentStatus || values.fulfillment_status || '').trim().toLowerCase();
}

export function deriveInventoryTransitions(events, quantity) {
  const ordered = [...events]
    .filter((event) => event.provider_occurred_at || event.providerOccurredAt)
    .sort((left, right) => {
      const time = new Date(left.provider_occurred_at || left.providerOccurredAt).getTime()
        - new Date(right.provider_occurred_at || right.providerOccurredAt).getTime();
      return time || number(left.id) - number(right.id);
    });
  let physicallyOut = false;
  const transitions = [];
  for (const event of ordered) {
    const status = eventStatus(event);
    if (ELIGIBLE.has(status) && !physicallyOut) {
      physicallyOut = true;
      transitions.push({
        eventId: Number(event.id), effectiveAt: iso(event.provider_occurred_at || event.providerOccurredAt),
        kind: 'exit', quantityDelta: -quantity, status,
      });
    } else if (TERMINAL.has(status) && physicallyOut) {
      physicallyOut = false;
      transitions.push({
        eventId: Number(event.id), effectiveAt: iso(event.provider_occurred_at || event.providerOccurredAt),
        kind: 'reversal', quantityDelta: quantity, status,
      });
    }
  }
  return { transitions, physicallyOut };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

export function hashReconciliationPlan(plan) {
  const hashable = {
    version: 1,
    sourceHash: plan.sourceHash,
    cutoffAt: plan.cutoffAt,
    asOf: plan.asOf,
    commercialSales: plan.commercialSales,
    eventTotals: plan.eventTotals,
    quantityCorrections: plan.quantityCorrections,
    mappings: plan.mappings,
    blockers: plan.blockers,
    shortages: plan.shortages,
    products: plan.products,
    itemPlans: plan.itemPlans,
  };
  return createHash('sha256').update(JSON.stringify(canonical(hashable))).digest('hex');
}

function listingKey(companyId, sku) {
  return `${Number(companyId)}\u0000${String(sku || '').trim()}`;
}

function addUnique(map, key, listing) {
  if (!key || key.endsWith('\u0000')) return;
  const current = map.get(key);
  if (current === undefined) map.set(key, listing);
  else map.set(key, null);
}

function buildListingIndexes(listings) {
  const seller = new Map();
  const shop = new Map();
  for (const listing of listings.filter((row) => row.status === 'active')) {
    addUnique(seller, listingKey(listing.company_id, listing.seller_sku), listing);
    addUnique(shop, listingKey(listing.company_id, listing.shop_sku), listing);
  }
  return { seller, shop };
}

function resolveItem(item, context) {
  const sellerSku = String(item.sku || '').trim();
  const shopSku = String(item.provider_sku || '').trim();
  const exactSeller = context.indexes.seller.get(listingKey(item.company_id, sellerSku));
  const exactShop = context.indexes.shop.get(listingKey(item.company_id, shopSku));
  const exact = exactSeller || exactShop;
  if (exact) {
    const product = context.productsById.get(Number(exact.product_id));
    return product ? { product, listing: exact, method: exactSeller ? 'active_seller_sku' : 'active_shop_sku' } : null;
  }
  const explicitSku = [sellerSku, shopSku].find((sku) => historicalMasterForSku(sku, HISTORICAL_SKU_TO_MASTER));
  if (!explicitSku) return null;
  const product = context.productsBySku.get(historicalMasterForSku(explicitSku, HISTORICAL_SKU_TO_MASTER));
  if (!product) return null;
  const historicalListing = context.listings.find((listing) => (
    Number(listing.company_id) === Number(item.company_id)
    && (listing.seller_sku === explicitSku || listing.shop_sku === explicitSku)
  ));
  return { product, listing: historicalListing || null, method: 'explicit_historical_sku' };
}

export function resolveFalabellaReconciliationItem(item, listings, products) {
  const productsById = new Map(products.map((product) => [Number(product.id), product]));
  const productsBySku = new Map(products.map((product) => [product.main_sku, product]));
  return resolveItem(item, {
    indexes: buildListingIndexes(listings), productsById, productsBySku, listings,
  });
}

function aggregateTransitions(itemPlans, cutoffAt) {
  const cutoff = new Date(cutoffAt).getTime();
  const totals = {
    beforeCutoff: { exits: 0, reversals: 0, netDelta: 0 },
    afterCutoff: { exits: 0, reversals: 0, netDelta: 0 },
  };
  for (const item of itemPlans) {
    for (const transition of item.transitions.filter((entry) => entry.effectiveAt >= AUGUST_START)) {
      const bucket = new Date(transition.effectiveAt).getTime() < cutoff
        ? totals.beforeCutoff : totals.afterCutoff;
      if (transition.kind === 'exit') bucket.exits += item.quantity;
      else bucket.reversals += item.quantity;
      bucket.netDelta += transition.quantityDelta;
    }
  }
  return totals;
}

export function summarizeInventoryTransitions(itemPlans, cutoffAt = PHYSICAL_CUTOFF) {
  return aggregateTransitions(itemPlans, cutoffAt);
}

export function calculateInventoryTarget(input) {
  const currentQuantity = number(input.currentQuantity);
  const preCutoffDelta = number(input.preCutoffDelta);
  const postCutoffDelta = number(input.postCutoffDelta);
  const cutoffQuantity = input.countUnresolved
    ? (postCutoffDelta === 0 ? currentQuantity : null)
    : number(input.countedQuantity);
  const calculatedTargetQuantity = cutoffQuantity == null ? null : cutoffQuantity + postCutoffDelta;
  return {
    cutoffQuantity,
    openingQuantity: cutoffQuantity == null ? null : cutoffQuantity - preCutoffDelta,
    calculatedTargetQuantity,
    shortageQuantity: calculatedTargetQuantity == null ? 0 : Math.max(0, -calculatedTargetQuantity),
    targetQuantity: calculatedTargetQuantity == null ? null : Math.max(0, calculatedTargetQuantity),
  };
}

function productReport(products, workbook, itemPlans) {
  const cutoffBySku = new Map(workbook.targets.map((target) => [target.masterSku, number(target.targetQuantity)]));
  const unresolvedCount = new Set(workbook.presentWithoutQuantity || []);
  const deltasByProduct = new Map();
  const preDeltasByProduct = new Map();
  const transitionsByProduct = new Map();
  const cutoff = new Date(PHYSICAL_CUTOFF).getTime();
  for (const item of itemPlans.filter((entry) => entry.productId)) {
    for (const transition of item.transitions.filter((entry) => entry.effectiveAt >= AUGUST_START)) {
      const transitions = transitionsByProduct.get(item.productId) || [];
      transitions.push(transition);
      transitionsByProduct.set(item.productId, transitions);
      const target = new Date(transition.effectiveAt).getTime() < cutoff ? preDeltasByProduct : deltasByProduct;
      target.set(item.productId, number(target.get(item.productId)) + transition.quantityDelta);
    }
  }
  return products.map((product) => {
    const hasCount = cutoffBySku.has(product.main_sku);
    const postCutoffDelta = number(deltasByProduct.get(Number(product.id)));
    const preCutoffDelta = number(preDeltasByProduct.get(Number(product.id)));
    const countUnresolved = unresolvedCount.has(product.main_sku);
    const target = calculateInventoryTarget({
      currentQuantity: product.quantity_on_hand,
      countedQuantity: hasCount ? cutoffBySku.get(product.main_sku) : 0,
      countUnresolved, preCutoffDelta, postCutoffDelta,
    });
    let replayBalance = target.openingQuantity;
    let minimumReplayBalance = replayBalance;
    if (replayBalance != null) {
      for (const transition of (transitionsByProduct.get(Number(product.id)) || [])
        .filter((entry) => new Date(entry.effectiveAt).getTime() < cutoff)
        .sort((left, right) => left.effectiveAt.localeCompare(right.effectiveAt) || left.eventId - right.eventId)) {
        replayBalance += transition.quantityDelta;
        minimumReplayBalance = Math.min(minimumReplayBalance, replayBalance);
      }
    }
    return {
      productId: Number(product.id), mainSku: product.main_sku, name: product.name,
      currentQuantity: number(product.quantity_on_hand), cutoffQuantity: target.cutoffQuantity,
      quantityReserved: number(product.quantity_reserved),
      cutoffSource: countUnresolved && postCutoffDelta === 0 ? 'preserved_no_excel_quantity' : (hasCount ? 'excel' : 'absent_from_excel'),
      openingQuantity: target.openingQuantity,
      preCutoffDelta,
      postCutoffDelta,
      calculatedTargetQuantity: target.calculatedTargetQuantity,
      shortageQuantity: target.shortageQuantity,
      preCutoffShortageQuantity: minimumReplayBalance == null ? 0 : Math.max(0, -minimumReplayBalance),
      targetQuantity: target.targetQuantity,
      hasAugustTransitions: (transitionsByProduct.get(Number(product.id)) || []).length > 0,
    };
  }).filter((product) => (
    product.cutoffQuantity !== 0 || product.currentQuantity !== 0
    || product.preCutoffDelta !== 0 || product.postCutoffDelta !== 0 || product.hasAugustTransitions
  ));
}

async function loadRows(db, asOf) {
  const products = (await db.query(
    `select p.id, p.main_sku, p.name, coalesce(i.quantity_on_hand,0) quantity_on_hand,
       coalesce(i.quantity_reserved,0) quantity_reserved
     from products p left join product_inventory i on i.product_id=p.id order by p.id`,
  )).rows;
  const listings = (await db.query(
    `select id, product_id, company_id, seller_sku, shop_sku, status
     from product_listings where channel_code='falabella' order by id`,
  )).rows;
  const items = (await db.query(
    `select oi.id, oi.order_id, oi.external_item_id, oi.sku, oi.provider_sku, oi.description,
       oi.quantity, oi.raw_data, oi.product_id, oi.listing_id, oi.stock_state,
       oi.stock_applied_quantity, oi.stock_revision, o.company_id, o.external_order_number,
       o.ordered_at, o.order_status, o.fulfillment_status,
       (o.ordered_at >= $1 and o.ordered_at < $2) as commercial_august,
       exists (
         select 1 from order_events relevant
         where relevant.order_id=o.id and relevant.provider_occurred_at >= $1
           and relevant.provider_occurred_at <= $3
       ) as inventory_august
     from order_items oi
     join orders o on o.id=oi.order_id
     join order_channel_accounts a on a.id=o.channel_account_id
     join order_channels ch on ch.id=a.channel_id
     where ch.code='falabella'
       and ((o.ordered_at >= $1 and o.ordered_at < $2) or exists (
         select 1 from order_events relevant
         where relevant.order_id=o.id and relevant.provider_occurred_at >= $1
           and relevant.provider_occurred_at <= $3
       ))
     order by oi.id`,
    [AUGUST_START, AUGUST_END, asOf],
  )).rows;
  const orderIds = [...new Set(items.filter((item) => item.inventory_august).map((item) => Number(item.order_id)))];
  const events = orderIds.length ? (await db.query(
    `select id, order_id, event_type, new_values, provider_occurred_at
     from order_events
     where order_id=any($1::bigint[]) and provider_occurred_at is not null
       and provider_occurred_at <= $2
     order by order_id, provider_occurred_at, id`,
    [orderIds, asOf],
  )).rows : [];
  return { products, listings, items, events };
}

export async function buildFalabellaAugustPlan(db, input) {
  const asOf = iso(input.asOf);
  if (new Date(asOf) < new Date(PHYSICAL_CUTOFF)) throw new Error('asOf debe ser posterior al conteo físico.');
  const rows = await loadRows(db, asOf);
  const productsById = new Map(rows.products.map((product) => [Number(product.id), product]));
  const productsBySku = new Map(rows.products.map((product) => [product.main_sku, product]));
  const indexes = buildListingIndexes(rows.listings);
  const eventsByOrder = new Map();
  for (const event of rows.events) {
    const list = eventsByOrder.get(Number(event.order_id)) || [];
    list.push(event);
    eventsByOrder.set(Number(event.order_id), list);
  }
  const mappings = [];
  const blockers = [];
  const quantityCorrections = [];
  const itemPlans = [];
  let commercialUnits = 0;
  let commercialLines = 0;
  const commercialOrders = new Set();

  for (const item of rows.items) {
    const normalized = normalizeAugustQuantity(item);
    if (normalized.corrected && item.commercial_august) {
      quantityCorrections.push({ itemId: Number(item.id), orderNumber: item.external_order_number, from: 0, to: 1 });
    }
    const commercialIncluded = item.commercial_august
      && !TERMINAL.has(String(item.order_status).toLowerCase())
      && !TERMINAL.has(String(item.fulfillment_status).toLowerCase());
    if (commercialIncluded) {
      commercialLines += 1;
      commercialUnits += normalized.quantity;
      commercialOrders.add(Number(item.order_id));
    }
    const resolved = resolveItem(item, { indexes, productsById, productsBySku, listings: rows.listings });
    const sellerSku = String(item.sku || '').trim();
    const shopSku = String(item.provider_sku || '').trim();
    if (!resolved && (commercialIncluded || item.inventory_august) && normalized.quantity > 0) {
      const knownReason = KNOWN_PRODUCT_BLOCKERS[sellerSku] || KNOWN_PRODUCT_BLOCKERS[shopSku];
      blockers.push({
        kind: knownReason ? 'product_to_create' : 'unmapped_item', itemId: Number(item.id),
        orderNumber: item.external_order_number, sellerSku, shopSku, title: item.description,
        quantity: normalized.quantity, reason: knownReason || 'No existe listing activo exacto ni mapeo histórico explícito',
      });
    }
    if (resolved) mappings.push({
      itemId: Number(item.id), productId: Number(resolved.product.id), mainSku: resolved.product.main_sku,
      listingId: resolved.listing ? Number(resolved.listing.id) : null, method: resolved.method,
    });
    const timeline = item.inventory_august
      ? deriveInventoryTransitions(eventsByOrder.get(Number(item.order_id)) || [], normalized.quantity)
      : { transitions: [], physicallyOut: false };
    itemPlans.push({
      itemId: Number(item.id), orderId: Number(item.order_id), orderNumber: item.external_order_number,
      listingId: resolved?.listing ? Number(resolved.listing.id) : null,
      productId: resolved ? Number(resolved.product.id) : null,
      mainSku: resolved?.product.main_sku || null,
      quantity: normalized.quantity, correctedQuantity: normalized.corrected,
      transitions: timeline.transitions, physicallyOut: timeline.physicallyOut,
      previousStockState: item.stock_state, previousAppliedQuantity: number(item.stock_applied_quantity),
      previousRevision: number(item.stock_revision),
    });
  }

  const products = productReport(rows.products, input.workbook, itemPlans);
  for (const product of products.filter((entry) => entry.cutoffQuantity == null)) {
    blockers.push({
      kind: 'missing_physical_quantity', productId: product.productId, mainSku: product.mainSku,
      postCutoffDelta: product.postCutoffDelta,
      reason: 'El Excel incluye el producto sin cantidad y tuvo movimientos después del conteo.',
    });
  }
  for (const product of products.filter((entry) => entry.openingQuantity != null && entry.openingQuantity < 0)) {
    blockers.push({
      kind: 'negative_opening_stock', productId: product.productId, mainSku: product.mainSku,
      openingQuantity: product.openingQuantity,
      reason: 'El stock reconstruido al inicio de agosto sería negativo.',
    });
  }
  for (const product of products.filter((entry) => (
    entry.targetQuantity != null
    && Math.min(entry.openingQuantity, entry.cutoffQuantity, entry.targetQuantity) < entry.quantityReserved
  ))) {
    blockers.push({
      kind: 'reserved_stock_conflict', productId: product.productId, mainSku: product.mainSku,
      quantityReserved: product.quantityReserved, openingQuantity: product.openingQuantity,
      cutoffQuantity: product.cutoffQuantity, targetQuantity: product.targetQuantity,
      reason: 'Algún punto del replay queda por debajo del stock reservado.',
    });
  }
  const shortages = products.flatMap((product) => [
    ...(product.preCutoffShortageQuantity > 0 ? [{
      phase: 'before_cutoff_replay', productId: product.productId, mainSku: product.mainSku,
      shortageQuantity: product.preCutoffShortageQuantity,
      reason: 'El orden histórico de agosto necesita reconocer un faltante temporal antes del conteo.',
    }] : []),
    ...(product.shortageQuantity > 0 ? [{
      phase: 'after_cutoff', productId: product.productId, mainSku: product.mainSku,
      cutoffQuantity: product.cutoffQuantity, postCutoffDelta: product.postCutoffDelta,
      calculatedTargetQuantity: product.calculatedTargetQuantity,
      finalTargetQuantity: 0, shortageQuantity: product.shortageQuantity,
      reason: 'Las salidas posteriores al conteo superan el stock físico contado.',
    }] : []),
  ]);
  const eventTotals = aggregateTransitions(itemPlans, PHYSICAL_CUTOFF);
  const plan = {
    sourceHash: input.workbook.sourceHash, cutoffAt: PHYSICAL_CUTOFF, asOf,
    runKey: `falabella-august-2026:${input.workbook.sourceHash.slice(0, 24)}:${asOf}`,
    commercialSales: { orders: commercialOrders.size, lines: commercialLines, units: commercialUnits },
    eventTotals, quantityCorrections,
    mappings: mappings.sort((a, b) => a.itemId - b.itemId),
    blockers: blockers.sort((a, b) => number(a.itemId) - number(b.itemId) || String(a.mainSku || '').localeCompare(String(b.mainSku || ''))),
    shortages,
    products: products.sort((a, b) => a.productId - b.productId),
    itemPlans: itemPlans.filter((item) => item.transitions.length).sort((a, b) => a.itemId - b.itemId),
  };
  plan.planHash = hashReconciliationPlan(plan);
  return plan;
}

function assertApplicable(plan, acknowledgeShortages) {
  if (plan.blockers.length) {
    const error = new Error(`La conciliación tiene ${plan.blockers.length} bloqueo(s); no se aplicó ningún cambio.`);
    error.code = 'reconciliation_blocked';
    error.blockers = plan.blockers;
    throw error;
  }
  if (plan.shortages.length && acknowledgeShortages !== true) {
    const error = new Error(`La conciliación tiene ${plan.shortages.length} faltante(s). Revisa el dry run y usa --acknowledge-shortages para dejarlos en cero.`);
    error.code = 'shortages_not_acknowledged';
    error.shortages = plan.shortages;
    throw error;
  }
}

export async function applyFalabellaAugustPlan(pool, input) {
  if (!input.expectedPlanHash) throw new Error('Para aplicar indica el hash exacto del dry run.');
  const client = await pool.connect();
  try {
    await client.query('begin isolation level serializable');
    await client.query(`select pg_advisory_xact_lock(hashtext('falabella-august-2026-inventory'))`);
    const existing = await client.query(
      'select * from inventory_reconciliation_runs where run_key=$1 for update',
      [`falabella-august-2026:${input.workbook.sourceHash.slice(0, 24)}:${iso(input.asOf)}`],
    );
    if (existing.rows.length) {
      await client.query('commit');
      return { applied: false, idempotent: true, run: existing.rows[0] };
    }
    const plan = await buildFalabellaAugustPlan(client, input);
    if (plan.planHash !== input.expectedPlanHash) {
      const error = new Error(`El plan cambió. Esperado ${input.expectedPlanHash}; actual ${plan.planHash}. Ejecuta otro dry run.`);
      error.code = 'plan_hash_mismatch';
      throw error;
    }
    assertApplicable(plan, input.acknowledgeShortages);
    const runResult = await client.query(
      `insert into inventory_reconciliation_runs
       (run_key, plan_hash, reconciliation_kind, source_hash, cutoff_at, as_of, summary)
       values ($1,$2,'falabella_august_2026',$3,$4,$5,$6) returning *`,
      [plan.runKey, plan.planHash, plan.sourceHash, plan.cutoffAt, plan.asOf, JSON.stringify({
        commercialSales: plan.commercialSales, eventTotals: plan.eventTotals,
        quantityCorrections: plan.quantityCorrections, mappedItems: plan.mappings.length,
        itemMarkers: plan.itemPlans.map((item) => item.itemId), shortages: plan.shortages,
        shortagesAcknowledged: input.acknowledgeShortages === true,
      })],
    );
    const run = runResult.rows[0];

    const h9xln = plan.mappings.find((mapping) => mapping.method === 'explicit_historical_sku' && mapping.mainSku === 'H9XLN');
    if (h9xln?.listingId) {
      await client.query(
        `update product_listings set product_id=$1, status='active', updated_at=now()
         where id=$2 and seller_sku='140746934'`,
        [h9xln.productId, h9xln.listingId],
      );
    }

    for (const correction of plan.quantityCorrections) {
      await client.query(
        `update order_items set quantity=1, updated_at=now()
         where id=$1 and quantity=0 and not (raw_data ? 'Quantity')`,
        [correction.itemId],
      );
    }
    for (const mapping of plan.mappings) {
      await client.query(
        `update order_items set product_id=$1, listing_id=$2, main_sku=$3, updated_at=now()
         where id=$4`,
        [mapping.productId, mapping.listingId, mapping.mainSku, mapping.itemId],
      );
    }
    for (const product of plan.products) {
      await client.query(
        `insert into inventory_reconciliation_anchors
         (run_id, product_id, cutoff_quantity, target_quantity) values ($1,$2,$3,$4)`,
        [run.id, product.productId, product.cutoffQuantity, product.targetQuantity],
      );
      const anchorDelta = product.openingQuantity - product.currentQuantity;
      if (anchorDelta !== 0) {
        await applyInventoryMovement(client, {
          productId: product.productId, quantityDelta: anchorDelta,
          movementType: anchorDelta > 0 ? 'adjustment_in' : 'adjustment_out',
          reason: 'Saldo inicial de agosto reconstruido desde el conteo físico', source: 'reconciliation',
          idempotencyKey: `${plan.runKey}:anchor:${product.productId}`,
          effectiveAt: AUGUST_START, allowNegative: false,
          metadata: {
            reconciliationRunId: Number(run.id), mode: 'absolute', anchorKind: 'reconstructed_month_opening',
            targetQuantity: product.openingQuantity, physicalCountAt: plan.cutoffAt,
            physicalCountQuantity: product.cutoffQuantity,
          },
        });
      }
      if (product.preCutoffShortageQuantity > 0) {
        await applyInventoryMovement(client, {
          productId: product.productId, quantityDelta: product.preCutoffShortageQuantity,
          movementType: 'adjustment_in',
          reason: 'Faltante temporal reconocido para reconstruir agosto sin saldos negativos',
          source: 'reconciliation', idempotencyKey: `${plan.runKey}:precut-shortage:${product.productId}`,
          effectiveAt: AUGUST_START, allowNegative: false,
          metadata: {
            reconciliationRunId: Number(run.id), mode: 'acknowledged_shortage',
            phase: 'before_cutoff_replay', shortageQuantity: product.preCutoffShortageQuantity,
          },
        });
      }
    }

    const transitions = plan.itemPlans.flatMap((item) => (
      item.transitions.filter((entry) => entry.effectiveAt >= AUGUST_START)
        .map((transition) => ({ item, transition }))
    )).sort((left, right) => (
      left.transition.effectiveAt.localeCompare(right.transition.effectiveAt)
      || left.transition.eventId - right.transition.eventId
      || left.item.itemId - right.item.itemId
    ));
    const applyTransition = async ({ item, transition }) => applyInventoryMovement(client, {
      productId: item.productId, quantityDelta: transition.quantityDelta,
      movementType: transition.kind === 'exit' ? 'sale' : 'sale_reversal',
      reason: `${transition.kind === 'exit' ? 'Salida' : 'Reintegro'} conciliado del pedido ${item.orderNumber}`,
      source: 'reconciliation', orderId: item.orderId, orderItemId: item.itemId,
      listingId: item.listingId, allowNegative: false, effectiveAt: transition.effectiveAt,
      idempotencyKey: `${plan.runKey}:item:${item.itemId}:event:${transition.eventId}`,
      metadata: { reconciliationRunId: Number(run.id), eventId: transition.eventId, status: transition.status },
    });
    for (const entry of transitions.filter(({ transition }) => transition.effectiveAt < plan.cutoffAt)) {
      await applyTransition(entry);
    }

    for (const product of plan.products) {
      if (product.preCutoffShortageQuantity > 0) {
        await applyInventoryMovement(client, {
          productId: product.productId, quantityDelta: -product.preCutoffShortageQuantity,
          movementType: 'adjustment_out',
          reason: 'Cierre del faltante temporal al llegar al conteo físico',
          source: 'reconciliation', idempotencyKey: `${plan.runKey}:precut-shortage-close:${product.productId}`,
          effectiveAt: plan.cutoffAt, allowNegative: false,
          metadata: {
            reconciliationRunId: Number(run.id), mode: 'shortage_close',
            phase: 'physical_count', shortageQuantity: product.preCutoffShortageQuantity,
          },
        });
      }
      const atCutoff = await client.query(
        'select quantity_on_hand from product_inventory where product_id=$1 for update',
        [product.productId],
      );
      if (number(atCutoff.rows[0]?.quantity_on_hand) !== product.cutoffQuantity) {
        throw new Error(`El replay de ${product.mainSku} no aterrizó en el conteo físico.`);
      }
      if (product.shortageQuantity > 0) {
        await applyInventoryMovement(client, {
          productId: product.productId, quantityDelta: product.shortageQuantity,
          movementType: 'adjustment_in',
          reason: 'Faltante físico reconocido para conciliar salidas posteriores al conteo',
          source: 'reconciliation', idempotencyKey: `${plan.runKey}:shortage:${product.productId}`,
          effectiveAt: plan.cutoffAt, allowNegative: false,
          metadata: {
            reconciliationRunId: Number(run.id), mode: 'acknowledged_shortage',
            shortageQuantity: product.shortageQuantity, finalTargetQuantity: 0,
          },
        });
      }
    }

    for (const entry of transitions.filter(({ transition }) => transition.effectiveAt >= plan.cutoffAt)) {
      await applyTransition(entry);
    }
    for (const product of plan.products) {
      const final = await client.query(
        'select quantity_on_hand from product_inventory where product_id=$1 for update',
        [product.productId],
      );
      if (number(final.rows[0]?.quantity_on_hand) !== product.targetQuantity) {
        throw new Error(`El replay de ${product.mainSku} no aterrizó en el saldo objetivo.`);
      }
    }
    for (const item of plan.itemPlans) {
      const mapping = plan.mappings.find((entry) => entry.itemId === item.itemId);
      const desiredApplied = item.physicallyOut ? item.quantity : 0;
      const desiredState = item.physicallyOut ? 'applied' : 'reversed';
      await client.query(
        `update order_items set product_id=$1, listing_id=$2, main_sku=$3,
           stock_state=$4, stock_applied_quantity=$5,
           stock_revision=case when stock_state<>$4 or stock_applied_quantity<>$5 then stock_revision+1 else stock_revision end,
           updated_at=now() where id=$6`,
        [mapping.productId, mapping.listingId, mapping.mainSku, desiredState, desiredApplied, item.itemId],
      );
    }
    await client.query('commit');
    return { applied: true, idempotent: false, run, plan };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
