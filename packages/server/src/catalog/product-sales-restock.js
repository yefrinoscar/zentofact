export const RESTOCK_HORIZON_DAYS = 30;
export const RESTOCK_LIMIT = 8;
export const SKIP_LIMIT = 8;
export const OVERSTOCK_DAYS = 45;
export const SLOW_UNITS_PER_DAY = 0.4;
export const ANALYSIS_POINT_LIMIT = 50;

export function periodDayCount(from, to) {
  const start = new Date(`${from}T12:00:00.000Z`).getTime();
  const end = new Date(`${to}T12:00:00.000Z`).getTime();
  return Math.round((end - start) / 86_400_000) + 1;
}

export function addDays(value, amount) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function unitsPerDay(unitsSold, dayCount) {
  const days = Number(dayCount);
  if (!(days > 0)) return 0;
  return Number(unitsSold || 0) / days;
}

export function keepsMoney({ arrives, unitsSold, wholesalePrice } = {}) {
  if (arrives == null || !Number.isFinite(Number(arrives))) {
    return { keeps: null, keepsPerUnit: null, hasWholesaleCost: false };
  }
  const units = Number(unitsSold || 0);
  const arrivesNum = Number(arrives);
  const hasWholesaleCost = wholesalePrice != null && Number.isFinite(Number(wholesalePrice));
  const keeps = hasWholesaleCost ? arrivesNum - Number(wholesalePrice) * units : arrivesNum;
  return {
    keeps,
    keepsPerUnit: units > 0 ? keeps / units : null,
    hasWholesaleCost,
  };
}

export function keepsPerDay(keeps, dayCount) {
  if (keeps == null || !Number.isFinite(Number(keeps))) return null;
  const days = Number(dayCount);
  if (!(days > 0)) return null;
  return Number(keeps) / days;
}

export function coverDays(available, pace) {
  if (!(Number(pace) > 0)) return null;
  return Math.max(0, Number(available || 0)) / Number(pace);
}

export function restockQuantity({
  unitsPerDay: pace,
  available,
  horizonDays = RESTOCK_HORIZON_DAYS,
} = {}) {
  if (!(Number(pace) > 0)) return 0;
  const stock = Math.max(0, Number(available || 0));
  return Math.max(0, Math.ceil(Number(pace) * Number(horizonDays) - stock));
}

export function seriesPace(series = []) {
  const values = series.map((point) => Number(point.units || 0));
  if (values.length < 4) return 'stable';
  const mid = Math.floor(values.length / 2);
  const average = (items) => items.reduce((sum, value) => sum + value, 0) / items.length;
  const first = average(values.slice(0, mid));
  const second = average(values.slice(mid));
  if (second > first * 1.2 && second - first >= 0.15) return 'up';
  if (second < first * 0.8 && first - second >= 0.15) return 'down';
  return 'stable';
}

export function weekendShare(series = []) {
  let weekend = 0;
  let total = 0;
  for (const point of series) {
    const units = Number(point.units || 0);
    total += units;
    const date = new Date(`${point.date}T12:00:00.000Z`);
    if (Number.isNaN(date.getTime())) continue;
    const weekday = date.getUTCDay();
    if (weekday === 0 || weekday >= 4) weekend += units;
  }
  return total > 0 ? weekend / total : 0;
}

export function eachDate(from, to) {
  const days = [];
  let cursor = from;
  while (cursor <= to) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
    if (days.length > 800) break;
  }
  return days;
}

export function dateKey(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value || '').slice(0, 10);
}

export function fillDailyOverview(from, to, sparse = []) {
  const byDate = new Map();
  for (const point of sparse) {
    const date = dateKey(point.date || point.day);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const current = byDate.get(date) || { units: 0, revenue: 0 };
    byDate.set(date, {
      units: current.units + Number(point.units || 0),
      revenue: current.revenue + Number(point.revenue || 0),
    });
  }
  return eachDate(from, to).map((date) => ({
    date,
    units: byDate.get(date)?.units || 0,
    revenue: byDate.get(date)?.revenue || 0,
  }));
}

export function fillDailySeries(from, to, sparse = []) {
  const byDate = new Map();
  for (const point of sparse) {
    const date = dateKey(point.date || point.day);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    byDate.set(date, Number(byDate.get(date) || 0) + Number(point.units || 0));
  }
  return eachDate(from, to).map((date) => ({
    date,
    units: byDate.get(date) || 0,
  }));
}

