import { deriveInventoryTransitions, normalizeAugustQuantity } from './falabella-august-reconciliation.js';
import { applyInventoryMovement, InsufficientStockError } from './inventory-service.js';
import { HISTORICAL_SKU_TO_MASTER, historicalMasterForSku } from './historical-sku-map.js';
import { falabellaOrderItemsPayload, mapFalabellaOrderItems } from '../order-adapters/falabella.js';
import { isStockEligibleFulfillment } from './stock-phase.js';

export const SALES_HISTORY_SINCE = '2026-05-01T05:00:00.000Z';
export const PHYSICAL_COUNT_CUTOFF = '2026-08-21T19:50:00.000Z';
export const MAPPING_CHANNELS = Object.freeze(['falabella', 'ripley']);
export const ORDER_SINCE_SQL = 'coalesce(o.ordered_at, o.created_at)';

const METHOD_RANK = Object.freeze({
  active_seller_sku: 5,
  active_shop_sku: 4,
  existing_listing: 3,
  existing_product_id: 2,
  explicit_historical_sku: 1,
  exact_main_sku: 1,
});

const STATUS_RANK = Object.freeze({
  mapped: 0,
  unmapped: 1,
  missing_master: 2,
  doubtful: 3,
});

const TERMINAL_STATUSES = new Set(['cancelled', 'canceled', 'failed', 'returned']);

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function listingKey(channelCode, companyId, sku) {
  return `${String(channelCode || '')}\u0000${Number(companyId)}\u0000${String(sku || '').trim()}`;
}

function addUnique(map, key, listing) {
  if (!key || key.endsWith('\u0000')) return;
  const current = map.get(key);
  if (current === undefined) map.set(key, listing);
  else map.set(key, null);
}

export function buildListingIndexes(listings) {
  const sellerActive = new Map();
  const shopActive = new Map();
  const sellerAny = new Map();
  const unlinkedSeller = new Map();
  for (const listing of listings) {
    const seller = listingKey(listing.channel_code, listing.company_id, listing.seller_sku);
    if (listing.status === 'unlinked') {
      addUnique(unlinkedSeller, seller, listing);
      continue;
    }
    addUnique(sellerAny, seller, listing);
    if (listing.status !== 'active') continue;
    addUnique(sellerActive, seller, listing);
    addUnique(shopActive, listingKey(listing.channel_code, listing.company_id, listing.shop_sku), listing);
  }
  return { sellerActive, shopActive, sellerAny, unlinkedSeller };
}

export function classifyCountPresence(mainSku, catalog = {}) {
  const countedSkus = catalog.countedSkus || new Set();
  const skusWithoutQuantity = catalog.skusWithoutQuantity || new Set();
  if (skusWithoutQuantity.has(mainSku)) return 'excel_without_quantity';
  if (countedSkus.has(mainSku)) return 'excel_counted';
  return 'absent_from_excel';
}

export function ledgerPolicyForPresence(presence) {
  if (presence === 'excel_counted') return 'deduct_after_cutoff';
  if (presence === 'excel_without_quantity') return 'review_no_deduct';
  return 'map_only_no_deduct';
}

export function planWarehouseExit(item, events = [], cutoffAt = PHYSICAL_COUNT_CUTOFF) {
  const quantity = Math.max(number(item.quantity), 0);
  const timeline = deriveInventoryTransitions(events, quantity || 1);
  const exit = timeline.transitions.find((entry) => entry.kind === 'exit');
  if (exit && timeline.physicallyOut) {
    const afterCutoff = new Date(exit.effectiveAt).getTime() >= new Date(cutoffAt).getTime();
    return { physicallyOut: true, effectiveAt: exit.effectiveAt, afterCutoff, source: 'order_event' };
  }
  if (exit && !timeline.physicallyOut) {
    return { physicallyOut: false, effectiveAt: exit.effectiveAt, afterCutoff: false, source: 'order_event_reversed' };
  }
  const orderStatus = String(item.order_status || '').toLowerCase();
  const fulfillment = String(item.fulfillment_status || '').toLowerCase();
  if (TERMINAL_STATUSES.has(orderStatus) || TERMINAL_STATUSES.has(fulfillment)) {
    return { physicallyOut: false, effectiveAt: null, afterCutoff: false, source: 'terminal' };
  }
  if (!isStockEligibleFulfillment(fulfillment)) {
    return { physicallyOut: false, effectiveAt: null, afterCutoff: false, source: 'not_eligible' };
  }
  const at = item.ordered_at || item.created_at
    ? new Date(item.ordered_at || item.created_at).toISOString()
    : null;
  const afterCutoff = at ? new Date(at).getTime() >= new Date(cutoffAt).getTime() : false;
  return { physicallyOut: true, effectiveAt: at, afterCutoff, source: 'fulfillment_ordered_at' };
}

