import {
  ORDER_PACKAGE_MAPPING_PROBLEM_SQL,
  ORDER_PROBLEM_SQL,
  orderProblemMessage,
} from './order-problem.js';

const ACTIONABLE_STATUSES = new Set(['pending', 'ready_to_ship']);

let corePromise;

function loadCore() {
  corePromise ||= import('@zentofact/core');
  return corePromise;
}

function optionalPositiveInt(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${field} inválido.`);
  return parsed;
}

function channelCode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (!/^[a-z][a-z0-9_-]{1,49}$/.test(normalized)) throw new Error('channelCode inválido.');
  return normalized;
}

function titleCaseSeller(value) {
  return String(value || '')
    .toLocaleLowerCase('es')
    .replace(/(^|[\s/-])(\S)/g, (_, separator, character) => (
      separator + character.toLocaleUpperCase('es')
    ));
}

function shortSellerName(row) {
  const candidates = [row.company_commercial_name, row.company_name, row.company_legal_name]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .map((value) => value
      .replace(/^(?:importaciones|inversiones|tiendas|la tienda del)\s+/i, '')
      .replace(/\s+(?:per[uú]|e\.?i\.?r\.?l\.?|s\.?r\.?l\.?|s\.?a\.?c\.?)$/i, '')
      .trim());
  const name = candidates.sort((left, right) => left.length - right.length)[0];
  return name ? titleCaseSeller(name) : 'Sin tienda';
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function text(value) {
  return String(value ?? '').trim();
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function itemPackageId(item) {
  const raw = object(item.rawData);
  const metadata = object(item.metadata);
  return text(
    metadata.packageId
      || metadata.packageID
      || raw.PackageId
      || raw.PackageID
      || raw.packageId
      || raw.packageID,
  );
}

function productIdentity(item) {
  return text(item.sku || item.providerSku || item.description || item.externalItemId).toLocaleLowerCase('es');
}

export function groupAttentionProducts(items = []) {
  const grouped = new Map();
  for (const candidate of Array.isArray(items) ? items : []) {
    const item = object(candidate);
    const key = productIdentity(item) || `item-${grouped.size + 1}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.quantity += Math.max(number(item.quantity, 1), 1);
      if (!existing.imageUrl && item.imageUrl) existing.imageUrl = text(item.imageUrl);
      continue;
    }
    grouped.set(key, {
      id: number(item.id, grouped.size + 1),
      sku: text(item.sku || item.providerSku),
      name: text(item.description) || 'Producto sin nombre',
      quantity: Math.max(number(item.quantity, 1), 1),
      imageUrl: text(item.imageUrl) || null,
    });
  }
  return [...grouped.values()];
}

function normalizePrints(value) {
  return (Array.isArray(value) ? value : []).map((entry) => ({
    labelIndex: Math.max(number(entry.labelIndex, 1), 1),
    printCount: Math.max(number(entry.printCount, 0), 0),
    firstPrintedAt: entry.firstPrintedAt || null,
    lastPrintedAt: entry.lastPrintedAt || null,
  }));
}

function baseOrder(row) {
  const metadata = object(row.metadata);
  const rawItems = Array.isArray(row.items) ? row.items : [];
  const inferredPackageCount = new Set(rawItems.map(itemPackageId).filter(Boolean)).size;
  const labelCount = Math.max(number(
    metadata.labelCount
      || object(metadata.ripleySvc).packages
      || metadata.packages,
    1,
  ), inferredPackageCount, 1);
  return {
    id: number(row.id),
    companyId: row.company_id == null ? null : number(row.company_id),
    companyName: shortSellerName(row),
    channelCode: text(row.channel_code),
    channelName: text(row.channel_name) || text(row.channel_code),
    externalOrderId: text(row.external_order_id),
    orderNumber: text(row.external_order_number || row.external_order_id),
    fulfillmentStatus: text(row.fulfillment_status),
    providerStatus: text(row.provider_status) || null,
    orderedAt: row.ordered_at || row.first_seen_at || row.created_at || null,
    promisedShippingAt: row.promised_shipping_at || null,
    total: row.total == null ? null : number(row.total),
    currency: text(row.currency) || 'PEN',
    customerName: text(object(row.customer).name),
    labelCount,
    prints: normalizePrints(row.label_prints),
    rawItems,
    products: groupAttentionProducts(rawItems),
    problem: orderProblemMessage(row),
  };
}

