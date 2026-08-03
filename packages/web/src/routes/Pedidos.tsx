import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock3,
  ImageIcon,
  Inbox,
  Loader2,
  Moon,
  PackageCheck,
  Printer,
  RefreshCw,
  Search,
  Store,
  SunMedium,
  Timer,
  Truck,
} from 'lucide-react';
import api from '../lib/api';
import { usePermissions } from '../hooks/usePermissions';
import { useAppStore } from '../stores/app';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../components/ui/tooltip';

type InboxOrder = {
  id: number;
  companyId: number;
  companyName: string;
  companyRuc: string;
  orderId: string;
  orderNumber: string;
  createdAt: string | null;
  updatedAt: string | null;
  firstSeenAt: string | null;
  promisedShippingAt: string | null;
  falabellaStatus: string;
  shippingType: string;
  invoiceRequired: boolean;
  total: number;
  currency: string;
  customerName: string;
  itemsCount: number | null;
  labelCount: number;
  labelPrints: Array<{
    labelIndex: number;
    printCount: number;
    firstPrintedAt: string | null;
    lastPrintedAt: string | null;
  }>;
  labelIndex?: number;
  sameOrderCount: number;
  sameOrderIndex: number;
};

type InboxResponse = {
  orders: InboxOrder[];
  totalCount: number;
  shippedCount: number;
  operationalCount: number;
  lastSyncedAt: string | null;
  deliveryMetrics?: {
    updatedAt: string;
    windows: DeliveryWindow[];
    days: DeliveryDay[];
  };
};

type InboxOrderProduct = {
  orderItemId: string;
  name: string;
  sellerSku: string;
  quantity: number;
  imageUrl: string;
  imageUrls: string[];
};

type OrderProductsState = {
  status: 'loading' | 'ready' | 'error';
  items: InboxOrderProduct[];
};

type DurationMetric = {
  measured: number;
  averageMinutes: number | null;
  minMinutes: number | null;
  maxMinutes: number | null;
};

type DeliveryWindow = {
  key: 'evening_to_noon' | 'noon_to_evening';
  from: string;
  to: string;
  state: 'active' | 'upcoming' | 'completed';
  deliveries: number;
  preparation: DurationMetric;
  handoff: DurationMetric;
  total: DurationMetric;
};

type DeliveryDay = {
  date: string;
  windows: Array<{
    key: DeliveryWindow['key'];
    deliveries: number;
    preparation: DurationMetric;
    handoff: DurationMetric;
    total: DurationMetric;
  }>;
};

type CompanyOption = { id: number; name: string };
type UrgencyKey = 'overdue' | 'today' | 'tomorrow' | 'later';
type StatusColumnKey = 'pending' | 'ready' | 'fulfillment';
type BoardColumnKey = UrgencyKey | StatusColumnKey;
type BoardView = 'deadline' | 'status';
type OrderFlowStage = 'pending' | 'ready' | 'shipped';
type BulkReadySelection = { columnKey: BoardColumnKey; columnTitle: string; orders: InboxOrder[] };
type BoardColumn = {
  key: BoardColumnKey;
  title: string;
  description: string;
  icon: typeof AlertCircle;
  iconClass: string;
  headerClass: string;
  countClass: string;
  empty: string;
};

const LIMA_TIME_ZONE = 'America/Lima';
const BOARD_LIMIT = 500;

const DEADLINE_COLUMNS: BoardColumn[] = [
  {
    key: 'today',
    title: 'Vencen hoy',
    description: 'Prioridad del día',
    icon: Clock3,
    iconClass: 'text-current',
    headerClass: 'border-amber-200 bg-amber-50 text-amber-950',
    countClass: 'bg-amber-100 text-amber-800',
    empty: 'Nada más vence hoy.',
  },
  {
    key: 'tomorrow',
    title: 'Vencen mañana',
    description: 'Prepara con anticipación',
    icon: CalendarClock,
    iconClass: 'text-current',
    headerClass: 'border-sky-200 bg-sky-50 text-sky-950',
    countClass: 'bg-sky-100 text-sky-800',
    empty: 'No hay entregas para mañana.',
  },
  {
    key: 'later',
    title: 'Próximos',
    description: 'Después de mañana',
    icon: Truck,
    iconClass: 'text-current',
    headerClass: 'border-slate-200 bg-slate-50 text-slate-950',
    countClass: 'bg-slate-100 text-slate-700',
    empty: 'No hay pedidos posteriores.',
  },
  {
    key: 'overdue',
    title: 'Vencidos',
    description: 'Requieren atención',
    icon: AlertCircle,
    iconClass: 'text-current',
    headerClass: 'border-rose-200 bg-rose-50 text-rose-950',
    countClass: 'bg-rose-100 text-rose-800',
    empty: 'No tienes pedidos vencidos.',
  },
];

