import { read as readWorkbook, utils as xlsxUtils } from 'xlsx';

function normalizeHeader(text: string) {
  return String(text || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
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
  return normalized.includes('numero de documento')
    && (
      normalized.includes('descripcion factura')
      || normalized.includes('tipo de documento')
      || normalized.includes('monto con iva')
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
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  const workbook = readWorkbook(bytes, { type: 'array', cellDates: true, raw: false });
  const names = workbook.SheetNames || [];
  if (!names.length) throw new Error('El Excel no tiene hojas.');
  let rows: unknown[][] = [];
  for (const name of names) {
    const sheet = workbook.Sheets[name] as { '!ref'?: string } & Record<string, unknown>;
    expandSheetRange(sheet);
    const next = xlsxUtils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: '',
      blankrows: false,
    }) as unknown[][];
    const header = (next[0] || []).map((cell) => String(cell ?? '')).join(',');
    if (headerLooksLikeInvoiceReport(header) || /settlement invoice/i.test(name)) {
      rows = next;
      break;
    }
    if (!rows.length) rows = next;
  }
  const header = (rows[0] || []).map((cell) => String(cell ?? '')).join(',');
  if (headerLooksLikeSettlementFile(header)) {
    throw new Error('Este es el estado de cuenta. Usa Subir archivo.');
  }
  if (!headerLooksLikeInvoiceReport(header)) {
    throw new Error('No reconocimos el reporte de facturas de Falabella.');
  }
  const csv = xlsxUtils.sheet_to_csv(xlsxUtils.aoa_to_sheet(rows), {
    FS: ',',
    RS: '\n',
    dateNF: 'yyyy-mm-dd',
  });
  if (!String(csv || '').trim()) throw new Error('El Excel está vacío.');
  return csv;
}

export async function readInvoiceReportUpload(file: {
  name?: string;
  type?: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
}) {
  const name = file.name || '';
  const buffer = await file.arrayBuffer();
  const isSpreadsheet = /\.(xlsx|xls|xlsm)$/i.test(name)
    || String(file.type || '').includes('spreadsheetml')
    || (String(file.type || '').includes('excel') && !String(file.type || '').includes('csv'));
  if (isSpreadsheet) return decodeInvoiceSpreadsheet(buffer);
  const csv = new TextDecoder('utf-8').decode(buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer);
  if (headerLooksLikeSettlementFile(csv)) {
    throw new Error('Este es el estado de cuenta. Usa Subir archivo.');
  }
  if (!headerLooksLikeInvoiceReport(csv) && !isInvoiceReportFilename(name)) {
    throw new Error('No reconocimos el reporte de facturas de Falabella.');
  }
  return csv;
}
