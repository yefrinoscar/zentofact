import { FormEvent, useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ColumnDef, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { Boxes, Check, ChevronLeft, ChevronRight, Copy, Loader2, RefreshCw, Search, X } from 'lucide-react';
import api from '../lib/api';
import { cn } from '../lib/cn';
import { todayInLima } from '../lib/documentDateRange';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';

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

const PAGE_SIZE = 50;

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

function productImageSrc(url?: string | null) {
  const value = String(url || '').trim();
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
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState('');

  const filters = useMemo(() => ({
    date,
    search: submittedSearch,
    companyId: companyId === 'all' ? undefined : Number(companyId),
    offset,
  }), [date, submittedSearch, companyId, offset]);

  const salesQuery = useQuery({
    queryKey: ['today-product-sales', filters],
    queryFn: () => api.listTodayProductSales({
      date: filters.date,
      search: filters.search,
      companyId: filters.companyId,
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
  const topSellerNames = sellerTotals
    .map((seller) => sellerShortName(seller.companyName))
    .filter(Boolean);
  const sellersDetail = topSellerNames.length
    ? `${topSellerNames.slice(0, 3).join(' · ')}${topSellerNames.length > 3 ? ` +${topSellerNames.length - 3}` : ''}`
    : 'Sin sellers en esta fecha';
  const queryError = salesQuery.error || companiesQuery.error;
  const visibleError = queryError instanceof Error ? queryError.message : queryError ? 'No se pudieron cargar las salidas.' : '';

  const applySearch = (event: FormEvent) => {
    event.preventDefault();
    setOffset(0);
    setSubmittedSearch(search.trim());
  };

  const clearFilters = () => {
    setSearch('');
    setSubmittedSearch('');
    setCompanyId('all');
    setDate(limaToday);
    setOffset(0);
  };

  const prefetchPage = (nextOffset: number) => {
    if (nextOffset < 0 || nextOffset >= totalCount) return;
    void queryClient.prefetchQuery({
      queryKey: ['today-product-sales', { ...filters, offset: nextOffset }],
      queryFn: () => api.listTodayProductSales({
        date: filters.date,
        search: filters.search,
        companyId: filters.companyId,
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
      setRefreshNote(error instanceof Error ? error.message : 'No se pudo actualizar Falabella.');
    } finally {
      setRefreshing(false);
    }
  };

  const columns = useMemo<ColumnDef<TodaySaleProduct>[]>(() => [
    {
      id: 'product',
      header: 'Producto',
      cell: ({ row }) => {
        const product = row.original;
        return <div className="flex items-center gap-3">
          {product.imageUrl
            ? <button
                type="button"
                onClick={() => setPreview({ url: productImageSrc(product.imageUrl), name: product.name })}
                className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-muted"
                aria-label={`Ver foto de ${product.name}`}
                title="Ver foto grande"
              >
                <img src={productImageSrc(product.imageUrl)} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover transition group-hover:scale-105" />
              </button>
            : <span className="grid h-16 w-16 shrink-0 place-items-center rounded-lg bg-muted"><Boxes className="h-4 w-4" /></span>}
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
      header: 'Vendidas',
      cell: ({ row }) => <div>
        <p className="text-lg font-semibold leading-none tabular-nums">{formatNumber(row.original.unitsSold, 0)}</p>
        <p className="mt-1 text-xs text-muted-foreground">{formatNumber(row.original.ordersCount, 0)} pedidos</p>
      </div>,
    },
    {
      id: 'stock',
      header: 'En almacén',
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
      id: 'sellers',
      header: 'Sellers',
      cell: ({ row }) => {
        const sellers = row.original.sellers;
        if (!sellers.length) return <span className="text-sm text-muted-foreground">—</span>;
        return <ul className="space-y-2">
          {sellers.map((seller) => (
            <li key={`${seller.companyId || 'x'}-${seller.sellerSku || seller.title || ''}`} className="min-w-0">
              <p className="line-clamp-2 text-sm font-medium leading-5">{sellerShortName(seller.companyName)}</p>
              <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-muted-foreground">
                {formatNumber(seller.unitsSold, 0)} u
                {seller.title && seller.title !== row.original.name ? ` · ${seller.title}` : ''}
              </p>
            </li>
          ))}
        </ul>;
      },
    },
  ], [copiedSku]);

  const table = useReactTable({
    data: products,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (product) => product.productKey,
    manualPagination: true,
    rowCount: totalCount,
    state: {
      pagination: {
        pageIndex: Math.floor(offset / PAGE_SIZE),
        pageSize: PAGE_SIZE,
      },
    },
  });

  const filtersActive = submittedSearch || companyId !== 'all' || date !== limaToday;

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-xl border border-border bg-card" aria-label="Indicadores de salidas">
        <div className="grid grid-cols-2 md:grid-cols-4">
          <SaleMetric
            index={0}
            label="Unidades vendidas"
            value={formatNumber(totals.unitsSold, 0)}
            detail="Según plazo de envío"
            loading={salesQuery.isPending}
          />
          <SaleMetric
            index={1}
            label="Pedidos"
            value={formatNumber(totals.ordersCount, 0)}
            detail={pendingDetailOrders > 0 ? `${formatNumber(pendingDetailOrders, 0)} sin detalle` : 'Con salida en esta fecha'}
            loading={salesQuery.isPending}
            warning={pendingDetailOrders > 0}
          />
          <SaleMetric
            index={2}
            label="Productos"
            value={formatNumber(totals.productsCount, 0)}
            detail={totals.productsCount === 1 ? 'SKU con venta' : 'SKUs con venta'}
            loading={salesQuery.isPending}
          />
          <SaleMetric
            index={3}
            label="Sellers"
            value={formatNumber(sellersCount, 0)}
            detail={sellersDetail}
            loading={salesQuery.isPending}
          />
        </div>
        {sellerTotals.length > 1 && (
          <ul className="flex gap-2 overflow-x-auto border-t border-border px-4 py-2.5" aria-label="Unidades por seller">
            {sellerTotals.map((seller) => {
              const id = seller.companyId == null ? '' : String(seller.companyId);
              return (
                <li key={id || seller.companyName || 'seller'}>
                  <button
                    type="button"
                    disabled={!id}
                    onClick={() => { setCompanyId(id); setOffset(0); }}
                    className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground disabled:cursor-default"
                    aria-label={`Ver solo ${sellerShortName(seller.companyName)}`}
                  >
                    <span className="text-foreground">{sellerShortName(seller.companyName)}</span>
                    {' · '}
                    {formatNumber(seller.unitsSold, 0)} u
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="space-y-3 border-b border-border pb-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <form onSubmit={applySearch} className="flex min-w-0 flex-1 gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar SKU, producto o nombre del seller" className="field h-9 pl-9" />
            </div>
            <button type="submit" className="secondary-button"><Search className="h-4 w-4" /> Buscar</button>
            <button type="button" onClick={() => void refreshFromFalabella()} disabled={refreshing} className="secondary-button px-2.5" aria-label="Actualizar pedidos recientes de Falabella" title="Consulta Falabella solo de los últimos 2 días y lee el resto desde la base local">
              <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
            </button>
          </form>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={date}
            max={limaToday}
            onChange={(event) => { setDate(event.target.value || limaToday); setOffset(0); }}
            className="field h-9 w-40"
            aria-label="Fecha de salida"
          />
          <Select value={companyId} onValueChange={(value) => { setCompanyId(value); setOffset(0); }}>
            <SelectTrigger className="w-52 border-border bg-background"><SelectValue placeholder="Todos los sellers" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los sellers</SelectItem>
              {companies.map((company) => <SelectItem key={company.id} value={String(company.id)}>{companyName(company)}</SelectItem>)}
            </SelectContent>
          </Select>
          {filtersActive && <button type="button" onClick={clearFilters} className="secondary-button"><X className="h-4 w-4" /> Limpiar</button>}
        </div>
        {refreshNote && <p className="text-xs text-muted-foreground">{refreshNote}</p>}
      </div>

      {visibleError && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{visibleError}</div>}

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        {salesQuery.isPending ? <div className="grid h-48 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          : products.length === 0 ? <div className="px-5 py-14 text-center">
            <p className="text-sm font-medium">{pendingDetailOrders > 0 ? 'Faltan detalles de pedidos de hoy' : 'Sin salidas en esta fecha'}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {pendingDetailOrders > 0
                ? `Hay ${formatNumber(pendingDetailOrders, 0)} pedidos de hoy sin líneas. Pulsa actualizar para traer el detalle de Falabella.`
                : 'Solo cuenta pedidos cuyo PromisedShippingTime cae en este día. Pulsa actualizar si faltan líneas.'}
            </p>
          </div>
            : <div className="min-w-0" aria-busy={salesQuery.isFetching}>
              <Table className="table-fixed">
                <TableHeader>
                  {table.getHeaderGroups().map((headerGroup) => <TableRow key={headerGroup.id} className="bg-muted/50 hover:bg-muted/50">
                    {headerGroup.headers.map((header) => <TableHead key={header.id} className={cn(
                      header.column.id === 'product' && 'w-[46%]',
                      header.column.id === 'units' && 'w-[16%]',
                      header.column.id === 'stock' && 'w-[16%]',
                      header.column.id === 'sellers' && 'w-[22%]',
                    )}>{header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}</TableHead>)}
                  </TableRow>)}
                </TableHeader>
                <TableBody>{table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id} className="align-middle">
                    {row.getVisibleCells().map((cell) => <TableCell key={cell.id} className={cell.column.id === 'product' || cell.column.id === 'sellers' ? 'whitespace-normal' : undefined}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}
                  </TableRow>
                ))}</TableBody>
              </Table>
            </div>}
        <div className="flex shrink-0 items-center justify-between border-t border-border px-4 py-3">
          <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">{salesQuery.isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Mostrando {products.length} de {totalCount}</span>
          <div className="flex gap-2">
            <button disabled={offset === 0} onMouseEnter={() => prefetchPage(Math.max(0, offset - PAGE_SIZE))} onFocus={() => prefetchPage(Math.max(0, offset - PAGE_SIZE))} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} className="secondary-button"><ChevronLeft className="h-4 w-4" /> Anterior</button>
            <button disabled={offset + PAGE_SIZE >= totalCount} onMouseEnter={() => prefetchPage(offset + PAGE_SIZE)} onFocus={() => prefetchPage(offset + PAGE_SIZE)} onClick={() => setOffset(offset + PAGE_SIZE)} className="secondary-button">Siguiente <ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      </section>

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
