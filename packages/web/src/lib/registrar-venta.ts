import {
  OWN_DELIVERY_CARRIER,
  ownDeliveryQuote,
  type DeliveryLocation,
} from './own-delivery.ts';
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

export const PICKUP_ADDRESS = 'Av. La Marina 2055, San Miguel';

export type SaleSource = (typeof SALE_SOURCES)[number]['value'];
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]['value'];
export type DeliveryMethod = 'recojo' | 'envio';
export type { ShippingCarrier } from './shipping-carrier.ts';

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
  deliveryLocation: DeliveryLocation;
  ownDeliveryDistanceKm: number | null;
  shippingNote?: string;
  saleSource: SaleSource;
  paymentMethod: PaymentMethod;
  receivedBy?: string;
  paymentProof?: { name: string; type: string; dataUrl: string } | null;
  orderedAt?: string;
  orderNumber?: string;
};

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

export function manualSaleShippingAmount(input: Pick<ManualSaleInput, 'delivery' | 'shippingCarrier' | 'ownDeliveryDistanceKm'>) {
  if (input.delivery !== 'envio' || input.shippingCarrier !== OWN_DELIVERY_CARRIER) return 0;
  return ownDeliveryQuote(input.ownDeliveryDistanceKm)?.amount || 0;
}

export function validateManualSale(input: ManualSaleInput) {
  if (!input.channelAccountId) {
    return 'Todavía no hay un canal de venta manual habilitado.';
  }
  if (!String(input.customerName || '').trim()) {
    return 'Escribe el nombre del cliente.';
  }
  if (!input.lines.length) {
    return 'Agrega al menos un producto.';
  }
  if (input.lines.some((line) => line.quantity < 1 || line.unitPrice < 0)) {
    return 'Revisa cantidad y precio de cada producto.';
  }
  if (!String(input.deliveryDate || '').trim()) {
    return 'Indica la fecha de entrega.';
  }
  if (input.delivery === 'envio' && !input.shippingCarrier) {
    return 'Elige el reparto.';
  }
  if (input.delivery === 'envio' && !input.dropoffPlace) {
    return 'Marca la dirección de envío en el mapa.';
  }
  if (input.delivery === 'envio' && !String(input.deliveryLocation?.district || '').trim()) {
    return 'Elige el distrito de entrega.';
  }
  if (input.delivery === 'envio' && input.shippingCarrier === OWN_DELIVERY_CARRIER) {
    const distanceKm = Number(input.ownDeliveryDistanceKm);
    if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
      return 'Indica la distancia estimada.';
    }
    if (!ownDeliveryQuote(distanceKm)) {
      return 'Movilidad propia cubre hasta 25 km.';
    }
  }
  return null;
}

export function buildManualSaleOrderPayload(input: ManualSaleInput) {
  const error = validateManualSale(input);
  if (error) throw new Error(error);

  const paidNow = input.paymentMethod !== 'despues';
  const orderNumber = input.orderNumber || generateManualOrderNumber(
    input.orderedAt ? new Date(input.orderedAt) : new Date(),
  );
  const subtotal = saleLinesTotal(input.lines);
  const ownDelivery = input.delivery === 'envio' && input.shippingCarrier === OWN_DELIVERY_CARRIER
    ? ownDeliveryQuote(input.ownDeliveryDistanceKm)
    : null;
  const shippingAmount = manualSaleShippingAmount(input);
  const total = subtotal + shippingAmount;
  const deliveryDate = String(input.deliveryDate).trim();

  return {
    channelAccountId: input.channelAccountId,
    externalOrderId: orderNumber,
    externalOrderNumber: orderNumber,
    orderStatus: 'confirmed' as const,
    paymentStatus: paidNow ? 'paid' as const : 'pending' as const,
    fulfillmentStatus: 'ready_to_ship' as const,
    requestedDocumentType: 'boleta' as const,
    currency: 'PEN',
    subtotal,
    shippingAmount,
    total,
    customer: {
      name: String(input.customerName).trim(),
      phone: String(input.customerPhone || '').trim(),
    },
    shipping: {
      type: input.delivery,
      carrier: input.delivery === 'envio' ? input.shippingCarrier : undefined,
      address: input.delivery === 'envio' ? input.dropoffPlace?.label || '' : PICKUP_ADDRESS,
      department: input.delivery === 'envio' ? input.deliveryLocation.department : '',
      province: input.delivery === 'envio' ? input.deliveryLocation.province : '',
      district: input.delivery === 'envio' ? input.deliveryLocation.district : '',
      ubigeo: input.delivery === 'envio' ? input.deliveryLocation.ubigeo : '',
      reference: input.delivery === 'envio' ? String(input.shippingNote || '').trim() : '',
      lat: input.delivery === 'envio' ? input.dropoffPlace?.lat : undefined,
      lng: input.delivery === 'envio' ? input.dropoffPlace?.lng : undefined,
      distanceKm: ownDelivery?.distanceKm,
      rateTierKm: ownDelivery?.maxDistanceKm,
    },
    metadata: {
      origin: 'manual_ui',
      saleSource: input.saleSource,
      delivery: input.delivery,
      deliveryDate,
      shippingCarrier: input.delivery === 'envio' ? input.shippingCarrier : '',
      ...(ownDelivery ? {
        ownDelivery: {
          distanceKm: ownDelivery.distanceKm,
          rateTierKm: ownDelivery.maxDistanceKm,
          shippingAmount,
        },
      } : {}),
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
