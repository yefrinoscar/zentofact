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

export function productSalesKpis(totals?: ProductSalesTotals | null) {
  const grossSales = Number(totals?.grossSales || 0);
  const unitsSold = Number(totals?.unitsSold || 0);
  const ordersCount = Number(totals?.ordersCount || 0);
  const averageTicket = Number(totals?.averageTicket || 0);
  const productsCount = Number(totals?.productsCount || 0);
  const buyersCount = Number(totals?.buyersCount || 0);

  return [
    {
      key: 'grossSales' as const,
      group: 'Periodo',
      label: 'Ventas brutas',
      why: 'Lo vendido en el periodo.',
      display: formatSalesMoney(grossSales),
    },
    {
      key: 'units' as const,
      group: 'Periodo',
      label: 'Unidades',
      why: 'Piezas que salieron.',
      display: `${formatSalesCount(unitsSold)} u`,
    },
    {
      key: 'orders' as const,
      group: 'Periodo',
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
    {
      key: 'products' as const,
      group: 'Ritmo',
      label: 'Productos',
      why: 'SKUs que vendieron.',
      display: formatSalesCount(productsCount),
    },
    {
      key: 'buyers' as const,
      group: 'Ritmo',
      label: 'Compradores',
      why: 'Clientes que compraron.',
      display: formatSalesCount(buyersCount),
    },
  ];
}

export function buyerIdentity(buyer: ProductSaleBuyer) {
  return buyer.documentNumber || buyer.email || 'Sin documento';
}
