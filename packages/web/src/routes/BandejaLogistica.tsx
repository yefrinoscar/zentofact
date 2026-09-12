import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  PackageCheck,
} from 'lucide-react';
import api from '../lib/api';
import { BandejaOperativa } from './BandejaOperativa';
import { operationalLayout, VISUAL_VARIANTS } from './bandeja-variants';
import { BandejaVersionPicker } from './BandejaVersionPicker';
import { logIdFromUnknown } from '../lib/api-error';
import { sellerShortName } from '../lib/seller-name';
import { useOperatorSnackbar } from '../components/OperatorSnackbar';
import {
  applyLogisticsDeliveredToInbox,
  applyLogisticsReadyToInbox,
  bandejaDeadlineFilter,
  canPrintLogisticsLabel,
  formatBandejaDeadlineDate,
  logisticsBulkDeliverConfirmCopy,
  logisticsBulkDeliverSummary,
  logisticsBulkReadyConfirmCopy,
  logisticsBulkReadySummary,
  logisticsDeliverConfirmCopy,
  logisticsDeliverSuccessCopy,
  logisticsEmptyCopy,
  logisticsPrintSuccessCopy,
  logisticsReadyConfirmCopy,
  logisticsReadySuccessCopy,
  logisticsRipleyLabelSoon,
  logisticsSkippedNotice,
  openPdfPreviewTab,
  PDF_POPUP_BLOCKED_COPY,
  ripleyDefaultPickupDate,
  RIPLEY_LABEL_SOON_COPY,
  showPdfInTab,
  type LogisticsChannel,
  type LogisticsStage,
  type LogisticsUrgency,
} from '../lib/logistics-inbox';
import { logisticsSyncNotice, noticeFromError, type InboxNotice } from '../lib/inbox-notice';
import { CopyableLogId } from '../components/CopyableLogId';
import { PrototypeSwitcherGroup } from '../components/PrototypeSwitcher';
import { usePermissions } from '../hooks/usePermissions';
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
  BANDEJA_STAGE_FILTERS,
  VariantA,
  VariantB,
  VariantC,
  type BandejaView,
  type LogisticsOrder,
} from './bandeja-prototype';

type InboxResponse = {
  orders: LogisticsOrder[];
  channels?: {
    falabella?: boolean;
    ripley?: boolean;
    manual?: boolean;
  };
  counts: {
    pending: number;
    ready: number;
    readyUnprinted?: number;
    shipped: number;
    urgency: Record<LogisticsUrgency, number>;
    dates: Array<{ date: string; count: number }>;
  };
  totalCount: number;
  limit: number;
  offset: number;
};

type PrintResult = {
  base64?: string;
  filename?: string;
  labelCount?: number;
  skipped?: Array<{ id: number; reason: string }>;
};

