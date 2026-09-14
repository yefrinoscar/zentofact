import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { BarChart3, ChevronDown, Search, X } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import api from '../lib/api';
import { cn } from '../lib/cn';
import { CopyableSku } from '../components/CopyableSku';
import { SalesOverview } from '../components/SalesOverview';
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
  formatCoverDays,
  formatKeepsPerDay,
  formatSalesCount,
  formatSalesMoney,
  formatUnitsPerDay,
  hasBuyerPhone,
  arrivesMoneyHint,
  falabellaMoneyHint,
  formatSalesMoneyOrDash,
  paidMoneyHint,
  paidShare,
  pendingMoneyHint,
  productSalesKpis,
  publishedLabel,
  restockFormula,
  restockWhyLabel,
  salesCurveNote,
  sellerChannelLabel,
  sellerSalesLabel,
  skipDetail,
  skipReasonLabel,
  sortSalesBuyers,
  stockIsLow,
  weekdayUnits,
  type BuyerSortBy,
  type ProductSaleBuyer,
  type ProductSaleBuyerCompany,
  type ProductSalePoint,
  type ProductSaleRow,
  type ProductSalesRestock,
  type ProductSalesTotals,
  type RestockPoint,
  type SalesDayPoint,
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
  restock?: ProductSalesRestock;
  daily?: SalesDayPoint[];
  trackedBuyers: ProductSaleBuyer[];
  topBuyers: ProductSaleBuyer[];
  limit: number;
  offset: number;
};

type SortBy = 'product' | 'units' | 'unitsPerDay' | 'keepsPerDay' | 'restockQty' | 'orders' | 'grossSales' | 'falabellaTake' | 'arrives' | 'sellers';

