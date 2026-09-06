import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef, getCoreRowModel, type SortingState, useReactTable } from '@tanstack/react-table';
import { ImagePlus, Plus, ShoppingBag } from 'lucide-react';
import api from '../lib/api';
import {
  DEFAULT_MIS_VENTAS_QUERY,
  MIS_VENTAS_PAGE_SIZE,
  MIS_VENTAS_QUERY_KEY,
  formatSaleMoney,
  misVentasHomeKey,
  saleListRow,
  saleMoreProductsLabel,
  type MisVentasQuery,
  type SalesSortBy,
  type SalespersonHome,
  type SalespersonSale,
} from '../lib/mis-ventas-presentation';
import { ProductPhoto } from './registrar-venta/widgets';
import {
  humanizeSaleError,
  registeredFromMisVentasState,
  saleSavedSnackbarMessage,
  saleSaveFailedSnackbarMessage,
  type MisVentasLocationState,
} from '../lib/sale-feedback';
import { useOperatorSnackbar } from '../components/OperatorSnackbar';
import { CopyableSku } from '../components/CopyableSku';
import { SalePaymentDialog } from '../components/SalePaymentDialog';
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
  const sortBy: SalesSortBy = sort.id === 'total' || sort.id === 'commission' ? sort.id : 'orderedAt';
  return { sortBy, sortDir: sort.desc ? 'desc' : 'asc' };
}

function SaleProductLine({
  product,
  fallback,
}: {
  product: SaleRow['products'][number];
  fallback: string;
}) {
  return (
    <li className="min-w-0">
      <p className="line-clamp-2 font-medium leading-5">
        {product.name || product.sku || fallback}
        {product.quantity > 1 ? (
          <span className="ml-1 font-normal text-muted-foreground">×{product.quantity}</span>
        ) : null}
      </p>
      {product.sku ? <CopyableSku sku={product.sku} /> : (
        <p className="text-xs text-muted-foreground">Sin SKU</p>
      )}
    </li>
  );
}

function SaleProducts({
  products,
  fallback,
  saleNumber,
}: {
  products: SaleRow['products'];
  fallback: string;
  saleNumber: string;
}) {
  const [expanded, setExpanded] = useState(false);
  if (products.length === 0) {
    return <p className="font-medium leading-5">{fallback}</p>;
  }
  const extraCount = products.length - 1;
  const visible = expanded || extraCount <= 0 ? products : products.slice(0, 1);
  const moreLabel = saleMoreProductsLabel(extraCount, expanded);
  return (
    <div className="min-w-0">
      <ul className="space-y-1.5">
        {visible.map((product, index) => (
          <SaleProductLine
            key={`${product.sku || product.name}-${index}`}
            product={product}
            fallback={fallback}
          />
        ))}
      </ul>
      {moreLabel ? (
        <button
          type="button"
          className="mt-1 cursor-pointer text-xs font-medium text-primary hover:underline"
          aria-expanded={expanded}
          aria-label={expanded
            ? `Ocultar productos de ${saleNumber}`
            : `Ver los ${products.length} productos de ${saleNumber}`}
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((current) => !current);
          }}
        >
          {moreLabel}
        </button>
      ) : null}
    </div>
  );
}