export function planSaleLedgerAction(line, exit, { alreadyApplied = false, hasMovement = false } = {}) {
  if (line.status !== 'mapped') return { action: 'none' };
  if (!exit?.physicallyOut) return { action: 'skip_not_exited' };
  if (!exit.afterCutoff) return { action: 'skip_before_cutoff' };
  if (line.ledgerPolicy !== 'deduct_after_cutoff') return { action: 'skip_not_counted' };
  if (alreadyApplied || hasMovement) return { action: 'already_deducted' };
  if (!(number(line.quantity) > 0)) return { action: 'skip_not_exited' };
  return {
    action: 'deduct',
    quantity: number(line.quantity),
    effectiveAt: exit.effectiveAt,
    productId: line.productId,
  };
}

function eventsByOrderId(events = []) {
  const grouped = new Map();
  for (const event of events) {
    const orderId = Number(event.order_id);
    const list = grouped.get(orderId) || [];
    list.push(event);
    grouped.set(orderId, list);
  }
  return grouped;
}

function pushCandidate(candidates, product, listing, method) {
  if (!product) return;
  candidates.push({ product, listing: listing || null, method });
}

function conflictReason(candidates) {
  const skus = [...new Set(candidates.map((candidate) => candidate.product.main_sku))];
  return `Identidad apunta a varios maestros: ${skus.join(', ')}`;
}

function pickCandidate(candidates) {
  const byProduct = new Map();
  for (const candidate of candidates) {
    const id = Number(candidate.product.id);
    const current = byProduct.get(id);
    if (!current || (METHOD_RANK[candidate.method] || 0) > (METHOD_RANK[current.method] || 0)) {
      byProduct.set(id, candidate);
    }
  }
  if (byProduct.size > 1) {
    return { status: 'doubtful', reason: conflictReason([...byProduct.values()]) };
  }
  if (byProduct.size === 1) return { status: 'mapped', ...[...byProduct.values()][0] };
  return null;
}

