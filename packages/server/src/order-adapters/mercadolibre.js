import { extractOrderItemSellerSku } from '@zentofact/mercado-libre-api';
import { enqueueStockJob } from '../catalog/stock-jobs.js';
import { shouldListenStockOrder } from '../catalog/stock-commitment.js';
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
  return text(value).toLowerCase().replace(/[ -]+/g, '_');
}

function tagList(value) {
  if (Array.isArray(value)) return value.map(normalizedState).filter(Boolean);
  const single = normalizedState(value);
  return single ? [single] : [];
}

function objectRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

export function mapMercadoLibreCanonicalStatus({ orderStatus, shipmentStatus, tags } = {}) {
  const order = normalizedState(orderStatus);
  const shipment = normalizedState(shipmentStatus);
  const tagSet = new Set(tagList(tags));
  const cancelled = order.includes('cancel')
    || shipment.includes('cancel')
    || tagSet.has('cancelled')
    || tagSet.has('pending_cancel');
  if (cancelled) {
    return { orderStatus: 'cancelled', fulfillmentStatus: 'cancelled' };
  }
  if (shipment === 'delivered') {
    return { orderStatus: 'completed', fulfillmentStatus: 'delivered' };
  }
  if (shipment === 'shipped' || shipment === 'stale_shipped') {
    return { orderStatus: 'confirmed', fulfillmentStatus: 'shipped' };
  }
  if ((shipment === 'ready_to_ship' || shipment === 'stale_ready_to_ship') && !tagSet.has('fraud_risk_detected')) {
    return { orderStatus: 'confirmed', fulfillmentStatus: 'ready_to_ship' };
  }
  if (shipment === 'handling' || tagSet.has('fraud_risk_detected')) {
    return { orderStatus: 'confirmed', fulfillmentStatus: 'preparing' };
  }
  if (order === 'paid' || order === 'partially_paid') {
    return { orderStatus: 'confirmed', fulfillmentStatus: 'pending' };
  }
  if (order.startsWith('payment_') || order === 'confirmed' || order === 'pending') {
    return { orderStatus: 'new', fulfillmentStatus: 'pending' };
  }
  return { orderStatus: 'confirmed', fulfillmentStatus: 'unmapped' };
}

export function mercadoLibrePaymentStatus(orderStatus, tags) {
  const status = normalizedState(orderStatus);
  const tagSet = new Set(tagList(tags));
  if (status.includes('cancel') || tagSet.has('cancelled')) return 'failed';
  if (status === 'paid') return 'paid';
  if (status === 'partially_paid') return 'pending';
  if (status.startsWith('payment_') || status === 'confirmed' || status === 'pending') return 'pending';
  return 'unknown';
}

export function mapMercadoLibreOrderItems(raw) {
  const lines = Array.isArray(raw?.order_items) ? raw.order_items : [];
  return lines.map((line, index) => {
    const item = objectRecord(line?.item) || {};
    const sku = extractOrderItemSellerSku(line) || '';
    return {
      externalItemId: text(item.id || line?.id || `line-${index + 1}`),
      sku,
      providerSku: text(item.id),
      description: text(item.title || line?.title),
      quantity: number(line?.quantity, 1),
      unitPrice: number(line?.unit_price ?? line?.full_unit_price),
      total: number(line?.unit_price ?? line?.full_unit_price) == null
        ? null
        : Number(((number(line?.unit_price ?? line?.full_unit_price) || 0) * (number(line?.quantity, 1) || 1)).toFixed(2)),
      providerStatus: text(line?.status),
      metadata: {
        variationId: text(item.variation_id),
        sellerSku: sku,
      },
      rawData: line,
    };
  });
}

export function mapMercadoLibreCustomer(raw, billing) {
  const buyer = objectRecord(raw?.buyer) || {};
  const billingName = [billing?.name, billing?.lastName].map(text).filter(Boolean).join(' ');
  const buyerName = [buyer.first_name, buyer.last_name, buyer.nickname].map(text).filter(Boolean).join(' ');
  return {
    name: billingName || buyerName,
    documentNumber: text(billing?.documentNumber || buyer.doc_number),
    email: text(buyer.email),
    phone: text(buyer.phone?.number || buyer.phone),
  };
}

