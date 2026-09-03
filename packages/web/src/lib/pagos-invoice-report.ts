import { read as readWorkbook, utils as xlsxUtils } from 'xlsx';
import { repairSpreadsheetZip } from './xlsx-zip.ts';

function normalizeHeader(text: string) {
  return String(text || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function csvEscape(value: string) {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function cellText(cell: { w?: string; v?: unknown } | undefined) {
  if (cell == null) return '';
  const value = cell.v;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const iso = value.toISOString();
    return iso.includes('T00:00:00') ? iso.slice(0, 10) : iso.replace('T', ' ').replace(/\.\d+Z$/, '');
  }
  if (cell.w != null && String(cell.w) !== '') return String(cell.w);
  return String(value ?? '');
}

function sheetToRows(sheet: { '!ref'?: string } & Record<string, unknown>) {
  expandSheetRange(sheet);
  const ref = sheet['!ref'];
  if (!ref) return [] as string[][];
  const range = xlsxUtils.decode_range(ref);
  const rows: string[][] = [];
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    const cells: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const addr = xlsxUtils.encode_cell({ r, c });
      cells.push(cellText(sheet[addr] as { w?: string; v?: unknown } | undefined));
    }
    rows.push(cells);
  }
  return rows;
}

function rowsToCsv(rows: string[][]) {
  return rows.map((row) => row.map((value) => csvEscape(String(value ?? ''))).join(',')).join('\n');
}

function rowLooksLikeInvoiceHeader(row: unknown[] | undefined) {
  return headerLooksLikeInvoiceReport((row || []).map((cell) => String(cell ?? '')).join(','));
}

function expandSheetRange(sheet: { '!ref'?: string } & Record<string, unknown>) {
  const keys = Object.keys(sheet).filter((key) => /^[A-Z]+[0-9]+$/.test(key));
  if (!keys.length) return;
  const range = sheet['!ref']
    ? xlsxUtils.decode_range(sheet['!ref'])
    : { s: { r: Number.POSITIVE_INFINITY, c: Number.POSITIVE_INFINITY }, e: { r: 0, c: 0 } };
  for (const key of keys) {
    const cell = xlsxUtils.decode_cell(key);
    if (cell.r < range.s.r) range.s.r = cell.r;
    if (cell.c < range.s.c) range.s.c = cell.c;
    if (cell.r > range.e.r) range.e.r = cell.r;
    if (cell.c > range.e.c) range.e.c = cell.c;
  }
  if (!Number.isFinite(range.s.r) || !Number.isFinite(range.s.c)) return;
  sheet['!ref'] = xlsxUtils.encode_range(range);
}

export function isInvoiceReportFilename(name: string | null | undefined) {
  return /^invoicereport[_-]/i.test(String(name || '').trim());
}

export function headerLooksLikeInvoiceReport(text: string) {
  const normalized = normalizeHeader(text);
  const hasDocument = normalized.includes('numero de documento')
    || normalized.includes('n de documento')
    || normalized.includes('document number');
  return hasDocument
    && (
      normalized.includes('descripcion factura')
      || normalized.includes('tipo de documento')
      || normalized.includes('document type')
      || normalized.includes('monto con iva')
      || normalized.includes('amount with vat')
    );
}

export function headerLooksLikeSettlementFile(text: string) {
  const normalized = normalizeHeader(text);
  return normalized.includes('estado de pago')
    && !normalized.includes('numero de documento');
}

export function invoiceKindLabel(kind: string | null | undefined) {
  if (kind === 'nota_credito') return 'Nota de crédito';
  return 'Factura';
}

export function invoiceConceptLabel(concept: string | null | undefined) {
  if (concept === 'commission') return 'Comisiones';
  if (concept === 'logistics') return 'Logística';
  if (concept === 'buyer_shipping') return 'Envío del comprador';
  if (concept === 'ads') return 'Publicidad';
  return 'Otros cobros';
}

export function invoiceNumberLabel(document: {
  kind?: string | null;
  number?: string | null;
} | null | undefined) {
  const number = String(document?.number || '').trim();
  if (!number) return document?.kind === 'nota_credito' ? 'Nota de crédito' : 'Factura';
  if (document?.kind === 'nota_credito') return `NC ${number}`;
  return `Factura ${number}`;
}

