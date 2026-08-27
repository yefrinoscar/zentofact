import {
  INVENTORY_COUNT_MASTER_SKUS,
  INVENTORY_COUNT_SKUS_WITHOUT_QUANTITY,
} from '../../../../scripts/lib/inventory-count-2026-08-21.mjs';
import { excelMasterForSku } from './historical-sku-map.js';
import { MAPPING_CHANNELS, PHYSICAL_COUNT_CUTOFF, SALES_HISTORY_SINCE } from './historical-sales-mapping.js';

export const BUNDLE_VERSION = 1;
export const BUNDLE_SOURCE = 'sales_mapping_bundle';

const ORDER_STATUSES = new Set(['new', 'confirmed', 'completed', 'cancelled', 'failed']);
const FULFILLMENT_STATUSES = new Set([
  'pending', 'preparing', 'ready_to_ship', 'shipped', 'delivered', 'cancelled', 'returned', 'failed',
]);

export const EXPORT_SALES_MAPPING_BUNDLE_COMMAND = [
  'node scripts/export-sales-mapping-bundle.mjs --out sales-mapping-bundle.json',
].join('\n');

function integerQuantity(value) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity < 0) return null;
  const rounded = Math.round(quantity);
  if (Math.abs(quantity - rounded) > 0.0001) return null;
  return rounded;
}

export function workbookFromReconciliationAnchors({ run, rows } = {}) {
  if (new Date(run.cutoff_at).getTime() !== new Date(PHYSICAL_COUNT_CUTOFF).getTime()) {
    throw new Error(`El ancla no es el conteo del viernes (${PHYSICAL_COUNT_CUTOFF}).`);
  }
  const catalog = new Set([...INVENTORY_COUNT_MASTER_SKUS, ...INVENTORY_COUNT_SKUS_WITHOUT_QUANTITY]);
  const grouped = new Map();
  for (const row of rows || []) {
    const quantity = integerQuantity(row.cutoff_quantity);
    if (quantity == null) {
      throw new Error(`La cantidad de corte de ${row.main_sku} no es un entero.`);
    }
    const master = excelMasterForSku(row.main_sku, catalog);
    if (!master || INVENTORY_COUNT_SKUS_WITHOUT_QUANTITY.has(master)) continue;
    if (!INVENTORY_COUNT_MASTER_SKUS.has(master)) continue;
    const list = grouped.get(master) || [];
    list.push({ mainSku: row.main_sku, quantity });
    grouped.set(master, list);
  }
  const targets = [];
  for (const masterSku of [...INVENTORY_COUNT_MASTER_SKUS].sort()) {
    const entries = grouped.get(masterSku) || [];
    const exact = entries.find((entry) => entry.mainSku === masterSku);
    let chosen = exact || (entries.length === 1 ? entries[0] : null);
    if (!chosen && entries.length > 1) {
      const quantities = new Set(entries.map((entry) => entry.quantity));
      if (quantities.size === 1) chosen = entries[0];
    }
    if (!chosen) {
      throw new Error(`No hay cantidad de corte unívoca para ${masterSku}.`);
    }
    targets.push({ masterSku, sourceRows: [], targetQuantity: chosen.quantity });
  }
  return {
    targets,
    sourceHash: run.source_hash || null,
    skippedRows: [],
    presentWithoutQuantity: [...INVENTORY_COUNT_SKUS_WITHOUT_QUANTITY],
    source: 'reconciliation_anchors',
  };
}

export async function loadFridayWorkbookFromDb(db) {
  const run = (await db.query(
    `select id, source_hash, cutoff_at, applied_at
     from inventory_reconciliation_runs
     where cutoff_at = $1::timestamptz
     order by applied_at desc, id desc
     limit 1`,
    [PHYSICAL_COUNT_CUTOFF],
  )).rows[0];
  if (!run) return null;
  const rows = (await db.query(
    `select p.main_sku, a.cutoff_quantity
     from inventory_reconciliation_anchors a
     join products p on p.id = a.product_id
     where a.run_id = $1`,
    [run.id],
  )).rows;
  return workbookFromReconciliationAnchors({ run, rows });
}

export function parseSalesMappingBundle(raw) {
  const bundle = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!bundle || Number(bundle.version) !== BUNDLE_VERSION) {
    throw new Error('El bundle debe ser version 1.');
  }
  return bundle;
}

