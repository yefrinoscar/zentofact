// PROTOTYPE — diez variantes de la Bandeja en `/#/bandeja?variant=A…J`.
// Pregunta: ¿qué estructura le sirve al operador para preparar e imprimir?
// Descartable: el ganador se reescribe en BandejaLogistica.tsx.
import { useState, type ReactNode } from 'react';
import { CheckCircle2, ImageIcon, Loader2, PackageCheck, Printer, RefreshCw } from 'lucide-react';
import { cn } from '../../lib/cn';
import { sellerShortName } from '../../lib/seller-name';
import falabellaLogo from '../../assets/falabella.png';
import ripleyLogo from '../../assets/logo-blanco.svg';
import {
  canPrintLogisticsLabel,
  labelPrintTooltip,
  labelWasPrinted,
  logisticsDeadlineLabel,
  logisticsDeliveryLabel,
  logisticsNextStep,
  logisticsQuantityLabel,
  logisticsUrgency,
  logisticsUrgencyMeta,
  productImageSrc,
  LOGISTICS_STAGES,
  LOGISTICS_URGENCIES,
  type LogisticsChannel,
  type LogisticsStage,
  type LogisticsUrgency,
} from '../../lib/logistics-inbox';
import type { InboxNotice } from '../../lib/inbox-notice';
import { Button } from '../../components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs';
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
  openOrder: (order: LogisticsOrder) => void;
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

export function ProductThumb({ item, className = 'size-10' }: { item: LogisticsItem; className?: string }) {
  const [failed, setFailed] = useState(false);
  const src = productImageSrc(item.imageUrl, item.shopSku || item.sku);
  return (
    <span className={cn('relative grid shrink-0 place-items-center overflow-hidden bg-muted', className)}>
      <ImageIcon className="size-3.5 text-muted-foreground/40" />
      {src && !failed && (
        <img src={src} alt="" loading="lazy" className="absolute inset-0 size-full object-contain" onError={() => setFailed(true)} />
      )}
    </span>
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
      <Button size={size} variant="outline" className={cn(width, 'border-orange-200 bg-orange-50 text-orange-900 hover:bg-orange-100')} onClick={() => (view.canDispatch ? view.requestReady(order) : view.openOrder(order))}>
        <PackageCheck />
        {view.canDispatch ? 'Marcar listo' : 'Solo lectura'}
      </Button>
    );
  }
  return (
    <Button size={size} variant="ghost" className={cn(width, 'text-muted-foreground')} onClick={() => view.openOrder(order)}>
      {step.kind === 'wait' ? step.label : 'Ver'}
    </Button>
  );
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

export function StageTabs({ view }: { view: BandejaView }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Tabs value={view.stage} onValueChange={(value) => view.setStage(value as LogisticsStage)}>
        <TabsList aria-label="Flujo de pedidos">
          {LOGISTICS_STAGES.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label} {view.counts[tab.value]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Button size="icon-sm" variant="ghost" onClick={view.refresh} disabled={view.refreshing} aria-label={view.canSync ? 'Sincronizar' : 'Actualizar'}>
        <RefreshCw className={cn(view.refreshing && 'animate-spin')} />
      </Button>
    </div>
  );
}

export function UrgencyTabs({ view }: { view: BandejaView }) {
  if (view.stage === 'shipped') return null;
  return (
    <div role="tablist" aria-label="Plazo de entrega" className="flex flex-wrap gap-5 border-b border-border">
      {LOGISTICS_URGENCIES.map((tab) => {
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
  return (
    <li className="rounded-lg border border-white/80 bg-white p-2.5 shadow-sm">
      <button type="button" onClick={() => view.openOrder(order)} className="flex w-full items-center gap-1.5 text-left">
        <ChannelMark code={order.channelCode} />
        <span className="truncate font-mono text-sm font-semibold">{order.externalOrderNumber}</span>
      </button>
      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
        {sellerShortName(order.companyName)} · {logisticsDeliveryLabel(order)}
      </p>
      <ul className="mt-2 space-y-1">
        {order.items.slice(0, 2).map((item) => (
          <li key={item.id} className="flex items-center gap-2">
            <ProductThumb item={item} className="size-8 rounded" />
            <span className="min-w-0 flex-1 truncate text-xs">{item.description}</span>
            <QuantityTag item={item} />
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className={cn('text-[11px] font-medium', meta.textClass)}>{logisticsDeadlineLabel(order, view.now)}</span>
        {showRowAction && <ActionButton order={order} view={view} />}
      </div>
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

export function BoardOrder({ order, view }: { order: LogisticsOrder; view: BandejaView }) {
  const item = order.items[0];
  const extra = order.items.length > 1 ? ` +${order.items.length - 1}` : '';
  return (
    <li>
      <button type="button" onClick={() => view.openOrder(order)} className="flex w-full items-center gap-2 py-1.5 text-left hover:bg-muted/40">
        <ChannelMark code={order.channelCode} />
        <span className="w-[6.5rem] shrink-0 truncate font-mono text-sm font-semibold">{order.externalOrderNumber}</span>
        {item && <ProductThumb item={item} className="size-7 rounded" />}
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {item?.description || 'Sin productos'}
          {extra}
        </span>
        {item && <QuantityTag item={item} />}
        <span className="hidden w-20 truncate text-[11px] text-muted-foreground sm:block">{sellerShortName(order.companyName)}</span>
      </button>
    </li>
  );
}
