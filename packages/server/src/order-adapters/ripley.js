import { ensureOrderChannelAccount, ingestOrder } from '../order-management.js';

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
  if (status === 'SHIPPING' || status === 'READY_TO_SHIP') {
    return { orderStatus: 'confirmed', fulfillmentStatus: 'ready_to_ship' };
  }
  if (status === 'WAITING_ACCEPTANCE' || status === 'STAGING') {
    return { orderStatus: 'new', fulfillmentStatus: 'pending' };
  }
  return { orderStatus: 'confirmed', fulfillmentStatus: 'pending' };
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

export async function ingestRipleyOrder(input, db) {
  const normalized = input.normalized;
  const raw = normalized?.raw || {};
  const account = input.account || await ensureRipleyOrderAccount(
    db,
    input.companyId,
    input.displayName,
    input.shopId,
  );
  const statuses = mapRipleyCanonicalStatus(normalized?.status);
  const items = mapRipleyOrderItems(raw);
  const ingested = await ingestOrder({
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
    itemsError: items.length ? undefined : 'Ripley no devolvió los items del pedido.',
    rawPayload: raw,
    source: input.source || 'sync',
    correlationId: input.correlationId,
    eventId: input.eventId,
    providerOccurredAt: normalized?.updatedAt || normalized?.createdAt,
  }, db);
  return {
    ...ingested,
    itemsPending: items.length === 0,
    itemsError: items.length ? null : 'Ripley no devolvió los items del pedido.',
  };
}
