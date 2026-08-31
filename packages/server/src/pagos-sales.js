import {
  classifyChargeKind,
  normalizeHeader,
  parseRate,
  rawValueByHeader,
  repairSettlementText,
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
  const rawName = named || rawValueByHeader(line.raw, (header) => header.includes('nombre del producto'));
  return repairSettlementText(rawName);
}

function shopSkuFromLine(line) {
  const named = String(line.shopSku || '').trim();
  if (named) return named;
  return rawValueByHeader(line.raw, (header) => (
    header === 'sku falabella' || header === 'shop sku' || header === 'shopsku'
  ));
}

function emptyItem(itemId, sku, productName, shopSku) {
  return {
    itemId: itemId || '',
    sku: sku || '',
    shopSku: shopSku || '',
    productName: productName || '',
    bruto: 0,
    commission: 0,
    shipping: 0,
    buyerShipping: 0,
    buyerShippingPaid: 0,
    buyerShippingReversed: 0,
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
    buyerShippingPaid: 0,
    buyerShippingReversed: 0,
    other: 0,
    neto: 0,
    csvRates: [],
    charges: [],
    items: new Map(),
    orderNumbers: [],
  };
}

function applyCharge(target, kind, amount) {
  const signed = Number(amount || 0);
  if (kind === 'sale') target.bruto = round2(target.bruto + signed);
  else if (kind === 'commission') target.commission = round2(target.commission - signed);
  else if (kind === 'shipping') target.shipping = round2(target.shipping - signed);
  else if (kind === 'buyer_shipping') {
    target.buyerShipping = round2(target.buyerShipping + signed);
    if (signed > 0) target.buyerShippingPaid = round2((target.buyerShippingPaid || 0) + signed);
    else if (signed < 0) target.buyerShippingReversed = round2((target.buyerShippingReversed || 0) + signed);
    return;
  }
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
    buyerShippingPaid: row.buyerShippingPaid || 0,
    buyerShippingReversed: row.buyerShippingReversed || 0,
    other: row.other,
    neto: row.neto,
    take,
    commissionRate: uniqueRates.length === 1 ? uniqueRates[0] : ratio(row.commission, row.bruto),
    shippingRate: ratio(row.shipping, row.bruto),
    takeRate: ratio(take, row.bruto),
  };
}

export function summarizeSettlementSales(sales) {
  const summary = sales.reduce((totals, sale) => {
    const paid = Boolean(sale.paid);
    return {
      saleCount: totals.saleCount + 1,
      paidCount: totals.paidCount + (paid ? 1 : 0),
      pendingCount: totals.pendingCount + (paid ? 0 : 1),
      bruto: round2(totals.bruto + sale.bruto),
      commission: round2(totals.commission + sale.commission),
      shipping: round2(totals.shipping + sale.shipping),
      neto: round2(totals.neto + sale.neto),
      take: round2(totals.take + sale.take),
      paidBruto: round2(totals.paidBruto + (paid ? sale.bruto : 0)),
      pendingBruto: round2(totals.pendingBruto + (paid ? 0 : sale.bruto)),
      paidNeto: round2(totals.paidNeto + (paid ? sale.neto : 0)),
      pendingNeto: round2(totals.pendingNeto + (paid ? 0 : sale.neto)),
      itemCount: totals.itemCount + Number(sale.itemCount || 0),
      matchedCount: totals.matchedCount + (sale.matched ? 1 : 0),
    };
  }, {
    saleCount: 0,
    paidCount: 0,
    pendingCount: 0,
    bruto: 0,
    commission: 0,
    shipping: 0,
    neto: 0,
    take: 0,
    paidBruto: 0,
    pendingBruto: 0,
    paidNeto: 0,
    pendingNeto: 0,
    itemCount: 0,
    matchedCount: 0,
  });
  return {
    ...summary,
    commissionRate: ratio(summary.commission, summary.bruto),
    shippingRate: ratio(summary.shipping, summary.bruto),
    takeRate: ratio(summary.take, summary.bruto),
    ticket: summary.saleCount ? round2(summary.bruto / summary.saleCount) : 0,
    arriveTicket: summary.saleCount ? round2(summary.neto / summary.saleCount) : 0,
  };
}

