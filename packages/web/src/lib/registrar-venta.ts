import {
  OWN_FLEET_CARRIER,
  OWN_FLEET_ORIGIN,
  OWN_FLEET_OUT_OF_RANGE_MESSAGE,
  OUT_OF_PERU_MESSAGE,
  isInPeru,
  placeAtCoordinates,
  quoteOwnFleetShipping,
  saleTotals,
} from './own-fleet-shipping.ts';
import type { ShippingCarrier } from './shipping-carrier.ts';

export const SALE_SOURCES = [
  { value: 'marketplace', label: 'Marketplace' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'telefono', label: 'Teléfono' },
  { value: 'otro', label: 'Otro' },
] as const;

export const PAYMENT_METHODS = [
  { value: 'despues', label: 'Después' },
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'yape_plin', label: 'Yape / Plin' },
  { value: 'transferencia', label: 'Transferencia' },
] as const;

export const PICKUP_ADDRESS = OWN_FLEET_ORIGIN.address;

export const DOCUMENT_REQUESTS = [
  { value: 'none', label: 'Ninguno' },
  { value: 'boleta', label: 'Boleta' },
  { value: 'factura', label: 'Factura' },
] as const;

export const BOLETA_IDENTITIES = [
  { value: 'dni', label: 'DNI' },
  { value: 'ce', label: 'CE' },
] as const;

/** El orden es el recorrido del vendedor: quién compra, qué compra, cómo llega, cómo paga y qué se registra. */
export const SALE_STEPS = [
  { id: 'cliente', label: 'Cliente' },
  { id: 'productos', label: 'Productos' },
  { id: 'entrega', label: 'Entrega' },
  { id: 'pago', label: 'Pago' },
  { id: 'resumen', label: 'Resumen' },
] as const;

export type SaleStepId = (typeof SALE_STEPS)[number]['id'];

export type SaleSource = (typeof SALE_SOURCES)[number]['value'];
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]['value'];
export type DeliveryMethod = 'recojo' | 'envio';
export type DocumentRequest = (typeof DOCUMENT_REQUESTS)[number]['value'];
export type BoletaIdentity = (typeof BOLETA_IDENTITIES)[number]['value'];
export type { ShippingCarrier };

export type CatalogProductForSale = {
  id: number;
  mainSku: string;
  name: string;
  imageUrl?: string | null;
  referencePrice?: number | null;
  sellerPriceMin?: number | null;
  available?: number | null;
  listings?: Array<{ shopSku?: string | null }>;
};

export type SaleLine = {
  id: string;
  productId: number;
  sku: string;
  name: string;
  imageUrl?: string | null;
  shopSku?: string | null;
  catalogPrice: number;
  unitPrice: number;
  quantity: number;
};

export type DropoffPlace = {
  label: string;
  district?: string;
  province?: string;
  department?: string;
  lat?: number;
  lng?: number;
};

export type ManualSaleInput = {
  channelAccountId?: number | null;
  customerName: string;
  customerPhone?: string;
  lines: SaleLine[];
  delivery: DeliveryMethod;
  deliveryDate: string;
  shippingCarrier: ShippingCarrier | '';
  dropoffPlace: DropoffPlace | null;
  shippingNote?: string;
  saleSource: SaleSource;
  paymentMethod: PaymentMethod;
  receivedBy?: string;
  paymentProof?: { name: string; type: string; dataUrl: string } | null;
  documentRequest?: DocumentRequest;
  boletaIdentity?: BoletaIdentity;
  customerDocumentNumber?: string;
  legalName?: string;
  fiscalAddress?: string;
  orderedAt?: string;
  orderNumber?: string;
};

function digitsOnly(value: string | null | undefined) {
  return String(value || '').replace(/\D/g, '');
}

export function validateDocumentRequest(input: ManualSaleInput) {
  const kind = input.documentRequest || 'none';
  if (kind === 'none') return null;
  if (kind === 'boleta') {
    const identity = input.boletaIdentity || 'dni';
    const number = String(input.customerDocumentNumber || '').trim();
    if (identity === 'ce') {
      if (!/^[A-Za-z0-9]{8,12}$/.test(number)) return 'Escribe el carné de extranjería.';
      return null;
    }
    if (!/^\d{8}$/.test(digitsOnly(number))) return 'Escribe el DNI de 8 dígitos.';
    return null;
  }
  if (!/^\d{11}$/.test(digitsOnly(input.customerDocumentNumber))) {
    return 'Escribe el RUC de 11 dígitos.';
  }
  if (!String(input.legalName || '').trim()) return 'Escribe la razón social.';
  if (!String(input.fiscalAddress || '').trim()) return 'Escribe la dirección fiscal.';
  return null;
}

