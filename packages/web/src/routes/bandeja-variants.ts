import type { LogisticsOrder } from './bandeja-prototype/shared';
import { groupLogisticsByUrgency, canMarkFalabellaReady, canPrintLogisticsLabel, logisticsChannelLabel, logisticsUrgency, LOGISTICS_URGENCIES } from '../lib/logistics-inbox';
import { sellerShortName } from '../lib/seller-name';

export const OPERATIONAL_VARIANTS = [
  { key: '1', name: 'Lista operativa' },
  { key: '2', name: 'Mosaico visual' },
  { key: '3', name: 'Por tienda' },
  { key: '4', name: 'Puesto de preparación' },
  { key: '5', name: 'Mesa de lotes' },
  { key: '6', name: 'Concepto visual' },
  { key: '7', name: 'Lista compacta' },
  { key: '8', name: 'Agenda de entrega' },
  { key: '9', name: 'Columnas por plazo' },
  { key: '10', name: 'Por canal' },
  { key: '11', name: 'Recogida por producto' },
  { key: '12', name: 'Por unidades' },
  { key: '13', name: 'Revisión de empaque' },
  { key: '14', name: 'Lote al pie' },
  { key: '15', name: 'Pedidos desplegables' },
  { key: '16', name: 'Acciones disponibles' },
] as const;
export type OperationalLayout = Exclude<typeof OPERATIONAL_VARIANTS[number]['key'], '6'>;
export function operationalLayout(value: string): OperationalLayout {
  const variant = OPERATIONAL_VARIANTS.find((entry) => entry.key === value);
  return variant && variant.key !== '6' ? variant.key : '1';
}
export function orderUnits(order: LogisticsOrder) {
  return order.items.reduce((sum, item) => sum + item.quantity, 0);
}
export function operationalGroups(orders: LogisticsOrder[], now: Date, layout: OperationalLayout) {
  const priority = groupLogisticsByUrgency(orders, now);
  const ordered = priority.flatMap((group) => group.orders);
  const groups = new Map<string, { key: string; label: string; orders: LogisticsOrder[] }>();
  for (const order of ordered) {
    let key: string = logisticsUrgency(order, now);
    let label = LOGISTICS_URGENCIES.find((entry) => entry.value === key)?.label || 'Pedidos';
    if (layout === '3') {
      key = `${order.companyId}|${order.companyName}`;
      label = sellerShortName(order.companyName);
    } else if (layout === '8') {
      const date = order.promisedShippingAt ? new Date(order.promisedShippingAt) : null;
      key = date && !Number.isNaN(date.getTime()) ? date.toISOString() : 'no-date';
      label = key === 'no-date' || !date ? 'Sin fecha de entrega' : new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(date);
    } else if (layout === '10') {
      key = order.channelCode;
      label = logisticsChannelLabel(key);
    } else if (layout === '11') {
      const item = order.items[0];
      key = order.items.length !== 1 ? 'multiple' : `${order.companyId}|${item.sku || item.shopSku || item.description}`;
      label = order.items.length !== 1 ? 'Pedidos con varios productos' : `${item.description} · ${sellerShortName(order.companyName)}`;
    } else if (layout === '12') {
      const units = orderUnits(order);
      key = units === 1 ? 'single' : 'multiple';
      label = units === 1 ? 'Una unidad' : 'Varias unidades · Revisa cantidades';
    } else if (layout === '16') {
      key = canMarkFalabellaReady(order) ? 'prepare' : canPrintLogisticsLabel(order) ? 'print' : 'other';
      label = key === 'prepare' ? 'Puedes marcar listos' : key === 'print' ? 'Puedes imprimir' : 'Sin acción disponible';
    }
    const group = groups.get(key) || { key, label, orders: [] };
    group.orders.push(order);
    groups.set(key, group);
  }
  const result = [...groups.values()].map((group) => ({ ...group, urgency: logisticsUrgency(group.orders[0], now) }));
  return layout === '8' ? result.sort((a, b) => a.key.localeCompare(b.key)) : result;
}

export const VISUAL_VARIANTS = [
  { key: '6', name: 'Concepto visual', src: '/design/bandeja-v6.png' },
  { key: '17', name: 'Imagen · Lista densa', src: '/design/bandeja-v17.png' },
  { key: '18', name: 'Imagen · Tablero por urgencia', src: '/design/bandeja-v18.png' },
  { key: '19', name: 'Imagen · Estación de empaque', src: '/design/bandeja-v19.png' },
  { key: '20', name: 'Imagen · Preparación por tienda', src: '/design/bandeja-v20.png' },
  { key: '21', name: 'Imagen · Revisión de impresión', src: '/design/bandeja-v21.png' },
];
export const ALL_BANDEJA_VARIANTS = [...OPERATIONAL_VARIANTS, ...VISUAL_VARIANTS.filter((variant) => variant.key !== '6')];