export function workbookFromBundleExcel(excel) {
  if (!excel?.targets?.length) return null;
  return {
    targets: excel.targets.map((target) => ({
      masterSku: String(target.masterSku || '').trim(),
      sourceRows: target.sourceRows || [],
      targetQuantity: Number(target.targetQuantity),
    })),
    sourceHash: excel.sourceHash || null,
    skippedRows: excel.skippedRows || [],
    presentWithoutQuantity: excel.presentWithoutQuantity || [...INVENTORY_COUNT_SKUS_WITHOUT_QUANTITY],
  };
}

export function assertBundleWorkbook(workbook) {
  if (!workbook?.targets?.length) throw new Error('El bundle no trae las cantidades del Excel del viernes.');
  const skus = new Set(workbook.targets.map((target) => target.masterSku));
  const missing = [...INVENTORY_COUNT_MASTER_SKUS].filter((sku) => !skus.has(sku));
  if (missing.length) {
    throw new Error(`El conteo del bundle no tiene estos maestros: ${missing.join(', ')}.`);
  }
  for (const target of workbook.targets) {
    if (!target.masterSku || !Number.isInteger(target.targetQuantity) || target.targetQuantity < 0) {
      throw new Error(`Cantidad inválida para ${target.masterSku || '(sin código)'}.`);
    }
  }
  return workbook;
}

export function coerceOrderStatus(value) {
  const status = String(value || '').toLowerCase();
  if (ORDER_STATUSES.has(status)) return status;
  if (status.includes('cancel')) return 'cancelled';
  if (status.includes('fail')) return 'failed';
  if (status.includes('complete') || status.includes('deliver')) return 'completed';
  return 'confirmed';
}

export function coerceFulfillmentStatus(value) {
  const status = String(value || '').toLowerCase();
  if (FULFILLMENT_STATUSES.has(status)) return status;
  if (status.includes('ready')) return 'ready_to_ship';
  if (status.includes('deliver')) return 'delivered';
  if (status.includes('ship')) return 'shipped';
  if (status.includes('cancel')) return 'cancelled';
  if (status.includes('return')) return 'returned';
  if (status.includes('prepar')) return 'preparing';
  return 'pending';
}

async function ensureCompany(db, company) {
  const ruc = String(company.ruc || '').trim();
  if (!ruc) throw new Error('Una empresa del bundle no tiene RUC.');
  const nombre = String(company.nombre || company.nombreComercial || company.razonSocial || ruc).trim();
  const existing = await db.query('select id from companies where ruc=$1 order by id limit 1', [ruc]);
  if (existing.rows[0]) return Number(existing.rows[0].id);
  const inserted = await db.query(
    `insert into companies (nombre, ruc, razon_social, nombre_comercial, activo)
     values ($1,$2,$1,$3,true) returning id`,
    [nombre, ruc, company.nombreComercial || nombre],
  );
  return Number(inserted.rows[0].id);
}

async function ensureChannelAccount(db, companyId, channelCode, displayName) {
  const channel = await db.query('select id from order_channels where code=$1', [channelCode]);
  const channelId = Number(channel.rows[0]?.id);
  if (!channelId) throw new Error(`No existe el canal ${channelCode}.`);
  await db.query(
    `insert into order_channel_accounts (
       company_id, channel_id, external_account_id, display_name,
       auto_create_orders, document_requirement, document_type_policy, settings
     )
     values ($1,$2,'default',$3,true,'optional','automatic','{}'::jsonb)
     on conflict (company_id, channel_id, external_account_id) do nothing`,
    [companyId, channelId, displayName || channelCode],
  );
  const account = await db.query(
    `select id from order_channel_accounts
     where company_id=$1 and channel_id=$2 and external_account_id='default'`,
    [companyId, channelId],
  );
  return Number(account.rows[0].id);
}