function PaymentCell({
  row,
  onOpen,
}: {
  row: SaleRow;
  onOpen: (row: SaleRow) => void;
}) {
  if (!row.needsProof) {
    return (
      <div className="min-w-0">
        <p>{row.payment}</p>
        {row.receivedBy ? <p className="text-xs text-muted-foreground">{row.receivedBy}</p> : null}
      </div>
    );
  }
  return (
    <button
      type="button"
      className="flex min-w-0 max-w-full cursor-pointer flex-col items-start gap-0.5 text-left"
      onClick={() => onOpen(row)}
      aria-label={row.hasProof ? `Ver constancia de ${row.number}` : `Subir constancia de ${row.number}`}
    >
      <span>{row.payment}</span>
      <span className="text-xs text-muted-foreground">{row.paidTo || 'Sin destinatario'}</span>
      {row.hasProof ? (
        <span className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-primary">
          {row.proofUrl ? (
            <img src={row.proofUrl} alt="" className="size-8 rounded object-cover ring-1 ring-border" />
          ) : null}
          Ver constancia
        </span>
      ) : (
        <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-amber-700">
          <ImagePlus className="size-3.5" />
          Sin constancia
        </span>
      )}
    </button>
  );
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
  onOpenPayment,
}: {
  rows: SaleRow[];
  loading: boolean;
  highlightOrder: string;
  onOpenPayment: (row: SaleRow) => void;
}) {
  if (loading) {
    return (
      <ul className="divide-y divide-border" aria-hidden>
        {Array.from({ length: 5 }, (_, index) => (
          <li key={index} className="flex items-start justify-between gap-3 py-3">
            <div className="flex min-w-0 flex-1 items-start gap-2.5">
              <div className="size-9 shrink-0 animate-pulse rounded-md bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-28 animate-pulse rounded bg-muted" />
                <div className="h-3 w-40 animate-pulse rounded bg-muted" />
                <div className="h-3 w-32 animate-pulse rounded bg-muted" />
              </div>
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
            <div className="flex min-w-0 items-start gap-2.5">
              <ProductPhoto url={row.imageUrl} shopSku={row.shopSku} sku={row.sku} name={row.product || row.number} size="sm" />
              <div className="min-w-0">
                <SaleProducts products={row.products} fallback={row.number} saleNumber={row.number} />
                <p className="mt-1 truncate text-sm text-muted-foreground">
                  {row.customer} · {row.number}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{row.date}</p>
                <div className="mt-1">
                  <PaymentCell row={row} onOpen={onOpenPayment} />
                </div>
              </div>
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
  const [paymentSale, setPaymentSale] = useState<SaleRow | null>(null);
  const [paymentError, setPaymentError] = useState('');

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

  const paymentMutation = useMutation({
    mutationFn: async (input: {
      sale: SaleRow;
      paidTo: 'empresa' | 'vendedor';
      paymentProof: { name: string; type: string; dataUrl: string } | null;
    }) => {
      if (!input.sale.id) throw new Error('No se encontró la venta.');
      const method = input.sale.paymentMethod || 'yape_plin';
      return api.updateManagedOrderPayment(input.sale.id, {
        paymentMethod: method,
        paidTo: input.paidTo,
        paymentProof: input.paymentProof,
      });
    },
    onSuccess: async () => {
      setPaymentSale(null);
      setPaymentError('');
      await queryClient.invalidateQueries({ queryKey: [MIS_VENTAS_QUERY_KEY] });
      showSnackbar({ message: 'Pago actualizado.', tone: 'success' });
    },
    onError: (error: Error) => {
      setPaymentError(humanizeSaleError(error.message || 'No se pudo guardar el pago.'));
    },
  });

  const openPayment = useCallback(async (row: SaleRow) => {
    setPaymentError('');
    if (row.hasProof && !row.proofUrl && row.id) {
      try {
        const order = await api.getManagedOrder(row.id) as SalespersonSale;
        const proofUrl = String(order.metadata?.paymentProof?.dataUrl || '').trim() || null;
        setPaymentSale({ ...row, proofUrl, proofName: String(order.metadata?.paymentProof?.name || '').trim() || row.proofName });
        return;
      } catch {
        setPaymentSale(row);
        return;
      }
    }
    setPaymentSale(row);
  }, []);

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
        const sale = row.original;
        return (
          <div className="flex min-w-0 items-start gap-2.5">
            <ProductPhoto url={sale.imageUrl} shopSku={sale.shopSku} sku={sale.sku} name={sale.product || sale.number} size="sm" />
            <div className="min-w-0">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <SaleProducts products={sale.products} fallback={sale.number} saleNumber={sale.number} />
                </div>
                {highlighted ? <Badge variant="secondary" className="shrink-0">Nueva</Badge> : null}
              </div>
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {sale.customer} · {sale.number}
              </p>
            </div>
          </div>
        );
      },
    },
    {
      id: 'orderedAt',
      accessorFn: (row) => row.date,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Fecha" />,
      cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{row.original.date || '—'}</span>,
    },
    {
      id: 'payment',
      header: 'Pago',
      enableSorting: false,
      cell: ({ row }) => <PaymentCell row={row.original} onOpen={openPayment} />,
    },
    {
      id: 'total',
      accessorFn: (row) => row.total,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Total" className="-mr-2 ml-0" />,
      cell: ({ row }) => <span className="font-semibold tabular-nums">{formatSaleMoney(row.original.total)}</span>,
    },
    {
      id: 'commission',
      accessorFn: (row) => row.commission,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Comisión" className="-mr-2 ml-0" />,
      cell: ({ row }) => <span className="tabular-nums text-primary">{formatSaleMoney(row.original.commission)}</span>,
    },
  ], [highlightOrder, openPayment]);

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
          onClick: () => navigate('/orders/nueva?from=mis-ventas'),
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
        <Button type="button" className="h-11 w-full sm:h-9 sm:w-auto" onClick={() => navigate('/orders/nueva?from=mis-ventas')}>
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
            sale: 'w-[38%]',
            orderedAt: 'w-[14%]',
            payment: 'w-[22%]',
            total: 'w-[13%] text-right',
            commission: 'w-[13%] text-right',
          }}
          cellClassNames={{
            sale: 'whitespace-normal',
            payment: 'whitespace-normal',
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
        <MobileSalesList rows={rows} loading={firstLoad} highlightOrder={highlightOrder} onOpenPayment={openPayment} />
        {pagination}
      </section>

      <SalePaymentDialog
        sale={paymentSale}
        busy={paymentMutation.isPending}
        error={paymentError}
        onClose={() => {
          if (paymentMutation.isPending) return;
          setPaymentSale(null);
          setPaymentError('');
        }}
        onSave={(input) => {
          if (!paymentSale) return;
          paymentMutation.mutate({
            sale: paymentSale,
            paidTo: input.paidTo,
            paymentProof: input.paymentProof,
          });
        }}
      />
    </div>
  );
}
