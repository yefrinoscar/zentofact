import { sellerShortName } from './seller-name.ts';

export type ProductSaleSeller = {
  companyId: number | null;
  companyName?: string | null;
  channelCode?: string | null;
  channelCodes?: string[] | null;
  title?: string | null;
  sellerSku?: string | null;
  shopSku?: string | null;
  published: boolean;
  unitsSold: number;
  ordersCount: number;
  grossSales: number;
  falabellaTake: number | null;
  arrives: number | null;
  visits: number | null;
};

export type ProductSaleRow = {
  productKey: string;
  productId: number | null;
  sku: string;
  name: string;
  imageUrl?: string | null;
  brand?: string | null;
  mapped?: boolean;
  published: boolean;
  unitsSold: number;
  ordersCount: number;
  sellersCount: number;
  grossSales: number;
  falabellaTake: number | null;
  arrives: number | null;
  visits: number | null;
  sellers: ProductSaleSeller[];
};

export type ProductSaleBuyer = {
  buyerKey: string;
  name: string;
  documentNumber?: string | null;
  email?: string | null;
  ordersCount: number;
  unitsBought: number;
  grossSales: number;
  lastOrderedAt?: string | null;
};

export type ProductSalesTotals = {
  productsCount: number;
  unitsSold: number;
  ordersCount: number;
  sellersCount: number;
  buyersCount: number;
  grossSales: number;
  falabellaTake: number | null;
  arrives: number | null;
  paidArrives: number | null;
  pendingArrives: number | null;
  settlementOrders: number;
  averageTicket: number;
  visits: number | null;
};

const money = new Intl.NumberFormat('es-PE', {
  style: 'currency',
  currency: 'PEN',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const integer = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 0 });

export function formatSalesMoney(value: number | null | undefined) {
  return money.format(Number(value || 0));
}

export function formatSalesMoneyOrDash(value: number | null | undefined) {
  return value == null ? '—' : formatSalesMoney(value);
}

export function pagosHint() {
  return 'Cruza Pagos para verlo.';
}

function channelCodesOf(row?: {
  channelCode?: string | null;
  channelCodes?: string[] | null;
  sellers?: Array<Pick<ProductSaleSeller, 'channelCode' | 'channelCodes'>>;
} | null) {
  const own = row?.channelCodes?.length ? row.channelCodes : row?.channelCode ? [row.channelCode] : [];
  const nested = (row?.sellers || []).flatMap((seller) => (
    seller.channelCodes?.length ? seller.channelCodes : seller.channelCode ? [seller.channelCode] : []
  ));
  return [...own, ...nested];
}

export function falabellaMoneyHint(row?: {
  falabellaTake?: number | null;
  channelCode?: string | null;
  channelCodes?: string[] | null;
  sellers?: Array<Pick<ProductSaleSeller, 'channelCode' | 'channelCodes'>>;
} | null) {
  if (row?.falabellaTake != null) return 'Comisión y logística.';
  const channels = channelCodesOf(row);
  if (channels.length && channels.every((code) => String(code || '').toLowerCase() !== 'falabella')) {
    return 'Sin cobro de Falabella.';
  }
  return pagosHint();
}

export function arrivesMoneyHint(row?: {
  arrives?: number | null;
  sellers?: Array<Pick<ProductSaleSeller, 'channelCode' | 'channelCodes'>>;
} | null) {
  if (row?.arrives != null) return 'Lo que te depositan.';
  return falabellaMoneyHint({ falabellaTake: null, sellers: row?.sellers });
}

export function formatSalesCount(value: number | null | undefined) {
  return integer.format(Number(value || 0));
}

export function formatVisits(value: number | null | undefined) {
  return value == null ? '—' : integer.format(value);
}

export function visitsHint() {
  return 'El canal no envía visitas.';
}

export function publishedLabel(published: boolean) {
  return published ? 'Sí' : 'No';
}

export function channelLabel(value?: string | null) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'falabella') return 'Falabella';
  if (normalized === 'ripley') return 'Ripley';
  if (normalized === 'manual') return 'Manual';
  if (normalized === 'mercado_libre') return 'Mercado Libre';
  return normalized ? normalized : 'Canal';
}

export function sellerChannelLabel(seller: Pick<ProductSaleSeller, 'channelCode' | 'channelCodes'>) {
  const codes = (seller.channelCodes && seller.channelCodes.length
    ? seller.channelCodes
    : seller.channelCode ? [seller.channelCode] : [])
    .filter(Boolean);
  return codes.map((code) => channelLabel(code)).join(' · ') || 'Canal';
}

export function sellerSalesLabel(seller: Pick<ProductSaleSeller, 'companyName'>) {
  return sellerShortName(seller.companyName);
}

function arrivesWhy(totals?: ProductSalesTotals | null) {
  const paid = totals?.paidArrives;
  const pending = totals?.pendingArrives;
  if (totals?.arrives == null) return pagosHint();
  if (paid != null && pending != null && pending > 0 && paid > 0) return 'Pagado y pendiente.';
  if (pending != null && pending > 0 && !(paid && paid > 0)) return 'Aún no depositan.';
  if (paid != null && paid > 0) return 'Ya está en tu cuenta.';
  return 'Lo que te depositan.';
}

export function productSalesKpis(totals?: ProductSalesTotals | null) {
  const grossSales = Number(totals?.grossSales || 0);
  const unitsSold = Number(totals?.unitsSold || 0);
  const ordersCount = Number(totals?.ordersCount || 0);
  const averageTicket = Number(totals?.averageTicket || 0);
  const falabellaTake = totals?.falabellaTake ?? null;
  const arrives = totals?.arrives ?? null;

  return [
    {
      key: 'grossSales' as const,
      group: 'Dinero',
      label: 'Ventas brutas',
      why: 'Suma Falabella del maestro.',
      display: formatSalesMoney(grossSales),
    },
    {
      key: 'falabella' as const,
      group: 'Dinero',
      label: 'Falabella',
      why: falabellaTake == null ? pagosHint() : 'Comisión y logística.',
      display: formatSalesMoneyOrDash(falabellaTake),
    },
    {
      key: 'arrives' as const,
      group: 'Dinero',
      label: 'Te llega',
      why: arrivesWhy(totals),
      display: formatSalesMoneyOrDash(arrives),
    },
    {
      key: 'units' as const,
      group: 'Ritmo',
      label: 'Unidades',
      why: 'Piezas que salieron.',
      display: `${formatSalesCount(unitsSold)} u`,
    },
    {
      key: 'orders' as const,
      group: 'Ritmo',
      label: 'Pedidos',
      why: 'Pedidos con venta.',
      display: formatSalesCount(ordersCount),
    },
    {
      key: 'ticket' as const,
      group: 'Ritmo',
      label: 'Ticket',
      why: 'Promedio por pedido.',
      display: formatSalesMoney(averageTicket),
    },
  ];
}

export function buyerIdentity(buyer: ProductSaleBuyer) {
  return buyer.documentNumber || buyer.email || 'Sin documento';
}
