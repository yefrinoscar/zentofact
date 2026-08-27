function cents(value) {
  return Math.round(Number(value || 0) * 100);
}

function keyPart(value) {
  return String(value || '').trim().toLowerCase();
}

export function saleOrderKeys(sale) {
  return [...new Set([sale.orderId, sale.orderNumber].map(keyPart).filter(Boolean))];
}

export function saleSkuKeys(sale) {
  return [...new Set((sale.skus || []).map(keyPart).filter(Boolean))];
}

export function indexSales(sales) {
  const byOrderId = new Map();
  const bySkuDateAmount = new Map();
  const bySkuAmount = new Map();
  for (const sale of sales) {
    for (const orderKey of saleOrderKeys(sale)) {
      const list = byOrderId.get(orderKey) || [];
      list.push(sale);
      byOrderId.set(orderKey, list);
    }
    for (const sku of saleSkuKeys(sale)) {
      const amountKey = `${sku}|${cents(sale.amount)}`;
      const dateKey = `${sku}|${sale.date || ''}|${cents(sale.amount)}`;
      const amountList = bySkuAmount.get(amountKey) || [];
      amountList.push(sale);
      bySkuAmount.set(amountKey, amountList);
      const dateList = bySkuDateAmount.get(dateKey) || [];
      dateList.push(sale);
      bySkuDateAmount.set(dateKey, dateList);
    }
  }
  return { byOrderId, bySkuDateAmount, bySkuAmount };
}

function uniqueSale(candidates) {
  if (!candidates?.length) return null;
  const ids = new Set(candidates.map((sale) => `${sale.source}:${sale.id}`));
  if (ids.size !== 1) return null;
  return candidates[0];
}

export function matchSettlementLine(line, index) {
  const orderKey = keyPart(line.orderId);
  if (orderKey) {
    const matched = uniqueSale(index.byOrderId.get(orderKey));
    if (matched) return { status: 'matched', method: 'order_id', sale: matched };
    if (index.byOrderId.has(orderKey)) {
      return { status: 'unmatched', method: null, sale: null, reason: 'ambiguous_order_id' };
    }
    return { status: 'unmatched', method: null, sale: null, reason: 'unknown_order_id' };
  }
  const sku = keyPart(line.sku);
  const amount = line.amount != null ? line.amount : (line.bruto || line.neto);
  if (sku && line.date && amount != null) {
    const matched = uniqueSale(index.bySkuDateAmount.get(`${sku}|${line.date}|${cents(amount)}`));
    if (matched) return { status: 'matched', method: 'sku_date_amount', sale: matched };
    if (index.bySkuDateAmount.has(`${sku}|${line.date}|${cents(amount)}`)) {
      return { status: 'unmatched', method: null, sale: null, reason: 'ambiguous_sku_date_amount' };
    }
  }
  if (sku && amount != null) {
    const matched = uniqueSale(index.bySkuAmount.get(`${sku}|${cents(amount)}`));
    if (matched) return { status: 'matched', method: 'sku_amount', sale: matched };
    if (index.bySkuAmount.has(`${sku}|${cents(amount)}`)) {
      return { status: 'unmatched', method: null, sale: null, reason: 'ambiguous_sku_amount' };
    }
  }
  return { status: 'unmatched', method: null, sale: null, reason: 'no_unique_match' };
}

export function aggregateSaleAmounts(lines) {
  return lines.reduce((totals, line) => ({
    bruto: Math.round((totals.bruto + Number(line.bruto || 0)) * 100) / 100,
    commission: Math.round((totals.commission + Number(line.commission || 0)) * 100) / 100,
    other: Math.round((totals.other + Number(line.other || 0)) * 100) / 100,
    neto: Math.round((totals.neto + Number(line.neto || 0)) * 100) / 100,
  }), { bruto: 0, commission: 0, other: 0, neto: 0 });
}

export function matchSettlementLines(lines, sales) {
  const index = indexSales(sales);
  const results = lines.map((line) => {
    const match = matchSettlementLine(line, index);
    return { line, ...match };
  });
  const paidBySale = new Map();
  for (const result of results) {
    if (result.status !== 'matched' || !result.sale) continue;
    if (result.line.paid === false) continue;
    const key = `${result.sale.source}:${result.sale.id}`;
    const current = paidBySale.get(key) || { sale: result.sale, lines: [] };
    current.lines.push(result.line);
    paidBySale.set(key, current);
  }
  const paidSales = [...paidBySale.values()].map((entry) => ({
    ...entry.sale,
    amounts: aggregateSaleAmounts(entry.lines),
    matchMethods: [...new Set(results
      .filter((result) => result.sale && `${result.sale.source}:${result.sale.id}` === `${entry.sale.source}:${entry.sale.id}`)
      .map((result) => result.method)
      .filter(Boolean))],
  }));
  return { results, paidSales };
}