export function resolveSaleItem(item, context) {
  const channelCode = String(item.channel_code || '').trim();
  const companyId = Number(item.company_id);
  const sellerSku = String(item.sku || '').trim();
  const shopSku = String(item.provider_sku || '').trim();
  const historicalMap = context.historicalMap || HISTORICAL_SKU_TO_MASTER;
  const candidates = [];

  const unlinked = context.indexes.unlinkedSeller?.get(listingKey(channelCode, companyId, sellerSku));
  if (unlinked !== undefined) {
    return {
      status: 'doubtful',
      reason: 'La publicación está desvinculada; no se asocia ni se descuenta',
    };
  }

  if (item.product_id != null && item.product_id !== '') {
    const product = context.productsById.get(Number(item.product_id));
    if (!product) {
      return {
        status: 'doubtful',
        reason: 'product_id apunta a un maestro que no existe',
      };
    }
    const listed = item.listing_id != null
      ? context.listingsById.get(Number(item.listing_id)) || null
      : null;
    pushCandidate(candidates, product, listed, 'existing_product_id');
  }

  const exactSeller = context.indexes.sellerActive.get(listingKey(channelCode, companyId, sellerSku));
  if (exactSeller === null) {
    return { status: 'doubtful', reason: 'seller_sku activo ambiguo' };
  }
  if (exactSeller) {
    pushCandidate(
      candidates,
      context.productsById.get(Number(exactSeller.product_id)),
      exactSeller,
      'active_seller_sku',
    );
  }

  const exactShop = context.indexes.shopActive.get(listingKey(channelCode, companyId, shopSku));
  if (exactShop === null) {
    return { status: 'doubtful', reason: 'shop_sku activo ambiguo' };
  }
  if (exactShop) {
    pushCandidate(
      candidates,
      context.productsById.get(Number(exactShop.product_id)),
      exactShop,
      'active_shop_sku',
    );
  }

  const existingListing = context.indexes.sellerAny.get(listingKey(channelCode, companyId, sellerSku));
  if (existingListing && existingListing !== null) {
    pushCandidate(
      candidates,
      context.productsById.get(Number(existingListing.product_id)),
      existingListing,
      'existing_listing',
    );
  }

  const hintSku = String(item.main_sku || item.productSku || '').trim();
  const historicalSku = [sellerSku, shopSku, hintSku].find((sku) => historicalMasterForSku(sku, historicalMap));
  if (historicalSku) {
    const mainSku = historicalMasterForSku(historicalSku, historicalMap);
    const product = context.productsBySku.get(mainSku);
    if (!product && candidates.length === 0) {
      return {
        status: 'missing_master',
        reason: `El mapeo histórico ${historicalSku} → ${mainSku} no tiene maestro`,
        mainSku,
      };
    }
    if (product) {
      const historicalListing = context.listings.find((listing) => (
        listing.channel_code === channelCode
        && Number(listing.company_id) === companyId
        && listing.status !== 'unlinked'
        && (listing.seller_sku === historicalSku || listing.shop_sku === historicalSku)
      )) || null;
      pushCandidate(candidates, product, historicalListing, 'explicit_historical_sku');
    }
  }

  for (const sku of [sellerSku, shopSku, hintSku]) {
    if (!sku) continue;
    const product = context.productsBySku.get(sku);
    if (product) pushCandidate(candidates, product, exactSeller || existingListing || exactShop || null, 'exact_main_sku');
  }

  const picked = pickCandidate(candidates);
  if (picked?.status === 'doubtful') return picked;
  if (picked?.status === 'mapped') {
    const presence = classifyCountPresence(picked.product.main_sku, context.countCatalog);
    return {
      status: 'mapped',
      product: picked.product,
      listing: picked.listing,
      method: picked.method,
      mainSku: picked.product.main_sku,
      countPresence: presence,
      ledgerPolicy: ledgerPolicyForPresence(presence),
      reason: presence === 'excel_without_quantity'
        ? 'El Excel no tiene cantidad para este maestro'
        : null,
    };
  }

  return {
    status: 'unmapped',
    reason: 'No existe listing activo exacto ni mapeo histórico ni SKU interno coincidente',
  };
}

function identityKey(item) {
  return [
    item.channel_code,
    Number(item.company_id),
    String(item.sku || '').trim(),
    String(item.provider_sku || '').trim(),
  ].join('\u0000');
}

function worseStatus(current, next) {
  return (STATUS_RANK[next] || 0) >= (STATUS_RANK[current] || 0) ? next : current;
}

function mappingNeedsWrite(item, resolved) {
  if (resolved.status !== 'mapped') return false;
  const productId = Number(resolved.product.id);
  const listingId = resolved.listing ? Number(resolved.listing.id) : null;
  const currentProductId = item.product_id == null || item.product_id === '' ? null : Number(item.product_id);
  const currentListingId = item.listing_id == null || item.listing_id === '' ? null : Number(item.listing_id);
  if (currentProductId != null && currentProductId !== productId) return false;
  return currentProductId !== productId
    || (listingId != null && currentListingId !== listingId)
    || String(item.main_sku || '') !== resolved.product.main_sku;
}

