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
  buyerCompaniesLabel,
  buyerIdentity,
  buyerPhoneDigits,
  buyerPhoneLabel,
  buyerProductsLabel,
  formatBuyerLastOrder,
  formatSalesCount,
  formatSalesMoney,
  arrivesMoneyHint,
  falabellaMoneyHint,
  formatSalesMoneyOrDash,
  paidMoneyHint,
  paidShare,
  pendingMoneyHint,
  productSalesKpis,
  publishedLabel,
  sellerChannelLabel,
  sellerSalesLabel,
  sortSalesBuyers,
  type BuyerSortBy,
  type ProductSaleBuyer,
  type ProductSaleBuyerCompany,
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
  trackedBuyers: ProductSaleBuyer[];
  topBuyers: ProductSaleBuyer[];
  limit: number;
  offset: number;
};

type SortBy = 'product' | 'units' | 'orders' | 'grossSales' | 'falabellaTake' | 'arrives' | 'sellers';

const COLUMN_CLASS = {
  product: 'w-full sm:w-[32%]',
  grossSales: 'w-[22%] sm:w-[16%] text-right',
  falabella: 'hidden sm:table-cell sm:w-[14%] text-right',
  arrives: 'w-[46%] sm:w-[38%]',
} as const;

const TONE = {
  take: 'text-rose-700 dark:text-rose-400',
  receive: 'text-emerald-700 dark:text-emerald-400',
  wait: 'text-amber-700 dark:text-amber-400',
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
  const trackedBuyers = salesQuery.data?.trackedBuyers || [];
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
      header: () => <SortHeader label="Producto" active={sortBy === 'product'} dir={sortDir} onClick={() => applySort('product')} />,
      cell: ({ row }) => <ProductCell product={row.original} />,
    },
    {
      id: 'grossSales',
      accessorKey: 'grossSales',
      header: () => <SortHeader label="Ventas brutas" active={sortBy === 'grossSales'} dir={sortDir} onClick={() => applySort('grossSales')} />,
      cell: ({ row }) => (
        <MoneySplit
          value={row.original.grossSales}
          left={Number(row.original.falabellaTake || 0)}
          right={Number(row.original.arrives || 0)}
          leftClass="bg-rose-400"
          rightClass="bg-emerald-500"
        />
      ),
    },
    {
      id: 'falabella',
      accessorKey: 'falabellaTake',
      header: () => (
        <SortHeader
          label="Falabella"
          active={sortBy === 'falabellaTake'}
          dir={sortDir}
          className={TONE.take}
          onClick={() => applySort('falabellaTake')}
        />
      ),
      cell: ({ row }) => (
        <span className={cn('tabular-nums', TONE.take)} title={falabellaMoneyHint(row.original)}>
          {formatSalesMoneyOrDash(row.original.falabellaTake)}
        </span>
      ),
    },
    {
      id: 'arrives',
      accessorKey: 'arrives',
      header: () => (
        <span className="flex w-full items-end justify-between gap-4">
          <SortHeader
            label="Te llega"
            active={sortBy === 'arrives'}
            dir={sortDir}
            className={TONE.receive}
            onClick={() => applySort('arrives')}
          />
          <span className="hidden text-xs font-medium sm:flex sm:gap-4">
            <span className={TONE.receive}>Pagado</span>
            <span className={TONE.wait}>Pendiente</span>
          </span>
        </span>
      ),
      cell: ({ row }) => <ArrivesCompare product={row.original} />,
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

      <BuyersBoard tracked={trackedBuyers} others={topBuyers} loading={loading} />

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
  className,
}: {
  label: string;
  active: boolean;
  dir: 'asc' | 'desc';
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={cn('inline-flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground', className)}
      aria-label={`Ordenar por ${label}`}
      onClick={onClick}
    >
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
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {formatSalesCount(product.unitsSold)} u · {formatSalesCount(product.ordersCount)} pedidos · {sellerCountLabel(product.sellersCount)}
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
  const brutas = items.find((item) => item.key === 'grossSales');
  const llega = items.find((item) => item.key === 'arrives');
  return (
    <div className="grid gap-6 md:grid-cols-2" aria-label="Indicadores de ventas">
      <div className="min-w-0">
        {loading || !brutas ? <Skeleton className="h-8 w-28" /> : (
          <span className="block truncate text-2xl font-semibold tabular-nums tracking-tight">{brutas.display}</span>
        )}
        <span className="mt-1 block text-sm font-medium">{brutas?.label || 'Ventas brutas'}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{brutas?.why}</span>
      </div>
      <div className="min-w-0">
        {loading || !llega ? <Skeleton className="h-16 w-full" /> : (
          <div className="flex items-start gap-6">
            <div className="min-w-0">
              <span className={cn('block truncate text-2xl font-semibold tabular-nums tracking-tight', TONE.receive)}>
                {llega.display}
              </span>
              <span className="mt-1 block text-sm font-medium">{llega.label}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{llega.why}</span>
            </div>
            <div className="min-w-[11rem] flex-1">
              <PayoutCompare paid={llega.paid} pending={llega.pending} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BuyersBoard({
  tracked,
  others,
  loading,
}: {
  tracked: ProductSaleBuyer[];
  others: ProductSaleBuyer[];
  loading: boolean;
}) {
  return (
    <div className="space-y-8">
      <section aria-label="Compradores de más de 5 unidades">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Más de 5 unidades</p>
        <p className="mt-1 text-xs text-muted-foreground">Seguimiento. Teléfono y seller.</p>
        {loading ? <Skeleton className="mt-3 h-40 w-full" /> : tracked.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nadie pasó de 5 u en este periodo.</p>
        ) : (
          <BuyersTable buyers={tracked} defaultSort="units" detailed />
        )}
      </section>
      <section aria-label="Compradores más importantes">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Otros compradores</p>
        {loading ? <Skeleton className="mt-3 h-32 w-full" /> : others.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nadie más compra en este periodo.</p>
        ) : (
          <BuyersTable buyers={others} defaultSort="grossSales" />
        )}
      </section>
    </div>
  );
}

function BuyersTable({
  buyers,
  defaultSort,
  detailed = false,
}: {
  buyers: ProductSaleBuyer[];
  defaultSort: BuyerSortBy;
  detailed?: boolean;
}) {
  const [sortBy, setSortBy] = useState<BuyerSortBy>(defaultSort);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const rows = useMemo(() => sortSalesBuyers(buyers, sortBy, sortDir), [buyers, sortBy, sortDir]);
  const applySort = (column: BuyerSortBy) => {
    if (sortBy === column) {
      setSortDir((current) => (current === 'desc' ? 'asc' : 'desc'));
      return;
    }
    setSortBy(column);
    setSortDir(column === 'name' || column === 'phone' || column === 'company' ? 'asc' : 'desc');
  };
  return (
    <Table className="mt-2 table-fixed">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-[28%]">
            <SortHeader label="Comprador" active={sortBy === 'name'} dir={sortDir} onClick={() => applySort('name')} />
          </TableHead>
          <TableHead className="w-[16%]">
            <SortHeader label="Teléfono" active={sortBy === 'phone'} dir={sortDir} onClick={() => applySort('phone')} />
          </TableHead>
          <TableHead className="w-[28%]">
            <SortHeader label="Empresa" active={sortBy === 'company'} dir={sortDir} onClick={() => applySort('company')} />
          </TableHead>
          <TableHead className="hidden w-[10%] sm:table-cell">
            <SortHeader label="Unidades" active={sortBy === 'units'} dir={sortDir} onClick={() => applySort('units')} />
          </TableHead>
          <TableHead className="w-[18%]">
            <SortHeader label="Ventas brutas" active={sortBy === 'grossSales'} dir={sortDir} onClick={() => applySort('grossSales')} />
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((buyer) => (
          <TableRow key={buyer.buyerKey} className={cn(detailed && 'align-top')}>
            <TableCell className="whitespace-normal">
              <span className="block text-sm font-medium">{buyer.name}</span>
              <span className="mt-0.5 block font-mono text-xs text-muted-foreground">{buyerIdentity(buyer)}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {formatSalesCount(buyer.ordersCount)} {buyer.ordersCount === 1 ? 'pedido' : 'pedidos'}
                {detailed && formatBuyerLastOrder(buyer.lastOrderedAt) ? ` · ${formatBuyerLastOrder(buyer.lastOrderedAt)}` : ''}
              </span>
            </TableCell>
            <TableCell className="whitespace-normal">
              <BuyerPhone phone={buyer.phone} />
            </TableCell>
            <TableCell className="whitespace-normal">
              {detailed ? <BuyerCompanies buyer={buyer} /> : (
                <span className="text-sm">{buyerCompaniesLabel(buyer)}</span>
              )}
            </TableCell>
            <TableCell className="hidden tabular-nums sm:table-cell">{formatSalesCount(buyer.unitsBought)}</TableCell>
            <TableCell className="tabular-nums">{formatSalesMoney(buyer.grossSales)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function BuyerPhone({ phone }: { phone?: string | null }) {
  const label = buyerPhoneLabel({ phone });
  const digits = buyerPhoneDigits(phone);
  if (!digits) return <span className="text-xs text-muted-foreground">{label}</span>;
  return (
    <a href={`tel:${digits}`} className="font-mono text-xs tabular-nums hover:underline">
      {label}
    </a>
  );
}

function BuyerCompanies({ buyer }: { buyer: ProductSaleBuyer }) {
  const companies = buyer.companies || [];
  if (companies.length === 0) {
    return <span className="text-xs text-muted-foreground">Sin seller</span>;
  }
  return (
    <div className="space-y-1.5">
      {companies.map((company) => (
        <BuyerCompanyLine key={`${company.companyId || company.companyName}`} company={company} />
      ))}
      {buyerProductsLabel(buyer) ? (
        <p className="text-xs text-muted-foreground">{buyerProductsLabel(buyer)}</p>
      ) : null}
    </div>
  );
}

function BuyerCompanyLine({ company }: { company: ProductSaleBuyerCompany }) {
  return (
    <p className="text-sm leading-5">
      <span className="font-medium">{sellerShortName(company.companyName)}</span>
      <span className="mt-0.5 block text-xs text-muted-foreground">
        {formatSalesCount(company.unitsBought)} u · {formatSalesCount(company.ordersCount)} {company.ordersCount === 1 ? 'pedido' : 'pedidos'} · {formatSalesMoney(company.grossSales)}
      </span>
    </p>
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
            <div className="grid grid-cols-2 gap-4">
              <Metric label="Ventas brutas" value={formatSalesMoney(product.grossSales)} />
              <Metric
                label="Falabella"
                value={formatSalesMoneyOrDash(product.falabellaTake)}
                hint={falabellaMoneyHint(product)}
                tone="take"
              />
              <Metric label="Unidades" value={`${formatSalesCount(product.unitsSold)} u · ${formatSalesCount(product.ordersCount)} pedidos`} />
            </div>
            <div className="mt-5 flex items-start gap-6">
              <Metric
                label="Te llega"
                value={formatSalesMoneyOrDash(product.arrives)}
                hint={arrivesMoneyHint(product)}
                tone="receive"
              />
              <div className="min-w-[11rem] flex-1 pt-5">
                <PayoutCompare paid={product.paidArrives} pending={product.pendingArrives} />
              </div>
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
                    <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <dt className="text-xs text-muted-foreground">Ventas brutas</dt>
                        <dd className="mt-0.5 tabular-nums">{formatSalesMoney(seller.grossSales)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Te llega</dt>
                        <dd className={cn('mt-0.5 text-base font-semibold tabular-nums', TONE.receive)} title={arrivesMoneyHint(seller)}>
                          {formatSalesMoneyOrDash(seller.arrives)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Falabella</dt>
                        <dd className={cn('mt-0.5 tabular-nums', TONE.take)} title={falabellaMoneyHint(seller)}>
                          {formatSalesMoneyOrDash(seller.falabellaTake)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Unidades</dt>
                        <dd className="mt-0.5 tabular-nums">{formatSalesCount(seller.unitsSold)} u</dd>
                      </div>
                    </dl>
                    <div className="mt-3">
                      <PayoutCompare paid={seller.paidArrives} pending={seller.pendingArrives} />
                    </div>
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

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'take' | 'receive' | 'wait';
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('mt-1 truncate text-lg font-semibold tabular-nums tracking-tight', tone && TONE[tone])}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function MoneySplit({
  value,
  left,
  right,
  leftClass,
  rightClass,
}: {
  value: number;
  left: number;
  right: number;
  leftClass: string;
  rightClass: string;
}) {
  const total = Math.max(0, left) + Math.max(0, right);
  const leftPct = total > 0 ? (Math.max(0, left) / total) * 100 : 0;
  return (
    <span className="block">
      <span className="tabular-nums font-medium">{formatSalesMoney(value)}</span>
      <span className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <span className={leftClass} style={{ width: `${leftPct}%` }} />
        <span className={rightClass} style={{ width: `${Math.max(0, 100 - leftPct)}%` }} />
      </span>
    </span>
  );
}

function ArrivesCompare({
  product,
}: {
  product: Pick<ProductSaleRow, 'arrives' | 'paidArrives' | 'pendingArrives'>;
}) {
  return (
    <div className="flex items-start gap-4">
      <span className={cn('shrink-0 tabular-nums text-base font-semibold', TONE.receive)} title={arrivesMoneyHint(product)}>
        {formatSalesMoneyOrDash(product.arrives)}
      </span>
      <div className="min-w-0 flex-1">
        <PayoutCompare paid={product.paidArrives} pending={product.pendingArrives} />
      </div>
    </div>
  );
}

function PayoutCompare({
  paid,
  pending,
}: {
  paid?: number | null;
  pending?: number | null;
}) {
  const received = Number(paid || 0);
  const waiting = Number(pending || 0);
  const share = paidShare(received, waiting) * 100;
  return (
    <div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-amber-100 dark:bg-amber-950/60" aria-hidden="true">
        <div className="bg-emerald-500" style={{ width: `${share}%` }} />
      </div>
      <div className="mt-1 flex items-start justify-between gap-3 text-[11px] tabular-nums">
        <span className={TONE.receive} title={paidMoneyHint({ paidArrives: paid ?? null })}>
          {formatSalesMoney(received)} <span className="font-normal">pagado</span>
        </span>
        <span className={TONE.wait} title={pendingMoneyHint({ pendingArrives: pending ?? null })}>
          {formatSalesMoney(waiting)} <span className="font-normal">pendiente</span>
        </span>
      </div>
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
            <TableHead className="text-right"><Skeleton className="ml-auto h-4 w-16" /></TableHead>
            <TableHead className="hidden text-right sm:table-cell"><Skeleton className="ml-auto h-4 w-16" /></TableHead>
            <TableHead><Skeleton className="h-4 w-40" /></TableHead>
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
              <TableCell className="text-right"><Skeleton className="ml-auto h-5 w-16" /></TableCell>
              <TableCell className="hidden text-right sm:table-cell"><Skeleton className="ml-auto h-5 w-16" /></TableCell>
              <TableCell><Skeleton className="h-8 w-40" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