export function invoiceImportSummary(item: {
  reused?: boolean;
  replaced?: boolean;
  documentCount?: number | null;
  lineCount?: number | null;
  documents?: Array<{ kind?: string | null; number?: string | null }> | null;
} | null | undefined) {
  if (item?.reused) return 'Esta factura ya está cargada.';
  const names = (item?.documents || [])
    .slice()
    .sort((left, right) => Number(left?.kind !== 'factura') - Number(right?.kind !== 'factura'))
    .map((document) => invoiceNumberLabel(document))
    .filter(Boolean);
  const lines = Number(item?.lineCount || 0);
  const lineNote = lines === 1 ? '1 línea' : `${lines} líneas`;
  if (names.length) return `${names.join(' · ')} · ${lineNote}`;
  const count = Number(item?.documentCount || 0);
  if (!count) return lineNote;
  return `${count === 1 ? '1 documento' : `${count} documentos`} · ${lineNote}`;
}

export function invoicePeriodLabel(from?: string | null, to?: string | null) {
  const start = String(from || '').slice(0, 10);
  const end = String(to || '').slice(0, 10);
  const fmt = (day: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
    return new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short' }).format(new Date(`${day}T12:00:00`));
  };
  const left = fmt(start);
  const right = fmt(end);
  if (left && right && start !== end) return `${left} – ${right}`;
  return left || right || '';
}