const STATUS_COLUMNS: BoardColumn[] = [
  {
    key: 'pending',
    title: 'Pendiente',
    description: 'Aún no están listos',
    icon: Inbox,
    iconClass: 'text-current',
    headerClass: 'border-amber-200 bg-amber-50 text-amber-950',
    countClass: 'bg-amber-100 text-amber-800',
    empty: 'No hay pedidos pendientes.',
  },
  {
    key: 'ready',
    title: 'Listos para enviar',
    description: 'Etiqueta disponible',
    icon: PackageCheck,
    iconClass: 'text-current',
    headerClass: 'border-sky-200 bg-sky-50 text-sky-950',
    countClass: 'bg-sky-100 text-sky-800',
    empty: 'No hay pedidos listos para enviar.',
  },
  {
    key: 'fulfillment',
    title: 'Gestión Falabella',
    description: 'Despacho administrado',
    icon: Truck,
    iconClass: 'text-current',
    headerClass: 'border-violet-200 bg-violet-50 text-violet-950',
    countClass: 'bg-violet-100 text-violet-800',
    empty: 'No hay pedidos Fulfillment.',
  },
];

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function limaDateKey(date: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: LIMA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function tomorrowKey(now: Date) {
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return limaDateKey(tomorrow);
}

function formatDateTime(value: string | null | undefined) {
  const date = parseDate(value);
  if (!date) return 'Sin fecha informada';
  return new Intl.DateTimeFormat('es-PE', {
    timeZone: LIMA_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatTime(value: string | null | undefined) {
  const date = parseDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('es-PE', {
    timeZone: LIMA_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function labelPrintFor(order: InboxOrder) {
  const labelIndex = order.labelIndex || 1;
  return (order.labelPrints || []).find((print) => print.labelIndex === labelIndex) || null;
}

function labelWasPrinted(order: InboxOrder) {
  return Number(labelPrintFor(order)?.printCount || 0) > 0;
}

function labelPrintTooltip(order: InboxOrder) {
  if (!labelWasPrinted(order)) return 'Esta etiqueta todavía no ha sido impresa.';
  const print = labelPrintFor(order);
  const count = Number(print?.printCount || 0);
  const when = print?.lastPrintedAt ? ` el ${formatDateTime(print.lastPrintedAt)}` : '';
  return `Etiqueta impresa${when}. ${count === 1 ? 'Se imprimió 1 vez.' : `Se imprimió ${count} veces.`}`;
}

function OrderProductImage({ product }: { product: InboxOrderProduct }) {
  const candidates = [...new Set([product.imageUrl, ...(product.imageUrls || [])].filter(Boolean))];
  const [imageIndex, setImageIndex] = useState(0);
  const [viewerImageIndex, setViewerImageIndex] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const imageUrl = candidates[imageIndex] || '';
  const viewerImageUrl = candidates[viewerImageIndex] || '';
  return (
    <>
      <button
        type="button"
        className="relative grid size-14 shrink-0 cursor-zoom-in place-items-center overflow-hidden rounded-lg border border-border bg-white transition hover:border-primary/50 hover:ring-2 hover:ring-primary/10"
        onClick={() => { setViewerImageIndex(0); setViewerOpen(true); }}
        aria-label={`Ampliar imagen de ${product.name || product.sellerSku || 'producto'}`}
      >
        <ImageIcon className="size-5 text-muted-foreground/40" />
        {imageUrl && (
          <img
            src={imageUrl}
            alt=""
            className="absolute inset-0 size-full object-contain p-0.5"
            loading="lazy"
            onError={() => setImageIndex((current) => current + 1)}
          />
        )}
      </button>
      <Dialog open={viewerOpen} onOpenChange={setViewerOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{product.name || product.sellerSku || 'Producto'}</DialogTitle>
            <DialogDescription>{product.quantity > 1 ? `${product.quantity} unidades` : '1 unidad'}</DialogDescription>
          </DialogHeader>
          <div className="grid min-h-80 place-items-center overflow-hidden rounded-lg border border-border bg-white p-4">
            {viewerImageUrl ? (
              <img
                src={viewerImageUrl}
                alt={product.name || 'Producto'}
                className="max-h-[70vh] max-w-full object-contain"
                onError={() => setViewerImageIndex((current) => current + 1)}
              />
            ) : (
              <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
                <ImageIcon className="size-12 opacity-30" />
                Imagen no disponible
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function OrderProducts({ state }: { state?: OrderProductsState }) {
  if (!state || state.status === 'loading') {
    return <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Cargando…</span>;
  }
  if (state.status === 'error') return <span className="text-xs text-muted-foreground">No se pudieron cargar</span>;
  if (!state.items.length) return <span className="text-xs text-muted-foreground">Sin productos informados</span>;
  return (
    <div className="space-y-2">
      {state.items.map((product, index) => (
        <div key={product.orderItemId || `${product.sellerSku}:${index}`} className="flex min-w-0 items-center gap-3">
          <OrderProductImage product={product} />
          <div className="min-w-0">
            <p className="max-w-48 truncate text-xs font-medium text-foreground">
              {product.name || product.sellerSku || 'Producto sin nombre'}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {product.quantity > 1 ? `${product.quantity} unidades` : '1 unidad'}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function formatMoney(value: number, currency = 'PEN') {
  try {
    return new Intl.NumberFormat('es-PE', { style: 'currency', currency }).format(value || 0);
  } catch {
    return new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(value || 0);
  }
}

function formatDuration(minutes: number | null) {
  if (minutes == null || !Number.isFinite(minutes)) return '—';
  const rounded = Math.max(0, Math.round(minutes));
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const remaining = rounded % 60;
  return remaining ? `${hours} h ${remaining} min` : `${hours} h`;
}

function formatShiftBoundary(value: string) {
  const date = parseDate(value);
  if (!date) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-PE', {
    timeZone: LIMA_TIME_ZONE,
    weekday: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function shiftStateMeta(state: DeliveryWindow['state']) {
  if (state === 'active') return { label: 'En curso', className: 'text-emerald-700' };
  if (state === 'completed') return { label: 'Cerrado', className: 'text-muted-foreground' };
  return { label: 'Próximo', className: 'text-sky-700' };
}

function DeliveryShiftCard({ window }: { window: DeliveryWindow }) {
  const isEvening = window.key === 'evening_to_noon';
  const Icon = isEvening ? Moon : SunMedium;
  const state = shiftStateMeta(window.state);
  const stages = [
    { label: 'Preparación', detail: 'Pendiente → listo', metric: window.preparation },
    { label: 'En espera', detail: 'Listo → enviado', metric: window.handoff },
  ];
  const totalMeasured = window.total.measured > 0;
  const hasStageMetrics = stages.some(({ metric }) => metric.measured > 0);
  return (
    <article>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-2.5">
          <Icon className={`mt-0.5 size-3.5 shrink-0 ${isEvening ? 'text-indigo-600' : 'text-amber-600'}`} />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">
              {isEvening ? 'Turno 5 p. m. → 12 m.' : 'Turno 12 m. → 5 p. m.'}
            </h3>
            <p className="mt-1 text-xs capitalize text-muted-foreground">
              {formatShiftBoundary(window.from)} → {formatShiftBoundary(window.to)}
            </p>
          </div>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-medium ${state.className}`}>
          <span className="size-1.5 rounded-full bg-current" />
          {state.label}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Entregas</p>
          <div className="mt-1 flex items-baseline gap-2">
            <strong className="text-3xl font-semibold tracking-tight tabular-nums text-foreground">{window.deliveries}</strong>
            <span className="text-xs text-muted-foreground">a Falabella</span>
          </div>
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground">Ciclo promedio</p>
          <p className={`${totalMeasured ? 'text-xl' : 'text-sm'} mt-1 font-semibold tracking-tight tabular-nums text-foreground`}>
            {totalMeasured ? formatDuration(window.total.averageMinutes) : window.state === 'upcoming' ? 'Aún no inicia' : 'Sin datos'}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {totalMeasured
              ? `${window.total.measured} ciclo${window.total.measured === 1 ? '' : 's'} · ${formatDuration(window.total.minMinutes)}–${formatDuration(window.total.maxMinutes)}`
              : window.state === 'upcoming' ? 'Pendiente → enviado' : 'No hay ciclos completos registrados.'}
          </p>
        </div>
      </div>

      {hasStageMetrics && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">Ver desglose del ciclo</summary>
          <dl className="mt-3 space-y-3">
            {stages.map(({ label, detail, metric }) => (
              <div key={label} className="flex items-start justify-between gap-5">
                <dt>
                  <p className="font-medium text-foreground">{label}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{detail}</p>
                </dt>
                <dd className="text-right">
                  <p className="font-semibold tabular-nums text-foreground">
                    {metric.measured > 0 ? formatDuration(metric.averageMinutes) : 'No registrado'}
                  </p>
                  {metric.measured > 0 && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {metric.measured} caso{metric.measured === 1 ? '' : 's'} · {formatDuration(metric.minMinutes)}–{formatDuration(metric.maxMinutes)}
                    </p>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </article>
  );
}

function formatDeliveryDay(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat('es-PE', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function DeliveryDayHistory({ days, currentDate }: { days: DeliveryDay[]; currentDate: string }) {
  if (!days.length) {
    return (
      <section className="rounded-xl border border-border bg-card p-4" aria-labelledby="delivery-history-title">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-4 text-primary" />
          <h2 id="delivery-history-title" className="text-sm font-semibold text-foreground">Ciclos de esta semana</h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">El historial aparecerá cuando se registre la primera entrega.</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-card p-3" aria-labelledby="delivery-history-title">
      <div className="flex items-center gap-2">
        <CalendarClock className="size-4 text-primary" />
        <h2 id="delivery-history-title" className="text-sm font-semibold text-foreground">Ciclos de esta semana</h2>
      </div>

      <div className="mt-3 flex snap-x gap-2 overflow-x-auto pb-1">
        {days.map((day) => {
          const current = day.date === currentDate;
          return (
            <article key={day.date} className={`min-w-[230px] flex-1 snap-start rounded-lg border p-3 ${current ? 'border-primary/30 bg-primary/5' : 'border-border bg-background'}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium capitalize text-foreground">{formatDeliveryDay(day.date)}</p>
                {current && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">Actual</span>}
              </div>
              <div className="mt-2 divide-y divide-border/70">
                {(day.windows || []).map((window) => {
                  const evening = window.key === 'evening_to_noon';
                  return (
                    <div key={window.key} className="py-2 first:pt-1 last:pb-0">
                      <div className="flex items-center justify-between gap-3">
                        <span className={`text-xs font-medium ${evening ? 'text-indigo-700' : 'text-amber-700'}`}>
                          {evening ? '5 p. m. → 12 m.' : '12 m. → 5 p. m.'}
                        </span>
                        <strong className="text-sm tabular-nums text-foreground">
                          {window.deliveries} entrega{window.deliveries === 1 ? '' : 's'}
                        </strong>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Ciclo {window.total.measured ? formatDuration(window.total.averageMinutes) : 'sin datos'}
                      </p>
                    </div>
                  );
                })}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function elapsedLabel(value: string | null | undefined, now: Date) {
  const date = parseDate(value);
  if (!date) return '';
  const minutes = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60_000));
  if (minutes < 60) return `hace ${Math.max(1, minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} día${days === 1 ? '' : 's'}`;
}

function overdueLabel(value: string | null | undefined, now: Date) {
  const deadline = parseDate(value);
  if (!deadline) return 'Sin plazo informado';
  const minutes = Math.max(1, Math.floor((now.getTime() - deadline.getTime()) / 60_000));
  if (minutes < 60) return `Venció hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Venció hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `Venció hace ${days} día${days === 1 ? '' : 's'}`;
}

function urgencyFor(order: InboxOrder, now: Date): UrgencyKey {
  const deadline = parseDate(order.promisedShippingAt);
  if (!deadline) return 'later';
  if (deadline.getTime() < now.getTime()) return 'overdue';
  const deadlineDay = limaDateKey(deadline);
  if (deadlineDay === limaDateKey(now)) return 'today';
  if (deadlineDay === tomorrowKey(now)) return 'tomorrow';
  return 'later';
}

function isDueToday(order: InboxOrder, now: Date) {
  const deadline = parseDate(order.promisedShippingAt);
  return Boolean(deadline && limaDateKey(deadline) === limaDateKey(now));
}

function pendingDeadlineKey(order: InboxOrder, now: Date) {
  const deadline = parseDate(order.promisedShippingAt);
  if (!deadline) return 'no-date';
  return isDueToday(order, now) ? 'today' : limaDateKey(deadline);
}

function pendingDeadlineTabLabel(key: string, now: Date) {
  if (key === 'today') return 'Vencen hoy';
  if (key === 'all') return 'Todos';
  if (key === 'no-date') return 'Sin fecha';
  if (key === tomorrowKey(now)) return 'Vencen mañana';
  const [year, month, day] = key.split('-').map(Number);
  if (!year || !month || !day) return key;
  return new Intl.DateTimeFormat('es-PE', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    ...(year === Number(limaDateKey(now).slice(0, 4)) ? {} : { year: 'numeric' as const }),
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function deadlineLabel(order: InboxOrder, now: Date) {
  const urgency = urgencyFor(order, now);
  if (!order.promisedShippingAt) return 'Sin plazo informado';
  if (urgency === 'overdue') return overdueLabel(order.promisedShippingAt, now);
  if (urgency === 'today') return `Hoy · ${formatTime(order.promisedShippingAt)}`;
  if (urgency === 'tomorrow') return `Mañana · ${formatTime(order.promisedShippingAt)}`;
  return formatDateTime(order.promisedShippingAt);
}

function statusMeta(status: string) {
  const key = status.toLowerCase();
  if (key.includes('shipped')) {
    return {
      label: 'Enviado',
      className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      textClass: 'text-emerald-700',
    };
  }
  if (key.includes('ready_to_ship')) {
    return {
      label: 'Listo para enviar',
      className: 'border-sky-200 bg-sky-50 text-sky-700',
      textClass: 'text-sky-700',
    };
  }
  if (key.includes('pending')) {
    return {
      label: 'Pendiente',
      className: 'border-amber-200 bg-amber-50 text-amber-700',
      textClass: 'text-amber-700',
    };
  }
  return {
    label: 'Estado Falabella',
    className: 'border-border bg-muted text-muted-foreground',
    textClass: 'text-muted-foreground',
  };
}

function canPrintShippingLabel(order: InboxOrder) {
  const status = order.falabellaStatus.toLowerCase();
  return /(^|\|)ready_to_ship(\||$)/.test(status)
    && !/(^|\|)(pending|shipped)(\||$)/.test(status);
}

function isShippedOrder(order: InboxOrder) {
  return /(^|\|)shipped(\||$)/.test(order.falabellaStatus.toLowerCase());
}

function hasCompletedPreparation(order: InboxOrder) {
  return canPrintShippingLabel(order) || isShippedOrder(order);
}

function isFulfillmentOrder(order: InboxOrder) {
  return order.shippingType.toLowerCase().includes('fulfillment');
}

function statusColumnFor(order: InboxOrder): StatusColumnKey {
  if (isFulfillmentOrder(order)) return 'fulfillment';
  if (/(^|\|)ready_to_ship(\||$)/.test(order.falabellaStatus.toLowerCase())) return 'ready';
  return 'pending';
}

function canMarkReadyToShip(order: InboxOrder) {
  return !isFulfillmentOrder(order) && !hasCompletedPreparation(order);
}

function orderKey(order: InboxOrder) {
  return `${order.companyId}:${order.orderId}`;
}

function labelKey(order: InboxOrder) {
  return `${orderKey(order)}:${order.labelIndex || 1}`;
}

function labelCountFor(order: InboxOrder) {
  return Math.max(1, Number(order.labelCount) || 1);
}

function countLabels(orders: InboxOrder[]) {
  return orders.reduce((total, order) => total + labelCountFor(order), 0);
}

function expandOrdersAsLabels(orders: InboxOrder[]) {
  return orders.flatMap((order) => {
    const labelCount = labelCountFor(order);
    return Array.from({ length: labelCount }, (_, index) => ({
      ...order,
      labelIndex: index + 1,
      sameOrderCount: labelCount,
      sameOrderIndex: index + 1,
    }));
  });
}

function base64Blob(base64: string, mimeType: string) {
  const binary = window.atob(base64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
}

function renderShippingLabelsLoading(previewWindow: Window, labelCount: number) {
  const pageCount = Math.ceil(labelCount / 4);
  previewWindow.document.open();
  previewWindow.document.write(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Preparando etiquetas Falabella</title>
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f5f5f4; color: #1c1917; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { width: min(92vw, 460px); padding: 40px; border: 1px solid #e7e5e4; border-radius: 20px; background: #fff; box-shadow: 0 24px 60px rgba(28, 25, 23, .10); text-align: center; }
      .loader { width: 54px; height: 54px; margin: 0 auto 24px; border: 5px solid #e7e5e4; border-top-color: #292524; border-radius: 50%; animation: spin .8s linear infinite; }
      h1 { margin: 0; font-size: 24px; line-height: 1.2; letter-spacing: -.02em; }
      p { margin: 12px auto 0; max-width: 340px; color: #78716c; font-size: 14px; line-height: 1.55; }
      .summary { display: flex; justify-content: center; gap: 8px; margin-top: 24px; }
      .summary span { padding: 7px 11px; border-radius: 999px; background: #f5f5f4; color: #57534e; font-size: 12px; font-weight: 650; }
      .note { margin-top: 24px; padding-top: 20px; border-top: 1px solid #f0eeec; font-size: 12px; color: #a8a29e; }
      @keyframes spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) { .loader { animation-duration: 1.8s; } }
    </style>
  </head>
  <body>
    <main>
      <div class="loader" aria-hidden="true"></div>
      <h1>Armando tu PDF A4</h1>
      <p>Estamos obteniendo las etiquetas de Falabella y distribuyéndolas para que ocupen correctamente cada espacio.</p>
      <div class="summary">
        <span>${labelCount} etiqueta${labelCount === 1 ? '' : 's'}</span>
        <span>${pageCount} hoja${pageCount === 1 ? '' : 's'} A4</span>
        <span>Inventario al final</span>
      </div>
      <div class="note">Se abrirá el visor PDF completo para que puedas revisar todas las páginas y luego imprimir.</div>
    </main>
  </body>
</html>`);
  previewWindow.document.close();
}

function openShippingLabelsPdf(previewWindow: Window, pdfUrl: string) {
  previewWindow.location.replace(pdfUrl);
}

function OrderCard({ order, now, onOpen, onViewLabel, onToggleLabel, labelLoading, labelSelectionMode, labelSelected, canDispatch }: {
  order: InboxOrder;
  now: Date;
  onOpen: () => void;
  onViewLabel: () => void;
  onToggleLabel: () => void;
  labelLoading: boolean;
  labelSelectionMode: boolean;
  labelSelected: boolean;
  canDispatch: boolean;
}) {
  const urgency = urgencyFor(order, now);
  const fulfillment = isFulfillmentOrder(order);
  const status = fulfillment
    ? { label: 'Gestión Falabella', textClass: 'text-violet-700' }
    : statusMeta(order.falabellaStatus);
  const deadlineTone = 'text-foreground';

  return (
    <article className={`px-3 py-3 transition-colors ${labelSelected ? 'bg-primary/5' : 'hover:bg-muted/30'}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {labelSelectionMode && canPrintShippingLabel(order) && (
            <Checkbox
              checked={labelSelected}
              onCheckedChange={onToggleLabel}
              aria-label={`Seleccionar etiqueta del pedido ${order.orderNumber}`}
            />
          )}
          <p className={`flex min-w-0 items-center gap-1.5 text-xs font-semibold ${deadlineTone}`}>
            {urgency === 'overdue' && <AlertCircle className="size-3.5 shrink-0" />}
            <span className="truncate">{deadlineLabel(order, now)}</span>
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-muted-foreground" title={`Estado en Falabella: ${order.falabellaStatus || 'no informado'}`}>
          <span className="size-1.5 rounded-full bg-current" />
          {status.label}
        </span>
      </div>

      <div className="mt-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button type="button" onClick={onOpen} className="font-mono text-sm font-semibold text-foreground hover:underline">
            {order.orderNumber}
          </button>
          {labelCountFor(order) > 1 && (
            <Badge variant="outline" className="mt-1 w-fit rounded-md border-sky-200 bg-sky-50 text-[10px] font-medium text-sky-800">
              Mismo pedido · {labelCountFor(order)} etiquetas
            </Badge>
          )}
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{order.companyName}</p>
        </div>
        <p className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{formatMoney(order.total, order.currency)}</p>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
        <span title={formatDateTime(order.createdAt)}>{elapsedLabel(order.createdAt, now) || 'Sin fecha de ingreso'}</span>
        <span aria-hidden="true">·</span>
        <span>{order.itemsCount == null ? 'Contenido no informado' : `${order.itemsCount} producto${order.itemsCount === 1 ? '' : 's'}`}</span>
        <span aria-hidden="true">·</span>
        <span>{order.invoiceRequired ? 'Factura' : 'Boleta'}</span>
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-3">
        <button type="button" onClick={onOpen} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
          Ver detalles <ArrowRight className="size-3" />
        </button>
        <div className="flex flex-col items-end gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={`h-7 px-2.5 text-xs ${labelWasPrinted(order) ? 'opacity-60 hover:opacity-85' : ''}`}
                onClick={canPrintShippingLabel(order) ? onViewLabel : onOpen}
                disabled={labelLoading || (!canPrintShippingLabel(order) && !canDispatch)}
              >
                {labelLoading ? <Loader2 className="animate-spin" /> : canPrintShippingLabel(order) ? <Printer /> : <PackageCheck />}
                {canPrintShippingLabel(order)
                  ? labelWasPrinted(order) ? 'Reimprimir' : 'Imprimir'
                  : !canDispatch ? 'Solo lectura' : fulfillment ? 'Ver flujo' : 'Listo para envío'}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {canPrintShippingLabel(order)
                ? labelPrintTooltip(order)
                : !canDispatch ? 'Tu perfil es de solo lectura' : fulfillment ? 'Revisar el flujo gestionado por Falabella' : 'Marcar pedido listo para envío'}
            </TooltipContent>
          </Tooltip>
          {labelWasPrinted(order) && (
            <span className="text-[10px] font-medium text-emerald-700">Impresa</span>
          )}
        </div>
      </div>
    </article>
  );
}

export default function Pedidos() {
  const navigate = useNavigate();
  const { role, loading: permissionsLoading } = usePermissions();
  const canDispatch = !permissionsLoading && role !== 'viewer';
  const setActiveCompanyId = useAppStore((state) => state.setActiveCompanyId);
  const [data, setData] = useState<InboxResponse | null>(null);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [companyId, setCompanyId] = useState('all');
  const [boardView, setBoardView] = useState<BoardView>('deadline');
  const [flowStage, setFlowStage] = useState<OrderFlowStage>('pending');
  const [pendingDeadlineTab, setPendingDeadlineTab] = useState('today');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [syncMessage, setSyncMessage] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<InboxOrder | null>(null);
  const [orderProducts, setOrderProducts] = useState<Record<string, OrderProductsState>>({});
  const [labelSelectionMode, setLabelSelectionMode] = useState(false);
  const [selectedLabelKeys, setSelectedLabelKeys] = useState<Set<string>>(() => new Set());
  const [batchLabelsLoading, setBatchLabelsLoading] = useState(false);
  const [printingLabelKey, setPrintingLabelKey] = useState('');
  const [printingColumn, setPrintingColumn] = useState<BoardColumnKey | null>(null);
  const [bulkReadySelection, setBulkReadySelection] = useState<BulkReadySelection | null>(null);
  const [bulkReadyRunning, setBulkReadyRunning] = useState(false);
  const [readyLoadingKey, setReadyLoadingKey] = useState('');
  const [confirmReady, setConfirmReady] = useState(false);
  const [orderActionError, setOrderActionError] = useState('');
  const [orderActionErrorKey, setOrderActionErrorKey] = useState('');
  const [orderActionMessage, setOrderActionMessage] = useState('');
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.getOrdersInboxCompanies()
      .then((rows: CompanyOption[]) => {
        if (!cancelled) setCompanies(Array.isArray(rows) ? rows : []);
      })
      .catch((nextError: any) => {
        if (!cancelled) setError(nextError?.message || 'No se pudieron cargar las tiendas Falabella.');
      });
    return () => { cancelled = true; };
  }, []);

  const load = async (quiet = false, silent = false) => {
    if (!silent && quiet) setRefreshing(true);
    else if (!silent) setLoading(true);
    setError('');
    try {
      const response = await api.getOrdersInbox({
        companyId: companyId === 'all' ? undefined : Number(companyId),
        view: 'actionable',
        search: search || undefined,
        limit: BOARD_LIMIT,
        offset: 0,
      }) as InboxResponse;
      setData(response);
    } catch (nextError: any) {
      setError(nextError?.message || 'No se pudieron cargar los pedidos pendientes.');
    } finally {
      if (!silent) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  useEffect(() => {
    void load();
    // La carga depende únicamente de los filtros visibles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, search]);

  useEffect(() => {
    const timer = window.setInterval(() => void load(false, true), 15 * 60_000);
    return () => window.clearInterval(timer);
    // Mantiene métricas y estados alineados con la reconciliación del servidor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, search]);

  useEffect(() => {
    setLabelSelectionMode(false);
    setSelectedLabelKeys(new Set());
  }, [companyId, search]);

  const syncAll = async () => {
    setRefreshing(true);
    setError('');
    setSyncMessage('');
    try {
      const result = await api.syncOrdersInbox();
      const failed = Number(result?.failed || 0);
      setSyncMessage(failed
        ? `${result.successful} tiendas actualizadas; ${failed} no pudieron sincronizarse.`
        : 'Pedidos actualizados con Falabella.');
      await load(true);
    } catch (nextError: any) {
      setError(nextError?.message || 'No se pudieron sincronizar las tiendas.');
    } finally {
      setRefreshing(false);
    }
  };

  const openOrders = useMemo(
    () => (data?.orders || []).filter((order) => !isShippedOrder(order)),
    [data?.orders],
  );

  const flowGroups = useMemo(() => {
    const groups: Record<OrderFlowStage, InboxOrder[]> = { pending: [], ready: [], shipped: [] };
    for (const order of data?.orders || []) {
      if (isShippedOrder(order)) groups.shipped.push(order);
      else if (canPrintShippingLabel(order)) groups.ready.push(order);
      else groups.pending.push(order);
    }
    const priority: Record<UrgencyKey, number> = { overdue: 0, today: 1, tomorrow: 2, later: 3 };
    for (const [key, orders] of Object.entries(groups) as Array<[OrderFlowStage, InboxOrder[]]>) {
      orders.sort((a, b) => {
        if (key === 'shipped') return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
        const urgencyDifference = priority[urgencyFor(a, now)] - priority[urgencyFor(b, now)];
        if (urgencyDifference) return urgencyDifference;
        const deadlineA = parseDate(a.promisedShippingAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const deadlineB = parseDate(b.promisedShippingAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        return deadlineA - deadlineB || String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
      });
    }
    return groups;
  }, [data?.orders, now]);
  const flowOrders = flowGroups[flowStage];
  const pendingDeadlineGroups = useMemo(() => {
    const groups: Record<string, InboxOrder[]> = { today: [] };
    for (const order of flowGroups.pending) {
      const key = pendingDeadlineKey(order, now);
      (groups[key] ||= []).push(order);
    }
    return groups;
  }, [flowGroups.pending, now]);
  const pendingDeadlineTabs = useMemo(() => {
    const todayKey = limaDateKey(now);
    const datedKeys = Object.keys(pendingDeadlineGroups)
      .filter((key) => key !== 'today' && key !== 'no-date')
      .sort((left, right) => {
        const leftIsPast = left < todayKey;
        const rightIsPast = right < todayKey;
        if (leftIsPast !== rightIsPast) return leftIsPast ? 1 : -1;
        return leftIsPast ? right.localeCompare(left) : left.localeCompare(right);
      });
    const keys = ['today', ...datedKeys];
    if (pendingDeadlineGroups['no-date']?.length) keys.push('no-date');
    return [{
      value: 'all',
      label: 'Todos',
      orders: flowGroups.pending,
    }, ...keys.map((key) => ({
      value: key,
      label: pendingDeadlineTabLabel(key, now),
      orders: pendingDeadlineGroups[key] || [],
    }))];
  }, [flowGroups.pending, pendingDeadlineGroups, now]);
  const displayedFlowOrders = flowStage === 'pending'
    ? pendingDeadlineTab === 'all'
      ? flowGroups.pending
      : pendingDeadlineGroups[pendingDeadlineTab] || []
    : flowOrders;
  const globalDeadlineCounts = openOrders.reduce<Record<UrgencyKey, number>>((counts, order) => {
    counts[urgencyFor(order, now)] += labelCountFor(order);
    return counts;
  }, { overdue: 0, today: 0, tomorrow: 0, later: 0 });
  const flowTabs = [
    { value: 'pending' as const, label: 'Pendientes', description: 'Por preparar', activeClass: 'bg-amber-50 text-amber-900 shadow-sm', badgeClass: 'bg-amber-100 text-amber-800' },
    { value: 'ready' as const, label: 'Listos para enviar', description: 'Etiqueta disponible', activeClass: 'bg-sky-50 text-sky-900 shadow-sm', badgeClass: 'bg-sky-100 text-sky-800' },
    { value: 'shipped' as const, label: 'Enviados', description: 'Flujo completado', activeClass: 'bg-emerald-50 text-emerald-900 shadow-sm', badgeClass: 'bg-emerald-100 text-emerald-800' },
  ];
  const activeFlow = flowTabs.find((tab) => tab.value === flowStage) || flowTabs[0];
  const filteredFlowOrders = useMemo(() => expandOrdersAsLabels(displayedFlowOrders), [displayedFlowOrders]);
  const filteredCountLabel = `${filteredFlowOrders.length} etiqueta${filteredFlowOrders.length === 1 ? '' : 's'}`;
  const visiblePendingCandidates = displayedFlowOrders.filter(canMarkReadyToShip);

  useEffect(() => {
    const uniqueOrders = [...new Map(displayedFlowOrders.map((order) => [orderKey(order), order])).values()];
    const pendingOrders = uniqueOrders.filter((order) => !orderProducts[orderKey(order)]);
    if (!pendingOrders.length) return;

    setOrderProducts((current) => {
      const next = { ...current };
      for (const order of pendingOrders) next[orderKey(order)] = { status: 'loading', items: [] };
      return next;
    });

    void (async () => {
      for (let index = 0; index < pendingOrders.length; index += 4) {
        const chunk = pendingOrders.slice(index, index + 4);
        const results = await Promise.all(chunk.map(async (order) => {
          const key = orderKey(order);
          try {
            const response = await api.falabellaApiGetOrderItems(order.companyId, order.orderId);
            if (response?.error || response?.ok === false) throw new Error('Falabella no devolvió los productos.');
            const items = (Array.isArray(response?.items) ? response.items : []).map((item: any) => ({
              orderItemId: String(item?.orderItemId || ''),
              name: String(item?.name || ''),
              sellerSku: String(item?.sellerSku || ''),
              quantity: Math.max(1, Number(item?.quantity) || 1),
              imageUrl: String(item?.imageUrl || ''),
              imageUrls: Array.isArray(item?.imageUrls) ? item.imageUrls.map(String).filter(Boolean) : [],
            }));
            return [key, { status: 'ready', items } satisfies OrderProductsState] as const;
          } catch {
            return [key, { status: 'error', items: [] } satisfies OrderProductsState] as const;
          }
        }));
        setOrderProducts((current) => {
          const next = { ...current };
          for (const [key, state] of results) next[key] = state;
          return next;
        });
      }
    })();
    // Los resultados quedan en caché; solo se solicitan órdenes nuevas al cambiar el tab visible.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayedFlowOrders]);

  const deadlineGroups = useMemo(() => {
    const groups: Record<UrgencyKey, InboxOrder[]> = { today: [], tomorrow: [], later: [], overdue: [] };
    for (const order of openOrders) groups[urgencyFor(order, now)].push(order);
    for (const orders of Object.values(groups)) {
      orders.sort((a, b) => {
        const deadlineA = parseDate(a.promisedShippingAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const deadlineB = parseDate(b.promisedShippingAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        return deadlineA - deadlineB || String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
      });
    }
    return groups;
  }, [openOrders, now]);

  const statusGroups = useMemo(() => {
    const groups: Record<StatusColumnKey, InboxOrder[]> = { pending: [], ready: [], fulfillment: [] };
    for (const order of openOrders) groups[statusColumnFor(order)].push(order);
    for (const orders of Object.values(groups)) {
      orders.sort((a, b) => {
        const deadlineA = parseDate(a.promisedShippingAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const deadlineB = parseDate(b.promisedShippingAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        return deadlineA - deadlineB || String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
      });
    }
    return groups;
  }, [openOrders]);

  const visibleColumns = useMemo(() => {
    if (boardView === 'deadline') {
      return DEADLINE_COLUMNS.filter((column) => column.key !== 'overdue' || deadlineGroups.overdue.length > 0);
    }
    return STATUS_COLUMNS.filter((column) => column.key !== 'fulfillment' || statusGroups.fulfillment.length > 0);
  }, [boardView, deadlineGroups.overdue.length, statusGroups.fulfillment.length]);

  const ordersForColumn = (column: BoardColumn) => {
    if (boardView === 'deadline') return deadlineGroups[column.key as UrgencyKey];
    return statusGroups[column.key as StatusColumnKey];
  };

  const labelOrders = useMemo(
    () => expandOrdersAsLabels((data?.orders || []).filter(canPrintShippingLabel)),
    [data?.orders],
  );
  const selectedLabelOrders = useMemo(
    () => labelOrders.filter((order) => selectedLabelKeys.has(labelKey(order))),
    [labelOrders, selectedLabelKeys],
  );
  const selectedLabelCount = selectedLabelOrders.length;
  const availableLabelCount = labelOrders.length;
  const unprintedLabelCount = labelOrders.filter((order) => !labelWasPrinted(order)).length;
  const allLabelsSelected = labelOrders.length > 0 && selectedLabelOrders.length === labelOrders.length;

  const shippedTotal = countLabels((data?.orders || []).filter(isShippedOrder));
  const openLabelCount = countLabels(openOrders);
  const currentDeliveryWindow = data?.deliveryMetrics?.windows.find((window) => window.state === 'active') || null;
  const currentDeliveryDate = currentDeliveryWindow
    ? limaDateKey(parseDate(currentDeliveryWindow.to) || now)
    : '';
  const selectedUrgency = selectedOrder ? urgencyFor(selectedOrder, now) : null;
  const selectedShipped = selectedOrder ? isShippedOrder(selectedOrder) : false;
  const selectedStatus = selectedOrder ? statusMeta(selectedOrder.falabellaStatus) : null;
  const selectedOrderKey = selectedOrder ? `${selectedOrder.companyId}:${selectedOrder.orderId}` : '';
  const visibleOrderActionError = orderActionErrorKey === selectedOrderKey ? orderActionError : '';

  const openStore = (order: InboxOrder) => {
    setActiveCompanyId(order.companyId);
    navigate('/falabella-api');
  };

  const openOrder = (order: InboxOrder) => {
    setSelectedOrder(order);
    setConfirmReady(false);
    setOrderActionError('');
    setOrderActionErrorKey('');
    setOrderActionMessage('');
  };

  const closeOrder = () => {
    setSelectedOrder(null);
    setConfirmReady(false);
    setOrderActionError('');
    setOrderActionErrorKey('');
    setOrderActionMessage('');
  };

  const markLabelsPrintedLocally = (
    orders: InboxOrder[],
    serverUpdates?: Array<{
      companyId: number;
      orderId: string;
      prints: InboxOrder['labelPrints'];
    }>,
  ) => {
    const printedAt = new Date().toISOString();
    const requestedIndexes = new Map<string, Set<number>>();
    for (const order of orders) {
      const key = orderKey(order);
      const indexes = requestedIndexes.get(key) || new Set<number>();
      if (order.labelIndex) indexes.add(order.labelIndex);
      else {
        for (let index = 1; index <= labelCountFor(order); index += 1) indexes.add(index);
      }
      requestedIndexes.set(key, indexes);
    }
    const returnedPrints = new Map(
      (serverUpdates || []).map((entry) => [`${entry.companyId}:${entry.orderId}`, entry.prints]),
    );
    const update = (order: InboxOrder): InboxOrder => {
      const key = orderKey(order);
      const indexes = requestedIndexes.get(key);
      if (!indexes) return order;
      const printsByIndex = new Map((order.labelPrints || []).map((print) => [print.labelIndex, print]));
      const returned = returnedPrints.get(key);
      if (returned?.length) {
        for (const print of returned) printsByIndex.set(print.labelIndex, print);
      } else {
        for (const labelIndex of indexes) {
          const current = printsByIndex.get(labelIndex);
          printsByIndex.set(labelIndex, {
            labelIndex,
            printCount: Number(current?.printCount || 0) + 1,
            firstPrintedAt: current?.firstPrintedAt || printedAt,
            lastPrintedAt: printedAt,
          });
        }
      }
      return {
        ...order,
        labelPrints: [...printsByIndex.values()].sort((left, right) => left.labelIndex - right.labelIndex),
      };
    };
    setData((current) => current ? { ...current, orders: current.orders.map(update) } : current);
    setSelectedOrder((current) => current ? update(current) : current);
  };

  const markReadyToShip = async (order: InboxOrder) => {
    if (!canDispatch || hasCompletedPreparation(order) || isFulfillmentOrder(order)) return;
    const key = `${order.companyId}:${order.orderId}`;
    setReadyLoadingKey(key);
    setOrderActionError('');
    setOrderActionErrorKey(key);
    setOrderActionMessage('');
    try {
      const result = await api.falabellaApiSetReadyToShip(order.companyId, order.orderId);
      const readyOrder = { ...order, falabellaStatus: 'ready_to_ship' };
      setData((current) => current ? {
        ...current,
        orders: current.orders.map((row) => row.companyId === order.companyId && row.orderId === order.orderId ? readyOrder : row),
      } : current);
      setSelectedOrder((current) => current && current.companyId === order.companyId && current.orderId === order.orderId
        ? { ...current, falabellaStatus: 'ready_to_ship' }
        : current);
      setConfirmReady(false);
      setOrderActionMessage(result?.alreadyReady
        ? 'Falabella confirmó que el pedido ya estaba listo. La etiqueta está disponible.'
        : 'Pedido marcado como listo para envío. Ya puedes abrir la etiqueta.');
    } catch (nextError: any) {
      setOrderActionError(nextError?.message || 'No se pudo marcar el pedido como listo para envío.');
      setOrderActionErrorKey(key);
    } finally {
      setReadyLoadingKey('');
    }
  };

  const markAllReadyToShip = async () => {
    if (!bulkReadySelection || bulkReadyRunning || !canDispatch) return;
    const candidates = bulkReadySelection.orders.filter(canMarkReadyToShip);
    if (!candidates.length) {
      setBulkReadySelection(null);
      return;
    }

    setBulkReadyRunning(true);
    setError('');
    setSyncMessage('');
    const succeeded = new Set<string>();
    const failed: InboxOrder[] = [];
    try {
      for (let index = 0; index < candidates.length; index += 4) {
        const chunk = candidates.slice(index, index + 4);
        const results = await Promise.allSettled(chunk.map((order) => (
          api.falabellaApiSetReadyToShip(order.companyId, order.orderId)
        )));
        results.forEach((result, resultIndex) => {
          const order = chunk[resultIndex];
          if (result.status === 'fulfilled') succeeded.add(orderKey(order));
          else failed.push(order);
        });
      }

      if (succeeded.size > 0) {
        setData((current) => current ? {
          ...current,
          orders: current.orders.map((order) => succeeded.has(orderKey(order))
            ? { ...order, falabellaStatus: 'ready_to_ship' }
            : order),
        } : current);
        setSyncMessage(`${succeeded.size} pedido${succeeded.size === 1 ? '' : 's'} marcado${succeeded.size === 1 ? '' : 's'} como listo${succeeded.size === 1 ? '' : 's'} para envío.`);
      }
      if (failed.length > 0) {
        setError(`${failed.length} pedido${failed.length === 1 ? '' : 's'} ${failed.length === 1 ? 'no pudo actualizarse' : 'no pudieron actualizarse'}. Intenta sincronizar y vuelve a revisar.`);
      }
      setBulkReadySelection(null);
    } finally {
      setBulkReadyRunning(false);
    }
  };

  const toggleLabelSelection = (order: InboxOrder) => {
    const key = labelKey(order);
    setSelectedLabelKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAllLabels = () => {
    setSelectedLabelKeys(allLabelsSelected
      ? new Set()
      : new Set(labelOrders.map(labelKey)));
  };

  const selectOnlyUnprintedLabels = () => {
    setSelectedLabelKeys(new Set(
      labelOrders.filter((order) => !labelWasPrinted(order)).map(labelKey),
    ));
  };

  const startLabelSelection = () => {
    setLabelSelectionMode(true);
    selectOnlyUnprintedLabels();
  };

  const cancelLabelSelection = () => {
    setLabelSelectionMode(false);
    setSelectedLabelKeys(new Set());
  };

  const printShippingLabels = async (orders: InboxOrder[], column: BoardColumnKey | null = null) => {
    const printableOrders = orders.filter(canPrintShippingLabel);
    if (!printableOrders.length || batchLabelsLoading) return;
    const printableLabelCount = printableOrders.reduce(
      (total, order) => total + (order.labelIndex ? 1 : labelCountFor(order)),
      0,
    );
    const previewWindow = window.open('', '_blank');
    if (previewWindow) {
      previewWindow.opener = null;
      renderShippingLabelsLoading(previewWindow, printableLabelCount);
    }
    setBatchLabelsLoading(true);
    setPrintingLabelKey(printableOrders.length === 1 ? labelKey(printableOrders[0]) : '');
    setPrintingColumn(column);
    setError('');
    try {
      const result = await api.falabellaApiGetShippingLabelsA4(printableOrders.map((order) => ({
        companyId: order.companyId,
        orderId: order.orderId,
        orderNumber: order.orderNumber,
        labelIndex: order.labelIndex,
      })));
      if (!result?.base64) throw new Error('No se pudo crear el PDF de etiquetas.');
      const objectUrl = URL.createObjectURL(base64Blob(result.base64, 'application/pdf'));
      if (previewWindow) openShippingLabelsPdf(previewWindow, objectUrl);
      else {
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = result.filename || 'etiquetas-falabella-a4.pdf';
        link.click();
      }
      markLabelsPrintedLocally(
        printableOrders,
        Array.isArray(result.prints) ? result.prints : undefined,
      );
      if (labelSelectionMode) cancelLabelSelection();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 5 * 60_000);
    } catch (nextError: any) {
      previewWindow?.close();
      setError(nextError?.message || 'No se pudieron agrupar las etiquetas de Falabella.');
    } finally {
      setBatchLabelsLoading(false);
      setPrintingLabelKey('');
      setPrintingColumn(null);
    }
  };

  return (
    <div className="space-y-4">
      <section aria-label="Filtros de pedidos">
        <div className="grid gap-2 md:grid-cols-[220px_minmax(0,1fr)_160px]">
          <div>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger aria-label="Empresa" className="!h-10 w-full rounded-lg border-border bg-card px-3 py-0 shadow-none">
                <Store className="size-4 text-muted-foreground" />
                <SelectValue placeholder="Todas las tiendas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las tiendas</SelectItem>
                {companies.map((company) => <SelectItem key={company.id} value={String(company.id)}>{company.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Buscar pedido" className="h-10 rounded-lg border-border bg-card py-0 pl-10 pr-4 shadow-none" aria-label="Buscar pedidos" />
          </div>
          <Button size="lg" className="w-full rounded-lg px-4 font-semibold" onClick={() => void syncAll()} disabled={refreshing || batchLabelsLoading}>
            {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {refreshing ? 'Sincronizando…' : 'Sincronizar'}
          </Button>
        </div>
      </section>

      {currentDeliveryWindow && data?.deliveryMetrics?.windows?.length ? (
        <details className="group rounded-xl border border-border bg-card px-4 py-3">
          <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <Timer className="size-4 text-primary" />
                <span className="text-sm font-semibold text-foreground">Métricas del turno actual</span>
                <span className="text-sm text-muted-foreground">
                  {formatTime(currentDeliveryWindow.from)} → {formatTime(currentDeliveryWindow.to)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="font-medium tabular-nums text-foreground">{currentDeliveryWindow.deliveries} entregas</span>
                <span className="text-muted-foreground">
                  Ciclo {currentDeliveryWindow.total.measured > 0 ? formatDuration(currentDeliveryWindow.total.averageMinutes) : 'sin datos'}
                </span>
                <span className="font-medium text-primary group-open:hidden">Ver detalle</span>
                <span className="hidden font-medium text-primary group-open:inline">Ocultar detalle</span>
              </div>
            </div>
          </summary>
          <div className="mt-4 border-t border-border pt-4">
            <div className="flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
              <RefreshCw className="size-3.5" /> Actualización cada 15 min
            </div>
            <div className="mt-4 grid gap-8 lg:grid-cols-2">
              {data.deliveryMetrics.windows.map((window) => <DeliveryShiftCard key={window.key} window={window} />)}
            </div>
            <div className="mt-6">
              <DeliveryDayHistory days={data.deliveryMetrics.days || []} currentDate={currentDeliveryDate} />
            </div>
          </div>
        </details>
      ) : null}

      <section>
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <div>
            <div className="flex items-baseline gap-2"><h2 className="text-sm font-semibold text-foreground">Prioridad global de entrega</h2><span className="text-xs text-muted-foreground">{openLabelCount} sin enviar</span></div>
            <p className="mt-0.5 text-xs text-muted-foreground">Incluye todas las etiquetas pendientes y listas para enviar.</p>
          </div>
          <span className="text-[11px] text-muted-foreground/80">{data?.lastSyncedAt ? `Actualizado ${formatDateTime(data.lastSyncedAt)}` : 'Sin sincronizar'}</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {([
            { value: 'overdue', label: 'Vencidos', description: 'Fuera de plazo', count: globalDeadlineCounts.overdue, className: 'border-rose-100 bg-rose-50 text-rose-900' },
            { value: 'today', label: 'Vencen hoy', description: 'Prioridad inmediata', count: globalDeadlineCounts.today, className: 'border-amber-100 bg-amber-50 text-amber-900' },
            { value: 'tomorrow', label: 'Vencen mañana', description: 'Preparar con anticipación', count: globalDeadlineCounts.tomorrow, className: 'border-sky-100 bg-sky-50 text-sky-900' },
            { value: 'later', label: 'Próximos', description: 'Después de mañana', count: globalDeadlineCounts.later, className: 'border-slate-200 bg-slate-100 text-slate-900' },
          ] as Array<{ value: UrgencyKey; label: string; description: string; count: number; className: string }>).map((item) => (
            <article key={item.value} aria-label={`${item.label}: ${item.count}`} className={`rounded-xl border px-4 py-3 ${item.className}`}>
              <div className="flex items-start justify-between gap-3"><span className="text-sm font-medium">{item.label}</span><span className="text-xl font-semibold tabular-nums">{item.count}</span></div>
              <p className="mt-1 text-xs opacity-75">{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      {labelSelectionMode && (
        <div className="flex flex-col gap-3 rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sky-950 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Checkbox
              checked={allLabelsSelected}
              onCheckedChange={toggleAllLabels}
              aria-label="Seleccionar todas las etiquetas disponibles"
              className="mt-0.5"
            />
            <div>
              <p className="text-sm font-semibold">{selectedLabelCount} de {availableLabelCount} etiquetas seleccionadas</p>
              <p className="text-xs text-sky-800">
                {unprintedLabelCount
                  ? `${unprintedLabelCount} sin imprimir marcadas por defecto. Las impresas quedan sin marcar.`
                  : 'Todas ya fueron impresas. Marca únicamente las que quieras reimprimir.'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={selectOnlyUnprintedLabels} disabled={batchLabelsLoading || !unprintedLabelCount}>
              Solo no impresas
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={toggleAllLabels} disabled={batchLabelsLoading}>
              {allLabelsSelected ? 'Quitar todas' : 'Seleccionar todas'}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={cancelLabelSelection} disabled={batchLabelsLoading}>
              Cancelar
            </Button>
            <Button type="button" size="sm" onClick={() => void printShippingLabels(selectedLabelOrders)} disabled={!selectedLabelOrders.length || batchLabelsLoading}>
              {batchLabelsLoading ? <Loader2 className="animate-spin" /> : <Printer />}
              {batchLabelsLoading
                ? 'Preparando PDF…'
                : selectedLabelCount
                  ? `Imprimir ${selectedLabelCount} en A4`
                  : 'Imprimir en A4'}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {syncMessage && !error && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">
          <CheckCircle2 className="size-4 shrink-0" />
          <span>{syncMessage}</span>
        </div>
      )}

      <section>
        <div className="mb-2"><h2 className="text-sm font-semibold text-foreground">Estado del pedido</h2><p className="mt-0.5 text-xs text-muted-foreground">Selecciona la etapa operativa que quieres revisar.</p></div>
        <div className="rounded-xl bg-muted p-1">
          <div role="tablist" aria-label="Flujo de pedidos" className="grid gap-1 md:grid-cols-3">
            {flowTabs.map((tab) => {
              const active = flowStage === tab.value;
              const orders = flowGroups[tab.value];
              const count = tab.value === 'shipped' ? shippedTotal : countLabels(orders);
              return <button key={tab.value} type="button" role="tab" aria-selected={active} onClick={() => { setFlowStage(tab.value); if (tab.value === 'pending') setPendingDeadlineTab('today'); }} className={`rounded-lg px-3 py-2.5 text-left text-sm transition ${active ? tab.activeClass : 'text-muted-foreground hover:bg-background/70 hover:text-foreground'}`}><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate font-medium">{tab.label}</p><p className="mt-0.5 truncate text-xs opacity-80">{tab.description}</p></div><span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${active ? tab.badgeClass : 'bg-background text-muted-foreground'}`}>{count}</span></div></button>;
            })}
          </div>
        </div>
      </section>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-md border border-border bg-card py-20 text-sm text-muted-foreground">
          <Loader2 className="size-5 animate-spin" /> Cargando pedidos pendientes…
        </div>
      ) : (
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="border-b border-border bg-muted/30 px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="text-sm font-medium">{activeFlow.label}</p><p className="text-xs text-muted-foreground">{activeFlow.description}</p></div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-background px-3 py-1 text-xs font-medium text-muted-foreground">Mostrando {filteredCountLabel}</span>
                {flowStage === 'ready' && flowOrders.length > 0 && (
                  <Button size="sm" onClick={startLabelSelection} disabled={batchLabelsLoading}>
                    <Printer /> Imprimir etiquetas
                  </Button>
                )}
                {flowStage === 'pending' && canDispatch && visiblePendingCandidates.length > 0 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        onClick={() => setBulkReadySelection({
                          columnKey: 'pending',
                          columnTitle: pendingDeadlineTabLabel(pendingDeadlineTab, now),
                          orders: visiblePendingCandidates,
                        })}
                      >
                        <PackageCheck /> Marcar todos
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Marcar como listos para enviar todos los pedidos del tab activo.</TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>
          </div>
          {flowStage === 'pending' && (
            <div className="border-b border-border bg-background px-4 py-2.5">
              <div role="tablist" aria-label="Pendientes por fecha de entrega" className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-muted p-1">
                {pendingDeadlineTabs.map((tab) => {
                  const active = pendingDeadlineTab === tab.value;
                  const count = countLabels(tab.orders);
                  return (
                    <button
                      key={tab.value}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setPendingDeadlineTab(tab.value)}
                      className={`inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition ${active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      {tab.label}
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${active ? 'bg-amber-100 text-amber-800' : 'bg-background text-muted-foreground'}`}>{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1260px] text-sm">
              <thead className="bg-background"><tr className="text-left text-muted-foreground"><th className="w-44 min-w-44 p-3 font-medium"><span className="inline-flex items-center gap-2">{labelSelectionMode && flowStage === 'ready' && <Checkbox checked={allLabelsSelected ? true : selectedLabelCount > 0 ? 'indeterminate' : false} onCheckedChange={toggleAllLabels} aria-label="Seleccionar todas las etiquetas" />} Orden de venta</span></th><th className="w-[360px] min-w-[360px] p-3 font-medium">Productos</th><th className="w-36 min-w-36 p-3 font-medium">Ingresó</th><th className="w-48 min-w-48 p-3 font-medium">{flowStage === 'shipped' ? 'Enviado' : 'Entrega'}</th><th className="w-64 min-w-64 p-3 font-medium">Tienda</th><th className="w-32 min-w-32 p-3 font-medium">Siguiente paso</th></tr></thead>
              <tbody>
                {filteredFlowOrders.map((order) => {
                  const ready = canPrintShippingLabel(order);
                  const urgency = urgencyFor(order, now);
                  const urgencyClass = urgency === 'overdue' ? 'bg-rose-100 text-rose-700' : urgency === 'today' ? 'bg-amber-100 text-amber-700' : urgency === 'tomorrow' ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-700';
                  return (
                    <tr key={`${order.id}:${order.sameOrderIndex}`} className="border-t border-border/70 transition-colors hover:bg-muted/30">
                      <td className="p-3 align-middle">
                        <div className="flex flex-wrap items-center gap-2">
                          {labelSelectionMode && ready && (
                            <Checkbox
                              checked={selectedLabelKeys.has(labelKey(order))}
                              onCheckedChange={() => toggleLabelSelection(order)}
                              aria-label={`Seleccionar etiqueta ${order.sameOrderIndex} del pedido ${order.orderNumber}`}
                            />
                          )}
                          <button type="button" onClick={() => openOrder(order)} className="font-mono text-xs font-medium text-foreground underline-offset-2 hover:underline">{order.orderNumber}</button>
                          {order.sameOrderCount > 1 && (
                            <Badge variant="outline" className="rounded-md border-sky-200 bg-sky-50 text-[10px] font-medium text-sky-800">
                              Mismo pedido · etiqueta {order.sameOrderIndex}/{order.sameOrderCount}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="w-[360px] min-w-[360px] p-3 align-middle"><OrderProducts state={orderProducts[orderKey(order)]} /></td>
                      <td className="w-36 min-w-36 whitespace-nowrap p-3 align-middle text-xs"><span className="font-medium text-foreground">{elapsedLabel(order.createdAt, now) || 'Sin fecha'}</span><span className="mt-0.5 block text-[11px] text-muted-foreground">{formatDateTime(order.createdAt)}</span></td>
                      <td className="w-48 min-w-48 whitespace-nowrap p-3 align-middle text-xs">{flowStage === 'shipped' ? formatDateTime(order.updatedAt) : <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${urgencyClass}`}>{deadlineLabel(order, now)}</span>}</td>
                      <td className="w-64 min-w-64 max-w-64 truncate p-3 align-middle text-xs text-muted-foreground" title={order.companyName}>{order.companyName}</td>
                      <td className="p-3 align-middle">
                        {flowStage === 'shipped' ? <Button size="sm" variant="outline" onClick={() => openOrder(order)}>Ver detalle</Button> : ready ? (
                          <div className="inline-flex flex-col items-start gap-0.5">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="sm"
                                  variant={labelWasPrinted(order) ? 'outline' : 'default'}
                                  className={labelWasPrinted(order) ? 'opacity-60 hover:opacity-85' : ''}
                                  onClick={() => void printShippingLabels([order])}
                                  disabled={batchLabelsLoading}
                                >
                                  {printingLabelKey === labelKey(order) ? <Loader2 className="animate-spin" /> : <Printer />}
                                  {labelWasPrinted(order) ? 'Reimprimir' : 'Imprimir'}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{labelPrintTooltip(order)}</TooltipContent>
                            </Tooltip>
                            {labelWasPrinted(order) && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="cursor-help text-[10px] font-medium text-emerald-700">Impresa</span>
                                </TooltipTrigger>
                                <TooltipContent>{labelPrintTooltip(order)}</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        ) : canMarkReadyToShip(order) && canDispatch ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon-sm"
                                aria-label="Marcar listo para enviar"
                                onClick={() => { openOrder(order); setConfirmReady(true); }}
                              >
                                <PackageCheck />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Marcar listo para enviar</TooltipContent>
                          </Tooltip>
                        ) : <Button size="sm" variant="outline" onClick={() => openOrder(order)}>Ver detalle</Button>}
                      </td>
                    </tr>
                  );
                })}
                {filteredFlowOrders.length === 0 && <tr><td colSpan={6} className="px-4 py-14 text-center text-sm text-muted-foreground">No hay pedidos con estos filtros.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <Dialog open={Boolean(bulkReadySelection)} onOpenChange={(open) => !open && !bulkReadyRunning && setBulkReadySelection(null)}>
        <DialogContent className="sm:max-w-md" showCloseButton={!bulkReadyRunning}>
          <DialogHeader>
            <DialogTitle>Marcar todos listos para enviar</DialogTitle>
            <DialogDescription>
              {bulkReadySelection
                ? `${bulkReadySelection.orders.filter(canMarkReadyToShip).length} pedidos seleccionados en “${bulkReadySelection.columnTitle}”.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
            Confirma que todos estos pedidos ya están empacados. Falabella habilitará sus etiquetas de envío.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkReadySelection(null)} disabled={bulkReadyRunning}>Cancelar</Button>
            <Button onClick={() => void markAllReadyToShip()} disabled={bulkReadyRunning}>
              {bulkReadyRunning ? <Loader2 className="animate-spin" /> : <PackageCheck />}
              {bulkReadyRunning ? 'Actualizando pedidos…' : 'Marcar todos listos para enviar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedOrder)} onOpenChange={(open) => !open && !readyLoadingKey && closeOrder()}>
        <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg" showCloseButton={!readyLoadingKey}>
          {selectedOrder && selectedUrgency && selectedStatus && (
            confirmReady ? (
              <>
                <DialogHeader>
                  <DialogTitle>Confirmar pedido listo para envío</DialogTitle>
                  <DialogDescription>Pedido {selectedOrder.orderNumber} · {selectedOrder.companyName}</DialogDescription>
                </DialogHeader>

                <div className="flex gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-amber-900">
                  <PackageCheck className="mt-0.5 size-5 shrink-0" />
                  <div>
                    <p className="font-semibold">Confirma que todo el pedido está empacado</p>
                    <p className="mt-1 text-sm text-amber-800">
                      Falabella cambiará a listo para envío todos los productos asociados a esta orden. Esta acción no debe hacerse si falta algún producto por empacar.
                    </p>
                  </div>
                </div>

                <dl className="grid grid-cols-2 gap-4 rounded-md border border-border p-4 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Pedido</dt>
                    <dd className="mt-1 font-mono font-semibold">{selectedOrder.orderNumber}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Productos</dt>
                    <dd className="mt-1 font-medium">{selectedOrder.itemsCount ?? '-'} producto{selectedOrder.itemsCount === 1 ? '' : 's'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Tipo de despacho</dt>
                    <dd className="mt-1 font-medium">{selectedOrder.shippingType || 'No informado'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Siguiente paso</dt>
                    <dd className="mt-1 font-medium">Abrir e imprimir etiqueta</dd>
                  </div>
                </dl>

                <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs text-sky-800">
                  Si la emisión automática está activa, este cambio también puede iniciar la emisión del comprobante del pedido.
                </div>

                {visibleOrderActionError && (
                  <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                    <span>{visibleOrderActionError}</span>
                  </div>
                )}

                <DialogFooter>
                  <Button variant="outline" onClick={() => setConfirmReady(false)} disabled={Boolean(readyLoadingKey)}>Volver</Button>
                  <Button onClick={() => void markReadyToShip(selectedOrder)} disabled={Boolean(readyLoadingKey)}>
                    {readyLoadingKey ? <Loader2 className="animate-spin" /> : <PackageCheck />}
                    Confirmar y marcar listo
                  </Button>
                </DialogFooter>
              </>
            ) : (
            <>
              <DialogHeader>
                <div className="flex flex-wrap items-center gap-2 pr-8">
                  <DialogTitle className="font-mono">Pedido {selectedOrder.orderNumber}</DialogTitle>
                  <Badge variant="outline" className={`rounded-md ${selectedStatus.className}`}>{selectedStatus.label}</Badge>
                </div>
                <DialogDescription>{selectedOrder.companyName}</DialogDescription>
              </DialogHeader>

              <div className={`rounded-md border p-4 ${selectedShipped ? 'border-emerald-200 bg-emerald-50' : selectedUrgency === 'overdue' ? 'border-red-200 bg-red-50' : selectedUrgency === 'today' ? 'border-amber-200 bg-amber-50' : 'border-border bg-muted/30'}`}>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {selectedShipped ? 'Estado de entrega' : 'Límite para entregar al operador logístico'}
                </p>
                <p className={`mt-1 text-xl font-semibold ${selectedShipped ? 'text-emerald-700' : selectedUrgency === 'overdue' ? 'text-red-700' : selectedUrgency === 'today' ? 'text-amber-700' : 'text-foreground'}`}>
                  {selectedShipped ? 'Enviado a Falabella' : deadlineLabel(selectedOrder, now)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {selectedShipped
                    ? `Última actualización: ${formatDateTime(selectedOrder.updatedAt)}`
                    : `Fecha informada por Falabella: ${formatDateTime(selectedOrder.promisedShippingAt)}`}
                </p>
              </div>

              <section className="rounded-md border border-border p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Flujo de despacho</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">Completa los pasos en orden para obtener la etiqueta.</p>
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">
                    {isFulfillmentOrder(selectedOrder) ? 'Gestión automática' : hasCompletedPreparation(selectedOrder) ? '3 de 3' : '1 de 3'}
                  </span>
                </div>
                {isFulfillmentOrder(selectedOrder) ? (
                  <div className="mt-3 rounded-md border border-violet-200 bg-violet-50 px-3 py-2.5 text-sm text-violet-800">
                    No requiere preparación manual en esta bandeja.
                  </div>
                ) : (
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                    <div className={`rounded-md border px-2 py-2 ${hasCompletedPreparation(selectedOrder) ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                      <span className="font-semibold">1</span><p className="mt-0.5">Empacar</p>
                    </div>
                    <div className={`rounded-md border px-2 py-2 ${hasCompletedPreparation(selectedOrder) ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-border bg-muted/30 text-muted-foreground'}`}>
                      <span className="font-semibold">2</span><p className="mt-0.5">Marcar listo</p>
                    </div>
                    <div className={`rounded-md border px-2 py-2 ${hasCompletedPreparation(selectedOrder) ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-border bg-muted/30 text-muted-foreground'}`}>
                      <span className="font-semibold">3</span><p className="mt-0.5">Etiqueta</p>
                    </div>
                  </div>
                )}
                <p className="mt-3 text-sm text-muted-foreground">
                  {isFulfillmentOrder(selectedOrder)
                    ? 'Este pedido es Fulfillment: Falabella gestiona su inventario y despacho, por lo que no debes marcarlo manualmente.'
                    : selectedShipped
                      ? 'El pedido ya fue enviado a Falabella y no requiere volver a imprimir su etiqueta.'
                    : !canDispatch
                      ? 'Tu perfil es de solo lectura. Puedes revisar el pedido y abrir su etiqueta cuando Falabella lo marque como listo.'
                    : canPrintShippingLabel(selectedOrder)
                      ? 'Falabella confirmó el pedido como listo para envío. Ya puedes abrir e imprimir la etiqueta.'
                      : 'Empaca todos los productos del pedido y luego confirma que está listo para habilitar la etiqueta.'}
                </p>
              </section>

              <dl className="grid grid-cols-2 gap-x-5 gap-y-4 rounded-md border border-border p-4 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Ingresó</dt>
                  <dd className="mt-1 font-medium text-foreground">{formatDateTime(selectedOrder.createdAt)}</dd>
                  <dd className="text-xs text-muted-foreground">{elapsedLabel(selectedOrder.createdAt, now)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Total</dt>
                  <dd className="mt-1 font-semibold tabular-nums text-foreground">{formatMoney(selectedOrder.total, selectedOrder.currency)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Cliente</dt>
                  <dd className="mt-1 font-medium text-foreground">{selectedOrder.customerName || 'No informado'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Contenido</dt>
                  <dd className="mt-1 font-medium text-foreground">{selectedOrder.itemsCount ?? '-'} producto{selectedOrder.itemsCount === 1 ? '' : 's'}</dd>
                  <dd className="text-xs text-muted-foreground">Requiere {selectedOrder.invoiceRequired ? 'factura' : 'boleta'}</dd>
                </div>
              </dl>

              {visibleOrderActionError && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span>{visibleOrderActionError}</span>
                </div>
              )}
              {orderActionMessage && !visibleOrderActionError && (
                <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">
                  <CheckCircle2 className="size-4 shrink-0" />
                  <span>{orderActionMessage}</span>
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={closeOrder}>Cerrar</Button>
                {canPrintShippingLabel(selectedOrder) ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={labelWasPrinted(selectedOrder) ? 'outline' : 'default'}
                        className={labelWasPrinted(selectedOrder) ? 'opacity-60 hover:opacity-85' : ''}
                        onClick={() => void printShippingLabels([selectedOrder])}
                        disabled={batchLabelsLoading}
                      >
                        {printingLabelKey === labelKey(selectedOrder) ? <Loader2 className="animate-spin" /> : <Printer />}
                        {labelWasPrinted(selectedOrder) ? 'Reimprimir etiqueta' : 'Imprimir etiqueta'}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{labelPrintTooltip(selectedOrder)}</TooltipContent>
                  </Tooltip>
                ) : !selectedShipped && !isFulfillmentOrder(selectedOrder) && canDispatch ? (
                  <Button onClick={() => { setOrderActionError(''); setConfirmReady(true); }}>
                    <PackageCheck /> Marcar listo para envío
                  </Button>
                ) : null}
                <Button variant="outline" onClick={() => openStore(selectedOrder)}>
                  Gestionar pedido <ArrowRight />
                </Button>
              </DialogFooter>
            </>
            )
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
