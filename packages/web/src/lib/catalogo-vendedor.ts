// Catálogo del vendedor: lista paginada en servidor de productos activos con
// stock, precio y la Comisión que gana el vendedor por unidad vendida.

export type SalespersonProductStock = 'all' | 'inStock' | 'outOfStock';
export type SalespersonProductSortBy = 'name' | 'price' | 'commission' | 'stock';
export type SalespersonProductSortDir = 'asc' | 'desc';
export type SalespersonCommissionRule = 'catalog' | 'percent' | 'none';

export type SalespersonProductsFilter = {
  search?: string;
  stock?: SalespersonProductStock;
  sortBy?: SalespersonProductSortBy;
  sortDir?: SalespersonProductSortDir;
  limit?: number;
  offset?: number;
};

export type SalespersonProduct = {
  id: number;
  sku: string;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  price: number;
  available: number;
  commissionAmount: number | null;
  commissionRule: SalespersonCommissionRule;
};

export type SalespersonProductsResponse = {
  items: SalespersonProduct[];
  total: number;
  limit: number;
  offset: number;
  commissionPercent: number;
};

export const CATALOGO_VENDEDOR_PAGE_SIZE = 20;
export const CATALOGO_VENDEDOR_QUERY_KEY = 'salesperson-products';

export const STOCK_FILTER_OPTIONS: Array<{ value: SalespersonProductStock; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'inStock', label: 'Con stock' },
  { value: 'outOfStock', label: 'Sin stock' },
];

export const SORT_OPTIONS: Array<{ value: string; label: string; sortBy: SalespersonProductSortBy; sortDir: SalespersonProductSortDir }> = [
  { value: 'name:asc', label: 'Nombre (A–Z)', sortBy: 'name', sortDir: 'asc' },
  { value: 'commission:desc', label: 'Mayor ganancia', sortBy: 'commission', sortDir: 'desc' },
  { value: 'price:asc', label: 'Menor precio', sortBy: 'price', sortDir: 'asc' },
  { value: 'price:desc', label: 'Mayor precio', sortBy: 'price', sortDir: 'desc' },
  { value: 'stock:desc', label: 'Más stock', sortBy: 'stock', sortDir: 'desc' },
];

export type CatalogoVendedorState = {
  search: string;
  stock: SalespersonProductStock;
  sortBy: SalespersonProductSortBy;
  sortDir: SalespersonProductSortDir;
  pageIndex: number;
};

export const DEFAULT_CATALOGO_VENDEDOR_STATE: CatalogoVendedorState = {
  search: '',
  stock: 'all',
  sortBy: 'name',
  sortDir: 'asc',
  pageIndex: 0,
};

const SORT_COLUMNS = new Set<SalespersonProductSortBy>(['name', 'price', 'commission', 'stock']);

export function isSalespersonSortBy(value: unknown): value is SalespersonProductSortBy {
  return SORT_COLUMNS.has(value as SalespersonProductSortBy);
}

/** Filtro listo para la API: omite búsqueda vacía y el filtro de stock "Todos". */
export function salespersonProductsFilter(
  state: CatalogoVendedorState,
  pageSize = CATALOGO_VENDEDOR_PAGE_SIZE,
): SalespersonProductsFilter {
  const filter: SalespersonProductsFilter = {
    sortBy: state.sortBy,
    sortDir: state.sortDir,
    limit: pageSize,
    offset: Math.max(0, Math.floor(state.pageIndex)) * pageSize,
  };
  const search = state.search.trim();
  if (search) filter.search = search;
  if (state.stock !== 'all') filter.stock = state.stock;
  return filter;
}

export function catalogoVendedorKey(filter: SalespersonProductsFilter) {
  return [CATALOGO_VENDEDOR_QUERY_KEY, filter] as const;
}

/** Traduce el estado de orden de React Table al contrato de la API. */
export function sortingToQuery(sorting: ReadonlyArray<{ id: string; desc: boolean }>): {
  sortBy: SalespersonProductSortBy;
  sortDir: SalespersonProductSortDir;
} {
  const [sort] = sorting;
  if (!sort || !isSalespersonSortBy(sort.id)) {
    return { sortBy: DEFAULT_CATALOGO_VENDEDOR_STATE.sortBy, sortDir: DEFAULT_CATALOGO_VENDEDOR_STATE.sortDir };
  }
  return { sortBy: sort.id, sortDir: sort.desc ? 'desc' : 'asc' };
}

export function formatProductMoney(value: number | null | undefined) {
  const number = Number(value ?? 0);
  const safe = Number.isFinite(number) ? number : 0;
  try {
    return new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(safe);
  } catch {
    return `S/ ${safe.toFixed(2)}`;
  }
}

function formatPercent(value: number) {
  const rounded = Math.round(value * 100) / 100;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(2).replace(/0+$/, '')}%`;
}

export type CommissionDisplay = {
  amount: string;
  hint: string | null;
  title: string | undefined;
  empty: boolean;
};

/** Lo que gana el vendedor por unidad, con la regla que lo explica. */
export function commissionDisplay(
  product: Pick<SalespersonProduct, 'commissionAmount' | 'commissionRule'>,
  commissionPercent: number,
): CommissionDisplay {
  const amount = product.commissionAmount;
  if (product.commissionRule === 'none' || amount == null || !Number.isFinite(Number(amount))) {
    return { amount: '—', hint: null, title: 'Sin comisión configurada', empty: true };
  }
  if (product.commissionRule === 'percent') {
    const percent = Number(commissionPercent) || 0;
    return {
      amount: formatProductMoney(amount),
      hint: percent > 0 ? formatPercent(percent) : null,
      title: percent > 0 ? `${formatPercent(percent)} del precio de venta` : undefined,
      empty: false,
    };
  }
  return { amount: formatProductMoney(amount), hint: null, title: 'Comisión fija del producto', empty: false };
}

export type StockTone = 'ok' | 'low' | 'out';
export type StockDisplay = { label: string; out: boolean; tone: StockTone; value: number };

/** Hasta este número de unidades el stock se marca como "pocas unidades". */
export const LOW_STOCK_UNITS = 5;

const integer = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 0 });

export function stockDisplay(available: number | null | undefined): StockDisplay {
  const value = Math.floor(Number(available) || 0);
  if (value <= 0) return { label: 'Sin stock', out: true, tone: 'out', value: 0 };
  const tone: StockTone = value <= LOW_STOCK_UNITS ? 'low' : 'ok';
  return { label: `${integer.format(value)} ${value === 1 ? 'unidad' : 'unidades'}`, out: false, tone, value };
}

export function productCountLabel(total: number, stock: SalespersonProductStock, search: string) {
  const count = Math.max(0, Math.floor(Number(total) || 0));
  const noun = count === 1 ? 'producto' : 'productos';
  const parts = [`${integer.format(count)} ${noun}`];
  if (stock === 'inStock') parts.push('con stock');
  if (stock === 'outOfStock') parts.push('sin stock');
  const term = search.trim();
  if (term) parts.push(`para “${term}”`);
  return parts.join(' ');
}