function groupKey(item) {
  return [
    String(item.sku || '').trim(),
    round2(item.bruto),
    item.commissionRate ?? '',
    round2(item.shipping),
  ].join('|');
}

export function groupSaleProducts(items) {
  const groups = new Map();
  for (const item of items || []) {
    const key = groupKey(item);
    const current = groups.get(key) || {
      sku: item.sku || '',
      shopSku: item.shopSku || '',
      productName: item.productName || '',
      quantity: 0,
      bruto: 0,
      commission: 0,
      shipping: 0,
      buyerShipping: 0,
      buyerShippingPaid: 0,
      buyerShippingReversed: 0,
      other: 0,
      neto: 0,
      csvRates: [],
    };
    current.quantity += 1;
    current.bruto = round2(current.bruto + Number(item.bruto || 0));
    current.commission = round2(current.commission + Number(item.commission || 0));
    current.shipping = round2(current.shipping + Number(item.shipping || 0));
    current.buyerShipping = round2(current.buyerShipping + Number(item.buyerShipping || 0));
    current.buyerShippingPaid = round2(current.buyerShippingPaid + Number(item.buyerShippingPaid || 0));
    current.buyerShippingReversed = round2(current.buyerShippingReversed + Number(item.buyerShippingReversed || 0));
    current.other = round2(current.other + Number(item.other || 0));
    current.neto = round2(current.neto + Number(item.neto || 0));
    if (item.commissionRate != null && Number.isFinite(Number(item.commissionRate))) {
      current.csvRates.push(Number(item.commissionRate));
    }
    if (item.productName && !current.productName) current.productName = item.productName;
    if (item.shopSku && !current.shopSku) current.shopSku = item.shopSku;
    groups.set(key, current);
  }

  return [...groups.values()].map((group) => {
    const totals = finalizeTotals(group);
    const quantity = group.quantity || 1;
    return {
      sku: group.sku,
      shopSku: group.shopSku,
      productName: group.productName,
      quantity,
      ...totals,
      unitBruto: round2(totals.bruto / quantity),
      unitCommission: round2(totals.commission / quantity),
      unitShipping: round2(totals.shipping / quantity),
      unitNeto: round2(totals.neto / quantity),
    };
  });
}

const CHARGE_KIND_ORDER = {
  sale: 0,
  commission: 1,
  shipping: 2,
  other: 3,
  refund: 4,
  buyer_shipping: 5,
};

export function splitChargeLegs(charges) {
  const legs = {
    brutoCharged: 0,
    brutoReversed: 0,
    commissionCharged: 0,
    commissionReversed: 0,
    shippingCharged: 0,
    shippingReversed: 0,
  };
  for (const charge of charges || []) {
    const amount = round2(charge.amount);
    if (charge.kind === 'sale') {
      if (amount > 0) legs.brutoCharged = round2(legs.brutoCharged + amount);
      else if (amount < 0) legs.brutoReversed = round2(legs.brutoReversed + amount);
    } else if (charge.kind === 'commission') {
      if (amount < 0) legs.commissionCharged = round2(legs.commissionCharged + Math.abs(amount));
      else if (amount > 0) legs.commissionReversed = round2(legs.commissionReversed - amount);
    } else if (charge.kind === 'shipping') {
      if (amount < 0) legs.shippingCharged = round2(legs.shippingCharged + Math.abs(amount));
      else if (amount > 0) legs.shippingReversed = round2(legs.shippingReversed - amount);
    }
  }
  return legs;
}

