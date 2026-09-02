import { useDeferredValue, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ImageIcon,
  Loader2,
  PackageCheck,
  Printer,
  RefreshCw,
  Search,
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
  logisticsChannelDotClass,
  logisticsChannelLabel,
  logisticsCountLabel,
  logisticsDeadlineLabel,
  logisticsDeliveryLabel,
  logisticsElapsedLabel,
  logisticsEmptyCopy,
  logisticsFlowCopy,
  logisticsFlowSteps,
  logisticsNextStep,
  logisticsPrintSuccessCopy,
  logisticsQuantityLabel,
  logisticsSkippedNotice,
  logisticsUrgency,
  logisticsUrgencyMeta,
  openPdfFromBase64,
  productImageSrc,
  LOGISTICS_CHANNELS,
  LOGISTICS_STAGES,
  LOGISTICS_URGENCIES,
  type LogisticsChannel,
  type LogisticsStage,
  type LogisticsUrgency,
} from '../lib/logistics-inbox';
import { noticeFromError, type InboxNotice } from '../lib/inbox-notice';
import { CopyableLogId } from '../components/CopyableLogId';
import { usePermissions } from '../hooks/usePermissions';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { Input } from '../components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../components/ui/tooltip';

type LogisticsItem = {
  id: number;
  sku?: string | null;
  shopSku?: string | null;
  description: string;
  quantity: number;
  lineCount?: number;
  imageUrl?: string | null;
};

type LogisticsOrder = {
  id: number;
  companyId: number | null;
  companyName: string;
  channelCode: string;
  channelName: string;
  externalOrderId: string;
  externalOrderNumber: string;
  fulfillmentStatus: string;
  stage: LogisticsStage;
  urgency: LogisticsUrgency;
  currency: string;
  total: number | null;
  customer?: { name?: string; phone?: string; documentNumber?: string };
  shipping?: { type?: string; carrier?: string; address?: string; district?: string; trackingCode?: string };
  metadata?: { delivery?: string; shippingCarrier?: string };
  promisedShippingAt?: string | null;
  orderedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  itemsCount: number;
  items: LogisticsItem[];
  labelPrint?: { printCount: number; lastPrintedAt: string | null } | null;
};

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

function ProductThumb({ item, size = 'size-9' }: { item: LogisticsItem; size?: string }) {
  const [failed, setFailed] = useState(false);
  const src = productImageSrc(item.imageUrl, item.shopSku);
  return (
    <span className={cn('relative grid shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-white', size)}>
      <ImageIcon className="size-3.5 text-muted-foreground/40" />
      {src && !failed && (
        <img src={src} alt="" loading="lazy" className="absolute inset-0 size-full object-contain p-0.5" onError={() => setFailed(true)} />
      )}
    </span>
  );
}

function QuantityTag({ item }: { item: LogisticsItem }) {
  const many = item.quantity > 1;
  return (
    <span className={cn(
      'shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums',
      many ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground',
    )}>
      {logisticsQuantityLabel(item)}
    </span>
  );
}