export function mapMercadoLibreShipping(shipment) {
  const raw = objectRecord(shipment?.raw) || objectRecord(shipment) || {};
  const destination = objectRecord(raw.destination) || {};
  const address = objectRecord(destination.shipping_address || destination.receiver_address || raw.receiver_address) || {};
  return {
    type: text(shipment?.logisticType || raw.logistic_type || raw.mode),
    address: [address.address_line, address.street_name, address.street_number, address.comment]
      .map(text).filter(Boolean).join(', '),
    city: text(address.city?.name || address.city),
    region: text(address.state?.name || address.state),
    trackingCode: text(shipment?.trackingNumber || raw.tracking_number),
  };
}

export function mercadoLibreRequestedDocumentType(billing) {
  const customerType = normalizedState(billing?.customerType);
  const documentType = normalizedState(billing?.documentType);
  if (customerType === 'bu' || documentType === 'ruc') return 'factura';
  if (customerType === 'co' || documentType === 'dni' || documentType === 'ce') return 'boleta';
  return null;
}

export async function ensureMercadoLibreOrderAccount(db, companyId, displayName, userId) {
  return ensureOrderChannelAccount({
    companyId,
    channelCode: 'mercado_libre',
    externalAccountId: text(userId),
    displayName: displayName || `Mercado Libre · Empresa ${Number(companyId)}`,
    autoCreateOrders: true,
    documentRequirement: 'optional',
    documentTypePolicy: 'automatic',
    settings: { origin: 'mercado_libre_oauth' },
  }, db);
}

export function shouldEnqueueMercadoLibreStockJob(order) {
  return shouldListenStockOrder({
    status: order?.fulfillmentStatus,
    orderedAt: order?.orderedAt,
  });
}

export async function enqueueMercadoLibreStockJob(order, input = {}, db, enqueue = enqueueStockJob) {
  if (!order?.id || !shouldEnqueueMercadoLibreStockJob(order)) {
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
      channel: 'mercado_libre',
      companyId: input.companyId || order.companyId,
      orderId: order.externalOrderId,
      message: String(error?.message || error),
    }));
    return { enqueued: false, ignored: 'error' };
  }
}

export async function ingestMercadoLibreOrder(input, db, dependencies = {}) {
  const normalized = input.normalized;
  const raw = objectRecord(normalized?.raw) || {};
  const shipment = input.shipment || null;
  const billing = input.billing || null;
  const ingest = dependencies.ingest || ingestOrder;
  const enqueue = dependencies.enqueue || enqueueStockJob;
  const account = input.account || await ensureMercadoLibreOrderAccount(
    db,
    input.companyId,
    input.displayName,
    input.userId || input.externalAccountId,
  );
  const statuses = mapMercadoLibreCanonicalStatus({
    orderStatus: normalized?.status || raw.status,
    shipmentStatus: shipment?.status,
    tags: raw.tags,
  });
  const items = mapMercadoLibreOrderItems(raw);
  const ingested = await ingest({
    companyId: input.companyId,
    channelAccountId: account.id,
    automatic: true,
    externalOrderId: text(normalized?.orderId || raw.id),
    externalOrderNumber: text(normalized?.orderId || raw.id),
    ...statuses,
    paymentStatus: mercadoLibrePaymentStatus(normalized?.status || raw.status, raw.tags),
    providerStatus: [normalized?.status || raw.status, shipment?.status].map(text).filter(Boolean).join('|') || null,
    requestedDocumentType: mercadoLibreRequestedDocumentType(billing),
    currency: normalized?.currency || text(raw.currency_id) || 'PEN',
    subtotal: number(raw.total_amount),
    total: normalized?.total ?? number(raw.paid_amount ?? raw.total_amount),
    customer: mapMercadoLibreCustomer(raw, billing),
    shipping: mapMercadoLibreShipping(shipment),
    orderedAt: normalized?.createdAt || isoDate(raw.date_created),
    providerUpdatedAt: normalized?.updatedAt || isoDate(raw.last_updated || raw.date_last_updated),
    metadata: {
      packId: text(normalized?.packId || raw.pack_id),
      shippingId: text(normalized?.shippingId || shipment?.shipmentId),
      siteId: text(input.siteId || billing?.siteId || 'MPE'),
      logisticType: text(shipment?.logisticType),
      tags: tagList(raw.tags),
    },
    items,
    itemsComplete: items.length > 0,
    rawPayload: { order: raw, shipment: shipment?.raw || null, billing: billing?.raw || null },
    source: input.source || 'sync',
    correlationId: input.correlationId,
    eventId: input.eventId,
    catalogInventoryEnabled: input.catalogInventoryEnabled === true,
    providerOccurredAt: normalized?.updatedAt || shipment?.raw?.last_updated || normalized?.createdAt,
  }, db);
  await enqueueMercadoLibreStockJob(ingested.order, input, db, enqueue);
  return ingested;
}