export function invoiceLongDate(day?: string | null) {
  const value = String(day || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  return new Intl.DateTimeFormat('es-PE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00`));
}

/** InvoiceReport signs charges as negative. The paper view shows what Falabella bills. */
export function invoiceChargeAmount(kind: string | null | undefined, signed: number | null | undefined) {
  const value = Math.round((Number(signed) || 0) * 100) / 100;
  const amount = Math.abs(value);
  if (kind === 'nota_credito') return { amount, credit: value >= 0 };
  return { amount, credit: value > 0 };
}

const INVOICE_IGV_RATE = 0.18;

function money2(value: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const sign = n < 0 ? -1 : 1;
  return sign * Math.round(Number(`${Math.abs(n)}e2`)) / 100;
}

/** Same paper as SUNAT: IGV 18% of the item net, then net + IGV. */
export function invoiceConceptAmounts(
  kind: string | null | undefined,
  row: { net?: number | null; count?: number | null } | null | undefined,
) {
  const net = invoiceChargeAmount(kind, row?.net).amount;
  const igv = money2(net * INVOICE_IGV_RATE);
  return { net, igv, gross: money2(net + igv), count: Math.max(0, Number(row?.count || 0)) };
}

export function invoiceDocumentAmounts(
  kind: string | null | undefined,
  concepts: Array<{ net?: number | null }> | null | undefined,
) {
  return (concepts || []).reduce<{ net: number; igv: number; gross: number }>(
    (totals, row) => {
      const next = invoiceConceptAmounts(kind, row);
      return {
        net: money2(totals.net + next.net),
        igv: money2(totals.igv + next.igv),
        gross: money2(totals.gross + next.gross),
      };
    },
    { net: 0, igv: 0, gross: 0 },
  );
}

export function invoiceLinesForItem<T extends { concept?: string | null }>(
  lines: T[] | null | undefined,
  concept?: string | null,
) {
  const key = String(concept || '').trim();
  if (!key) return lines || [];
  return (lines || []).filter((line) => String(line.concept || '') === key);
}

export function invoiceElectronicTitle(kind: string | null | undefined) {
  if (kind === 'nota_credito') return 'NOTA DE CRÉDITO ELECTRÓNICA';
  return 'FACTURA ELECTRÓNICA';
}

const UNIDADES = ['', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'];
const DECENAS = ['', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const ESPECIALES = ['diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve'];
const CENTENAS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

function groupToWords(n: number) {
  if (n === 100) return 'cien';
  if (n === 0) return '';
  let text = '';
  const hundreds = Math.floor(n / 100);
  const tens = Math.floor((n % 100) / 10);
  const ones = n % 10;
  if (hundreds > 0) text += `${CENTENAS[hundreds]} `;
  if (tens === 1) return `${text}${ESPECIALES[ones]}`.trim();
  if (tens > 1) text += `${DECENAS[tens]}${ones > 0 ? ' y ' : ' '}`;
  if (ones > 0) text += UNIDADES[ones];
  return text.trim();
}

export function invoiceAmountInWords(amount: number | null | undefined) {
  const value = Math.abs(Math.round((Number(amount) || 0) * 100) / 100);
  const whole = Math.floor(value);
  const cents = Math.round((value - whole) * 100);
  if (whole === 0) {
    return `SON: CERO CON ${String(cents).padStart(2, '0')}/100 SOLES`;
  }
  const parts: string[] = [];
  let rest = whole;
  let index = 0;
  while (rest > 0) {
    const group = rest % 1000;
    if (group > 0) {
      let text = groupToWords(group);
      if (index === 1) text += ' mil';
      if (index === 2) text += group === 1 ? ' millón' : ' millones';
      parts.unshift(text);
    }
    rest = Math.floor(rest / 1000);
    index += 1;
  }
  return `SON: ${parts.join(' ').toUpperCase()} CON ${String(cents).padStart(2, '0')}/100 SOLES`;
}

export function decodeInvoiceSpreadsheet(buffer: ArrayBuffer | Uint8Array) {
  const bytes = repairSpreadsheetZip(buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer);
  const workbook = readWorkbook(bytes, { type: 'array', cellDates: true, raw: false });
  const names = workbook.SheetNames || [];
  if (!names.length) throw new Error('El Excel no tiene hojas.');
  let rows: string[][] = [];
  for (const name of names) {
    const next = sheetToRows(workbook.Sheets[name] as { '!ref'?: string } & Record<string, unknown>);
    const headerIndex = next.findIndex((row) => rowLooksLikeInvoiceHeader(row));
    if (headerIndex >= 0 || /settlement invoice/i.test(name)) {
      rows = headerIndex >= 0 ? next.slice(headerIndex) : next;
      break;
    }
    if (!rows.length) rows = next;
  }
  const headerIndex = rows.findIndex((row) => rowLooksLikeInvoiceHeader(row));
  const headerRow = headerIndex >= 0 ? rows[headerIndex] : rows[0];
  const header = (headerRow || []).map((cell) => String(cell ?? '')).join(',');
  if (headerLooksLikeSettlementFile(header)) {
    throw new Error('Este es el estado de cuenta. Usa Subir archivo.');
  }
  if (!headerLooksLikeInvoiceReport(header)) {
    throw new Error('No reconocimos el reporte de facturas de Falabella.');
  }
  const table = headerIndex >= 0 ? rows.slice(headerIndex) : rows;
  const csv = rowsToCsv(table);
  if (!String(csv || '').trim()) throw new Error('El Excel está vacío.');
  const documentIndex = (headerRow || []).findIndex((cell) => {
    const name = normalizeHeader(cell);
    return name.includes('numero de documento')
      || name === 'n de documento'
      || name === 'document number';
  });
  const dataRows = table.slice(1).filter((row) => String(row[documentIndex < 0 ? 0 : documentIndex] || '').trim());
  if (!dataRows.length) throw new Error('El reporte de facturas no trae líneas.');
  return csv;
}

export function bytesToBase64(buffer: ArrayBuffer | Uint8Array) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export async function readInvoiceReportUpload(file: {
  name?: string;
  type?: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
}) {
  const payload = await readInvoiceReportPayload(file);
  return payload.csv;
}

export async function readInvoiceReportPayload(file: {
  name?: string;
  type?: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
}) {
  const name = file.name || '';
  const buffer = await file.arrayBuffer();
  const isSpreadsheet = /\.(xlsx|xls|xlsm)$/i.test(name)
    || String(file.type || '').includes('spreadsheetml')
    || (String(file.type || '').includes('excel') && !String(file.type || '').includes('csv'));
  if (isSpreadsheet) {
    return {
      filename: name,
      csv: decodeInvoiceSpreadsheet(buffer),
      xlsxBase64: bytesToBase64(buffer),
    };
  }
  const csv = new TextDecoder('utf-8').decode(buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer);
  if (headerLooksLikeSettlementFile(csv)) {
    throw new Error('Este es el estado de cuenta. Usa Subir archivo.');
  }
  if (!headerLooksLikeInvoiceReport(csv) && !isInvoiceReportFilename(name)) {
    throw new Error('No reconocimos el reporte de facturas de Falabella.');
  }
  return { filename: name, csv, xlsxBase64: '' };
}