export function buildHistoricalSalesCoverage({
  items,
  products,
  listings,
  countedSkus = new Set(),
  skusWithoutQuantity = new Set(),
  historicalMap = HISTORICAL_SKU_TO_MASTER,
  since = SALES_HISTORY_SINCE,
  cutoffAt = PHYSICAL_COUNT_CUTOFF,
  events = [],
  deductedItemIds = new Set(),
  falabellaInbox = [],
  emptyOrders = [],
} = {}) {
  const productsById = new Map(products.map((product) => [Number(product.id), product]));
  const productsBySku = new Map(products.map((product) => [product.main_sku, product]));
  const listingsById = new Map(listings.map((listing) => [Number(listing.id), listing]));
  const indexes = buildListingIndexes(listings);
  const countCatalog = { countedSkus, skusWithoutQuantity };
  const context = {
    productsById, productsBySku, listingsById, listings, indexes, historicalMap, countCatalog,
  };
  const eventsByOrder = eventsByOrderId(events);
  const lines = [];
  const grouped = new Map();

  for (const item of items) {
    const resolved = resolveSaleItem(item, context);
    const quantity = normalizeAugustQuantity(item).quantity;
    const orderedAt = item.ordered_at ? new Date(item.ordered_at).toISOString() : null;
    const exit = planWarehouseExit(
      { ...item, quantity },
      eventsByOrder.get(Number(item.order_id)) || [],
      cutoffAt,
    );
    const line = {
      itemId: Number(item.id),
      orderId: Number(item.order_id),
      orderNumber: item.external_order_number || null,
      channelCode: item.channel_code,
      companyId: Number(item.company_id),
      channelAccountId: item.channel_account_id == null ? null : Number(item.channel_account_id),
      sellerSku: String(item.sku || '').trim(),
      shopSku: String(item.provider_sku || '').trim(),
      title: item.description || null,
      quantity,
      orderedAt,
      afterCutoff: exit.afterCutoff,
      exitAt: exit.effectiveAt,
      exitSource: exit.source,
      physicallyOut: exit.physicallyOut,
      currentProductId: item.product_id == null ? null : Number(item.product_id),
      currentListingId: item.listing_id == null ? null : Number(item.listing_id),
      currentMainSku: item.main_sku || null,
      stockAppliedQuantity: number(item.stock_applied_quantity),
      status: resolved.status,
      reason: resolved.reason || null,
      method: resolved.method || null,
      productId: resolved.product ? Number(resolved.product.id) : null,
      mainSku: resolved.mainSku || resolved.product?.main_sku || null,
      listingId: resolved.listing ? Number(resolved.listing.id) : null,
      countPresence: resolved.countPresence || null,
      ledgerPolicy: resolved.ledgerPolicy || null,
      needsWrite: false,
      ledgerAction: 'none',
    };
    line.needsWrite = mappingNeedsWrite(item, resolved);
    const ledger = planSaleLedgerAction(line, exit, {
      alreadyApplied: number(item.stock_applied_quantity) > 0,
      hasMovement: deductedItemIds.has(Number(item.id)),
    });
    line.ledgerAction = ledger.action;
    lines.push(line);

    const key = identityKey(item);
    const identity = grouped.get(key) || {
      channel: item.channel_code,
      company_id: Number(item.company_id),
      seller_sku: String(item.sku || '').trim(),
      shop_sku: String(item.provider_sku || '').trim(),
      title: item.description || null,
      lines: 0,
      units: 0,
      units_before_cutoff: 0,
      units_after_cutoff: 0,
      first_ordered_at: orderedAt,
      last_ordered_at: orderedAt,
      status: 'mapped',
      reason: null,
      main_sku: null,
      method: null,
      count_presence: null,
      ledger_policy: null,
      already_mapped_lines: 0,
      needs_write_lines: 0,
      to_deduct_units: 0,
    };
    identity.lines += 1;
    identity.units += quantity;
    if (exit.afterCutoff) identity.units_after_cutoff += quantity;
    else identity.units_before_cutoff += quantity;
    if (orderedAt && (!identity.first_ordered_at || orderedAt < identity.first_ordered_at)) {
      identity.first_ordered_at = orderedAt;
    }
    if (orderedAt && (!identity.last_ordered_at || orderedAt > identity.last_ordered_at)) {
      identity.last_ordered_at = orderedAt;
    }
    if (!identity.title && item.description) identity.title = item.description;
    identity.status = worseStatus(identity.status, line.status);
    if (line.status !== 'mapped' || identity.status !== 'mapped' || line.ledgerPolicy === 'review_no_deduct') {
      identity.reason = line.reason || identity.reason;
    }
    if (line.mainSku) identity.main_sku = line.mainSku;
    if (line.method) identity.method = line.method;
    identity.count_presence = line.countPresence || identity.count_presence;
    identity.ledger_policy = line.ledgerPolicy || identity.ledger_policy;
    if (line.status === 'mapped' && !line.needsWrite) identity.already_mapped_lines += 1;
    if (line.needsWrite) identity.needs_write_lines += 1;
    if (line.ledgerAction === 'deduct') identity.to_deduct_units += quantity;
    grouped.set(key, identity);
  }

  const emptyOrderGaps = buildEmptyUnifiedOrderGapIdentities(emptyOrders);
  const inboxGaps = buildFalabellaInboxGapIdentities(falabellaInbox, {
    orders: new Set([
      ...items.map((item) => `${Number(item.company_id)}\u0000${String(item.external_order_id || '').trim()}`),
      ...emptyOrders.map((row) => `${Number(row.company_id)}\u0000${String(row.external_order_id || '').trim()}`),
    ]),
    items: new Set(items.map((item) => `${Number(item.company_id)}\u0000${String(item.external_order_id || '').trim()}\u0000${String(item.external_item_id || '').trim()}`)),
  });
  const identities = [...grouped.values(), ...inboxGaps, ...emptyOrderGaps].sort((left, right) => (
    String(left.channel).localeCompare(String(right.channel))
    || Number(left.company_id) - Number(right.company_id)
    || String(left.seller_sku).localeCompare(String(right.seller_sku))
    || String(left.shop_sku).localeCompare(String(right.shop_sku))
  ));
  const review = identities.filter((identity) => identityNeedsReview(identity));
  const toApply = lines.filter((line) => line.needsWrite);
  const toDeduct = lines.filter((line) => line.ledgerAction === 'deduct');
  const deductByProduct = new Map();
  for (const line of toDeduct) {
    deductByProduct.set(line.productId, number(deductByProduct.get(line.productId)) + line.quantity);
  }
  const shortages = products.flatMap((product) => {
    const units = number(deductByProduct.get(Number(product.id)));
    if (!countedSkus.has(product.main_sku) || units <= 0) return [];
    const onHand = number(product.quantity_on_hand);
    if (onHand >= units) return [];
    return [{
      productId: Number(product.id),
      mainSku: product.main_sku,
      onHand,
      units,
      shortage: units - onHand,
      reason: 'Las salidas posteriores al conteo superan el stock actual del maestro contado.',
    }];
  });

  return {
    since,
    cutoffAt,
    channels: [...MAPPING_CHANNELS],
    summary: {
      lines: lines.length,
      identities: identities.length,
      mapped: lines.filter((line) => line.status === 'mapped').length,
      unmapped: lines.filter((line) => line.status === 'unmapped').length,
      doubtful: lines.filter((line) => line.status === 'doubtful').length,
      missing_master: lines.filter((line) => line.status === 'missing_master').length,
      already_mapped: lines.filter((line) => line.status === 'mapped' && !line.needsWrite).length,
      to_apply: toApply.length,
      to_deduct: toDeduct.length,
      already_deducted: lines.filter((line) => line.ledgerAction === 'already_deducted').length,
      skip_before_cutoff: lines.filter((line) => line.ledgerAction === 'skip_before_cutoff').length,
      skip_not_counted: lines.filter((line) => line.ledgerAction === 'skip_not_counted').length,
      review_identities: review.length,
      inbox_gaps: inboxGaps.length,
      header_gaps: emptyOrderGaps.length,
      shortages: shortages.length,
    },
    identities,
    review,
    shortages,
    lines,
    toApply,
    toDeduct,
  };
}

