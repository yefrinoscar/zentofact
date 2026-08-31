import {
  BOLETA_IDENTITIES,
  PAYMENT_METHODS,
  PICKUP_ADDRESS,
  SALE_SOURCES,
  limaTodayKey,
  type ManualSaleInput,
  type SaleStepId,
} from './registrar-venta.ts';
import { shippingCarrierLabel } from './shipping-carrier.ts';
import { dateFromKey } from './documentDateRange.ts';

export type SaleTotals = {
  products: number;
  districtAmount: number;
  distanceAmount: number;
  shipping: number;
  total: number;
};

export type SummaryRow = { label: string; value: string };
export type SummaryGroup = { step: SaleStepId; title: string; rows: SummaryRow[] };

const EMPTY = '—';

function labelFrom(options: ReadonlyArray<{ value: string; label: string }>, value?: string | null) {
  return options.find((option) => option.value === String(value || ''))?.label || '';
}

export function formatSaleMoney(value: number) {
  try {
    return new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(Number(value || 0));
  } catch {
    return `S/ ${Number(value || 0).toFixed(2)}`;
  }
}

export function formatSaleDate(dateKey: string, nowKey = limaTodayKey()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))) return 'Elegir fecha';
  const sameYear = dateKey.slice(0, 4) === nowKey.slice(0, 4);
  const label = new Intl.DateTimeFormat('es-PE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' as const }),
  }).format(dateFromKey(dateKey));
  return label.replace(/\.$/, '').toLocaleLowerCase('es-PE');
}

export function saleSourceLabel(value?: string | null) {
  return labelFrom(SALE_SOURCES, value) || EMPTY;
}

export function paymentMethodLabel(value?: string | null) {
  return labelFrom(PAYMENT_METHODS, value) || EMPTY;
}

/** Una línea: qué comprobante pidió el cliente y con qué documento se emitirá. */
export function documentSummary(input: ManualSaleInput) {
  const kind = input.documentRequest || 'none';
  const number = String(input.customerDocumentNumber || '').trim();
  if (kind === 'boleta') {
    const identity = labelFrom(BOLETA_IDENTITIES, input.boletaIdentity || 'dni');
    return `Boleta · ${identity} ${number}`.trim();
  }
  if (kind === 'factura') {
    const legalName = String(input.legalName || '').trim();
    return [`Factura · RUC ${number}`.trim(), legalName].filter(Boolean).join(' · ');
  }
  return 'Sin comprobante';
}

export function customerSummaryRows(input: ManualSaleInput): SummaryRow[] {
  return [
    { label: 'Origen', value: saleSourceLabel(input.saleSource) },
    { label: 'Nombre', value: String(input.customerName || '').trim() || EMPTY },
    { label: 'Teléfono', value: String(input.customerPhone || '').trim() || EMPTY },
    { label: 'Comprobante', value: documentSummary(input) },
  ];
}

export function deliverySummaryRows(
  input: ManualSaleInput,
  nowKey = limaTodayKey(),
  pickupAddress = PICKUP_ADDRESS,
): SummaryRow[] {
  const date = { label: 'Fecha', value: formatSaleDate(input.deliveryDate, nowKey) };
  if (input.delivery === 'recojo') {
    return [
      { label: 'Modo', value: 'Recojo en tienda' },
      date,
      { label: 'Tienda', value: pickupAddress },
    ];
  }
  const rows: SummaryRow[] = [
    { label: 'Modo', value: 'Envío' },
    date,
    { label: 'Reparto', value: shippingCarrierLabel(input.shippingCarrier) || EMPTY },
    { label: 'Dirección', value: String(input.dropoffPlace?.label || '').trim() || EMPTY },
  ];
  const note = String(input.shippingNote || '').trim();
  if (note) rows.push({ label: 'Referencia', value: note });
  return rows;
}

export function paymentSummaryRows(input: ManualSaleInput): SummaryRow[] {
  const rows: SummaryRow[] = [{ label: 'Método', value: paymentMethodLabel(input.paymentMethod) }];
  const receivedBy = String(input.receivedBy || '').trim();
  if (input.paymentMethod === 'efectivo' && receivedBy) {
    rows.push({ label: 'Cobró', value: receivedBy });
  }
  if (input.paymentMethod === 'yape_plin' || input.paymentMethod === 'transferencia') {
    rows.push({ label: 'Constancia', value: input.paymentProof?.name || 'Sin adjuntar' });
  }
  return rows;
}

export function saleSummaryGroups(
  input: ManualSaleInput,
  nowKey = limaTodayKey(),
  pickupAddress = PICKUP_ADDRESS,
): SummaryGroup[] {
  return [
    { step: 'cliente', title: 'Cliente', rows: customerSummaryRows(input) },
    { step: 'entrega', title: 'Entrega', rows: deliverySummaryRows(input, nowKey, pickupAddress) },
    { step: 'pago', title: 'Pago', rows: paymentSummaryRows(input) },
  ];
}

export function formatDistanceKm(distanceKm?: number | null) {
  const km = Number(distanceKm);
  return Number.isFinite(km) && km > 0 ? `${km.toFixed(1).replace('.', ',')} km` : '';
}

/** El envío propio se cobra una vez, por zona. Los kilómetros acompañan como referencia. */
export function ownFleetShippingLabel(priceZoneName?: string | null, distanceKm?: number | null) {
  const zone = String(priceZoneName || '').trim();
  const detail = [zone ? `zona ${zone}` : '', formatDistanceKm(distanceKm)].filter(Boolean).join(', ');
  return detail ? `Envío Express · ${detail}` : 'Envío Express';
}

/** Desglose de cobro: una sola línea de envío para no leerse como dos envíos. */
export function saleTotalRows(
  totals: SaleTotals,
  priceZoneName?: string | null,
  distanceKm?: number | null,
): SummaryRow[] {
  const rows: SummaryRow[] = [{ label: 'Productos', value: formatSaleMoney(totals.products) }];
  if (totals.shipping > 0) {
    rows.push({
      label: ownFleetShippingLabel(priceZoneName, distanceKm),
      value: formatSaleMoney(totals.shipping),
    });
  }
  return rows;
}