export function customerTaxPayload(input: ManualSaleInput) {
  const name = String(input.customerName || '').trim();
  const phone = String(input.customerPhone || '').trim();
  const kind = input.documentRequest || 'none';
  if (kind === 'boleta') {
    const identity = input.boletaIdentity || 'dni';
    const number = identity === 'dni'
      ? digitsOnly(input.customerDocumentNumber)
      : String(input.customerDocumentNumber || '').trim();
    return {
      name,
      phone,
      documentType: identity === 'ce' ? '4' : '1',
      documentNumber: number,
    };
  }
  if (kind === 'factura') {
    const legalName = String(input.legalName || name).trim();
    return {
      name: legalName,
      phone,
      documentType: '6',
      documentNumber: digitsOnly(input.customerDocumentNumber),
      legalName,
      address: String(input.fiscalAddress || '').trim(),
    };
  }
  return { name, phone };
}

export function productPrice(product: CatalogProductForSale) {
  const value = Number(product.sellerPriceMin ?? product.referencePrice ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function productStock(product: CatalogProductForSale) {
  const value = Number(product.available);
  return Number.isFinite(value) ? value : 0;
}

export function formatProductStock(product: CatalogProductForSale) {
  return `${productStock(product)} u`;
}

export function limaTodayKey(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function limaDateToIso(dateKey: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || '').trim())) {
    throw new Error('Fecha de entrega inválida.');
  }
  return `${dateKey}T12:00:00-05:00`;
}

/** Número comercial de 10 dígitos, mismo ancho que Falabella/Ripley. El origen marca que es manual. */
export function generateManualOrderNumber(
  now = new Date(),
  random: () => number = Math.random,
) {
  const day = limaTodayKey(now).replace(/-/g, '').slice(2); // YYMMDD
  const suffix = String(Math.floor(random() * 10_000)).padStart(4, '0');
  return `${day}${suffix}`;
}

export function saleLinesTotal(lines: SaleLine[]) {
  return lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
}

function validateCustomerName(input: ManualSaleInput) {
  if (!String(input.customerName || '').trim()) {
    return 'Escribe el nombre del cliente.';
  }
  return null;
}

function validateSaleLines(input: ManualSaleInput) {
  if (!input.lines.length) {
    return 'Agrega al menos un producto.';
  }
  if (input.lines.some((line) => line.quantity < 1 || line.unitPrice < 0)) {
    return 'Revisa cantidad y precio de cada producto.';
  }
  return null;
}

function validateDelivery(input: ManualSaleInput, fleetConfig?: Parameters<typeof quoteOwnFleetShipping>[1]) {
  if (!String(input.deliveryDate || '').trim()) {
    return 'Indica la fecha de entrega.';
  }
  if (input.delivery !== 'envio') return null;
  if (!input.shippingCarrier) {
    return 'Elige el reparto: Marvisuar, Shaloom, Dinsides o Nosotros.';
  }
  if (!input.dropoffPlace) {
    return 'Busca el distrito de Lima metropolitana.';
  }
  const lat = Number(input.dropoffPlace.lat);
  const lng = Number(input.dropoffPlace.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng) && !isInPeru(lat, lng)) {
    return OUT_OF_PERU_MESSAGE;
  }
  if (input.shippingCarrier === OWN_FLEET_CARRIER) {
    const quote = quoteOwnFleetShipping(input.dropoffPlace, fleetConfig);
    if (quote && !quote.charged) return OWN_FLEET_OUT_OF_RANGE_MESSAGE;
  }
  return null;
}

export function validateManualSale(input: ManualSaleInput, fleetConfig?: Parameters<typeof quoteOwnFleetShipping>[1]) {
  if (!input.channelAccountId) {
    return 'Todavía no hay un canal de venta manual habilitado.';
  }
  return validateCustomerName(input)
    ?? validateSaleLines(input)
    ?? validateDelivery(input, fleetConfig)
    ?? validateDocumentRequest(input);
}

/** Lo que bloquea un paso del stepper. `pago` no exige nada: el método siempre trae un valor. */
export function validateSaleStep(
  step: SaleStepId,
  input: ManualSaleInput,
  fleetConfig?: Parameters<typeof quoteOwnFleetShipping>[1],
) {
  if (step === 'cliente') return validateCustomerName(input) ?? validateDocumentRequest(input);
  if (step === 'productos') return validateSaleLines(input);
  if (step === 'entrega') return validateDelivery(input, fleetConfig);
  if (step === 'pago') return null;
  return validateManualSale(input, fleetConfig);
}