const PAGE_SIZE = 50;
const EMPTY_URGENCY: Record<LogisticsUrgency, number> = { overdue: 0, today: 0, tomorrow: 0, later: 0 };

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
  const { showSnackbar } = useOperatorSnackbar();
  const [params] = useSearchParams();
  const variant = (params.get('variant') || '1').toUpperCase();
  const layout = operationalLayout(variant);
  const visualVariant = VISUAL_VARIANTS.find((entry) => entry.key === variant);
  const filtro = params.get('filtro') === '2' || params.get('filtro') === '3' ? params.get('filtro')! : '1';
  const { role, can, loading: permissionsLoading } = usePermissions();
  const canDispatch = !permissionsLoading && role !== 'viewer';
  const canSync = !permissionsLoading && can('order_management');

  const [stage, setStage] = useState<LogisticsStage>('pending');
  const [channelCode, setChannelCode] = useState<'all' | LogisticsChannel>('all');
  const [urgency, setUrgency] = useState<LogisticsUrgency | null>('today');
  const [deadlineDate, setDeadlineDate] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const search = useDeferredValue(searchInput.trim());
  const [page, setPage] = useState<{ key: string; offset: number }>({ key: '', offset: 0 });
  const [labelSelection, setLabelSelection] = useState<Set<number> | null>(null);
  const [readyOrder, setReadyOrder] = useState<LogisticsOrder | null>(null);
  const [bulkReady, setBulkReady] = useState<LogisticsOrder[] | null>(null);
  const [deliverOrder, setDeliverOrder] = useState<LogisticsOrder | null>(null);
  const [bulkDeliver, setBulkDeliver] = useState<LogisticsOrder[] | null>(null);
  const [notice, setNotice] = useState<InboxNotice | null>(null);
  const [bulkProgress, setBulkProgress] = useState(0);
  const [busyOrderId, setBusyOrderId] = useState<number | null>(null);
  const printPreviewRef = useRef<Window | null>(null);

  const filterKey = [stage, channelCode, urgency || '', deadlineDate || '', search].join('|');
  const offset = page.key === filterKey ? page.offset : 0;
  const filters = {
    stage,
    channelCode: channelCode === 'all' ? undefined : channelCode,
    urgency: stage === 'shipped' || deadlineDate ? undefined : bandejaDeadlineFilter(urgency) || undefined,
    deadline: stage === 'shipped' ? undefined : deadlineDate || undefined,
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
  const counts = inboxQuery.data?.counts || { pending: 0, ready: 0, readyUnprinted: 0, shipped: 0, urgency: EMPTY_URGENCY, dates: [] };
  const loading = inboxQuery.isPending && !inboxQuery.data;

  useEffect(() => {
    if (inboxQuery.data?.channels?.ripley === false && channelCode === 'ripley') {
      setChannelCode('all');
    }
  }, [inboxQuery.data?.channels?.ripley, channelCode]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['logistics-inbox'] });
  const revealReadyOrders = (orderIds: Iterable<number>) => {
    const ids = [...orderIds];
    if (ids.length) {
      queryClient.setQueriesData<InboxResponse>({ queryKey: ['logistics-inbox'] }, (current) => (
        applyLogisticsReadyToInbox(current, ids)
      ));
    }
    void invalidate();
  };
  const revealDeliveredOrders = (orderIds: Iterable<number>) => {
    const ids = [...orderIds];
    if (ids.length) {
      queryClient.setQueriesData<InboxResponse>({ queryKey: ['logistics-inbox'] }, (current) => (
        applyLogisticsDeliveredToInbox(current, ids)
      ));
    }
    void invalidate();
  };
  const announce = (next: InboxNotice) => {
    showSnackbar({
      message: next.message,
      tone: next.tone === 'success' ? 'success' : 'error',
      duration: next.tone === 'success' ? undefined : 8000,
    });
    setNotice(next.refs.length ? next : null);
  };

  const changeStage = (next: LogisticsStage) => {
    setStage(next);
    setLabelSelection(null);
    setPage({ key: '', offset: 0 });
    if (next === 'shipped') {
      setUrgency(null);
      setDeadlineDate(null);
    } else if (stage === 'shipped') {
      setUrgency('today');
    }
  };

  const closePrintPreview = () => {
    printPreviewRef.current?.close();
    printPreviewRef.current = null;
  };

  const printMutation = useMutation({
    mutationFn: (orderIds: number[]) => api.printLogisticsPack({ orderIds }) as Promise<PrintResult>,
    onSuccess: (result) => {
      const preview = printPreviewRef.current;
      printPreviewRef.current = null;
      if (result?.base64) {
        if (!showPdfInTab(preview, result.base64)) showSnackbar({ message: PDF_POPUP_BLOCKED_COPY, tone: 'error' });
      } else {
        preview?.close();
      }
      const skipped = Array.isArray(result?.skipped) ? result.skipped : [];
      announce({
        tone: skipped.length ? 'warning' : 'success',
        message: skipped.length ? logisticsSkippedNotice(skipped) : logisticsPrintSuccessCopy(result),
        refs: [],
      });
      setLabelSelection(null);
      void invalidate();
    },
    onError: (error) => {
      closePrintPreview();
      announce(noticeFromError(error, 'No se pudo armar la impresión.'));
    },
    onSettled: () => setBusyOrderId(null),
  });

  const printOrders = (targets: LogisticsOrder[]) => {
    if (printMutation.isPending) return;
    const printable = targets.filter(canPrintLogisticsLabel);
    if (!printable.length) {
      if (targets.some(logisticsRipleyLabelSoon)) showSnackbar({ message: RIPLEY_LABEL_SOON_COPY });
      return;
    }
    const preview = openPdfPreviewTab();
    if (!preview) {
      showSnackbar({ message: PDF_POPUP_BLOCKED_COPY, tone: 'error' });
      return;
    }
    printPreviewRef.current = preview;
    setBusyOrderId(printable.length === 1 ? printable[0].id : null);
    setNotice(null);
    printMutation.mutate(printable.map((order) => order.id));
  };

  const markOrderReady = (order: LogisticsOrder) => {
    if (order.channelCode === 'ripley') {
      return api.markLogisticsOrderReady({
        orderId: order.id,
        pickupDate: ripleyDefaultPickupDate(),
        warehouseAddress: order.warehouseAddress || undefined,
      });
    }
    return api.falabellaApiSetReadyToShip(order.companyId as number, order.externalOrderId);
  };

  const readyMutation = useMutation({
    mutationFn: markOrderReady,
    onSuccess: (_result, order) => {
      setReadyOrder(null);
      announce({ tone: 'success', message: logisticsReadySuccessCopy(order), refs: [] });
      revealReadyOrders([order.id]);
    },
    onError: (error) => announce(noticeFromError(error, 'No se pudo marcar el pedido como listo para envío.')),
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
      setBulkProgress(0);
      const failed: Array<{ orderNumber: string; logId?: string }> = [];
      const succeeded: number[] = [];
      for (let index = 0; index < targets.length; index += 4) {
        const chunk = targets.slice(index, index + 4);
        const results = await Promise.allSettled(chunk.map((order) => markOrderReady(order)));
        setBulkProgress(Math.min(index + chunk.length, targets.length));
        results.forEach((result, resultIndex) => {
          if (result.status === 'rejected') {
            failed.push({ orderNumber: chunk[resultIndex].externalOrderNumber, logId: logIdFromUnknown(result.reason) });
          } else {
            succeeded.push(chunk[resultIndex].id);
          }
        });
      }
      return { total: targets.length, failed, succeeded };
    },
    onSuccess: ({ total, failed, succeeded }) => {
      setBulkReady(null);
      announce({
        tone: failed.length ? (failed.length === total ? 'error' : 'warning') : 'success',
        message: logisticsBulkReadySummary(total, failed.length),
        refs: failed.map((row) => ({ label: row.orderNumber, logId: row.logId })),
      });
      revealReadyOrders(succeeded);
    },
    onError: (error) => announce(noticeFromError(error, 'No se pudieron actualizar los pedidos.')),
  });

  const deliverMutation = useMutation({
    mutationFn: (order: LogisticsOrder) => api.markLogisticsOrderDelivered({ orderId: order.id }),
    onSuccess: (_result, order) => {
      setDeliverOrder(null);
      announce({ tone: 'success', message: logisticsDeliverSuccessCopy(order), refs: [] });
      revealDeliveredOrders([order.id]);
    },
    onError: (error) => announce(noticeFromError(error, 'No se pudo marcar el pedido como entregado.')),
    onSettled: () => setBusyOrderId(null),
  });

  const markDelivered = (order: LogisticsOrder) => {
    if (!canDispatch || deliverMutation.isPending) return;
    setBusyOrderId(order.id);
    setNotice(null);
    deliverMutation.mutate(order);
  };

  const bulkDeliverMutation = useMutation({
    mutationFn: async (targets: LogisticsOrder[]) => {
      setBulkProgress(0);
      const failed: Array<{ orderNumber: string; logId?: string }> = [];
      const succeeded: number[] = [];
      for (let index = 0; index < targets.length; index += 4) {
        const chunk = targets.slice(index, index + 4);
        const results = await Promise.allSettled(chunk.map((order) => api.markLogisticsOrderDelivered({ orderId: order.id })));
        setBulkProgress(Math.min(index + chunk.length, targets.length));
        results.forEach((result, resultIndex) => {
          if (result.status === 'rejected') {
            failed.push({ orderNumber: chunk[resultIndex].externalOrderNumber, logId: logIdFromUnknown(result.reason) });
          } else {
            succeeded.push(chunk[resultIndex].id);
          }
        });
      }
      return { total: targets.length, failed, succeeded };
    },
    onSuccess: ({ total, failed, succeeded }) => {
      setBulkDeliver(null);
      announce({
        tone: failed.length ? (failed.length === total ? 'error' : 'warning') : 'success',
        message: logisticsBulkDeliverSummary(total, failed.length),
        refs: failed.map((row) => ({ label: row.orderNumber, logId: row.logId })),
      });
      revealDeliveredOrders(succeeded);
    },
    onError: (error) => announce(noticeFromError(error, 'No se pudieron marcar los pedidos como entregados.')),
  });

  const syncMutation = useMutation({
    mutationFn: () => api.syncManagedOrders({ mode: 'incremental' }),
    onSuccess: (result) => {
      const nameByCompanyId = new Map(
        orders.flatMap((order) => (
          order.companyId != null && order.companyName
            ? [[order.companyId, order.companyName] as const]
            : []
        )),
      );
      announce(logisticsSyncNotice(result, nameByCompanyId));
      void invalidate();
    },
    onError: (error) => announce(noticeFromError(error, 'No se pudieron sincronizar los pedidos.')),
  });

  const refresh = () => {
    setNotice(null);
    if (canSync) syncMutation.mutate();
    else void inboxQuery.refetch();
  };

  const toggleLabel = (order: LogisticsOrder) => {
    if (logisticsRipleyLabelSoon(order)) {
      showSnackbar({ message: RIPLEY_LABEL_SOON_COPY });
      return;
    }
    setLabelSelection((current) => {
      const next = new Set(current || []);
      if (next.has(order.id)) next.delete(order.id);
      else next.add(order.id);
      return next;
    });
  };

  const closeReady = () => {
    if (readyMutation.isPending) return;
    setReadyOrder(null);
  };

  const closeDeliver = () => {
    if (deliverMutation.isPending) return;
    setDeliverOrder(null);
  };

  const view: BandejaView = {
    now,
    stage,
    setStage: changeStage,
    channelCode,
    setChannelCode: (code) => { setChannelCode(code); setLabelSelection(null); setPage({ key: '', offset: 0 }); },
    channels: inboxQuery.data?.channels,
    urgency,
    deadlineDate,
    setDeadlineDate: (next) => { setDeadlineDate(next); setUrgency(null); setLabelSelection(null); setPage({ key: '', offset: 0 }); },
    setUrgency: (next) => { setUrgency(bandejaDeadlineFilter(next)); setDeadlineDate(null); setLabelSelection(null); setPage({ key: '', offset: 0 }); },
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
    requestReady: (order) => setReadyOrder(order),
    requestBulkReady: (targets) => setBulkReady(targets),
    requestDeliver: (order) => setDeliverOrder(order),
    requestBulkDeliver: (targets) => setBulkDeliver(targets),
    labelSelection,
    setLabelSelection,
    toggleLabel,
    emptyCopy: logisticsEmptyCopy(
      stage,
      stage === 'shipped' ? null : bandejaDeadlineFilter(urgency),
      deadlineDate ? formatBandejaDeadlineDate(deadlineDate, now) : null,
    ),
  };

  const body = visualVariant ? <figure className="pb-24"><figcaption className="mb-3 text-sm text-muted-foreground">{visualVariant.name} · Propuesta visual con datos ilustrativos. Los controles de la imagen no son interactivos.</figcaption><img src={visualVariant.src} alt={visualVariant.name} className="h-auto w-full rounded-lg border" /></figure>
    : variant === 'A' ? <VariantA view={view} />
    : variant === 'C' ? <VariantC view={view} />
      : variant === 'B' ? <VariantB view={view} />
        : <BandejaOperativa key={layout} resetKey={`${filterKey}|${offset}`} layout={layout} view={view} offset={offset} pageSize={PAGE_SIZE} busy={bulkReadyMutation.isPending || bulkDeliverMutation.isPending} error={inboxQuery.isError} onPage={(next) => { setPage({ key: filterKey, offset: next }); setLabelSelection(null); }} />;

  return (
    <div>
      {notice && <InboxStatusNotice notice={notice} />}
      {body}
      {import.meta.env.DEV && !['A', 'B', 'C'].includes(variant) && (
        <BandejaVersionPicker current={visualVariant?.key || layout} />
      )}
      {import.meta.env.DEV && ['A', 'B', 'C'].includes(variant) && (
        <PrototypeSwitcherGroup
          groups={[
            { param: 'variant', current: variant, variants: [...BANDEJA_PROTOTYPE_VARIANTS], listenKeys: false, prefix: 'Tablero' },
            { param: 'filtro', current: filtro, variants: [...BANDEJA_STAGE_FILTERS], listenKeys: true, prefix: 'Filtro' },
          ]}
        />
      )}

      <Dialog open={Boolean(bulkReady)} onOpenChange={(open) => !open && !bulkReadyMutation.isPending && setBulkReady(null)}>
        <DialogContent className="sm:max-w-md" showCloseButton={!bulkReadyMutation.isPending}>
          <DialogHeader>
            <DialogTitle>Marcar {bulkReady?.length} pedidos listos</DialogTitle>
            <DialogDescription>
              {bulkReady ? `${bulkReady.length} pedido${bulkReady.length === 1 ? '' : 's'} seleccionado${bulkReady.length === 1 ? '' : 's'}.` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md bg-orange-50 px-3 py-2.5 text-sm text-orange-900">
            Confirma que estos pedidos están empacados. {bulkReady ? logisticsBulkReadyConfirmCopy(bulkReady) : ''}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkReady(null)} disabled={bulkReadyMutation.isPending}>Cancelar</Button>
            <Button onClick={() => bulkReady && bulkReadyMutation.mutate(bulkReady)} disabled={bulkReadyMutation.isPending}>
              {bulkReadyMutation.isPending ? <Loader2 className="animate-spin" /> : <PackageCheck />}
              {bulkReadyMutation.isPending ? `Actualizando ${bulkProgress} de ${bulkReady?.length}…` : `Marcar ${bulkReady?.length} listos`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(readyOrder)} onOpenChange={(open) => !open && closeReady()}>
        <DialogContent className="sm:max-w-md" showCloseButton={!readyMutation.isPending}>
          {readyOrder && (
            <>
              <DialogHeader>
                <DialogTitle>Confirmar pedido listo para envío</DialogTitle>
                <DialogDescription>Pedido {readyOrder.externalOrderNumber} · {sellerShortName(readyOrder.companyName)}</DialogDescription>
              </DialogHeader>
              <div className="flex gap-3 rounded-md border border-orange-200 bg-orange-50 p-4 text-orange-900">
                <PackageCheck className="mt-0.5 size-5 shrink-0" />
                <div>
                  <p className="font-semibold">Confirma que todo el pedido está empacado</p>
                  <p className="mt-1 text-sm text-orange-800">
                    {logisticsReadyConfirmCopy(readyOrder)}
                    {readyOrder.channelCode === 'ripley' && readyOrder.warehouseAddress
                      ? ` Recojo en ${readyOrder.warehouseAddress}.`
                      : ''}
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeReady} disabled={readyMutation.isPending}>Cancelar</Button>
                <Button onClick={() => markReady(readyOrder)} disabled={readyMutation.isPending}>
                  {readyMutation.isPending ? <Loader2 className="animate-spin" /> : <PackageCheck />}
                  {readyOrder.channelCode === 'ripley' ? 'Agendar recojo' : 'Confirmar y marcar listo'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(bulkDeliver)} onOpenChange={(open) => !open && !bulkDeliverMutation.isPending && setBulkDeliver(null)}>
        <DialogContent className="sm:max-w-md" showCloseButton={!bulkDeliverMutation.isPending}>
          <DialogHeader>
            <DialogTitle>Marcar {bulkDeliver?.length} entregados</DialogTitle>
            <DialogDescription>
              {bulkDeliver ? logisticsBulkDeliverConfirmCopy(bulkDeliver.length) : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md bg-teal-50 px-3 py-2.5 text-sm text-teal-950">
            Estos pedidos propios salen de la bandeja. No se llama a un marketplace.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDeliver(null)} disabled={bulkDeliverMutation.isPending}>Cancelar</Button>
            <Button onClick={() => bulkDeliver && bulkDeliverMutation.mutate(bulkDeliver)} disabled={bulkDeliverMutation.isPending}>
              {bulkDeliverMutation.isPending ? <Loader2 className="animate-spin" /> : <PackageCheck />}
              {bulkDeliverMutation.isPending ? `Actualizando ${bulkProgress} de ${bulkDeliver?.length}…` : `Marcar ${bulkDeliver?.length} entregados`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deliverOrder)} onOpenChange={(open) => !open && closeDeliver()}>
        <DialogContent className="sm:max-w-md" showCloseButton={!deliverMutation.isPending}>
          {deliverOrder && (
            <>
              <DialogHeader>
                <DialogTitle>Confirmar pedido entregado</DialogTitle>
                <DialogDescription>Pedido {deliverOrder.externalOrderNumber} · {sellerShortName(deliverOrder.companyName)}</DialogDescription>
              </DialogHeader>
              <div className="flex gap-3 rounded-md border border-teal-200 bg-teal-50 p-4 text-teal-950">
                <PackageCheck className="mt-0.5 size-5 shrink-0" />
                <div>
                  <p className="font-semibold">El pedido propio ya salió</p>
                  <p className="mt-1 text-sm text-teal-900">{logisticsDeliverConfirmCopy()}</p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeDeliver} disabled={deliverMutation.isPending}>Cancelar</Button>
                <Button onClick={() => markDelivered(deliverOrder)} disabled={deliverMutation.isPending}>
                  {deliverMutation.isPending ? <Loader2 className="animate-spin" /> : <PackageCheck />}
                  Confirmar entregado
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
