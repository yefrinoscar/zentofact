// Avisos operativos: se arman desde el estado actual, no desde un historial de eventos.
// Sin I/O. El módulo de notificaciones pregunta qué mostrar y a quién.

import { isInsumoLowStock } from './insumo-low-stock-alert.js';

export const NOTIFICATION_KINDS = Object.freeze({
  emissionFailed: 'emission_failed',
  insumoLowStock: 'insumo_low_stock',
  bandejaOverdue: 'bandeja_overdue',
  productSoldOut: 'product_sold_out',
  productLowStock: 'product_low_stock',
  marketplaceMutation: 'marketplace_mutation',
  stockDiscountFailed: 'stock_discount_failed',
});

export const PRODUCT_SOLD_OUT_WINDOW_DAYS = 7;
export const PRODUCT_HIGH_ROTATION_UNITS = 7;
export const PRODUCT_STOCK_LOOKBACK_DAYS = 30;
export const PRODUCT_LOW_STOCK_COVER_DAYS = 7;

export const NOTIFICATION_SEVERITIES = Object.freeze({
  critical: 'critical',
  warning: 'warning',
  success: 'success',
});

const KIND_PERMISSION = {
  [NOTIFICATION_KINDS.emissionFailed]: 'auto_emision',
  [NOTIFICATION_KINDS.insumoLowStock]: 'insumos',
  [NOTIFICATION_KINDS.bandejaOverdue]: 'orders_inbox',
  [NOTIFICATION_KINDS.productSoldOut]: ['productos', 'order_management'],
  [NOTIFICATION_KINDS.productLowStock]: ['productos', 'order_management'],
  [NOTIFICATION_KINDS.marketplaceMutation]: 'productos',
  [NOTIFICATION_KINDS.stockDiscountFailed]: 'productos',
};

const SEVERITY_RANK = {
  [NOTIFICATION_SEVERITIES.critical]: 0,
  [NOTIFICATION_SEVERITIES.warning]: 1,
  [NOTIFICATION_SEVERITIES.success]: 2,
};

export function notificationPermissionForKind(kind) {
  return KIND_PERMISSION[kind] || null;
}

function countLabel(value) {
  return Number(value).toLocaleString('es-PE');
}

function quantityLine(value, unit) {
  const amount = Number(value).toLocaleString('es-PE', { maximumFractionDigits: 2 });
  const suffix = String(unit || '').trim();
  return suffix ? `${amount} ${suffix}` : amount;
}

