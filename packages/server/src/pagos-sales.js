import {
  classifyChargeKind,
  normalizeHeader,
  parseRate,
  rawValueByHeader,
} from './pagos-csv.js';

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function ratio(part, whole) {
  if (!whole) return null;
  return Math.round((Number(part || 0) / Number(whole)) * 10000) / 10000;
}

function signedAmount(line) {
  if (line.neto != null && line.neto !== '') return Number(line.neto);
  if (line.amount != null && line.amount !== '') return Number(line.amount);
  return 0;
}

export function commissionRateFromLine(line) {
  if (line.commissionRate != null && Number.isFinite(Number(line.commissionRate))) {
    return Number(line.commissionRate);
  }
  return parseRate(rawValueByHeader(line.raw, (header) => (
    header === 'comision' || header === 'comisi n' || header === '% comision'
  )));
}

export function productNameFromLine(line) {
  const named = String(line.productName || '').trim();
  if (named) return named;
  return rawValueByHeader(line.raw, (header) => header.includes('nombre del producto'));
}

function emptyItem(itemId, sku, productName) {
  return {
    itemId: itemId || '',
    sku: sku || '',
    productName: productName || '',
    bruto: 0,
    commission: 0,
    shipping: 0,
    buyerShipping: 0,
    other: 0,
    neto: 0,
    csvRates: [],
  };
}

function emptySale(orderId, line) {
  return {
    orderId,
    date: line.date || null,
    paid: false,
    paymentStatus: '',
    matched: false,
    productName: '',
    skus: [],
    bruto: 0,
    commission: 0,
    shipping: 0,
    buyerShipping: 0,
    other: 0,
    neto: 0,
    csvRates: [],
    charges: [],
    items: new Map(),
  };
}

function applyCharge(target, kind, amount) {
  const signed = Number(amount || 0);
  if (kind === 'sale') target.bruto = round2(target.bruto + Math.abs(signed));
  else if (kind === 'commission') target.commission = round2(target.commission + Math.abs(signed));
  else if (kind === 'shipping') target.shipping = round2(target.shipping + Math.abs(signed));
  else if (kind === 'buyer_shipping') target.buyerShipping = round2(target.buyerShipping + signed);
  else target.other = round2(target.other + signed);
  target.neto = round2(target.neto + signed);
}

function finalizeTotals(row) {
  const take = round2(row.bruto - row.neto);
  const uniqueRates = [...new Set(row.csvRates.filter((rate) => Number.isFinite(rate)))];
  return {
    bruto: row.bruto,
    commission: row.commission,
    shipping: row.shipping,
    buyerShipping: row.buyerShipping,
    other: row.other,
    neto: row.neto,
    take,
    commissionRate: uniqueRates.length === 1 ? uniqueRates[0] : ratio(row.commission, row.bruto),
    shippingRate: ratio(row.shipping, row.bruto),
    takeRate: ratio(take, row.bruto),
  };
}

export function summarizeSettlementSales(sales) {
  const summary = sales.reduce((totals, sale) => ({
    saleCount: totals.saleCount + 1,
    paidCount: totals.paidCount + (sale.paid ? 1 : 0),
    pendingCount: totals.pendingCount + (sale.paid ? 0 : 1),
    bruto: round2(totals.bruto + sale.bruto),
    commission: round2(totals.commission + sale.commission),
    shipping: round2(totals.shipping + sale.shipping),
    neto: round2(totals.neto + sale.neto),
    take: round2(totals.take + sale.take),
  }), {
    saleCount: 0,
    paidCount: 0,
    pendingCount: 0,
    bruto: 0,
    commission: 0,
    shipping: 0,
    neto: 0,
    take: 0,
  });
  return {
    ...summary,
    commissionRate: ratio(summary.commission, summary.bruto),
    shippingRate: ratio(summary.shipping, summary.bruto),
    takeRate: ratio(summary.take, summary.bruto),
  };
}

export function aggregateSettlementSales(lines) {
  const groups = new Map();
  for (const line of lines || []) {
    const orderId = String(line.orderId || '').trim();
    if (!orderId) continue;
    const current = groups.get(orderId) || emptySale(orderId, line);
    const kind = line.chargeKind || classifyChargeKind(line.type);
    const amount = signedAmount(line);
    applyCharge(current, kind, amount);
    current.charges.push({
      type: line.type || '',
      kind,
      amount,
      sku: line.sku || '',
      itemId: line.itemId || '',
    });
    if (line.date && (!current.date || String(line.date) < String(current.date))) current.date = line.date;
    if (line.paid === true || normalizeHeader(line.paymentStatus) === 'pagado') {
      current.paid = true;
      current.paymentStatus = line.paymentStatus || 'Pagado';
    } else if (!current.paid && !current.paymentStatus) {
      current.paymentStatus = line.paymentStatus || '';
    }
    if (line.status === 'matched') current.matched = true;
    const sku = String(line.sku || '').trim();
    if (sku && !current.skus.includes(sku)) current.skus.push(sku);
    const productName = productNameFromLine(line);
    if (productName && !current.productName) current.productName = productName;
    const csvRate = commissionRateFromLine(line);
    if (csvRate) current.csvRates.push(csvRate);
    const itemKey = String(line.itemId || sku || 'item').trim();
    const item = current.items.get(itemKey) || emptyItem(line.itemId, sku, productName);
    applyCharge(item, kind, amount);
    if (sku && !item.sku) item.sku = sku;
    if (productName && !item.productName) item.productName = productName;
    if (csvRate) item.csvRates.push(csvRate);
    current.items.set(itemKey, item);
    groups.set(orderId, current);
  }

  return [...groups.values()].map((sale) => {
    const totals = finalizeTotals(sale);
    return {
      orderId: sale.orderId,
      date: sale.date,
      paid: sale.paid,
      paymentStatus: sale.paymentStatus || (sale.paid ? 'Pagado' : 'No Pagado'),
      matched: sale.matched,
      productName: sale.productName,
      skus: sale.skus,
      itemCount: sale.items.size,
      ...totals,
      charges: sale.charges,
      items: [...sale.items.values()].map((item) => ({
        itemId: item.itemId,
        sku: item.sku,
        productName: item.productName,
        ...finalizeTotals(item),
      })),
    };
  }).sort((left, right) => (right.takeRate || 0) - (left.takeRate || 0) || String(right.orderId).localeCompare(String(left.orderId)));
}
