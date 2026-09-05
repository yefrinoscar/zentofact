// PROTOTYPE — tablero A/B/C y filtro de etapa 1/2/3 en `/#/bandeja?variant=&filtro=`.
// Pregunta: ¿qué filtro de Pendientes / Listos le sirve al operador?
// Descartable: el ganador se reescribe en BandejaLogistica.tsx.
import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, CheckCircle2, Copy, ImageIcon, Loader2, PackageCheck, Printer, RefreshCw } from 'lucide-react';
import { copyText } from '../../lib/clipboard';
import { cn } from '../../lib/cn';
import { sellerShortName } from '../../lib/seller-name';
import falabellaLogo from '../../assets/falabella.png';
import mercadoLibreLogo from '../../assets/mercado-libre.png';
import ripleyLogo from '../../assets/logo-blanco.svg';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import {
  canPrintLogisticsLabel,
  labelPrintTooltip,
  labelWasPrinted,
  isActiveLogisticsDeadline,
  logisticsDeadlineLabel,
  logisticsElapsedLabel,
  logisticsNextStep,
  logisticsQuantityLabel,
  logisticsUpdatedClock,
  logisticsUrgency,
  logisticsUrgencyMeta,
  parseLogisticsDate,
  pendingDeadlineHelper,
  productImageSrc,
  readyPrintHelper,
  LOGISTICS_CHANNELS,
  LOGISTICS_URGENCIES,
  type LogisticsChannel,
  type LogisticsStage,
  type LogisticsUrgency,
} from '../../lib/logistics-inbox';
import type { InboxNotice } from '../../lib/inbox-notice';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';

export type LogisticsItem = {
  id: number;
  sku?: string | null;
  shopSku?: string | null;
  description: string;
  quantity: number;
  lineCount?: number;
  imageUrl?: string | null;
};

