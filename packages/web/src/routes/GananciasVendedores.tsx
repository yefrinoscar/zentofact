import { useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, HandCoins, Info, Search, TriangleAlert, X } from 'lucide-react';
import api from '../lib/api';
import { cn } from '../lib/cn';
import DocumentDateRangePicker from '../components/DocumentDateRangePicker';
import { DataTablePagination } from '../components/ui/data-table';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Skeleton } from '../components/ui/skeleton';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TablePanel, TableRow } from '../components/ui/table';
import {
  defaultDocumentDateRange,
  documentDateRangeLabel,
  type DocumentDateRange,
} from '../lib/documentDateRange';
import {
  EARNINGS_PAGE_SIZE,
  EARNINGS_QUERY_KEY,
  EARNINGS_SALES_PAGE_SIZE,
  commissionRuleHint,
  commissionRuleIsIncomplete,
  commissionRuleLabel,
  earningPaymentLabel,
  earningsKpis,
  formatCommissionShare,
  formatEarningCount,
  formatEarningMoney,
  formatSaleDate,
  incompleteCommissionLabel,
  nextEarningsSort,
  ordersLabel,
  saleItemsLabel,
  salespersonSubtitle,
  type EarningsKpi,
  type EarningsSortBy,
  type EarningsSortDir,
  type SalespersonEarningRow,
  type SalespersonEarningSale,
} from '../lib/salesperson-earnings-presentation';

type ColumnId = 'name' | 'orders' | 'salesTotal' | 'commission' | 'commissionShare' | 'averageTicket';

const COLUMN_CLASS: Record<ColumnId, string> = {
  name: 'w-[38%] sm:w-[28%]',
  orders: 'hidden w-[11%] text-right md:table-cell',
  salesTotal: 'w-[31%] text-right sm:w-[16%]',
  commission: 'w-[31%] text-right sm:w-[18%]',
  commissionShare: 'hidden w-[12%] text-right sm:table-cell',
  averageTicket: 'hidden w-[15%] text-right lg:table-cell',
};