export function groupSeriesRows(rows = []) {
  const grouped = new Map();
  for (const row of rows) {
    const key = row.product_key;
    if (!key) continue;
    const list = grouped.get(key) || [];
    list.push({ date: dateKey(row.day), units: Number(row.units || 0) });
    grouped.set(key, list);
  }
  return grouped;
}

export function productRestock(row, {
  from,
  to,
  horizonDays = RESTOCK_HORIZON_DAYS,
  series = [],
  fillSeries = true,
} = {}) {
  const dayCount = periodDayCount(from, to);
  const pace = unitsPerDay(row.unitsSold, dayCount);
  const money = keepsMoney({
    arrives: row.arrives,
    unitsSold: row.unitsSold,
    wholesalePrice: row.wholesalePrice,
  });
  const available = row.available == null ? null : Number(row.available);
  const filled = fillSeries ? fillDailySeries(from, to, series) : [];
  return {
    ...row,
    unitsPerDay: pace,
    keeps: money.keeps,
    keepsPerUnit: money.keepsPerUnit,
    keepsPerDay: keepsPerDay(money.keeps, dayCount),
    hasWholesaleCost: money.hasWholesaleCost,
    available,
    coverDays: coverDays(available, pace),
    restockQty: restockQuantity({ unitsPerDay: pace, available, horizonDays }),
    horizonDays,
    series: filled,
    pace: seriesPace(filled),
    weekendShare: weekendShare(filled),
  };
}

function keepsRank(product) {
  if (product.keepsPerDay == null) return Number.NEGATIVE_INFINITY;
  return product.keepsPerDay;
}

export function skipReasonOf(product, topKeeps) {
  if (product.coverDays != null && product.coverDays >= OVERSTOCK_DAYS) return 'overstock';
  if (Number(product.unitsPerDay || 0) < SLOW_UNITS_PER_DAY) return 'slow';
  if (
    topKeeps != null
    && product.keepsPerDay != null
    && product.unitsPerDay >= 1.5
    && product.keepsPerDay <= topKeeps * 0.25
  ) return 'lowKeep';
  return null;
}

function pointGroup(skipReason) {
  if (skipReason === 'overstock' || skipReason === 'slow' || skipReason === 'lowKeep') return 'skip';
  return 'bring';
}

function compactPoint(product, group) {
  return {
    productKey: product.productKey,
    sku: product.sku,
    name: product.name,
    unitsPerDay: Number(product.unitsPerDay || 0),
    keepsPerDay: product.keepsPerDay,
    restockQty: Number(product.restockQty || 0),
    coverDays: product.coverDays ?? null,
    available: product.available ?? null,
    skipReason: product.skipReason || null,
    group,
  };
}

export function pickRestockLists(products = [], {
  limit = RESTOCK_LIMIT,
  skipLimit = SKIP_LIMIT,
  horizonDays = RESTOCK_HORIZON_DAYS,
  pointLimit = ANALYSIS_POINT_LIMIT,
} = {}) {
  const ranked = products.slice().sort((left, right) => {
    const byKeeps = keepsRank(right) - keepsRank(left);
    if (byKeeps) return byKeeps;
    return right.unitsPerDay - left.unitsPerDay;
  });
  const items = ranked.filter((product) => (
    product.restockQty > 0
    && product.unitsPerDay >= SLOW_UNITS_PER_DAY
    && (product.coverDays == null || product.coverDays < horizonDays)
  )).slice(0, limit);
  const topKeeps = items[0]?.keepsPerDay;
  const itemKeys = new Set(items.map((product) => product.productKey));
  const tagged = ranked
    .filter((product) => !itemKeys.has(product.productKey))
    .map((product) => ({ ...product, skipReason: skipReasonOf(product, topKeeps) }))
    .filter((product) => product.skipReason);
  const overstock = tagged.filter((product) => product.skipReason === 'overstock').slice(0, skipLimit);
  const slow = tagged
    .filter((product) => product.skipReason === 'slow' || product.skipReason === 'lowKeep')
    .slice(0, skipLimit);
  const skip = [...overstock, ...slow];
  const points = [];
  const seen = new Set();
  const addPoint = (product, group) => {
    if (!product?.productKey || seen.has(product.productKey)) return;
    if (product.keepsPerDay == null) return;
    seen.add(product.productKey);
    points.push(compactPoint(product, group));
  };
  for (const product of items) addPoint(product, 'bring');
  for (const product of skip) addPoint(product, pointGroup(product.skipReason));
  return { items, skip, points };
}
