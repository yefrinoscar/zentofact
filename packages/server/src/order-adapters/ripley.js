import { marketplaceItemImageUrl } from '../catalog/item-image.js';
import { enqueueStockJob } from '../catalog/stock-jobs.js';
import { shouldListenStockOrder } from '../catalog/stock-commitment.js';
import { ensureOrderChannelAccount, ingestOrder } from '../order-management.js';
import { mapRipleySvcFulfillmentStatus } from '../ripley-logistics.js';

function text(value) {
  return String(value ?? '').trim();
}

function number(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isoDate(value) {
  const raw = text(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizedState(value) {
  return text(value).toUpperCase().replace(/[ -]+/g, '_');
}

const TERMINAL_FULFILLMENT = new Set(['cancelled', 'returned', 'shipped', 'delivered', 'failed']);
const MIRAKL_WAREHOUSE_PENDING = new Set([
  'SHIPPING',
  'WAITING_DEBIT',
  'WAITING_DEBIT_PAYMENT',
  'WAITING_ACCEPTANCE',
  'STAGING',
]);
export function mapRipleyCanonicalStatus(value) {
  const status = normalizedState(value);
  if (/(CANCEL|CANCELED|CANCELLED|REFUSED|REJECTED)/.test(status)) {
    return { orderStatus: 'cancelled', fulfillmentStatus: 'cancelled' };
  }
  if (/(RETURN|REFUND)/.test(status)) {
    return { orderStatus: 'completed', fulfillmentStatus: 'returned' };
  }
  if (/(CLOSED|RECEIVED|DELIVERED)/.test(status)) {
    return { orderStatus: 'completed', fulfillmentStatus: 'delivered' };
  }
  if (/(SHIPPED|TO_COLLECT|COLLECTED)/.test(status)) {
    return { orderStatus: 'confirmed', fulfillmentStatus: 'shipped' };
  }
  // Mirakl SHIPPING = pagada y por preparar (SVC TO_PREPARE). No es listo para enviar.
  if (status === 'READY_TO_SHIP') {
    return { orderStatus: 'confirmed', fulfillmentStatus: 'ready_to_ship' };
  }
  if (status === 'WAITING_ACCEPTANCE' || status === 'STAGING') {
    return { orderStatus: 'new', fulfillmentStatus: 'pending' };
  }
  return { orderStatus: 'confirmed', fulfillmentStatus: 'pending' };
}

export function resolveRipleyIngestStatuses(providerStatus, existing = null) {
  const mapped = mapRipleyCanonicalStatus(providerStatus);
  if (TERMINAL_FULFILLMENT.has(mapped.fulfillmentStatus)) return mapped;

  const existingFulfillment = String(
    existing?.fulfillment_status || existing?.fulfillmentStatus || '',
  ).trim().toLowerCase();
  const metadata = existing?.metadata || {};
  const svcStatus = metadata.ripleySvc?.statusManagement || metadata.ripley_svc?.statusManagement;
  const fromSvc = mapRipleySvcFulfillmentStatus(svcStatus);
  if (fromSvc) {
    return { ...mapped, fulfillmentStatus: fromSvc };
  }
  // Sin señal de Seller Center no se inventa el estado: un listo persistido se deja.
  if (
    mapped.fulfillmentStatus === 'pending'
    && (existingFulfillment === 'ready_to_ship' || existingFulfillment === 'preparing')
  ) {
    return { ...mapped, fulfillmentStatus: existingFulfillment };
  }
  return mapped;
}

export function nextHealedRipleyFulfillment(row) {
  const fulfillment = String(row?.fulfillment_status || row?.fulfillmentStatus || '').trim().toLowerCase();
  if (fulfillment !== 'ready_to_ship') return null;
  const provider = normalizedState(row?.provider_status || row?.providerStatus);
  if (!MIRAKL_WAREHOUSE_PENDING.has(provider)) return null;
  const metadata = row?.metadata || {};
  const fromSvc = mapRipleySvcFulfillmentStatus(
    metadata.ripleySvc?.statusManagement || metadata.ripley_svc?.statusManagement,
  );
  return fromSvc === 'preparing' ? 'preparing' : null;
}

export async function healPersistedRipleyShippingOrders(db, companyId = null) {
  if (!db?.query) return { scanned: 0, healed: 0 };
  const values = [];
  let companyFilter = '';
  if (companyId != null) {
    values.push(Number(companyId));
    companyFilter = `and o.company_id=$${values.length}`;
  }
  const selected = await db.query(
    `select o.id, o.provider_status, o.fulfillment_status, o.metadata
     from orders o
     join order_channel_accounts account on account.id=o.channel_account_id
     join order_channels channel on channel.id=account.channel_id
     where channel.code='ripley'
       and o.fulfillment_status='ready_to_ship'
       ${companyFilter}`,
    values,
  );
  let healed = 0;
  for (const row of selected.rows) {
    const next = nextHealedRipleyFulfillment(row);
    if (!next) continue;
    const result = await db.query(
      `update orders
          set fulfillment_status=$2, updated_at=now()
        where id=$1 and fulfillment_status='ready_to_ship'`,
      [row.id, next],
    );
    healed += result.rowCount || result.rows?.length || 0;
  }
  return { scanned: selected.rows.length, healed };
}

async function existingRipleyOrder(db, accountId, externalOrderId) {
  if (!db?.query || !accountId || !externalOrderId) return null;
  const result = await db.query(
    `select fulfillment_status, metadata from orders
     where channel_account_id=$1 and external_order_id=$2`,
    [accountId, externalOrderId],
  );
  return result.rows[0] || null;
}

function customerFrom(raw) {
  const customer = raw?.customer || {};
  const billing = customer.billing_address || {};
  const shipping = customer.shipping_address || {};
  return {
    name: [customer.firstname || shipping.firstname, customer.lastname || shipping.lastname].map(text).filter(Boolean).join(' '),
    documentNumber: text(billing.company || raw?.customer_tax_id),
    email: text(customer.email),
    phone: text(shipping.phone || shipping.phone_secondary || billing.phone),
  };
}

function addressText(address) {
  return [address?.street_1, address?.street_2, address?.additional_info]
    .map(text).filter(Boolean).join(', ');
}

export function mapRipleyShipping(raw) {
  const address = raw?.customer?.shipping_address || {};
  return {
    type: text(raw?.shipping_type_code || raw?.shipping_type_label),
    address: addressText(address),
    city: text(address.city),
    region: text(address.state),
    trackingCode: text(raw?.shipping_tracking),
    trackingUrl: text(raw?.shipping_tracking_url),
  };
}

export function mapRipleyOrderItems(raw) {
  const lines = Array.isArray(raw?.order_lines) ? raw.order_lines : [];
  return lines.map((line, index) => ({
    externalItemId: text(line?.order_line_id || line?.id || `line-${index + 1}`),
    sku: text(line?.offer_sku || line?.shop_sku),
    providerSku: text(line?.product_sku),
    description: text(line?.product_title || line?.description),
    quantity: number(line?.quantity, 1),
    unitPrice: number(line?.price_unit ?? line?.price),
    discountAmount: number(line?.total_commission),
    total: number(line?.total_price),
    providerStatus: text(line?.order_line_state),
    metadata: {
      categoryCode: text(line?.category_code),
      categoryLabel: text(line?.category_label),
      imageUrl: marketplaceItemImageUrl(line) || null,
    },
    rawData: line,
  }));
}

function ripleyPaymentStatus(raw, providerStatus) {
  const debit = normalizedState(raw?.payment_debit_status || raw?.payment_status);
  if (/(REFUND)/.test(debit)) return 'refunded';
  if (/(FAILED|REFUSED|CANCEL)/.test(debit)) return 'failed';
  if (/(DEBITED|PAID|CAPTURED)/.test(debit)) return 'paid';
  if (normalizedState(providerStatus) === 'WAITING_DEBIT') return 'pending';
  return 'unknown';
}

export async function ensureRipleyOrderAccount(db, companyId, displayName, shopId = 'default') {
  return ensureOrderChannelAccount({
    companyId,
    channelCode: 'ripley',
    externalAccountId: text(shopId) || 'default',
    displayName: displayName || `Ripley · Empresa ${Number(companyId)}`,
    autoCreateOrders: true,
    documentRequirement: 'required',
    documentTypePolicy: 'automatic',
    settings: { origin: 'ripley_mirakl_or11' },
  }, db);
}

function orderHasLines(normalized) {
  const lines = normalized?.raw?.order_lines;
  return Array.isArray(lines) && lines.length > 0;
}

export async function withRipleyOrderLines(client, normalized) {
  if (!normalized?.orderId || orderHasLines(normalized) || typeof client?.listOrders !== 'function') {
    return normalized;
  }
  const page = await client.listOrders({ orderIds: [normalized.orderId], max: 1 });
  const detailed = (page?.orders || []).find((order) => order.orderId === normalized.orderId);
  return orderHasLines(detailed) ? detailed : normalized;
}

export function shouldEnqueueRipleyStockJob(order) {
  return shouldListenStockOrder({
    status: order?.fulfillmentStatus,
    orderedAt: order?.orderedAt,
  });
}

export async function enqueueRipleyStockJob(order, input = {}, db, enqueue = enqueueStockJob) {
  if (!order?.id || !shouldEnqueueRipleyStockJob(order)) {
    return { enqueued: false, ignored: 'no elegible' };
  }
  try {
    return await enqueue({
      orderId: order.id,
      companyId: input.companyId || order.companyId,
      externalOrderId: order.externalOrderId,
      orderNumber: order.externalOrderNumber,
      source: input.source || 'sync',
    }, db);
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'catalog.stock.enqueue_failed',
      channel: 'ripley',
      companyId: input.companyId || order.companyId,
      orderId: order.externalOrderId,
      message: String(error?.message || error),
    }));
    return { enqueued: false, ignored: 'error' };
  }
}

