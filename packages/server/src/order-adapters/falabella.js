import { ensureOrderChannelAccount, ingestOrder } from '../order-management.js';

function text(value) {
  return String(value ?? '').trim();
}

function number(value, fallback = null) {
  const parsed = Number(String(value ?? '').replace(/,/g, ''));
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
  return { orderStatus: 'confirmed', fulfillmentStatus: 'pending' };
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

function shippingFrom(raw) {
  return {
    type: text(raw?.ShippingType),
    address: text(raw?.AddressShipping || raw?.ShippingAddress || raw?.Address),
    city: text(raw?.AddressShippingCity || raw?.ShippingCity || raw?.City),
    region: text(raw?.AddressShippingRegion || raw?.ShippingRegion || raw?.Region),
    trackingCode: text(raw?.TrackingCode || raw?.TrackingNumber),
  };
}

function orderItemsFrom(raw) {
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
  const statuses = mapFalabellaCanonicalStatus(normalized?.status);
  const items = orderItemsFrom(raw);
  return ingestOrder({
    companyId: input.companyId,
    channelAccountId: account.id,
    automatic: true,
    externalOrderId: normalized?.orderId,
    externalOrderNumber: normalized?.orderNumber,
    ...statuses,
    paymentStatus: 'unknown',
    providerStatus: normalized?.status,
    requestedDocumentType: normalized?.invoiceRequired ? 'factura' : null,
    currency: normalized?.currency || 'PEN',
    total: normalized?.grandTotal,
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
    providerOccurredAt: normalized?.falabellaUpdatedAt,
  }, db);
}
