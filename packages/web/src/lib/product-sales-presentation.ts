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

export type ProductSaleBuyerCompany = {
  companyId: number | null;
  companyName?: string | null;
  unitsBought: number;
  ordersCount: number;
  grossSales: number;
};

export type ProductSaleBuyerProduct = {
  productKey?: string | null;
  sku: string;
  name: string;
  unitsBought: number;
  grossSales: number;
};

export type ProductSaleBuyer = {
  buyerKey: string;
  name: string;
  documentNumber?: string | null;
  email?: string | null;
  phone?: string | null;
  tracked?: boolean;
  companies?: ProductSaleBuyerCompany[];
  products?: ProductSaleBuyerProduct[];
  ordersCount: number;
  unitsBought: number;
  grossSales: number;
  lastOrderedAt?: string | null;
};

export const TRACKED_BUYER_MIN_UNITS = 5;

export type ProductColumnFilters = {
  minGrossSales: string;
  minFalabellaTake: string;
  minArrives: string;
  payout: 'all' | 'paid' | 'pending';
};

export type BuyerColumnFilters = {
  name: string;
  document: string;
  phone: string;
  company: string;
  minUnits: string;
  minGrossSales: string;
};

export const EMPTY_PRODUCT_COLUMN_FILTERS: ProductColumnFilters = {
  minGrossSales: '',
  minFalabellaTake: '',
  minArrives: '',
  payout: 'all',
};

export const EMPTY_BUYER_COLUMN_FILTERS: BuyerColumnFilters = {
  name: '',
  document: '',
  phone: '',
  company: '',
  minUnits: '',
  minGrossSales: '',
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

export function isTrackedBuyer(buyer: Pick<ProductSaleBuyer, 'tracked' | 'unitsBought'>) {
  if (buyer.tracked != null) return Boolean(buyer.tracked);
  return Number(buyer.unitsBought || 0) > TRACKED_BUYER_MIN_UNITS;
}

export function splitSalesBuyers(buyers: ProductSaleBuyer[]) {
  const tracked: ProductSaleBuyer[] = [];
  const others: ProductSaleBuyer[] = [];
  for (const buyer of buyers) {
    (isTrackedBuyer(buyer) ? tracked : others).push(buyer);
  }
  return { tracked, others };
}

export function formatBuyerPhone(phone?: string | null) {
  const raw = String(phone || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 9) return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  return raw;
}

export function buyerPhoneDigits(phone?: string | null) {
  return String(phone || '').replace(/\D/g, '');
}

export function buyerPhoneLabel(buyer: Pick<ProductSaleBuyer, 'phone'>) {
  return formatBuyerPhone(buyer.phone) || 'Sin teléfono';
}

export function buyerCompanyNames(buyer: Pick<ProductSaleBuyer, 'companies'>) {
  return (buyer.companies || [])
    .map((company) => sellerShortName(company.companyName))
    .filter((name) => name && name !== 'Seller');
}

export function buyerCompaniesLabel(buyer: Pick<ProductSaleBuyer, 'companies'>) {
  const names = buyerCompanyNames(buyer);
  return names.length ? names.join(' · ') : 'Sin seller';
}

export function buyerProductsLabel(buyer: Pick<ProductSaleBuyer, 'products'>) {
  return (buyer.products || [])
    .map((product) => `${product.sku || product.name} · ${formatSalesCount(product.unitsBought)} u`)
    .join(' · ');
}

export function formatBuyerLastOrder(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('es-PE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'America/Lima',
  }).format(date);
}

export function parseMinAmount(value: string) {
  const raw = String(value || '').trim().replace(',', '.');
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function matchesMinAmount(actual: number | null | undefined, min: string) {
  const parsed = parseMinAmount(min);
  return parsed == null || Number(actual || 0) >= parsed;
}

export function textIncludes(haystack: string | null | undefined, needle: string) {
  const query = String(needle || '').trim().toLocaleLowerCase('es-PE');
  if (!query) return true;
  return String(haystack || '').toLocaleLowerCase('es-PE').includes(query);
}

export function hasProductColumnFilters(filters: ProductColumnFilters) {
  return Boolean(
    filters.minGrossSales.trim()
    || filters.minFalabellaTake.trim()
    || filters.minArrives.trim()
    || filters.payout !== 'all',
  );
}

export function hasBuyerColumnFilters(filters: BuyerColumnFilters) {
  return Object.values(filters).some((value) => String(value || '').trim() !== '');
}

export function matchesBuyerColumnFilters(buyer: ProductSaleBuyer, filters: BuyerColumnFilters) {
  const companyHaystack = [
    buyerCompaniesLabel(buyer),
    ...(buyer.companies || []).flatMap((company) => [company.companyName, sellerShortName(company.companyName)]),
  ].join(' ');
  return textIncludes(buyer.name, filters.name)
    && textIncludes(buyerIdentity(buyer), filters.document)
    && textIncludes([buyer.phone, formatBuyerPhone(buyer.phone)].filter(Boolean).join(' '), filters.phone)
    && textIncludes(companyHaystack, filters.company)
    && matchesMinAmount(buyer.unitsBought, filters.minUnits)
    && matchesMinAmount(buyer.grossSales, filters.minGrossSales);
}