export type LogisticsOrder = {
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

export type BandejaView = {
  now: Date;
  stage: LogisticsStage;
  setStage: (stage: LogisticsStage) => void;
  channelCode: 'all' | LogisticsChannel;
  setChannelCode: (code: 'all' | LogisticsChannel) => void;
  urgency: LogisticsUrgency | null;
  setUrgency: (urgency: LogisticsUrgency | null) => void;
  searchInput: string;
  setSearchInput: (value: string) => void;
  orders: LogisticsOrder[];
  counts: { pending: number; ready: number; shipped: number; urgency: Record<LogisticsUrgency, number> };
  totalCount: number;
  loading: boolean;
  fetching: boolean;
  updatedAt: Date | null;
  notice: InboxNotice | null;
  canDispatch: boolean;
  canSync: boolean;
  refreshing: boolean;
  refresh: () => void;
  printing: boolean;
  busyOrderId: number | null;
  printOrders: (orders: LogisticsOrder[]) => void;
  requestReady: (order: LogisticsOrder) => void;
  requestBulkReady: (orders: LogisticsOrder[]) => void;
  labelSelection: Set<number> | null;
  setLabelSelection: (selection: Set<number> | null) => void;
  toggleLabel: (order: LogisticsOrder) => void;
  emptyCopy: string;
};

export const URGENCY_ORDER: LogisticsUrgency[] = ['overdue', 'today', 'tomorrow', 'later'];

export function groupByUrgency(orders: LogisticsOrder[], now: Date) {
  const groups = new Map<LogisticsUrgency, LogisticsOrder[]>();
  for (const key of URGENCY_ORDER) groups.set(key, []);
  for (const order of orders) groups.get(logisticsUrgency(order, now))!.push(order);
  return URGENCY_ORDER.map((key) => ({ key, orders: groups.get(key)! })).filter((group) => group.orders.length);
}

const LIMA = 'America/Lima';

export function limaDateKey(date: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: LIMA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function orderDeadlineKey(order: LogisticsOrder, now: Date) {
  const deadline = parseLogisticsDate(order.promisedShippingAt);
  if (!deadline) return 'no-date';
  const urgency = logisticsUrgency(order, now);
  if (urgency === 'overdue' || urgency === 'today' || urgency === 'tomorrow') return urgency;
  return limaDateKey(deadline);
}

export function deadlineColumnLabel(key: string, now: Date) {
  if (key === 'overdue') return 'Vencidos';
  if (key === 'today') return 'Vencen hoy';
  if (key === 'tomorrow') return 'Vencen mañana';
  if (key === 'no-date') return 'Sin fecha';
  const [year, month, day] = key.split('-').map(Number);
  if (!year || !month || !day) return key;
  const label = new Intl.DateTimeFormat('es-PE', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    ...(year === Number(limaDateKey(now).slice(0, 4)) ? {} : { year: 'numeric' as const }),
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
  return label.replace('septiembre', 'setiembre');
}

export function deadlineColumnTone(key: string): LogisticsUrgency {
  if (key === 'overdue' || key === 'today' || key === 'tomorrow') return key;
  return 'later';
}

export function buildDeadlineColumns(orders: LogisticsOrder[], now: Date) {
  const groups = new Map<string, LogisticsOrder[]>();
  for (const order of orders) {
    if (!isActiveLogisticsDeadline(order, now)) continue;
    const key = orderDeadlineKey(order, now);
    const list = groups.get(key) || [];
    list.push(order);
    groups.set(key, list);
  }
  const later = [...groups.keys()]
    .filter((key) => key !== 'today' && key !== 'tomorrow')
    .sort((left, right) => left.localeCompare(right));
  const keys = ['today', 'tomorrow', ...later].filter((key) => (groups.get(key) || []).length);
  return keys.map((key) => ({
    key,
    label: deadlineColumnLabel(key, now),
    tone: deadlineColumnTone(key),
    orders: groups.get(key) || [],
  }));
}

type ProductPreview = { src: string; name: string };

export function ProductThumb({
  item,
  className = 'size-12',
  onOpen,
}: {
  item: LogisticsItem;
  className?: string;
  onOpen?: (preview: ProductPreview) => void;
}) {
  const [failed, setFailed] = useState(false);
  const src = productImageSrc(item.imageUrl, item.shopSku || item.sku);
  const canOpen = Boolean(onOpen);
  const body = (
    <>
      <ImageIcon className="size-4 text-muted-foreground/40" />
      {src && !failed && (
        <img src={src} alt="" loading="lazy" className="absolute inset-0 size-full object-contain" onError={() => setFailed(true)} />
      )}
    </>
  );
  if (canOpen) {
    return (
      <button
        type="button"
        onClick={() => onOpen?.({ src: src && !failed ? src : '', name: item.description })}
        aria-label={`Ver foto de ${item.description}`}
        className={cn('relative grid shrink-0 place-items-center overflow-hidden bg-muted hover:ring-2 hover:ring-foreground/20', className)}
      >
        {body}
      </button>
    );
  }
  return (
    <span className={cn('relative grid shrink-0 place-items-center overflow-hidden bg-muted', className)}>
      {body}
    </span>
  );
}

export function ProductImageLightbox({
  preview,
  onClose,
}: {
  preview: ProductPreview | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={preview != null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        overlayClassName="z-[90] bg-black/70"
        className="z-[90] max-h-[94vh] gap-0 overflow-hidden bg-zinc-950 p-0 text-white sm:max-w-3xl [&_[data-slot=dialog-close]]:bg-white/10 [&_[data-slot=dialog-close]]:text-white [&_[data-slot=dialog-close]]:hover:bg-white/20"
      >
        {preview ? (
          <>
            <DialogHeader className="sr-only">
              <DialogTitle>Foto de {preview.name}</DialogTitle>
              <DialogDescription>Vista ampliada del producto.</DialogDescription>
            </DialogHeader>
            <figure className="min-h-0">
              <div className="flex min-h-64 items-center justify-center overflow-hidden p-4 sm:min-h-[28rem] sm:p-8">
                {preview.src ? (
                  <img src={preview.src} alt={preview.name} className="max-h-[calc(94vh-6rem)] max-w-full object-contain" />
                ) : (
                  <div className="grid place-items-center gap-3 text-white/50">
                    <ImageIcon className="size-16" />
                    <p className="text-sm">Este pedido no trae foto</p>
                  </div>
                )}
              </div>
              <figcaption className="border-t border-white/10 bg-black/30 px-5 py-3 pr-16">
                <p className="line-clamp-2 text-sm font-medium text-white">{preview.name}</p>
              </figcaption>
            </figure>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function CopyableOrderNumber({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={copied ? 'Número copiado' : 'Copiar número de pedido'}
      aria-label={`Copiar pedido ${value}`}
      onClick={async () => {
        const ok = await copyText(value);
        if (!ok) return;
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      }}
      className="inline-flex min-w-0 items-center gap-1 font-mono text-sm font-semibold hover:text-foreground"
    >
      <span className="truncate">{value}</span>
      {copied ? <Check className="size-3.5 shrink-0 text-emerald-600" /> : <Copy className="size-3.5 shrink-0 text-muted-foreground" />}
    </button>
  );
}

export function QuantityTag({ item }: { item: LogisticsItem }) {
  const many = item.quantity > 1;
  return (
    <span className={cn(
      'inline-flex shrink-0 items-center justify-center rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums',
      many ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground',
    )}>
      {logisticsQuantityLabel(item)}
    </span>
  );
}

export function ActionButton({
  order,
  view,
  size = 'sm',
  full = false,
}: {
  order: LogisticsOrder;
  view: BandejaView;
  size?: 'sm' | 'default';
  full?: boolean;
}) {
  const step = logisticsNextStep(order);
  const busy = view.busyOrderId === order.id && view.printing;
  const width = full ? 'w-full' : '';
  if (step.kind === 'print') {
    const printed = labelWasPrinted(order);
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size={size} variant={printed ? 'outline' : 'default'} className={cn(width, printed && 'text-emerald-700')} onClick={() => view.printOrders([order])} disabled={view.printing}>
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
      <Button
        size={size}
        variant="outline"
        className={cn(width, 'border-orange-200 bg-orange-50 text-orange-900 hover:bg-orange-100')}
        onClick={() => view.requestReady(order)}
        disabled={!view.canDispatch}
      >
        <PackageCheck />
        {view.canDispatch ? 'Marcar listo' : 'Solo lectura'}
      </Button>
    );
  }
  if (step.kind === 'wait') {
    return <span className={cn('text-xs text-muted-foreground', width)}>{step.label}</span>;
  }
  return null;
}

export function ChannelMark({ code, className }: { code?: string | null; className?: string }) {
  const value = String(code || '').trim().toLowerCase();
  if (value === 'falabella') {
    return <img src={falabellaLogo} alt="Falabella" title="Falabella" className={cn('size-5 shrink-0 rounded-sm object-contain', className)} />;
  }
  if (value === 'ripley') {
    return (
      <span className={cn('grid size-5 shrink-0 place-items-center overflow-hidden rounded-sm border border-zinc-700 bg-zinc-950', className)} title="Ripley" aria-label="Ripley">
        <img src={ripleyLogo} alt="" className="h-4 w-auto" />
      </span>
    );
  }
  if (value === 'mercado_libre') {
    return <img src={mercadoLibreLogo} alt="Mercado Libre" title="Mercado Libre" className={cn('size-6 shrink-0 overflow-hidden rounded-sm object-cover', className)} />;
  }
  return (
    <span className={cn('grid size-5 shrink-0 place-items-center rounded-sm bg-teal-100 text-[9px] font-bold text-teal-800', className)} title="Manual" aria-label="Manual">
      M
    </span>
  );
}

export function EmptyState({ view, children }: { view: BandejaView; children?: ReactNode }) {
  if (view.loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="size-5 animate-spin" /> Cargando pedidos…
      </div>
    );
  }
  if (!view.orders.length) {
    return <p className="py-16 text-center text-sm text-muted-foreground">{view.emptyCopy}</p>;
  }
  return <>{children}</>;
}

export function printableOrders(orders: LogisticsOrder[]) {
  return orders.filter(canPrintLogisticsLabel);
}

export const BANDEJA_STAGE_FILTERS = [
  { key: '1', name: 'Segmentos' },
  { key: '2', name: 'Línea + pulso' },
  { key: '3', name: 'Cola + datos' },
] as const;

export type BandejaStageFilter = '1' | '2' | '3';

export function useBandejaStageFilter(): BandejaStageFilter {
  const [params] = useSearchParams();
  const value = params.get('filtro');
  if (value === '2' || value === '3') return value;
  return '1';
}

type StageFilterModel = {
  pendingLabel: string;
  readyLabel: string;
  pendingHelper: string;
  readyHelper: string;
  clock: string;
};

function stageFilterModel(view: BandejaView, density: 'full' | 'compact'): StageFilterModel {
  const loadingPending = view.loading && view.stage === 'pending';
  const loadingReady = view.loading && view.stage === 'ready';
  return {
    pendingLabel: 'Pendientes',
    readyLabel: density === 'compact' ? 'Listos' : 'Listos para enviar',
    pendingHelper: loadingPending ? 'Cargando…' : view.stage === 'pending' ? pendingDeadlineHelper(view.orders, view.now) : 'Por preparar',
    readyHelper: loadingReady ? 'Cargando…' : view.stage === 'ready' ? readyPrintHelper(view.orders) : 'Listos para imprimir',
    clock: logisticsUpdatedClock(view.updatedAt),
  };
}

function StageTools({ view, tools }: { view: BandejaView; tools?: ReactNode }) {
  return (
    <div className="flex items-center gap-1">
      {tools}
      <Button size="icon-sm" variant="ghost" onClick={view.refresh} disabled={view.refreshing} aria-label={view.canSync ? 'Sincronizar' : 'Actualizar'}>
        <RefreshCw className={cn(view.refreshing && 'animate-spin')} />
      </Button>
    </div>
  );
}

function UpdatedClock({ view, clock }: { view: BandejaView; clock: string }) {
  if (!clock) return null;
  const elapsed = view.updatedAt ? logisticsElapsedLabel(view.updatedAt.toISOString(), view.now) : '';
  return (
    <span
      className="shrink-0 text-[11px] tabular-nums text-muted-foreground"
      title={elapsed ? `Actualizado ${elapsed}` : 'Última actualización'}
      aria-label={`Actualizado a las ${clock}`}
    >
      {clock}
    </span>
  );
}

function StageTabButton({
  stage,
  active,
  label,
  count,
  helper,
  tone,
  stacked = false,
  look = 'fill',
  onSelect,
}: {
  stage: LogisticsStage;
  active: boolean;
  label: string;
  count: number;
  helper?: string;
  tone: 'pending' | 'ready';
  stacked?: boolean;
  look?: 'fill' | 'line';
  onSelect: (stage: LogisticsStage) => void;
}) {
  const filled = look === 'fill';
  const activeClass = tone === 'pending'
    ? 'bg-amber-50 text-amber-950 shadow-sm'
    : 'bg-indigo-50 text-indigo-950 shadow-sm';
  const badgeClass = active
    ? (tone === 'pending' ? 'bg-amber-100 text-amber-800' : 'bg-indigo-100 text-indigo-800')
    : filled ? 'bg-background text-muted-foreground' : 'bg-muted text-muted-foreground';
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => onSelect(stage)}
      className={cn(
        'text-sm transition',
        stacked ? 'rounded-lg px-3 py-2 text-left' : 'inline-flex items-center gap-2',
        filled && !stacked && 'rounded-lg px-3 py-1.5',
        look === 'line' && '-mb-px border-b-2 pb-2',
        look === 'line' && (active ? 'border-foreground font-semibold text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'),
        filled && (active ? activeClass : 'text-muted-foreground hover:bg-background/70 hover:text-foreground'),
      )}
    >
      <span className={cn('flex items-center gap-2', stacked && 'justify-between')}>
        <span className="truncate font-medium">{label}</span>
        <span className={cn('rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums', badgeClass)}>{count}</span>
      </span>
      {stacked && helper && <span className="mt-0.5 block truncate text-xs opacity-80">{helper}</span>}
    </button>
  );
}

function StageFilterSegments({
  view,
  model,
  actions,
}: {
  view: BandejaView;
  model: StageFilterModel;
  actions: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div role="tablist" aria-label="Flujo de pedidos" className="grid min-w-[20rem] flex-1 grid-cols-2 gap-1 rounded-xl bg-muted p-1">
        <StageTabButton
          stage="pending"
          active={view.stage === 'pending'}
          label={model.pendingLabel}
          count={view.counts.pending}
          helper={model.pendingHelper}
          tone="pending"
          stacked
          onSelect={view.setStage}
        />
        <StageTabButton
          stage="ready"
          active={view.stage === 'ready'}
          label={model.readyLabel}
          count={view.counts.ready}
          helper={model.readyHelper}
          tone="ready"
          stacked
          onSelect={view.setStage}
        />
      </div>
      <div className="flex items-center gap-2">
        <UpdatedClock view={view} clock={model.clock} />
        {actions}
      </div>
    </div>
  );
}

function StageFilterLine({
  view,
  model,
  actions,
}: {
  view: BandejaView;
  model: StageFilterModel;
  actions: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Flujo de pedidos" className="flex flex-wrap items-center gap-5 border-b border-border">
          <StageTabButton
            stage="pending"
            active={view.stage === 'pending'}
            label={model.pendingLabel}
            count={view.counts.pending}
            tone="pending"
            look="line"
            onSelect={view.setStage}
          />
          <StageTabButton
            stage="ready"
            active={view.stage === 'ready'}
            label={model.readyLabel}
            count={view.counts.ready}
            tone="ready"
            look="line"
            onSelect={view.setStage}
          />
        </div>
        <div className="flex items-center gap-2">
          <UpdatedClock view={view} clock={model.clock} />
          {actions}
        </div>
      </div>
    </div>
  );
}

function StageFilterQueue({
  view,
  model,
  actions,
  density,
}: {
  view: BandejaView;
  model: StageFilterModel;
  actions: ReactNode;
  density: 'full' | 'compact';
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div role="tablist" aria-label="Flujo de pedidos" className="flex items-center gap-1 rounded-xl bg-muted p-1">
        <StageTabButton
          stage="pending"
          active={view.stage === 'pending'}
          label={model.pendingLabel}
          count={view.counts.pending}
          tone="pending"
          onSelect={view.setStage}
        />
        <StageTabButton
          stage="ready"
          active={view.stage === 'ready'}
          label={model.readyLabel}
          count={view.counts.ready}
          tone="ready"
          onSelect={view.setStage}
        />
      </div>
      {density === 'full' && (
        <div role="group" aria-label="Canal" className="flex items-center gap-0.5 text-xs">
          {LOGISTICS_CHANNELS.map((channel) => {
            const active = view.channelCode === channel.value;
            return (
              <button
                key={channel.value}
                type="button"
                onClick={() => view.setChannelCode(channel.value)}
                className={cn(
                  'rounded-md px-1.5 py-0.5',
                  active ? 'font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {channel.label}
              </button>
            );
          })}
        </div>
      )}
      {density === 'full' && (
        <Input
          value={view.searchInput}
          onChange={(event) => view.setSearchInput(event.target.value)}
          placeholder="Buscar pedido"
          aria-label="Buscar pedido"
          className="h-8 w-40"
        />
      )}
      <div className="ml-auto flex items-center gap-2">
        <UpdatedClock view={view} clock={model.clock} />
        {actions}
      </div>
    </div>
  );
}

export function StageTabs({
  view,
  tools,
  density = 'full',
}: {
  view: BandejaView;
  tools?: ReactNode;
  density?: 'full' | 'compact';
}) {
  const filtro = useBandejaStageFilter();
  const model = stageFilterModel(view, density);
  const actions = <StageTools view={view} tools={tools} />;
  if (filtro === '2') return <StageFilterLine view={view} model={model} actions={actions} />;
  if (filtro === '3') return <StageFilterQueue view={view} model={model} actions={actions} density={density} />;
  return <StageFilterSegments view={view} model={model} actions={actions} />;
}

export function UrgencyTabs({ view }: { view: BandejaView }) {
  if (view.stage === 'shipped') return null;
  return (
    <div role="tablist" aria-label="Plazo de entrega" className="flex flex-wrap gap-5 border-b border-border">
      {LOGISTICS_URGENCIES.filter((tab) => tab.value !== 'overdue').map((tab) => {
        const active = view.urgency === tab.value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => view.setUrgency(active ? null : tab.value)}
            className={cn(
              '-mb-px border-b-2 pb-2 text-sm',
              active ? 'border-foreground font-semibold text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label} {view.counts.urgency[tab.value]}
          </button>
        );
      })}
    </div>
  );
}

export function BoardCard({
  order,
  view,
  showRowAction,
}: {
  order: LogisticsOrder;
  view: BandejaView;
  showRowAction: boolean;
}) {
  const meta = logisticsUrgencyMeta(order.urgency);
  const [preview, setPreview] = useState<ProductPreview | null>(null);
  return (
    <li className="rounded-lg border border-white/80 bg-white p-2.5 shadow-sm">
      <div className="flex items-center gap-1.5">
        <ChannelMark code={order.channelCode} />
        <CopyableOrderNumber value={order.externalOrderNumber} />
      </div>
      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
        {sellerShortName(order.companyName)}
      </p>
      <ul className="mt-2 space-y-1.5">
        {order.items.slice(0, 2).map((item) => (
          <li key={item.id} className="flex items-center gap-2">
            <ProductThumb item={item} className="size-12 rounded" onOpen={setPreview} />
            <span className="min-w-0 flex-1 truncate text-xs">{item.description}</span>
            <QuantityTag item={item} />
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className={cn('text-[11px] font-medium', meta.textClass)}>{logisticsDeadlineLabel(order, view.now)}</span>
        {showRowAction && <ActionButton order={order} view={view} />}
      </div>
      <ProductImageLightbox preview={preview} onClose={() => setPreview(null)} />
    </li>
  );
}

export function PrintGroupButton({
  orders,
  view,
  label,
  emphasize = false,
}: {
  orders: LogisticsOrder[];
  view: BandejaView;
  label: string;
  emphasize?: boolean;
}) {
  const targets = printableOrders(orders);
  if (!targets.length || view.stage === 'shipped') return null;
  return (
    <Button
      size="sm"
      variant={emphasize ? 'default' : 'ghost'}
      onClick={() => view.printOrders(targets)}
      disabled={view.printing}
      aria-label={`Imprimir etiquetas de ${label}`}
    >
      {view.printing ? <Loader2 className="animate-spin" /> : <Printer />}
      Imprimir {targets.length}
    </Button>
  );
}

export function BoardOrder({ order }: { order: LogisticsOrder }) {
  const item = order.items[0];
  const extra = order.items.length > 1 ? ` +${order.items.length - 1}` : '';
  const [preview, setPreview] = useState<ProductPreview | null>(null);
  return (
    <li className="flex items-center gap-2 py-1.5">
      <ChannelMark code={order.channelCode} />
      <CopyableOrderNumber value={order.externalOrderNumber} />
      {item && <ProductThumb item={item} className="size-10 rounded" onOpen={setPreview} />}
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {item?.description || 'Sin productos'}
        {extra}
      </span>
      {item && <QuantityTag item={item} />}
      <span className="hidden w-20 truncate text-[11px] text-muted-foreground sm:block">{sellerShortName(order.companyName)}</span>
      <ProductImageLightbox preview={preview} onClose={() => setPreview(null)} />
    </li>
  );
}