function actionFor(channelCode, stage) {
  if (channelCode === 'falabella') return stage === 'pending' ? 'mark_ready' : 'print_label';
  return 'external';
}

function orderSort(left, right) {
  const leftDeadline = left.promisedShippingAt ? new Date(left.promisedShippingAt).getTime() : Number.MAX_SAFE_INTEGER;
  const rightDeadline = right.promisedShippingAt ? new Date(right.promisedShippingAt).getTime() : Number.MAX_SAFE_INTEGER;
  if (leftDeadline !== rightDeadline) return leftDeadline - rightDeadline;
  const leftOrdered = left.orderedAt ? new Date(left.orderedAt).getTime() : Number.MAX_SAFE_INTEGER;
  const rightOrdered = right.orderedAt ? new Date(right.orderedAt).getTime() : Number.MAX_SAFE_INTEGER;
  return leftOrdered - rightOrdered || left.id - right.id;
}

export function buildOrderAttention(rows = [], persistedProblemCount = 0) {
  const pending = [];
  const ready = [];
  const dynamicProblemOrderIds = new Set();

  for (const row of Array.isArray(rows) ? rows : []) {
    const order = baseOrder(row);
    if (!ACTIONABLE_STATUSES.has(order.fulfillmentStatus)) continue;
    if (order.problem) continue;

    if (order.fulfillmentStatus === 'pending') {
      pending.push({ ...order, action: actionFor(order.channelCode, 'pending') });
      continue;
    }

    const packageIds = [...new Set(order.rawItems.map(itemPackageId).filter(Boolean))];
    const hasMultipleMappedPackages = order.labelCount > 1
      && order.rawItems.length > 0
      && order.rawItems.every((item) => Boolean(itemPackageId(item)))
      && packageIds.length === order.labelCount;
    if (order.labelCount > 1 && !hasMultipleMappedPackages) {
      dynamicProblemOrderIds.add(order.id);
      continue;
    }

    for (let index = 0; index < order.labelCount; index += 1) {
      const labelIndex = index + 1;
      const items = hasMultipleMappedPackages
        ? order.rawItems.filter((item) => itemPackageId(item) === packageIds[index])
        : order.rawItems;
      const print = order.prints.find((entry) => entry.labelIndex === labelIndex) || null;
      ready.push({
        ...order,
        products: groupAttentionProducts(items),
        action: actionFor(order.channelCode, 'ready'),
        labelIndex,
        printed: Number(print?.printCount || 0) > 0,
        printCount: Number(print?.printCount || 0),
        lastPrintedAt: print?.lastPrintedAt || null,
      });
    }
  }

  pending.sort(orderSort);
  ready.sort((left, right) => (
    Number(left.printed) - Number(right.printed) || orderSort(left, right)
  ));
  return {
    pending,
    ready,
    counts: {
      pendingOrders: pending.length,
      readyLabels: ready.length,
      readyOrders: new Set(ready.map((entry) => entry.id)).size,
      problems: Math.max(number(persistedProblemCount), 0) + dynamicProblemOrderIds.size,
    },
  };
}

function attentionWhere(filters, values, { actionable = true } = {}) {
  const where = [];
  if (actionable) where.push(`o.fulfillment_status in ('pending','ready_to_ship')`);
  if (filters.companyId) {
    values.push(filters.companyId);
    where.push(`o.company_id=$${values.length}`);
  }
  if (filters.channelCode) {
    values.push(filters.channelCode);
    where.push(`ch.code=$${values.length}`);
  }
  if (filters.search) {
    values.push(filters.search);
    const parameter = `$${values.length}`;
    where.push(`(
      o.external_order_id ilike '%' || ${parameter} || '%'
      or o.external_order_number ilike '%' || ${parameter} || '%'
      or coalesce(o.customer->>'name', '') ilike '%' || ${parameter} || '%'
      or exists (
        select 1 from order_items search_item
        where search_item.order_id=o.id
          and (
            coalesce(search_item.sku, '') ilike '%' || ${parameter} || '%'
            or coalesce(search_item.provider_sku, '') ilike '%' || ${parameter} || '%'
            or coalesce(search_item.description, '') ilike '%' || ${parameter} || '%'
          )
      )
    )`);
  }
  return where;
}

