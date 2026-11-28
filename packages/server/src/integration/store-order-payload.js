import { fiscalIdError, STORE_DOC_TYPES } from './fiscal-id.js';
import { stableHash } from './crypto.js';

// Validación y mapeo del cuerpo de PUT /orders/{externalId} (contrato v1) al
// input de ingestOrder. Solo funciones puras: se prueban sin base de datos.

const PAYMENT_STATUSES = {
  paid: 'paid',
  captured: 'paid',
  authorized: 'pending',
  pending: 'pending',
  awaiting: 'pending',
  failed: 'failed',
  canceled: 'failed',
  cancelled: 'failed',
  refunded: 'refunded',
  partially_refunded: 'partially_refunded',
};

const PAYMENT_METHODS = {
  card: 'tarjeta',
  credit_card: 'tarjeta',
  debit_card: 'tarjeta',
  yape: 'yape_plin',
  plin: 'yape_plin',
  yape_plin: 'yape_plin',
  transfer: 'transferencia',
  bank_transfer: 'transferencia',
  cash: 'efectivo',
};

function text(value, max = 500) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, max) : null;
}

function isoDate(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function money(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : NaN;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateStoreOrderPayload(body, externalIdInput) {
  const errors = [];
  const push = (path, message) => errors.push({ path, message });
  const externalId = text(externalIdInput, 300);
  if (!externalId) push('externalId', 'externalId es obligatorio.');
  if (!isObject(body)) {
    push('', 'El cuerpo debe ser un objeto JSON.');
    return { errors };
  }

  const orderNumber = text(body.orderNumber, 300);
  if (!orderNumber) push('orderNumber', 'orderNumber es obligatorio.');
  const orderedAt = isoDate(body.orderedAt);
  if (!orderedAt) push('orderedAt', 'orderedAt debe ser una fecha ISO-8601.');
  const updatedAt = isoDate(body.updatedAt);
  if (!updatedAt) push('updatedAt', 'updatedAt debe ser una fecha ISO-8601.');
  const currency = text(body.currency || 'PEN', 10)?.toUpperCase();
  if (currency !== 'PEN') push('currency', 'Solo se acepta PEN.');

  const payment = isObject(body.payment) ? body.payment : {};
  if (body.payment !== undefined && body.payment !== null && !isObject(body.payment)) push('payment', 'payment debe ser un objeto.');
  const paymentStatus = PAYMENT_STATUSES[String(payment.status || '').trim().toLowerCase()] || 'unknown';
  const paidAt = payment.paidAt == null ? null : isoDate(payment.paidAt);
  if (payment.paidAt != null && !paidAt) push('payment.paidAt', 'paidAt debe ser una fecha ISO-8601.');

  const customer = isObject(body.customer) ? body.customer : null;
  if (!customer) push('customer', 'customer es obligatorio.');

  let document = null;
  if (body.document !== undefined && body.document !== null) {
    if (!isObject(body.document)) {
      push('document', 'document debe ser null o un objeto.');
    } else {
      const type = String(body.document.type || '').trim().toLowerCase();
      if (!['boleta', 'factura'].includes(type)) push('document.type', 'document.type debe ser boleta o factura.');
      const docCustomer = isObject(body.document.customer) ? body.document.customer : {};
      const docType = String(docCustomer.docType || '').trim().toUpperCase();
      const code = STORE_DOC_TYPES[docType];
      if (!code) push('document.customer.docType', 'docType debe ser DNI, CE, PASSPORT o RUC.');
      if (type === 'factura' && docType !== 'RUC') push('document.customer.docType', 'La factura requiere RUC.');
      if (type === 'boleta' && docType === 'RUC') push('document.customer.docType', 'La boleta no se emite con RUC.');
      const docNumber = text(docCustomer.docNumber, 20)?.toUpperCase() || '';
      const idError = code ? fiscalIdError(code, docNumber) : null;
      if (idError) push('document.customer.docNumber', idError);
      const name = text(docCustomer.name, 200);
      if (!name) push('document.customer.name', 'Ingresa el nombre o razón social.');
      const address = text(docCustomer.address, 300);
      if (type === 'factura' && !address) push('document.customer.address', 'La factura requiere dirección fiscal.');
      document = { type, docType, code, docNumber, name, address };
    }
  }

  const fulfillment = isObject(body.fulfillment) ? body.fulfillment : null;
  const fulfillmentType = String(fulfillment?.type || '').trim().toLowerCase();
  if (!['delivery', 'pickup'].includes(fulfillmentType)) push('fulfillment.type', 'fulfillment.type debe ser delivery o pickup.');
  const zone = fulfillment?.zone == null ? null : String(fulfillment.zone).trim().toLowerCase();
  if (zone && !['lima', 'provincia'].includes(zone)) push('fulfillment.zone', 'zone debe ser lima, provincia o null.');
  const address = isObject(fulfillment?.address) ? fulfillment.address : {};
  if (fulfillmentType === 'delivery' && !text(address.line1)) push('fulfillment.address.line1', 'La dirección de envío es obligatoria.');

  const items = Array.isArray(body.items) ? body.items : null;
  if (!items || !items.length) push('items', 'El pedido debe tener al menos un producto.');
  const normalizedItems = (items || []).map((item, index) => {
    const path = `items[${index}]`;
    if (!isObject(item)) {
      push(path, 'Cada producto debe ser un objeto.');
      return null;
    }
    const id = text(item.id, 300);
    if (!id) push(`${path}.id`, 'id es obligatorio.');
    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) push(`${path}.quantity`, 'quantity debe ser mayor que 0.');
    const unitPrice = money(item.unitPrice);
    if (!(unitPrice >= 0)) push(`${path}.unitPrice`, 'unitPrice debe ser un número mayor o igual a 0.');
    const discount = item.discount == null ? 0 : money(item.discount);
    if (!(discount >= 0)) push(`${path}.discount`, 'discount debe ser mayor o igual a 0.');
    const total = money(item.total);
    if (!(total > 0)) push(`${path}.total`, 'total debe ser mayor que 0.');
    return {
      id,
      sku: text(item.sku, 300),
      description: String(item.description || '').trim().slice(0, 2000),
      quantity,
      unitPrice,
      discount,
      total,
    };
  }).filter(Boolean);
  const ids = normalizedItems.map((item) => item.id).filter(Boolean);
  if (new Set(ids).size !== ids.length) push('items', 'Los id de los productos deben ser únicos.');

  const shipping = isObject(body.shipping) ? body.shipping : { total: 0 };
  const shippingTotal = money(shipping.total ?? 0);
  if (!(shippingTotal >= 0)) push('shipping.total', 'shipping.total debe ser mayor o igual a 0.');
  const total = money(body.total);
  const itemsTotal = normalizedItems.reduce((sum, item) => sum + (Number.isFinite(item.total) ? item.total : 0), 0);
  if (!(total > 0)) {
    push('total', 'total debe ser mayor que 0.');
  } else if (Math.abs(itemsTotal + (Number.isFinite(shippingTotal) ? shippingTotal : 0) - total) > 0.005) {
    push('total', `total (${total.toFixed(2)}) debe ser la suma de los productos y el envío (${(itemsTotal + shippingTotal).toFixed(2)}).`);
  }
  const discountTotal = body.discountTotal == null ? null : money(body.discountTotal);
  if (body.discountTotal != null && !(discountTotal >= 0)) push('discountTotal', 'discountTotal debe ser mayor o igual a 0.');

  if (errors.length) return { errors };
  return {
    errors,
    value: {
      externalId,
      orderNumber,
      orderedAt,
      updatedAt,
      currency,
      payment: {
        status: paymentStatus,
        rawStatus: text(payment.status, 50),
        paidAt,
        method: text(payment.method, 50),
        provider: text(payment.provider, 50),
        reference: text(payment.reference, 200),
      },
      customer: {
        name: text(customer.name, 200),
        email: text(customer.email, 200),
        phone: text(customer.phone, 50),
      },
      document,
      fulfillment: {
        type: fulfillmentType,
        zone,
        address: {
          recipient: text(address.recipient, 200),
          line1: text(address.line1, 300),
          line2: text(address.line2, 300),
          district: text(address.district, 120),
          department: text(address.department, 120),
          reference: text(address.reference, 300),
          phone: text(address.phone, 50),
        },
      },
      items: normalizedItems,
      shipping: { description: text(shipping.description, 200), total: shippingTotal },
      discountTotal,
      total,
      itemsTotal: Math.round(itemsTotal * 100) / 100,
    },
  };
}

// Huella de lo que no puede cambiar después de emitir: ítems, montos y datos fiscales.
export function fiscalFingerprint(value) {
  return stableHash({
    items: value.items.map((item) => ({
      id: item.id,
      sku: item.sku,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discount: item.discount,
      total: item.total,
    })),
    shipping: value.shipping.total,
    total: value.total,
    document: value.document,
  });
}

export function storePaymentMethod(method) {
  const key = String(method || '').trim().toLowerCase();
  return PAYMENT_METHODS[key] || (key ? key.slice(0, 50) : null);
}

/**
 * Arma el input de ingestOrder. Zentofact conserva order/fulfillment status;
 * los datos fiscales cargados por el operador sobreviven si la tienda no manda
 * `document` (en modo a demanda los carga el operador, no la tienda).
 */
export function mapStoreOrderToIngest(value, { account, existing, productIdsBySku = new Map(), rawPayload }) {
  const address = value.fulfillment.address;
  const customer = {
    name: value.customer.name,
    email: value.customer.email,
    phone: value.customer.phone,
  };
  if (value.document) {
    customer.documentType = value.document.code;
    customer.documentNumber = value.document.docNumber;
    customer.legalName = value.document.name;
    customer.address = value.document.address;
  }
  const delivery = value.fulfillment.type === 'delivery';
  const shippingAddress = [address.line1, address.line2].filter(Boolean).join(', ') || null;
  return {
    channelAccountId: account.id,
    companyId: account.companyId,
    externalOrderId: value.externalId,
    externalOrderNumber: value.orderNumber,
    orderStatus: existing?.order_status || 'new',
    fulfillmentStatus: existing?.fulfillment_status || 'pending',
    paymentStatus: value.payment.status,
    requestedDocumentType: value.document?.type ?? undefined,
    currency: value.currency,
    subtotal: value.itemsTotal,
    shippingAmount: value.shipping.total,
    discountAmount: value.discountTotal,
    total: value.total,
    customer,
    shipping: {
      type: delivery ? 'envio' : 'recojo',
      zone: delivery ? value.fulfillment.zone : null,
      recipient: delivery ? address.recipient : null,
      address: delivery ? shippingAddress : null,
      district: delivery ? address.district : null,
      region: delivery ? address.department : null,
      reference: delivery ? address.reference : null,
      phone: delivery ? address.phone : null,
      description: value.shipping.description,
    },
    metadata: {
      origin: 'store_api',
      paymentMethod: storePaymentMethod(value.payment.method),
      paymentProvider: value.payment.provider,
      paymentReference: value.payment.reference,
      paymentStatusRaw: value.payment.rawStatus,
      paidAt: value.payment.paidAt,
      delivery: delivery ? 'envio' : 'recojo',
      integrationFiscalHash: fiscalFingerprint(value),
      integrationUpdatedAt: value.updatedAt,
    },
    orderedAt: value.orderedAt,
    providerUpdatedAt: value.updatedAt,
    itemsComplete: true,
    items: value.items.map((item) => ({
      externalItemId: item.id,
      sku: item.sku,
      description: item.description || item.sku || 'Producto',
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discountAmount: item.discount,
      total: item.total,
      productId: item.sku ? productIdsBySku.get(item.sku) ?? null : null,
    })),
    source: 'api',
    automatic: false,
    eventId: `store-put:${stableHash(rawPayload ?? value)}`,
    rawPayload: rawPayload ?? value,
    catalogAllowNegative: account.settings?.allowNegative !== false,
  };
}
