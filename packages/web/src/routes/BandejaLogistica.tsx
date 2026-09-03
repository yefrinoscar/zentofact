import { useDeferredValue, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  PackageCheck,
} from 'lucide-react';
import api from '../lib/api';
import { logIdFromUnknown } from '../lib/api-error';
import { sellerShortName } from '../lib/seller-name';
import {
  logisticsBulkReadySummary,
  logisticsEmptyCopy,
  logisticsPrintSuccessCopy,
  logisticsSkippedNotice,
  openPdfFromBase64,
  type LogisticsChannel,
  type LogisticsStage,
  type LogisticsUrgency,
} from '../lib/logistics-inbox';
import { noticeFromError, type InboxNotice } from '../lib/inbox-notice';
import { CopyableLogId } from '../components/CopyableLogId';
import { PrototypeSwitcher } from '../components/PrototypeSwitcher';
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
  VariantA,
  VariantB,
  VariantC,
  type BandejaView,
  type LogisticsOrder,
} from './bandeja-prototype';

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
  const variant = (params.get('variant') || 'B').toUpperCase();
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
  const [readyOrder, setReadyOrder] = useState<LogisticsOrder | null>(null);
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
      setReadyOrder(null);
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

  const closeReady = () => {
    if (readyMutation.isPending) return;
    setReadyOrder(null);
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
    requestReady: (order) => setReadyOrder(order),
    requestBulkReady: (targets) => setBulkReady(targets),
    labelSelection,
    setLabelSelection,
    toggleLabel,
    emptyCopy: logisticsEmptyCopy(stage, stage === 'shipped' ? null : urgency),
  };

  const body = variant === 'A' ? <VariantA view={view} />
    : variant === 'C' ? <VariantC view={view} />
      : <VariantB view={view} />;

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
                    Falabella cambiará a listo para envío todos los productos de esta orden y descontará el stock. No lo hagas si falta algún producto por empacar.
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeReady} disabled={readyMutation.isPending}>Cancelar</Button>
                <Button onClick={() => markReady(readyOrder)} disabled={readyMutation.isPending}>
                  {readyMutation.isPending ? <Loader2 className="animate-spin" /> : <PackageCheck />}
                  Confirmar y marcar listo
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
