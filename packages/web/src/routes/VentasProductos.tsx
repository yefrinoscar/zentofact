import { useCallback, useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { BarChart3, Search, X } from 'lucide-react';
import api from '../lib/api';
import { cn } from '../lib/cn';
import { CopyableSku } from '../components/CopyableSku';
import DocumentDateRangePicker from '../components/DocumentDateRangePicker';
import { DataTablePagination } from '../components/ui/data-table';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Skeleton } from '../components/ui/skeleton';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TablePanel, TableRow } from '../components/ui/table';
import { documentDateRangeForLastDays, type DocumentDateRange } from '../lib/documentDateRange';
import {
  buyerIdentity,
  formatSalesCount,
  formatSalesMoney,
  arrivesMoneyHint,
  falabellaMoneyHint,
  formatSalesMoneyOrDash,
  formatVisits,
  productSalesKpis,
  publishedLabel,
  sellerChannelLabel,
  sellerSalesLabel,
  visitsHint,
  type ProductSaleBuyer,
  type ProductSaleRow,
  type ProductSalesTotals,
} from '../lib/product-sales-presentation';
import { sellerShortName } from '../lib/seller-name';

const PAGE_SIZE = 20;

type Company = {
  id: number;
  nombre?: string | null;
  nombreComercial?: string | null;
  razonSocial?: string | null;
};

type ProductSalesResponse = {
  from: string;
  to: string;
  products: ProductSaleRow[];
  totalCount: number;
  totals: ProductSalesTotals;
  topProducts: ProductSaleRow[];
  topBuyers: ProductSaleBuyer[];
  limit: number;
  offset: number;
};

type SortBy = 'product' | 'units' | 'orders' | 'grossSales' | 'sellers';

const COLUMN_CLASS = {
  product: 'w-full sm:w-[30%]',
  published: 'hidden xl:table-cell xl:w-[8%]',
  grossSales: 'w-[23%] sm:w-[14%]',
  falabella: 'w-[23%] sm:w-[14%]',
  arrives: 'w-[24%] sm:w-[14%]',
  units: 'hidden sm:table-cell sm:w-[10%]',
  orders: 'hidden md:table-cell md:w-[10%]',
  visits: 'hidden lg:table-cell lg:w-[10%]',
} as const;

function companyLabel(company: Company) {
  return sellerShortName(company.nombreComercial || company.nombre || company.razonSocial || `Empresa ${company.id}`);
}