export async function ingestSalesMappingBundle(db, bundle, { catalogSkus } = {}) {
  const parsed = parseSalesMappingBundle(bundle);
  const products = (await db.query('select id, main_sku from products')).rows;
  const skus = catalogSkus || new Set(products.map((product) => product.main_sku));
  const idBySku = new Map(products.map((product) => [product.main_sku, Number(product.id)]));
  const companyIds = new Map();
  let listings = 0;
  let orders = 0;
  let items = 0;
  let events = 0;

  await db.query(`delete from orders where metadata->>'source'=$1`, [BUNDLE_SOURCE]);

  for (const company of parsed.companies || []) {
    const companyId = await ensureCompany(db, company);
    companyIds.set(String(company.ruc).trim(), companyId);
    for (const channel of MAPPING_CHANNELS) {
      await ensureChannelAccount(db, companyId, channel, company.nombreComercial || company.nombre);
    }
  }

  for (const listing of parsed.listings || []) {
    const companyId = companyIds.get(String(listing.companyRuc || '').trim());
    if (!companyId) continue;
    const master = excelMasterForSku(listing.sellerSku, skus)
      || excelMasterForSku(listing.shopSku, skus);
    const productId = master ? idBySku.get(master) : null;
    if (!productId) continue;
    const accountId = await ensureChannelAccount(db, companyId, listing.channel, listing.companyRuc);
    await db.query(
      `insert into product_listings (
         product_id, channel_code, company_id, channel_account_id, seller_sku, shop_sku,
         title, status, marketplace_quantity, metadata
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,0,$9::jsonb)
       on conflict (channel_code, company_id, seller_sku) do update
         set product_id=excluded.product_id, shop_sku=coalesce(excluded.shop_sku, product_listings.shop_sku),
             updated_at=now()`,
      [
        productId,
        listing.channel,
        companyId,
        accountId,
        listing.sellerSku,
        listing.shopSku || null,
        listing.title || listing.sellerSku,
        listing.status === 'active' || listing.status === 'inactive' || listing.status === 'unlinked'
          ? listing.status
          : 'inactive',
        JSON.stringify({ source: BUNDLE_SOURCE }),
      ],
    );
    listings += 1;
  }

  for (const order of parsed.orders || []) {
    const companyId = companyIds.get(String(order.companyRuc || '').trim());
    if (!companyId || !MAPPING_CHANNELS.includes(order.channel)) continue;
    const accountId = await ensureChannelAccount(db, companyId, order.channel, order.companyRuc);
    const inserted = await db.query(
      `insert into orders (
         company_id, channel_account_id, external_order_id, external_order_number,
         order_status, payment_status, fulfillment_status, document_status, provider_status,
         document_requirement, document_type_policy, currency, customer, shipping, metadata,
         ordered_at, items_status
       ) values (
         $1,$2,$3,$4,
         $5,'unknown',$6,'not_requested',$6,
         'optional','automatic','PEN','{}'::jsonb,'{}'::jsonb,$7::jsonb,
         $8,'complete'
       )
       on conflict (channel_account_id, external_order_id) do update set
         order_status=excluded.order_status,
         fulfillment_status=excluded.fulfillment_status,
         ordered_at=excluded.ordered_at,
         metadata=excluded.metadata,
         updated_at=now()
       returning id`,
      [
        companyId,
        accountId,
        String(order.externalOrderId),
        String(order.externalOrderNumber || order.externalOrderId),
        coerceOrderStatus(order.orderStatus),
        coerceFulfillmentStatus(order.fulfillmentStatus),
        JSON.stringify({ source: BUNDLE_SOURCE, companyRuc: order.companyRuc, channel: order.channel }),
        order.orderedAt,
      ],
    );
    const orderId = Number(inserted.rows[0].id);
    orders += 1;
    const orderItems = Array.isArray(order.items) ? order.items : [];
    for (const [index, item] of orderItems.entries()) {
      await db.query(
        `insert into order_items (
           order_id, external_item_id, sku, provider_sku, description, quantity,
           product_id, listing_id, main_sku, stock_state, metadata
         ) values ($1,$2,$3,$4,$5,$6,null,null,null,'none',$7::jsonb)
         on conflict (order_id, external_item_id) do update set
           sku=excluded.sku, provider_sku=excluded.provider_sku, quantity=excluded.quantity,
           product_id=null, listing_id=null, main_sku=null, updated_at=now()`,
        [
          orderId,
          String(item.externalItemId || `${order.externalOrderId}-item-${index + 1}`),
          item.sku || null,
          item.providerSku || null,
          item.description || item.sku || '',
          Number(item.quantity) || 1,
          JSON.stringify({ source: BUNDLE_SOURCE }),
        ],
      );
      items += 1;
    }
    for (const event of order.events || []) {
      if (!event.providerOccurredAt) continue;
      await db.query(
        `insert into order_events (
           order_id, event_type, source, idempotency_key, new_values, payload, provider_occurred_at
         ) values ($1,$2,'sync',$3,$4::jsonb,'{}'::jsonb,$5)
         on conflict (order_id, idempotency_key) do nothing`,
        [
          orderId,
          String(event.eventType || 'status'),
          `bundle:${order.externalOrderId}:${event.providerOccurredAt}:${event.eventType || 'status'}`,
          JSON.stringify(event.newValues || {}),
          event.providerOccurredAt,
        ],
      );
      events += 1;
    }
  }

  return {
    companies: companyIds.size,
    listings,
    orders,
    items,
    events,
    since: parsed.since || SALES_HISTORY_SINCE,
    cutoffAt: parsed.cutoffAt || PHYSICAL_COUNT_CUTOFF,
  };
}

