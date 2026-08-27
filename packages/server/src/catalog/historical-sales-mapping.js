import { HISTORICAL_SKU_TO_MASTER } from './historical-sku-map.js';

export const SALES_HISTORY_SINCE = '2026-05-01T05:00:00.000Z';
export const PHYSICAL_COUNT_CUTOFF = '2026-08-21T19:50:00.000Z';
export const MAPPING_CHANNELS = Object.freeze(['falabella', 'ripley']);

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
  for (const listing of listings) {
    if (listing.status === 'unlinked') continue;
    const seller = listingKey(listing.channel_code, listing.company_id, listing.seller_sku);
    addUnique(sellerAny, seller, listing);
    if (listing.status !== 'active') continue;
    addUnique(sellerActive, seller, listing);
    addUnique(shopActive, listingKey(listing.channel_code, listing.company_id, listing.shop_sku), listing);
  }
  return { sellerActive, shopActive, sellerAny };
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

  const historicalSku = [sellerSku, shopSku].find((sku) => historicalMap[sku]);
  if (historicalSku) {
    const mainSku = historicalMap[historicalSku];
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

  for (const sku of [sellerSku, shopSku]) {
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
} = {}) {
  const productsById = new Map(products.map((product) => [Number(product.id), product]));
  const productsBySku = new Map(products.map((product) => [product.main_sku, product]));
  const listingsById = new Map(listings.map((listing) => [Number(listing.id), listing]));
  const indexes = buildListingIndexes(listings);
  const countCatalog = { countedSkus, skusWithoutQuantity };
  const context = {
    productsById, productsBySku, listingsById, listings, indexes, historicalMap, countCatalog,
  };
  const cutoff = new Date(cutoffAt).getTime();
  const lines = [];
  const grouped = new Map();

  for (const item of items) {
    const resolved = resolveSaleItem(item, context);
    const quantity = number(item.quantity);
    const orderedAt = item.ordered_at ? new Date(item.ordered_at).toISOString() : null;
    const afterCutoff = orderedAt ? new Date(orderedAt).getTime() >= cutoff : false;
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
      afterCutoff,
      currentProductId: item.product_id == null ? null : Number(item.product_id),
      currentListingId: item.listing_id == null ? null : Number(item.listing_id),
      currentMainSku: item.main_sku || null,
      status: resolved.status,
      reason: resolved.reason || null,
      method: resolved.method || null,
      productId: resolved.product ? Number(resolved.product.id) : null,
      mainSku: resolved.mainSku || resolved.product?.main_sku || null,
      listingId: resolved.listing ? Number(resolved.listing.id) : null,
      countPresence: resolved.countPresence || null,
      ledgerPolicy: resolved.ledgerPolicy || null,
      needsWrite: mappingNeedsWrite(item, resolved),
    };
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
    };
    identity.lines += 1;
    identity.units += quantity;
    if (afterCutoff) identity.units_after_cutoff += quantity;
    else identity.units_before_cutoff += quantity;
    if (orderedAt && (!identity.first_ordered_at || orderedAt < identity.first_ordered_at)) {
      identity.first_ordered_at = orderedAt;
    }
    if (orderedAt && (!identity.last_ordered_at || orderedAt > identity.last_ordered_at)) {
      identity.last_ordered_at = orderedAt;
    }
    if (!identity.title && item.description) identity.title = item.description;
    identity.status = worseStatus(identity.status, line.status);
    if (line.status !== 'mapped' || identity.status !== 'mapped') {
      identity.reason = line.reason || identity.reason;
    }
    if (line.mainSku) identity.main_sku = line.mainSku;
    if (line.method) identity.method = line.method;
    identity.count_presence = line.countPresence || identity.count_presence;
    identity.ledger_policy = line.ledgerPolicy || identity.ledger_policy;
    if (line.status === 'mapped' && !line.needsWrite) identity.already_mapped_lines += 1;
    if (line.needsWrite) identity.needs_write_lines += 1;
    grouped.set(key, identity);
  }

  const identities = [...grouped.values()].sort((left, right) => (
    String(left.channel).localeCompare(String(right.channel))
    || Number(left.company_id) - Number(right.company_id)
    || String(left.seller_sku).localeCompare(String(right.seller_sku))
    || String(left.shop_sku).localeCompare(String(right.shop_sku))
  ));
  const review = identities.filter((identity) => identity.status !== 'mapped');
  const toApply = lines.filter((line) => line.needsWrite);

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
      review_identities: review.length,
    },
    identities,
    review,
    lines,
    toApply,
  };
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
  const rows = identities.filter((identity) => identity.status !== 'mapped');
  return `${[header.join('\t'), ...rows.map((row) => header.map((key) => tsvEscape(row[key])).join('\t'))].join('\n')}\n`;
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
    `select oi.id, oi.order_id, oi.sku, oi.provider_sku, oi.description, oi.quantity,
       oi.product_id, oi.listing_id, oi.main_sku, oi.stock_state, oi.stock_applied_quantity,
       o.company_id, o.channel_account_id, o.external_order_number, o.ordered_at,
       o.order_status, o.fulfillment_status, ch.code as channel_code
     from order_items oi
     join orders o on o.id=oi.order_id
     join order_channel_accounts a on a.id=o.channel_account_id
     join order_channels ch on ch.id=a.channel_id
     where ch.code=any($1::text[]) and o.ordered_at >= $2
     order by oi.id`,
    [MAPPING_CHANNELS, since],
  )).rows;
  return { products, listings, items };
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

    const after = await inventoryFingerprint(client);
    if (JSON.stringify(after) !== JSON.stringify(before)) {
      throw new Error('El mapeo no debe crear movimientos ni cambiar cantidades de inventario.');
    }

    await client.query('commit');
    return { coverage, createdListings, updatedItems, inventoryUnchanged: true };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