const COLUMN_CLASS = {
  product: 'w-full sm:w-[34%]',
  curve: 'hidden md:table-cell md:w-[12%]',
  unitsPerDay: 'hidden sm:table-cell sm:w-[10%] text-right',
  keepsPerDay: 'w-[22%] sm:w-[14%] text-right',
  stock: 'hidden sm:table-cell sm:w-[14%] text-right',
  restock: 'w-[16%] sm:w-[12%] text-right',
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
  const restock = salesQuery.data?.restock;
  const daily = salesQuery.data?.daily || [];
  const trackedBuyers = salesQuery.data?.trackedBuyers || [];
  const totalCount = salesQuery.data?.totalCount || 0;
  const selected = products.find((product) => product.productKey === selectedKey)
    || restock?.items.find((product) => product.productKey === selectedKey)
    || restock?.skip.find((product) => product.productKey === selectedKey)
    || null;
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
      id: 'curve',
      header: () => <span className="font-medium text-muted-foreground">Curva</span>,
      cell: ({ row }) => <SalesSparkline series={row.original.series || []} />,
    },
    {
      id: 'unitsPerDay',
      accessorKey: 'unitsPerDay',
      header: () => <SortHeader label="u / día" active={sortBy === 'unitsPerDay'} dir={sortDir} onClick={() => applySort('unitsPerDay')} />,
      cell: ({ row }) => <span className="tabular-nums">{formatUnitsPerDay(row.original.unitsPerDay)}</span>,
    },
    {
      id: 'keepsPerDay',
      accessorKey: 'keepsPerDay',
      header: () => (
        <SortHeader
          label="Te deja / día"
          active={sortBy === 'keepsPerDay'}
          dir={sortDir}
          className={TONE.receive}
          onClick={() => applySort('keepsPerDay')}
        />
      ),
      cell: ({ row }) => (
        <span className={cn('tabular-nums font-medium', TONE.receive)}>
          {formatKeepsPerDay(row.original.keepsPerDay)}
        </span>
      ),
    },
    {
      id: 'stock',
      accessorKey: 'available',
      header: () => <span className="font-medium text-muted-foreground">Stock</span>,
      cell: ({ row }) => <StockCell product={row.original} />,
    },
    {
      id: 'restock',
      accessorKey: 'restockQty',
      header: () => <SortHeader label="Traer" active={sortBy === 'restockQty'} dir={sortDir} onClick={() => applySort('restockQty')} />,
      cell: ({ row }) => (
        <span className={cn('tabular-nums', Number(row.original.restockQty || 0) > 0 ? 'font-semibold' : 'text-muted-foreground')}>
          {formatSalesCount(row.original.restockQty || 0)}
        </span>
      ),
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

      <SalesOverview daily={daily} loading={loading} />

      <SalesAnalysis
        restock={restock}
        loading={loading}
        selectedKey={selectedKey}
        onSelect={(productKey) => setSelectedKey(productKey)}
      />

      <TablePanel aria-label="Ventas de productos" aria-busy={loading || fetching}>
        {loading ? <SalesTableSkeleton /> : products.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <BarChart3 className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">Sin ventas en este periodo</p>
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

      <BuyersBoard tracked={trackedBuyers} loading={loading} />

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

function SalesSparkline({ series }: { series: ProductSalePoint[] }) {
  if (series.length < 2) return <span className="text-xs text-muted-foreground">—</span>;
  const max = Math.max(...series.map((point) => point.units), 1);
  const width = 108;
  const height = 28;
  const pad = 2;
  const points = series.map((point, index) => {
    const x = pad + (index / (series.length - 1)) * (width - pad * 2);
    const y = height - pad - (point.units / max) * (height - pad * 2);
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-7 w-[108px] text-foreground" aria-hidden="true">
      <polyline fill="none" stroke="currentColor" strokeWidth="1.6" points={points} />
    </svg>
  );
}

function StockCell({ product }: { product: ProductSaleRow }) {
  const cover = formatCoverDays(product.coverDays);
  return (
    <span className={cn('tabular-nums', stockIsLow(product.coverDays) && 'font-semibold text-destructive')}>
      {formatSalesCount(product.available || 0)} u
      {cover ? ` · ${cover}` : ''}
    </span>
  );
}

const CHART = {
  bring: '#047857',
  skip: '#be123c',
  watch: '#a8a29e',
} as const;

const SHOW_SPEED_MONEY_CHART = false;

function SalesAnalysis({
  restock,
  loading,
  selectedKey,
  onSelect,
}: {
  restock?: ProductSalesRestock;
  loading: boolean;
  selectedKey: string | null;
  onSelect: (productKey: string) => void;
}) {
  const items = restock?.items || [];
  const skip = restock?.skip || [];
  const points = restock?.points || [];
  if (loading) return <Skeleton className="h-48 w-full" />;
  if (items.length === 0 && skip.length === 0) return null;
  return (
    <div className="space-y-4">
      {SHOW_SPEED_MONEY_CHART ? (
        <section className="overflow-hidden rounded-md border border-border px-4 py-4 sm:px-5">
          <SpeedMoneyChart points={points} selectedKey={selectedKey} onSelect={onSelect} />
        </section>
      ) : null}
      <AnalysisRail
        title="Traer"
        hint="Se están acabando y te dejan plata. Pide estas unidades para 30 días."
        empty="Nada que reponer en este periodo."
        tone="bring"
      >
        {items.map((product) => (
          <AnalysisCard
            key={product.productKey}
            product={product}
            selected={product.productKey === selectedKey}
            accent={CHART.bring}
            value={formatSalesCount(product.restockQty || 0)}
            valueHint="a traer"
            money={formatKeepsPerDay(product.keepsPerDay)}
            why={restockWhyLabel(product)}
            onSelect={onSelect}
          />
        ))}
      </AnalysisRail>
      <AnalysisRail
        title="No traer"
        hint="Ya tienes de sobra, o venden y dejan poco. Si no está aquí ni en Traer, espera: todavía cubre el mes o se mueve poco."
        empty="Ninguno parado en este periodo."
        tone="skip"
      >
        {skip.map((product) => (
          <AnalysisCard
            key={product.productKey}
            product={product}
            selected={product.productKey === selectedKey}
            accent={CHART.skip}
            badge={skipReasonLabel(product.skipReason)}
            value={formatCoverDays(product.coverDays) || '0 d'}
            valueHint="de stock"
            money={formatKeepsPerDay(product.keepsPerDay)}
            why={skipDetail(product)}
            onSelect={onSelect}
          />
        ))}
      </AnalysisRail>
    </div>
  );
}

function AnalysisRail({
  title,
  hint,
  empty,
  tone,
  children,
}: {
  title: string;
  hint: string;
  empty: string;
  tone: 'bring' | 'skip';
  children: ReactNode;
}) {
  const rows = Array.isArray(children) ? children : [children];
  const hasRows = rows.filter(Boolean).length > 0;
  return (
    <section className="min-w-0">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
        <p className={cn('text-sm font-semibold', tone === 'bring' ? TONE.receive : TONE.take)}>{title}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {hasRows ? (
        <div className="mt-3 flex gap-3 overflow-x-auto pb-1">{children}</div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

function AnalysisCard({
  product,
  selected,
  accent,
  badge,
  value,
  valueHint,
  money,
  why,
  onSelect,
}: {
  product: ProductSaleRow;
  selected: boolean;
  accent: string;
  badge?: string;
  value: string;
  valueHint: string;
  money: string;
  why: string;
  onSelect: (productKey: string) => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        'w-[220px] shrink-0 rounded-md border border-border p-3 text-left hover:bg-muted/40',
        selected && 'bg-muted/50',
      )}
      onClick={() => onSelect(product.productKey)}
    >
      <span className="grid size-16 place-items-center overflow-hidden rounded-md bg-muted">
        {product.imageUrl
          ? <img src={product.imageUrl} alt="" className="size-full object-contain" />
          : <BarChart3 className="size-5 text-muted-foreground" />}
      </span>
      {badge ? (
        <span className="mt-2 inline-flex rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{badge}</span>
      ) : null}
      <span className="mt-2 line-clamp-2 block text-sm font-medium leading-5">{product.name}</span>
      <span className="mt-0.5 block font-mono text-xs text-muted-foreground">{product.sku}</span>
      <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">{why}</span>
      <span className="mt-2 block h-12">
        <MiniCurve series={product.series || []} color={accent} />
      </span>
      <span className="mt-2 flex items-end justify-between gap-2">
        <span>
          <span className="block text-lg font-semibold tabular-nums tracking-tight">{value}</span>
          <span className="block text-[11px] text-muted-foreground">{valueHint}</span>
        </span>
        <span className="text-right">
          <span className={cn('block text-sm font-semibold tabular-nums', TONE.receive)}>{money}</span>
          <span className="block text-[11px] text-muted-foreground">/ día</span>
        </span>
      </span>
    </button>
  );
}

function MiniCurve({ series, color }: { series: ProductSalePoint[]; color: string }) {
  if (!series.some((point) => point.units > 0)) {
    return <span className="grid h-full place-items-center text-[11px] text-muted-foreground">Sin curva</span>;
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={series} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <Area type="monotone" dataKey="units" stroke={color} strokeWidth={1.6} fill={color} fillOpacity={0.12} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function SpeedMoneyChart({
  points,
  selectedKey,
  onSelect,
}: {
  points: RestockPoint[];
  selectedKey: string | null;
  onSelect: (productKey: string) => void;
}) {
  if (points.length === 0) {
    return <div className="grid h-full place-items-center text-sm text-muted-foreground">Sin productos para graficar.</div>;
  }
  const groups = {
    watch: points.filter((point) => point.group === 'watch'),
    skip: points.filter((point) => point.group === 'skip'),
    bring: points.filter((point) => point.group === 'bring'),
  };
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 8, right: 12, bottom: 8, left: 4 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 6" />
        <XAxis
          type="number"
          dataKey="unitsPerDay"
          name="u/día"
          tickFormatter={(value) => formatUnitsPerDay(Number(value))}
          tick={{ fontSize: 11 }}
          tickMargin={8}
          axisLine={false}
          tickLine={false}
          stroke="var(--muted-foreground)"
        />
        <YAxis
          type="number"
          dataKey="keepsPerDay"
          name="te deja"
          tickFormatter={(value) => formatKeepsPerDay(Number(value))}
          tick={{ fontSize: 11 }}
          tickMargin={8}
          width={72}
          axisLine={false}
          tickLine={false}
          stroke="var(--muted-foreground)"
        />
        <ZAxis type="number" range={[60, 60]} />
        <Tooltip
          cursor={{ strokeDasharray: '3 4' }}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as RestockPoint | undefined;
            if (!active || !point) return null;
            return (
              <div className="max-w-56 rounded-md bg-popover px-2.5 py-2 text-xs shadow-sm ring-1 ring-foreground/5">
                <p className="font-medium">{point.name}</p>
                <p className="mt-0.5 font-mono text-muted-foreground">{point.sku}</p>
                <p className="mt-2 tabular-nums">{formatUnitsPerDay(point.unitsPerDay)} u/día</p>
                <p className={cn('tabular-nums', TONE.receive)}>{formatKeepsPerDay(point.keepsPerDay)} / día</p>
                {point.group === 'bring' ? (
                  <p className="mt-1 font-medium">Trae {formatSalesCount(point.restockQty)} u</p>
                ) : point.group === 'skip' ? (
                  <p className="mt-1 font-medium text-rose-700">No traigas</p>
                ) : null}
              </div>
            );
          }}
        />
        {(['watch', 'skip', 'bring'] as const).map((group) => (
          <Scatter
            key={group}
            name={group}
            data={groups[group]}
            fill={CHART[group]}
            fillOpacity={group === 'watch' ? 0.55 : 0.9}
            onClick={(entry) => {
              const record = entry as { productKey?: string; payload?: { productKey?: string } };
              const key = record.productKey || record.payload?.productKey;
              if (key) onSelect(key);
            }}
          >
            {groups[group].map((point) => (
              <Cell
                key={point.productKey}
                fill={CHART[group]}
                fillOpacity={point.productKey === selectedKey ? 1 : group === 'watch' ? 0.45 : 0.9}
                stroke={point.productKey === selectedKey ? 'var(--foreground)' : 'transparent'}
                strokeWidth={point.productKey === selectedKey ? 2 : 0}
              />
            ))}
          </Scatter>
        ))}
      </ScatterChart>
    </ResponsiveContainer>
  );
}

const curveDayLabel = new Intl.DateTimeFormat('es-PE', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

function ProductSalesCurve({ product }: { product: ProductSaleRow }) {
  const series = product.series || [];
  const week = weekdayUnits(series);
  const note = salesCurveNote(product);
  const restocking = Number(product.restockQty || 0) > 0;
  return (
    <div className="mt-6">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Curva del periodo</p>
      <div className="mt-2 h-52 w-full">
        {series.some((point) => point.units > 0) ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="productSalesFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--foreground)" stopOpacity={0.12} />
                  <stop offset="92%" stopColor="var(--foreground)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 6" />
              <XAxis
                dataKey="date"
                tickFormatter={(value) => curveDayLabel.format(new Date(`${value}T12:00:00.000Z`))}
                axisLine={false}
                tickLine={false}
                tickMargin={10}
                minTickGap={28}
                fontSize={11}
                stroke="var(--muted-foreground)"
              />
              <YAxis
                orientation="right"
                axisLine={false}
                tickLine={false}
                tickMargin={8}
                width={28}
                fontSize={11}
                allowDecimals={false}
                stroke="var(--muted-foreground)"
              />
              <Tooltip
                content={({ active, payload }) => {
                  const point = payload?.[0]?.payload as ProductSalePoint | undefined;
                  if (!active || !point) return null;
                  return (
                    <div className="rounded-md bg-popover px-2.5 py-1.5 text-xs shadow-sm ring-1 ring-foreground/5">
                      <p className="font-medium">{curveDayLabel.format(new Date(`${point.date}T12:00:00.000Z`))}</p>
                      <p className="tabular-nums text-muted-foreground">{formatSalesCount(point.units)} u</p>
                    </div>
                  );
                }}
              />
              <Area type="monotone" dataKey="units" stroke="var(--foreground)" strokeWidth={2} fill="url(#productSalesFill)" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="grid h-full place-items-center text-xs text-muted-foreground">Sin curva en este periodo.</div>
        )}
      </div>
      <p className="mt-5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Por día de la semana</p>
      <div className="mt-2 h-36 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={week} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 6" />
            <XAxis dataKey="label" axisLine={false} tickLine={false} tickMargin={8} fontSize={11} stroke="var(--muted-foreground)" />
            <YAxis
              orientation="right"
              axisLine={false}
              tickLine={false}
              tickMargin={8}
              width={28}
              fontSize={11}
              allowDecimals={false}
              stroke="var(--muted-foreground)"
            />
            <Tooltip
              cursor={{ fill: 'var(--muted)', fillOpacity: 0.4 }}
              content={({ active, payload }) => {
                const day = payload?.[0]?.payload as { label: string; units: number } | undefined;
                if (!active || !day) return null;
                return (
                  <div className="rounded-md bg-popover px-2.5 py-1.5 text-xs shadow-sm ring-1 ring-foreground/5">
                    <p className="font-medium">{day.label}</p>
                    <p className="tabular-nums text-muted-foreground">{formatSalesCount(day.units)} u</p>
                  </div>
                );
              }}
            />
            <Bar dataKey="units" fill="var(--foreground)" fillOpacity={0.78} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-4 rounded-md border border-border bg-muted/30 px-3 py-3">
        <p className="text-sm font-medium">{note.title}</p>
        {note.detail ? <p className="mt-1 text-xs text-muted-foreground">{note.detail}</p> : null}
      </div>
      <div className="mt-4 flex items-end justify-between gap-3 border-t border-border pt-4">
        <div>
          <p className="text-xs text-muted-foreground">
            {restocking
              ? `Para ${product.horizonDays || 30} días, con las ${formatSalesCount(product.available || 0)} que quedan`
              : `Con ${formatSalesCount(product.available || 0)} u cubres el ritmo actual`}
          </p>
          <p className={cn('mt-1 text-2xl font-semibold tracking-tight', !restocking && TONE.take)}>
            {restocking ? `Trae ${formatSalesCount(product.restockQty || 0)} u` : 'No traigas'}
          </p>
        </div>
        <p className="text-xs tabular-nums text-muted-foreground">{restockFormula(product)}</p>
      </div>
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
  loading,
}: {
  tracked: ProductSaleBuyer[];
  others?: ProductSaleBuyer[];
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const withPhone = tracked.filter(hasBuyerPhone);
  return (
    <section aria-label="Compradores con teléfono">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 rounded-md border border-border px-4 py-3 text-left hover:bg-muted/40"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>
          <span className="block text-sm font-medium">Compradores con teléfono</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Más de 5 unidades. Solo si hay celular para contactarlos.
          </span>
        </span>
        <span className="flex items-center gap-2 text-sm tabular-nums text-muted-foreground">
          {loading ? '—' : formatSalesCount(withPhone.length)}
          <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
        </span>
      </button>
      {open ? (
        <div className="mt-3">
          {loading ? <Skeleton className="h-40 w-full" /> : withPhone.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nadie con teléfono pasó de 5 u en este periodo.</p>
          ) : (
            <BuyersTable buyers={withPhone} defaultSort="units" detailed />
          )}
        </div>
      ) : null}
    </section>
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
              <Metric label="Unidades / día" value={formatUnitsPerDay(product.unitsPerDay)} />
              <Metric label="Te deja / día" value={formatKeepsPerDay(product.keepsPerDay)} tone="receive" />
              <Metric label="Stock" value={`${formatSalesCount(product.available || 0)} u`} />
              <Metric label="Se acaba en" value={formatCoverDays(product.coverDays) || '—'} />
            </div>
            <ProductSalesCurve product={product} />
            <div className="mt-5 grid grid-cols-2 gap-4">
              <Metric label="Ventas brutas" value={formatSalesMoney(product.grossSales)} />
              <Metric
                label="Falabella"
                value={formatSalesMoneyOrDash(product.falabellaTake)}
                hint={falabellaMoneyHint(product)}
                tone="take"
              />
              <Metric label="Unidades" value={`${formatSalesCount(product.unitsSold)} u · ${formatSalesCount(product.ordersCount)} pedidos`} />
              <Metric
                label="Te llega"
                value={formatSalesMoneyOrDash(product.arrives)}
                hint={arrivesMoneyHint(product)}
                tone="receive"
              />
            </div>
            <div className="mt-4">
              <PayoutCompare paid={product.paidArrives} pending={product.pendingArrives} />
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