export async function ingestRipleyOrder(input, db, dependencies = {}) {
  const normalized = input.normalized;
  const raw = normalized?.raw || {};
  const ingest = dependencies.ingest || ingestOrder;
  const enqueue = dependencies.enqueue || enqueueStockJob;
  const account = input.account || await ensureRipleyOrderAccount(
    db,
    input.companyId,
    input.displayName,
    input.shopId,
  );
  const existing = await existingRipleyOrder(db, account.id, normalized?.orderId);
  const statuses = resolveRipleyIngestStatuses(normalized?.status, existing);
  const items = mapRipleyOrderItems(raw);
  const ingested = await ingest({
    companyId: input.companyId,
    channelAccountId: account.id,
    automatic: true,
    externalOrderId: normalized?.orderId,
    externalOrderNumber: normalized?.orderNumber,
    ...statuses,
    paymentStatus: ripleyPaymentStatus(raw, normalized?.status),
    providerStatus: normalized?.status,
    currency: normalized?.currency || 'PEN',
    subtotal: number(raw?.price),
    shippingAmount: number(raw?.shipping_price),
    total: normalized?.total,
    customer: customerFrom(raw),
    shipping: mapRipleyShipping(raw),
    orderedAt: normalized?.createdAt,
    promisedShippingAt: isoDate(raw?.shipping_deadline || raw?.latest_shipping_date),
    providerUpdatedAt: normalized?.updatedAt,
    metadata: {
      commercialId: text(raw?.commercial_id),
      shippingTypeCode: text(raw?.shipping_type_code),
      shopId: text(raw?.shop_id || input.shopId),
      shopName: text(raw?.shop_name),
      hasIncident: Boolean(raw?.has_incident),
    },
    items,
    itemsComplete: items.length > 0,
    rawPayload: raw,
    source: input.source || 'sync',
    correlationId: input.correlationId,
    eventId: input.eventId,
    catalogInventoryEnabled: input.catalogInventoryEnabled === true,
    providerOccurredAt: normalized?.updatedAt || normalized?.createdAt,
  }, db);
  await enqueueRipleyStockJob(ingested.order, input, db, enqueue);
  return ingested;
}
