// PROTOTYPE — diez variantes de la Bandeja en `/#/bandeja?variant=A…J`.
// Pregunta: ¿qué estructura le sirve al operador para preparar e imprimir?
// Descartable: el ganador se reescribe en BandejaLogistica.tsx.
import { useState, type ReactNode } from 'react';
import { CheckCircle2, ImageIcon, Loader2, PackageCheck, Printer } from 'lucide-react';
import { cn } from '../../lib/cn';
import {
  labelPrintTooltip,
  labelWasPrinted,
  logisticsNextStep,
  logisticsQuantityLabel,
  logisticsUrgency,
  productImageSrc,
  type LogisticsChannel,
  type LogisticsStage,
  type LogisticsUrgency,
} from '../../lib/logistics-inbox';
import type { InboxNotice } from '../../lib/inbox-notice';
import { Button } from '../../components/ui/button';
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