export function groupSaleCharges(charges) {
  const groups = new Map();
  for (const charge of charges || []) {
    const kind = charge.kind || 'other';
    if (kind === 'buyer_shipping') continue;
    const key = ['sale', 'commission', 'shipping'].includes(kind)
      ? kind
      : `${kind}|${charge.type || ''}`;
    const current = groups.get(key) || {
      kind,
      type: charge.type || '',
      count: 0,
      amount: 0,
      unitAmounts: [],
    };
    const amount = round2(Number(charge.amount || 0));
    current.count += 1;
    current.amount = round2(current.amount + amount);
    current.unitAmounts.push(amount);
    groups.set(key, current);
  }

  return [...groups.values()]
    .map((group) => {
      const unique = [...new Set(group.unitAmounts)];
      return {
        kind: group.kind,
        type: group.type,
        count: group.count,
        amount: group.amount,
        unitAmount: unique.length === 1 ? unique[0] : null,
      };
    })
    .sort((left, right) => (
      (CHARGE_KIND_ORDER[left.kind] ?? 9) - (CHARGE_KIND_ORDER[right.kind] ?? 9)
      || String(left.type).localeCompare(String(right.type))
    ));
}

function importKey(line) {
  const value = Number(line.importId);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function chargeKindOf(line) {
  return line.chargeKind || classifyChargeKind(line.type);
}

function lineDedupeKey(line) {
  return [
    String(line.orderId || '').trim(),
    String(line.itemId || line.sku || '').trim(),
    chargeKindOf(line),
    round2(signedAmount(line)).toFixed(2),
  ].join('|');
}

export function isReturnMovement(line) {
  const kind = chargeKindOf(line);
  if (kind === 'buyer_shipping') return false;
  const type = normalizeHeader(repairSettlementText(line.type || ''));
  if (type.includes('reversa') || type.includes('devoluc') || type.includes('refund') || type.includes('reembolso')) {
    return true;
  }
  const amount = signedAmount(line);
  if (kind === 'sale' && amount < 0) return true;
  if (kind === 'commission' && amount > 0) return true;
  if (kind === 'shipping' && amount > 0) return true;
  return false;
}

function hasPositiveSale(lines) {
  return (lines || []).some((line) => chargeKindOf(line) === 'sale' && signedAmount(line) > 0);
}

function scoreOrderImport(importId, lines) {
  const hasSale = lines.some((line) => chargeKindOf(line) === 'sale');
  return {
    importId,
    lines,
    hasSale,
    hasPositiveSale: hasPositiveSale(lines),
    hasReturn: lines.some((line) => isReturnMovement(line)),
    count: lines.length,
  };
}

function mergeComplementaryImports(ranked) {
  const primary = ranked[0];
  if (!primary) return [];
  const merged = [...primary.lines];
  const seen = new Set(merged.map(lineDedupeKey));
  const primaryHasPositiveSale = primary.hasPositiveSale;
  const primaryHasReturn = primary.hasReturn;
  for (const other of ranked.slice(1)) {
    const shouldMerge = (primaryHasReturn && !primaryHasPositiveSale && other.hasPositiveSale)
      || (primaryHasPositiveSale && !primaryHasReturn && other.hasReturn);
    if (!shouldMerge) continue;
    for (const line of other.lines) {
      const key = lineDedupeKey(line);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(line);
    }
  }
  return merged;
}

export function chooseLinesPerOrder(lines) {
  const byOrder = new Map();
  for (const line of lines || []) {
    const orderId = String(line.orderId || '').trim();
    if (!orderId) continue;
    const imports = byOrder.get(orderId) || new Map();
    const key = importKey(line);
    const bucket = imports.get(key) || [];
    bucket.push(line);
    imports.set(key, bucket);
    byOrder.set(orderId, imports);
  }
  const chosen = [];
  for (const imports of byOrder.values()) {
    const ranked = [...imports.entries()]
      .map(([importId, orderLines]) => scoreOrderImport(importId, orderLines))
      .sort((left, right) => (
        Number(right.hasPositiveSale) - Number(left.hasPositiveSale)
        || Number(right.hasSale) - Number(left.hasSale)
        || right.count - left.count
        || right.importId - left.importId
      ));
    chosen.push(...mergeComplementaryImports(ranked));
  }
  return chosen;
}

function uniqueSettlementLines(lines) {
  const kept = [];
  const seen = new Set();
  for (const line of lines || []) {
    const itemId = String(line.itemId || '').trim();
    if (!itemId) {
      kept.push(line);
      continue;
    }
    const key = [
      String(line.orderId || '').trim(),
      itemId,
      chargeKindOf(line),
      round2(signedAmount(line)).toFixed(2),
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(line);
  }
  return kept;
}

export function aggregateSettlementSales(lines) {
  const groups = new Map();
  for (const line of uniqueSettlementLines(chooseLinesPerOrder(lines))) {
    const orderId = String(line.orderId || '').trim();
    if (!orderId) continue;
    const current = groups.get(orderId) || emptySale(orderId, line);
    const kind = line.chargeKind || classifyChargeKind(line.type);
    const amount = signedAmount(line);
    applyCharge(current, kind, amount);
    current.charges.push({
      type: repairSettlementText(line.type || ''),
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
    const orderNumber = String(line.saleOrderNumber || '').trim();
    if (orderNumber && !current.orderNumbers.includes(orderNumber)) current.orderNumbers.push(orderNumber);
    const sku = String(line.sku || '').trim();
    if (sku && !current.skus.includes(sku)) current.skus.push(sku);
    const productName = productNameFromLine(line);
    if (productName && !current.productName) current.productName = productName;
    const shopSku = shopSkuFromLine(line);
    const csvRate = commissionRateFromLine(line);
    if (csvRate) current.csvRates.push(csvRate);
    const itemKey = String(line.itemId || sku || 'item').trim();
    const item = current.items.get(itemKey) || emptyItem(line.itemId, sku, productName, shopSku);
    applyCharge(item, kind, amount);
    if (sku && !item.sku) item.sku = sku;
    if (shopSku && !item.shopSku) item.shopSku = shopSku;
    if (productName && !item.productName) item.productName = productName;
    if (csvRate) item.csvRates.push(csvRate);
    current.items.set(itemKey, item);
    groups.set(orderId, current);
  }

  return [...groups.values()].map((sale) => {
    const totals = finalizeTotals(sale);
    const items = [...sale.items.values()].map((item) => ({
      itemId: item.itemId,
      sku: item.sku,
      shopSku: item.shopSku,
      productName: item.productName,
      ...finalizeTotals(item),
    }));
    const returned = sale.charges.some((charge) => isReturnMovement({
      type: charge.type,
      chargeKind: charge.kind,
      neto: charge.amount,
      amount: charge.amount,
    }));
    return {
      orderId: sale.orderId,
      date: sale.date,
      paid: sale.paid,
      returned,
      paymentStatus: sale.paymentStatus || (sale.paid ? 'Pagado' : 'No Pagado'),
      matched: sale.matched,
      productName: sale.productName,
      skus: sale.skus,
      orderNumbers: sale.orderNumbers,
      itemCount: sale.items.size,
      ...totals,
      ...splitChargeLegs(sale.charges),
      charges: sale.charges,
      chargeGroups: groupSaleCharges(sale.charges),
      items,
      products: groupSaleProducts(items),
    };
  }).sort((left, right) => (right.takeRate || 0) - (left.takeRate || 0) || String(right.orderId).localeCompare(String(left.orderId)));
}

export function attachDocumentsToSales(sales, documents) {
  const byRef = new Map();
  for (const document of documents || []) {
    const key = String(document.orderNumber || '').trim();
    if (!key) continue;
    const current = byRef.get(key);
    if (!current || (document.kind === 'factura' && current.kind !== 'factura')) {
      byRef.set(key, {
        kind: document.kind,
        number: document.number || '',
        status: document.status || '',
      });
    }
  }
  return (sales || []).map((sale) => {
    const refs = [sale.orderId, ...(sale.orderNumbers || [])].map((value) => String(value || '').trim()).filter(Boolean);
    const document = refs.map((ref) => byRef.get(ref)).find(Boolean) || null;
    return { ...sale, document };
  });
}
