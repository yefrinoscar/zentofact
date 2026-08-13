import { useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ColumnDef, getCoreRowModel, type SortingState, useReactTable } from '@tanstack/react-table';
import { Boxes, Check, Copy, Eye, RefreshCw, Search, Store } from 'lucide-react';
import api from '../lib/api';
import { cn } from '../lib/cn';
import { todayInLima } from '../lib/documentDateRange';
import DayStrip from '../components/DayStrip';
import { Button } from '../components/ui/button';
import { DataTable, DataTableColumnHeader, DataTablePagination } from '../components/ui/data-table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';

type Company = {
  id: number;
  nombre?: string | null;
  nombreComercial?: string | null;
  razonSocial?: string | null;
  activo?: boolean;
};

type TodaySaleSeller = {
  companyId: number | null;
  companyName?: string | null;
  title?: string | null;
  sellerSku?: string | null;
  unitsSold: number;
  ordersCount: number;
};

type TodaySaleProduct = {
  productKey: string;
  productId: number | null;
  sku: string;
  name: string;
  imageUrl?: string | null;
  shopSku?: string | null;
  brand?: string | null;
  mapped: boolean;
  quantityOnHand: number | null;
  available: number | null;
  unitsSold: number;
  ordersCount: number;
  sellersCount: number;
  revenue: number;
  sellers: TodaySaleSeller[];
};

type TodaySalesResponse = {
  date: string;
  timezone: string;
  products: TodaySaleProduct[];
  totalCount: number;
  totals: {
    productsCount: number;
    unitsSold: number;
    ordersCount: number;
    sellersCount?: number;
    pendingDetailOrders?: number;
    sellers?: Array<{
      companyId: number | null;
      companyName?: string | null;
      unitsSold: number;
      ordersCount: number;
      productsCount: number;
    }>;
  };
  limit: number;
  offset: number;
};

const PAGE_SIZE = 20;
const SEARCH_DELAY_MS = 300;

function sellerShortName(value?: string | null) {
  const fallback = String(value || '').trim();
  if (!fallback) return 'Seller';
  return fallback
    .replace(/\s+(?:E\.?\s*I\.?\s*R\.?\s*L\.?|S\.?\s*R\.?\s*L\.?|S\.?\s*A\.?\s*C\.?)\.?$/i, '')
    .replace(/\s+PER[ÚU]$/i, '')
    .replace(/^(?:INVERSIONES|IMPORTACIONES|TIENDAS)\s+/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function companyName(company: Company) {
  return sellerShortName(company.nombreComercial || company.nombre || company.razonSocial || `Empresa ${company.id}`);
}

function formatNumber(value: unknown, digits = 4) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toLocaleString('es-PE', { maximumFractionDigits: digits });
}

function falabellaMediaUrl(shopSku?: string | null) {
  const sku = String(shopSku || '').trim();
  if (!sku || !/^[A-Za-z0-9_-]+$/.test(sku)) return '';
  return `https://media.falabella.com/falabellaPE/${sku}_01`;
}

function productImageSrc(url?: string | null, shopSku?: string | null) {
  const value = String(url || '').trim() || falabellaMediaUrl(shopSku);
  if (!value) return '';
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'https:' && /(^|\.)falabella\.com$/i.test(parsed.hostname)) {
      return `/catalog/image?url=${encodeURIComponent(value)}`;
    }
  } catch {
    return value;
  }
  return value;
}

function ProductThumb({
  url,
  shopSku,
  name,
  onOpen,
}: {
  url?: string | null;
  shopSku?: string | null;
  name: string;
  onOpen: (src: string, name: string) => void;
}) {
  const [failedSrc, setFailedSrc] = useState('');
  const src = productImageSrc(url, shopSku);
  if (!src || failedSrc === src) {
    return <span className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-muted"><Boxes className="h-4 w-4" /></span>;
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(src, name)}
      className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-muted"
      aria-label={`Ver foto de ${name}`}
      title="Ver foto grande"
    >
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailedSrc(src)}
        className="h-full w-full object-cover transition group-hover:scale-105"
      />
    </button>
  );
}

