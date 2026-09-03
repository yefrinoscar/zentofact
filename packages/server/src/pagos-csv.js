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

export function repairSettlementText(value) {
  return String(value || '')
    .replace(/√≠/g, 'í')
    .replace(/√≥/g, 'ó')
    .replace(/√°/g, 'á')
    .replace(/√©/g, 'é')
    .replace(/√∫/g, 'ú')
    .replace(/√±/g, 'ñ')
    .replace(/Ã­/g, 'í')
    .replace(/Ã³/g, 'ó')
    .replace(/Ã¡/g, 'á')
    .replace(/Ã©/g, 'é')
    .replace(/Ãº/g, 'ú')
    .replace(/Ã±/g, 'ñ');
}

export function parseMoneyPrecise(value) {
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
  return negative ? -Math.abs(parsed) : parsed;
}

export function roundCents(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const sign = n < 0 ? -1 : 1;
  return sign * Math.round(Number(`${Math.abs(n)}e2`)) / 100;
}

export function parseMoney(value) {
  const parsed = parseMoneyPrecise(value);
  if (parsed == null) return null;
  return roundCents(parsed);
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

const HEADER_MATCHERS = {
  orderId: (n) => n.includes('del orden')
    || n.includes('n de orden')
    || n.includes('numero de orden')
    || n.includes('nro de orden')
    || n.includes('num de orden')
    || n.includes('de pedido')
    || n.includes('order number')
    || n === 'order id'
    || n === 'orderid'
    || n === 'id pedido'
    || n === 'id de pedido'
    || n === 'id orden'
    || n === 'id de orden',
  sku: (n) => n === 'sku'
    || n === 'sku vendedor'
    || n === 'sku del vendedor'
    || n === 'seller sku'
    || n === 'sellersku',
  shopSku: (n) => n === 'sku falabella' || n === 'shop sku' || n === 'shopsku',
  itemId: (n) => n === 'falabella id' || n === 'falabella-id',
  articleId: (n) => n.includes('id art'),
  orderDate: (n) => n.includes('fecha creaci') && n.includes('orden'),
  date: (n) => n.includes('fecha de transacci')
    || n === 'fecha transaccion'
    || n.includes('fecha de liquidacion')
    || n === 'transaction date',
  amount: (n) => n === 'monto con iva' || n === 'monto' || n === 'amount',
  bruto: (n) => n === 'monto pedido' || n === 'precio de venta' || n === 'item price' || n === 'bruto' || n === 'gross',
  commission: (n) => n === 'monto comision' || n === 'comision de falabella',
  other: (n) => n === 'otros cobros' || n === 'otras tarifas' || n === 'other fees'
    || n === 'monto flete' || n === 'monto de flete' || n === 'tarifa de envio' || n === 'shipping fee',
  neto: (n) => n === 'monto total a depositar' || n === 'total a pagar' || n === 'total a depositar' || n === 'payout',
  type: (n) => n.includes('tipo de transacci') || n === 'transaction type' || n === 'fee name' || n === 'nombre de la tarifa',
  category: (n) => n.includes('categor') && n.includes('transacc'),
  paymentStatus: (n) => n === 'estado de pago' || n === 'payment status',
  statementId: (n) => n.includes('estado de cuenta'),
  productName: (n) => n.includes('nombre del producto') || n === 'product name',
  commissionRate: (n) => n === 'comision' || n === 'comisi n' || n === '% comision',
};

function pickHeader(headers, role, used) {
  const match = HEADER_MATCHERS[role];
  for (const header of headers) {
    if (used.has(header.original)) continue;
    if (match(header.normalized)) {
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
    shopSku: pickHeader(headers, 'shopSku', used),
    itemId: pickHeader(headers, 'itemId', used),
    articleId: pickHeader(headers, 'articleId', used),
    orderDate: pickHeader(headers, 'orderDate', used),
    date: pickHeader(headers, 'date', used),
    type: pickHeader(headers, 'type', used),
    category: pickHeader(headers, 'category', used),
    paymentStatus: pickHeader(headers, 'paymentStatus', used),
    statementId: pickHeader(headers, 'statementId', used),
    productName: pickHeader(headers, 'productName', used),
    commissionRate: pickHeader(headers, 'commissionRate', used),
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
  const kind = classifyChargeKind(value);
  if (kind === 'sale' || kind === 'commission' || kind === 'refund' || kind === 'unknown') return kind;
  return 'other';
}

export function classifyChargeKind(value) {
  const normalized = normalizeHeader(repairSettlementText(value));
  if (!normalized) return 'unknown';
  if (normalized.includes('precio del producto') || normalized.includes('pago por precio')) return 'sale';
  if (normalized === 'sales' || normalized === 'sale' || normalized === 'venta') return 'sale';
  if (normalized.includes('comisi') || normalized.includes('commission')) return 'commission';
  if (normalized.includes('cofinanciamiento') || (normalized.includes('cobro') && normalized.includes('logistic'))) {
    return 'shipping';
  }
  if (
    normalized.includes('envio comprador')
    || normalized.includes('buyer shipping')
    || (normalized.includes('comprador') && (normalized.includes('envio') || /\benv\b/.test(normalized)))
  ) {
    return 'buyer_shipping';
  }
  if (/(devol|refund|reembolso|return)/.test(normalized) && !normalized.includes('reversa de pago de env')) {
    return 'refund';
  }
  return 'other';
}

export function parseRate(value) {
  const raw = String(value ?? '').replace('%', '').replace(',', '.').trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed > 1 ? parsed / 100 : parsed;
}

export function rawValueByHeader(raw, match) {
  for (const [key, value] of Object.entries(raw || {})) {
    if (match(normalizeHeader(key))) return String(value ?? '').trim();
  }
  return '';
}

export function parsePaymentStatus(value) {
  const normalized = normalizeHeader(value);
  if (!normalized) return null;
  if (normalized.includes('no pagado') || normalized === 'unpaid' || normalized === 'not paid') return false;
  if (normalized.includes('programado')) return false;
  if (normalized === 'pagado' || normalized === 'paid') return true;
  return null;
}

export function isPaidSettlementStatus(value) {
  return parsePaymentStatus(value) === true;
}

export function parseScheduledPaymentDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const latin = raw.match(/(\d{1,2}[/-]\d{1,2}[/-]\d{4})/);
  if (latin) return parseDateKey(latin[1]);
  const iso = raw.match(/(\d{4}-\d{2}-\d{2})/);
  return iso ? parseDateKey(iso[1]) : null;
}

export function isTransactionDateHeader(header) {
  return header.includes('fecha de transacci')
    || header === 'fecha transaccion'
    || header.includes('fecha de liquidacion')
    || header === 'transaction date';
}

export function paidDateFromRaw(raw, paymentStatus, paid) {
  const tx = parseDateKey(rawValueByHeader(raw, isTransactionDateHeader));
  const scheduled = parseScheduledPaymentDate(paymentStatus);
  if (paid === true || isPaidSettlementStatus(paymentStatus)) return tx || scheduled;
  return scheduled || null;
}

export function paidDateFromLine(line) {
  if (line?.paidDate) return parseDateKey(line.paidDate);
  return paidDateFromRaw(line?.raw, line?.paymentStatus, line?.paid);
}

export function monthKey(date) {
  const day = String(date || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day.slice(0, 7) : '';
}

export function collectMonthKeys(dates) {
  return [...new Set((dates || []).map((date) => monthKey(date)).filter(Boolean))].sort().reverse();
}

function cell(row, headerIndex, headerName) {
  if (headerName == null) return '';
  return String(row[headerIndex.get(headerName)] ?? '').trim();
}

function findSettlementHeaderRow(rows) {
  let lastError;
  let bestError;
  let bestWidth = -1;
  const scanTo = Math.min(rows.length, 40);
  for (let index = 0; index < scanTo; index += 1) {
    try {
      return { index, binding: bindCsvHeaders(rows[index]) };
    } catch (error) {
      lastError = error;
      const width = (rows[index] || []).filter((value) => String(value || '').trim()).length;
      if (width > bestWidth) {
        bestWidth = width;
        bestError = error;
      }
    }
  }
  throw bestError || lastError || httpError('El CSV no tiene cabecera.');
}

export function parseSettlementCsv(text) {
  const rows = parseCsvRows(text);
  if (!rows.length) throw httpError('El CSV está vacío.');
  const found = findSettlementHeaderRow(rows);
  const headerRow = rows[found.index];
  const binding = found.binding;
  if (rows.length < found.index + 2) throw httpError('El CSV no tiene líneas de detalle.');
  const headerIndex = new Map();
  for (let index = 0; index < headerRow.length; index += 1) {
    const name = String(headerRow[index] || '').trim();
    if (name && !headerIndex.has(name)) headerIndex.set(name, index);
  }
  const lines = [];
  for (let index = found.index + 1; index < rows.length; index += 1) {
    const row = rows[index];
    const raw = {};
    for (const header of binding.headers) raw[header] = cell(row, headerIndex, header);
    if (!Object.values(raw).some(Boolean)) continue;
    const typeValue = repairSettlementText(
      cell(row, headerIndex, binding.columns.type)
      || cell(row, headerIndex, binding.columns.category),
    );
    const chargeKind = classifyChargeKind(typeValue);
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
      : chargeKind === 'buyer_shipping'
        ? 0
        : kind === 'other' || kind === 'refund' ? Math.abs(signedAmount || 0) : 0;
    const neto = binding.columns.neto
      ? parseMoney(cell(row, headerIndex, binding.columns.neto))
      : signedAmount != null
        ? signedAmount
        : Math.round(((bruto || 0) - commission - other) * 100) / 100;
    const paymentStatus = cell(row, headerIndex, binding.columns.paymentStatus);
    lines.push({
      rowNumber: index + 1,
      raw,
      orderId: cell(row, headerIndex, binding.columns.orderId),
      sku: cell(row, headerIndex, binding.columns.sku),
      shopSku: cell(row, headerIndex, binding.columns.shopSku),
      itemId: cell(row, headerIndex, binding.columns.itemId)
        || cell(row, headerIndex, binding.columns.articleId),
      statementId: cell(row, headerIndex, binding.columns.statementId),
      productName: cell(row, headerIndex, binding.columns.productName),
      date: parseDateKey(cell(row, headerIndex, binding.columns.orderDate))
        || parseDateKey(cell(row, headerIndex, binding.columns.date)),
      paidDate: paidDateFromRaw(
        raw,
        paymentStatus,
        parsePaymentStatus(paymentStatus),
      ),
      type: typeValue,
      kind,
      chargeKind,
      paid: parsePaymentStatus(paymentStatus),
      paymentStatus,
      commissionRate: parseRate(cell(row, headerIndex, binding.columns.commissionRate)),
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
    String(line.statementId || '').trim().toLowerCase(),
    String(line.orderId || '').trim().toLowerCase(),
    String(line.itemId || '').trim().toLowerCase(),
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