/** Primer paso que impide registrar. El resumen usa esto para devolver al vendedor al campo que falta. */
export function firstInvalidSaleStep(
  input: ManualSaleInput,
  fleetConfig?: Parameters<typeof quoteOwnFleetShipping>[1],
): SaleStepId | null {
  for (const step of SALE_STEPS) {
    if (step.id === 'resumen') break;
    if (validateSaleStep(step.id, input, fleetConfig)) return step.id;
  }
  return null;
}

export function buildManualSaleOrderPayload(input: ManualSaleInput, fleetConfig?: Parameters<typeof quoteOwnFleetShipping>[1]) {
  const error = validateManualSale(input, fleetConfig);
  if (error) throw new Error(error);

  const paidNow = input.paymentMethod !== 'despues';
  const orderNumber = input.orderNumber || generateManualOrderNumber(
    input.orderedAt ? new Date(input.orderedAt) : new Date(),
  );
  const productsTotal = saleLinesTotal(input.lines);
  const ownFleet = input.delivery === 'envio' && input.shippingCarrier === OWN_FLEET_CARRIER;
  const dropoff = input.dropoffPlace;
  const dropoffLat = Number(dropoff?.lat);
  const dropoffLng = Number(dropoff?.lng);
  const atPin = dropoff && Number.isFinite(dropoffLat) && Number.isFinite(dropoffLng)
    ? placeAtCoordinates(dropoffLat, dropoffLng, fleetConfig)
    : null;
  const shippingQuote = ownFleet ? quoteOwnFleetShipping(dropoff, fleetConfig) : null;
  const totals = saleTotals(productsTotal, shippingQuote);
  const deliveryDate = String(input.deliveryDate).trim();
  const shippingDistrict = atPin ? (atPin.district || '') : (dropoff?.district || '');
  const shippingProvince = atPin ? (atPin.province || '') : (dropoff?.province || '');
  const shippingDepartment = atPin ? (atPin.department || '') : (dropoff?.department || '');

  return {
    channelAccountId: input.channelAccountId,
    externalOrderId: orderNumber,
    externalOrderNumber: orderNumber,
    orderStatus: 'confirmed' as const,
    paymentStatus: paidNow ? 'paid' as const : 'pending' as const,
    fulfillmentStatus: 'ready_to_ship' as const,
    requestedDocumentType: (input.documentRequest === 'boleta' || input.documentRequest === 'factura')
      ? input.documentRequest
      : null,
    currency: 'PEN',
    subtotal: totals.products,
    shippingAmount: totals.shipping || null,
    total: totals.total,
    customer: customerTaxPayload(input),
    shipping: {
      type: input.delivery,
      carrier: input.delivery === 'envio' ? input.shippingCarrier : undefined,
      address: input.delivery === 'envio' ? input.dropoffPlace?.label || '' : PICKUP_ADDRESS,
      district: input.delivery === 'envio' ? shippingDistrict : '',
      province: input.delivery === 'envio' ? shippingProvince : '',
      department: input.delivery === 'envio' ? shippingDepartment : '',
      reference: input.delivery === 'envio' ? String(input.shippingNote || '').trim() : '',
      lat: input.delivery === 'envio' ? input.dropoffPlace?.lat : undefined,
      lng: input.delivery === 'envio' ? input.dropoffPlace?.lng : undefined,
      districtAmount: shippingQuote?.districtAmount,
      distanceAmount: shippingQuote?.distanceAmount,
      distanceKm: shippingQuote?.distanceKm,
      zoneKind: shippingQuote?.zone.kind,
      zoneLabel: shippingQuote?.zoneLabel,
    },
    metadata: {
      origin: 'manual_ui',
      saleSource: input.saleSource,
      delivery: input.delivery,
      deliveryDate,
      shippingCarrier: input.delivery === 'envio' ? input.shippingCarrier : '',
      paymentMethod: input.paymentMethod,
      receivedBy: input.paymentMethod === 'efectivo' ? String(input.receivedBy || '').trim() : '',
      paymentProof: input.paymentProof || null,
      catalog: 'real',
    },
    orderedAt: input.orderedAt || new Date().toISOString(),
    promisedShippingAt: limaDateToIso(deliveryDate),
    itemsComplete: true,
    items: input.lines.map((line, index) => ({
      externalItemId: `${orderNumber}-${index + 1}`,
      sku: line.sku,
      description: line.name,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      total: line.unitPrice * line.quantity,
      metadata: { productId: line.productId, catalogPrice: line.catalogPrice },
    })),
  };
}
