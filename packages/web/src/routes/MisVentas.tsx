import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef, getCoreRowModel, type SortingState, useReactTable } from '@tanstack/react-table';
import { Plus, ShoppingBag } from 'lucide-react';
import api from '../lib/api';
import {
  DEFAULT_MIS_VENTAS_QUERY,
  MIS_VENTAS_PAGE_SIZE,
  formatSaleMoney,
  misVentasHomeKey,
  saleListRow,
  type MisVentasQuery,
  type SalesSortBy,
  type SalespersonHome,
  type SalespersonSale,
} from '../lib/mis-ventas-presentation';
import {
  humanizeSaleError,
  registeredFromMisVentasState,
  saleSavedSnackbarMessage,
  saleSaveFailedSnackbarMessage,
  type MisVentasLocationState,
} from '../lib/sale-feedback';
import { useOperatorSnackbar } from '../components/OperatorSnackbar';
import { MisVentasCharts } from '../components/MisVentasCharts';
import { cn } from '../lib/cn';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { DataTable, DataTableColumnHeader, DataTablePagination } from '../components/ui/data-table';

type SaleRow = ReturnType<typeof saleListRow> & { key: string };

const integer = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 0 });

function sortToQuery(sorting: SortingState): Pick<MisVentasQuery, 'sortBy' | 'sortDir'> {
  const [sort] = sorting;
  if (!sort) return { sortBy: DEFAULT_MIS_VENTAS_QUERY.sortBy, sortDir: DEFAULT_MIS_VENTAS_QUERY.sortDir };
  // Commission is a fixed share of the total, so both columns share the server sort.
  const sortBy: SalesSortBy = sort.id === 'total' || sort.id === 'commission' ? 'total' : 'orderedAt';
  return { sortBy, sortDir: sort.desc ? 'desc' : 'asc' };
}

function EmptySales() {
  return (
    <div className="flex flex-col items-center gap-2 py-14 text-center">
      <ShoppingBag className="size-8 text-muted-foreground/50" />
      <p className="text-sm font-medium">Aún no hay ventas tuyas</p>
      <p className="text-sm text-muted-foreground">Registra la primera para verla aquí.</p>
    </div>
  );
}

