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
type BoardColumnKey = UrgencyKey | 'shipped';

const LIMA_TIME_ZONE = 'America/Lima';
const BOARD_LIMIT = 500;

const COLUMNS: Array<{
  key: BoardColumnKey;
  title: string;
  description: string;
  icon: typeof AlertCircle;
  headerClass: string;
  countClass: string;
  empty: string;
}> = [
  {
    key: 'overdue',
    title: 'Vencidos',
    description: 'Debieron entregarse antes',
    icon: AlertCircle,
    headerClass: 'border-red-200 bg-red-50/80 text-red-800',
    countClass: 'bg-red-100 text-red-700',
    empty: 'No tienes pedidos vencidos.',
  },
  {
    key: 'today',
    title: 'Vencen hoy',
    description: 'Prioridad del día',
    icon: Clock3,
    headerClass: 'border-amber-200 bg-amber-50/80 text-amber-800',
    countClass: 'bg-amber-100 text-amber-700',
    empty: 'Nada más vence hoy.',
  },
  {
    key: 'tomorrow',
    title: 'Vencen mañana',
    description: 'Prepara con anticipación',
    icon: CalendarClock,
    headerClass: 'border-sky-200 bg-sky-50/80 text-sky-800',
    countClass: 'bg-sky-100 text-sky-700',
    empty: 'No hay entregas para mañana.',
  },
  {
    key: 'later',
    title: 'Próximos',
    description: 'Después de mañana',
    icon: Truck,
    headerClass: 'border-border bg-muted/40 text-foreground',
    countClass: 'bg-muted text-muted-foreground',
    empty: 'No hay pedidos posteriores.',
  },
  {
    key: 'shipped',
    title: 'Enviados',
    description: 'Ya entregados a Falabella',
    icon: CheckCircle2,
    headerClass: 'border-emerald-200 bg-emerald-50/80 text-emerald-800',
    countClass: 'bg-emerald-100 text-emerald-700',
    empty: 'No hay pedidos enviados.',
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
  if (state === 'active') return { label: 'En curso', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' };
  if (state === 'completed') return { label: 'Cerrado', className: 'border-border bg-muted text-muted-foreground' };
  return { label: 'Próximo', className: 'border-sky-200 bg-sky-50 text-sky-700' };
}

function DeliveryShiftCard({ window }: { window: DeliveryWindow }) {
  const isEvening = window.key === 'evening_to_noon';
  const Icon = isEvening ? Moon : SunMedium;
  const state = shiftStateMeta(window.state);
  const durations = [
    { label: 'Preparación', detail: 'Pendiente → listo', metric: window.preparation },
    { label: 'En espera', detail: 'Listo → enviado', metric: window.handoff },
    { label: 'Ciclo total', detail: 'Pendiente → enviado', metric: window.total },
  ];
  return (
    <article className="overflow-hidden rounded-md border border-border bg-card">
      <div className={`h-1 ${isEvening ? 'bg-indigo-500' : 'bg-amber-500'}`} />
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className={`grid size-9 shrink-0 place-items-center rounded-md ${isEvening ? 'bg-indigo-50 text-indigo-700' : 'bg-amber-50 text-amber-700'}`}>
              <Icon className="size-4" />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground">
                {isEvening ? 'Turno 5 p. m. → 12 m.' : 'Turno 12 m. → 5 p. m.'}
              </h3>
              <p className="mt-0.5 text-xs capitalize text-muted-foreground">
                {formatShiftBoundary(window.from)} → {formatShiftBoundary(window.to)}
              </p>
            </div>
          </div>
          <Badge variant="outline" className={`rounded-md ${state.className}`}>{state.label}</Badge>
        </div>

        <div className="mt-4 flex items-end gap-2 border-b border-border pb-4">
          <strong className="text-3xl font-semibold tabular-nums text-foreground">{window.deliveries}</strong>
          <span className="pb-1 text-sm text-muted-foreground">entrega{window.deliveries === 1 ? '' : 's'} a Falabella</span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {durations.map(({ label, detail, metric }) => (
            <div key={label} className="rounded-md bg-muted/35 px-2.5 py-2.5">
              <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
              <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">{formatDuration(metric.averageMinutes)}</p>
              <p className="mt-0.5 text-[10px] font-medium text-muted-foreground">Promedio</p>
              <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{detail}</p>
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                {metric.measured > 0
                  ? `${metric.measured} medido${metric.measured === 1 ? '' : 's'} · ${formatDuration(metric.minMinutes)}–${formatDuration(metric.maxMinutes)}`
                  : 'Aún sin datos'}
              </p>
            </div>
          ))}
        </div>
      </div>
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

function statusMeta(status: string, shippingType = '') {
  const key = status.toLowerCase();
  if (key.includes('shipped')) {
    return {
      label: 'Enviado',
      className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    };
  }
  if (key.includes('ready_to_ship')) {
    return {
      label: 'Listo para entregar',
      className: 'border-sky-200 bg-sky-50 text-sky-700',
    };
  }
  if (shippingType.toLowerCase().includes('fulfillment')) {
    return {
      label: 'Gestión Falabella',
      className: 'border-violet-200 bg-violet-50 text-violet-700',
    };
  }
  return {
    label: 'Por preparar',
    className: 'border-amber-200 bg-amber-50 text-amber-700',
  };
}

function hasShippingLabel(order: InboxOrder) {
  return /(^|\|)(ready_to_ship|shipped)(\||$)/.test(order.falabellaStatus.toLowerCase());
}

function isShippedOrder(order: InboxOrder) {
  return /(^|\|)shipped(\||$)/.test(order.falabellaStatus.toLowerCase());
}

function isFulfillmentOrder(order: InboxOrder) {
  return order.shippingType.toLowerCase().includes('fulfillment');
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
  const shipped = isShippedOrder(order);
  const status = statusMeta(order.falabellaStatus, order.shippingType);
  const deadlineTone = shipped
    ? 'text-emerald-700'
    : urgency === 'overdue'
    ? 'text-red-700'
    : urgency === 'today'
      ? 'text-amber-700'
      : 'text-foreground';

  return (
    <article className={`rounded-md border bg-card p-3.5 transition-colors ${labelSelected ? 'border-primary ring-1 ring-primary/20' : 'border-border hover:border-foreground/20'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          {labelSelectionMode && hasShippingLabel(order) && (
            <Checkbox
              checked={labelSelected}
              onCheckedChange={onToggleLabel}
              aria-label={`Seleccionar etiqueta del pedido ${order.orderNumber}`}
              className="mt-0.5"
            />
          )}
          <div className="min-w-0">
            <p className={`flex items-center gap-1.5 text-sm font-semibold ${deadlineTone}`}>
              {shipped
                ? <CheckCircle2 className="size-4 shrink-0" />
                : urgency === 'overdue' && <AlertCircle className="size-4 shrink-0" />}
              {shipped ? 'Enviado a Falabella' : deadlineLabel(order, now)}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {shipped ? `Actualizado ${formatDateTime(order.updatedAt)}` : 'Límite de entrega al operador'}
            </p>
          </div>
        </div>
        <Badge variant="outline" className={`rounded-md ${status.className}`}>{status.label}</Badge>
      </div>

      <div className="mt-3 border-t border-border/70 pt-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <button type="button" onClick={onOpen} className="font-mono text-sm font-semibold text-foreground hover:underline">
              {order.orderNumber}
            </button>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{order.companyName}</p>
          </div>
          <p className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{formatMoney(order.total, order.currency)}</p>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className="text-muted-foreground">Ingresó</p>
            <p className="mt-0.5 font-medium text-foreground">{elapsedLabel(order.createdAt, now)}</p>
            <p className="text-[11px] text-muted-foreground">{formatDateTime(order.createdAt)}</p>
          </div>
          <div className="text-right">
            <p className="text-muted-foreground">Contenido</p>
            <p className="mt-0.5 font-medium text-foreground">
              {order.itemsCount ?? '-'} producto{order.itemsCount === 1 ? '' : 's'}
            </p>
            <p className="text-[11px] text-muted-foreground">{order.invoiceRequired ? 'Factura' : 'Boleta'}</p>
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={hasShippingLabel(order) ? onViewLabel : onOpen}
          disabled={labelLoading || (!hasShippingLabel(order) && !canDispatch)}
          title={hasShippingLabel(order) ? 'Ver etiqueta de envío' : !canDispatch ? 'Tu perfil es de solo lectura' : isFulfillmentOrder(order) ? 'Revisar el flujo gestionado por Falabella' : 'Revisar y preparar el pedido'}
        >
          {labelLoading ? <Loader2 className="animate-spin" /> : hasShippingLabel(order) ? <Printer /> : <PackageCheck />}
          {hasShippingLabel(order) ? 'Etiqueta' : !canDispatch ? 'Solo lectura' : isFulfillmentOrder(order) ? 'Ver flujo' : 'Preparar'}
        </Button>
        <Button variant="ghost" size="sm" className="justify-between" onClick={onOpen}>
          Ver pedido <ArrowRight />
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

  const grouped = useMemo(() => {
    const groups: Record<BoardColumnKey, InboxOrder[]> = { overdue: [], today: [], tomorrow: [], later: [], shipped: [] };
    for (const order of data?.orders || []) {
      groups[isShippedOrder(order) ? 'shipped' : urgencyFor(order, now)].push(order);
    }
    for (const [key, orders] of Object.entries(groups) as Array<[BoardColumnKey, InboxOrder[]]>) {
      orders.sort((a, b) => {
        if (key === 'shipped') {
          const updatedA = parseDate(a.updatedAt)?.getTime() ?? 0;
          const updatedB = parseDate(b.updatedAt)?.getTime() ?? 0;
          return updatedB - updatedA;
        }
        const deadlineA = parseDate(a.promisedShippingAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const deadlineB = parseDate(b.promisedShippingAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        return deadlineA - deadlineB || String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
      });
    }
    return groups;
  }, [data?.orders, now]);

  const labelOrders = useMemo(
    () => (data?.orders || []).filter(hasShippingLabel),
    [data?.orders],
  );
  const selectedLabelOrders = useMemo(
    () => labelOrders.filter((order) => selectedLabelKeys.has(orderKey(order))),
    [labelOrders, selectedLabelKeys],
  );
  const allLabelsSelected = labelOrders.length > 0 && selectedLabelOrders.length === labelOrders.length;

  const total = data?.totalCount || 0;
  const selectedUrgency = selectedOrder ? urgencyFor(selectedOrder, now) : null;
  const selectedShipped = selectedOrder ? isShippedOrder(selectedOrder) : false;
  const selectedStatus = selectedOrder ? statusMeta(selectedOrder.falabellaStatus, selectedOrder.shippingType) : null;
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
    if (!canDispatch || hasShippingLabel(order) || isFulfillmentOrder(order)) return;
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

  const viewShippingLabel = async (order: InboxOrder) => {
    if (!hasShippingLabel(order)) return;
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

  const printSelectedShippingLabels = async () => {
    if (!selectedLabelOrders.length || batchLabelsLoading) return;
    const previewWindow = window.open('', '_blank');
    if (previewWindow) {
      previewWindow.opener = null;
      renderShippingLabelsLoading(previewWindow, selectedLabelOrders.length);
    }
    setBatchLabelsLoading(true);
    setError('');
    try {
      const result = await api.falabellaApiGetShippingLabelsA4(selectedLabelOrders.map((order) => ({
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
    }
  };

  return (
    <div className="space-y-4">
      <section className="flex flex-col gap-4 rounded-md border border-border bg-card px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
            <Inbox className="size-5" />
          </span>
          <div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <p className="text-2xl font-semibold tabular-nums text-foreground">{total}</p>
              <p className="text-sm font-medium text-foreground">pedidos en operación</p>
            </div>
            <p className="text-sm text-muted-foreground">Pendientes, listos para enviar y enviados por Falabella.</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          {grouped.overdue.length > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 font-medium text-red-700">
              <AlertCircle className="size-4" /> {grouped.overdue.length} vencido{grouped.overdue.length === 1 ? '' : 's'}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 font-medium text-amber-700">
            <Clock3 className="size-4" /> {grouped.today.length} vence{grouped.today.length === 1 ? '' : 'n'} hoy
          </span>
          {grouped.shipped.length > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 font-medium text-emerald-700">
              <CheckCircle2 className="size-4" /> {grouped.shipped.length} enviado{grouped.shipped.length === 1 ? '' : 's'}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {data?.lastSyncedAt ? `Actualizado ${formatDateTime(data.lastSyncedAt)}` : 'Sin sincronización registrada'}
          </span>
        </div>
      </section>

      {data?.deliveryMetrics?.windows?.length ? (
        <section className="rounded-md border border-border bg-muted/15 p-4">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Timer className="size-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">Entregas por turno</h2>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Se cuenta una entrega cuando el pedido pasa a enviado. Los tiempos se guardan desde pendiente hasta su entrega a Falabella.
              </p>
            </div>
            <span className="inline-flex w-fit items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground">
              <RefreshCw className="size-3" /> Actualización cada 15 min
            </span>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {data.deliveryMetrics.windows.map((window) => <DeliveryShiftCard key={window.key} window={window} />)}
          </div>
        </section>
      ) : null}

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={companyId} onValueChange={setCompanyId}>
            <SelectTrigger className="w-full border-border bg-background sm:w-[230px]">
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
            onClick={() => {
              setLabelSelectionMode((current) => !current);
              setSelectedLabelKeys(new Set());
            }}
            disabled={labelOrders.length === 0 || batchLabelsLoading}
          >
            <Printer />
            {labelSelectionMode ? 'Cancelar selección' : 'Imprimir etiquetas'}
          </Button>
          <Button onClick={() => void syncAll()} disabled={refreshing || batchLabelsLoading}>
            {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Sincronizar pedidos
          </Button>
        </div>
      </div>

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
            <Button type="button" size="sm" onClick={() => void printSelectedShippingLabels()} disabled={!selectedLabelOrders.length || batchLabelsLoading}>
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

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-md border border-border bg-card py-20 text-sm text-muted-foreground">
          <Loader2 className="size-5 animate-spin" /> Cargando pedidos pendientes…
        </div>
      ) : total === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-border bg-card py-16 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-emerald-50 text-emerald-700">
            <CheckCircle2 className="size-6" />
          </span>
          <p className="text-sm font-medium text-foreground">No hay pedidos con los filtros actuales</p>
          <p className="text-sm text-muted-foreground">Sin pendientes, listos para enviar ni enviados.</p>
        </div>
      ) : (
        <div className="overflow-x-auto pb-2">
          <div className="grid min-w-[1400px] grid-cols-5 gap-3">
            {COLUMNS.map((column) => {
              const Icon = column.icon;
              const orders = grouped[column.key];
              return (
                <section key={column.key} className="flex min-h-[420px] flex-col rounded-md border border-border bg-muted/15">
                  <header className={`flex items-center justify-between gap-3 rounded-t-md border-b px-3.5 py-3 ${column.headerClass}`}>
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Icon className="size-4 shrink-0" />
                      <div className="min-w-0">
                        <h2 className="text-sm font-semibold">{column.title}</h2>
                        <p className="truncate text-[11px] opacity-75">{column.description}</p>
                      </div>
                    </div>
                    <span className={`grid min-w-7 place-items-center rounded-md px-1.5 py-1 text-xs font-semibold tabular-nums ${column.countClass}`}>
                      {orders.length}
                    </span>
                  </header>
                  <div className="max-h-[calc(100vh-21rem)] min-h-[340px] flex-1 space-y-2.5 overflow-y-auto p-2.5">
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

      <Dialog open={Boolean(selectedOrder)} onOpenChange={(open) => !open && !readyLoadingKey && closeOrder()}>
        <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg" showCloseButton={!readyLoadingKey}>
          {selectedOrder && selectedUrgency && selectedStatus && (
            confirmReady ? (
              <>
                <DialogHeader>
                  <DialogTitle>Confirmar pedido preparado</DialogTitle>
                  <DialogDescription>Pedido {selectedOrder.orderNumber} · {selectedOrder.companyName}</DialogDescription>
                </DialogHeader>

                <div className="flex gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-amber-900">
                  <PackageCheck className="mt-0.5 size-5 shrink-0" />
                  <div>
                    <p className="font-semibold">Confirma que todo el pedido está empacado</p>
                    <p className="mt-1 text-sm text-amber-800">
                      Falabella cambiará a listo para envío todos los productos asociados a esta orden. Esta acción no debe hacerse si falta algún producto por preparar.
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
                    {isFulfillmentOrder(selectedOrder) ? 'Gestión automática' : hasShippingLabel(selectedOrder) ? '3 de 3' : '1 de 3'}
                  </span>
                </div>
                {isFulfillmentOrder(selectedOrder) ? (
                  <div className="mt-3 rounded-md border border-violet-200 bg-violet-50 px-3 py-2.5 text-sm text-violet-800">
                    No requiere preparación manual en esta bandeja.
                  </div>
                ) : (
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                    <div className={`rounded-md border px-2 py-2 ${hasShippingLabel(selectedOrder) ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                      <span className="font-semibold">1</span><p className="mt-0.5">Empacar</p>
                    </div>
                    <div className={`rounded-md border px-2 py-2 ${hasShippingLabel(selectedOrder) ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-border bg-muted/30 text-muted-foreground'}`}>
                      <span className="font-semibold">2</span><p className="mt-0.5">Marcar listo</p>
                    </div>
                    <div className={`rounded-md border px-2 py-2 ${hasShippingLabel(selectedOrder) ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-border bg-muted/30 text-muted-foreground'}`}>
                      <span className="font-semibold">3</span><p className="mt-0.5">Etiqueta</p>
                    </div>
                  </div>
                )}
                <p className="mt-3 text-sm text-muted-foreground">
                  {isFulfillmentOrder(selectedOrder)
                    ? 'Este pedido es Fulfillment: Falabella gestiona su inventario y despacho, por lo que no debes marcarlo manualmente.'
                    : selectedShipped
                      ? 'El pedido ya fue enviado a Falabella. Puedes volver a abrir e imprimir su etiqueta cuando la necesites.'
                    : !canDispatch
                      ? 'Tu perfil es de solo lectura. Puedes revisar el pedido y abrir su etiqueta cuando Falabella lo marque como listo.'
                    : hasShippingLabel(selectedOrder)
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
                {hasShippingLabel(selectedOrder) ? (
                  <Button
                    onClick={() => void viewShippingLabel(selectedOrder)}
                    disabled={labelLoadingKey === `${selectedOrder.companyId}:${selectedOrder.orderId}`}
                  >
                    {labelLoadingKey === `${selectedOrder.companyId}:${selectedOrder.orderId}` ? <Loader2 className="animate-spin" /> : <Printer />}
                    Ver etiqueta
                  </Button>
                ) : !isFulfillmentOrder(selectedOrder) && canDispatch ? (
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
