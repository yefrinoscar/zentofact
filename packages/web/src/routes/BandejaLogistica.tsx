import { useDeferredValue, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  PackageCheck,
  Printer,
} from 'lucide-react';
import api from '../lib/api';
import { logIdFromUnknown } from '../lib/api-error';
import { cn } from '../lib/cn';
import { sellerShortName } from '../lib/seller-name';
import {
  canMarkFalabellaReady,
  canPrintLogisticsLabel,
  formatLogisticsDateTime,
  labelPrintTooltip,
  labelWasPrinted,
  logisticsBulkReadySummary,
  logisticsChannelClass,
  logisticsChannelLabel,
  logisticsDeadlineLabel,
  logisticsDeliveryLabel,
  logisticsElapsedLabel,
  logisticsEmptyCopy,
  logisticsFlowCopy,
  logisticsFlowSteps,
  logisticsPrintSuccessCopy,
  logisticsSkippedNotice,
  logisticsUrgency,
  openPdfFromBase64,
  type LogisticsChannel,
  type LogisticsStage,
  type LogisticsUrgency,
} from '../lib/logistics-inbox';
import { noticeFromError, type InboxNotice } from '../lib/inbox-notice';
import { CopyableLogId } from '../components/CopyableLogId';
import { PrototypeSwitcher } from '../components/PrototypeSwitcher';
import { usePermissions } from '../hooks/usePermissions';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import {
  BANDEJA_PROTOTYPE_VARIANTS,
  VariantA,
  VariantB,
  VariantC,
  VariantD,
  VariantE,
  VariantF,
  VariantG,
  VariantH,
  VariantI,
  VariantJ,
  type BandejaView,
  type LogisticsItem,
  type LogisticsOrder,
} from './bandeja-prototype';
import { ProductThumb, QuantityTag } from './bandeja-prototype/shared';

type InboxResponse = {
  orders: LogisticsOrder[];
  counts: {
    pending: number;
    ready: number;
    shipped: number;
    urgency: Record<LogisticsUrgency, number>;
  };
  totalCount: number;
  limit: number;
  offset: number;
};

type PrintResult = {
  base64?: string;
  filename?: string;
  labelCount?: number;
  packingPageCount?: number;
  skipped?: Array<{ id: number; reason: string }>;
};

const PAGE_SIZE = 50;
const EMPTY_URGENCY: Record<LogisticsUrgency, number> = { overdue: 0, today: 0, tomorrow: 0, later: 0 };

function formatMoney(value: number | null, currency = 'PEN') {
  try {
    return new Intl.NumberFormat('es-PE', { style: 'currency', currency }).format(value || 0);
  } catch {
    return new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(value || 0);
  }
}

