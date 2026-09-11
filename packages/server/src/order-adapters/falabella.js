import { ensureOrderChannelAccount, ingestOrder } from '../order-management.js';

function text(value) {
  return String(value ?? '').trim();
}

function number(value, fallback = null) {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  const parsed = Number(raw.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function utcDate(value) {
  const raw = text(value);
  if (!raw) return null;
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const withZone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : `${normalized}Z`;
  const parsed = new Date(withZone);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function includesStatus(status, expected) {
  return String(status || '').toLowerCase().split('|').some((part) => (
    part === expected || part.includes(expected)
  ));
}

function statusToken(value) {
  return String(value || '').trim().toLowerCase();
}

export function effectiveFalabellaItemStatus(items) {
  const statuses = (Array.isArray(items) ? items : [])
    .map((item) => statusToken(item?.Status ?? item?.status ?? item?.providerStatus ?? item?.provider_status))
    .filter(Boolean);
  if (!statuses.length) return '';
  const has = (value) => statuses.some((status) => status === value || status.includes(value));
  if (has('pending')) return 'pending';
  if (has('ready_to_ship')) return 'ready_to_ship';
  if (has('shipped')) return 'shipped';
  if (has('delivered')) return 'delivered';
  if (has('canceled') || has('cancelled')) return 'canceled';
  if (has('returned') || has('return_')) return 'returned';
  if (has('failed')) return 'failed';
  return [...new Set(statuses)].join('|');
}

function isClosedFalabellaStatus(status) {
  return /(?:^|\|)(?:shipped|delivered)(?:\||$)/.test(statusToken(status));
}

function isOpenFalabellaStatus(status) {
  return /(?:^|\|)(?:pending|ready_to_ship)(?:\||$)/.test(statusToken(status))
    && !isClosedFalabellaStatus(status);
}

// GetOrder.Statuses is what Seller Center shows. GetOrderItems can stay
// pending after the order already shipped; never take the header backwards.
export function resolveFalabellaIngestStatus(headerStatus, items = []) {
  const itemStatus = effectiveFalabellaItemStatus(items);
  if (!itemStatus) return headerStatus;
  if (isClosedFalabellaStatus(headerStatus) && isOpenFalabellaStatus(itemStatus)) {
    return headerStatus;
  }
  return itemStatus;
}

const CLOSED_FALABELLA_STATUSES = new Set(['cancelled', 'returned', 'failed', 'delivered', 'shipped']);

export function closedFalabellaFulfillment(status) {
  const mapped = mapFalabellaCanonicalStatus(status);
  if (!CLOSED_FALABELLA_STATUSES.has(mapped.fulfillmentStatus)) return null;
  return mapped;
}

const OPEN_FALABELLA_STATUS_SQL = `'(^|\\|)(pending|ready_to_ship)(\\||$)'`;
const CLOSED_FALABELLA_STATUS_SQL = `'(^|\\|)(shipped|delivered|canceled|cancelled|returned|failed)(\\||$)'`;

// GetOrderItems can stay pending after Seller Center already shipped.
// Restore every drifted header from the unified order, not one by one.
export async function alignFalabellaHeaderWithClosedFulfillment(db) {
  if (!db?.query) return { updated: 0 };
  const headers = await db.query(
    `update falabella_orders fo
     set status = case when o.fulfillment_status = 'delivered' then 'delivered' else 'shipped' end,
         raw_data = jsonb_set(
           coalesce(fo.raw_data, '{}'::jsonb),
           '{Statuses}',
           to_jsonb(case when o.fulfillment_status = 'delivered' then 'delivered' else 'shipped' end),
           true
         ),
         synchronized_at = now()
     from orders o
     join order_channel_accounts a on a.id = o.channel_account_id
     join order_channels ch on ch.id = a.channel_id
     where fo.company_id = o.company_id
       and fo.order_id = o.external_order_id
       and ch.code = 'falabella'
       and o.fulfillment_status in ('shipped', 'delivered')
       and o.order_status not in ('cancelled', 'failed')
       and lower(coalesce(fo.status, '')) ~ ${OPEN_FALABELLA_STATUS_SQL}
       and lower(coalesce(fo.status, '')) !~ ${CLOSED_FALABELLA_STATUS_SQL}`,
  );
  await db.query(
    `update falabella_order_lifecycle l
     set current_status = case when o.fulfillment_status = 'delivered' then 'delivered' else 'shipped' end,
         shipped_at = coalesce(l.shipped_at, now()),
         last_observed_at = now()
     from orders o
     join order_channel_accounts a on a.id = o.channel_account_id
     join order_channels ch on ch.id = a.channel_id
     join falabella_orders fo
       on fo.company_id = o.company_id
      and fo.order_id = o.external_order_id
     where l.company_id = fo.company_id
       and l.order_id = fo.order_id
       and ch.code = 'falabella'
       and o.fulfillment_status in ('shipped', 'delivered')
       and o.order_status not in ('cancelled', 'failed')
       and l.current_status in ('pending', 'ready_to_ship')`,
  );
  return { updated: Number(headers.rowCount || 0) };
}

// Falabella GetOrder can already be shipped while items stay pending.
// Those overdue ghosts were counting as Vencidos without appearing in the list.
export async function closeOverdueFalabellaFulfillment(db) {
  if (!db?.query) return { updated: 0 };
  const orders = await db.query(
    `update orders o
     set fulfillment_status = 'shipped',
         order_status = case when o.order_status in ('completed', 'cancelled', 'failed') then o.order_status else 'confirmed' end,
         provider_status = 'shipped',
         updated_at = now()
     from order_channel_accounts a
     join order_channels ch on ch.id = a.channel_id
     where o.channel_account_id = a.id
       and ch.code = 'falabella'
       and o.fulfillment_status in ('pending', 'preparing', 'ready_to_ship')
       and o.order_status not in ('cancelled', 'failed')
       and o.promised_shipping_at is not null
       and (o.promised_shipping_at at time zone 'America/Lima')::date
           < (now() at time zone 'America/Lima')::date`,
  );
  await db.query(
    `update falabella_orders fo
     set status = 'shipped',
         raw_data = jsonb_set(coalesce(fo.raw_data, '{}'::jsonb), '{Statuses}', to_jsonb('shipped'::text), true),
         synchronized_at = now()
     from orders o
     join order_channel_accounts a on a.id = o.channel_account_id
     join order_channels ch on ch.id = a.channel_id
     where fo.company_id = o.company_id
       and fo.order_id = o.external_order_id
       and ch.code = 'falabella'
       and o.fulfillment_status = 'shipped'
       and lower(coalesce(fo.status, '')) ~ ${OPEN_FALABELLA_STATUS_SQL}
       and lower(coalesce(fo.status, '')) !~ ${CLOSED_FALABELLA_STATUS_SQL}
       and o.promised_shipping_at is not null
       and (o.promised_shipping_at at time zone 'America/Lima')::date
           < (now() at time zone 'America/Lima')::date`,
  );
  return { updated: Number(orders.rowCount || 0) };
}

export async function closeStaleFalabellaFulfillment(db) {
  if (!db?.query) return { updated: 0 };
  const found = await db.query(
    `select o.id, o.fulfillment_status, o.provider_status, fo.status as falabella_status
     from orders o
     join order_channel_accounts a on a.id = o.channel_account_id
     join order_channels ch on ch.id = a.channel_id
     left join falabella_orders fo
       on fo.company_id = o.company_id
      and fo.order_id = o.external_order_id
     where ch.code = 'falabella'
       and o.fulfillment_status in ('pending', 'preparing', 'ready_to_ship')
       and o.order_status not in ('cancelled', 'failed')
       and (
         lower(coalesce(fo.status, '')) ~ '(^|\\|)(shipped|delivered|canceled|cancelled|returned|failed)(\\||$)'
         or lower(coalesce(o.provider_status, '')) ~ '(^|\\|)(shipped|delivered|canceled|cancelled|returned|failed)(\\||$)'
       )`,
  );
  let updated = 0;
  for (const row of found.rows || []) {
    const next = closedFalabellaFulfillment(row.falabella_status || row.provider_status);
    if (!next) continue;
    const result = await db.query(
      `update orders
       set fulfillment_status = $2,
           order_status = $3,
           provider_status = coalesce(nullif($4, ''), provider_status),
           updated_at = now()
       where id = $1
         and fulfillment_status in ('pending', 'preparing', 'ready_to_ship')`,
      [row.id, next.fulfillmentStatus, next.orderStatus, row.falabella_status || row.provider_status],
    );
    updated += Number(result.rowCount || 0);
  }
  return { updated };
}

export function mapFalabellaCanonicalStatus(status) {
  if (includesStatus(status, 'cancel')) {
    return { orderStatus: 'cancelled', fulfillmentStatus: 'cancelled' };
  }
  if (includesStatus(status, 'return')) {
    return { orderStatus: 'completed', fulfillmentStatus: 'returned' };
  }
  if (includesStatus(status, 'failed')) {
    return { orderStatus: 'failed', fulfillmentStatus: 'failed' };
  }
  if (includesStatus(status, 'delivered')) {
    return { orderStatus: 'completed', fulfillmentStatus: 'delivered' };
  }
  if (includesStatus(status, 'shipped')) {
    return { orderStatus: 'confirmed', fulfillmentStatus: 'shipped' };
  }
  if (includesStatus(status, 'ready_to_ship')) {
    return { orderStatus: 'confirmed', fulfillmentStatus: 'ready_to_ship' };
  }
  if (includesStatus(status, 'pending')) {
    return { orderStatus: 'confirmed', fulfillmentStatus: 'pending' };
  }
  return { orderStatus: 'confirmed', fulfillmentStatus: 'unmapped' };
}

function customerFrom(raw) {
  const name = [
    raw?.CustomerFirstName,
    raw?.CustomerLastName,
    raw?.CustomerLastName2,
  ].map(text).filter(Boolean).join(' ');
  const documentNumber = text(
    raw?.NationalRegistrationNumber
      || raw?.CustomerNationalRegistrationNumber
      || raw?.CustomerDocumentNumber
      || raw?.DocumentNumber,
  );
  return {
    name,
    documentNumber,
    email: text(raw?.CustomerEmail || raw?.Email),
    phone: text(raw?.CustomerPhone || raw?.Phone),
  };
}

function addressFrom(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    const textValue = value.trim();
    return textValue === '[object Object]' ? '' : textValue;
  }
  if (typeof value === 'object') {
    const parts = [value.Address1, value.Address3, value.Ward || value.City, value.Region]
      .map((item) => String(item || '').trim())
      .filter(Boolean);
    return [...new Set(parts)].join(', ');
  }
  return '';
}

export function mapFalabellaShipping(raw) {
  return shippingFrom(raw);
}

function shippingFrom(raw) {
  const shipping = raw?.AddressShipping || raw?.ShippingAddress || raw?.Address;
  return {
    type: text(raw?.ShippingType),
    address: addressFrom(shipping),
    city: text(shipping?.City || raw?.AddressShippingCity || raw?.ShippingCity || raw?.City),
    region: text(shipping?.Region || raw?.AddressShippingRegion || raw?.ShippingRegion || raw?.Region),
    trackingCode: text(raw?.TrackingCode || raw?.TrackingNumber),
  };
}

export function falabellaItemShippingAmount(item) {
  return number(
    item?.ShippingAmount
    ?? item?.shippingAmount
    ?? item?.ShippingFee
    ?? item?.shippingFee
    ?? item?.rawData?.ShippingAmount
    ?? item?.rawData?.shippingAmount
    ?? item?.rawData?.ShippingFee
    ?? item?.rawData?.shippingFee,
  );
}

export function falabellaOrderShippingAmount(raw, items = mapFalabellaOrderItems(raw)) {
  let found = false;
  let total = 0;
  for (const item of items) {
    const amount = falabellaItemShippingAmount(item);
    if (amount == null) continue;
    found = true;
    total += amount;
  }
  if (found) return Math.round(total * 100) / 100;
  return number(raw?.ShippingAmount ?? raw?.ShippingFee ?? raw?.shippingAmount);
}

export function mapFalabellaOrderItems(raw) {
  const candidate = raw?.OrderItems?.OrderItem || raw?.OrderItems || raw?.Items?.Item || raw?.Items;
  const items = Array.isArray(candidate) ? candidate : candidate && typeof candidate === 'object' ? [candidate] : [];
  return items.map((item, index) => ({
    externalItemId: text(item?.OrderItemId || item?.OrderItemID || item?.Id || item?.ID || `line-${index + 1}`),
    sku: text(item?.SellerSku || item?.Sku),
    providerSku: text(item?.ShopSku || item?.Sku),
    description: text(item?.Name || item?.Description),
    quantity: number(item?.Quantity, 1),
    unitPrice: number(item?.ItemPrice ?? item?.UnitPrice ?? item?.Price),
    total: number(item?.PaidPrice ?? item?.Total),
    shippingAmount: falabellaItemShippingAmount(item),
    providerStatus: text(item?.Status),
    rawData: item,
  }));
}

export async function ensureFalabellaOrderAccount(db, companyId, displayName) {
  return ensureOrderChannelAccount({
    companyId,
    channelCode: 'falabella',
    externalAccountId: 'default',
    displayName: displayName || `Falabella · Empresa ${Number(companyId)}`,
    autoCreateOrders: true,
    documentRequirement: 'optional',
    documentTypePolicy: 'automatic',
    settings: { origin: 'legacy_falabella' },
  }, db);
}

export async function ingestFalabellaOrder(input, db) {
  const normalized = input.normalized;
  const raw = normalized?.raw || {};
  const account = input.account || await ensureFalabellaOrderAccount(db, input.companyId, input.displayName);
  const items = mapFalabellaOrderItems(raw);
  const status = resolveFalabellaIngestStatus(normalized?.status, items);
  const statuses = mapFalabellaCanonicalStatus(status);
  const shippingAmount = falabellaOrderShippingAmount(raw, items);
  return ingestOrder({
    companyId: input.companyId,
    channelAccountId: account.id,
    automatic: true,
    externalOrderId: normalized?.orderId,
    externalOrderNumber: normalized?.orderNumber,
    ...statuses,
    paymentStatus: 'unknown',
    providerStatus: status || normalized?.status,
    requestedDocumentType: normalized?.invoiceRequired ? 'factura' : null,
    currency: normalized?.currency || 'PEN',
    total: normalized?.grandTotal,
    shippingAmount,
    customer: customerFrom(raw),
    shipping: shippingFrom(raw),
    orderedAt: normalized?.falabellaCreatedAt,
    promisedShippingAt: utcDate(raw?.PromisedShippingTime),
    providerUpdatedAt: normalized?.falabellaUpdatedAt,
    metadata: {
      invoiceRequired: Boolean(normalized?.invoiceRequired),
      shippingType: text(raw?.ShippingType),
      itemCount: number(raw?.ItemsCount),
      labelCount: number(raw?.LabelCount),
    },
    items,
    itemsComplete: items.length > 0,
    rawPayload: raw,
    source: input.source || 'sync',
    correlationId: input.correlationId,
    eventId: input.eventId,
    catalogInventoryEnabled: input.catalogInventoryEnabled,
    providerOccurredAt: normalized?.falabellaUpdatedAt,
  }, db);
}
