import {
  OWN_FLEET_CARRIER,
  OWN_FLEET_ORIGIN,
  OWN_FLEET_OUT_OF_RANGE_MESSAGE,
  OUT_OF_PERU_MESSAGE,
  isInPeru,
  ownFleetOriginAddress,
  placeAtCoordinates,
  quoteOwnFleetShipping,
  saleTotals,
} from './own-fleet-shipping.ts';
import { isSellerPricedShipping, type ShippingCarrier } from './shipping-carrier.ts';

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

export const PICKUP_ADDRESS: string = OWN_FLEET_ORIGIN.address;

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
  commissionAmount?: number | null;
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
  commissionAmount?: number | null;
  shopSku?: string | null;
  catalogPrice: number;
  unitPrice: number;
  quantity: number;
  available?: number | null;
  /** Texto mientras se edita Cant. Vacío se muestra vacío; no se fuerza a 1. */
  quantityDraft?: string;
  /** Texto mientras se edita Precio. Vacío se muestra vacío; no se fuerza a 0. */
  unitPriceDraft?: string;
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
  /** Precio de envío que escribe el vendedor para Marvisuar, Shaloom o Dinsides. `null` = no lo puso. */
  sellerShippingAmount?: number | null;
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

export const MIN_CUSTOMER_PHONE_DIGITS = 9;
export const NO_STOCK_MESSAGE = 'Ese producto no tiene stock.';
export const STOCK_SHORT_MESSAGE = 'No hay stock para esa cantidad.';
export const PHONE_REQUIRED_MESSAGE = 'Escribe un teléfono de 9 dígitos.';
export const SELLER_SHIPPING_REQUIRED_MESSAGE = 'Indica el precio de envío.';

function digitsOnly(value: string | null | undefined) {
  return String(value || '').replace(/\D/g, '');
}

export function customerPhoneDigits(value: string | null | undefined) {
  return digitsOnly(value);
}

export function parseSellerShippingAmount(value: string | number | null | undefined) {
  if (value === '' || value == null) return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).trim().replace(',', '.'));
  if (!Number.isFinite(parsed)) return null;
  return parsed;
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
  const phone = customerPhoneDigits(input.customerPhone);
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

function money2(value: number) {
  return Math.round(Number(value) * 100) / 100;
}

/** Precio que ve el vendedor: el registrado del catálogo. El mínimo de marketplace solo si no hay precio maestro. */
export function productPrice(product: CatalogProductForSale) {
  const reference = Number(product.referencePrice);
  if (Number.isFinite(reference) && reference > 0) return reference;
  const seller = Number(product.sellerPriceMin);
  return Number.isFinite(seller) && seller > 0 ? seller : 0;
}

/** Precio del vendedor: el de catálogo menos la comisión fija. */
export function sellerBasePrice(catalogPrice: number, commissionAmount: number) {
  return money2(Number(catalogPrice) - Number(commissionAmount));
}

/** En el precio de catálogo el vendedor gana solo la comisión fija. */
export function productProfit(product: CatalogProductForSale) {
  if (product.commissionAmount == null) return null;
  return money2(Number(product.commissionAmount));
}

/** Lo extra sobre el precio del vendedor (catálogo − comisión) es del vendedor. */
export function saleLineProfit(line: Pick<SaleLine, 'unitPrice' | 'quantity' | 'commissionAmount' | 'catalogPrice'>) {
  if (line.commissionAmount == null) return null;
  const catalog = Number(line.catalogPrice);
  const list = Number.isFinite(catalog) && catalog > 0 ? catalog : Number(line.unitPrice);
  const sellerBase = sellerBasePrice(list, Number(line.commissionAmount));
  return money2((Number(line.unitPrice) - sellerBase) * Number(line.quantity || 0));
}

export function saleProfit(lines: Array<Pick<SaleLine, 'unitPrice' | 'quantity' | 'commissionAmount' | 'catalogPrice'>>) {
  if (!lines.some((line) => line.commissionAmount != null)) return null;
  return money2(lines.reduce((sum, line) => sum + (saleLineProfit(line) ?? 0), 0));
}

export function productStock(product: CatalogProductForSale) {
  const value = Number(product.available);
  return Number.isFinite(value) ? value : 0;
}

export function formatProductStock(product: CatalogProductForSale) {
  return `${productStock(product)} u`;
}

export function remainingSaleStock(product: CatalogProductForSale, lines: SaleLine[] = []) {
  const used = lines
    .filter((line) => line.productId === product.id)
    .reduce((sum, line) => sum + line.quantity, 0);
  return Math.max(0, productStock(product) - used);
}

export function canSelectProductForSale(product: CatalogProductForSale, lines: SaleLine[] = []) {
  return remainingSaleStock(product, lines) > 0;
}

export function clampSaleQuantity(quantity: number | string, available?: number | null) {
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  if (available == null || !Number.isFinite(Number(available))) return qty;
  const stock = Math.max(0, Math.floor(Number(available)));
  if (stock < 1) return qty;
  return Math.min(qty, stock);
}

const MONEY_DRAFT = /^\d*[.,]?\d{0,2}$/;

export function saleQuantityInputValue(line: Pick<SaleLine, 'quantity' | 'quantityDraft'>) {
  return line.quantityDraft ?? String(line.quantity);
}

