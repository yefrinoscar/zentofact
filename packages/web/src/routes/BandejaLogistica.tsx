import { useDeferredValue, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ImageIcon,
  Loader2,
  PackageCheck,
  Printer,
  RefreshCw,
  Search,
  Store,
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
  logisticsCountLabel,
  logisticsDeadlineLabel,
  logisticsDeliveryLabel,
  logisticsElapsedLabel,
  logisticsEmptyCopy,
  logisticsFlowCopy,
  logisticsFlowSteps,
  logisticsNextStep,
  logisticsPrintSuccessCopy,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
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

type Company = {
  id: number;
  nombre?: string | null;
  nombreComercial?: string | null;
  razonSocial?: string | null;
};

type LogisticsItem = {
  id: number;
  sku?: string | null;
  shopSku?: string | null;
  description: string;
  quantity: number;
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

function companyLabel(company: Company) {
  return sellerShortName(company.nombreComercial || company.nombre || company.razonSocial);
}

function formatMoney(value: number | null, currency = 'PEN') {
  try {
    return new Intl.NumberFormat('es-PE', { style: 'currency', currency }).format(value || 0);
  } catch {
    return new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(value || 0);
  }
}

function stageBadge(order: LogisticsOrder) {
  if (order.stage === 'shipped') return { label: 'Enviado', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' };
  if (order.stage === 'ready') return { label: 'Listo para enviar', className: 'border-sky-200 bg-sky-50 text-sky-700' };
  return { label: 'Pendiente', className: 'border-amber-200 bg-amber-50 text-amber-700' };
}

function ProductThumb({ item }: { item: LogisticsItem }) {
  const [failed, setFailed] = useState(false);
  const src = productImageSrc(item.imageUrl, item.shopSku);
  return (
    <span className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-white">
      <ImageIcon className="size-4 text-muted-foreground/40" />
      {src && !failed && (
        <img src={src} alt="" loading="lazy" className="absolute inset-0 size-full object-contain p-0.5" onError={() => setFailed(true)} />
      )}
    </span>
  );
}

function OrderProducts({ items, compact = false }: { items: LogisticsItem[]; compact?: boolean }) {
  if (!items.length) return <span className="text-xs text-muted-foreground">Sin productos informados</span>;
  const visible = compact ? items.slice(0, 2) : items;
  const hidden = items.length - visible.length;
  return (
    <div className="space-y-1.5">
      {visible.map((item) => (
        <div key={item.id} className="flex min-w-0 items-center gap-2.5">
          <ProductThumb item={item} />
          <div className="min-w-0">
            <p className="line-clamp-2 text-xs font-medium leading-snug text-foreground">{item.description}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {item.quantity > 1 ? `${item.quantity} unidades` : '1 unidad'}{item.sku ? ` · ${item.sku}` : ''}
            </p>
          </div>
        </div>
      ))}
      {hidden > 0 && <p className="text-[11px] text-muted-foreground">+{hidden} producto{hidden === 1 ? '' : 's'} más</p>}
    </div>
  );
}

function InboxStatusNotice({ notice }: { notice: InboxNotice }) {
  const toneClass = notice.tone === 'error'
    ? 'border-destructive/30 bg-destructive/5 text-destructive'
    : notice.tone === 'warning'
      ? 'border-amber-200 bg-amber-50 text-amber-950'
      : 'border-emerald-200 bg-emerald-50 text-emerald-700';
  const Icon = notice.tone === 'success' ? CheckCircle2 : AlertCircle;
  return (
    <div className={`flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm ${toneClass}`} role="status">
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
      <div className={cn('inline-flex flex-col items-start gap-0.5', full && 'w-full')}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant={printed ? 'outline' : 'default'}
              className={cn(width, printed && 'opacity-60 hover:opacity-85')}
              onClick={onPrint}
              disabled={busy}
            >
              {busy ? <Loader2 className="animate-spin" /> : <Printer />}
              {step.label}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{labelPrintTooltip(order)}</TooltipContent>
        </Tooltip>
        {printed && <span className="text-[10px] font-medium text-emerald-700">Impresa</span>}
      </div>
    );
  }
  if (step.kind === 'ready') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="sm" className={width} onClick={canDispatch ? onReady : onOpen} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <PackageCheck />}
            {canDispatch ? 'Marcar listo' : 'Solo lectura'}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{canDispatch ? 'Confirmar que el pedido está empacado y habilitar la etiqueta de Falabella.' : 'Tu perfil es de solo lectura.'}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Button size="sm" variant="outline" className={width} onClick={onOpen}>
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
  const [companyId, setCompanyId] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const search = useDeferredValue(searchInput.trim());
  const [page, setPage] = useState<{ key: string; offset: number }>({ key: '', offset: 0 });
  const [labelSelection, setLabelSelection] = useState<Set<number> | null>(null);
  const [detail, setDetail] = useState<LogisticsOrder | null>(null);
  const [confirmReady, setConfirmReady] = useState(false);
  const [bulkReady, setBulkReady] = useState<LogisticsOrder[] | null>(null);
  const [notice, setNotice] = useState<InboxNotice | null>(null);
  const [busyOrderId, setBusyOrderId] = useState<number | null>(null);

  const filterKey = [stage, channelCode, urgency || '', companyId, search].join('|');
  const offset = page.key === filterKey ? page.offset : 0;
  const filters = {
    stage,
    channelCode: channelCode === 'all' ? undefined : channelCode,
    urgency: stage === 'shipped' || !urgency ? undefined : urgency,
    companyId: companyId === 'all' ? undefined : Number(companyId),
    search: search || undefined,
    limit: PAGE_SIZE,
    offset,
  };

  const companiesQuery = useQuery({
    queryKey: ['order-companies'],
    queryFn: () => api.listCompanies(),
    staleTime: 5 * 60_000,
  });
  const inboxQuery = useQuery({
    queryKey: ['logistics-inbox', filters],
    queryFn: () => api.listLogisticsInbox(filters) as Promise<InboxResponse>,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    refetchInterval: 60_000,
  });

  const now = new Date();
  const companies = (Array.isArray(companiesQuery.data) ? companiesQuery.data : []) as Company[];
  const orders = inboxQuery.data?.orders || [];
  const counts = inboxQuery.data?.counts || { pending: 0, ready: 0, shipped: 0, urgency: EMPTY_URGENCY };
  const urgencyCounts = counts.urgency || EMPTY_URGENCY;
  const openCount = urgencyCounts.overdue + urgencyCounts.today + urgencyCounts.tomorrow + urgencyCounts.later;
  const totalCount = inboxQuery.data?.totalCount || 0;
  const loading = inboxQuery.isPending && !inboxQuery.data;
  const activeStage = LOGISTICS_STAGES.find((tab) => tab.value === stage) || LOGISTICS_STAGES[0];
  const printableVisible = orders.filter(canPrintLogisticsLabel);
  const readyCandidates = orders.filter(canMarkFalabellaReady);
  const selectedOrders = labelSelection ? printableVisible.filter((order) => labelSelection.has(order.id)) : [];
  const unprintedVisible = printableVisible.filter((order) => !labelWasPrinted(order));
  const allSelected = printableVisible.length > 0 && selectedOrders.length === printableVisible.length;
  const sellerCounts = Object.values(orders.reduce<Record<string, { name: string; count: number }>>((acc, order) => {
    const key = String(order.companyId ?? order.companyName);
    acc[key] ||= { name: sellerShortName(order.companyName), count: 0 };
    acc[key].count += 1;
    return acc;
  }, {})).sort((left, right) => right.count - left.count);
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

  return (
    <div className="space-y-4">
      <section aria-label="Filtros de pedidos">
        <div className="grid gap-2 md:grid-cols-[220px_minmax(0,1fr)_160px]">
          <Select value={companyId} onValueChange={setCompanyId}>
            <SelectTrigger aria-label="Tienda" className="!h-12 w-full rounded-lg border-border bg-card px-3 py-0 shadow-none md:!h-10">
              <Store className="size-4 text-muted-foreground" />
              <SelectValue placeholder="Todas las tiendas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las tiendas</SelectItem>
              {companies.map((company) => (
                <SelectItem key={company.id} value={String(company.id)}>{companyLabel(company)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Buscar pedido, cliente o SKU"
              aria-label="Buscar pedidos"
              className="h-12 rounded-lg border-border bg-card py-0 pl-10 pr-4 shadow-none md:h-10"
            />
          </div>
          <Button size="lg" className="h-12 w-full rounded-lg px-4 font-semibold md:h-10" onClick={refresh} disabled={syncMutation.isPending || inboxQuery.isFetching}>
            {syncMutation.isPending || inboxQuery.isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {syncMutation.isPending ? 'Sincronizando…' : canSync ? 'Sincronizar' : 'Actualizar'}
          </Button>
        </div>
      </section>

      <section aria-label="Prioridad de entrega">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <div>
            <div className="flex items-baseline gap-2">
              <h2 className="text-sm font-semibold text-foreground">Prioridad de entrega</h2>
              <span className="text-xs text-muted-foreground">{openCount} sin enviar</span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">Pendientes y listos de Falabella, Ripley y ventas manuales. Toca una tarjeta para filtrar.</p>
          </div>
          <span className="text-[11px] text-muted-foreground/80">
            {updatedAt ? `Actualizado ${formatLogisticsDateTime(updatedAt.toISOString())}` : 'Cargando…'}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {LOGISTICS_URGENCIES.map((item) => {
            const active = urgency === item.value && stage !== 'shipped';
            const count = urgencyCounts[item.value];
            return (
              <button
                key={item.value}
                type="button"
                aria-pressed={active}
                aria-label={`${item.label}: ${count}`}
                disabled={stage === 'shipped'}
                onClick={() => setUrgency((current) => current === item.value ? null : item.value)}
                className={cn(
                  'rounded-xl border px-4 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60',
                  item.className,
                  active ? 'ring-2 ring-foreground/70 ring-offset-1' : 'hover:brightness-[0.98]',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-sm font-medium">{item.label}</span>
                  <span className="text-xl font-semibold tabular-nums">{count}</span>
                </div>
                <p className="mt-1 text-xs opacity-75">{active ? 'Filtro activo · toca para quitar' : item.description}</p>
              </button>
            );
          })}
        </div>
      </section>

      {selectionMode && (
        <div className="flex flex-col gap-3 rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sky-950 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Checkbox checked={allSelected} onCheckedChange={toggleAllLabels} aria-label="Seleccionar todas las etiquetas disponibles" className="mt-0.5" />
            <div>
              <p className="text-sm font-semibold">{selectedOrders.length} de {printableVisible.length} etiquetas seleccionadas</p>
              <p className="text-xs text-sky-800">
                {unprintedVisible.length
                  ? `${unprintedVisible.length} sin imprimir marcadas por defecto. Las impresas quedan sin marcar.`
                  : 'Todas ya fueron impresas. Marca únicamente las que quieras reimprimir.'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setLabelSelection(new Set(unprintedVisible.map((order) => order.id)))} disabled={printMutation.isPending || !unprintedVisible.length}>
              Solo no impresas
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={toggleAllLabels} disabled={printMutation.isPending}>
              {allSelected ? 'Quitar todas' : 'Seleccionar todas'}
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

      <section aria-label="Estado del pedido">
        <div className="mb-2">
          <h2 className="text-sm font-semibold text-foreground">Estado del pedido</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Selecciona la etapa operativa que quieres revisar.</p>
        </div>
        <div className="rounded-xl bg-muted p-1">
          <div role="tablist" aria-label="Flujo de pedidos" className="grid grid-cols-3 gap-1">
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
                    'rounded-lg px-3 py-2.5 text-left text-sm transition',
                    active ? tab.activeClass : 'text-muted-foreground hover:bg-background/70 hover:text-foreground',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{tab.label}</p>
                      <p className="mt-0.5 truncate text-xs opacity-80">{tab.description}</p>
                    </div>
                    <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold', active ? tab.badgeClass : 'bg-background text-muted-foreground')}>
                      {counts[tab.value]}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-md border border-border bg-card py-20 text-sm text-muted-foreground">
          <Loader2 className="size-5 animate-spin" /> Cargando pedidos…
        </div>
      ) : (
        <section className="overflow-hidden rounded-xl border border-border bg-card" aria-label="Bandeja de pedidos" aria-busy={inboxQuery.isFetching}>
          <div className="border-b border-border bg-muted/30 px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{activeStage.label}</p>
                <p className="text-xs text-muted-foreground">{activeStage.description}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
                  Mostrando {logisticsCountLabel(stage, orders.length)}
                </span>
                {stage !== 'shipped' && printableVisible.length > 0 && !selectionMode && (
                  <Button size="sm" onClick={startLabelSelection} disabled={printMutation.isPending}>
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
          </div>

          <div className="border-b border-border bg-background px-4 py-2.5">
            <div role="group" aria-label="Canal" className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-muted p-1">
              {LOGISTICS_CHANNELS.map((channel) => {
                const active = channelCode === channel.value;
                return (
                  <button
                    key={channel.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => { setChannelCode(channel.value); setLabelSelection(null); }}
                    className={cn(
                      'inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition',
                      active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {channel.value !== 'all' && (
                      <span className={cn('size-2 rounded-full border', logisticsChannelClass(channel.value))} aria-hidden="true" />
                    )}
                    {channel.label}
                  </button>
                );
              })}
            </div>
            {sellerCounts.length > 0 && (
              <div className="mt-2 flex min-w-0 gap-1 overflow-x-auto pb-0.5" aria-label="Pedidos por tienda">
                {sellerCounts.map((seller) => (
                  <span
                    key={seller.name}
                    className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted/70 px-2 py-0.5 text-[10px] leading-4"
                    title={`${seller.name}: ${seller.count} pedido${seller.count === 1 ? '' : 's'}`}
                  >
                    <span className="max-w-28 truncate text-muted-foreground">{seller.name}</span>
                    <span className="font-semibold tabular-nums text-foreground/70">{seller.count}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="divide-y divide-border/70 md:hidden">
            {orders.map((order) => {
              const orderUrgency = logisticsUrgency(order, now);
              const meta = logisticsUrgencyMeta(orderUrgency);
              const printable = canPrintLogisticsLabel(order);
              const selected = Boolean(labelSelection?.has(order.id));
              return (
                <article key={order.id} className={cn('px-3 py-3 transition-colors', selected ? 'bg-primary/5' : 'hover:bg-muted/30')}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      {selectionMode && printable && (
                        <Checkbox checked={selected} onCheckedChange={() => toggleLabel(order)} aria-label={`Seleccionar etiqueta del pedido ${order.externalOrderNumber}`} />
                      )}
                      <p className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-foreground">
                        {orderUrgency === 'overdue' && stage !== 'shipped' && <AlertCircle className="size-3.5 shrink-0 text-rose-600" />}
                        <span className="truncate">{stage === 'shipped' ? formatLogisticsDateTime(order.updatedAt) : logisticsDeadlineLabel(order, now)}</span>
                      </p>
                    </div>
                    <Badge variant="outline" className={cn('rounded-md', logisticsChannelClass(order.channelCode))}>{logisticsChannelLabel(order.channelCode)}</Badge>
                  </div>
                  <div className="mt-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <button type="button" onClick={() => openOrder(order)} className="font-mono text-sm font-semibold text-foreground hover:underline">
                        {order.externalOrderNumber || order.externalOrderId}
                      </button>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{order.customer?.name || 'Sin cliente'} · {sellerShortName(order.companyName)}</p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{formatMoney(order.total, order.currency)}</p>
                  </div>
                  <div className="mt-2"><OrderProducts items={order.items} compact /></div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
                    <span>{logisticsElapsedLabel(order.createdAt || order.orderedAt, now) || 'Sin fecha de ingreso'}</span>
                    <span aria-hidden="true">·</span>
                    <span>{logisticsDeliveryLabel(order)}</span>
                    {stage !== 'shipped' && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className={cn('rounded-full px-1.5 py-0.5 font-medium', meta.pillClass)}>{meta.label}</span>
                      </>
                    )}
                  </div>
                  <div className="mt-2.5 flex items-center justify-between gap-3">
                    <button type="button" onClick={() => openOrder(order)} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
                      Ver detalles <ArrowRight className="size-3" />
                    </button>
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
                <col className="w-[18%]" />
                <col className="w-[30%]" />
                <col className="w-[11%]" />
                <col className="w-[15%]" />
                <col className="w-[14%]" />
                <col className="w-[12%]" />
              </colgroup>
              <thead className="bg-background">
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="p-3 font-medium">
                    <span className="inline-flex items-center gap-2">
                      {selectionMode && printableVisible.length > 0 && (
                        <Checkbox
                          checked={allSelected ? true : selectedOrders.length > 0 ? 'indeterminate' : false}
                          onCheckedChange={toggleAllLabels}
                          aria-label="Seleccionar todas las etiquetas"
                        />
                      )}
                      Orden de venta
                    </span>
                  </th>
                  <th className="p-3 font-medium">Productos</th>
                  <th className="p-3 font-medium">Ingresó</th>
                  <th className="p-3 font-medium">{stage === 'shipped' ? 'Enviado' : 'Entrega'}</th>
                  <th className="p-3 font-medium">Tienda</th>
                  <th className="p-3 font-medium">Siguiente paso</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const orderUrgency = logisticsUrgency(order, now);
                  const meta = logisticsUrgencyMeta(orderUrgency);
                  const printable = canPrintLogisticsLabel(order);
                  const selected = Boolean(labelSelection?.has(order.id));
                  return (
                    <tr key={order.id} className={cn('border-t border-border/70 transition-colors', selected ? 'bg-primary/5' : 'hover:bg-muted/30')}>
                      <td className="p-3 align-top">
                        <div className="flex items-start gap-2">
                          {selectionMode && printable && (
                            <Checkbox
                              checked={selected}
                              onCheckedChange={() => toggleLabel(order)}
                              aria-label={`Seleccionar etiqueta del pedido ${order.externalOrderNumber}`}
                              className="mt-0.5"
                            />
                          )}
                          <div className="min-w-0">
                            <button type="button" onClick={() => openOrder(order)} className="block max-w-full truncate font-mono text-xs font-semibold text-foreground underline-offset-2 hover:underline">
                              {order.externalOrderNumber || order.externalOrderId}
                            </button>
                            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{order.customer?.name || 'Sin cliente'}</p>
                            <Badge variant="outline" className={cn('mt-1.5 rounded-md text-[10px]', logisticsChannelClass(order.channelCode))}>
                              {logisticsChannelLabel(order.channelCode)}
                            </Badge>
                          </div>
                        </div>
                      </td>
                      <td className="p-3 align-top"><OrderProducts items={order.items} compact /></td>
                      <td className="p-3 align-top text-xs">
                        <span className="font-medium text-foreground">{logisticsElapsedLabel(order.createdAt || order.orderedAt, now) || 'Sin fecha'}</span>
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">{formatLogisticsDateTime(order.createdAt || order.orderedAt)}</span>
                      </td>
                      <td className="p-3 align-top text-xs">
                        {stage === 'shipped' ? (
                          <span className="text-muted-foreground">{formatLogisticsDateTime(order.updatedAt)}</span>
                        ) : (
                          <span className={cn('inline-flex max-w-full truncate rounded-full px-2.5 py-1 text-xs font-medium', meta.pillClass)}>
                            {logisticsDeadlineLabel(order, now)}
                          </span>
                        )}
                        <span className="mt-1 block text-[11px] text-muted-foreground">{logisticsDeliveryLabel(order)}</span>
                      </td>
                      <td className="p-3 align-top text-xs">
                        <p className="truncate font-medium text-foreground" title={order.companyName}>{sellerShortName(order.companyName)}</p>
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{formatMoney(order.total, order.currency)}</p>
                      </td>
                      <td className="p-3 align-top">
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
                  <tr><td colSpan={6} className="px-4 py-14 text-center text-sm text-muted-foreground">{emptyCopy}</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {totalCount > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
              <span>{pageStart}–{pageEnd} de {logisticsCountLabel(stage, totalCount)}</span>
              {totalCount > PAGE_SIZE && (
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="outline" disabled={offset === 0 || inboxQuery.isFetching} onClick={() => { setPage({ key: filterKey, offset: Math.max(0, offset - PAGE_SIZE) }); setLabelSelection(null); }}>
                    <ChevronLeft /> Anterior
                  </Button>
                  <Button size="sm" variant="outline" disabled={pageEnd >= totalCount || inboxQuery.isFetching} onClick={() => { setPage({ key: filterKey, offset: offset + PAGE_SIZE }); setLabelSelection(null); }}>
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
          <div className="rounded-md bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
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
                <div className="flex gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-amber-900">
                  <PackageCheck className="mt-0.5 size-5 shrink-0" />
                  <div>
                    <p className="font-semibold">Confirma que todo el pedido está empacado</p>
                    <p className="mt-1 text-sm text-amber-800">
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
                    <DialogTitle className="font-mono">Pedido {detail.externalOrderNumber || detail.externalOrderId}</DialogTitle>
                    <Badge variant="outline" className={cn('rounded-md', stageBadge(detail).className)}>{stageBadge(detail).label}</Badge>
                    <Badge variant="outline" className={cn('rounded-md', logisticsChannelClass(detail.channelCode))}>{logisticsChannelLabel(detail.channelCode)}</Badge>
                  </div>
                  <DialogDescription>{sellerShortName(detail.companyName)} · {logisticsDeliveryLabel(detail)}</DialogDescription>
                </DialogHeader>

                <div className={cn(
                  'rounded-md border p-4',
                  detailShipped ? 'border-emerald-200 bg-emerald-50' : detailUrgency === 'overdue' ? 'border-rose-200 bg-rose-50' : detailUrgency === 'today' ? 'border-amber-200 bg-amber-50' : 'border-border bg-muted/30',
                )}>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {detailShipped ? 'Estado de entrega' : 'Límite para entregar al operador logístico'}
                  </p>
                  <p className={cn(
                    'mt-1 text-xl font-semibold',
                    detailShipped ? 'text-emerald-700' : detailUrgency === 'overdue' ? 'text-rose-700' : detailUrgency === 'today' ? 'text-amber-700' : 'text-foreground',
                  )}>
                    {detailShipped ? 'Enviado' : logisticsDeadlineLabel(detail, now)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {detailShipped
                      ? `Última actualización: ${formatLogisticsDateTime(detail.updatedAt)}`
                      : detail.promisedShippingAt
                        ? `Fecha prometida: ${formatLogisticsDateTime(detail.promisedShippingAt)}`
                        : 'El canal no informó una fecha de entrega.'}
                  </p>
                </div>

                <section className="rounded-md border border-border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Flujo de despacho</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">Completa los pasos en orden.</p>
                    </div>
                    <span className="text-xs font-medium text-muted-foreground">
                      {logisticsFlowSteps(detail).filter((step) => step.state === 'done').length} de 3
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                    {logisticsFlowSteps(detail).map((step, index) => (
                      <div
                        key={step.label}
                        className={cn(
                          'rounded-md border px-2 py-2',
                          step.state === 'done' ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : step.state === 'current' ? 'border-amber-200 bg-amber-50 text-amber-700'
                              : 'border-border bg-muted/30 text-muted-foreground',
                        )}
                      >
                        <span className="font-semibold">{index + 1}</span>
                        <p className="mt-0.5">{step.label}</p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">{logisticsFlowCopy(detail)}</p>
                </section>

                <dl className="grid grid-cols-2 gap-x-5 gap-y-4 rounded-md border border-border p-4 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Ingresó</dt>
                    <dd className="mt-1 font-medium text-foreground">{formatLogisticsDateTime(detail.createdAt || detail.orderedAt)}</dd>
                    <dd className="text-xs text-muted-foreground">{logisticsElapsedLabel(detail.createdAt || detail.orderedAt, now)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Total</dt>
                    <dd className="mt-1 font-semibold tabular-nums text-foreground">{formatMoney(detail.total, detail.currency)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Cliente</dt>
                    <dd className="mt-1 font-medium text-foreground">{detail.customer?.name || 'No informado'}</dd>
                    {detail.customer?.phone && <dd className="text-xs text-muted-foreground">Tel. {detail.customer.phone}</dd>}
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Entrega</dt>
                    <dd className="mt-1 font-medium text-foreground">{logisticsDeliveryLabel(detail)}</dd>
                    {(detail.shipping?.address || detail.shipping?.district) && (
                      <dd className="text-xs text-muted-foreground">{[detail.shipping?.address, detail.shipping?.district].filter(Boolean).join(', ')}</dd>
                    )}
                  </div>
                </dl>

                <section className="rounded-md border border-border p-4">
                  <h3 className="text-sm font-semibold text-foreground">Contenido · {detail.itemsCount} unidad{detail.itemsCount === 1 ? '' : 'es'}</h3>
                  <div className="mt-3"><OrderProducts items={detail.items} /></div>
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