function isoOrNull(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function buildEmissionFailedNotification({ count = 0, updatedAt } = {}) {
  const total = Number(count) || 0;
  if (total < 1) return null;
  return {
    id: `emission_failed:${total}`,
    kind: NOTIFICATION_KINDS.emissionFailed,
    severity: NOTIFICATION_SEVERITIES.critical,
    permission: KIND_PERMISSION[NOTIFICATION_KINDS.emissionFailed],
    title: total === 1 ? 'Un comprobante no se emitió' : `${countLabel(total)} comprobantes no se emitieron`,
    body: 'Revisa Automatización y reintenta si corresponde.',
    href: '/auto-emision',
    moduleLabel: 'Automatización',
    count: total,
    createdAt: isoOrNull(updatedAt),
  };
}

export function buildInsumoLowStockNotification(insumo = {}) {
  if (!isInsumoLowStock(insumo)) return null;
  const id = Number(insumo.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const quantity = Number(insumo.quantityOnHand || 0);
  const empty = quantity <= 0;
  const name = String(insumo.name || '').trim() || 'Insumo';
  return {
    id: `insumo_low_stock:${id}:${quantity}`,
    kind: NOTIFICATION_KINDS.insumoLowStock,
    severity: empty ? NOTIFICATION_SEVERITIES.critical : NOTIFICATION_SEVERITIES.warning,
    permission: KIND_PERMISSION[NOTIFICATION_KINDS.insumoLowStock],
    title: empty ? `${name} se acabó` : `${name} está por reponer`,
    body: `Saldo ${quantityLine(quantity, insumo.unit)} · mínimo ${quantityLine(insumo.reorderPoint, insumo.unit)}.`,
    href: '/insumos',
    moduleLabel: 'Insumos',
    count: 1,
    createdAt: isoOrNull(insumo.updatedAt || insumo.updated_at),
  };
}

export function buildBandejaOverdueNotification({ count = 0, oldestAt } = {}) {
  const total = Number(count) || 0;
  if (total < 1) return null;
  return {
    id: `bandeja_overdue:${total}`,
    kind: NOTIFICATION_KINDS.bandejaOverdue,
    severity: NOTIFICATION_SEVERITIES.critical,
    permission: KIND_PERMISSION[NOTIFICATION_KINDS.bandejaOverdue],
    title: total === 1 ? 'Hay 1 pedido vencido' : `Hay ${countLabel(total)} pedidos vencidos`,
    body: 'El plazo de envío ya pasó. Ábrelos en Bandeja.',
    href: '/bandeja',
    moduleLabel: 'Bandeja',
    count: total,
    createdAt: isoOrNull(oldestAt),
  };
}

export function productAvailableQuantity(product = {}) {
  return Number(product.quantityOnHand || 0)
    - Number(product.quantityReserved || 0)
    - Number(product.quantityPendingReturn || 0);
}

export function isProductSoldOut(product) {
  if (!product) return false;
  if (String(product.status || 'active') !== 'active') return false;
  if (productAvailableQuantity(product) > 0) return false;
  return Number(product.unitsSold7d || 0) > 0 || Number(product.unitsSold30d || 0) > 0;
}

function unitsPhrase(units) {
  const count = countLabel(units);
  return units === 1 ? `${count} unidad` : `${count} unidades`;
}

export function buildProductSoldOutNotification(product = {}) {
  if (!isProductSoldOut(product)) return null;
  const id = Number(product.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const recentUnits = Number(product.unitsSold7d || 0);
  const units = recentUnits || Number(product.unitsSold30d || 0);
  const windowDays = recentUnits > 0 ? PRODUCT_SOLD_OUT_WINDOW_DAYS : PRODUCT_STOCK_LOOKBACK_DAYS;
  const name = String(product.name || product.mainSku || '').trim() || 'Producto';
  const sku = String(product.mainSku || '').trim();
  const high = recentUnits >= PRODUCT_HIGH_ROTATION_UNITS;
  const rotation = high
    ? `Se está vendiendo mucho: ${unitsPhrase(units)} en ${windowDays} días.`
    : `Vendió ${unitsPhrase(units)} en ${windowDays} días.`;
  return {
    id: `product_sold_out:${id}:${units}`,
    kind: NOTIFICATION_KINDS.productSoldOut,
    severity: high ? NOTIFICATION_SEVERITIES.critical : NOTIFICATION_SEVERITIES.warning,
    permission: KIND_PERMISSION[NOTIFICATION_KINDS.productSoldOut],
    title: `${name} se agotó`,
    body: sku && sku !== name ? `${sku} · ${rotation}` : rotation,
    href: '/productos',
    moduleLabel: 'Productos',
    count: 1,
    createdAt: isoOrNull(product.lastSoldAt || product.updatedAt || product.updated_at),
  };
}

export function buildProductLowStockNotification(product = {}) {
  const id = Number(product.id);
  const available = productAvailableQuantity(product);
  const dailySales = Math.max(
    Number(product.unitsSold7d || 0) / PRODUCT_SOLD_OUT_WINDOW_DAYS,
    Number(product.unitsSold30d || 0) / PRODUCT_STOCK_LOOKBACK_DAYS,
  );
  if (!Number.isInteger(id) || id <= 0 || String(product.status || 'active') !== 'active') return null;
  if (available <= 0 || dailySales <= 0) return null;
  const cover = available / dailySales;
  if (!Number.isFinite(cover) || cover > PRODUCT_LOW_STOCK_COVER_DAYS) return null;
  const severity = cover <= 3 ? NOTIFICATION_SEVERITIES.critical : NOTIFICATION_SEVERITIES.warning;
  const name = String(product.name || product.mainSku || '').trim() || 'Producto';
  const sku = String(product.mainSku || '').trim();
  const days = Math.ceil(cover);
  const coverage = cover < 1 ? 'menos de 1 día' : `${days} día${days === 1 ? '' : 's'}`;
  return {
    id: `product_low_stock:${id}:${available}:${severity}`,
    kind: NOTIFICATION_KINDS.productLowStock,
    severity,
    permission: KIND_PERMISSION[NOTIFICATION_KINDS.productLowStock],
    title: `${name} está por reponer`,
    body: `${sku && sku !== name ? `${sku} · ` : ''}Disponible ${unitsPhrase(available)} · cobertura estimada: ${coverage}. Revisa la reposición.`,
    href: '/productos',
    moduleLabel: 'Productos',
    count: 1,
    createdAt: isoOrNull(product.updatedAt || product.updated_at || product.lastSoldAt),
  };
}

export function buildStockDiscountFailedNotification({
  count = 0,
  unmatchedCount = 0,
  insufficientCount = 0,
  oldestAt,
} = {}) {
  const total = Number(count) || 0;
  if (total < 1) return null;
  const unmatched = Number(unmatchedCount) || 0;
  const insufficient = Number(insufficientCount) || 0;
  const other = Math.max(0, total - unmatched - insufficient);
  const reasons = [];
  if (insufficient > 0) reasons.push(`${countLabel(insufficient)} sin stock`);
  if (unmatched > 0) reasons.push(`${countLabel(unmatched)} sin producto maestro`);
  if (other > 0) reasons.push(`${countLabel(other)} con otro motivo`);
  return {
    id: `stock_discount_failed:${total}:${insufficient}:${unmatched}`,
    kind: NOTIFICATION_KINDS.stockDiscountFailed,
    severity: NOTIFICATION_SEVERITIES.critical,
    permission: KIND_PERMISSION[NOTIFICATION_KINDS.stockDiscountFailed],
    title: total === 1
      ? 'Un descuento de stock requiere atención'
      : `${countLabel(total)} descuentos de stock requieren atención`,
    body: reasons.length
      ? `${reasons.join(' · ')}. Repón stock o asigna el producto maestro en la cola.`
      : 'Revisa la cola y corrige los descuentos detenidos.',
    href: '/descuentos-stock',
    moduleLabel: 'Catálogo',
    count: total,
    createdAt: isoOrNull(oldestAt),
  };
}

export function collectLiveNotifications({
  failedEmissions = { count: 0 },
  lowInsumos = [],
  overdueBandeja = { count: 0 },
  stockProducts = [],
  stockDiscountFailures = { count: 0 },
} = {}) {
  const items = [];
  const emission = buildEmissionFailedNotification(failedEmissions);
  if (emission) items.push(emission);
  for (const insumo of lowInsumos) {
    const item = buildInsumoLowStockNotification(insumo);
    if (item) items.push(item);
  }
  const bandeja = buildBandejaOverdueNotification(overdueBandeja);
  if (bandeja) items.push(bandeja);
  for (const product of stockProducts) {
    const item = buildProductSoldOutNotification(product) || buildProductLowStockNotification(product);
    if (item) items.push(item);
  }
  const discounts = buildStockDiscountFailedNotification(stockDiscountFailures);
  if (discounts) items.push(discounts);
  return items;
}

export function notificationPermissionKeys(item) {
  const raw = item?.permission;
  return Array.isArray(raw) ? raw : raw ? [raw] : [];
}

export function filterNotificationsForUser(items, user, hasPermission) {
  return (items || []).filter((item) => (
    notificationPermissionKeys(item).some((key) => hasPermission(user, key))
  ));
}

export function applyNotificationState(items, stateById) {
  const states = stateById instanceof Map ? stateById : new Map();
  return (items || [])
    .map((item) => {
      const state = states.get(item.id);
      return {
        ...item,
        unread: !state?.readAt,
        dismissed: Boolean(state?.dismissedAt),
      };
    })
    .filter((item) => !item.dismissed);
}

export function sortNotifications(items) {
  return [...(items || [])].sort((left, right) => {
    const leftTime = Date.parse(left.createdAt || '') || 0;
    const rightTime = Date.parse(right.createdAt || '') || 0;
    const timeDelta = rightTime - leftTime;
    if (timeDelta) return timeDelta;
    const unreadDelta = Number(Boolean(right.unread)) - Number(Boolean(left.unread));
    if (unreadDelta) return unreadDelta;
    const severityDelta = (SEVERITY_RANK[left.severity] ?? 9) - (SEVERITY_RANK[right.severity] ?? 9);
    if (severityDelta) return severityDelta;
    return String(left.id || '').localeCompare(String(right.id || ''));
  });
}

export function unreadNotificationCount(items) {
  return (items || []).filter((item) => item.unread).length;
}

export function publicNotification(item) {
  if (!item) return null;
  return {
    id: item.id,
    kind: item.kind,
    severity: item.severity,
    title: item.title,
    body: item.body,
    href: item.href,
    moduleLabel: item.moduleLabel,
    count: item.count,
    createdAt: item.createdAt,
    unread: item.unread === true,
  };
}

export function parseNotificationIds(value) {
  const raw = Array.isArray(value) ? value : [value];
  return [...new Set(
    raw
      .map((entry) => String(entry || '').trim())
      .filter((entry) => entry.length > 0 && entry.length <= 160),
  )];
}
