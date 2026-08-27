function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function stripBom(text) {
  return String(text || '').replace(/^\uFEFF/, '');
}

export function normalizeHeader(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function parseMoney(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '-' || raw === '—') return null;
  const cleaned = raw
    .replace(/\s/g, '')
    .replace(/[sS\/$€£]|pen|PEN/gi, '')
    .replace(/[()]/g, '');
  const negative = /^\(.*\)$/.test(raw) || cleaned.startsWith('-');
  const digits = cleaned.replace(/^[+-]/, '');
  if (!digits) return null;
  let normalized = digits;
  if (digits.includes('.') && digits.includes(',')) {
    normalized = digits.lastIndexOf(',') > digits.lastIndexOf('.')
      ? digits.replace(/\./g, '').replace(',', '.')
      : digits.replace(/,/g, '');
  } else if (digits.includes(',')) {
    const [, fraction = ''] = digits.split(',');
    normalized = fraction.length === 3 && !digits.includes('.')
      ? digits.replace(/,/g, '')
      : digits.replace(',', '.');
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  const amount = Math.round((negative ? -Math.abs(parsed) : parsed) * 100) / 100;
  return amount;
}

export function parseDateKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const datePart = raw.split(/[ T]/)[0];
  const iso = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const latin = datePart.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (latin) {
    const day = latin[1].padStart(2, '0');
    const month = latin[2].padStart(2, '0');
    return `${latin[3]}-${month}-${day}`;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

export function detectDelimiter(headerLine) {
  const counts = {
    ',': (headerLine.match(/,/g) || []).length,
    ';': (headerLine.match(/;/g) || []).length,
    '\t': (headerLine.match(/\t/g) || []).length,
  };
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
    : ',';
}

export function parseCsvRows(text) {
  const source = stripBom(text);
  if (!source.trim()) throw httpError('El CSV está vacío.');
  const delimiter = detectDelimiter(source.split(/\r?\n/).find((line) => line.trim()) || '');
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && char === delimiter) {
      row.push(field);
      field = '';
      continue;
    }
    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(field);
      field = '';
      if (row.some((value) => String(value).trim())) rows.push(row);
      row = [];
      continue;
    }
    field += char;
  }
  row.push(field);
  if (row.some((value) => String(value).trim())) rows.push(row);
  return rows;
}

const HEADER_ROLES = {
  orderId: [
    'n de pedido',
    'n pedido',
    'numero de pedido',
    'numero pedido',
    'id pedido',
    'id de pedido',
    'id de orden',
    'id orden',
    'order number',
    'order no',
    'order nr',
    'ordernr',
    'orderno',
    'order id',
    'orderid',
  ],
  sku: [
    'sku',
    'sku del vendedor',
    'sku vendedor',
    'seller sku',
    'sellersku',
    'sku seller',
  ],
  date: [
    'fecha de transaccion',
    'fecha transaccion',
    'fecha de creacion',
    'fecha de creacion del pedido',
    'fecha de liquidacion',
    'transaction date',
    'order date',
    'fecha',
  ],
  amount: [
    'monto',
    'amount',
    'paid price',
    'precio pagado',
  ],
  bruto: [
    'monto pedido',
    'precio de venta',
    'item price',
    'bruto',
    'gross',
  ],
  commission: [
    'monto comision',
    'comision',
    'comision de falabella',
    'commission',
  ],
  other: [
    'otros cobros',
    'otras tarifas',
    'other fees',
    'monto flete',
    'monto de flete',
    'tarifa de envio',
    'shipping fee',
  ],
  neto: [
    'monto total a depositar',
    'total a pagar',
    'total a depositar',
    'payout',
  ],
  type: [
    'tipo de transaccion',
    'transaction type',
    'tipo liquidacion',
    'tipo de liquidacion',
    'fee name',
    'nombre de la tarifa',
  ],
};

function pickHeader(headers, role, used) {
  const wanted = HEADER_ROLES[role];
  for (const header of headers) {
    if (used.has(header.original)) continue;
    if (wanted.includes(header.normalized)) {
      used.add(header.original);
      return header.original;
    }
  }
  return null;
}