export default function GananciasVendedores() {
  const queryClient = useQueryClient();
  const [range, setRange] = useState<DocumentDateRange>(() => defaultDocumentDateRange());
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [sort, setSort] = useState<{ sortBy: EarningsSortBy; sortDir: EarningsSortDir }>({ sortBy: 'commission', sortDir: 'desc' });
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<SalespersonEarningRow | null>(null);
  const [salesOffset, setSalesOffset] = useState(0);

  const filter = {
    from: range.from,
    to: range.to,
    search: submittedSearch || undefined,
    sortBy: sort.sortBy,
    sortDir: sort.sortDir,
    limit: EARNINGS_PAGE_SIZE,
    offset,
  };

  const earningsQuery = useQuery({
    queryKey: [EARNINGS_QUERY_KEY, filter],
    queryFn: () => api.listSalespersonEarnings(filter),
    placeholderData: keepPreviousData,
  });

  const applySearch = (value: string, submit = false) => {
    setSearch(value);
    if (submit || value === '') {
      setSubmittedSearch(value.trim());
      setOffset(0);
    }
  };

  const applyRange = (next: DocumentDateRange) => {
    setRange(next);
    setOffset(0);
  };

  const applySort = (column: EarningsSortBy) => {
    setSort((current) => nextEarningsSort(current, column));
    setOffset(0);
  };

  const openSalesperson = (row: SalespersonEarningRow) => {
    setSalesOffset(0);
    setSelected(row);
  };

  const prefetchPage = (nextOffset: number) => {
    const next = { ...filter, offset: nextOffset };
    void queryClient.prefetchQuery({
      queryKey: [EARNINGS_QUERY_KEY, next],
      queryFn: () => api.listSalespersonEarnings(next),
    });
  };

  const sortHeader = (column: EarningsSortBy, label: string, className?: string) => (
    <SortHeader
      label={label}
      active={sort.sortBy === column}
      dir={sort.sortDir}
      className={className}
      onClick={() => applySort(column)}
    />
  );

  const columns: ColumnDef<SalespersonEarningRow>[] = [
    {
      id: 'name',
      header: () => sortHeader('name', 'Vendedor'),
      cell: ({ row }) => <SalespersonCell row={row.original} />,
    },
    {
      id: 'orders',
      header: () => sortHeader('orders', 'Ventas', 'justify-end'),
      cell: ({ row }) => (
        <div>
          <span className="font-medium">{formatEarningCount(row.original.ordersCount)}</span>
          <span className="block text-xs text-muted-foreground">{formatEarningCount(row.original.unitsSold)} u</span>
        </div>
      ),
    },
    {
      id: 'salesTotal',
      header: () => sortHeader('salesTotal', 'Vendido', 'justify-end'),
      cell: ({ row }) => <span className="font-medium">{formatEarningMoney(row.original.salesTotal)}</span>,
    },
    {
      id: 'commission',
      header: () => sortHeader('commission', 'Comisión', 'justify-end'),
      cell: ({ row }) => <CommissionCell row={row.original} />,
    },
    {
      id: 'commissionShare',
      header: () => sortHeader('commissionShare', '% venta', 'justify-end'),
      cell: ({ row }) => formatCommissionShare(row.original.commissionShare),
    },
    {
      id: 'averageTicket',
      header: () => <span className="font-medium text-muted-foreground">Ticket promedio</span>,
      cell: ({ row }) => (row.original.averageTicket == null ? '—' : formatEarningMoney(row.original.averageTicket)),
    },
  ];

  const rows = earningsQuery.data?.salespeople ?? [];
  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
    getRowId: (row) => row.userId,
  });

  const totals = earningsQuery.data?.totals;
  const kpis = earningsKpis(totals);
  const totalCount = earningsQuery.data?.totalCount ?? 0;
  const loading = earningsQuery.isPending && !earningsQuery.data;
  const fetching = earningsQuery.isFetching;
  const error = earningsQuery.error instanceof Error ? earningsQuery.error.message : '';

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
            placeholder="Buscar vendedor"
            className="h-11 px-9 sm:h-9"
            aria-label="Buscar vendedor por nombre o correo"
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
      </div>

      {error ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
          <span>No se pudieron cargar las ganancias. {error}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void earningsQuery.refetch()}>
            Reintentar
          </Button>
        </div>
      ) : null}

      <EarningsKpis items={kpis} loading={loading} />

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        <span>
          Es la comisión de cada vendedor, no la utilidad del negocio. Cuenta ventas en soles,
          sin cancelados, devueltos ni reembolsados.
          {totals && totals.otherCurrencyOrders > 0
            ? ` ${ordersLabel(totals.otherCurrencyOrders)} en otra moneda no se suman.`
            : ''}
        </span>
      </p>

      <TablePanel aria-label="Ganancias por vendedor" aria-busy={loading || fetching}>
        {loading ? (
          <EarningsTableSkeleton />
        ) : rows.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <HandCoins className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium">
              {submittedSearch ? 'Ningún vendedor coincide' : 'No hay vendedores'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {submittedSearch
                ? 'Prueba con otro nombre o correo.'
                : 'Crea un usuario con perfil Vendedor en Usuarios.'}
            </p>
          </div>
        ) : (
          <div className={cn('min-w-0 transition-opacity', fetching && 'opacity-70')}>
            <Table className="daisy-table daisy-table-sm table-fixed">
              <TableHeader>
                {table.getHeaderGroups().map((group) => (
                  <TableRow key={group.id} className="hover:bg-transparent">
                    {group.headers.map((header) => (
                      <TableHead key={header.id} className={cn('h-9 px-3 text-xs', COLUMN_CLASS[header.column.id as ColumnId])}>
                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer align-middle focus-visible:bg-muted/30 focus-visible:outline-none"
                    tabIndex={0}
                    aria-label={`Ver ventas de ${row.original.name}`}
                    onClick={() => openSalesperson(row.original)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openSalesperson(row.original);
                      }
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          'px-3 py-2.5 tabular-nums',
                          COLUMN_CLASS[cell.column.id as ColumnId],
                          (cell.column.id === 'name' || cell.column.id === 'commission') && 'whitespace-normal',
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {!loading && rows.length > 0 ? (
          <DataTablePagination
            pageIndex={Math.floor(offset / EARNINGS_PAGE_SIZE)}
            pageSize={EARNINGS_PAGE_SIZE}
            totalCount={totalCount}
            fetching={fetching}
            onPageChange={(page) => setOffset(page * EARNINGS_PAGE_SIZE)}
            onPrefetch={(page) => prefetchPage(page * EARNINGS_PAGE_SIZE)}
          />
        ) : null}
      </TablePanel>

      <SalespersonSalesDrawer
        salesperson={selected}
        range={range}
        offset={salesOffset}
        onOffsetChange={setSalesOffset}
        onClose={() => setSelected(null)}
      />
    </div>
  );
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
  dir: EarningsSortDir;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={cn('inline-flex w-full items-center gap-1 font-medium text-muted-foreground hover:text-foreground', className)}
      aria-label={active
        ? `Ordenar por ${label}. Orden actual: ${dir === 'asc' ? 'menor a mayor' : 'mayor a menor'}.`
        : `Ordenar por ${label}`}
      onClick={onClick}
    >
      {label}
      {active
        ? dir === 'asc'
          ? <ArrowUp className="size-3.5" aria-hidden="true" />
          : <ArrowDown className="size-3.5" aria-hidden="true" />
        : <ArrowUpDown className="size-3.5 opacity-45" aria-hidden="true" />}
    </button>
  );
}

function SalespersonCell({ row }: { row: SalespersonEarningRow }) {
  const subtitle = salespersonSubtitle(row);
  const incomplete = incompleteCommissionLabel(row);
  return (
    <div className="min-w-0">
      <strong className={cn('line-clamp-2 break-words text-[13px] leading-4', !row.active && 'text-muted-foreground')}>
        {row.name}
      </strong>
      {subtitle ? <span className="mt-0.5 block truncate text-xs text-muted-foreground">{subtitle}</span> : null}
      {incomplete ? (
        <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
          {incomplete}
        </span>
      ) : null}
    </div>
  );
}

function CommissionCell({ row }: { row: SalespersonEarningRow }) {
  if (row.ordersCount === 0) return <span className="text-muted-foreground">Sin ventas</span>;
  return (
    <div>
      <span className="font-semibold">{formatEarningMoney(row.commission)}</span>
      <span className="block text-xs text-muted-foreground">{formatEarningMoney(row.paidCommission)} pagadas</span>
    </div>
  );
}

function EarningsKpis({ items, loading }: { items: EarningsKpi[]; loading: boolean }) {
  const placeholders: EarningsKpi['key'][] = ['commission', 'salesTotal', 'share', 'incomplete'];
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4" aria-label="Resumen de ganancias">
      {loading || items.length === 0
        ? placeholders.map((key) => (
          <div key={key} className="min-w-0 space-y-2">
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-3.5 w-20" />
          </div>
        ))
        : items.map((item) => (
          <div key={item.key} className="min-w-0">
            <span
              className={cn(
                'block truncate text-2xl font-semibold tabular-nums tracking-tight',
                item.tone === 'warning' && 'text-amber-700 dark:text-amber-400',
              )}
            >
              {item.value}
            </span>
            <span className="mt-1 block text-sm font-medium">{item.label}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{item.hint}</span>
          </div>
        ))}
    </div>
  );
}

function EarningsTableSkeleton() {
  const columns = Object.keys(COLUMN_CLASS) as ColumnId[];
  return (
    <div className="min-w-0" aria-label="Cargando ganancias" aria-busy="true">
      <Table className="table-fixed">
        <TableBody>
          {Array.from({ length: 5 }, (_, row) => (
            <TableRow key={row} className="hover:bg-transparent">
              {columns.map((column) => (
                <TableCell key={column} className={cn('h-14 px-3 py-2', COLUMN_CLASS[column])}>
                  {column === 'name'
                    ? <div className="space-y-2"><Skeleton className="h-3.5 w-4/5" /><Skeleton className="h-3 w-24" /></div>
                    : <Skeleton className="ml-auto h-4 w-16" />}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function SalespersonSalesDrawer({
  salesperson,
  range,
  offset,
  onOffsetChange,
  onClose,
}: {
  salesperson: SalespersonEarningRow | null;
  range: DocumentDateRange;
  offset: number;
  onOffsetChange: (offset: number) => void;
  onClose: () => void;
}) {
  const filter = { from: range.from, to: range.to, limit: EARNINGS_SALES_PAGE_SIZE, offset };
  const salesQuery = useQuery({
    queryKey: [EARNINGS_QUERY_KEY, 'sales', salesperson?.userId, filter],
    queryFn: () => api.listSalespersonEarningSales(salesperson!.userId, filter),
    enabled: salesperson != null,
    placeholderData: keepPreviousData,
  });
  const sales = salesperson && salesQuery.data?.salesperson.userId === salesperson.userId
    ? salesQuery.data.sales
    : [];
  const loading = salesQuery.isPending || (salesQuery.isFetching && sales.length === 0);
  const error = salesQuery.error instanceof Error ? salesQuery.error.message : '';

  return (
    <Sheet open={salesperson != null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="flex w-full flex-col overflow-hidden sm:max-w-xl">
        <SheetHeader className="px-6 pt-7 sm:px-8">
          <SheetTitle>{salesperson?.name || 'Vendedor'}</SheetTitle>
          <SheetDescription>Ventas del {documentDateRangeLabel(range)}</SheetDescription>
        </SheetHeader>
        {salesperson ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-2 sm:px-8">
            <div className="grid grid-cols-2 gap-4">
              <Metric label="Comisión" value={formatEarningMoney(salesperson.commission)} hint={`${formatEarningMoney(salesperson.paidCommission)} de ventas pagadas`} />
              <Metric label="Vendido" value={formatEarningMoney(salesperson.salesTotal)} hint={`${ordersLabel(salesperson.ordersCount)} · ${formatEarningCount(salesperson.unitsSold)} u`} />
              <Metric label="% de la venta" value={formatCommissionShare(salesperson.commissionShare)} />
              <Metric
                label="Sin comisión completa"
                value={ordersLabel(salesperson.incompleteOrders)}
                hint={salesperson.incompleteOrders > 0 ? 'Suman de menos.' : undefined}
                warning={salesperson.incompleteOrders > 0}
              />
            </div>
            {salesperson.percentOrders > 0 ? (
              <p className="mt-4 text-xs text-muted-foreground">
                {ordersLabel(salesperson.percentOrders)} sin comisión por producto usan el {formatEarningCount(salesperson.commissionPercent)}% del vendedor.
              </p>
            ) : null}

            <p className="mt-8 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Ventas</p>
            {error ? (
              <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 text-sm text-destructive">
                <span>No se pudieron cargar las ventas. {error}</span>
                <Button type="button" variant="outline" size="sm" onClick={() => void salesQuery.refetch()}>Reintentar</Button>
              </div>
            ) : loading ? (
              <div className="mt-3 space-y-4" aria-busy="true" aria-label="Cargando ventas">
                {Array.from({ length: 4 }, (_, index) => (
                  <div key={index} className="space-y-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                ))}
              </div>
            ) : sales.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">Sin ventas en este periodo.</p>
            ) : (
              <>
                <div className={cn('mt-2 divide-y divide-border/70', salesQuery.isFetching && 'opacity-70')}>
                  {sales.map((sale) => <SaleRow key={sale.orderId} sale={sale} />)}
                </div>
                {(salesQuery.data?.totalCount ?? 0) > EARNINGS_SALES_PAGE_SIZE ? (
                  <div className="-mx-3 mt-2">
                    <DataTablePagination
                      pageIndex={Math.floor(offset / EARNINGS_SALES_PAGE_SIZE)}
                      pageSize={EARNINGS_SALES_PAGE_SIZE}
                      totalCount={salesQuery.data?.totalCount ?? 0}
                      fetching={salesQuery.isFetching}
                      onPageChange={(page) => onOffsetChange(page * EARNINGS_SALES_PAGE_SIZE)}
                    />
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function SaleRow({ sale }: { sale: SalespersonEarningSale }) {
  const incomplete = commissionRuleIsIncomplete(sale.commissionRule);
  return (
    <article className="py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">{sale.orderNumber}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatSaleDate(sale.soldAt)}
            {sale.customerName ? ` · ${sale.customerName}` : ''}
            {` · ${earningPaymentLabel(sale.paymentStatus)}`}
          </p>
        </div>
        <div className="shrink-0 text-right tabular-nums">
          <p className={cn('text-sm font-semibold', incomplete && 'text-amber-700 dark:text-amber-400')}>
            {formatEarningMoney(sale.commission)}
          </p>
          <p className="text-xs text-muted-foreground">de {formatEarningMoney(sale.total)}</p>
        </div>
      </div>
      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{saleItemsLabel(sale.items)}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Badge
          variant={incomplete ? 'destructive' : 'outline'}
          className={cn('h-5 rounded-md px-1.5 text-[10px] font-semibold', !incomplete && 'text-muted-foreground')}
        >
          {commissionRuleLabel(sale.commissionRule)}
        </Badge>
        {sale.commissionRule !== 'catalog' ? (
          <span className="text-xs text-muted-foreground">{commissionRuleHint(sale.commissionRule, sale.linesWithoutCommission)}</span>
        ) : null}
      </div>
    </article>
  );
}

function Metric({
  label,
  value,
  hint,
  warning = false,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  warning?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('mt-1 truncate text-lg font-semibold tabular-nums tracking-tight', warning && 'text-amber-700 dark:text-amber-400')}>
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