export function identityNeedsReview(identity) {
  return identity.status !== 'mapped' || identity.ledger_policy === 'review_no_deduct';
}

function saleGapIdentity(base) {
  return {
    channel: base.channel || 'falabella',
    company_id: Number(base.companyId),
    seller_sku: base.sellerSku || '',
    shop_sku: base.shopSku || '',
    title: base.title || null,
    lines: 1,
    units: number(base.units),
    units_before_cutoff: 0,
    units_after_cutoff: number(base.units),
    first_ordered_at: base.orderedAt || null,
    last_ordered_at: base.orderedAt || null,
    status: 'unmapped',
    reason: base.reason,
    main_sku: null,
    method: null,
    count_presence: null,
    ledger_policy: null,
    already_mapped_lines: 0,
    needs_write_lines: 0,
    to_deduct_units: 0,
  };
}

export function buildEmptyUnifiedOrderGapIdentities(emptyOrders = []) {
  return emptyOrders.flatMap((row) => {
    const orderId = String(row.external_order_id || '').trim();
    if (!orderId) return [];
    return [saleGapIdentity({
      channel: row.channel_code || row.channel,
      companyId: row.company_id,
      title: `Pedido ${row.external_order_number || orderId}`,
      orderedAt: row.ordered_at,
      units: 0,
      reason: 'El pedido unificado no trae líneas; no se asocia ni se descuenta',
    })];
  });
}

