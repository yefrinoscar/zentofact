import type { VentaItem } from '@boletas/core';
import type { RawFalabellaOrder } from './types';
import { splitIgv, parseUserDate } from './utils';

export function mapOrders(rawOrders: RawFalabellaOrder[]): VentaItem[] {
  const result: VentaItem[] = [];
  for (const raw of rawOrders) {
    const mapped = mapOrder(raw);
    if (mapped) result.push(mapped);
  }
  return result;
}

export function mapOrder(raw: RawFalabellaOrder): VentaItem | null {
  if (String(raw.invoiceType || '').toUpperCase() === 'FACTURA') return null;
  if (!raw.clientDocNumber || !raw.clientName) return null;

  const fechaEmision = raw.purchaseDate
    ? parseUserDate(raw.purchaseDate)
    : new Date().toISOString().split('T')[0];
  const tipoDocumento = inferDocType(raw.clientDocNumber);
  const total = raw.total || 0;
  const { base } = splitIgv(total, 18);

  const detalles = raw.items.length > 0
    ? buildDetallesFromItems(raw)
    : [{
        codigo: raw.orderNumber,
        descripcion: raw.clientName,
        unidad: 'NIU',
        cantidad: 1,
        mtoValorUnitario: base,
        porcentajeIgv: 18,
        tipAfeIgv: '10',
      }];

  const venta = {
    orderNumber: raw.orderNumber,
    invoiceType: raw.invoiceType || '',
    fechaEmision,
    moneda: 'PEN',
    total,
    client: {
      tipoDocumento,
      numeroDocumento: raw.clientDocNumber,
      razonSocial: raw.clientName,
    },
      detalles,
  };

  return venta as VentaItem;
}

function buildDetallesFromItems(raw: RawFalabellaOrder) {
  const normalized = raw.items.map((item) => ({
    ...item,
    quantity: Math.max(1, Number(item.quantity) || 1),
    unitPrice: Number(item.unitPrice) || 0,
  }));

  const extractedGrossTotal = roundMoney(
    normalized.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
  );
  const shouldRedistribute = Math.abs(extractedGrossTotal - raw.total) >= 0.01;
  const redistributedLineTotals = shouldRedistribute
    ? distributeGrossTotalsByQuantity(raw.total, normalized.map(item => item.quantity))
    : [];

  return normalized.map((item, index) => {
    const grossLineTotal = shouldRedistribute
      ? redistributedLineTotals[index]
      : roundMoney(item.unitPrice * item.quantity);
    const { base: lineBase } = splitIgv(grossLineTotal, 18);

    return {
      codigo: item.sku,
      descripcion: item.name,
      unidad: 'NIU',
      cantidad: item.quantity,
      // Falabella entrega precio con IGV incluido; SUNAT/core requieren valor unitario sin IGV.
      mtoValorUnitario: roundValue(lineBase / item.quantity, 8),
      porcentajeIgv: 18,
      tipAfeIgv: '10',
    };
  });
}

export function inferDocType(docNumber: string): '1' | '4' | '6' | '7' | '0' {
  const n = docNumber.replace(/\D/g, '');
  if (n.length === 8) return '1'; // DNI
  if (n.length === 11) return '6'; // RUC
  if (n.length === 9) return '4'; // CE
  return '0';
}

function roundMoney(value: number): number {
  return roundValue(value, 2);
}

function roundValue(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function distributeGrossTotalsByQuantity(total: number, quantities: number[]): number[] {
  const safeQuantities = quantities.map(quantity => Math.max(1, Math.round(quantity || 1)));
  const totalUnits = safeQuantities.reduce((sum, quantity) => sum + quantity, 0);
  if (totalUnits <= 0) return safeQuantities.map(() => 0);

  const totalCents = Math.round(total * 100);
  const baseUnitCents = Math.floor(totalCents / totalUnits);
  let remainder = totalCents - baseUnitCents * totalUnits;

  return safeQuantities.map((quantity) => {
    const extra = Math.min(remainder, quantity);
    remainder -= extra;
    return (quantity * baseUnitCents + extra) / 100;
  });
}