function MobileSalesList({
  rows,
  loading,
  highlightOrder,
}: {
  rows: SaleRow[];
  loading: boolean;
  highlightOrder: string;
}) {
  if (loading) {
    return (
      <ul className="divide-y divide-border" aria-hidden>
        {Array.from({ length: 5 }, (_, index) => (
          <li key={index} className="flex items-start justify-between gap-3 py-3">
            <div className="flex-1 space-y-2">
              <div className="h-4 w-28 animate-pulse rounded bg-muted" />
              <div className="h-3 w-40 animate-pulse rounded bg-muted" />
              <div className="h-3 w-32 animate-pulse rounded bg-muted" />
            </div>
            <div className="h-4 w-16 animate-pulse rounded bg-muted" />
          </li>
        ))}
      </ul>
    );
  }
  if (rows.length === 0) return <EmptySales />;
  return (
    <ul className="divide-y divide-border" aria-label="Mis ventas">
      {rows.map((row) => {
        const highlighted = Boolean(highlightOrder) && row.number === highlightOrder;
        return (
          <li
            key={row.key}
            className={cn(
              'flex items-start justify-between gap-3 py-3 transition-colors duration-700',
              highlighted && '-mx-2 rounded-lg bg-primary/8 px-2',
            )}
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{row.number}</p>
              <p className="truncate text-sm text-muted-foreground">{row.customer}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{row.payment} · {row.date}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-sm font-semibold tabular-nums">{formatSaleMoney(row.total)}</p>
              <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">{formatSaleMoney(row.commission)} comisión</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default function MisVentas() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { showSnackbar } = useOperatorSnackbar();
  const [highlightOrder, setHighlightOrder] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'orderedAt', desc: true }]);

  const query: MisVentasQuery = {
    limit: MIS_VENTAS_PAGE_SIZE,
    offset: pageIndex * MIS_VENTAS_PAGE_SIZE,
    ...sortToQuery(sorting),
  };
  const homeQuery = useQuery({
    queryKey: misVentasHomeKey(query),
    queryFn: () => api.getSalespersonHome(query) as Promise<SalespersonHome>,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
  const home = homeQuery.data;
  const commissionPercent = Number(home?.commissionPercent) || 0;
  const orders: SalespersonSale[] = home?.orders || [];
  const totalCount = Number(home?.ordersTotal ?? orders.length) || 0;
  const firstLoad = homeQuery.isPending && !home;
  const loadError = homeQuery.error
    ? humanizeSaleError((homeQuery.error as Error).message || 'No se pudieron cargar tus ventas.')
    : '';

  const rows = useMemo<SaleRow[]>(
    () => orders.map((order, index) => ({ ...saleListRow(order, commissionPercent), key: `${order.externalOrderNumber || 'venta'}-${index}` })),
    [orders, commissionPercent],
  );

  const prefetchPage = (nextPageIndex: number) => {
    const nextQuery = { ...query, offset: nextPageIndex * MIS_VENTAS_PAGE_SIZE };
    void queryClient.prefetchQuery({
      queryKey: misVentasHomeKey(nextQuery),
      queryFn: () => api.getSalespersonHome(nextQuery),
      staleTime: 15_000,
    });
  };

  const columns = useMemo<ColumnDef<SaleRow>[]>(() => [
    {
      id: 'sale',
      header: 'Venta',
      cell: ({ row }) => {
        const highlighted = Boolean(highlightOrder) && row.original.number === highlightOrder;
        return (
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-medium">
              <span className="truncate">{row.original.number}</span>
              {highlighted ? <Badge variant="secondary" className="shrink-0">Nueva</Badge> : null}
            </p>
            <p className="truncate text-sm text-muted-foreground">{row.original.customer}</p>
          </div>
        );
      },
    },
    {
      id: 'orderedAt',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Fecha" />,
      cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{row.original.date || '—'}</span>,
    },
    {
      id: 'payment',
      header: 'Pago',
      enableSorting: false,
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.payment}</span>,
    },
    {
      id: 'total',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Total" className="-mr-2 ml-0" />,
      cell: ({ row }) => <span className="font-semibold tabular-nums">{formatSaleMoney(row.original.total)}</span>,
    },
    {
      id: 'commission',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Comisión" className="-mr-2 ml-0" />,
      cell: ({ row }) => <span className="tabular-nums text-primary">{formatSaleMoney(row.original.commission)}</span>,
    },
  ], [highlightOrder]);

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.key,
    manualPagination: true,
    manualSorting: true,
    enableMultiSort: false,
    rowCount: totalCount,
    onSortingChange: (updater) => {
      setPageIndex(0);
      setSorting(updater);
    },
    state: {
      sorting,
      pagination: { pageIndex, pageSize: MIS_VENTAS_PAGE_SIZE },
    },
  });

  useEffect(() => {
    const state = location.state as MisVentasLocationState | null;
    if (!state?.registered && !state?.saveFailed) return;

    const registered = registeredFromMisVentasState(state);
    if (registered && !state.saveFailed) {
      setHighlightOrder(String(registered.number || '').trim());
      showSnackbar({
        message: saleSavedSnackbarMessage(registered),
        tone: 'success',
      });
      window.setTimeout(() => setHighlightOrder(''), 2800);
    }

    if (state.saveFailed) {
      showSnackbar({
        message: saleSaveFailedSnackbarMessage(state.saveError),
        tone: 'error',
        duration: null,
        action: {
          label: 'Reintentar',
          onClick: () => navigate('/orders/nueva'),
        },
      });
    }

    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate, showSnackbar]);

  const pagination = !firstLoad && totalCount > MIS_VENTAS_PAGE_SIZE ? (
    <DataTablePagination
      pageIndex={pageIndex}
      pageSize={MIS_VENTAS_PAGE_SIZE}
      totalCount={totalCount}
      fetching={homeQuery.isFetching}
      onPageChange={setPageIndex}
      onPrefetch={prefetchPage}
    />
  ) : null;
  const countLabel = `${integer.format(totalCount)} ${totalCount === 1 ? 'venta' : 'ventas'} en los últimos 30 días`;

  return (
    <div className="space-y-5 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-stretch sm:justify-end">
        <Button type="button" className="h-11 w-full sm:h-9 sm:w-auto" onClick={() => navigate('/orders/nueva')}>
          <Plus data-icon="inline-start" />
          Registrar venta
        </Button>
      </div>

      <MisVentasCharts home={home} loading={firstLoad} />

      {loadError && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-3 text-sm text-destructive">
          <p>{loadError}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2 h-9 cursor-pointer"
            onClick={() => void homeQuery.refetch()}
          >
            Reintentar
          </Button>
        </div>
      )}

      <div className="hidden sm:block">
        <DataTable
          table={table}
          aria-label="Mis ventas"
          loading={firstLoad}
          fetching={homeQuery.isFetching}
          skeleton="plain"
          header={<p className="text-sm text-muted-foreground">{firstLoad ? 'Cargando ventas…' : countLabel}</p>}
          columnClassNames={{
            sale: 'w-[34%]',
            orderedAt: 'w-[18%]',
            payment: 'w-[16%]',
            total: 'w-[16%] text-right',
            commission: 'w-[16%] text-right',
          }}
          cellClassNames={{
            sale: 'whitespace-normal',
            total: 'text-right',
            commission: 'text-right',
          }}
          empty={<EmptySales />}
          footer={pagination ?? undefined}
        />
      </div>

      <section className="sm:hidden" aria-label="Mis ventas en móvil">
        {!firstLoad && totalCount > 0 ? (
          <p className="border-b border-border pb-2 text-xs text-muted-foreground" aria-live="polite">{countLabel}</p>
        ) : null}
        <MobileSalesList rows={rows} loading={firstLoad} highlightOrder={highlightOrder} />
        {pagination}
      </section>
    </div>
  );
}