function OrderProducts({ items, compact = false }: { items: LogisticsItem[]; compact?: boolean }) {
  if (!items.length) return <span className="text-xs text-muted-foreground">Sin productos informados</span>;
  const visible = compact ? items.slice(0, 2) : items;
  const hidden = items.length - visible.length;
  return (
    <div className="space-y-1">
      {visible.map((item) => (
        <div key={item.id} className="flex min-w-0 items-center gap-2">
          <ProductThumb item={item} size={compact ? 'size-9' : 'size-11'} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-foreground" title={item.description}>{item.description}</p>
            {item.sku && <p className="truncate text-[10px] text-muted-foreground">{item.sku}</p>}
          </div>
          <QuantityTag item={item} />
        </div>
      ))}
      {hidden > 0 && <p className="pl-11 text-[11px] text-muted-foreground">+{hidden} producto{hidden === 1 ? '' : 's'} más</p>}
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
    <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${toneClass}`} role="status">
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

function NextStepButton({
  order,
  busy,
  canDispatch,
  onPrint,
  onReady,
  onOpen,
  full = false,
}: {
  order: LogisticsOrder;
  busy: boolean;
  canDispatch: boolean;
  onPrint: () => void;
  onReady: () => void;
  onOpen: () => void;
  full?: boolean;
}) {
  const step = logisticsNextStep(order);
  const width = full ? 'w-full' : '';
  if (step.kind === 'print') {
    const printed = labelWasPrinted(order);
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant={printed ? 'outline' : 'default'}
            className={cn(width, printed && 'text-emerald-700 hover:text-emerald-800')}
            onClick={onPrint}
            disabled={busy}
          >
            {busy ? <Loader2 className="animate-spin" /> : printed ? <CheckCircle2 /> : <Printer />}
            {step.label}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{labelPrintTooltip(order)}</TooltipContent>
      </Tooltip>
    );
  }
  if (step.kind === 'ready') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="sm" variant="secondary" className={cn(width, 'border border-orange-200 bg-orange-50 text-orange-900 hover:bg-orange-100')} onClick={canDispatch ? onReady : onOpen} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <PackageCheck />}
            {canDispatch ? 'Marcar listo' : 'Solo lectura'}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{canDispatch ? 'Confirmar que está empacado y habilitar la etiqueta de Falabella.' : 'Tu perfil es de solo lectura.'}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Button size="sm" variant="ghost" className={cn(width, 'text-muted-foreground')} onClick={onOpen}>
      {step.kind === 'wait' ? step.label : 'Ver detalle'}
    </Button>
  );
}

export default function BandejaLogistica() {
  const queryClient = useQueryClient();
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
  const urgencyCounts = counts.urgency || EMPTY_URGENCY;
  const openCount = urgencyCounts.overdue + urgencyCounts.today + urgencyCounts.tomorrow + urgencyCounts.later;
  const totalCount = inboxQuery.data?.totalCount || 0;
  const loading = inboxQuery.isPending && !inboxQuery.data;
  const printableVisible = orders.filter(canPrintLogisticsLabel);
  const readyCandidates = orders.filter(canMarkFalabellaReady);
  const selectedOrders = labelSelection ? printableVisible.filter((order) => labelSelection.has(order.id)) : [];
  const unprintedVisible = printableVisible.filter((order) => !labelWasPrinted(order));
  const allSelected = printableVisible.length > 0 && selectedOrders.length === printableVisible.length;
  const updatedAt = inboxQuery.dataUpdatedAt ? new Date(inboxQuery.dataUpdatedAt) : null;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['logistics-inbox'] });

  const changeStage = (next: LogisticsStage) => {
    setStage(next);
    setLabelSelection(null);
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

  const startLabelSelection = () => {
    setLabelSelection(new Set((unprintedVisible.length ? unprintedVisible : printableVisible).map((order) => order.id)));
  };
  const toggleLabel = (order: LogisticsOrder) => {
    setLabelSelection((current) => {
      const next = new Set(current || []);
      if (next.has(order.id)) next.delete(order.id);
      else next.add(order.id);
      return next;
    });
  };
  const toggleAllLabels = () => {
    setLabelSelection(allSelected ? new Set() : new Set(printableVisible.map((order) => order.id)));
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

  const detailUrgency = detail ? logisticsUrgency(detail, now) : null;
  const detailShipped = detail?.stage === 'shipped';
  const selectionMode = labelSelection !== null;
  const pageStart = totalCount ? offset + 1 : 0;
  const pageEnd = Math.min(offset + orders.length, totalCount);
  const emptyCopy = logisticsEmptyCopy(stage, stage === 'shipped' ? null : urgency);
  const refreshing = syncMutation.isPending || inboxQuery.isFetching;

  return (
    <div className="space-y-3">
      <section aria-label="Prioridad de entrega" className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-1 rounded-lg border border-border bg-card p-1" role="group" aria-label="Prioridad de entrega">
          {LOGISTICS_URGENCIES.map((item) => {
            const active = urgency === item.value && stage !== 'shipped';
            const count = urgencyCounts[item.value];
            return (
              <button
                key={item.value}
                type="button"
                aria-pressed={active}
                aria-label={`${item.label}: ${count}`}
                title={active ? 'Quitar filtro' : item.description}
                disabled={stage === 'shipped'}
                onClick={() => setUrgency((current) => current === item.value ? null : item.value)}
                className={cn(
                  'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-50',
                  active ? cn('ring-1', item.activeClass) : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <span className={cn('size-2 rounded-full', item.dotClass)} aria-hidden="true" />
                <span className="font-medium">{item.label}</span>
                <span className={cn('font-semibold tabular-nums', count === 0 && !active && 'opacity-50')}>{count}</span>
              </button>
            );
          })}
          <span className="hidden px-2 text-xs text-muted-foreground xl:inline">{openCount} sin enviar</span>
        </div>
        <div className="flex items-center justify-between gap-3 lg:justify-end">
          <span className="text-[11px] text-muted-foreground">
            {updatedAt ? `Actualizado ${formatLogisticsDateTime(updatedAt.toISOString())}` : 'Cargando…'}
          </span>
          <Button size="sm" variant="outline" onClick={refresh} disabled={refreshing}>
            {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {syncMutation.isPending ? 'Sincronizando…' : canSync ? 'Sincronizar' : 'Actualizar'}
          </Button>
        </div>
      </section>

      <div role="tablist" aria-label="Flujo de pedidos" className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
        {LOGISTICS_STAGES.map((tab) => {
          const active = stage === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => changeStage(tab.value)}
              className={cn(
                'flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition',
                active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="truncate">{tab.label}</span>
              <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums', active ? tab.badgeClass : 'bg-background text-muted-foreground')}>
                {counts[tab.value]}
              </span>
            </button>
          );
        })}
      </div>

      {selectionMode && (
        <div className="flex flex-col gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-indigo-950 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Checkbox checked={allSelected} onCheckedChange={toggleAllLabels} aria-label="Seleccionar todas las etiquetas disponibles" />
            <p className="text-sm">
              <span className="font-semibold">{selectedOrders.length} de {printableVisible.length}</span> etiquetas seleccionadas
              <span className="ml-2 text-xs text-indigo-800">
                {unprintedVisible.length ? `· ${unprintedVisible.length} sin imprimir` : '· todas ya impresas'}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button type="button" variant="ghost" size="sm" onClick={() => setLabelSelection(new Set(unprintedVisible.map((order) => order.id)))} disabled={printMutation.isPending || !unprintedVisible.length}>
              Solo no impresas
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setLabelSelection(null)} disabled={printMutation.isPending}>
              Cancelar
            </Button>
            <Button type="button" size="sm" onClick={() => printOrders(selectedOrders)} disabled={!selectedOrders.length || printMutation.isPending}>
              {printMutation.isPending ? <Loader2 className="animate-spin" /> : <Printer />}
              {printMutation.isPending ? 'Preparando PDF…' : selectedOrders.length ? `Imprimir ${selectedOrders.length} en A4` : 'Imprimir en A4'}
            </Button>
          </div>
        </div>
      )}

      {notice && <InboxStatusNotice notice={notice} />}

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-border bg-card py-20 text-sm text-muted-foreground">
          <Loader2 className="size-5 animate-spin" /> Cargando pedidos…
        </div>
      ) : (
        <section className="overflow-hidden rounded-lg border border-border bg-card" aria-label="Bandeja de pedidos" aria-busy={inboxQuery.isFetching}>
          <div className="flex flex-col gap-2 border-b border-border px-3 py-2 md:flex-row md:items-center md:justify-between">
            <div role="group" aria-label="Canal" className="flex max-w-full gap-1 overflow-x-auto">
              {LOGISTICS_CHANNELS.map((channel) => {
                const active = channelCode === channel.value;
                return (
                  <button
                    key={channel.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => { setChannelCode(channel.value); setLabelSelection(null); }}
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition',
                      active
                        ? channel.value === 'all' ? 'border-foreground bg-foreground text-background' : logisticsChannelClass(channel.value)
                        : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    {channel.value !== 'all' && <span className={cn('size-1.5 rounded-full', logisticsChannelDotClass(channel.value))} aria-hidden="true" />}
                    {channel.label}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Buscar pedido"
                  aria-label="Buscar pedidos"
                  className="h-8 w-44 rounded-md border-border bg-background pl-8 text-xs shadow-none"
                />
              </div>
              {stage !== 'shipped' && printableVisible.length > 0 && !selectionMode && (
                <Button size="sm" variant="outline" onClick={startLabelSelection} disabled={printMutation.isPending}>
                  <Printer /> Imprimir etiquetas
                </Button>
              )}
              {stage === 'pending' && canDispatch && readyCandidates.length > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="sm" variant="outline" onClick={() => setBulkReady(readyCandidates)}>
                      <PackageCheck /> Marcar todos ({readyCandidates.length})
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Marcar listos para enviar todos los pedidos Falabella visibles.</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>

          <div className="divide-y divide-border/70 md:hidden">
            {orders.map((order) => {
              const orderUrgency = logisticsUrgency(order, now);
              const meta = logisticsUrgencyMeta(orderUrgency);
              const printable = canPrintLogisticsLabel(order);
              const selected = Boolean(labelSelection?.has(order.id));
              return (
                <article key={order.id} className={cn('px-3 py-2.5', selected && 'bg-indigo-50/60')}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      {selectionMode && printable && (
                        <Checkbox checked={selected} onCheckedChange={() => toggleLabel(order)} aria-label={`Seleccionar etiqueta del pedido ${order.externalOrderNumber}`} />
                      )}
                      <button type="button" onClick={() => openOrder(order)} className="truncate font-mono text-sm font-semibold text-foreground hover:underline">
                        {order.externalOrderNumber || order.externalOrderId}
                      </button>
                      <span className={cn('size-2 shrink-0 rounded-full', logisticsChannelDotClass(order.channelCode))} title={logisticsChannelLabel(order.channelCode)} />
                    </div>
                    {stage === 'shipped'
                      ? <span className="text-xs text-muted-foreground">{formatLogisticsDateTime(order.updatedAt)}</span>
                      : <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', meta.pillClass)}>{logisticsDeadlineLabel(order, now)}</span>}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {order.customer?.name || 'Sin cliente'} · {sellerShortName(order.companyName)} · {logisticsDeliveryLabel(order)}
                  </p>
                  <div className="mt-2"><OrderProducts items={order.items} compact /></div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">{logisticsElapsedLabel(order.createdAt || order.orderedAt, now) || 'Sin fecha de ingreso'}</span>
                    <NextStepButton
                      order={order}
                      busy={busyOrderId === order.id && (printMutation.isPending || readyMutation.isPending)}
                      canDispatch={canDispatch}
                      onPrint={() => printOrders([order])}
                      onReady={() => { openOrder(order); setConfirmReady(true); }}
                      onOpen={() => openOrder(order)}
                    />
                  </div>
                </article>
              );
            })}
            {orders.length === 0 && <p className="px-4 py-14 text-center text-sm text-muted-foreground">{emptyCopy}</p>}
          </div>

          <div className="hidden md:block">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col className="w-[19%]" />
                <col className="w-[37%]" />
                <col className="w-[17%]" />
                <col className="w-[13%]" />
                <col className="w-[14%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">
                    <span className="inline-flex items-center gap-2">
                      {selectionMode && printableVisible.length > 0 && (
                        <Checkbox
                          checked={allSelected ? true : selectedOrders.length > 0 ? 'indeterminate' : false}
                          onCheckedChange={toggleAllLabels}
                          aria-label="Seleccionar todas las etiquetas"
                        />
                      )}
                      Pedido
                    </span>
                  </th>
                  <th className="px-3 py-2 font-medium">Productos</th>
                  <th className="px-3 py-2 font-medium">{stage === 'shipped' ? 'Enviado' : 'Entrega'}</th>
                  <th className="px-3 py-2 font-medium">Tienda</th>
                  <th className="px-3 py-2 text-right font-medium">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {orders.map((order) => {
                  const orderUrgency = logisticsUrgency(order, now);
                  const meta = logisticsUrgencyMeta(orderUrgency);
                  const printable = canPrintLogisticsLabel(order);
                  const selected = Boolean(labelSelection?.has(order.id));
                  return (
                    <tr key={order.id} className={cn('transition-colors', selected ? 'bg-indigo-50/60' : 'hover:bg-muted/30')}>
                      <td className="px-3 py-2 align-middle">
                        <div className="flex items-center gap-2">
                          {selectionMode && printable && (
                            <Checkbox
                              checked={selected}
                              onCheckedChange={() => toggleLabel(order)}
                              aria-label={`Seleccionar etiqueta del pedido ${order.externalOrderNumber}`}
                            />
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <button type="button" onClick={() => openOrder(order)} className="truncate font-mono text-xs font-semibold text-foreground underline-offset-2 hover:underline">
                                {order.externalOrderNumber || order.externalOrderId}
                              </button>
                              <span className={cn('size-2 shrink-0 rounded-full', logisticsChannelDotClass(order.channelCode))} title={logisticsChannelLabel(order.channelCode)} aria-label={logisticsChannelLabel(order.channelCode)} />
                            </div>
                            <p className="truncate text-[11px] text-muted-foreground">{order.customer?.name || 'Sin cliente'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 align-middle"><OrderProducts items={order.items} compact /></td>
                      <td className="px-3 py-2 align-middle text-xs">
                        {stage === 'shipped' ? (
                          <span className="text-foreground">{formatLogisticsDateTime(order.updatedAt)}</span>
                        ) : (
                          <span className={cn('inline-flex max-w-full truncate rounded-full px-2 py-0.5 text-[11px] font-medium', meta.pillClass)}>
                            {logisticsDeadlineLabel(order, now)}
                          </span>
                        )}
                        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground" title={formatLogisticsDateTime(order.createdAt || order.orderedAt)}>
                          Ingresó {logisticsElapsedLabel(order.createdAt || order.orderedAt, now) || 'sin fecha'}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-middle text-xs">
                        <p className="truncate font-medium text-foreground" title={order.companyName}>{sellerShortName(order.companyName)}</p>
                        <p className="truncate text-[11px] text-muted-foreground">{logisticsDeliveryLabel(order)}</p>
                      </td>
                      <td className="px-3 py-2 text-right align-middle">
                        <NextStepButton
                          order={order}
                          busy={busyOrderId === order.id && (printMutation.isPending || readyMutation.isPending)}
                          canDispatch={canDispatch}
                          onPrint={() => printOrders([order])}
                          onReady={() => { openOrder(order); setConfirmReady(true); }}
                          onOpen={() => openOrder(order)}
                        />
                      </td>
                    </tr>
                  );
                })}
                {orders.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-14 text-center text-sm text-muted-foreground">{emptyCopy}</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {totalCount > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
              <span>{pageStart}–{pageEnd} de {logisticsCountLabel(stage, totalCount)}</span>
              {totalCount > PAGE_SIZE && (
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" disabled={offset === 0 || inboxQuery.isFetching} onClick={() => { setPage({ key: filterKey, offset: Math.max(0, offset - PAGE_SIZE) }); setLabelSelection(null); }}>
                    <ChevronLeft /> Anterior
                  </Button>
                  <Button size="sm" variant="ghost" disabled={pageEnd >= totalCount || inboxQuery.isFetching} onClick={() => { setPage({ key: filterKey, offset: offset + PAGE_SIZE }); setLabelSelection(null); }}>
                    Siguiente <ChevronRight />
                  </Button>
                </div>
              )}
            </div>
          )}
        </section>
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
                <dl className="grid grid-cols-2 gap-4 rounded-md border border-border p-4 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Pedido</dt>
                    <dd className="mt-1 font-mono font-semibold">{detail.externalOrderNumber}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Contenido</dt>
                    <dd className="mt-1 font-medium">{detail.itemsCount} unidad{detail.itemsCount === 1 ? '' : 'es'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Entrega</dt>
                    <dd className="mt-1 font-medium">{logisticsDeadlineLabel(detail, now)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Siguiente paso</dt>
                    <dd className="mt-1 font-medium">Imprimir etiqueta y guía</dd>
                  </div>
                </dl>
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

                <section className="rounded-md border border-border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-foreground">Flujo de despacho</h3>
                    <span className="text-xs font-medium text-muted-foreground">
                      {logisticsFlowSteps(detail).filter((step) => step.state === 'done').length} de 3
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                    {logisticsFlowSteps(detail).map((step, index) => (
                      <div
                        key={step.label}
                        className={cn(
                          'rounded-md border px-2 py-1.5',
                          step.state === 'done' ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : step.state === 'current' ? 'border-orange-200 bg-orange-50 text-orange-700'
                              : 'border-border bg-muted/30 text-muted-foreground',
                        )}
                      >
                        <span className="font-semibold">{index + 1}</span>
                        <p className="mt-0.5">{step.label}</p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{logisticsFlowCopy(detail)}</p>
                </section>

                <dl className="grid grid-cols-2 gap-x-5 gap-y-3 rounded-md border border-border p-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Ingresó</dt>
                    <dd className="mt-0.5 font-medium text-foreground">{formatLogisticsDateTime(detail.createdAt || detail.orderedAt)}</dd>
                    <dd className="text-xs text-muted-foreground">{logisticsElapsedLabel(detail.createdAt || detail.orderedAt, now)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Total</dt>
                    <dd className="mt-0.5 font-semibold tabular-nums text-foreground">{formatMoney(detail.total, detail.currency)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Cliente</dt>
                    <dd className="mt-0.5 font-medium text-foreground">{detail.customer?.name || 'No informado'}</dd>
                    {detail.customer?.phone && <dd className="text-xs text-muted-foreground">Tel. {detail.customer.phone}</dd>}
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Entrega</dt>
                    <dd className="mt-0.5 font-medium text-foreground">{logisticsDeliveryLabel(detail)}</dd>
                    {(detail.shipping?.address || detail.shipping?.district) && (
                      <dd className="text-xs text-muted-foreground">{[detail.shipping?.address, detail.shipping?.district].filter(Boolean).join(', ')}</dd>
                    )}
                  </div>
                </dl>

                <section className="rounded-md border border-border p-3">
                  <h3 className="text-sm font-semibold text-foreground">Contenido · {detail.itemsCount} unidad{detail.itemsCount === 1 ? '' : 'es'}</h3>
                  <div className="mt-2"><OrderProducts items={detail.items} /></div>
                </section>

                {labelWasPrinted(detail) && (
                  <p className="text-xs text-emerald-700">{labelPrintTooltip(detail)}</p>
                )}

                <DialogFooter>
                  <Button variant="outline" onClick={closeOrder}>Cerrar</Button>
                  {canPrintLogisticsLabel(detail) && (
                    <Button
                      variant={labelWasPrinted(detail) ? 'outline' : 'default'}
                      onClick={() => printOrders([detail])}
                      disabled={printMutation.isPending}
                    >
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