export default function ProductosHoy() {
  const queryClient = useQueryClient();
  const limaToday = todayInLima();
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [date, setDate] = useState(limaToday);
  const [companyId, setCompanyId] = useState('all');
  const [copiedSku, setCopiedSku] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  const [detailProduct, setDetailProduct] = useState<TodaySaleProduct | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState('');
  const [sorting, setSorting] = useState<SortingState>([{ id: 'units', desc: true }]);
  const searchTimer = useRef(0);
  const sortBy = sorting[0]?.id || 'units';
  const sortDir = sorting[0]?.desc === false ? 'asc' : 'desc';

  const filters = useMemo(() => ({
    date,
    search: submittedSearch,
    companyId: companyId === 'all' ? undefined : Number(companyId),
    sortBy,
    sortDir,
    offset,
  }), [date, submittedSearch, companyId, sortBy, sortDir, offset]);

  const salesQuery = useQuery({
    queryKey: ['today-product-sales', filters],
    queryFn: () => api.listTodayProductSales({
      date: filters.date,
      search: filters.search,
      companyId: filters.companyId,
      sortBy: filters.sortBy,
      sortDir: filters.sortDir,
      limit: PAGE_SIZE,
      offset: filters.offset,
    }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: 1,
  });
  const companiesQuery = useQuery({
    queryKey: ['catalog-companies'],
    queryFn: () => api.listCompanies(),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const companies = useMemo(
    () => ((companiesQuery.data || []) as Company[]).filter((company) => company.activo !== false),
    [companiesQuery.data],
  );
  const payload = salesQuery.data as TodaySalesResponse | undefined;
  const products = payload?.products || [];
  const totalCount = Number(payload?.totalCount || 0);
  const totals = payload?.totals || {
    productsCount: 0,
    unitsSold: 0,
    ordersCount: 0,
    sellersCount: 0,
    pendingDetailOrders: 0,
    sellers: [],
  };
  const pendingDetailOrders = Number(totals.pendingDetailOrders || 0);
  const sellerTotals = totals.sellers || [];
  const sellersCount = Number(totals.sellersCount ?? sellerTotals.length);
  const queryError = salesQuery.error || companiesQuery.error;
  const visibleError = queryError instanceof Error ? queryError.message : queryError ? 'No se pudieron cargar las salidas.' : '';
  const pageIndex = Math.floor(offset / PAGE_SIZE);
  const dataLoading = salesQuery.isPending || (salesQuery.isFetching && payload?.date !== date);

  const applySearch = (value: string, immediate = false) => {
    setSearch(value);
    window.clearTimeout(searchTimer.current);
    const commit = () => {
      setSubmittedSearch(value.trim());
      setOffset(0);
    };
    if (immediate) commit();
    else searchTimer.current = window.setTimeout(commit, SEARCH_DELAY_MS);
  };

  const prefetchPage = (nextOffset: number) => {
    if (nextOffset < 0 || nextOffset >= totalCount) return;
    void queryClient.prefetchQuery({
      queryKey: ['today-product-sales', { ...filters, offset: nextOffset }],
      queryFn: () => api.listTodayProductSales({
        date: filters.date,
        search: filters.search,
        companyId: filters.companyId,
        sortBy: filters.sortBy,
        sortDir: filters.sortDir,
        limit: PAGE_SIZE,
        offset: nextOffset,
      }),
      staleTime: 15_000,
    });
  };

  const refreshFromFalabella = async () => {
    setRefreshing(true);
    setRefreshNote('');
    try {
      const result = await api.refreshTodayProductSales({
        date: filters.date,
        search: filters.search,
        companyId: filters.companyId,
        sortBy: filters.sortBy,
        sortDir: filters.sortDir,
        limit: PAGE_SIZE,
        offset: filters.offset,
      });
      queryClient.setQueryData(['today-product-sales', filters], result);
      await queryClient.invalidateQueries({ queryKey: ['today-product-sales'] });
      const live = result?.hydration?.live;
      const hydrated = Number(result?.hydration?.hydrated || 0);
      setRefreshNote(live?.failed
        ? `Falabella incompleto · ${hydrated} pedidos nuevos en la base local.`
        : `Falabella ${live?.windowDays || 2} días · ${hydrated} pedidos hidratados.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo actualizar Falabella.';
      setRefreshNote(message.toLowerCase().includes('csrf')
        ? 'No se pudo actualizar. Recarga la página e inténtalo de nuevo.'
        : message);
    } finally {
      setRefreshing(false);
    }
  };

  const columns = useMemo<ColumnDef<TodaySaleProduct>[]>(() => [
    {
      id: 'product',
      accessorFn: (product) => product.name,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Producto" />,
      cell: ({ row }) => {
        const product = row.original;
        return <div className="flex items-center gap-3">
          <ProductThumb
            url={product.imageUrl}
            shopSku={product.shopSku}
            name={product.name}
            onOpen={(src, name) => setPreview({ url: src, name })}
          />
          <span className="min-w-0 flex-1">
            <strong className="block whitespace-normal break-words text-sm leading-5">{product.name}</strong>
            <button
              type="button"
              title="Copiar SKU"
              aria-label={`Copiar SKU ${product.sku}`}
              onClick={async () => {
                await navigator.clipboard.writeText(product.sku);
                setCopiedSku(product.sku);
                window.setTimeout(() => setCopiedSku((current) => current === product.sku ? null : current), 1400);
              }}
              className="mt-1 inline-flex items-center gap-1.5 font-mono text-xs font-semibold tracking-wide text-muted-foreground hover:text-foreground"
            >{product.sku}{copiedSku === product.sku ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}</button>
          </span>
        </div>;
      },
    },
    {
      id: 'units',
      accessorFn: (product) => product.unitsSold,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Vendidas" />,
      cell: ({ row }) => <div>
        <p className="text-lg font-semibold leading-none tabular-nums">{formatNumber(row.original.unitsSold, 0)}</p>
        <p className="mt-1 text-xs text-muted-foreground">{formatNumber(row.original.ordersCount, 0)} pedidos</p>
      </div>,
    },
    {
      id: 'stock',
      accessorFn: (product) => product.quantityOnHand,
      header: ({ column }) => <DataTableColumnHeader column={column} title="En almacén" />,
      cell: ({ row }) => {
        const product = row.original;
        if (!product.mapped || product.quantityOnHand == null) {
          return <span className="text-sm text-muted-foreground">Sin catálogo</span>;
        }
        const stock = Number(product.quantityOnHand);
        return <div>
          <p className="text-sm font-semibold tabular-nums">{formatNumber(stock)} u</p>
          <p className="mt-1 text-xs text-muted-foreground">disp. {formatNumber(product.available)}</p>
        </div>;
      },
    },
    {
      id: 'detail',
      enableSorting: false,
      header: () => <span>Detalle</span>,
      cell: ({ row }) => {
        const product = row.original;
        return <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">
            {product.sellersCount} {product.sellersCount === 1 ? 'seller' : 'sellers'}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-11 rounded-full"
            onClick={() => setDetailProduct(product)}
            aria-label={`Ver detalle de sellers de ${product.name}`}
            title="Ver detalle"
          >
            <Eye className="size-4.5" />
          </Button>
        </div>;
      },
    },
  ], [copiedSku]);

  const table = useReactTable({
    data: products,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (product) => product.productKey,
    manualPagination: true,
    manualSorting: true,
    enableMultiSort: false,
    rowCount: totalCount,
    onSortingChange: (updater) => {
      setOffset(0);
      setSorting(updater);
    },
    state: {
      sorting,
      pagination: {
        pageIndex: Math.floor(offset / PAGE_SIZE),
        pageSize: PAGE_SIZE,
      },
    },
  });

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-xl border border-border bg-card" aria-label="Indicadores de salidas">
        <div className="grid grid-cols-2 md:grid-cols-4">
          <SaleMetric
            index={0}
            label="Unidades vendidas"
            value={formatNumber(totals.unitsSold, 0)}
            detail="Según plazo de envío"
            loading={dataLoading}
          />
          <SaleMetric
            index={1}
            label="Pedidos"
            value={formatNumber(totals.ordersCount, 0)}
            detail={pendingDetailOrders > 0 ? `${formatNumber(pendingDetailOrders, 0)} sin detalle` : 'Con salida en esta fecha'}
            loading={dataLoading}
            warning={pendingDetailOrders > 0}
          />
          <SaleMetric
            index={2}
            label="Productos"
            value={formatNumber(totals.productsCount, 0)}
            detail={totals.productsCount === 1 ? 'SKU con venta' : 'SKUs con venta'}
            loading={dataLoading}
          />
          <SaleMetric
            index={3}
            label="Sellers"
            value={formatNumber(sellersCount, 0)}
            detail={sellersCount === 1 ? 'Seller con venta' : 'Sellers con venta'}
            loading={dataLoading}
          />
        </div>
      </section>

      <div className="space-y-3">
        <DayStrip value={date} onChange={(next) => { setDate(next); setOffset(0); }} />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => applySearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  applySearch(search, true);
                }
              }}
              placeholder="Buscar SKU, producto o seller"
              className="h-9 pl-9"
              aria-label="Buscar SKU, producto o seller"
            />
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Select value={companyId} onValueChange={(value) => { setCompanyId(value); setOffset(0); }}>
              <SelectTrigger className="w-44 border-border bg-background"><SelectValue placeholder="Todos los sellers" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los sellers</SelectItem>
                {companies.map((company) => <SelectItem key={company.id} value={String(company.id)}>{companyName(company)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => void refreshFromFalabella()}
              disabled={refreshing}
              aria-label="Actualizar pedidos recientes de Falabella"
              title="Consulta Falabella solo de los últimos 2 días y lee el resto desde la base local"
            >
              <RefreshCw className={cn(refreshing && 'animate-spin')} />
            </Button>
          </div>
        </div>
        {refreshNote && <p className="text-xs text-muted-foreground">{refreshNote}</p>}
      </div>

      {visibleError && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{visibleError}</div>}

      <DataTable
        table={table}
        aria-label="Productos con salida en esta fecha"
        loading={dataLoading}
        fetching={salesQuery.isFetching}
        columnClassNames={{
          product: 'w-[52%]',
          units: 'w-[16%]',
          stock: 'w-[16%]',
          detail: 'w-[16%]',
        }}
        cellClassNames={{
          product: 'whitespace-normal',
        }}
        empty={<div className="px-5 py-14 text-center">
          <p className="text-sm font-medium">{pendingDetailOrders > 0 ? 'Faltan detalles de pedidos de hoy' : 'Sin salidas en esta fecha'}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {pendingDetailOrders > 0
              ? `Hay ${formatNumber(pendingDetailOrders, 0)} pedidos de hoy sin líneas. Pulsa actualizar para traer el detalle de Falabella.`
              : 'Solo cuenta pedidos cuyo PromisedShippingTime cae en este día. Pulsa actualizar si faltan líneas.'}
          </p>
        </div>}
        footer={!dataLoading && totalCount > 0 ? <DataTablePagination
          pageIndex={pageIndex}
          pageSize={PAGE_SIZE}
          totalCount={totalCount}
          fetching={salesQuery.isFetching}
          onPageChange={(nextPage) => setOffset(nextPage * PAGE_SIZE)}
          onPrefetch={(nextPage) => prefetchPage(nextPage * PAGE_SIZE)}
        /> : undefined}
      />

      <SellerDetailDialog
        product={detailProduct}
        onClose={() => setDetailProduct(null)}
      />

      <Dialog open={preview != null} onOpenChange={(open) => { if (!open) setPreview(null); }}>
        <DialogContent className="max-w-3xl gap-3 p-4 sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="pr-8">{preview?.name || 'Foto del producto'}</DialogTitle>
            <DialogDescription>Foto del producto que sale hoy.</DialogDescription>
          </DialogHeader>
          {preview?.url ? (
            <img src={preview.url} alt={preview.name} className="max-h-[75vh] w-full rounded-lg object-contain bg-muted" />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SellerDetailDialog({
  product,
  onClose,
}: {
  product: TodaySaleProduct | null;
  onClose: () => void;
}) {
  const sellers = useMemo(() => [...(product?.sellers || [])].sort((left, right) => {
    const unitsDifference = Number(right.unitsSold) - Number(left.unitsSold);
    if (unitsDifference !== 0) return unitsDifference;
    return sellerShortName(left.companyName).localeCompare(sellerShortName(right.companyName), 'es');
  }), [product]);

  return (
    <Dialog open={product != null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[min(82vh,760px)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border px-5 py-5 pr-16 sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
              <Boxes className="size-4.5" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-base leading-6">{product?.name || 'Detalle del producto'}</DialogTitle>
              <DialogDescription className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-mono text-xs font-semibold tracking-wide">{product?.sku}</span>
                <span aria-hidden="true">·</span>
                <span>{formatNumber(product?.unitsSold, 0)} unidades</span>
                <span aria-hidden="true">·</span>
                <span>{formatNumber(product?.ordersCount, 0)} pedidos</span>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <section className="min-h-0 overflow-y-auto" aria-label="Sellers con ventas">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-popover/95 px-5 py-3 backdrop-blur sm:px-6">
            <div>
              <h3 className="text-sm font-semibold">Sellers con ventas</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">Ordenados por unidades vendidas</p>
            </div>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold tabular-nums text-muted-foreground">
              {sellers.length}
            </span>
          </div>

          {sellers.length ? (
            <ol className="divide-y divide-border">
              {sellers.map((seller) => {
                const name = sellerShortName(seller.companyName);
                const sellerTitle = seller.title && seller.title !== product?.name ? seller.title : '';
                return (
                  <li
                    key={`${seller.companyId || 'x'}-${seller.sellerSku || seller.title || ''}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 px-5 py-4 sm:px-6"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-secondary-foreground">
                        <Store className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold leading-5">{name}</p>
                        {sellerTitle ? <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">{sellerTitle}</p> : null}
                        {seller.sellerSku ? (
                          <p className="mt-1.5 break-all font-mono text-xs text-muted-foreground">SKU {seller.sellerSku}</p>
                        ) : null}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-base font-semibold tabular-nums">{formatNumber(seller.unitsSold, 0)} u</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatNumber(seller.ordersCount, 0)} {seller.ordersCount === 1 ? 'pedido' : 'pedidos'}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="px-6 py-12 text-center">
              <Store className="mx-auto size-6 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">Sin sellers para mostrar</p>
            </div>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}

function SaleMetric({
  index,
  label,
  value,
  detail,
  loading = false,
  warning = false,
}: {
  index: number;
  label: string;
  value: string;
  detail?: string;
  loading?: boolean;
  warning?: boolean;
}) {
  return (
    <div className={cn(
      'min-w-0 px-4 py-3 sm:px-5',
      index % 2 === 0 && 'border-r border-border',
      index < 2 && 'border-b border-border md:border-b-0',
      'md:border-r md:last:border-r-0',
    )}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      {loading
        ? <div className="mt-2 h-7 w-16 animate-pulse rounded-md bg-muted" />
        : <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>}
      {detail
        ? <p className={cn('mt-1 truncate text-xs', warning ? 'font-medium text-amber-700' : 'text-muted-foreground')}>{detail}</p>
        : null}
    </div>
  );
}