function stageBadge(order: LogisticsOrder) {
  if (order.stage === 'shipped') return { label: 'Enviado', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' };
  if (order.stage === 'ready') return { label: 'Listo para enviar', className: 'border-indigo-200 bg-indigo-50 text-indigo-700' };
  return { label: 'Pendiente', className: 'border-orange-200 bg-orange-50 text-orange-700' };
}

function OrderProducts({ items }: { items: LogisticsItem[] }) {
  if (!items.length) return <span className="text-xs text-muted-foreground">Sin productos informados</span>;
  return (
    <div className="space-y-1">
      {items.map((item) => (
        <div key={item.id} className="flex min-w-0 items-center gap-2">
          <ProductThumb item={item} className="size-11 rounded-md border border-border" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-foreground" title={item.description}>{item.description}</p>
            {item.sku && <p className="truncate text-[10px] text-muted-foreground">{item.sku}</p>}
          </div>
          <QuantityTag item={item} />
        </div>
      ))}
    </div>
  );
}

function InboxStatusNotice({ notice }: { notice: InboxNotice }) {
  const toneClass = notice.tone === 'error'
    ? 'border-destructive/30 bg-destructive/5 text-destructive'
    : notice.tone === 'warning'
      ? 'border-orange-200 bg-orange-50 text-orange-950'
      : 'border-emerald-200 bg-emerald-50 text-emerald-700';
  const Icon = notice.tone === 'success' ? CheckCircle2 : AlertCircle;
  return (
    <div className={`mb-3 flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${toneClass}`} role="status">
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p>{notice.message}</p>
        {notice.refs.length > 0 && (
          <ul className="mt-1.5 space-y-1">
            {notice.refs.map((ref, index) => (
              <li key={`${ref.logId || ref.label || index}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                {ref.label && <span className="text-xs font-medium opacity-80">{ref.label}</span>}
                {ref.logId && <CopyableLogId logId={ref.logId} />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function BandejaLogistica() {
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const variant = (params.get('variant') || 'A').toUpperCase();
  const { role, can, loading: permissionsLoading } = usePermissions();
  const canDispatch = !permissionsLoading && role !== 'viewer';
  const canSync = !permissionsLoading && can('order_management');

  const [stage, setStage] = useState<LogisticsStage>('pending');
  const [channelCode, setChannelCode] = useState<'all' | LogisticsChannel>('all');
  const [urgency, setUrgency] = useState<LogisticsUrgency | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const search = useDeferredValue(searchInput.trim());
  const [page, setPage] = useState<{ key: string; offset: number }>({ key: '', offset: 0 });
  const [labelSelection, setLabelSelection] = useState<Set<number> | null>(null);
  const [detail, setDetail] = useState<LogisticsOrder | null>(null);
  const [confirmReady, setConfirmReady] = useState(false);
  const [bulkReady, setBulkReady] = useState<LogisticsOrder[] | null>(null);
  const [notice, setNotice] = useState<InboxNotice | null>(null);
  const [busyOrderId, setBusyOrderId] = useState<number | null>(null);

  const filterKey = [stage, channelCode, urgency || '', search].join('|');
  const offset = page.key === filterKey ? page.offset : 0;
  const filters = {
    stage,
    channelCode: channelCode === 'all' ? undefined : channelCode,
    urgency: stage === 'shipped' || !urgency ? undefined : urgency,
    search: search || undefined,
    limit: PAGE_SIZE,
    offset,
  };

  const inboxQuery = useQuery({
    queryKey: ['logistics-inbox', filters],
    queryFn: () => api.listLogisticsInbox(filters) as Promise<InboxResponse>,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    refetchInterval: 60_000,
  });

  const now = new Date();
  const orders = inboxQuery.data?.orders || [];
  const counts = inboxQuery.data?.counts || { pending: 0, ready: 0, shipped: 0, urgency: EMPTY_URGENCY };
  const loading = inboxQuery.isPending && !inboxQuery.data;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['logistics-inbox'] });

  const changeStage = (next: LogisticsStage) => {
    setStage(next);
    setLabelSelection(null);
    setPage({ key: '', offset: 0 });
    if (next === 'shipped') setUrgency(null);
  };

  const printMutation = useMutation({
    mutationFn: (orderIds: number[]) => api.printLogisticsPack({ orderIds, includePacking: true }) as Promise<PrintResult>,
    onSuccess: (result) => {
      if (result?.base64) openPdfFromBase64(result.base64, result.filename || 'bandeja.pdf');
      const skipped = Array.isArray(result?.skipped) ? result.skipped : [];
      setNotice({
        tone: skipped.length ? 'warning' : 'success',
        message: skipped.length ? logisticsSkippedNotice(skipped) : logisticsPrintSuccessCopy(result),
        refs: [],
      });
      setLabelSelection(null);
      void invalidate();
    },
    onError: (error) => setNotice(noticeFromError(error, 'No se pudo armar la impresión.')),
    onSettled: () => setBusyOrderId(null),
  });

  const printOrders = (targets: LogisticsOrder[]) => {
    if (!targets.length || printMutation.isPending) return;
    setBusyOrderId(targets.length === 1 ? targets[0].id : null);
    setNotice(null);
    printMutation.mutate(targets.map((order) => order.id));
  };

  const readyMutation = useMutation({
    mutationFn: (order: LogisticsOrder) => api.falabellaApiSetReadyToShip(order.companyId as number, order.externalOrderId),
    onSuccess: (_result, order) => {
      setConfirmReady(false);
      setDetail((current) => current && current.id === order.id ? { ...current, fulfillmentStatus: 'ready_to_ship', stage: 'ready' } : current);
      setNotice({ tone: 'success', message: `${order.externalOrderNumber} quedó listo para enviar. Ya puedes imprimir la etiqueta.`, refs: [] });
      void invalidate();
    },
    onError: (error) => setNotice(noticeFromError(error, 'No se pudo marcar el pedido como listo para envío.')),
    onSettled: () => setBusyOrderId(null),
  });

  const markReady = (order: LogisticsOrder) => {
    if (!canDispatch || readyMutation.isPending) return;
    setBusyOrderId(order.id);
    setNotice(null);
    readyMutation.mutate(order);
  };

  const bulkReadyMutation = useMutation({
    mutationFn: async (targets: LogisticsOrder[]) => {
      const failed: Array<{ orderNumber: string; logId?: string }> = [];
      for (let index = 0; index < targets.length; index += 4) {
        const chunk = targets.slice(index, index + 4);
        const results = await Promise.allSettled(chunk.map((order) => (
          api.falabellaApiSetReadyToShip(order.companyId as number, order.externalOrderId)
        )));
        results.forEach((result, resultIndex) => {
          if (result.status === 'rejected') {
            failed.push({ orderNumber: chunk[resultIndex].externalOrderNumber, logId: logIdFromUnknown(result.reason) });
          }
        });
      }
      return { total: targets.length, failed };
    },
    onSuccess: ({ total, failed }) => {
      setBulkReady(null);
      setNotice({
        tone: failed.length ? (failed.length === total ? 'error' : 'warning') : 'success',
        message: logisticsBulkReadySummary(total, failed.length),
        refs: failed.map((row) => ({ label: row.orderNumber, logId: row.logId })),
      });
      void invalidate();
    },
    onError: (error) => setNotice(noticeFromError(error, 'No se pudieron actualizar los pedidos.')),
  });

  const syncMutation = useMutation({
    mutationFn: () => api.syncManagedOrders({ mode: 'incremental' }),
    onSuccess: (result) => {
      const rows = Array.isArray(result?.results) ? result.results : [];
      const failed = rows.filter((row) => /error|fail/i.test(String(row.status || '')));
      setNotice(failed.length
        ? { tone: rows.length === failed.length ? 'error' : 'warning', message: `${failed.length} tienda${failed.length === 1 ? '' : 's'} no pudo${failed.length === 1 ? '' : 'ieron'} sincronizarse.`, refs: [] }
        : { tone: 'success', message: 'Pedidos actualizados con los marketplaces.', refs: [] });
      void invalidate();
    },
    onError: (error) => setNotice(noticeFromError(error, 'No se pudieron sincronizar los pedidos.')),
  });

  const refresh = () => {
    setNotice(null);
    if (canSync) syncMutation.mutate();
    else void inboxQuery.refetch();
  };

  const toggleLabel = (order: LogisticsOrder) => {
    setLabelSelection((current) => {
      const next = new Set(current || []);
      if (next.has(order.id)) next.delete(order.id);
      else next.add(order.id);
      return next;
    });
  };

  const openOrder = (order: LogisticsOrder) => {
    setConfirmReady(false);
    setDetail(order);
  };
  const closeOrder = () => {
    if (readyMutation.isPending) return;
    setDetail(null);
    setConfirmReady(false);
  };

  const view: BandejaView = {
    now,
    stage,
    setStage: changeStage,
    channelCode,
    setChannelCode: (code) => { setChannelCode(code); setLabelSelection(null); setPage({ key: '', offset: 0 }); },
    urgency,
    setUrgency: (next) => { setUrgency(next); setLabelSelection(null); setPage({ key: '', offset: 0 }); },
    searchInput,
    setSearchInput: (value) => { setSearchInput(value); setLabelSelection(null); setPage({ key: '', offset: 0 }); },
    orders,
    counts,
    totalCount: inboxQuery.data?.totalCount || 0,
    loading,
    fetching: inboxQuery.isFetching,
    updatedAt: inboxQuery.dataUpdatedAt ? new Date(inboxQuery.dataUpdatedAt) : null,
    notice,
    canDispatch,
    canSync,
    refreshing: syncMutation.isPending || inboxQuery.isFetching,
    refresh,
    printing: printMutation.isPending,
    busyOrderId,
    printOrders,
    openOrder,
    requestReady: (order) => { openOrder(order); setConfirmReady(true); },
    requestBulkReady: (targets) => setBulkReady(targets),
    labelSelection,
    setLabelSelection,
    toggleLabel,
    emptyCopy: logisticsEmptyCopy(stage, stage === 'shipped' ? null : urgency),
  };

  const body = variant === 'B' ? <VariantB view={view} />
    : variant === 'C' ? <VariantC view={view} />
      : variant === 'D' ? <VariantD view={view} />
        : variant === 'E' ? <VariantE view={view} />
          : variant === 'F' ? <VariantF view={view} />
            : variant === 'G' ? <VariantG view={view} />
              : variant === 'H' ? <VariantH view={view} />
                : variant === 'I' ? <VariantI view={view} />
                  : variant === 'J' ? <VariantJ view={view} />
                    : <VariantA view={view} />;

  const detailUrgency = detail ? logisticsUrgency(detail, now) : null;
  const detailShipped = detail?.stage === 'shipped';

  return (
    <div>
      {notice && <InboxStatusNotice notice={notice} />}
      {body}
      {import.meta.env.DEV && (
        <PrototypeSwitcher variants={[...BANDEJA_PROTOTYPE_VARIANTS]} current={variant} />
      )}

      <Dialog open={Boolean(bulkReady)} onOpenChange={(open) => !open && !bulkReadyMutation.isPending && setBulkReady(null)}>
        <DialogContent className="sm:max-w-md" showCloseButton={!bulkReadyMutation.isPending}>
          <DialogHeader>
            <DialogTitle>Marcar todos listos para enviar</DialogTitle>
            <DialogDescription>
              {bulkReady ? `${bulkReady.length} pedido${bulkReady.length === 1 ? '' : 's'} Falabella visible${bulkReady.length === 1 ? '' : 's'} en Pendientes.` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md bg-orange-50 px-3 py-2.5 text-sm text-orange-900">
            Confirma que todos estos pedidos ya están empacados. Falabella habilitará sus etiquetas de envío.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkReady(null)} disabled={bulkReadyMutation.isPending}>Cancelar</Button>
            <Button onClick={() => bulkReady && bulkReadyMutation.mutate(bulkReady)} disabled={bulkReadyMutation.isPending}>
              {bulkReadyMutation.isPending ? <Loader2 className="animate-spin" /> : <PackageCheck />}
              {bulkReadyMutation.isPending ? 'Actualizando pedidos…' : 'Marcar todos listos para enviar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(detail)} onOpenChange={(open) => !open && closeOrder()}>
        <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg" showCloseButton={!readyMutation.isPending}>
          {detail && detailUrgency && (
            confirmReady ? (
              <>
                <DialogHeader>
                  <DialogTitle>Confirmar pedido listo para envío</DialogTitle>
                  <DialogDescription>Pedido {detail.externalOrderNumber} · {sellerShortName(detail.companyName)}</DialogDescription>
                </DialogHeader>
                <div className="flex gap-3 rounded-md border border-orange-200 bg-orange-50 p-4 text-orange-900">
                  <PackageCheck className="mt-0.5 size-5 shrink-0" />
                  <div>
                    <p className="font-semibold">Confirma que todo el pedido está empacado</p>
                    <p className="mt-1 text-sm text-orange-800">
                      Falabella cambiará a listo para envío todos los productos de esta orden y descontará el stock. No lo hagas si falta algún producto por empacar.
                    </p>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setConfirmReady(false)} disabled={readyMutation.isPending}>Volver</Button>
                  <Button onClick={() => markReady(detail)} disabled={readyMutation.isPending}>
                    {readyMutation.isPending ? <Loader2 className="animate-spin" /> : <PackageCheck />}
                    Confirmar y marcar listo
                  </Button>
                </DialogFooter>
              </>
            ) : (
              <>
                <DialogHeader>
                  <div className="flex flex-wrap items-center gap-2 pr-8">
                    <DialogTitle className="font-mono">{detail.externalOrderNumber || detail.externalOrderId}</DialogTitle>
                    <Badge variant="outline" className={cn('rounded-md', stageBadge(detail).className)}>{stageBadge(detail).label}</Badge>
                    <Badge variant="outline" className={cn('rounded-md', logisticsChannelClass(detail.channelCode))}>{logisticsChannelLabel(detail.channelCode)}</Badge>
                  </div>
                  <DialogDescription>{sellerShortName(detail.companyName)} · {logisticsDeliveryLabel(detail)}</DialogDescription>
                </DialogHeader>
                <div className={cn(
                  'rounded-md border p-3',
                  detailShipped ? 'border-emerald-200 bg-emerald-50' : detailUrgency === 'overdue' ? 'border-rose-200 bg-rose-50' : detailUrgency === 'today' ? 'border-orange-200 bg-orange-50' : 'border-border bg-muted/30',
                )}>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {detailShipped ? 'Estado de entrega' : 'Límite de entrega'}
                  </p>
                  <p className={cn(
                    'mt-0.5 text-lg font-semibold',
                    detailShipped ? 'text-emerald-700' : detailUrgency === 'overdue' ? 'text-rose-700' : detailUrgency === 'today' ? 'text-orange-700' : 'text-foreground',
                  )}>
                    {detailShipped ? 'Enviado' : logisticsDeadlineLabel(detail, now)}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {detailShipped
                      ? `Última actualización: ${formatLogisticsDateTime(detail.updatedAt)}`
                      : detail.promisedShippingAt
                        ? `Fecha prometida: ${formatLogisticsDateTime(detail.promisedShippingAt)}`
                        : 'El canal no informó una fecha de entrega.'}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">{logisticsFlowCopy(detail)}</p>
                <p className="text-xs text-muted-foreground">
                  {logisticsFlowSteps(detail).filter((step) => step.state === 'done').length} de 3 · ingresó {logisticsElapsedLabel(detail.createdAt || detail.orderedAt, now) || 'sin fecha'}
                </p>
                <section className="rounded-md border border-border p-3">
                  <h3 className="text-sm font-semibold text-foreground">Contenido · {detail.itemsCount} unidad{detail.itemsCount === 1 ? '' : 'es'}</h3>
                  <div className="mt-2"><OrderProducts items={detail.items} /></div>
                </section>
                <DialogFooter>
                  <Button variant="outline" onClick={closeOrder}>Cerrar</Button>
                  {canPrintLogisticsLabel(detail) && (
                    <Button variant={labelWasPrinted(detail) ? 'outline' : 'default'} onClick={() => printOrders([detail])} disabled={printMutation.isPending}>
                      {printMutation.isPending && busyOrderId === detail.id ? <Loader2 className="animate-spin" /> : <Printer />}
                      {labelWasPrinted(detail) ? 'Reimprimir etiqueta y guía' : 'Imprimir etiqueta y guía'}
                    </Button>
                  )}
                  {canMarkFalabellaReady(detail) && canDispatch && (
                    <Button onClick={() => setConfirmReady(true)}>
                      <PackageCheck /> Marcar listo para envío
                    </Button>
                  )}
                </DialogFooter>
              </>
            )
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