export function buildFalabellaInboxGapIdentities(inboxRows = [], unifiedKeys = { orders: new Set(), items: new Set() }) {
  const identities = [];
  for (const row of inboxRows) {
    const companyId = Number(row.company_id || row.companyId || 0);
    const orderId = String(row.order_id || row.orderId || '').trim();
    if (!orderId) continue;
    const orderKey = `${companyId}\u0000${orderId}`;
    const orderedAt = row.falabella_created_at || row.orderedAt || null;
    const orderTitle = `Pedido ${row.order_number || row.orderNumber || orderId}`;
    const items = mapFalabellaOrderItems(falabellaOrderItemsPayload(row.raw_data || row.rawData));
    if (!items.length) {
      if (unifiedKeys.orders.has(orderKey)) continue;
      identities.push(saleGapIdentity({
        companyId,
        title: orderTitle,
        orderedAt,
        units: 0,
        reason: 'El inbox Falabella no trae líneas; no se asocia ni se descuenta',
      }));
      continue;
    }
    for (const item of items) {
      const itemId = String(item.externalItemId || '').trim();
      if (itemId && unifiedKeys.items.has(`${orderKey}\u0000${itemId}`)) continue;
      if (!itemId && unifiedKeys.orders.has(orderKey)) continue;
      identities.push(saleGapIdentity({
        companyId,
        sellerSku: item.sku,
        shopSku: item.providerSku,
        title: item.description || orderTitle,
        orderedAt,
        units: Number(item.quantity) || 1,
        reason: 'Línea Falabella del inbox ausente del pedido unificado; no se asocia ni se descuenta',
      }));
    }
  }
  return identities;
}

