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
  paidArrives: number | null;
  pendingArrives: number | null;
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
  paidArrives: number | null;
  pendingArrives: number | null;
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
  if (row?.arrives != null) return 'Lo que entra a tu cuenta.';
  return falabellaMoneyHint({ falabellaTake: null, sellers: row?.sellers });
}

export function paidMoneyHint(row?: { paidArrives?: number | null } | null) {
  if (row?.paidArrives == null) return pagosHint();
  return 'Ya está en tu cuenta.';
}

export function pendingMoneyHint(row?: { pendingArrives?: number | null } | null) {
  if (row?.pendingArrives == null) return pagosHint();
  return 'Aún no depositan.';
}

export function paidPendingCompact(row?: {
  paidArrives?: number | null;
  pendingArrives?: number | null;
} | null) {
  if (row?.paidArrives == null && row?.pendingArrives == null) return '';
  return `${formatSalesMoneyOrDash(row?.paidArrives)} pagado · ${formatSalesMoneyOrDash(row?.pendingArrives)} pendiente`;
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

export function paidShare(paid?: number | null, pending?: number | null) {
  const received = Number(paid || 0);
  const waiting = Number(pending || 0);
  const total = received + waiting;
  return total > 0 ? received / total : 0;
}

export function productSalesKpis(totals?: ProductSalesTotals | null) {
  const grossSales = Number(totals?.grossSales || 0);
  const unitsSold = Number(totals?.unitsSold || 0);
  const ordersCount = Number(totals?.ordersCount || 0);
  const falabellaTake = totals?.falabellaTake ?? null;
  const arrives = totals?.arrives ?? null;

  return [
    {
      key: 'grossSales' as const,
      label: 'Ventas brutas',
      why: `${formatSalesCount(unitsSold)} u · ${formatSalesCount(ordersCount)} pedidos.`,
      display: formatSalesMoney(grossSales),
      tone: 'neutral' as const,
      paid: null,
      pending: null,
    },
    {
      key: 'arrives' as const,
      label: 'Te llega',
      why: arrives == null ? pagosHint() : 'Lo que entra a tu cuenta.',
      display: formatSalesMoneyOrDash(arrives),
      tone: 'receive' as const,
      paid: totals?.paidArrives ?? null,
      pending: totals?.pendingArrives ?? null,
      take: falabellaTake,
    },
  ];
}

export function buyerIdentity(buyer: ProductSaleBuyer) {
  return buyer.documentNumber || buyer.email || 'Sin documento';
}