export default function VentasProductos() {
  const queryClient = useQueryClient();
  const [range, setRange] = useState<DocumentDateRange>(() => documentDateRangeForLastDays(30));
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [companyId, setCompanyId] = useState<number | undefined>();
  const [sortBy, setSortBy] = useState<SortBy>('grossSales');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [offset, setOffset] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const applySearch = (value: string, submit = false) => {
    setSearch(value);
    if (submit || value === '') {
      setSubmittedSearch(value);
      setOffset(0);
    }
  };

  const applyRange = (next: DocumentDateRange) => {
    setRange(next);
    setOffset(0);
  };

  const applyCompany = (value: string) => {
    setCompanyId(value === 'all' ? undefined : Number(value));
    setOffset(0);
  };

  const applySort = (column: SortBy) => {
    if (sortBy === column) {
      setSortDir((current) => (current === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortBy(column);
      setSortDir(column === 'product' ? 'asc' : 'desc');
    }
    setOffset(0);
  };

  const filter = {
    from: range.from,
    to: range.to,
    search: submittedSearch || undefined,
    companyId,
    sortBy,
    sortDir,
    limit: PAGE_SIZE,
    offset,
  };

  const salesQuery = useQuery({
    queryKey: ['product-sales-report', filter],
    queryFn: () => api.listProductSalesReport(filter) as Promise<ProductSalesResponse>,
    placeholderData: keepPreviousData,
  });

  const companiesQuery = useQuery({
    queryKey: ['companies'],
    queryFn: () => api.listCompanies() as Promise<Company[]>,
  });

  const companies = useMemo(() => ((companiesQuery.data || []) as Company[])
    .slice()
    .sort((left, right) => companyLabel(left).localeCompare(companyLabel(right), 'es')), [companiesQuery.data]);

  const products = salesQuery.data?.products || [];
  const totals = salesQuery.data?.totals;
  const topProducts = salesQuery.data?.topProducts || [];
  const topBuyers = salesQuery.data?.topBuyers || [];
  const totalCount = salesQuery.data?.totalCount || 0;
  const selected = products.find((product) => product.productKey === selectedKey) || null;
  const loading = salesQuery.isPending && !salesQuery.data;
  const fetching = salesQuery.isFetching;

  const prefetchPage = useCallback((nextOffset: number) => {
    void queryClient.prefetchQuery({
      queryKey: ['product-sales-report', { ...filter, offset: nextOffset }],
      queryFn: () => api.listProductSalesReport({ ...filter, offset: nextOffset }),
    });
  }, [filter, queryClient]);

  const columns = useMemo<ColumnDef<ProductSaleRow>[]>(() => [
    {
      id: 'product',
      accessorKey: 'name',
      header: () => (
        <button type="button" className="text-left font-medium text-muted-foreground hover:text-foreground" onClick={() => applySort('product')}>
          Producto
        </button>
      ),
      cell: ({ row }) => <ProductCell product={row.original} />,
    },
    {
      id: 'published',
      accessorKey: 'published',
      header: 'Publicado',
      cell: ({ row }) => <PublishedBadge published={row.original.published} />,
    },
    {
      id: 'grossSales',
      accessorKey: 'grossSales',
      header: () => <SortHeader label="Ventas brutas" active={sortBy === 'grossSales'} dir={sortDir} onClick={() => applySort('grossSales')} />,
      cell: ({ row }) => <span className="tabular-nums">{formatSalesMoney(row.original.grossSales)}</span>,
    },
    {
      id: 'falabella',
      accessorKey: 'falabellaTake',
      header: 'Falabella',
      cell: ({ row }) => (
        <span className="tabular-nums" title={falabellaMoneyHint(row.original)}>
          {formatSalesMoneyOrDash(row.original.falabellaTake)}
        </span>
      ),
    },
    {
      id: 'arrives',
      accessorKey: 'arrives',
      header: 'Te llega',
      cell: ({ row }) => (
        <span className="tabular-nums" title={arrivesMoneyHint(row.original)}>
          {formatSalesMoneyOrDash(row.original.arrives)}
        </span>
      ),
    },
    {
      id: 'units',
      accessorKey: 'unitsSold',
      header: () => <SortHeader label="Unidades" active={sortBy === 'units'} dir={sortDir} onClick={() => applySort('units')} />,
      cell: ({ row }) => <span className="tabular-nums">{formatSalesCount(row.original.unitsSold)}</span>,
    },
    {
      id: 'orders',
      accessorKey: 'ordersCount',
      header: () => <SortHeader label="Pedidos" active={sortBy === 'orders'} dir={sortDir} onClick={() => applySort('orders')} />,
      cell: ({ row }) => <span className="tabular-nums">{formatSalesCount(row.original.ordersCount)}</span>,
    },
    {
      id: 'visits',
      accessorKey: 'visits',
      header: 'Visitas',
      cell: ({ row }) => <span className="tabular-nums text-muted-foreground" title={visitsHint()}>{formatVisits(row.original.visits)}</span>,
    },
  ], [sortBy, sortDir]);

  const table = useReactTable({
    data: products,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.productKey,
    manualSorting: true,
  });

  const kpis = productSalesKpis(totals);
  const error = salesQuery.error instanceof Error ? salesQuery.error.message : '';

  return (
    <div className="space-y-5">
      <SalesKpis items={kpis} loading={loading} />
      <TopProducts products={topProducts} loading={loading} />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
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
            placeholder="Buscar por nombre, SKU u otros criterios"
            className="h-11 px-9 sm:h-9"
            aria-label="Buscar por nombre, SKU u otros criterios"
          />
          {search ? (
            <button
              type="button"
              onClick={() => applySearch('', true)}
              className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Limpiar búsqueda"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <DocumentDateRangePicker value={range} onChange={applyRange} />
          <Select value={companyId ? String(companyId) : 'all'} onValueChange={applyCompany}>
            <SelectTrigger className="h-9 w-full sm:w-[200px]" aria-label="Filtrar por seller">
              <SelectValue placeholder="Todos los sellers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los sellers</SelectItem>
              {companies.map((company) => (
                <SelectItem key={company.id} value={String(company.id)}>{companyLabel(company)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}

      <TablePanel aria-label="Ventas de productos" aria-busy={loading || fetching}>
        {loading ? <SalesTableSkeleton /> : products.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <BarChart3 className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">Sin ventas Falabella en este periodo</p>
            <p className="mt-1 text-xs text-muted-foreground">Cambia el rango o el seller para ver otros maestros.</p>
          </div>
        ) : (
          <div className="min-w-0" aria-busy={fetching}>
            <Table className="table-fixed">
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id} className="hover:bg-transparent">
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id} className={COLUMN_CLASS[header.column.id as keyof typeof COLUMN_CLASS]}>
                        {header.isPlaceholder ? null : header.column.columnDef.header instanceof Function
                          ? header.column.columnDef.header(header.getContext())
                          : header.column.columnDef.header}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer align-middle"
                    tabIndex={0}
                    onClick={() => setSelectedKey(row.original.productKey)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedKey(row.original.productKey);
                      }
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          COLUMN_CLASS[cell.column.id as keyof typeof COLUMN_CLASS],
                          cell.column.id !== 'product' && 'tabular-nums',
                          cell.column.id === 'product' && 'whitespace-normal',
                        )}
                      >
                        {cell.column.columnDef.cell instanceof Function
                          ? cell.column.columnDef.cell(cell.getContext())
                          : null}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {!loading && products.length > 0 ? (
          <DataTablePagination
            pageIndex={Math.floor(offset / PAGE_SIZE)}
            pageSize={PAGE_SIZE}
            totalCount={totalCount}
            fetching={fetching}
            onPageChange={(page) => setOffset(page * PAGE_SIZE)}
            onPrefetch={(page) => prefetchPage(page * PAGE_SIZE)}
          />
        ) : null}
      </TablePanel>

      <TopBuyers buyers={topBuyers} loading={loading} />

      <SellerSalesDrawer
        product={selected}
        open={selected != null}
        onClose={() => setSelectedKey(null)}
      />
    </div>
  );
}

function sellerCountLabel(count: number) {
  return `${formatSalesCount(count)} ${count === 1 ? 'seller' : 'sellers'}`;
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: 'asc' | 'desc';
  onClick: () => void;
}) {
  return (
    <button type="button" className="inline-flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground" onClick={onClick}>
      {label}
      {active ? <span aria-hidden="true">{dir === 'asc' ? '↑' : '↓'}</span> : null}
    </button>
  );
}

function ProductCell({ product }: { product: ProductSaleRow }) {
  return (
    <div className="grid min-w-0 grid-cols-[3rem_minmax(0,1fr)] items-center gap-3">
      <span className="grid size-12 place-items-center overflow-hidden rounded-lg bg-muted">
        {product.imageUrl
          ? <img src={product.imageUrl} alt="" className="size-full object-contain" />
          : <BarChart3 className="size-4 text-muted-foreground" />}
      </span>
      <span className="min-w-0">
        <strong className="block whitespace-normal break-words text-sm leading-5">{product.name}</strong>
        <CopyableSku sku={product.sku} />
        <span className="mt-0.5 block text-xs text-muted-foreground">{sellerCountLabel(product.sellersCount)}</span>
        <span className="mt-2 grid grid-cols-2 gap-3 border-t border-border/60 pt-2 sm:hidden">
          <span>
            <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">Unidades</span>
            <span className="tabular-nums">{formatSalesCount(product.unitsSold)}</span>
          </span>
          <span>
            <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">Pedidos</span>
            <span className="tabular-nums">{formatSalesCount(product.ordersCount)}</span>
          </span>
        </span>
      </span>
    </div>
  );
}

function PublishedBadge({ published }: { published: boolean }) {
  return (
    <span className={cn(
      'inline-flex h-6 items-center rounded-full px-2 text-xs font-medium',
      published ? 'bg-emerald-50 text-emerald-700' : 'bg-muted text-muted-foreground',
    )}>
      {publishedLabel(published)}
    </span>
  );
}

function SalesKpis({
  items,
  loading,
}: {
  items: ReturnType<typeof productSalesKpis>;
  loading: boolean;
}) {
  const groups = [
    { title: 'Dinero', rows: items.filter((item) => item.group === 'Dinero') },
    { title: 'Ritmo', rows: items.filter((item) => item.group === 'Ritmo') },
  ];
  return (
    <div className="grid gap-5 md:grid-cols-2" aria-label="Indicadores de ventas">
      {groups.map((group) => (
        <div key={group.title}>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{group.title}</p>
          <div className="mt-2 grid grid-cols-3 gap-4">
            {group.rows.map((item) => (
              <div key={item.key} className="min-w-0">
                {loading ? <Skeleton className="h-8 w-20" /> : (
                  <span className="block truncate text-2xl font-semibold tabular-nums tracking-tight">{item.display}</span>
                )}
                <span className="mt-1 block text-sm font-medium">{item.label}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{item.why}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TopProducts({ products, loading }: { products: ProductSaleRow[]; loading: boolean }) {
  return (
    <section aria-label="Productos con más venta">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Más vendidos</p>
      {loading ? (
        <div className="mt-2 grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-16 w-full" />)}
        </div>
      ) : products.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Todavía no hay un producto líder en este periodo.</p>
      ) : (
        <div className="mt-2 grid gap-x-8 gap-y-4 sm:grid-cols-3">
          {products.slice(0, 3).map((product) => (
            <div key={product.productKey} className="min-w-0">
              <p className="truncate text-sm font-medium">{product.name}</p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">{product.sku}</p>
              <p className="mt-2 text-sm tabular-nums">{formatSalesMoney(product.grossSales)}</p>
              <p className="text-xs text-muted-foreground">{formatSalesCount(product.unitsSold)} u · {sellerCountLabel(product.sellersCount)}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function TopBuyers({ buyers, loading }: { buyers: ProductSaleBuyer[]; loading: boolean }) {
  return (
    <section aria-label="Compradores más importantes">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Compradores</p>
      {loading ? <Skeleton className="mt-3 h-40 w-full" /> : buyers.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Nadie compra todavía en este periodo.</p>
      ) : (
        <Table className="mt-2 table-fixed">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Comprador</TableHead>
              <TableHead className="hidden sm:table-cell">Documento</TableHead>
              <TableHead>Pedidos</TableHead>
              <TableHead>Unidades</TableHead>
              <TableHead>Ventas brutas</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {buyers.map((buyer) => (
              <TableRow key={buyer.buyerKey}>
                <TableCell className="whitespace-normal">
                  <span className="block text-sm font-medium">{buyer.name}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground sm:hidden">{buyerIdentity(buyer)}</span>
                </TableCell>
                <TableCell className="hidden font-mono text-xs sm:table-cell">{buyerIdentity(buyer)}</TableCell>
                <TableCell className="tabular-nums">{formatSalesCount(buyer.ordersCount)}</TableCell>
                <TableCell className="tabular-nums">{formatSalesCount(buyer.unitsBought)}</TableCell>
                <TableCell className="tabular-nums">{formatSalesMoney(buyer.grossSales)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function SellerSalesDrawer({
  product,
  open,
  onClose,
}: {
  product: ProductSaleRow | null;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <SheetContent side="right" className="flex w-full flex-col overflow-hidden sm:max-w-xl">
        <SheetHeader className="px-6 pt-7 sm:px-8">
          <SheetTitle>{product?.name || 'Producto'}</SheetTitle>
          <SheetDescription>
            {product ? `${product.sku} · ${sellerCountLabel(product.sellersCount)}` : 'Detalle por seller'}
          </SheetDescription>
        </SheetHeader>
        {product ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8 sm:px-8">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Metric label="Ventas brutas" value={formatSalesMoney(product.grossSales)} />
              <Metric
                label="Falabella"
                value={formatSalesMoneyOrDash(product.falabellaTake)}
                hint={falabellaMoneyHint(product)}
              />
              <Metric
                label="Te llega"
                value={formatSalesMoneyOrDash(product.arrives)}
                hint={arrivesMoneyHint(product)}
              />
              <Metric label="Unidades" value={`${formatSalesCount(product.unitsSold)} u`} />
              <Metric label="Pedidos" value={formatSalesCount(product.ordersCount)} />
              <Metric label="Visitas" value={formatVisits(product.visits)} hint={visitsHint()} />
            </div>
            <p className="mt-8 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Por seller</p>
            {product.sellers.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">Sin desglose de seller.</p>
            ) : (
              <div className="mt-2 divide-y divide-border/70">
                {product.sellers.map((seller, index) => (
                  <article key={`${seller.companyId || 'none'}-${seller.sellerSku || index}`} className="py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{sellerSalesLabel(seller)}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{sellerChannelLabel(seller)}</p>
                        {seller.sellerSku ? <p className="mt-1 font-mono text-xs text-muted-foreground">{seller.sellerSku}</p> : null}
                      </div>
                      <PublishedBadge published={seller.published} />
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                      <div>
                        <dt className="text-xs text-muted-foreground">Ventas brutas</dt>
                        <dd className="mt-0.5 tabular-nums">{formatSalesMoney(seller.grossSales)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Falabella</dt>
                        <dd className="mt-0.5 tabular-nums" title={falabellaMoneyHint(seller)}>
                          {formatSalesMoneyOrDash(seller.falabellaTake)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Te llega</dt>
                        <dd className="mt-0.5 tabular-nums" title={arrivesMoneyHint(seller)}>
                          {formatSalesMoneyOrDash(seller.arrives)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Unidades</dt>
                        <dd className="mt-0.5 tabular-nums">{formatSalesCount(seller.unitsSold)} u</dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold tabular-nums tracking-tight">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function SalesTableSkeleton() {
  return (
    <div className="min-w-0" aria-label="Cargando ventas" aria-busy="true">
      <Table className="table-fixed">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead><Skeleton className="h-4 w-20" /></TableHead>
            <TableHead className="hidden xl:table-cell"><Skeleton className="h-4 w-16" /></TableHead>
            <TableHead><Skeleton className="h-4 w-16" /></TableHead>
            <TableHead><Skeleton className="h-4 w-16" /></TableHead>
            <TableHead><Skeleton className="h-4 w-16" /></TableHead>
            <TableHead className="hidden sm:table-cell"><Skeleton className="h-4 w-14" /></TableHead>
            <TableHead className="hidden md:table-cell"><Skeleton className="h-4 w-14" /></TableHead>
            <TableHead className="hidden lg:table-cell"><Skeleton className="h-4 w-14" /></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 6 }, (_, row) => (
            <TableRow key={row} className="hover:bg-transparent">
              <TableCell>
                <div className="flex items-center gap-3">
                  <Skeleton className="h-12 w-12 rounded-lg" />
                  <div className="min-w-0 flex-1 space-y-2"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-20" /></div>
                </div>
              </TableCell>
              <TableCell className="hidden xl:table-cell"><Skeleton className="h-5 w-10" /></TableCell>
              <TableCell><Skeleton className="h-5 w-16" /></TableCell>
              <TableCell><Skeleton className="h-5 w-16" /></TableCell>
              <TableCell><Skeleton className="h-5 w-16" /></TableCell>
              <TableCell className="hidden sm:table-cell"><Skeleton className="h-5 w-10" /></TableCell>
              <TableCell className="hidden md:table-cell"><Skeleton className="h-5 w-10" /></TableCell>
              <TableCell className="hidden lg:table-cell"><Skeleton className="h-5 w-8" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
