import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock3,
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
  };
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

type CompanyOption = { id: number; name: string };
type UrgencyKey = 'overdue' | 'today' | 'tomorrow' | 'later';
type StatusColumnKey = 'pending' | 'ready' | 'fulfillment';
type BoardColumnKey = UrgencyKey | StatusColumnKey;
type BoardView = 'deadline' | 'status';
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
        <span>4 por hoja</span>
      </div>
      <div class="note">El diálogo de impresión se abrirá automáticamente cuando esté listo.</div>
    </main>
  </body>
</html>`);
  previewWindow.document.close();
}

function renderShippingLabelsPrint(previewWindow: Window, pdfUrl: string) {
  const doc = previewWindow.document;
  doc.open();
  doc.write(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Imprimir etiquetas Falabella</title>
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f5f5f4; color: #1c1917; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { width: min(92vw, 460px); padding: 40px; border: 1px solid #e7e5e4; border-radius: 20px; background: #fff; box-shadow: 0 24px 60px rgba(28, 25, 23, .10); text-align: center; }
      .icon { display: grid; width: 56px; height: 56px; margin: 0 auto 22px; place-items: center; border-radius: 16px; background: #292524; color: #fff; font-size: 16px; font-weight: 750; letter-spacing: -.02em; }
      h1 { margin: 0; font-size: 24px; line-height: 1.2; letter-spacing: -.02em; }
      p { margin: 12px auto 0; max-width: 350px; color: #78716c; font-size: 14px; line-height: 1.55; }
      .actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; margin-top: 26px; }
      button { min-height: 42px; padding: 0 16px; border: 1px solid #d6d3d1; border-radius: 10px; background: #fff; color: #292524; font: inherit; font-size: 13px; font-weight: 650; cursor: pointer; }
      button.primary { border-color: #292524; background: #292524; color: #fff; }
      button:disabled { cursor: wait; opacity: .5; }
      iframe { position: fixed; right: 0; bottom: 0; width: 1px; height: 1px; border: 0; opacity: 0; pointer-events: none; }
    </style>
  </head>
  <body>
    <main>
      <div class="icon" aria-hidden="true">A4</div>
      <h1>PDF listo para imprimir</h1>
      <p id="status">Cargando el documento en el sistema de impresión…</p>
      <div class="actions">
        <button id="print-again" class="primary" type="button" disabled>Imprimir ahora</button>
        <button id="open-pdf" type="button">Abrir visor PDF</button>
      </div>
    </main>
  </body>
</html>`);
  doc.close();

  const frame = doc.createElement('iframe');
  frame.title = 'Documento de etiquetas';
  const status = doc.getElementById('status');
  const printAgain = doc.getElementById('print-again') as HTMLButtonElement | null;
  const openPdf = doc.getElementById('open-pdf') as HTMLButtonElement | null;
  let loaded = false;

  const attemptPrint = () => {
    try {
      if (!loaded || !frame.contentWindow) throw new Error('PDF aún no disponible');
      frame.contentWindow.focus();
      frame.contentWindow.print();
      if (status) status.textContent = 'Si el diálogo no apareció, pulsa “Imprimir ahora” o abre el visor PDF.';
    } catch {
      if (status) status.textContent = 'El navegador bloqueó la impresión automática. Usa uno de los botones siguientes.';
    }
  };

  openPdf?.addEventListener('click', () => previewWindow.location.replace(pdfUrl));
  printAgain?.addEventListener('click', attemptPrint);
  frame.addEventListener('load', () => {
    loaded = true;
    if (printAgain) printAgain.disabled = false;
    if (status) status.textContent = 'Abriendo el diálogo de impresión…';
    previewWindow.setTimeout(attemptPrint, 500);
  }, { once: true });
  frame.src = pdfUrl;
  doc.body.appendChild(frame);
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
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2.5 text-xs"
          onClick={canPrintShippingLabel(order) ? onViewLabel : onOpen}
          disabled={labelLoading || (!canPrintShippingLabel(order) && !canDispatch)}
          title={canPrintShippingLabel(order) ? 'Ver etiqueta de envío' : !canDispatch ? 'Tu perfil es de solo lectura' : fulfillment ? 'Revisar el flujo gestionado por Falabella' : 'Marcar pedido listo para envío'}
        >
          {labelLoading ? <Loader2 className="animate-spin" /> : canPrintShippingLabel(order) ? <Printer /> : <PackageCheck />}
          {canPrintShippingLabel(order) ? 'Etiqueta' : !canDispatch ? 'Solo lectura' : fulfillment ? 'Ver flujo' : 'Listo para envío'}
        </Button>
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
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [syncMessage, setSyncMessage] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<InboxOrder | null>(null);
  const [labelLoadingKey, setLabelLoadingKey] = useState('');
  const [labelSelectionMode, setLabelSelectionMode] = useState(false);
  const [selectedLabelKeys, setSelectedLabelKeys] = useState<Set<string>>(() => new Set());
  const [batchLabelsLoading, setBatchLabelsLoading] = useState(false);
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
    () => (data?.orders || []).filter(canPrintShippingLabel),
    [data?.orders],
  );
  const selectedLabelOrders = useMemo(
    () => labelOrders.filter((order) => selectedLabelKeys.has(orderKey(order))),
    [labelOrders, selectedLabelKeys],
  );
  const allLabelsSelected = labelOrders.length > 0 && selectedLabelOrders.length === labelOrders.length;

  const shippedTotal = data?.shippedCount ?? (data?.orders || []).filter(isShippedOrder).length;
  const operationalTotal = data?.operationalCount ?? openOrders.length;
  const currentDeliveryWindow = data?.deliveryMetrics?.windows.find((window) => window.state === 'active') || null;
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

  const viewShippingLabel = async (order: InboxOrder) => {
    if (!canPrintShippingLabel(order)) return;
    const key = `${order.companyId}:${order.orderId}`;
    const previewWindow = window.open('', '_blank');
    if (previewWindow) {
      previewWindow.opener = null;
      previewWindow.document.title = `Etiqueta ${order.orderNumber}`;
      previewWindow.document.body.textContent = 'Cargando etiqueta…';
    }
    setLabelLoadingKey(key);
    setError('');
    setOrderActionError('');
    setOrderActionErrorKey(key);
    try {
      const result = await api.falabellaApiGetShippingLabel(order.companyId, order.orderId);
      if (!result?.base64) throw new Error('Falabella respondió sin el archivo de la etiqueta.');
      const mimeType = String(result.mimeType || 'application/pdf').toLowerCase();
      const objectUrl = URL.createObjectURL(base64Blob(result.base64, mimeType));
      if (mimeType === 'application/pdf' && previewWindow) {
        previewWindow.location.replace(objectUrl);
      } else {
        previewWindow?.close();
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = result.filename || `etiqueta-${order.orderNumber}.${mimeType === 'application/pdf' ? 'pdf' : 'zpl'}`;
        link.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (nextError: any) {
      previewWindow?.close();
      const message = nextError?.message || 'No se pudo obtener la etiqueta de Falabella.';
      if (selectedOrder?.companyId === order.companyId && selectedOrder?.orderId === order.orderId) {
        setOrderActionError(message);
        setOrderActionErrorKey(key);
      }
      else setError(message);
    } finally {
      setLabelLoadingKey('');
    }
  };

  const toggleLabelSelection = (order: InboxOrder) => {
    const key = orderKey(order);
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
      : new Set(labelOrders.map(orderKey)));
  };

  const cancelLabelSelection = () => {
    setLabelSelectionMode(false);
    setSelectedLabelKeys(new Set());
  };

  const printShippingLabels = async (orders: InboxOrder[], column: BoardColumnKey | null = null) => {
    const printableOrders = orders.filter(canPrintShippingLabel);
    if (!printableOrders.length || batchLabelsLoading) return;
    const previewWindow = window.open('', '_blank');
    if (previewWindow) {
      previewWindow.opener = null;
      renderShippingLabelsLoading(previewWindow, printableOrders.length);
    }
    setBatchLabelsLoading(true);
    setPrintingColumn(column);
    setError('');
    try {
      const result = await api.falabellaApiGetShippingLabelsA4(printableOrders.map((order) => ({
        companyId: order.companyId,
        orderId: order.orderId,
        orderNumber: order.orderNumber,
      })));
      if (!result?.base64) throw new Error('No se pudo crear el PDF de etiquetas.');
      const objectUrl = URL.createObjectURL(base64Blob(result.base64, 'application/pdf'));
      if (previewWindow) renderShippingLabelsPrint(previewWindow, objectUrl);
      else {
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = result.filename || 'etiquetas-falabella-a4.pdf';
        link.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 5 * 60_000);
    } catch (nextError: any) {
      previewWindow?.close();
      setError(nextError?.message || 'No se pudieron agrupar las etiquetas de Falabella.');
    } finally {
      setBatchLabelsLoading(false);
      setPrintingColumn(null);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-border bg-card p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Inbox className="size-4 text-primary" />
              <h1 className="text-sm font-semibold text-foreground">Pedidos por atender</h1>
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-semibold tabular-nums text-foreground">{operationalTotal}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Pendientes y listos para entregar a Falabella.</p>
          </div>
          <span className="text-xs text-muted-foreground">
            {data?.lastSyncedAt ? `Actualizado ${formatDateTime(data.lastSyncedAt)}` : 'Sin sincronización registrada'}
          </span>
        </div>

        <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={companyId} onValueChange={setCompanyId}>
            <SelectTrigger className="w-full border-border bg-background sm:w-[210px]">
              <Store className="size-4 text-muted-foreground" />
              <SelectValue placeholder="Todas las tiendas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las tiendas</SelectItem>
              {companies.map((company) => (
                <SelectItem key={company.id} value={String(company.id)}>{company.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Buscar pedido, cliente o tienda"
              className="pl-9"
              aria-label="Buscar pedidos"
            />
          </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (labelSelectionMode) cancelLabelSelection();
                else setLabelSelectionMode(true);
              }}
              disabled={labelOrders.length === 0 || batchLabelsLoading}
            >
              <Printer />
              {labelSelectionMode ? 'Cancelar selección' : 'Imprimir etiquetas'}
            </Button>
            <Button size="sm" onClick={() => void syncAll()} disabled={refreshing || batchLabelsLoading}>
              {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Sincronizar
            </Button>
          </div>
        </div>
      </section>

      <section className="flex flex-wrap gap-2" aria-label="Resumen de pedidos">
        <div className="min-w-36 flex-1 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-indigo-950">
          <p className="text-[11px] font-medium text-indigo-700">Por atender</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums">{operationalTotal}</p>
        </div>
        <div className="min-w-36 flex-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-950">
          <p className="text-[11px] font-medium text-amber-700">Vencen hoy</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums">{deadlineGroups.today.length}</p>
        </div>
        <div className="min-w-36 flex-1 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sky-950">
          <p className="text-[11px] font-medium text-sky-700">Listos para enviar</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums">{statusGroups.ready.length}</p>
        </div>
        <div className="min-w-36 flex-1 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-950">
          <p className="text-[11px] font-medium text-emerald-700">Enviados</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums">{shippedTotal}</p>
        </div>
        {deadlineGroups.overdue.length > 0 && (
          <div className="min-w-36 flex-1 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-rose-950">
            <p className="text-[11px] font-medium text-rose-700">Vencidos</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums">{deadlineGroups.overdue.length}</p>
          </div>
        )}
      </section>

      {currentDeliveryWindow && data?.deliveryMetrics?.windows?.length ? (
        <details className="rounded-md border border-border bg-card px-3 py-2.5">
          <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <Timer className="size-3.5 text-primary" />
                <span className="text-xs font-semibold text-foreground">Métricas del turno actual</span>
                <span className="text-xs text-muted-foreground">
                  {formatTime(currentDeliveryWindow.from)} → {formatTime(currentDeliveryWindow.to)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="font-medium tabular-nums text-foreground">{currentDeliveryWindow.deliveries} entregas</span>
                <span className="text-muted-foreground">
                  Ciclo {currentDeliveryWindow.total.measured > 0 ? formatDuration(currentDeliveryWindow.total.averageMinutes) : 'sin datos'}
                </span>
                <span className="font-medium text-primary">Ver detalle</span>
              </div>
            </div>
          </summary>
          <div className="mt-3 border-t border-border pt-3">
            <div className="flex items-center justify-end gap-1.5 text-[11px] text-muted-foreground">
              <RefreshCw className="size-3" /> Actualización cada 15 min
            </div>
            <div className="mt-3 grid gap-x-10 gap-y-7 lg:grid-cols-2">
              {data.deliveryMetrics.windows.map((window) => <DeliveryShiftCard key={window.key} window={window} />)}
            </div>
          </div>
        </details>
      ) : null}

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
              <p className="text-sm font-semibold">{selectedLabelOrders.length} de {labelOrders.length} etiquetas seleccionadas</p>
              <p className="text-xs text-sky-800">Se colocarán 4 por hoja A4; las etiquetas adicionales pasarán a la siguiente hoja.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
                : selectedLabelOrders.length
                  ? `Imprimir ${selectedLabelOrders.length} en A4`
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

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {boardView === 'deadline' ? 'Pedidos por vencimiento' : 'Pedidos por estado'}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {boardView === 'deadline' ? 'Prioriza según la fecha límite de entrega.' : 'Organiza el trabajo según el avance en Falabella.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Agrupar columnas por</span>
          <div className="inline-flex rounded-md border border-border bg-background p-0.5" role="group" aria-label="Agrupar columnas por">
            <button
              type="button"
              onClick={() => setBoardView('deadline')}
              className={`rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${boardView === 'deadline' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
              aria-pressed={boardView === 'deadline'}
            >
              Cuándo vence
            </button>
            <button
              type="button"
              onClick={() => setBoardView('status')}
              className={`rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${boardView === 'status' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
              aria-pressed={boardView === 'status'}
            >
              Estado
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-md border border-border bg-card py-20 text-sm text-muted-foreground">
          <Loader2 className="size-5 animate-spin" /> Cargando pedidos pendientes…
        </div>
      ) : operationalTotal === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-border bg-card py-16 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-emerald-50 text-emerald-700">
            <CheckCircle2 className="size-6" />
          </span>
          <p className="text-sm font-medium text-foreground">No hay pedidos por atender</p>
          <p className="text-sm text-muted-foreground">Prueba con otra tienda o búsqueda.</p>
        </div>
      ) : (
        <div className="overflow-x-auto pb-2">
          <div className={`grid gap-3 ${visibleColumns.length >= 4 ? 'min-w-[1120px] grid-cols-4' : visibleColumns.length === 3 ? 'min-w-[840px] grid-cols-3' : 'min-w-[560px] grid-cols-2'}`}>
            {visibleColumns.map((column) => {
              const Icon = column.icon;
              const orders = ordersForColumn(column);
              const printableOrders = orders.filter(canPrintShippingLabel);
              const readyCandidates = orders.filter(canMarkReadyToShip);
              return (
                <section key={column.key} className="flex min-h-[400px] flex-col overflow-hidden rounded-md border border-border bg-card">
                  <header className={`border-b px-3 py-2.5 ${column.headerClass}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Icon className={`size-4 shrink-0 ${column.iconClass}`} />
                        <div className="min-w-0">
                          <h2 className="text-sm font-semibold text-current">{column.title}</h2>
                          <p className="truncate text-[11px] text-current opacity-80">{column.description}</p>
                        </div>
                      </div>
                      <span className={`rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums ${column.countClass}`}>
                        {orders.length}
                      </span>
                    </div>
                    {(printableOrders.length > 0 || (canDispatch && readyCandidates.length > 0)) && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {printableOrders.length > 0 && (
                          <button
                            type="button"
                            disabled={batchLabelsLoading}
                            onClick={() => void printShippingLabels(printableOrders, column.key)}
                            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/70 bg-white px-2.5 text-[11px] font-semibold text-slate-900 shadow-sm transition-colors hover:bg-white/80 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {printingColumn === column.key ? <Loader2 className="size-3 animate-spin" /> : <Printer className="size-3" />}
                            {printingColumn === column.key ? 'Preparando…' : `Imprimir etiquetas (${printableOrders.length})`}
                          </button>
                        )}
                        {canDispatch && readyCandidates.length > 0 && (
                          <button
                            type="button"
                            disabled={bulkReadyRunning}
                            onClick={() => setBulkReadySelection({ columnKey: column.key, columnTitle: column.title, orders: readyCandidates })}
                            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/70 bg-white px-2.5 text-[11px] font-semibold text-slate-900 shadow-sm transition-colors hover:bg-white/80 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <PackageCheck className="size-3" />
                            Todo listo para envío ({readyCandidates.length})
                          </button>
                        )}
                      </div>
                    )}
                  </header>
                  <div className="max-h-[calc(100vh-16rem)] min-h-[340px] flex-1 divide-y divide-border overflow-y-auto">
                    {orders.map((order) => (
                      <OrderCard
                        key={order.id}
                        order={order}
                        now={now}
                        onOpen={() => openOrder(order)}
                        onViewLabel={() => void viewShippingLabel(order)}
                        onToggleLabel={() => toggleLabelSelection(order)}
                        labelLoading={labelLoadingKey === `${order.companyId}:${order.orderId}`}
                        labelSelectionMode={labelSelectionMode}
                        labelSelected={selectedLabelKeys.has(orderKey(order))}
                        canDispatch={canDispatch}
                      />
                    ))}
                    {orders.length === 0 && (
                      <div className="flex h-36 items-center justify-center px-4 text-center text-xs text-muted-foreground">
                        {column.empty}
                      </div>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}

      <Dialog open={Boolean(bulkReadySelection)} onOpenChange={(open) => !open && !bulkReadyRunning && setBulkReadySelection(null)}>
        <DialogContent className="sm:max-w-md" showCloseButton={!bulkReadyRunning}>
          <DialogHeader>
            <DialogTitle>Marcar todos como listos para envío</DialogTitle>
            <DialogDescription>
              {bulkReadySelection
                ? `${bulkReadySelection.orders.filter(canMarkReadyToShip).length} pedidos de la columna “${bulkReadySelection.columnTitle}”.`
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
              {bulkReadyRunning ? 'Actualizando pedidos…' : 'Confirmar todos'}
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
                  <Button
                    onClick={() => void viewShippingLabel(selectedOrder)}
                    disabled={labelLoadingKey === `${selectedOrder.companyId}:${selectedOrder.orderId}`}
                  >
                    {labelLoadingKey === `${selectedOrder.companyId}:${selectedOrder.orderId}` ? <Loader2 className="animate-spin" /> : <Printer />}
                    Ver etiqueta
                  </Button>
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