function tsvEscape(value) {
  return String(value ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
}

export function formatReviewTsv(identities) {
  const header = [
    'channel', 'company_id', 'seller_sku', 'shop_sku', 'title', 'lines', 'units',
    'units_before_cutoff', 'units_after_cutoff', 'first_ordered_at', 'last_ordered_at',
    'status', 'reason', 'main_sku', 'method', 'count_presence', 'ledger_policy',
  ];
  const rows = identities.filter((identity) => identityNeedsReview(identity));
  return `${[header.join('\t'), ...rows.map((row) => header.map((key) => tsvEscape(row[key])).join('\t'))].join('\n')}\n`;
}

export function formatCoverageTsv(identities) {
  const header = [
    'channel', 'company_id', 'seller_sku', 'shop_sku', 'title', 'lines', 'units',
    'units_before_cutoff', 'units_after_cutoff', 'to_deduct_units',
    'first_ordered_at', 'last_ordered_at', 'status', 'reason', 'main_sku', 'method',
    'count_presence', 'ledger_policy',
  ];
  return `${[header.join('\t'), ...identities.map((row) => header.map((key) => tsvEscape(row[key])).join('\t'))].join('\n')}\n`;
}

export function formatShortagesTsv(shortages = []) {
  const header = ['main_sku', 'product_id', 'on_hand', 'units', 'shortage', 'reason'];
  const rows = shortages.map((row) => [
    row.mainSku, row.productId, row.onHand, row.units, row.shortage, row.reason,
  ]);
  return `${[header.join('\t'), ...rows.map((row) => row.map((value) => tsvEscape(value)).join('\t'))].join('\n')}\n`;
}

async function inventoryFingerprint(db) {
  const inventory = await db.query(
    'select product_id, quantity_on_hand, quantity_reserved from product_inventory order by product_id',
  );
  const ledger = await db.query(
    'select count(*)::integer as count, coalesce(max(id),0)::bigint as max_id from inventory_movements',
  );
  return { inventory: inventory.rows, ledger: ledger.rows[0] };
}

export async function loadHistoricalSalesMappingContext(db, { since = SALES_HISTORY_SINCE } = {}) {
  const products = (await db.query(
    `select p.id, p.main_sku, p.name, coalesce(i.quantity_on_hand,0) quantity_on_hand
     from products p left join product_inventory i on i.product_id=p.id order by p.id`,
  )).rows;
  const listings = (await db.query(
    `select id, product_id, channel_code, company_id, channel_account_id, seller_sku, shop_sku, status, title
     from product_listings where channel_code=any($1::text[]) order by id`,
    [MAPPING_CHANNELS],
  )).rows;
  const items = (await db.query(
    `select oi.id, oi.order_id, oi.external_item_id, oi.sku, oi.provider_sku, oi.description, oi.quantity, oi.raw_data,
       oi.product_id, oi.listing_id, oi.main_sku, oi.stock_state, oi.stock_applied_quantity,
       o.company_id, o.channel_account_id, o.external_order_id, o.external_order_number,
       ${ORDER_SINCE_SQL} as ordered_at,
       o.order_status, o.fulfillment_status, ch.code as channel_code
     from order_items oi
     join orders o on o.id=oi.order_id
     join order_channel_accounts a on a.id=o.channel_account_id
     join order_channels ch on ch.id=a.channel_id
     where ch.code=any($1::text[]) and ${ORDER_SINCE_SQL} >= $2
     order by oi.id`,
    [MAPPING_CHANNELS, since],
  )).rows;
  const orderIds = [...new Set(items.map((item) => Number(item.order_id)))];
  const itemIds = items.map((item) => Number(item.id));
  const events = orderIds.length ? (await db.query(
    `select id, order_id, event_type, new_values, provider_occurred_at
     from order_events
     where order_id=any($1::bigint[]) and provider_occurred_at is not null
     order by order_id, provider_occurred_at, id`,
    [orderIds],
  )).rows : [];
  const deducted = itemIds.length ? (await db.query(
    `select distinct order_item_id
     from inventory_movements
     where order_item_id=any($1::bigint[])
       and movement_type in ('sale', 'sale_adjust')`,
    [itemIds],
  )).rows : [];
  const falabellaInbox = (await db.query(
    `select c.id as company_id, fo.order_id, fo.order_number, fo.status,
       fo.falabella_created_at, fo.raw_data
     from falabella_orders fo
     join companies c on c.id = fo.company_id
     where coalesce(fo.falabella_created_at, fo.first_seen_at) >= $1::timestamptz
     order by fo.falabella_created_at, fo.order_id`,
    [since],
  )).rows;
  const emptyOrders = (await db.query(
    `select o.company_id, o.external_order_id, o.external_order_number,
       ${ORDER_SINCE_SQL} as ordered_at,
       ch.code as channel_code
     from orders o
     join order_channel_accounts a on a.id = o.channel_account_id
     join order_channels ch on ch.id = a.channel_id
     where ch.code = any($1::text[])
       and ${ORDER_SINCE_SQL} >= $2
       and not exists (
         select 1 from order_items missing_items where missing_items.order_id = o.id
       )
     order by o.id`,
    [MAPPING_CHANNELS, since],
  )).rows;
  return {
    products,
    listings,
    items,
    events,
    deductedItemIds: new Set(deducted.map((row) => Number(row.order_item_id))),
    falabellaInbox,
    emptyOrders,
  };
}

export async function applyHistoricalSalesMappings(pool, input = {}) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`select pg_advisory_xact_lock(hashtext('historical-sales-mapping-since-may-2026'))`);
    const before = await inventoryFingerprint(client);
    const loaded = await loadHistoricalSalesMappingContext(client, { since: input.since });
    const coverage = buildHistoricalSalesCoverage({
      ...loaded,
      countedSkus: input.countedSkus,
      skusWithoutQuantity: input.skusWithoutQuantity,
      historicalMap: input.historicalMap,
      since: input.since,
      cutoffAt: input.cutoffAt,
    });

    const listingCache = new Map(loaded.listings.map((listing) => [
      listingKey(listing.channel_code, listing.company_id, listing.seller_sku),
      listing,
    ]));
    let createdListings = 0;
    let updatedItems = 0;

    for (const line of coverage.toApply) {
      let listingId = line.listingId;
      if (!listingId && line.sellerSku) {
        const key = listingKey(line.channelCode, line.companyId, line.sellerSku);
        let listing = listingCache.get(key);
        if (!listing) {
          const inserted = await client.query(
            `insert into product_listings (
               product_id, channel_code, company_id, channel_account_id, seller_sku, shop_sku,
               external_product_id, title, status, marketplace_quantity, metadata
             ) values ($1,$2,$3,$4,$5,$6,$6,$7,'inactive',0,$8)
             on conflict (channel_code, company_id, seller_sku) do nothing
             returning *`,
            [
              line.productId,
              line.channelCode,
              line.companyId,
              line.channelAccountId,
              line.sellerSku,
              line.shopSku || null,
              line.title,
              JSON.stringify({
                source: 'historical_sales_mapping',
                salesHistorySince: SALES_HISTORY_SINCE,
                ledgerPolicy: line.ledgerPolicy,
              }),
            ],
          );
          if (inserted.rows[0]) {
            listing = inserted.rows[0];
            createdListings += 1;
          } else {
            listing = (await client.query(
              `select * from product_listings
               where channel_code=$1 and company_id=$2 and seller_sku=$3`,
              [line.channelCode, line.companyId, line.sellerSku],
            )).rows[0];
          }
          if (listing) listingCache.set(key, listing);
        }
        if (listing && Number(listing.product_id) !== line.productId) {
          throw new Error(`${line.channelCode}/${line.companyId}/${line.sellerSku} ya está asociado a otro maestro.`);
        }
        listingId = listing ? Number(listing.id) : null;
      }

      const updated = await client.query(
        `update order_items set
           product_id=$1,
           listing_id=coalesce($2, listing_id),
           main_sku=$3,
           updated_at=now()
         where id=$4
           and (product_id is null or product_id=$1)`,
        [line.productId, listingId, line.mainSku, line.itemId],
      );
      updatedItems += updated.rowCount;
    }

    const countedProductIds = new Set(
      loaded.products
        .filter((product) => (input.countedSkus || new Set()).has(product.main_sku))
        .map((product) => Number(product.id)),
    );
    let deductedItems = 0;
    const appliedShortages = [];
    const toDeduct = [...coverage.toDeduct].sort((left, right) => (
      String(left.exitAt || '').localeCompare(String(right.exitAt || ''))
      || left.itemId - right.itemId
    ));
    for (const line of toDeduct) {
      try {
        const result = await applyInventoryMovement(client, {
          productId: line.productId,
          quantityDelta: -line.quantity,
          movementType: 'sale',
          reason: line.orderNumber ? `Venta del pedido ${line.orderNumber}` : 'Venta posterior al conteo físico',
          source: 'historical_sales_mapping',
          orderId: line.orderId,
          orderItemId: line.itemId,
          listingId: line.listingId,
          allowNegative: false,
          effectiveAt: line.exitAt,
          idempotencyKey: `historical-sales-mapping:item:${line.itemId}:exit`,
          metadata: {
            salesHistorySince: SALES_HISTORY_SINCE,
            cutoffAt: coverage.cutoffAt,
            channelCode: line.channelCode,
            ledgerPolicy: line.ledgerPolicy,
          },
        });
        if (result.applied === true) {
          deductedItems += 1;
          await client.query(
            `update order_items set
               stock_state='applied',
               stock_applied_quantity=$1,
               stock_revision=stock_revision+1,
               updated_at=now()
             where id=$2`,
            [line.quantity, line.itemId],
          );
        }
      } catch (error) {
        if (error instanceof InsufficientStockError || error.code === 'insufficient_stock') {
          appliedShortages.push({
            itemId: line.itemId,
            mainSku: line.mainSku,
            productId: line.productId,
            quantity: line.quantity,
            onHand: error.onHand,
            reason: 'Las salidas posteriores al conteo superan el stock actual del maestro contado.',
          });
          continue;
        }
        throw error;
      }
    }

    const after = await inventoryFingerprint(client);
    const beforeByProduct = new Map(before.inventory.map((row) => [Number(row.product_id), row]));
    for (const row of after.inventory) {
      const productId = Number(row.product_id);
      const previous = beforeByProduct.get(productId);
      if (!previous) continue;
      if (Number(row.quantity_reserved) !== Number(previous.quantity_reserved)) {
        throw new Error(`El mapeo cambió el stock reservado del producto ${productId}.`);
      }
      if (!countedProductIds.has(productId)
        && Number(row.quantity_on_hand) !== Number(previous.quantity_on_hand)) {
        throw new Error(`El maestro ${productId} no está contado en el Excel y no debe descontar.`);
      }
    }

    await client.query('commit');
    return {
      coverage,
      createdListings,
      updatedItems,
      deductedItems,
      shortages: [...coverage.shortages, ...appliedShortages],
      inventoryUnchanged: deductedItems === 0,
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