export function saleMoneyInputValue(line: Pick<SaleLine, 'unitPrice' | 'unitPriceDraft'>) {
  return line.unitPriceDraft ?? String(line.unitPrice);
}

/** Entero o vacío. Rechaza letras y decimales. El 0 se queda en el input para poder borrarlo. */
export function applySaleQuantityInput(raw: string, available?: number | null): Partial<SaleLine> | null {
  if (raw === '') return { quantityDraft: '' };
  if (!/^\d+$/.test(raw)) return null;
  if (raw === '0' || /^0\d+$/.test(raw)) return { quantityDraft: raw };
  return { quantityDraft: raw, quantity: clampSaleQuantity(raw, available) };
}

export function commitSaleQuantityInput(raw: string, available?: number | null): Pick<SaleLine, 'quantity' | 'quantityDraft'> {
  return { quantity: clampSaleQuantity(raw, available), quantityDraft: undefined };
}

/** Monto con hasta 2 decimales, o vacío. Acepta coma. El 0 se queda para poder borrarlo. */
export function applySaleMoneyInput(raw: string): Partial<SaleLine> | null {
  if (raw === '') return { unitPriceDraft: '' };
  if (!MONEY_DRAFT.test(raw)) return null;
  if (raw === '.' || raw === ',') return { unitPriceDraft: raw };
  const amount = Number(raw.replace(',', '.'));
  if (!Number.isFinite(amount)) return null;
  return { unitPriceDraft: raw, unitPrice: Math.max(0, amount) };
}

export function commitSaleMoneyInput(raw: string): Pick<SaleLine, 'unitPrice' | 'unitPriceDraft'> {
  if (raw === '' || raw === '.' || raw === ',') return { unitPrice: 0, unitPriceDraft: undefined };
  const amount = Number(raw.replace(',', '.'));
  return {
    unitPrice: Number.isFinite(amount) ? Math.max(0, money2(amount)) : 0,
    unitPriceDraft: undefined,
  };
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

function validateCustomerPhone(input: ManualSaleInput) {
  const digits = customerPhoneDigits(input.customerPhone);
  if (digits.length < MIN_CUSTOMER_PHONE_DIGITS) return PHONE_REQUIRED_MESSAGE;
  return null;
}

function validateCustomer(input: ManualSaleInput) {
  return validateCustomerName(input) ?? validateCustomerPhone(input);
}

function validateSaleLines(input: ManualSaleInput) {
  if (!input.lines.length) {
    return 'Agrega al menos un producto.';
  }
  if (input.lines.some((line) => line.available != null && Number(line.available) <= 0)) {
    return NO_STOCK_MESSAGE;
  }
  if (input.lines.some((line) => (
    line.available != null
    && Number.isFinite(Number(line.available))
    && line.quantity > Number(line.available)
  ))) {
    return STOCK_SHORT_MESSAGE;
  }
  if (input.lines.some((line) => line.quantity < 1 || line.unitPrice < 0)) {
    return 'Revisa cantidad y precio de cada producto.';
  }
  return null;
}

function sellerShippingForSale(input: ManualSaleInput) {
  if (input.delivery !== 'envio' || !isSellerPricedShipping(input.shippingCarrier)) return 0;
  return Number(input.sellerShippingAmount) || 0;
}

function validateSellerShipping(input: ManualSaleInput) {
  if (input.delivery !== 'envio' || !isSellerPricedShipping(input.shippingCarrier)) return null;
  const amount = parseSellerShippingAmount(input.sellerShippingAmount);
  if (amount == null || amount < 0) return SELLER_SHIPPING_REQUIRED_MESSAGE;
  return null;
}

function validateDelivery(input: ManualSaleInput, fleetConfig?: Parameters<typeof quoteOwnFleetShipping>[1]) {
  if (!String(input.deliveryDate || '').trim()) {
    return 'Indica la fecha de entrega.';
  }
  if (input.delivery !== 'envio') return null;
  if (!input.shippingCarrier) {
    return 'Elige el reparto: Marvisuar, Shaloom, Dinsides o Express.';
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
  return validateSellerShipping(input);
}

export function validateManualSale(input: ManualSaleInput, fleetConfig?: Parameters<typeof quoteOwnFleetShipping>[1]) {
  if (!input.channelAccountId) {
    return 'Todavía no hay un canal de venta manual habilitado.';
  }
  return validateCustomer(input)
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
  if (step === 'cliente') return validateCustomer(input) ?? validateDocumentRequest(input);
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
  const totals = saleTotals(productsTotal, shippingQuote, sellerShippingForSale(input));
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
      address: input.delivery === 'envio' ? input.dropoffPlace?.label || '' : ownFleetOriginAddress(fleetConfig),
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
      priceZone: shippingQuote?.priceZoneName,
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

export function saleReturnPath(origin: string | null, canManageOrders: boolean) {
  if (origin === 'mis-ventas') return '/mis-ventas';
  if (origin === 'orders' && canManageOrders) return '/orders';
  return canManageOrders ? '/orders' : '/mis-ventas';
}

export function saleProductCommission(lines: SaleLine[]): number | undefined {
  if (!lines.some((line) => line.commissionAmount != null)) return undefined;
  return Math.round(lines.reduce((sum, line) => sum + (line.commissionAmount ?? 0) * line.quantity, 0) * 100) / 100;
}
