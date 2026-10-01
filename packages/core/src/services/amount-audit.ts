import { readDatoAdicional, withDatoAdicional } from '../utils/datos-adicionales';

// Antes de enviar a SUNAT, el total debe ser el mismo en toda la cadena:
//   monto del origen (pedido Falabella) = venta construida = comprobante = XML.
// Si algo no cuadra, el comprobante no se envía.

const EXPECTED_KEY = 'monto_esperado';
const TOLERANCE = 0.005;

export interface ExpectedAmount {
  total: number;
  source: string;
}

export function withExpectedAmount(datosAdicionales: unknown, expected: ExpectedAmount | null | undefined): unknown {
  if (!expected || !Number.isFinite(Number(expected.total))) return datosAdicionales ?? null;
  return withDatoAdicional(datosAdicionales, EXPECTED_KEY, { total: Number(expected.total), source: expected.source });
}

export function readExpectedAmount(datosAdicionales: unknown): ExpectedAmount | null {
  const value = readDatoAdicional(datosAdicionales, EXPECTED_KEY);
  const total = Number(value?.total);
  return value && Number.isFinite(total) ? { total, source: String(value.source || 'origen') } : null;
}

/** Lee el importe total (PayableAmount) del XML UBL firmado. */
export function readPayableAmount(xml: string): number | null {
  const match = xml.match(/<cac:LegalMonetaryTotal\b[^>]*>[\s\S]*?<cbc:PayableAmount\b[^>]*>([^<]+)<\/cbc:PayableAmount>/)
    || xml.match(/<cac:RequestedMonetaryTotal\b[^>]*>[\s\S]*?<cbc:PayableAmount\b[^>]*>([^<]+)<\/cbc:PayableAmount>/);
  const value = Number(match?.[1]);
  return match && Number.isFinite(value) ? value : null;
}

export interface AmountAudit {
  ok: boolean;
  mismatches: string[];
}

const money = (value: number) => value.toFixed(2);
const differs = (a: number, b: number) => Math.abs(a - b) > TOLERANCE;

export function auditDocumentAmounts(input: {
  expected?: ExpectedAmount | null;
  stored: number;
  xml: number | null;
}): AmountAudit {
  const mismatches: string[] = [];
  const stored = Number(input.stored);
  if (!Number.isFinite(stored) || stored <= 0) mismatches.push(`el comprobante tiene un total inválido (${input.stored})`);
  if (input.xml === null) mismatches.push('el XML no tiene PayableAmount');
  else if (Number.isFinite(stored) && differs(input.xml, stored)) {
    mismatches.push(`XML ${money(input.xml)} ≠ comprobante ${money(stored)}`);
  }
  if (input.expected && Number.isFinite(stored) && differs(input.expected.total, stored)) {
    mismatches.push(`${input.expected.source} ${money(input.expected.total)} ≠ comprobante ${money(stored)}`);
  }
  return { ok: mismatches.length === 0, mismatches };
}

/** La venta construida debe sumar exactamente el total del origen antes de crear el comprobante. */
export function auditSaleAgainstSource(input: {
  sourceTotal: number;
  sourceLabel: string;
  lines: Array<{ mtoBruto?: number | null; cantidad: number; mtoValorUnitario: number; porcentajeIgv?: number | null }>;
}): AmountAudit {
  const linesTotal = input.lines.reduce((sum, line) => {
    const gross = Number(line.mtoBruto);
    if (Number.isFinite(gross) && gross > 0) return sum + gross;
    const base = Number(line.cantidad) * Number(line.mtoValorUnitario);
    return sum + base * (1 + Number(line.porcentajeIgv || 0) / 100);
  }, 0);
  const rounded = Math.round(linesTotal * 100) / 100;
  const source = Number(input.sourceTotal);
  if (!Number.isFinite(source) || source <= 0) {
    return { ok: false, mismatches: [`${input.sourceLabel} no informa un total válido (${input.sourceTotal})`] };
  }
  if (differs(rounded, source)) {
    return { ok: false, mismatches: [`venta construida ${money(rounded)} ≠ ${input.sourceLabel} ${money(source)}`] };
  }
  return { ok: true, mismatches: [] };
}