export async function buildSalesMappingBundle(db, { workbook, since = SALES_HISTORY_SINCE } = {}) {
  const companies = (await db.query(
    `select distinct c.id, c.ruc, c.nombre, c.nombre_comercial, c.razon_social
     from companies c
     join orders o on o.company_id=c.id
     join order_channel_accounts a on a.id=o.channel_account_id
     join order_channels ch on ch.id=a.channel_id
     where ch.code=any($1::text[]) and o.ordered_at >= $2
     order by c.id`,
    [MAPPING_CHANNELS, since],
  )).rows;
  const listings = companies.length ? (await db.query(
    `select l.channel_code as channel, c.ruc as "companyRuc", l.seller_sku as "sellerSku",
       l.shop_sku as "shopSku", l.status, l.title
     from product_listings l
     join companies c on c.id=l.company_id
     where l.channel_code=any($1::text[]) and c.id=any($2::int[])
     order by l.id`,
    [MAPPING_CHANNELS, companies.map((row) => Number(row.id))],
  )).rows : [];
  const orderRows = (await db.query(
    `select o.id, o.external_order_id, o.external_order_number, o.ordered_at,
       o.order_status, o.fulfillment_status, c.ruc as company_ruc, ch.code as channel
     from orders o
     join companies c on c.id=o.company_id
     join order_channel_accounts a on a.id=o.channel_account_id
     join order_channels ch on ch.id=a.channel_id
     where ch.code=any($1::text[]) and o.ordered_at >= $2
     order by o.id`,
    [MAPPING_CHANNELS, since],
  )).rows;
  const orderIds = orderRows.map((row) => Number(row.id));
  const itemRows = orderIds.length ? (await db.query(
    `select order_id, external_item_id, sku, provider_sku, description, quantity
     from order_items where order_id=any($1::bigint[]) order by id`,
    [orderIds],
  )).rows : [];
  const eventRows = orderIds.length ? (await db.query(
    `select order_id, event_type, new_values, provider_occurred_at
     from order_events
     where order_id=any($1::bigint[]) and provider_occurred_at is not null
     order by id`,
    [orderIds],
  )).rows : [];
  const itemsByOrder = new Map();
  for (const item of itemRows) {
    const list = itemsByOrder.get(Number(item.order_id)) || [];
    list.push({
      externalItemId: item.external_item_id,
      sku: item.sku,
      providerSku: item.provider_sku,
      description: item.description,
      quantity: Number(item.quantity),
    });
    itemsByOrder.set(Number(item.order_id), list);
  }
  const eventsByOrder = new Map();
  for (const event of eventRows) {
    const list = eventsByOrder.get(Number(event.order_id)) || [];
    list.push({
      eventType: event.event_type,
      providerOccurredAt: event.provider_occurred_at,
      newValues: event.new_values || {},
    });
    eventsByOrder.set(Number(event.order_id), list);
  }
  return {
    version: BUNDLE_VERSION,
    since,
    cutoffAt: PHYSICAL_COUNT_CUTOFF,
    excel: workbook ? {
      sourceHash: workbook.sourceHash,
      targets: workbook.targets.map((target) => ({
        masterSku: target.masterSku,
        sourceRows: target.sourceRows,
        targetQuantity: target.targetQuantity,
      })),
      skippedRows: workbook.skippedRows || [],
      presentWithoutQuantity: workbook.presentWithoutQuantity || [...INVENTORY_COUNT_SKUS_WITHOUT_QUANTITY],
    } : null,
    companies: companies.map((row) => ({
      ruc: row.ruc,
      nombre: row.nombre,
      nombreComercial: row.nombre_comercial,
      razonSocial: row.razon_social,
    })),
    listings,
    orders: orderRows.map((row) => ({
      channel: row.channel,
      companyRuc: row.company_ruc,
      externalOrderId: row.external_order_id,
      externalOrderNumber: row.external_order_number,
      orderedAt: row.ordered_at,
      orderStatus: row.order_status,
      fulfillmentStatus: row.fulfillment_status,
      items: itemsByOrder.get(Number(row.id)) || [],
      events: eventsByOrder.get(Number(row.id)) || [],
    })),
  };
}