export function bindCsvHeaders(headerRow) {
  const headers = headerRow.map((original, index) => ({
    original: String(original || '').trim(),
    normalized: normalizeHeader(original),
    index,
  })).filter((header) => header.original);
  if (!headers.length) throw httpError('El CSV no tiene cabecera.');
  const used = new Set();
  const columns = {
    orderId: pickHeader(headers, 'orderId', used),
    sku: pickHeader(headers, 'sku', used),
    date: pickHeader(headers, 'date', used),
    type: pickHeader(headers, 'type', used),
    bruto: pickHeader(headers, 'bruto', used),
    commission: pickHeader(headers, 'commission', used),
    other: pickHeader(headers, 'other', used),
    neto: pickHeader(headers, 'neto', used),
    amount: pickHeader(headers, 'amount', used),
  };
  if (!columns.orderId && !(columns.sku && (columns.amount || columns.bruto || columns.neto))) {
    throw httpError(
      `No reconocimos columnas para cruzar ventas. Cabeceras: ${headers.map((header) => header.original).join(', ')}.`,
    );
  }
  const shape = columns.bruto || columns.commission || columns.neto
    ? 'settlement_columns'
    : 'transaction_rows';
  return {
    shape,
    columns,
    headers: headers.map((header) => header.original),
  };
}

export function classifyTransactionType(value) {
  const normalized = normalizeHeader(value);
  if (!normalized) return 'unknown';
  if (/(comision|commission|fee name commission)/.test(normalized) && !/(venta|sale|sales)/.test(normalized)) {
    return 'commission';
  }
  if (/(venta|sale|sales|item price|paid price|pago recibido)/.test(normalized)) return 'sale';
  if (/(devol|refund|reembolso|return)/.test(normalized)) return 'refund';
  return 'other';
}

function cell(row, headerIndex, headerName) {
  if (headerName == null) return '';
  return String(row[headerIndex.get(headerName)] ?? '').trim();
}

export function parseSettlementCsv(text) {
  const rows = parseCsvRows(text);
  if (rows.length < 2) throw httpError('El CSV no tiene líneas de detalle.');
  const binding = bindCsvHeaders(rows[0]);
  const headerIndex = new Map(binding.headers.map((header, index) => [header, index]));
  const lines = [];
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    const raw = {};
    for (const header of binding.headers) raw[header] = cell(row, headerIndex, header);
    if (!Object.values(raw).some(Boolean)) continue;
    const typeValue = cell(row, headerIndex, binding.columns.type);
    const kind = classifyTransactionType(typeValue);
    const signedAmount = parseMoney(cell(row, headerIndex, binding.columns.amount));
    const bruto = binding.columns.bruto
      ? parseMoney(cell(row, headerIndex, binding.columns.bruto))
      : kind === 'sale' ? Math.abs(signedAmount || 0) : 0;
    const commission = binding.columns.commission
      ? Math.abs(parseMoney(cell(row, headerIndex, binding.columns.commission)) || 0)
      : kind === 'commission' ? Math.abs(signedAmount || 0) : 0;
    const other = binding.columns.other
      ? Math.abs(parseMoney(cell(row, headerIndex, binding.columns.other)) || 0)
      : kind === 'other' || kind === 'refund' ? Math.abs(signedAmount || 0) : 0;
    const neto = binding.columns.neto
      ? parseMoney(cell(row, headerIndex, binding.columns.neto))
      : signedAmount != null
        ? signedAmount
        : Math.round(((bruto || 0) - commission - other) * 100) / 100;
    lines.push({
      rowNumber: index + 1,
      raw,
      orderId: cell(row, headerIndex, binding.columns.orderId),
      sku: cell(row, headerIndex, binding.columns.sku),
      date: parseDateKey(cell(row, headerIndex, binding.columns.date)),
      type: typeValue,
      kind,
      bruto: bruto || 0,
      commission,
      other,
      neto: neto || 0,
      amount: signedAmount,
    });
  }
  if (!lines.length) throw httpError('El CSV no tiene líneas con datos.');
  return { binding, lines };
}

export function lineFingerprint(line) {
  return [
    String(line.orderId || '').trim().toLowerCase(),
    String(line.sku || '').trim().toLowerCase(),
    line.date || '',
    String(line.kind || ''),
    String(line.type || '').trim().toLowerCase(),
    Number(line.bruto || 0).toFixed(2),
    Number(line.commission || 0).toFixed(2),
    Number(line.other || 0).toFixed(2),
    Number(line.neto || 0).toFixed(2),
    Number(line.amount || 0).toFixed(2),
  ].join('|');
}