export async function listOrderAttention(input = {}, db) {
  const filters = {
    companyId: optionalPositiveInt(input.companyId, 'companyId'),
    channelCode: channelCode(input.channelCode),
    search: text(input.search).slice(0, 120),
  };
  const target = db || (await loadCore()).pool;
  const orderValues = [];
  const orderWhere = attentionWhere(filters, orderValues);
  const problemValues = [];
  const problemWhere = attentionWhere(filters, problemValues);

  const [ordersResult, problemsResult] = await Promise.all([
    target.query(
      `select o.*, ch.code as channel_code, ch.name as channel_name,
         c.nombre as company_name, c.nombre_comercial as company_commercial_name,
         c.razon_social as company_legal_name,
         ${ORDER_PACKAGE_MAPPING_PROBLEM_SQL} as package_mapping_problem,
         coalesce(items.items, '[]'::jsonb) as items,
         coalesce(prints.prints, '[]'::jsonb) as label_prints
       from orders o
       join order_channel_accounts a on a.id=o.channel_account_id
       join order_channels ch on ch.id=a.channel_id
       left join companies c on c.id=o.company_id
       left join lateral (
         select jsonb_agg(jsonb_build_object(
           'id', oi.id,
           'externalItemId', oi.external_item_id,
           'sku', oi.sku,
           'providerSku', oi.provider_sku,
           'description', oi.description,
           'quantity', oi.quantity,
           'metadata', oi.metadata,
           'rawData', oi.raw_data,
           'imageUrl', coalesce(
             nullif(p.image_url, ''),
             nullif(listing.metadata->'images'->>0, ''),
             nullif(listing.metadata->'images'->0->>'Url', ''),
             nullif(listing.metadata->'images'->0->>'url', ''),
             nullif(listing.metadata->>'imageUrl', ''),
             nullif(oi.raw_data->>'Image', ''),
             nullif(oi.raw_data->>'ImageUrl', ''),
             nullif(oi.raw_data->>'ImageURL', ''),
             nullif(oi.raw_data->>'ProductImage', ''),
             nullif(oi.raw_data->>'MainImage', '')
           )
         ) order by oi.id) as items
         from order_items oi
         left join products p on p.id=oi.product_id
         left join product_listings listing on listing.id=oi.listing_id
         where oi.order_id=o.id
       ) items on true
       left join lateral (
         select jsonb_agg(jsonb_build_object(
           'labelIndex', print.label_index,
           'printCount', print.print_count,
           'firstPrintedAt', print.first_printed_at,
           'lastPrintedAt', print.last_printed_at
         ) order by print.label_index) as prints
         from falabella_label_prints print
         where ch.code='falabella'
           and print.company_id=o.company_id
           and print.order_id=o.external_order_id
       ) prints on true
       where ${orderWhere.join(' and ')}
       order by o.promised_shipping_at asc nulls last,
         coalesce(o.ordered_at, o.first_seen_at, o.created_at) asc,
         o.id asc`,
      orderValues,
    ),
    target.query(
      `select count(*)::int as problem_count
       from orders o
       join order_channel_accounts a on a.id=o.channel_account_id
       join order_channels ch on ch.id=a.channel_id
       where ${[...problemWhere, ORDER_PROBLEM_SQL].join(' and ')}`,
      problemValues,
    ),
  ]);
  return buildOrderAttention(
    ordersResult.rows,
    Number(problemsResult.rows[0]?.problem_count || 0),
  );
}
