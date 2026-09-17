import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef, type Table as TanstackTable, type VisibilityState, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  ChevronDown,
  Columns3,
  ImageIcon,
  PackageCheck,
  PackageX,
  Search,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  X,
} from 'lucide-react';
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
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Skeleton } from '../components/ui/skeleton';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TablePanel, TableRow } from '../components/ui/table';
import { Tooltip as UiTooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
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
  formatVisits,
  formatUnitsPerDay,
  hasBuyerPhone,
  falabellaMoneyHint,
  formatSalesMoneyOrDash,
  paidMoneyHint,
  paidShare,
  pendingMoneyHint,
  productRestockAction,
  productRestockExplanation,
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

const COLUMN_LABELS = {
  product: 'Producto',
  grossSales: 'Ventas brutas',
  netSales: 'Ventas netas',
  units: 'Unidades vendidas: total',
  unitsPerDay: 'Unidades vendidas por día',
  returnLoss: 'Devolución',
  stock: 'Stock disponible',
  coverDays: 'Días de stock',
  keepsPerDay: 'Margen diario',
  orders: 'Pedidos',
  sellers: 'Sellers',
  visits: 'Visitas',
} as const;

type ProductSalesColumnId = keyof typeof COLUMN_LABELS;

function isProductSalesColumnId(id: string): id is ProductSalesColumnId {
  return id in COLUMN_LABELS;
}

const DEFAULT_COLUMN_VISIBILITY: VisibilityState = {
  keepsPerDay: false,
  orders: false,
  sellers: false,
  visits: false,
};

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

type SortBy = 'product' | 'units' | 'unitsPerDay' | 'keepsPerDay' | 'orders' | 'grossSales' | 'falabellaTake' | 'netSales' | 'returnLoss' | 'sellers';

const COLUMN_CLASS: Record<ProductSalesColumnId, string> = {
  product: 'w-[52%] min-w-0 sm:w-[39%]',
  grossSales: 'hidden sm:table-cell sm:w-[9%] text-right',
  netSales: 'hidden sm:table-cell sm:w-[9%] text-right',
  units: 'w-[13.5%] sm:w-[7%] text-right',
  unitsPerDay: 'w-[13.5%] sm:w-[7%] text-right',
  returnLoss: 'hidden sm:table-cell sm:w-[10%] text-right',
  stock: 'w-[21%] sm:w-[10%] text-right',
  coverDays: 'hidden sm:table-cell sm:w-[9%] text-right',
  keepsPerDay: 'hidden md:table-cell md:w-[9%] text-right',
  orders: 'hidden md:table-cell md:w-[7%] text-right',
  sellers: 'hidden lg:table-cell lg:w-[7%] text-right',
  visits: 'hidden lg:table-cell lg:w-[7%] text-right',
};

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
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() => DEFAULT_COLUMN_VISIBILITY);

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
      enableHiding: false,
      header: () => <SortHeader label="Producto" active={sortBy === 'product'} dir={sortDir} onClick={() => applySort('product')} />,
      cell: ({ row }) => <ProductCell product={row.original} />,
    },
    {
      id: 'salesAmounts',
      header: () => <span className="font-medium text-muted-foreground">Ventas</span>,
      columns: [
        {
          id: 'grossSales',
          accessorKey: 'grossSales',
          header: () => (
            <SortHeader
              label="ventas brutas"
              displayLabel="Brutas"
              active={sortBy === 'grossSales'}
              dir={sortDir}
              className="justify-end text-[11px]"
              onClick={() => applySort('grossSales')}
            />
          ),
          cell: ({ row }) => <span className="font-medium tabular-nums">{formatSalesMoney(row.original.grossSales)}</span>,
        },
        {
          id: 'netSales',
          accessorKey: 'netSales',
          header: () => (
            <SortHeader
              label="ventas netas después de cobros del canal"
              displayLabel="Netas"
              active={sortBy === 'netSales'}
              dir={sortDir}
              className="justify-end text-[11px]"
              onClick={() => applySort('netSales')}
            />
          ),
          cell: ({ row }) => (
            <span
              className="font-medium tabular-nums"
              title={row.original.netSales == null ? 'Aún no hay una liquidación cruzada en Pagos.' : 'Después de comisión y logística.'}
            >
              {formatSalesMoneyOrDash(row.original.netSales)}
            </span>
          ),
        },
      ],
    },
    {
      id: 'soldUnits',
      header: () => <span className="font-medium text-muted-foreground">Unidades vendidas</span>,
      columns: [
        {
          id: 'units',
          accessorKey: 'unitsSold',
          header: () => (
            <SortHeader
              label="total de unidades vendidas"
              displayLabel="Total"
              active={sortBy === 'units'}
              dir={sortDir}
              className="justify-end text-[11px]"
              onClick={() => applySort('units')}
            />
          ),
          cell: ({ row }) => <span className="tabular-nums">{formatSalesCount(row.original.unitsSold)}</span>,
        },
        {
          id: 'unitsPerDay',
          accessorKey: 'unitsPerDay',
          header: () => (
            <SortHeader
              label="unidades vendidas por día"
              displayLabel="Por día"
              active={sortBy === 'unitsPerDay'}
              dir={sortDir}
              className="justify-end text-[11px]"
              onClick={() => applySort('unitsPerDay')}
            />
          ),
          cell: ({ row }) => <span className="tabular-nums">{formatUnitsPerDay(row.original.unitsPerDay)}</span>,
        },
      ],
    },
    {
      id: 'stock',
      accessorKey: 'available',
      header: () => <span className="font-medium text-muted-foreground">Stock</span>,
      cell: ({ row }) => <StockCell product={row.original} />,
    },
    {
      id: 'coverDays',
      accessorKey: 'coverDays',
      header: () => <span className="font-medium text-muted-foreground">Cobertura</span>,
      cell: ({ row }) => <CoverCell product={row.original} />,
    },
    {
      id: 'keepsPerDay',
      accessorKey: 'keepsPerDay',
      header: () => (
        <SortHeader
          label="Margen diario"
          active={sortBy === 'keepsPerDay'}
          dir={sortDir}
          className={TONE.receive}
          onClick={() => applySort('keepsPerDay')}
        />
      ),
      cell: ({ row }) => (
        <span
          className={cn('tabular-nums font-medium', row.original.hasWholesaleCost ? TONE.receive : 'text-muted-foreground')}
          title={row.original.hasWholesaleCost ? 'Ventas menos costo mayorista.' : 'Falta el precio mayorista.'}
        >
          {formatKeepsPerDay(row.original.hasWholesaleCost ? row.original.keepsPerDay : null)}
        </span>
      ),
    },
    {
      id: 'orders',
      accessorKey: 'ordersCount',
      header: () => <SortHeader label="Pedidos" active={sortBy === 'orders'} dir={sortDir} onClick={() => applySort('orders')} />,
      cell: ({ row }) => <span className="tabular-nums">{formatSalesCount(row.original.ordersCount)}</span>,
    },
    {
      id: 'sellers',
      accessorKey: 'sellersCount',
      header: () => <SortHeader label="Sellers" active={sortBy === 'sellers'} dir={sortDir} onClick={() => applySort('sellers')} />,
      cell: ({ row }) => <span className="tabular-nums">{formatSalesCount(row.original.sellersCount)}</span>,
    },
    {
      id: 'visits',
      accessorKey: 'visits',
      header: () => <span className="font-medium text-muted-foreground">Visitas</span>,
      cell: ({ row }) => <span className="tabular-nums">{formatVisits(row.original.visits)}</span>,
    },
    {
      id: 'returnLoss',
      accessorKey: 'returnLoss',
      header: () => (
        <SortHeader
          label="pérdida por devolución: comisión y logística no revertidas"
          displayLabel="Devolución"
          active={sortBy === 'returnLoss'}
          dir={sortDir}
          className="justify-end"
          onClick={() => applySort('returnLoss')}
        />
      ),
      cell: ({ row }) => {
        const loss = Number(row.original.returnLoss || 0);
        return (
          <span className={cn('font-medium tabular-nums', loss > 0 ? TONE.take : 'text-muted-foreground')}>
            {loss > 0 ? `− ${formatSalesMoney(loss)}` : formatSalesMoney(0)}
          </span>
        );
      },
    },
  ], [sortBy, sortDir]);

  const table = useReactTable({
    data: products,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.productKey,
    manualSorting: true,
    state: { columnVisibility },
    onColumnVisibilityChange: setColumnVisibility,
  });

  const kpis = productSalesKpis(totals);
  const error = salesQuery.error instanceof Error ? salesQuery.error.message : '';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64 lg:w-72">
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
        <ColumnVisibilityMenu table={table} />
      </div>

      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}

      <SalesKpis items={kpis} loading={loading} />

      <TablePanel aria-label="Ventas de productos" aria-busy={loading || fetching}>
        {loading || fetching ? (
          <SalesTableSkeleton table={table} />
        ) : products.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <BarChart3 className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">Sin ventas en este periodo</p>
            <p className="mt-1 text-xs text-muted-foreground">Cambia el rango o el seller para ver otros maestros.</p>
          </div>
        ) : (
          <div className="min-w-0" aria-busy={fetching}>
            <Table className="daisy-table daisy-table-sm table-fixed">
              <ProductSalesTableHeader table={table} />
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer align-middle focus-visible:bg-muted/30 focus-visible:outline-none"
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
                          'px-3 py-2',
                          COLUMN_CLASS[cell.column.id as ProductSalesColumnId],
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

      <SalesOverview daily={daily} loading={loading} />

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

function ColumnVisibilityMenu({ table }: { table: TanstackTable<ProductSaleRow> }) {
  const configurableColumns = table.getAllLeafColumns().filter((column) => column.getCanHide());
  const visibleCount = configurableColumns.filter((column) => column.getIsVisible()).length + 1;
  const totalCount = configurableColumns.length + 1;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" className="w-full sm:w-auto" aria-label="Elegir columnas visibles">
          <Columns3 data-icon="inline-start" aria-hidden="true" />
          Columnas
          <span className="text-xs tabular-nums text-muted-foreground">{visibleCount}/{totalCount}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>Datos visibles</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {configurableColumns.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.id}
            checked={column.getIsVisible()}
            onCheckedChange={(checked) => column.toggleVisibility(Boolean(checked))}
            onSelect={(event) => event.preventDefault()}
          >
            {COLUMN_LABELS[column.id as ProductSalesColumnId]}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProductSalesTableHeader({ table }: { table: TanstackTable<ProductSaleRow> }) {
  return (
    <TableHeader>
      {table.getHeaderGroups().map((headerGroup) => (
        <TableRow key={headerGroup.id} className="hover:bg-transparent">
          {headerGroup.headers.map((header) => {
            const columnId = header.column.id;
            const columnClass = isProductSalesColumnId(columnId) ? COLUMN_CLASS[columnId] : '';
            return (
              <TableHead
                key={header.id}
                colSpan={header.colSpan}
                className={cn(
                  'h-8 px-3 text-xs',
                  columnClass,
                  columnId === 'salesAmounts' && 'hidden border-x border-border/70 bg-muted/50 text-center sm:table-cell sm:w-[18%]',
                  columnId === 'grossSales' && 'border-l border-border/70',
                  columnId === 'netSales' && 'border-r border-border/70',
                  columnId === 'soldUnits' && 'w-[27%] border-x border-border/70 bg-muted/50 text-center sm:w-[14%]',
                  columnId === 'units' && 'border-l border-border/70',
                  columnId === 'unitsPerDay' && 'border-r border-border/70',
                )}
              >
                {header.isPlaceholder
                  ? null
                  : flexRender(header.column.columnDef.header, header.getContext())}
              </TableHead>
            );
          })}
        </TableRow>
      ))}
    </TableHeader>
  );
}

function SortHeader({
  label,
  displayLabel,
  active,
  dir,
  onClick,
  className,
}: {
  label: string;
  displayLabel?: ReactNode;
  active: boolean;
  dir: 'asc' | 'desc';
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={cn('inline-flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground', className)}
      aria-label={active
        ? `Ordenar por ${label}. Orden actual: ${dir === 'asc' ? 'menor a mayor' : 'mayor a menor'}. El siguiente clic invierte el orden.`
        : `Ordenar por ${label}. Sin ordenar.`}
      title={active
        ? `Ordenado de ${dir === 'asc' ? 'menor a mayor' : 'mayor a menor'}; clic para invertir`
        : `Ordenar por ${label}`}
      onClick={onClick}
    >
      {displayLabel || label}
      {active
        ? dir === 'asc'
          ? <ArrowUp className="size-3.5" aria-hidden="true" />
          : <ArrowDown className="size-3.5" aria-hidden="true" />
        : <ArrowUpDown className="size-3.5 opacity-45" aria-hidden="true" />}
    </button>
  );
}

function ProductCell({ product }: { product: ProductSaleRow }) {
  return (
    <div className="grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-2.5">
      <ProductThumbnail product={product} />
      <div className="min-w-0">
        <strong className="line-clamp-2 whitespace-normal break-words text-[13px] leading-4">{product.name}</strong>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
          <CopyableSku sku={product.sku} />
          <PaceIcon pace={product.pace} />
          <RestockTag product={product} />
        </div>
      </div>
    </div>
  );
}

function ProductThumbnail({ product }: { product: ProductSaleRow }) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(product.imageUrl) && !failed;
  return (
    <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-muted/40">
      {showImage ? (
        <img
          src={product.imageUrl || undefined}
          alt=""
          loading="lazy"
          className="size-full object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <ImageIcon className="size-4 text-muted-foreground" aria-hidden="true" />
      )}
    </span>
  );
}

function PaceIcon({ pace }: { pace?: ProductSaleRow['pace'] }) {
  if (pace === 'up') {
    return <TrendingUp className="size-3.5 text-emerald-700 dark:text-emerald-400" aria-label="Ventas al alza" />;
  }
  if (pace === 'down') {
    return <TrendingDown className="size-3.5 text-muted-foreground" aria-label="Ventas a la baja" />;
  }
  return null;
}

function RestockTag({ product }: { product: ProductSaleRow }) {
  const action = productRestockAction(product);
  const label = action === 'bringBack' ? 'Volver a traer' : 'No traer';
  return (
    <UiTooltip>
      <TooltipTrigger asChild>
        <Badge
          asChild
          variant={action === 'bringBack' ? 'destructive' : 'outline'}
          className={cn(
            'h-5 cursor-help rounded-md px-1.5 text-[10px] font-semibold leading-none',
            action === 'bringBack' && 'hover:bg-destructive/20',
            action === 'doNotBring' && 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          <button
            type="button"
            aria-label={`Explicar recomendación: ${label}`}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {label}
          </button>
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} className="max-w-80 leading-4">
        {productRestockExplanation(product)}
      </TooltipContent>
    </UiTooltip>
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
  if (product.available == null) {
    return <Badge variant="outline" className="h-5 rounded-md px-1.5 text-[11px] text-muted-foreground">Sin dato</Badge>;
  }
  const soldOut = product.available <= 0;
  const low = stockIsLow(product.coverDays);
  const Icon = soldOut ? PackageX : low ? TriangleAlert : PackageCheck;
  return (
    <Badge
      variant="outline"
      className={cn(
        'ml-auto h-5 rounded-md px-1.5 text-[11px] tabular-nums',
        soldOut && 'border-destructive/25 bg-destructive/10 text-destructive',
        low && !soldOut && 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300',
        !low && !soldOut && 'border-emerald-500/25 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300',
      )}
    >
      <Icon data-icon="inline-start" aria-hidden="true" />
      {formatSalesCount(product.available)} u
      <span className="sr-only">{soldOut ? 'agotado' : low ? 'stock bajo' : 'stock disponible'}</span>
    </Badge>
  );
}

function CoverCell({ product }: { product: ProductSaleRow }) {
  const cover = formatCoverDays(product.coverDays);
  if (!cover) return <span className="text-muted-foreground">—</span>;
  return (
    <Badge
      variant="secondary"
      className={cn(
        'ml-auto h-5 rounded-md px-1.5 text-[11px] tabular-nums',
        stockIsLow(product.coverDays) && 'bg-destructive/10 text-destructive',
      )}
    >
      {cover}
    </Badge>
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
  const units = items.find((item) => item.key === 'unitsSold');
  return (
    <div className="grid gap-6 sm:grid-cols-2" aria-label="Indicadores de ventas">
      <div className="min-w-0">
        {loading || !brutas ? <Skeleton className="h-8 w-28" /> : (
          <span className="block truncate text-2xl font-semibold tabular-nums tracking-tight">{brutas.display}</span>
        )}
        <span className="mt-1 block text-sm font-medium">{brutas?.label || 'Ventas'}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{brutas?.why}</span>
      </div>
      <div className="min-w-0">
        {loading || !units ? <Skeleton className="h-8 w-20" /> : (
          <span className="block truncate text-2xl font-semibold tabular-nums tracking-tight">{units.display}</span>
        )}
        <span className="mt-1 block text-sm font-medium">{units?.label || 'Unidades vendidas'}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{units?.why}</span>
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
            <SortHeader label="Unidades compradas" active={sortBy === 'units'} dir={sortDir} onClick={() => applySort('units')} />
          </TableHead>
          <TableHead className="w-[18%]">
            <SortHeader label="Ventas" active={sortBy === 'grossSales'} dir={sortDir} onClick={() => applySort('grossSales')} />
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
              <Metric label="Vendidas / día" value={formatUnitsPerDay(product.unitsPerDay)} />
              <Metric
                label="Margen diario"
                value={formatKeepsPerDay(product.hasWholesaleCost ? product.keepsPerDay : null)}
                hint={product.hasWholesaleCost ? 'Ventas menos costo mayorista.' : 'Falta el precio mayorista.'}
                tone="receive"
              />
              <Metric label="Stock" value={`${formatSalesCount(product.available || 0)} u`} />
              <Metric label="Se acaba en" value={formatCoverDays(product.coverDays) || '—'} />
            </div>
            <ProductSalesCurve product={product} />
            <div className="mt-5 grid grid-cols-2 gap-4">
              <Metric label="Ventas" value={formatSalesMoney(product.grossSales)} />
              <Metric
                label="Falabella"
                value={formatSalesMoneyOrDash(product.falabellaTake)}
                hint={falabellaMoneyHint(product)}
                tone="take"
              />
              <Metric label="Unidades vendidas" value={`${formatSalesCount(product.unitsSold)} u · ${formatSalesCount(product.ordersCount)} pedidos`} />
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
                        <dt className="text-xs text-muted-foreground">Ventas</dt>
                        <dd className="mt-0.5 tabular-nums">{formatSalesMoney(seller.grossSales)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Falabella</dt>
                        <dd className={cn('mt-0.5 tabular-nums', TONE.take)} title={falabellaMoneyHint(seller)}>
                          {formatSalesMoneyOrDash(seller.falabellaTake)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Unidades vendidas</dt>
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

function SalesTableSkeleton({ table }: { table: TanstackTable<ProductSaleRow> }) {
  const columns = table.getVisibleLeafColumns()
    .map((column) => column.id)
    .filter(isProductSalesColumnId);
  return (
    <div className="min-w-0" aria-label="Cargando ventas" aria-busy="true">
      <Table className="table-fixed">
        <ProductSalesTableHeader table={table} />
        <TableBody>
          {Array.from({ length: 6 }, (_, row) => (
            <TableRow key={row} className="hover:bg-transparent">
              {columns.map((column) => (
                <TableCell key={column} className={cn('h-[66px] px-3 py-2', COLUMN_CLASS[column])}>
                  {column === 'product' ? (
                    <div className="flex items-center gap-2.5">
                      <Skeleton className="size-10 shrink-0 rounded-md" />
                      <div className="min-w-0 flex-1 space-y-2">
                        <Skeleton className="h-3.5 w-4/5" />
                        <Skeleton className="h-3 w-20" />
                      </div>
                    </div>
                  ) : <Skeleton className="ml-auto h-4 w-14" />}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
