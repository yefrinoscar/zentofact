import { OrderDateDialog, orderDateKey, formatRegistrationDate } from '../components/OrderDateDialog';
import OrderDocumentPanel from '../components/OrderDocumentPanel';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ColumnDef, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import {
  AlertCircle,
  Banknote,
  Building2,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Copy,
  Eye,
  FileText,
  Hash,
  IdCard,
  ImagePlus,
  LayoutList,
  Loader2,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Package,
  PackageCheck,
  Pencil,
  Phone,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  Signpost,
  StickyNote,
  Store,
  Truck,
  UserRound,
  Wallet,
  X,
} from 'lucide-react';
import { ChannelMark } from '../components/channel-mark';
import {
  ActivityTimeline,
  AmountSummary,
  DetailSkeleton,
  DRAWER_TAB_CLASS,
  EmptyValue,
  InlineNumber,
  InlineSelectProperty,
  InlineTextProperty,
  MetricStrip,
  PropertyRow,
  PropertySection,
  TabCount,
  type AmountLine,
  type StatusTone,
  type TimelineGroup,
} from '../components/order-detail/OrderDetailParts';
import { BuyerConversation } from '../components/buyer-messages/BuyerConversation';
import { QuantityTag } from '../components/QuantityTag';
import api from '../lib/api';
import { cn } from '../lib/cn';
import { usePermissions } from '../hooks/usePermissions';
import { SHIPPING_CARRIERS } from '../lib/shipping-carrier';
import {
  canMarkLogisticsDelivered,
  logisticsDeliverConfirmCopy,
  logisticsDeliverSuccessCopy,
  mercadoLibreDispatchCopy,
  sellerDispatchesMercadoLibre,
} from '../lib/logistics-inbox';
import {
  buildManualOrderEditPayload,
  MANUAL_EDIT_DOCUMENT_TYPES,
  validateManualOrderEdit,
  type ManualOrderEditDraft,
} from '../lib/manual-order-edit';
import {
  buildManagedOrderListFilters,
  managedOrderListRows,
  deliveryLabel,
  deliveryShowsAsTag,
  managedOrderSearchIgnoresDate,
  managedOrdersDateAfterDayChange,
  managedOrdersEmptyHint,
  managedOrdersEmptyTitle,
  managedOrdersSearchHelper,
  managedOrdersTableLabel,
  sellerCellLabel,
  sellerCellShowsPerson,
  MANAGED_ORDER_TABLE_COLUMNS,
} from '../lib/managed-orders-presentation';
import { registeredFromMisVentasState, saleSavedSnackbarMessage } from '../lib/sale-feedback';
import { todayInLima } from '../lib/documentDateRange';
import DayStrip from '../components/DayStrip';
import { OrdersVirtualTable } from '../components/OrdersVirtualTable';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';

type Company = {
  id: number;
  nombre?: string | null;
  nombreComercial?: string | null;
  razonSocial?: string | null;
  hasRipleySvcCredentials?: boolean;
};

type Channel = {
  id: number;
  code: string;
  name: string;
  active: boolean;
  defaultAutoCreateOrders?: boolean;
};

type ChannelAccount = {
  id: number;
  companyId: number;
  channelCode: string;
  channelName: string;
  displayName: string;
  autoCreateOrders: boolean;
  documentRequirement: 'disabled' | 'optional' | 'required';
  documentTypePolicy: 'automatic' | 'boleta' | 'factura' | 'customer_choice';
  active: boolean;
};

type OrderItem = {
  id: number;
  sku?: string | null;
  description: string;
  productName?: string | null;
  imageUrl?: string | null;
  shopSku?: string | null;
  quantity: number;
  unitPrice?: number | null;
  total?: number | null;
  commissionAmount?: number | null;
};

type ManagedOrderListItem = {
  name?: string | null;
  sku?: string | null;
  quantity?: number;
  imageUrl?: string | null;
  shopSku?: string | null;
};

type EventValues = {
  orderedAt?: string;
  customer?: Record<string, unknown>;
  shipping?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

type OrderEvent = {
  id: number;
  eventType: string;
  source: string;
  actorName?: string | null;
  actorUserId?: string | null;
  payload?: { orderDate?: string; reason?: string };
  previousValues?: EventValues;
  newValues?: EventValues;
  providerOccurredAt?: string | null;
  createdAt: string;
};

type ManagedOrder = {
  id: number;
  companyId: number | null;
  channelAccountId: number;
  channelCode: string;
  channelName: string;
  channelAccountName: string;
  externalOrderId: string;
  externalOrderNumber: string;
  orderStatus: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  documentStatus: string;
  providerStatus?: string | null;
  documentRequirement: ChannelAccount['documentRequirement'];
  documentTypePolicy: ChannelAccount['documentTypePolicy'];
  requestedDocumentType?: 'boleta' | 'factura' | null;
  documentDecision: {
    enabled: boolean;
    required: boolean;
    type: 'boleta' | 'factura' | null;
    needsCustomerChoice: boolean;
  };
  currency: string;
  subtotal?: number | null;
  shippingAmount?: number | null;
  total?: number | null;
  customer?: {
    name?: string;
    documentNumber?: string;
    documentType?: string;
    phone?: string;
    legalName?: string;
    address?: string;
  };
  shipping?: {
    type?: string;
    carrier?: string;
    trackingCode?: string;
    address?: string;
    district?: string;
    city?: string;
    region?: string;
    province?: string;
    department?: string;
    reference?: string;
    lat?: number;
    lng?: number;
    districtAmount?: number;
    distanceAmount?: number;
    distanceKm?: number;
    zoneKind?: string;
    zoneLabel?: string;
    priceZone?: string;
  };
  createdBy?: string | null;
  createdByName?: string | null;
  createdByRole?: string | null;
  metadata?: {
    paymentMethod?: string;
    saleSource?: string;
    delivery?: string;
    deliveryDate?: string;
    shippingCarrier?: string;
    shippingId?: string;
    shippingMode?: string;
    logisticType?: string;
    shippingSubstatus?: string;
    receivedBy?: string;
    paidTo?: string;
    paymentProof?: { name?: string; type?: string; dataUrl?: string; hasData?: boolean } | null;
    ripleySvc?: {
      orderId?: string;
      statusManagement?: string;
      orderState?: string;
      packages?: number | null;
      shippingDeadline?: string;
      syncedAt?: string;
    };
  };
  items?: ManagedOrderListItem[];
  orderedAt?: string | null;
  createdAt?: string | null;
  promisedShippingAt?: string | null;
  providerUpdatedAt?: string | null;
};

type OrderDetail = Omit<ManagedOrder, 'items'> & {
  items: OrderItem[];
  events: OrderEvent[];
  documents: Array<{
    id: number;
    kind: string;
    number?: string | null;
    status?: string | null;
  }>;
};

type RipleyLogisticsOverview = {
  labels: number | null;
  manifests: number | null;
  eligibleLabels: number | null;
  labelId: string;
  manifestId: string;
  packages: number | null;
  sandbox: boolean;
  error: string;
};

const SEARCH_DELAY_MS = 250;

const PAYMENT_LABELS: Record<string, string> = {
  unknown: 'Sin dato',
  pending: 'Pendiente de pago',
  paid: 'Pagado',
  partially_refunded: 'Reembolso parcial',
  refunded: 'Reembolsado',
  failed: 'Fallido',
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  despues: 'Después',
  efectivo: 'Efectivo',
  yape_plin: 'Yape / Plin',
  transferencia: 'Transferencia',
};

const RECORD_PAYMENT_METHODS = [
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'yape_plin', label: 'Yape / Plin' },
  { value: 'transferencia', label: 'Transferencia' },
] as const;

const SALE_SOURCE_LABELS: Record<string, string> = {
  marketplace: 'Marketplace',
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  telefono: 'Teléfono',
  otro: 'Otro',
};

const FALLBACK_CHANNELS: Channel[] = [
  { id: -1, code: 'falabella', name: 'Falabella', active: true, defaultAutoCreateOrders: true },
  { id: -2, code: 'mercado_libre', name: 'Mercado Libre', active: true, defaultAutoCreateOrders: true },
  { id: -3, code: 'ripley', name: 'Ripley', active: true, defaultAutoCreateOrders: true },
  { id: -4, code: 'manual', name: 'Tienda', active: true, defaultAutoCreateOrders: false },
];

const FULFILLMENT_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  preparing: 'Preparando',
  ready_to_ship: 'Listo para enviar',
  shipped: 'Enviado',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
  returned: 'Devuelto',
  failed: 'Con error',
};

const DOCUMENT_LABELS: Record<string, string> = {
  not_requested: 'Sin solicitar',
  pending: 'Por emitir',
  issued: 'Emitido',
  accepted: 'Aceptado',
  rejected: 'Rechazado',
  cancelled: 'Anulado',
};

const EVENT_LABELS: Record<string, string> = {
  'order.date_changed': 'Fecha de registro cambiada',
  'order.created': 'Pedido creado',
  'order.updated': 'Pedido actualizado',
  'order.stale_observed': 'Actualización recibida',
  'order.payment_recorded': 'Pago registrado',
};

const SOURCE_LABELS: Record<string, string> = {
  api: 'API',
  webhook: 'Webhook',
  sync: 'Sincronización',
  manual: 'Registro manual',
  user: 'Usuario',
  system: 'Sistema',
};

function titleCaseSeller(value: string) {
  return value
    .toLocaleLowerCase('es')
    .replace(/(^|[\s/-])(\S)/g, (_, sep, char) => sep + char.toLocaleUpperCase('es'));
}

function companyName(company: Company) {
  const candidates = [company.nombreComercial, company.nombre, company.razonSocial]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .map((value) => value
      .replace(/^(?:importaciones|inversiones|tiendas|la tienda del)\s+/i, '')
      .replace(/\s+(?:per[uú]|e\.?i\.?r\.?l\.?|s\.?r\.?l\.?|s\.?a\.?c\.?)$/i, '')
      .trim());
  const name = candidates.sort((left, right) => left.length - right.length)[0];
  return name ? titleCaseSeller(name) : `Empresa ${company.id}`;
}

function formatMoney(value: number | null | undefined, currency = 'PEN') {
  try {
    return new Intl.NumberFormat('es-PE', { style: 'currency', currency }).format(Number(value || 0));
  } catch {
    return `S/ ${Number(value || 0).toFixed(2)}`;
  }
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-PE', {
    timeZone: 'America/Lima',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatTime(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-PE', {
    timeZone: 'America/Lima',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function svcResultCount(value: unknown, collectionKey: string) {
  const root = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const nested = root.data && typeof root.data === 'object' ? root.data as Record<string, unknown> : root;
  const total = Number(nested.total ?? nested.total_count);
  if (Number.isFinite(total)) return total;
  return Array.isArray(nested[collectionKey]) ? nested[collectionKey].length : null;
}

function svcResultData(value: unknown) {
  const root = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return root.data && typeof root.data === 'object' ? root.data as Record<string, unknown> : root;
}

function svcResultItems(value: unknown, collectionKey: string) {
  const items = svcResultData(value)[collectionKey];
  return Array.isArray(items) ? items as Array<Record<string, unknown>> : [];
}

function svcResultIsSandbox(value: unknown) {
  return svcResultData(value).sandbox === true;
}

function downloadPdf(base64: unknown, filename: string) {
  if (typeof base64 !== 'string' || !base64.trim()) throw new Error('Ripley no devolvió el PDF esperado.');
  const link = document.createElement('a');
  link.href = `data:application/pdf;base64,${base64}`;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function svcPdf(value: unknown, keys: string[]): string | null {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  for (const key of keys) if (typeof record[key] === 'string') return record[key];
  return record.data === value ? null : svcPdf(record.data, keys);
}

function hoursAgo(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function fulfillmentBadge(status: string) {
  const classes = status === 'delivered'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
    : status === 'ready_to_ship' || status === 'shipped'
      ? 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300'
      : status === 'cancelled' || status === 'returned' || status === 'failed'
        ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300'
        : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300';
  return <Badge variant="outline" className={cn('rounded-md', classes)}>{FULFILLMENT_LABELS[status] || status}</Badge>;
}

function documentTypeLabel(order: ManagedOrder) {
  if (order.documentDecision?.type === 'factura') return 'Factura';
  if (order.documentDecision?.type === 'boleta') return 'Boleta';
  return '';
}

function paymentBadge(status: string) {
  if (status === 'unknown' || !status) return null;
  const classes = status === 'paid'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
    : status === 'refunded' || status === 'failed' || status === 'partially_refunded'
      ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300'
      : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300';
  return <Badge variant="outline" className={cn('rounded-md', classes)}>{PAYMENT_LABELS[status] || status}</Badge>;
}

function canRecordPayment(order: ManagedOrder) {
  if (order.channelCode !== 'manual') return false;
  return order.paymentStatus === 'pending' || order.paymentStatus === 'failed';
}

function originLabel(order: ManagedOrder) {
  if (order.channelCode === 'manual') {
    return SALE_SOURCE_LABELS[order.metadata?.saleSource || ''] || 'Tienda';
  }
  return order.channelName;
}

function deliveryBadge(order: ManagedOrder) {
  const label = deliveryLabel(order);
  if (!deliveryShowsAsTag(label)) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <Badge variant="outline" className="max-w-full truncate rounded-md bg-muted/45 px-2 py-0.5 font-medium text-foreground" title={label}>
      {label}
    </Badge>
  );
}

function shippingAddress(shipping?: ManagedOrder['shipping']) {
  if (!shipping) return '';
  const raw = (shipping as { address?: unknown }).address;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (text && text !== '[object Object]') return text;
  }
  if (raw && typeof raw === 'object') {
    const row = raw as Record<string, unknown>;
    const parts = [
      row.Address1, row.address1, row.address, row.line1,
      row.Address2, row.address2, row.line2,
      row.City, row.city, row.district, row.District,
    ].map((value) => String(value || '').trim()).filter(Boolean);
    if (parts.length) return [...new Set(parts)].join(', ');
  }
  const district = String(shipping.district || '').trim();
  if (district) return district;
  if (typeof shipping.lat === 'number' && typeof shipping.lng === 'number') {
    return `${shipping.lat.toFixed(5)}, ${shipping.lng.toFixed(5)}`;
  }
  return String(shipping.trackingCode || '').trim();
}

function addressText(order: ManagedOrder) {
  return shippingAddress(order.shipping) || '—';
}

const LIMA_TIME_ZONE = 'America/Lima';

function formatEstimatedDelivery(value?: string | null) {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin fecha';
  const label = new Intl.DateTimeFormat('es-PE', {
    timeZone: LIMA_TIME_ZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function paymentMethodLabel(order: ManagedOrder) {
  const method = String(order.metadata?.paymentMethod || '').trim();
  return PAYMENT_METHOD_LABELS[method] || '—';
}

function fulfillmentTone(status: string): StatusTone {
  if (status === 'delivered') return 'success';
  if (status === 'ready_to_ship' || status === 'shipped') return 'info';
  if (status === 'cancelled' || status === 'returned' || status === 'failed') return 'danger';
  return 'warning';
}

function paymentTone(status: string): StatusTone {
  if (status === 'paid') return 'success';
  if (status === 'refunded' || status === 'failed' || status === 'partially_refunded') return 'danger';
  if (status === 'pending') return 'warning';
  return 'neutral';
}

function documentStatusLabel(order: ManagedOrder) {
  if (order.documentRequirement === 'disabled') return 'No aplica';
  return DOCUMENT_LABELS[order.documentStatus] || order.documentStatus;
}

function documentStatusTone(order: ManagedOrder): StatusTone {
  if (order.documentRequirement === 'disabled') return 'neutral';
  const status = order.documentStatus;
  if (status === 'accepted') return 'success';
  if (status === 'issued') return 'info';
  if (status === 'rejected' || status === 'cancelled') return 'danger';
  if (status === 'pending') return 'warning';
  return 'neutral';
}

function unitCountLabel(items: OrderItem[]) {
  const units = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  return `${units} ${units === 1 ? 'unidad' : 'unidades'}`;
}

function customerDocumentLabel(customer?: ManagedOrder['customer']) {
  const number = String(customer?.documentNumber || '').trim();
  if (!number) return '';
  const type = MANUAL_EDIT_DOCUMENT_TYPES.find((option) => option.value === customer?.documentType)?.label
    || (number.length === 11 ? 'RUC' : number.length === 8 ? 'DNI' : '');
  return [type, number].filter(Boolean).join(' ');
}

function shippingLocality(shipping?: ManagedOrder['shipping']) {
  return [shipping?.district || shipping?.city, shipping?.region].filter(Boolean).join(' · ');
}

function hasShippingDetails(order: ManagedOrder) {
  const shipping = order.shipping;
  return Boolean(
    (shipping?.type && shipping.type !== 'recojo' && shippingAddress(shipping))
      || shipping?.trackingCode
      || Number(order.shippingAmount) > 0,
  );
}

function shippingZoneLabel(shipping?: ManagedOrder['shipping']) {
  return [
    shipping?.priceZone ? `Zona ${shipping.priceZone}` : 'Envío propio',
    shipping?.zoneLabel,
    shipping?.distanceKm != null ? `${Number(shipping.distanceKm).toFixed(1).replace('.', ',')} km` : '',
  ].filter(Boolean).join(' · ');
}

function orderAmountLines(order: OrderDetail): AmountLine[] {
  const shipping = Number(order.shippingAmount) || 0;
  const itemsTotal = order.items.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
  const subtotal = order.subtotal != null ? Number(order.subtotal) : itemsTotal || Number(order.total || 0) - shipping;
  const lines: AmountLine[] = [{ label: 'Subtotal', value: formatMoney(subtotal, order.currency) }];
  if (shipping > 0) lines.push({ label: 'Envío', value: formatMoney(shipping, order.currency) });
  return lines;
}

const limaDayKeyFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' });

function eventTone(eventType: string): StatusTone {
  if (eventType === 'order.created' || eventType === 'order.payment_recorded') return 'success';
  if (eventType === 'order.date_changed' || eventType === 'order.updated') return 'info';
  return 'neutral';
}

const EVENT_DIFF_FIELDS: Array<{ path: [keyof EventValues, string]; label: string; format?: (value: string) => string }> = [
  { path: ['customer', 'name'], label: 'Nombre' },
  { path: ['customer', 'phone'], label: 'Teléfono' },
  { path: ['customer', 'documentType'], label: 'Documento', format: (value) => MANUAL_EDIT_DOCUMENT_TYPES.find((option) => option.value === value)?.label || value },
  { path: ['customer', 'documentNumber'], label: 'Número' },
  { path: ['customer', 'legalName'], label: 'Razón social' },
  { path: ['shipping', 'type'], label: 'Modalidad', format: (value) => DELIVERY_TYPE_OPTIONS.find((option) => option.value === value)?.label || value },
  { path: ['shipping', 'carrier'], label: 'Repartidor', format: (value) => SHIPPING_CARRIERS.find((option) => option.value === value)?.label || value },
  { path: ['shipping', 'address'], label: 'Dirección' },
  { path: ['shipping', 'reference'], label: 'Referencia' },
  { path: ['metadata', 'deliveryDate'], label: 'Entrega', format: (value) => formatDeliveryDay(value) },
];

/** Qué cambió en una edición manual, campo por campo. Ignora campos que antes no existían. */
function eventChanges(event: OrderEvent) {
  const before = event.previousValues || {};
  const after = event.newValues || {};
  return EVENT_DIFF_FIELDS.flatMap(({ path: [group, key], label, format }) => {
    const previous = (before[group] as Record<string, unknown> | undefined)?.[key];
    const next = (after[group] as Record<string, unknown> | undefined)?.[key];
    if (previous === undefined || String(previous ?? '') === String(next ?? '')) return [];
    const show = (value: unknown) => (String(value ?? '').trim() ? (format ? format(String(value)) : String(value)) : 'vacío');
    return [{ label, from: show(previous), to: show(next) }];
  });
}

function activityGroups(events: OrderEvent[], today = todayInLima()): TimelineGroup[] {
  const yesterday = limaDayKeyFormat.format(new Date(new Date(`${today}T12:00:00-05:00`).getTime() - 86_400_000));
  const groups: TimelineGroup[] = [];
  for (const event of [...events].reverse()) {
    const at = event.providerOccurredAt || event.createdAt;
    const date = new Date(at);
    const key = Number.isNaN(date.getTime()) ? '' : limaDayKeyFormat.format(date);
    const rawLabel = !key ? 'Sin fecha' : key === today ? 'Hoy' : key === yesterday ? 'Ayer'
      : new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', weekday: 'long', day: 'numeric', month: 'long', year: key.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric' }).format(date);
    const label = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1);
    let group = groups[groups.length - 1];
    if (!group || group.label !== label) {
      group = { label, entries: [] };
      groups.push(group);
    }
    group.entries.push({
      id: event.id,
      title: event.payload?.reason === 'manual_edit' ? 'Venta editada' : EVENT_LABELS[event.eventType] || event.eventType,
      tone: eventTone(event.eventType),
      time: formatTime(at),
      meta: event.actorName || event.actorUserId || SOURCE_LABELS[event.source] || event.source,
      detail: event.eventType === 'order.date_changed'
        ? <span className="tabular-nums">{formatRegistrationDate(event.previousValues?.orderedAt)} <span className="text-muted-foreground">→</span> {formatRegistrationDate(event.newValues?.orderedAt)}</span>
        : event.eventType === 'order.created' && event.payload?.orderDate
          ? <span>Fecha de registro elegida: <span className="tabular-nums">{event.payload.orderDate}</span></span>
          : eventChanges(event).length
            ? (
              <ul className="mt-0.5 space-y-0.5">
                {eventChanges(event).map((change) => (
                  <li key={change.label} className="min-w-0 truncate">
                    <span className="text-muted-foreground">{change.label}</span>{' '}
                    <span className="text-muted-foreground line-through decoration-muted-foreground/40">{change.from}</span>
                    <span className="px-1 text-muted-foreground">→</span>
                    <span>{change.to}</span>
                  </li>
                ))}
              </ul>
            )
            : undefined,
    });
  }
  return groups;
}

function useCopied() {
  const [copied, setCopied] = useState(false);
  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  return { copied, copy };
}

function CopyIconButton({ value, label }: { value: string; label: string }) {
  const { copied, copy } = useCopied();
  return (
    <button
      type="button"
      title={copied ? 'Copiado' : label}
      aria-label={label}
      onClick={() => void copy(value)}
      className="inline-grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
    </button>
  );
}

function CopyableValue({ value, className }: { value: string; className?: string }) {
  const { copied, copy } = useCopied();
  return (
    <button
      type="button"
      title={copied ? 'Copiado' : 'Copiar'}
      aria-label={`Copiar ${value}`}
      onClick={() => void copy(value)}
      className={cn('group inline-flex max-w-full cursor-pointer items-center gap-1 rounded font-mono text-[13px] tabular-nums hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none', className)}
    >
      <span className="break-all text-left">{value}</span>
      {copied ? <Check className="size-3 shrink-0 text-emerald-600" /> : <Copy className="hidden size-3 shrink-0 opacity-60 group-hover:inline group-focus-visible:inline" />}
    </button>
  );
}

function CopyableOrderNumber({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={copied ? 'Número copiado' : 'Copiar número de pedido'}
      aria-label={`Copiar pedido ${value}`}
      onClick={async (event) => {
        event.stopPropagation();
        await navigator.clipboard.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      }}
      className="inline-flex max-w-full items-center gap-1.5 font-mono text-[13px] font-medium tabular-nums text-foreground hover:text-foreground"
    >
      <span className="truncate">{value}</span>
      {copied ? <Check className="size-3.5 shrink-0 text-emerald-600" /> : <Copy className="size-3.5 shrink-0 text-muted-foreground" />}
    </button>
  );
}

function falabellaMediaUrl(shopSku?: string | null) {
  const sku = String(shopSku || '').trim();
  if (!sku || !/^[A-Za-z0-9_-]+$/.test(sku)) return '';
  return `https://media.falabella.com/falabellaPE/${sku}_01`;
}

function productImageSrc(url?: string | null, shopSku?: string | null, sku?: string | null) {
  const value = String(url || '').trim() || falabellaMediaUrl(shopSku) || falabellaMediaUrl(sku);
  if (!value) return '';
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'https:' && /(^|\.)falabella\.com$/i.test(parsed.hostname)) {
      return `/catalog/image?url=${encodeURIComponent(value)}`;
    }
  } catch {
    return value;
  }
  return value;
}

function dayLabel(date: string, today = todayInLima()) {
  if (date === today) return 'hoy';
  return new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00`));
}

export default function PedidosMulticanal() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { isAdmin } = usePermissions();

  const focusDetailSection = (id: string) => {
    setDetailTab('summary');
    window.requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  };

  const [companyId, setCompanyId] = useState('all');
  const [channelCode, setChannelCode] = useState('all');
  const [fulfillmentStatus, setFulfillmentStatus] = useState('all');
  const [today, setToday] = useState(todayInLima);
  const registeredDate: unknown = location.state?.registered?.orderDate;
  const [date, setDate] = useState(() => typeof registeredDate === 'string' ? registeredDate : todayInLima());
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [syncNote, setSyncNote] = useState('');
  const [dateOrder, setDateOrder] = useState<OrderDetail | null>(null);
  const [deliverOrder, setDeliverOrder] = useState<OrderDetail | null>(null);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [detailTab, setDetailTab] = useState('products');
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [ripleyLogistics, setRipleyLogistics] = useState<RipleyLogisticsOverview | null>(null);
  const [ripleyPackages, setRipleyPackages] = useState('1');
  const [ripleyPickupDate, setRipleyPickupDate] = useState(() => hoursAgo(-24).slice(0, 10));
  const [ripleyWarehouseAddress, setRipleyWarehouseAddress] = useState('Almacén principal');
  const [ripleyAction, setRipleyAction] = useState('');
  const [ripleyActionNote, setRipleyActionNote] = useState('');
  const [paymentOrder, setPaymentOrder] = useState<ManagedOrder | null>(null);
  const [detailSaving, setDetailSaving] = useState<string[]>([]);
  const [documentTypeDraft, setDocumentTypeDraft] = useState<string | null>(null);
  const [detailSaved, setDetailSaved] = useState(false);
  const [detailError, setDetailError] = useState('');
  const savedTimer = useRef(0);
  const syncNoteTimer = useRef(0);
  const searchTimer = useRef(0);
  const todayRef = useRef(today);

  useEffect(() => {
    const refreshToday = () => {
      const currentToday = todayInLima();
      const previousToday = todayRef.current;
      if (currentToday === previousToday) return;
      todayRef.current = currentToday;
      setToday(currentToday);
      setDate((selectedDate) => managedOrdersDateAfterDayChange({
        selectedDate,
        previousToday,
        currentToday,
      }));
    };
    const todayTimer = window.setInterval(refreshToday, 60_000);
    window.addEventListener('focus', refreshToday);
    document.addEventListener('visibilitychange', refreshToday);

    return () => {
      if (syncNoteTimer.current) window.clearTimeout(syncNoteTimer.current);
      if (searchTimer.current) window.clearTimeout(searchTimer.current);
      window.clearInterval(todayTimer);
      window.removeEventListener('focus', refreshToday);
      document.removeEventListener('visibilitychange', refreshToday);
    };
  }, []);

  const applySearch = (value: string) => {
    setSearch(value);
    window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => setSubmittedSearch(value.trim()), SEARCH_DELAY_MS);
  };

  const companiesQuery = useQuery({
    queryKey: ['order-companies'],
    queryFn: () => api.listCompanies(),
    staleTime: 5 * 60_000,
  });
  const channelsQuery = useQuery({
    queryKey: ['order-channels'],
    queryFn: () => api.listOrderChannels(),
    staleTime: 5 * 60_000,
  });
  const orderFilters = useMemo(() => buildManagedOrderListFilters({
    companyId,
    channelCode,
    fulfillmentStatus,
    date,
    search: submittedSearch,
  }), [channelCode, companyId, date, fulfillmentStatus, submittedSearch]);
  const searchIgnoresDate = managedOrderSearchIgnoresDate(submittedSearch);
  const ordersQuery = useQuery({
    queryKey: ['managed-orders', orderFilters],
    queryFn: () => api.listManagedOrders(orderFilters),
    staleTime: 15_000,
  });

  const companies = useMemo(
    () => (Array.isArray(companiesQuery.data) ? companiesQuery.data : []) as Company[],
    [companiesQuery.data],
  );
  const channels = (Array.isArray(channelsQuery.data) ? channelsQuery.data : []) as Channel[];
  const orders = managedOrderListRows<ManagedOrder>(ordersQuery.data?.orders);
  const totalCount = Number(ordersQuery.data?.totalCount || 0);
  const loading = ordersQuery.isPending && !ordersQuery.data;
  const fetching = ordersQuery.isFetching;
  const loadError = (ordersQuery.error as Error | undefined)?.message
    || (companiesQuery.error as Error | undefined)?.message
    || '';

  const channelCatalog = useMemo(() => FALLBACK_CHANNELS.map((fallback) => (
    { ...(channels.find((channel) => channel.code === fallback.code) || fallback), name: fallback.name }
  )), [channels]);

  const companyById = useMemo(
    () => new Map(companies.map((company) => [company.id, companyName(company)])),
    [companies],
  );

  useEffect(() => {
    const registered = registeredFromMisVentasState(location.state as { registered?: string } | null);
    if (!registered) return;
    setSuccessMessage(saleSavedSnackbarMessage(registered));
    void queryClient.invalidateQueries({ queryKey: ['managed-orders'] });
    void queryClient.invalidateQueries({ queryKey: ['managed-order-sales-pulse'] });
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate, queryClient]);

  const loadRipleyLogistics = useCallback(async (order: ManagedOrder, sandbox: boolean) => {
    if (order.companyId == null) {
      const overview: RipleyLogisticsOverview = {
        labels: null,
        manifests: null,
        eligibleLabels: null,
        labelId: '',
        manifestId: '',
        packages: null,
        sandbox,
        error: 'Este pedido no tiene seller asociado.',
      };
      setRipleyLogistics(overview);
      return overview;
    }
    try {
      const [labelsResult, eligibleResult, manifestsResult] = await Promise.all([
        api.listRipleyLogisticsLabels(order.companyId, { orderId: order.externalOrderId, limit: 25, sandbox }),
        api.listRipleyManifestLabels(order.companyId, { orderId: order.externalOrderId, limit: 25, sandbox }),
        api.listRipleyManifests(order.companyId, { orderId: order.externalOrderId, limit: 25, sandbox }),
      ]);
      const label = svcResultItems(labelsResult, 'labels')[0] || {};
      const labelId = String(label._id || '');
      const manifest = svcResultItems(manifestsResult, 'manifests').find((item) => {
        const ids = Array.isArray(item.labels) ? item.labels.map(String) : [];
        const embedded = Array.isArray(item._labels) ? item._labels as Array<Record<string, unknown>> : [];
        return ids.includes(labelId) || embedded.some((entry) => String(entry._id || '') === labelId);
      }) || {};
      const overview = {
        labels: svcResultCount(labelsResult, 'labels'),
        manifests: svcResultCount(manifestsResult, 'manifests'),
        eligibleLabels: svcResultCount(eligibleResult, 'labels'),
        labelId,
        manifestId: String(manifest._id || ''),
        packages: Number.isFinite(Number(label.packages)) ? Number(label.packages) : null,
        sandbox: svcResultIsSandbox(labelsResult) || svcResultIsSandbox(manifestsResult),
        error: '',
      } satisfies RipleyLogisticsOverview;
      setRipleyLogistics(overview);
      if (overview.packages) setRipleyPackages(String(overview.packages));
      return overview;
    } catch (error: unknown) {
      const overview: RipleyLogisticsOverview = {
        labels: null,
        manifests: null,
        eligibleLabels: null,
        labelId: '',
        manifestId: '',
        packages: null,
        sandbox,
        error: error instanceof Error ? error.message : 'No se pudo consultar Seller Center.',
      };
      setRipleyLogistics(overview);
      return overview;
    }
  }, []);

  const openDetail = useCallback(async (order: ManagedOrder, tab = 'products') => {
    setDetailTab(tab);
    setDetailOpen(true);
    setDetail(null);
    setRipleyLogistics(null);
    setRipleyActionNote('');
    setDetailError('');
    setDetailSaved(false);
    setDocumentTypeDraft(null);
    const useRipleySandbox = order.channelCode === 'ripley'
      && companies.find((company) => company.id === order.companyId)?.hasRipleySvcCredentials !== true;
    setDetailLoading(true);
    try {
      const [loadedDetail, logistics] = await Promise.all([
        api.getManagedOrder(order.id),
        order.channelCode === 'ripley'
          ? loadRipleyLogistics(order, useRipleySandbox)
          : Promise.resolve(null),
      ]);
      setDetail(loadedDetail);
      if (logistics) setRipleyLogistics(logistics);
    } catch (error: any) {
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  }, [companies, loadRipleyLogistics]);

  const goToGenerateDocument = useCallback((order: ManagedOrder) => {
    setDetailTab('summary');
    void openDetail(order, 'summary');
  }, [openDetail]);

  const canEditSale = (order: ManagedOrder) => isAdmin && order.channelCode === 'manual';

  const markDetailSaved = () => {
    setDetailSaved(true);
    window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setDetailSaved(false), 1800);
  };

  // Las ediciones en sitio se pintan al instante y se envían una tras otra, en el orden en que se hicieron.
  // Cada envío parte del estado ya optimista, así ninguna edición pisa a la anterior.
  const latestDetail = useRef(detail);
  latestDetail.current = detail;
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingSaves = useRef(0);

  const setDetailNow = (next: OrderDetail) => {
    latestDetail.current = next;
    setDetail(next);
  };

  /** Recarga desde el servidor solo cuando no queda ninguna edición en vuelo. */
  const refreshDetailWhenIdle = async (orderId: number) => {
    if (pendingSaves.current > 0) return;
    const fresh = await api.getManagedOrder(orderId);
    if (pendingSaves.current > 0 || latestDetail.current?.id !== orderId) return;
    setDetailNow(fresh);
  };

  const runOptimistic = (field: string, optimistic: OrderDetail, request: () => Promise<unknown>) => {
    const orderId = optimistic.id;
    setDetailError('');
    setDetailSaved(false);
    setDetailSaving((current) => [...current, field]);
    setDetailNow(optimistic);
    pendingSaves.current += 1;
    let failed: unknown = null;
    const job = saveQueue.current.then(async () => {
      try {
        await request();
      } catch (error) {
        failed = error;
      } finally {
        pendingSaves.current -= 1;
        setDetailSaving((current) => {
          const index = current.indexOf(field);
          return index < 0 ? current : [...current.slice(0, index), ...current.slice(index + 1)];
        });
      }
      if (failed) {
        // El servidor es la verdad: si algo falló, se recarga lo que realmente quedó guardado.
        setDetailError(failed instanceof Error ? failed.message : 'No se pudo guardar el cambio.');
      } else if (pendingSaves.current === 0) {
        markDetailSaved();
      }
      void queryClient.invalidateQueries({ queryKey: ['managed-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['managed-order-sales-pulse'] });
      await refreshDetailWhenIdle(orderId).catch(() => {});
    });
    saveQueue.current = job;
    return job;
  };

  const saveSaleField = (field: string, patch: Partial<ManualOrderEditDraft>) => {
    const current = latestDetail.current;
    if (!current || !canEditSale(current)) return;
    const draft = { ...manualEditDraftFromOrder(current), ...patch };
    // El servidor conserva la fecha de entrega si llega vacía: solo se exige al editar esa fecha.
    const invalid = validateManualOrderEdit(draft, { requireDeliveryDate: 'deliveryDate' in patch });
    if (invalid) {
      setDetailError(invalid);
      return;
    }
    setDocumentTypeDraft(null);
    const { items, ...rest } = buildManualOrderEditPayload(draft);
    // Sin líneas, el servidor no recalcula importes ni vuelve a validar stock.
    const payload = 'lines' in patch ? { ...rest, items } : rest;
    return runOptimistic(field, applyManualDraft(current, draft), () => api.updateManagedOrder(current.id, payload));
  };

  /** DNI ↔ RUC cambia también la longitud del número: si el actual no sirve, se pide el nuevo y se guardan juntos. */
  const changeDocumentType = (documentType: string) => {
    const current = latestDetail.current;
    if (!current) return;
    const draft = { ...manualEditDraftFromOrder(current), documentType };
    if (!draft.documentNumber || !validateManualOrderEdit(draft, { requireDeliveryDate: false })) {
      void saveSaleField('documentType', { documentType });
      return;
    }
    setDetailError('');
    setDocumentTypeDraft(documentType);
  };

  const saveCommission = (item: OrderItem, amount: number) => {
    const current = latestDetail.current;
    if (!current || !Number.isFinite(amount) || amount < 0) return;
    const optimistic = { ...current, items: current.items.map((entry) => (entry.id === item.id ? { ...entry, commissionAmount: amount } : entry)) };
    return runOptimistic(`commission-${item.id}`, optimistic, () => api.updateManagedOrderItemCommission(current.id, item.id, amount));
  };

  const runRipleyAction = async (action: string, operation: () => Promise<string>) => {
    setRipleyAction(action);
    setRipleyActionNote('');
    try {
      setRipleyActionNote(await operation());
    } catch (error: unknown) {
      setRipleyActionNote(error instanceof Error ? error.message : 'No se pudo completar la operación logística.');
    } finally {
      setRipleyAction('');
    }
  };

  const updateRipleyPackages = () => {
    if (!detail || detail.companyId == null) return;
    const { companyId } = detail;
    void runRipleyAction('packages', async () => {
      await api.editRipleyPackages(companyId, {
        orderId: detail.externalOrderId,
        svcOrderId: detail.metadata?.ripleySvc?.orderId || '',
        packages: Number(ripleyPackages),
        sandbox: ripleyLogistics?.sandbox,
      });
      await loadRipleyLogistics(detail, Boolean(ripleyLogistics?.sandbox));
      return 'Bultos actualizados. La etiqueta quedó regenerada.';
    });
  };

  const downloadRipleyLabels = () => {
    if (!detail || detail.companyId == null || !ripleyLogistics?.labelId) return;
    const { companyId } = detail;
    void runRipleyAction('labels', async () => {
      const result = await api.downloadRipleyLabels(companyId, {
        orderId: detail.externalOrderId,
        documentIds: [ripleyLogistics.labelId],
        sandbox: ripleyLogistics.sandbox,
      });
      const data = svcResultData(result);
      downloadPdf(svcPdf(result, ['labels_generated', 'pdf', 'document']), `etiquetas-ripley-${detail.externalOrderNumber}.pdf`);
      const failures = Array.isArray(data.orders_without_labels) ? data.orders_without_labels.length : 0;
      return failures ? `PDF descargado con ${failures} etiqueta(s) observada(s).` : 'PDF de etiquetas descargado.';
    });
  };

  const createRipleyManifest = () => {
    if (!detail || detail.companyId == null || !ripleyLogistics?.labelId) return;
    const { companyId } = detail;
    void runRipleyAction('manifest', async () => {
      await api.scheduleRipleyManifest(companyId, {
        orderId: detail.externalOrderId,
        labelIds: [ripleyLogistics.labelId],
        pickupDate: ripleyPickupDate,
        warehouseAddress: ripleyWarehouseAddress,
        sandbox: ripleyLogistics.sandbox,
      });
      await loadRipleyLogistics(detail, ripleyLogistics.sandbox);
      return 'Recojo agendado y manifiesto creado.';
    });
  };

  const downloadRipleyManifest = () => {
    if (!detail || detail.companyId == null || !ripleyLogistics?.manifestId) return;
    const { companyId } = detail;
    void runRipleyAction('manifest-pdf', async () => {
      const result = await api.downloadRipleyManifest(companyId, ripleyLogistics.manifestId, { sandbox: ripleyLogistics.sandbox });
      downloadPdf(svcPdf(result, ['pdf', 'manifest', 'document']), `manifiesto-ripley-${detail.externalOrderNumber}.pdf`);
      return 'PDF del manifiesto descargado.';
    });
  };

  const detachRipleyLabel = () => {
    if (!detail || detail.companyId == null || !ripleyLogistics?.manifestId || !ripleyLogistics.labelId) return;
    const { companyId } = detail;
    void runRipleyAction('detach', async () => {
      await api.detachRipleyManifestLabels(companyId, ripleyLogistics.manifestId, {
        labelIds: [ripleyLogistics.labelId],
        sandbox: ripleyLogistics.sandbox,
      });
      await loadRipleyLogistics(detail, ripleyLogistics.sandbox);
      return 'Etiqueta desvinculada; vuelve a estar disponible para agendar.';
    });
  };

  const hasActiveFilters = companyId !== 'all' || channelCode !== 'all' || fulfillmentStatus !== 'all' || Boolean(search.trim());
  const selectedSellerName = companyId === 'all' ? '' : companyById.get(Number(companyId)) || '';
  const selectedChannelName = channelCode === 'all' ? '' : channelCatalog.find((channel) => channel.code === channelCode)?.name || channelCode;
  const selectedStatusLabel = fulfillmentStatus === 'all' ? '' : FULFILLMENT_LABELS[fulfillmentStatus] || fulfillmentStatus;
  const clearFilters = () => {
    setCompanyId('all');
    setChannelCode('all');
    setFulfillmentStatus('all');
    setSearch('');
    setSubmittedSearch('');
  };

  const markSyncNote = (note: string) => {
    if (syncNoteTimer.current) window.clearTimeout(syncNoteTimer.current);
    setSyncNote(note);
    syncNoteTimer.current = window.setTimeout(() => setSyncNote(''), 2800);
  };

  const syncMutation = useMutation({
    mutationFn: () => api.syncManagedOrders({ mode: 'backfill' }),
    onMutate: () => {
      setSyncNote('');
    },
    onSuccess: async (result) => {
      const outcomes = result.results || [];
      const failed = outcomes.filter((entry) => entry.status === 'error' || entry.status === 'partial').length;
      const running = outcomes.some((entry) => entry.status === 'already_running');
      if (running) markSyncNote('En curso');
      else markSyncNote(failed ? 'Incompleto' : 'Actualizado');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['managed-orders'] }),
        queryClient.invalidateQueries({ queryKey: ['managed-order-sales-pulse'] }),
      ]);
    },
    onError: () => markSyncNote('Error'),
  });
  const syncing = syncMutation.isPending;
  const syncRealData = () => syncMutation.mutate();

  const paymentMutation = useMutation({
    mutationFn: async (input: {
      order: ManagedOrder;
      paymentMethod: string;
      receivedBy: string;
      paidTo?: string;
      paymentProof: { name: string; type: string; dataUrl: string } | null;
    }) => api.updateManagedOrderPayment(input.order.id, {
      paymentMethod: input.paymentMethod,
      receivedBy: input.receivedBy || undefined,
      paidTo: input.paidTo || undefined,
      paymentProof: input.paymentProof,
    }),
    onSuccess: (updated, input) => {
      void queryClient.invalidateQueries({ queryKey: ['managed-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['managed-order-sales-pulse'] });
      setPaymentOrder(null);
      setSuccessMessage(`Pago de ${updated.externalOrderNumber || input.order.externalOrderNumber} registrado.`);
    },
  });

  const deliverMutation = useMutation({
    mutationFn: (order: OrderDetail) => api.markLogisticsOrderDelivered({ orderId: order.id }),
    onSuccess: (_result, order) => {
      setDeliverOrder(null);
      setDetail((current) => (
        current && current.id === order.id
          ? { ...current, fulfillmentStatus: 'delivered', orderStatus: 'completed' }
          : current
      ));
      setSuccessMessage(logisticsDeliverSuccessCopy(order));
      void queryClient.invalidateQueries({ queryKey: ['managed-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['managed-order-sales-pulse'] });
      void queryClient.invalidateQueries({ queryKey: ['logistics-inbox'] });
    },
  });

  const dateMutation = useMutation({
    mutationFn: (input: { id: number; date: string }) => api.updateManagedOrderDate(input.id, input.date),
    onSuccess: (updated) => {
      setDetail(updated);
      setDateOrder(null);
      setSuccessMessage('Fecha de registro actualizada.');
      void queryClient.invalidateQueries({ queryKey: ['managed-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['managed-order-sales-pulse'] });
      void queryClient.invalidateQueries({ queryKey: ['salesperson-home'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['product-sales-report'] });
    },
  });

  const columns = useMemo<ColumnDef<ManagedOrder>[]>(() => {
    const defs: ColumnDef<ManagedOrder>[] = [
    {
      id: 'order',
      header: 'Pedido',
      size: 168,
      cell: ({ row }) => <CopyableOrderNumber value={row.original.externalOrderNumber} />,
    },
    {
      id: 'product',
      header: 'Producto',
      size: 224,
      cell: ({ row }) => <OrderProductCell items={row.original.items} />,
    },
    {
      id: 'seller',
      header: 'Seller',
      size: 156,
      cell: ({ row }) => {
        const seller = sellerCellLabel(row.original, companyById);
        if (!seller) return null;
        const person = sellerCellShowsPerson(row.original);
        const Icon = person ? UserRound : Store;
        return (
          <span
            className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-md border border-border bg-muted/45 px-2 py-0.5 text-xs font-medium text-foreground"
            title={seller}
          >
            <Icon className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{seller}</span>
          </span>
        );
      },
    },
    {
      id: 'customer',
      header: 'Cliente',
      size: 168,
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate">{row.original.customer?.name || 'Sin nombre'}</p>
          {row.original.customer?.documentNumber ? (
            <p className="truncate font-mono text-[11px] text-muted-foreground">{row.original.customer.documentNumber}</p>
          ) : null}
        </div>
      ),
    },
    {
      id: 'origin',
      header: 'Origen',
      size: 124,
      cell: ({ row }) => (
        <div className="flex min-w-0 items-center gap-1.5">
          <ChannelMark code={row.original.channelCode} name={row.original.channelName} size="xs" ripley="wordmark" />
          <span className="truncate">{originLabel(row.original)}</span>
        </div>
      ),
    },
    {
      id: 'delivery',
      header: 'Entrega',
      size: 108,
      cell: ({ row }) => deliveryBadge(row.original),
    },
    {
      id: 'address',
      header: 'Dirección',
      size: 240,
      cell: ({ row }) => (
        <span className="line-clamp-2 whitespace-normal text-[13px] leading-5 text-muted-foreground" title={addressText(row.original)}>
          {addressText(row.original)}
        </span>
      ),
    },
    {
      id: 'time',
      header: searchIgnoresDate ? 'Fecha' : 'Hora',
      size: searchIgnoresDate ? 120 : 72,
      cell: ({ row }) => (
        <span className="tabular-nums text-muted-foreground">
          {searchIgnoresDate ? formatDate(row.original.orderedAt) : formatTime(row.original.orderedAt)}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Estado',
      size: 220,
      cell: ({ row }) => (
        <div className="flex flex-wrap items-center gap-1">
          {fulfillmentBadge(row.original.fulfillmentStatus)}
          {paymentBadge(row.original.paymentStatus)}
        </div>
      ),
    },
    {
      id: 'method',
      header: 'Método',
      size: 112,
      cell: ({ row }) => <span className="truncate text-muted-foreground">{paymentMethodLabel(row.original)}</span>,
    },
    {
      id: 'total',
      header: () => <span className="block text-right">Total</span>,
      size: 108,
      cell: ({ row }) => (
        <span className="block truncate text-right font-medium tabular-nums">{formatMoney(row.original.total, row.original.currency)}</span>
      ),
    },
    {
      id: 'actions',
      header: 'Acciones',
      size: 72,
      cell: ({ row }) => (
        <div
          className="flex w-full items-center justify-center"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-8 cursor-pointer text-muted-foreground hover:text-foreground"
                aria-label={`Acciones de ${row.original.externalOrderNumber}`}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              {canRecordPayment(row.original) && (
                <>
                  <DropdownMenuItem onClick={() => setPaymentOrder(row.original)}>
                    <Banknote /> Registrar pago
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem onClick={() => goToGenerateDocument(row.original)}>
                <FileText /> Comprobante
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {isAdmin && row.original.channelCode === 'manual' && (
                <>
                  <DropdownMenuItem onClick={() => void openDetail(row.original, 'summary')}>
                    <Pencil /> Editar venta
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem onClick={() => void openDetail(row.original)}>
                <Eye /> Ver detalle
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];
    const columnIds = defs.map((column) => column.id);
    if (columnIds.join() !== MANAGED_ORDER_TABLE_COLUMNS.join()) {
      throw new Error('Columnas de la bandeja de pedidos desincronizadas con MANAGED_ORDER_TABLE_COLUMNS.');
    }
    return defs;
  }, [companyById, goToGenerateDocument, isAdmin, searchIgnoresDate]);

  const table = useReactTable({
    data: orders,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (order) => String(order.id),
  });

  const filterTriggerClass = 'h-9 w-auto min-w-[7.25rem] max-w-[11rem] rounded-md border-border bg-background';
  const filterMenuClass = 'w-auto min-w-[14rem]';

  return (
    <div className="space-y-4">
      {isAdmin && dateOrder && (
        <OrderDateDialog
          currentDate={orderDateKey(dateOrder.orderedAt || dateOrder.createdAt)}
          initialDate={orderDateKey(dateOrder.orderedAt || dateOrder.createdAt)}
          chooseDate
          pending={dateMutation.isPending}
          error={dateMutation.error instanceof Error ? dateMutation.error.message : undefined}
          onClose={() => setDateOrder(null)}
          onConfirm={(date) => dateMutation.mutate({ id: dateOrder.id, date })}
        />
      )}
      <DayStrip value={date} onChange={setDate} max={today} />

      <div className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => applySearch(event.target.value)}
              placeholder="Buscar pedido, cliente o documento"
              aria-label="Buscar pedidos"
              className="h-9 pl-9"
            />
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger className={filterTriggerClass} aria-label="Filtrar por seller">
                <span className="truncate">{companyId === 'all' ? 'Seller' : selectedSellerName}</span>
              </SelectTrigger>
              <SelectContent className={filterMenuClass}>
                <SelectItem value="all">Todos los sellers</SelectItem>
                {companies.map((company) => <SelectItem key={company.id} value={String(company.id)}>{companyName(company)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={channelCode} onValueChange={setChannelCode}>
              <SelectTrigger className={filterTriggerClass} aria-label="Filtrar por origen">
                <span className="truncate">{channelCode === 'all' ? 'Origen' : selectedChannelName}</span>
              </SelectTrigger>
              <SelectContent className={filterMenuClass}>
                <SelectItem value="all">Todos los orígenes</SelectItem>
                {channelCatalog.map((channel) => <SelectItem key={channel.code} value={channel.code}>{channel.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={fulfillmentStatus} onValueChange={setFulfillmentStatus}>
              <SelectTrigger className={filterTriggerClass} aria-label="Filtrar por estado">
                <span className="truncate">{fulfillmentStatus === 'all' ? 'Estado' : selectedStatusLabel}</span>
              </SelectTrigger>
              <SelectContent className={filterMenuClass}>
                <SelectItem value="all">Todos los estados</SelectItem>
                {Object.entries(FULFILLMENT_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
            {hasActiveFilters && (
              <Button type="button" variant="ghost" size="xs" className="h-9 cursor-pointer" onClick={clearFilters}>
                Limpiar
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => void syncRealData()}
              disabled={syncing}
              aria-live="polite"
              className={cn(
                'h-9 w-auto cursor-pointer',
                syncNote === 'Actualizado' && 'border-emerald-200 text-emerald-700 dark:border-emerald-900 dark:text-emerald-300',
                (syncNote === 'Error' || syncNote === 'Incompleto') && 'border-rose-200 text-rose-700 dark:border-rose-900 dark:text-rose-300',
              )}
            >
              {syncing ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : syncNote === 'Actualizado' ? <Check /> : <RefreshCw />}
              {syncing ? 'Actualizando…' : syncNote || 'Actualizar'}
            </Button>
            <Button onClick={() => navigate('/orders/nueva?from=orders')} className="h-9 w-auto cursor-pointer">
              <Plus /> Registrar venta
            </Button>
          </div>
        </div>
        {hasActiveFilters && (
          <div className="flex flex-wrap items-center gap-1.5">
            {search.trim() && <FilterChip label={search.trim()} onRemove={() => { setSearch(''); setSubmittedSearch(''); }} />}
            {selectedSellerName && <FilterChip label={selectedSellerName} onRemove={() => setCompanyId('all')} />}
            {selectedChannelName && <FilterChip label={selectedChannelName} onRemove={() => setChannelCode('all')} />}
            {selectedStatusLabel && <FilterChip label={selectedStatusLabel} onRemove={() => setFulfillmentStatus('all')} />}
            {managedOrdersSearchHelper(search) && (
              <p className="self-center text-xs text-muted-foreground">{managedOrdersSearchHelper(search)}</p>
            )}
          </div>
        )}
      </div>

      {successMessage && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
          <span role="status" aria-live="polite" className="flex items-center gap-2"><CheckCircle2 className="size-4" /> {successMessage}</span>
          <Button variant="ghost" size="xs" className="h-11 cursor-pointer sm:h-6" onClick={() => setSuccessMessage('')}>Cerrar</Button>
        </div>
      )}

      {loadError && (
        <div role="alert" className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
          <AlertCircle className="size-4 shrink-0" /> {loadError}
        </div>
      )}

      <OrdersVirtualTable
        table={table}
        aria-label={managedOrdersTableLabel(dayLabel(date, today), submittedSearch)}
        loading={loading}
        fetching={fetching}
        onRowClick={openDetail}
        empty={(
          <div className="flex flex-col items-center gap-2 py-14 text-center">
            <Store className="size-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">{managedOrdersEmptyTitle(submittedSearch)}</p>
            <p className="text-sm text-muted-foreground">{managedOrdersEmptyHint(submittedSearch)}</p>
            <Button size="sm" className="mt-2 cursor-pointer" onClick={() => navigate('/orders/nueva?from=orders')}><Plus /> Registrar venta</Button>
          </div>
        )}
        footer={(
          <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            {fetching && <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />}
            {totalCount} {totalCount === 1 ? 'pedido' : 'pedidos'}
          </p>
        )}
      />

      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent
          showCloseButton={false}
          className="gap-0 overflow-hidden border-l border-border/70 p-0 sm:max-w-[44rem]"
          onEscapeKeyDown={(event) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest('input, textarea, select, [contenteditable="true"]')) event.preventDefault();
          }}
        >
          {detailLoading ? (
            <>
              <SheetTitle className="sr-only">Cargando pedido</SheetTitle>
              <SheetDescription className="sr-only">Detalle del pedido</SheetDescription>
              <DetailSkeleton />
            </>
          ) : detail ? (() => {
            const editable = canEditSale(detail);
            const draft = editable ? manualEditDraftFromOrder(detail) : null;
            const seller = sellerCellLabel(detail, companyById);
            const canDeliver = canMarkLogisticsDelivered(detail);
            return (
            <>
              <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 px-3">
                <div className="flex min-w-0 items-center gap-2 pl-1 text-xs text-muted-foreground">
                  <span className="hidden sm:inline">Pedidos</span>
                  <ChevronRight className="hidden size-3 sm:block" aria-hidden="true" />
                  <span className="truncate font-mono text-foreground/70">{detail.externalOrderNumber}</span>
                  {detailSaving.length ? <span className="ml-1 inline-flex items-center gap-1.5" role="status"><Loader2 className="size-3 animate-spin motion-reduce:animate-none" /> Guardando</span> : null}
                  {!detailSaving.length && detailSaved ? <span className="ml-1 inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400" role="status"><CheckCircle2 className="size-3" /> Guardado</span> : null}
                </div>
                <div className="flex items-center">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="ghost" size="icon-sm" className="size-8 text-muted-foreground" aria-label="Más acciones" title="Más acciones">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-auto min-w-48">
                      {canRecordPayment(detail) && <DropdownMenuItem onClick={() => setPaymentOrder(detail)}><Banknote /> Registrar pago</DropdownMenuItem>}
                      {isAdmin && <DropdownMenuItem onClick={() => { dateMutation.reset(); setDateOrder(detail); }}><CalendarDays /> Cambiar fecha de registro</DropdownMenuItem>}
                      {detail.documentRequirement !== 'disabled' && <DropdownMenuItem onClick={() => focusDetailSection('order-document')}><FileText /> Ver comprobante</DropdownMenuItem>}
                      <DropdownMenuItem onClick={() => void navigator.clipboard.writeText(detail.externalOrderNumber)}><Copy /> Copiar número</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button type="button" variant="ghost" size="icon-sm" className="size-8 text-muted-foreground" aria-label="Cerrar" title="Cerrar" onClick={() => setDetailOpen(false)}>
                    <X className="size-4" />
                  </Button>
                </div>
              </div>

              <SheetHeader className="gap-0 px-6 pt-6 pb-5 sm:px-10">
                <div className="mb-2 flex min-w-0 items-center gap-2 text-[13px] text-foreground/70">
                  <ChannelMark code={detail.channelCode} name={detail.channelName} size="sm" />
                  <span className="truncate">{[originLabel(detail), seller, formatRegistrationDate(detail.orderedAt || detail.createdAt)].filter(Boolean).join(' · ')}</span>
                </div>
                <SheetTitle className="flex min-w-0 items-center gap-1.5 text-[28px] font-semibold leading-[1.15] tracking-[-0.03em] tabular-nums">
                  <span className="truncate">{detail.externalOrderNumber}</span>
                  <CopyIconButton value={detail.externalOrderNumber} label="Copiar número de pedido" />
                </SheetTitle>
                <SheetDescription className="mt-1 truncate text-sm">
                  {[detail.customer?.name, unitCountLabel(detail.items)].filter(Boolean).join(' · ')}
                </SheetDescription>
                <div className="mt-6">
                  <MetricStrip
                    metrics={[
                      { label: 'Total', value: <span className="tabular-nums">{formatMoney(detail.total, detail.currency)}</span> },
                      { label: 'Despacho', value: FULFILLMENT_LABELS[detail.fulfillmentStatus] || detail.fulfillmentStatus, tone: fulfillmentTone(detail.fulfillmentStatus) },
                      {
                        label: 'Pago',
                        value: PAYMENT_LABELS[detail.paymentStatus] || 'Sin dato',
                        tone: paymentTone(detail.paymentStatus),
                        hint: detail.channelCode === 'manual' && detail.metadata?.paymentMethod ? paymentMethodLabel(detail) : undefined,
                        onSelect: canRecordPayment(detail) ? () => setPaymentOrder(detail) : undefined,
                      },
                      {
                        label: 'Comprobante',
                        value: documentStatusLabel(detail),
                        tone: documentStatusTone(detail),
                        hint: documentTypeLabel(detail) || undefined,
                        onSelect: detail.documentRequirement === 'disabled' ? undefined : () => focusDetailSection('order-document'),
                      },
                    ]}
                  />
                </div>
                {(canRecordPayment(detail) || canDeliver) && (
                  <div className="mt-5 flex flex-wrap gap-2">
                    {canRecordPayment(detail) && <Button type="button" size="sm" onClick={() => setPaymentOrder(detail)}><Banknote data-icon="inline-start" /> Registrar pago</Button>}
                    {canDeliver && (
                      <Button type="button" size="sm" variant="outline" onClick={() => { deliverMutation.reset(); setDeliverOrder(detail); }}>
                        <PackageCheck data-icon="inline-start" /> Marcar entregado
                      </Button>
                    )}
                  </div>
                )}
              </SheetHeader>

              <Tabs key={detail.id} value={detailTab} onValueChange={setDetailTab} className="min-h-0 flex-1 gap-0 overflow-hidden">
                <div className="shrink-0 border-b border-border/70 px-4 pb-2 sm:px-8">
                  <TabsList variant="line" aria-label="Secciones del pedido" className="h-10 w-full justify-start gap-1 overflow-x-auto rounded-none bg-transparent p-0">
                    <TabsTrigger value="summary" className={DRAWER_TAB_CLASS}><LayoutList /> Resumen</TabsTrigger>
                    <TabsTrigger value="products" className={DRAWER_TAB_CLASS}><Package /> Productos<TabCount value={detail.items.length} /></TabsTrigger>
                    <TabsTrigger value="activity" className={DRAWER_TAB_CLASS}><Clock3 /> Actividad{detail.events.length ? <TabCount value={detail.events.length} /> : null}</TabsTrigger>
                    {detail.channelCode === 'mercado_libre' && (
                      <TabsTrigger value="messages" className={DRAWER_TAB_CLASS}><MessageCircle /> Mensajes</TabsTrigger>
                    )}
                  </TabsList>
                </div>

                <TabsContent value="summary" className="min-h-0 overflow-y-auto">
                  <div className="space-y-9 px-6 py-6 sm:px-10">
                    {detailError && (
                      <p role="alert" className="flex items-center gap-2 text-[13px] text-destructive"><AlertCircle className="size-3.5 shrink-0" /> {detailError}</p>
                    )}

                    <PropertySection title="Pedido">
                      {isAdmin ? (
                        <button
                          type="button"
                          className="grid min-h-9 w-full cursor-pointer grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)] items-center gap-x-3 rounded-lg px-2 text-left transition-colors hover:bg-muted/60 sm:grid-cols-[10rem_minmax(0,1fr)]"
                          onClick={() => { dateMutation.reset(); setDateOrder(detail); }}
                          aria-label="Cambiar fecha de registro"
                        >
                          <span className="flex items-center gap-2 text-sm text-muted-foreground"><CalendarDays className="size-3.5" /> Registro</span>
                          <span className="text-sm tabular-nums">{formatRegistrationDate(detail.orderedAt || detail.createdAt)}</span>
                        </button>
                      ) : (
                        <PropertyRow icon={<CalendarDays />} label="Registro"><span className="tabular-nums">{formatRegistrationDate(detail.orderedAt || detail.createdAt)}</span></PropertyRow>
                      )}
                      <PropertyRow icon={<Store />} label="Origen">
                        {originLabel(detail)}
                        {detail.channelCode !== 'manual' && detail.channelAccountName ? <span className="text-muted-foreground"> · {detail.channelAccountName}</span> : null}
                      </PropertyRow>
                      <PropertyRow icon={<UserRound />} label="Vendedor">{seller || <EmptyValue />}</PropertyRow>
                      {detail.createdByName && detail.createdByName !== seller && <PropertyRow icon={<UserRound />} label="Registrado por">{detail.createdByName}</PropertyRow>}
                      {detail.channelCode === 'manual' && (
                        <PropertyRow icon={<Wallet />} label="Pago">
                          {detail.metadata?.paymentMethod ? paymentMethodLabel(detail) : <EmptyValue>Sin método</EmptyValue>}
                          {detail.metadata?.receivedBy ? <span className="text-muted-foreground"> · recibió {detail.metadata.receivedBy}</span> : null}
                          {detail.metadata?.paidTo ? <span className="text-muted-foreground"> · a {detail.metadata.paidTo === 'vendedor' ? 'vendedor' : 'empresa'}</span> : null}
                        </PropertyRow>
                      )}
                      {!draft && detail.metadata?.deliveryDate ? (
                        <PropertyRow icon={<CalendarClock />} label="Entrega"><span className="tabular-nums">{formatDeliveryDay(detail.metadata.deliveryDate)}</span></PropertyRow>
                      ) : null}
                    </PropertySection>

                    {detail.channelCode !== 'mercado_libre' && (
                      <PropertySection title="Cliente" hint={draft ? 'Haz clic para editar' : undefined}>
                        <InlineTextProperty
                          icon={<UserRound />}
                          label="Nombre"
                          value={detail.customer?.name || ''}
                          placeholder="Sin nombre"
                          readOnly={!draft}
                          saving={detailSaving.includes('customerName')}
                          onSave={(value) => void saveSaleField('customerName', { customerName: value })}
                        />
                        {draft ? (
                          <>
                            <InlineSelectProperty
                              icon={<IdCard />}
                              label="Documento"
                              value={documentTypeDraft ?? draft.documentType}
                              options={MANUAL_EDIT_DOCUMENT_TYPES}
                              saving={detailSaving.includes('documentType')}
                              onSave={changeDocumentType}
                            />
                            <InlineTextProperty
                              key={`document-number-${documentTypeDraft ?? 'saved'}`}
                              initialEditing={documentTypeDraft != null}
                              hint={documentTypeDraft === '6' ? '11 dígitos' : documentTypeDraft === '1' ? '8 dígitos' : undefined}
                              onCancel={() => setDocumentTypeDraft(null)}
                              icon={<Hash />}
                              label="Número"
                              value={draft.documentNumber}
                              display={<span className="tabular-nums">{draft.documentNumber}</span>}
                              inputMode="numeric"
                              placeholder="Sin documento"
                              saving={detailSaving.includes('documentNumber')}
                              onSave={(value) => void saveSaleField('documentNumber', { documentNumber: value.replace(/\D/g, ''), documentType: documentTypeDraft ?? draft.documentType })}
                            />
                            {(documentTypeDraft ?? draft.documentType) === '6' && (
                              <InlineTextProperty
                                icon={<Building2 />}
                                label="Razón social"
                                value={draft.legalName}
                                placeholder="Sin razón social"
                                saving={detailSaving.includes('legalName')}
                                onSave={(value) => void saveSaleField('legalName', { legalName: value })}
                              />
                            )}
                          </>
                        ) : (
                          <>
                            <PropertyRow icon={<IdCard />} label="Documento">{customerDocumentLabel(detail.customer) ? <span className="tabular-nums">{customerDocumentLabel(detail.customer)}</span> : <EmptyValue>Sin documento</EmptyValue>}</PropertyRow>
                            {detail.customer?.legalName && detail.customer.legalName !== detail.customer.name && (
                              <PropertyRow icon={<Building2 />} label="Razón social">{detail.customer.legalName}</PropertyRow>
                            )}
                          </>
                        )}
                        <InlineTextProperty
                          icon={<Phone />}
                          label="Teléfono"
                          type="tel"
                          inputMode="tel"
                          value={detail.customer?.phone || ''}
                          display={<span className="tabular-nums">{detail.customer?.phone}</span>}
                          placeholder="Sin teléfono"
                          readOnly={!draft}
                          saving={detailSaving.includes('customerPhone')}
                          onSave={(value) => void saveSaleField('customerPhone', { customerPhone: value })}
                        />
                      </PropertySection>
                    )}

                    {draft ? (
                      <PropertySection title="Entrega" hint="Haz clic para editar">
                        <InlineSelectProperty
                          icon={<Truck />}
                          label="Modalidad"
                          value={draft.deliveryType}
                          options={DELIVERY_TYPE_OPTIONS}
                          saving={detailSaving.includes('deliveryType')}
                          onSave={(value) => void saveSaleField('deliveryType', value === 'envio'
                            ? { deliveryType: 'envio', carrier: draft.carrier || SHIPPING_CARRIERS[0].value }
                            : { deliveryType: 'recojo' })}
                        />
                        <InlineTextProperty
                          icon={<CalendarClock />}
                          label="Fecha"
                          type="date"
                          value={draft.deliveryDate}
                          display={<span className="tabular-nums">{formatDeliveryDay(draft.deliveryDate)}</span>}
                          placeholder="Sin fecha"
                          saving={detailSaving.includes('deliveryDate')}
                          onSave={(value) => void saveSaleField('deliveryDate', { deliveryDate: value })}
                        />
                        {draft.deliveryType === 'envio' && (
                          <>
                            <InlineSelectProperty
                              icon={<Signpost />}
                              label="Repartidor"
                              value={draft.carrier}
                              options={SHIPPING_CARRIERS}
                              placeholder="Sin repartidor"
                              saving={detailSaving.includes('carrier')}
                              onSave={(value) => void saveSaleField('carrier', { carrier: value })}
                            />
                            <InlineTextProperty
                              icon={<MapPin />}
                              label="Dirección"
                              value={draft.address}
                              placeholder="Sin dirección"
                              saving={detailSaving.includes('address')}
                              onSave={(value) => void saveSaleField('address', { address: value })}
                            />
                            <InlineTextProperty
                              icon={<StickyNote />}
                              label="Referencia"
                              value={draft.reference}
                              placeholder="Sin referencia"
                              saving={detailSaving.includes('reference')}
                              onSave={(value) => void saveSaleField('reference', { reference: value })}
                            />
                            {Number(detail.shippingAmount) > 0 && (
                              <PropertyRow icon={<Receipt />} label="Costo de envío">
                                <span className="tabular-nums">{formatMoney(detail.shippingAmount, detail.currency)}</span>
                                <span className="text-muted-foreground"> · {shippingZoneLabel(detail.shipping)}</span>
                              </PropertyRow>
                            )}
                          </>
                        )}
                      </PropertySection>
                    ) : detail.channelCode === 'mercado_libre' ? (
                      <PropertySection
                        title="Envío"
                        aside={(
                          <>
                            {detail.metadata?.shippingMode && <Badge variant="outline" className="rounded-md uppercase">{detail.metadata.shippingMode}</Badge>}
                            {sellerDispatchesMercadoLibre(detail.metadata?.logisticType) && (
                              <Badge variant="outline" className="rounded-md border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">Despachas tú</Badge>
                            )}
                          </>
                        )}
                      >
                        <PropertyRow icon={<CalendarClock />} label="Entrega estimada"><span className="font-medium">{formatEstimatedDelivery(detail.promisedShippingAt)}</span></PropertyRow>
                        <PropertyRow icon={<Truck />} label="Despacho">{mercadoLibreDispatchCopy(detail.metadata?.shippingMode, detail.metadata?.logisticType)}</PropertyRow>
                        <PropertyRow icon={<Signpost />} label="Transportista">{detail.shipping?.carrier || 'Mercado Envíos'}</PropertyRow>
                        <PropertyRow icon={<Hash />} label="Seguimiento">{detail.shipping?.trackingCode ? <CopyableValue value={detail.shipping.trackingCode} /> : <EmptyValue>Sin código</EmptyValue>}</PropertyRow>
                        <PropertyRow icon={<UserRound />} label="Destinatario">
                          {detail.customer?.name || <EmptyValue>Sin nombre</EmptyValue>}
                          {detail.customer?.documentNumber ? <span className="text-muted-foreground tabular-nums"> · DNI {detail.customer.documentNumber}</span> : null}
                        </PropertyRow>
                        <PropertyRow icon={<MapPin />} label="Dirección" align="start">
                          {shippingAddress(detail.shipping) || <EmptyValue>Sin dirección</EmptyValue>}
                          {shippingLocality(detail.shipping) ? <span className="block text-xs text-muted-foreground">{shippingLocality(detail.shipping)}</span> : null}
                        </PropertyRow>
                      </PropertySection>
                    ) : detail.channelCode !== 'ripley' && hasShippingDetails(detail) ? (
                      <PropertySection title="Envío">
                        <PropertyRow icon={<MapPin />} label="Dirección" align="start">
                          {shippingAddress(detail.shipping) || <EmptyValue>Sin dirección</EmptyValue>}
                          {shippingLocality(detail.shipping) ? <span className="block text-xs text-muted-foreground">{shippingLocality(detail.shipping)}</span> : null}
                        </PropertyRow>
                        {detail.shipping?.reference && <PropertyRow icon={<StickyNote />} label="Referencia">{detail.shipping.reference}</PropertyRow>}
                        <PropertyRow icon={<Signpost />} label="Transportista">{deliveryShowsAsTag(deliveryLabel(detail)) ? deliveryLabel(detail) : <EmptyValue />}</PropertyRow>
                        {detail.shipping?.trackingCode && <PropertyRow icon={<Hash />} label="Seguimiento"><CopyableValue value={detail.shipping.trackingCode} /></PropertyRow>}
                        {Number(detail.shippingAmount) > 0 && (
                          <PropertyRow icon={<Receipt />} label="Costo de envío">
                            <span className="tabular-nums">{formatMoney(detail.shippingAmount, detail.currency)}</span>
                            <span className="text-muted-foreground"> · {shippingZoneLabel(detail.shipping)}</span>
                          </PropertyRow>
                        )}
                      </PropertySection>
                    ) : null}

                    {detail.channelCode === 'ripley' && (
                      <PropertySection
                        title="Logística Ripley"
                        aside={ripleyLogistics?.sandbox ? (
                          <Badge variant="outline" className="rounded-md border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">Sandbox simulado</Badge>
                        ) : undefined}
                      >
                        <PropertyRow icon={<Store />} label="Estado comercial">{detail.providerStatus || <EmptyValue>Sin dato</EmptyValue>}</PropertyRow>
                        <PropertyRow icon={<Truck />} label="Estado logístico">{detail.metadata?.ripleySvc?.statusManagement || <EmptyValue>Pendiente de sincronizar</EmptyValue>}</PropertyRow>
                        <PropertyRow icon={<Hash />} label="Orden SVC">{detail.metadata?.ripleySvc?.orderId ? <CopyableValue value={detail.metadata.ripleySvc.orderId} /> : <EmptyValue>Sin orden</EmptyValue>}</PropertyRow>
                        <PropertyRow icon={<Package />} label="Bultos"><span className="tabular-nums">{detail.metadata?.ripleySvc?.packages ?? '—'}</span></PropertyRow>
                        <PropertyRow icon={<Receipt />} label="Etiquetas"><span className="tabular-nums">{ripleyLogistics?.labels ?? '—'} etiquetas · {ripleyLogistics?.manifests ?? '—'} manifiestos</span></PropertyRow>

                        <div className="px-2">
                          {ripleyLogistics && !ripleyLogistics.error && (
                            <div className="mt-4 space-y-3">
                              <div className="flex flex-wrap items-end gap-2">
                                <div className="w-24 space-y-1">
                                  <Label htmlFor="ripley-packages" className="text-xs text-muted-foreground">Bultos</Label>
                                  <Input
                                    id="ripley-packages"
                                    type="number"
                                    min={1}
                                    className="h-8"
                                    value={ripleyPackages}
                                    onChange={(event) => setRipleyPackages(event.target.value)}
                                    disabled={Boolean(ripleyLogistics.manifestId)}
                                  />
                                </div>
                                <Button size="sm" variant="outline" onClick={updateRipleyPackages} disabled={Boolean(ripleyAction) || Boolean(ripleyLogistics.manifestId) || Number(ripleyPackages) < 1}>
                                  {ripleyAction === 'packages' && <Loader2 className="animate-spin" />}
                                  Regenerar etiqueta
                                </Button>
                                <Button size="sm" variant="outline" onClick={downloadRipleyLabels} disabled={Boolean(ripleyAction) || !ripleyLogistics.labelId}>
                                  {ripleyAction === 'labels' && <Loader2 className="animate-spin" />}
                                  Descargar etiquetas
                                </Button>
                              </div>
                              {!ripleyLogistics.manifestId && Number(ripleyLogistics.eligibleLabels) > 0 && (
                                <div className="grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)_auto] sm:items-end">
                                  <div className="space-y-1">
                                    <Label htmlFor="ripley-pickup-date" className="text-xs text-muted-foreground">Fecha de recojo</Label>
                                    <Input id="ripley-pickup-date" type="date" className="h-8" value={ripleyPickupDate} onChange={(event) => setRipleyPickupDate(event.target.value)} />
                                  </div>
                                  <div className="space-y-1">
                                    <Label htmlFor="ripley-warehouse" className="text-xs text-muted-foreground">Dirección de almacén</Label>
                                    <Input id="ripley-warehouse" className="h-8" value={ripleyWarehouseAddress} onChange={(event) => setRipleyWarehouseAddress(event.target.value)} />
                                  </div>
                                  <Button size="sm" onClick={createRipleyManifest} disabled={Boolean(ripleyAction) || !ripleyPickupDate || !ripleyWarehouseAddress.trim()}>
                                    {ripleyAction === 'manifest' && <Loader2 className="animate-spin" />}
                                    Crear manifiesto
                                  </Button>
                                </div>
                              )}
                              {ripleyLogistics.manifestId && (
                                <div className="flex flex-wrap gap-2">
                                  <Button size="sm" onClick={downloadRipleyManifest} disabled={Boolean(ripleyAction)}>
                                    {ripleyAction === 'manifest-pdf' && <Loader2 className="animate-spin" />}
                                    Descargar manifiesto
                                  </Button>
                                  <Button size="sm" variant="outline" onClick={detachRipleyLabel} disabled={Boolean(ripleyAction)}>
                                    {ripleyAction === 'detach' && <Loader2 className="animate-spin" />}
                                    Excluir etiqueta
                                  </Button>
                                </div>
                              )}
                              {ripleyActionNote && <p role="status" className="text-xs text-muted-foreground">{ripleyActionNote}</p>}
                            </div>
                          )}
                          {ripleyLogistics?.error && <p role="alert" className="mt-3 text-xs text-amber-700 dark:text-amber-300">{ripleyLogistics.error}</p>}
                          <p className="mt-3 text-xs leading-5 text-muted-foreground">
                            {ripleyLogistics?.sandbox
                              ? 'Vista de prueba local: no consulta Seller Center ni modifica pedidos reales.'
                              : 'Etiquetas y manifiestos pertenecen a Seller Center y se sincronizan aparte de la orden comercial.'}
                          </p>
                        </div>
                      </PropertySection>
                    )}

                    {detail.documentRequirement !== 'disabled' && (
                      <PropertySection id="order-document" title="Comprobante" hint={documentTypeLabel(detail) || undefined}>
                        <div className="px-2">
                          <OrderDocumentPanel key={detail.id} order={detail} onUpdated={() => refreshDetailWhenIdle(detail.id)} />
                        </div>
                      </PropertySection>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="products" className="min-h-0 overflow-y-auto">
                  <div className="px-6 py-2 sm:px-10">
                    {detail.items.length ? (
                      <>
                        <ul>
                          {detail.items.map((item) => {
                            const line = draft?.lines.find((entry) => entry.id === item.id);
                            return (
                              <li key={item.id} className="flex items-start gap-3 border-b border-border/70 py-4 sm:gap-4">
                                <ProductThumb
                                  url={item.imageUrl}
                                  shopSku={item.shopSku}
                                  sku={item.sku}
                                  name={item.productName || item.description || 'Producto'}
                                  className="size-12 rounded-xl bg-muted object-contain ring-1 ring-border/60 sm:size-14"
                                />
                                <div className="min-w-0 flex-1">
                                  <p className="line-clamp-2 text-sm font-medium leading-5" title={item.description || ''}>{item.description || item.productName || item.sku || 'Producto'}</p>
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    {item.sku ? <CopyableValue value={item.sku} className="text-xs text-muted-foreground" /> : 'Sin SKU'}
                                  </div>
                                  <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-[13px] text-muted-foreground">
                                    <InlineNumber
                                      label="Cantidad"
                                      integer
                                      min={1}
                                      value={item.quantity}
                                      display={<span className="text-foreground">{item.quantity} u</span>}
                                      readOnly={!line}
                                      onSave={(quantity) => void saveSaleField(`line-${item.id}`, { lines: draft!.lines.map((entry) => entry.id === item.id ? { ...entry, quantity: String(quantity) } : entry) })}
                                    />
                                    <span aria-hidden="true">×</span>
                                    <InlineNumber
                                      label="Precio unitario"
                                      prefix="S/"
                                      value={item.unitPrice}
                                      display={<span className="text-foreground">{item.unitPrice != null ? formatMoney(item.unitPrice, detail.currency) : '—'}</span>}
                                      readOnly={!line}
                                      onSave={(unitPrice) => void saveSaleField(`line-${item.id}`, { lines: draft!.lines.map((entry) => entry.id === item.id ? { ...entry, unitPrice: String(unitPrice) } : entry) })}
                                    />
                                    {detailSaving.includes(`line-${item.id}`) && <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-label="Guardando" />}
                                  </p>
                                </div>
                                <div className="shrink-0 text-right">
                                  <p className="text-sm font-semibold tabular-nums">{formatMoney(item.total, detail.currency)}</p>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    Comisión{' '}
                                    <InlineNumber
                                      label="Comisión fija por unidad"
                                      prefix="S/"
                                      value={item.commissionAmount ?? 0}
                                      display={formatMoney(item.commissionAmount, detail.currency)}
                                      readOnly={!isAdmin}
                                      onSave={(amount) => void saveCommission(item, amount)}
                                    />
                                  </p>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                        <div className="py-6">
                          <AmountSummary lines={orderAmountLines(detail)} total={formatMoney(detail.total, detail.currency)} />
                        </div>
                      </>
                    ) : (
                      <p className="py-16 text-center text-sm text-muted-foreground">El canal todavía no informó el detalle de productos.</p>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="activity" className="min-h-0 overflow-y-auto">
                  <div className="px-6 py-6 sm:px-10">
                    {detail.events.length ? (
                      <ActivityTimeline groups={activityGroups(detail.events)} />
                    ) : (
                      <p className="py-16 text-center text-sm text-muted-foreground">Todavía no hay actividad registrada.</p>
                    )}
                  </div>
                </TabsContent>

                {detail.channelCode === 'mercado_libre' && (
                  <TabsContent value="messages" className="min-h-0 overflow-y-auto">
                    <BuyerConversation
                      order={{
                        id: detail.id,
                        externalOrderNumber: detail.externalOrderNumber,
                        companyName: companyById.get(detail.companyId || -1) || null,
                        channelCode: detail.channelCode,
                        stage: detail.fulfillmentStatus,
                        customer: detail.customer,
                      }}
                      variant="embedded"
                    />
                  </TabsContent>
                )}
              </Tabs>
            </>
            );
          })() : null}
        </SheetContent>
      </Sheet>

      <Dialog
        open={Boolean(deliverOrder)}
        onOpenChange={(open) => {
          if (!open && !deliverMutation.isPending) {
            deliverMutation.reset();
            setDeliverOrder(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={!deliverMutation.isPending}>
          {deliverOrder && (
            <>
              <DialogHeader>
                <DialogTitle>Confirmar pedido entregado</DialogTitle>
                <DialogDescription>
                  Pedido {deliverOrder.externalOrderNumber}
                  {sellerCellLabel(deliverOrder, companyById) ? ` · ${sellerCellLabel(deliverOrder, companyById)}` : ''}
                </DialogDescription>
              </DialogHeader>
              <div className="flex gap-3 rounded-md border border-teal-200 bg-teal-50 p-4 text-teal-950">
                <PackageCheck className="mt-0.5 size-5 shrink-0" />
                <div>
                  <p className="font-semibold">El pedido de tienda ya salió</p>
                  <p className="mt-1 text-sm text-teal-900">{logisticsDeliverConfirmCopy()}</p>
                </div>
              </div>
              {deliverMutation.error ? (
                <p role="alert" className="flex items-center gap-2 text-[13px] text-destructive">
                  <AlertCircle className="size-3.5 shrink-0" />
                  {(deliverMutation.error as Error).message || 'No se pudo marcar el pedido como entregado.'}
                </p>
              ) : null}
              <DialogFooter>
                <Button variant="outline" onClick={() => { deliverMutation.reset(); setDeliverOrder(null); }} disabled={deliverMutation.isPending}>Cancelar</Button>
                <Button onClick={() => deliverMutation.mutate(deliverOrder)} disabled={deliverMutation.isPending}>
                  {deliverMutation.isPending ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <PackageCheck />}
                  Confirmar entregado
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <RegisterPaymentDialog
        order={paymentOrder}
        busy={paymentMutation.isPending}
        error={(paymentMutation.error as Error | undefined)?.message || ''}
        onClose={() => {
          paymentMutation.reset();
          setPaymentOrder(null);
        }}
        onSubmit={(input) => {
          if (!paymentOrder) return;
          paymentMutation.mutate({ order: paymentOrder, ...input });
        }}
      />

    </div>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      className="inline-flex h-7 max-w-48 cursor-pointer items-center gap-1 rounded-md border border-border bg-muted/40 px-2 text-xs font-medium text-foreground hover:bg-muted"
    >
      <span className="truncate">{label}</span>
      <X className="size-3 shrink-0 text-muted-foreground" />
    </button>
  );
}

function ProductThumb({ url, shopSku, sku, name, className }: { url?: string | null; shopSku?: string | null; sku?: string | null; name: string; className?: string }) {
  const candidates = [productImageSrc(url), productImageSrc(null, shopSku), productImageSrc(null, null, sku)].filter((src, index, list) => src && list.indexOf(src) === index);
  const [failedCount, setFailedCount] = useState(0);
  const src = candidates[failedCount] || '';
  if (!src) {
    return (
      <span className={cn('grid size-8 shrink-0 place-items-center rounded-md bg-muted', className)} aria-hidden="true">
        <Package className="size-4 text-muted-foreground" />
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      title={name}
      loading="lazy"
      decoding="async"
      onError={() => setFailedCount((current) => current + 1)}
      className={cn('size-8 shrink-0 rounded-md bg-muted object-cover', className)}
    />
  );
}

function OrderProductCell({ items }: { items?: ManagedOrderListItem[] }) {
  const item = items?.[0];
  if (!item) {
    return (
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted" aria-hidden="true">
        <Package className="size-4 text-muted-foreground" />
      </span>
    );
  }
  const extra = (items?.length || 1) - 1;
  const units = (items || []).reduce((sum, entry) => sum + (Number(entry.quantity) || 0), 0);
  const skuLine = [item.sku, extra > 0 ? `+${extra} más` : ''].filter(Boolean).join(' · ');
  return (
    <div className="flex min-w-0 items-center gap-2">
      <ProductThumb url={item.imageUrl} shopSku={item.shopSku} sku={item.sku} name={item.name || 'Producto'} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium leading-5" title={item.name || ''}>{item.name || 'Producto'}</p>
        <p className="truncate text-[11px] text-muted-foreground">{skuLine || 'Sin SKU'}</p>
      </div>
      <QuantityTag quantity={units} />
    </div>
  );
}

const DELIVERY_TYPE_OPTIONS = [
  { value: 'recojo', label: 'Recojo en tienda' },
  { value: 'envio', label: 'Envío' },
] as const;

function formatDeliveryDay(value?: string | null) {
  const day = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day || 'Sin fecha';
  return new Intl.DateTimeFormat('es-PE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'America/Lima' })
    .format(new Date(`${day}T12:00:00-05:00`));
}

/** Refleja en el detalle lo que el servidor guardará, para que la edición se vea al instante. */
function applyManualDraft(order: OrderDetail, draft: ManualOrderEditDraft): OrderDetail {
  const payload = buildManualOrderEditPayload(draft);
  const items = order.items.map((item) => {
    const line = payload.items.find((entry) => entry.id === item.id);
    return line ? { ...item, quantity: line.quantity, unitPrice: line.unitPrice, total: Math.round(line.quantity * line.unitPrice * 100) / 100 } : item;
  });
  const subtotal = items.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
  return {
    ...order,
    customer: { ...order.customer, ...payload.customer },
    shipping: { ...order.shipping, ...payload.shipping },
    metadata: { ...order.metadata, deliveryDate: payload.deliveryDate, delivery: payload.shipping.type, shippingCarrier: payload.shipping.carrier },
    items,
    subtotal,
    total: subtotal + (Number(order.shippingAmount) || 0),
  };
}

function manualEditDraftFromOrder(order: OrderDetail): ManualOrderEditDraft {
  const shipping = order.shipping || {};
  return {
    customerName: order.customer?.name || '',
    customerPhone: order.customer?.phone || '',
    documentType: String(order.customer?.documentType || '1'),
    documentNumber: order.customer?.documentNumber || '',
    legalName: order.customer?.legalName || '',
    deliveryType: shipping.type === 'envio' ? 'envio' : 'recojo',
    carrier: String(shipping.carrier || order.metadata?.shippingCarrier || ''),
    address: String(shipping.address || ''),
    reference: String(shipping.reference || ''),
    deliveryDate: String(order.metadata?.deliveryDate || '').slice(0, 10),
    lines: order.items.map((item) => ({
      id: item.id,
      name: item.description || item.sku || `Producto ${item.id}`,
      quantity: String(item.quantity ?? 1),
      unitPrice: item.unitPrice == null ? '' : String(item.unitPrice),
    })),
  };
}

function RegisterPaymentDialog({
  order,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  order: ManagedOrder | null;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (input: {
    paymentMethod: string;
    receivedBy: string;
    paidTo?: string;
    paymentProof: { name: string; type: string; dataUrl: string } | null;
  }) => void;
}) {
  const [paymentMethod, setPaymentMethod] = useState<(typeof RECORD_PAYMENT_METHODS)[number]['value']>('efectivo');
  const [receivedBy, setReceivedBy] = useState('');
  const [paidTo, setPaidTo] = useState<'empresa' | 'vendedor'>('empresa');
  const [paymentProof, setPaymentProof] = useState<{ name: string; type: string; dataUrl: string } | null>(null);
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (!order) return;
    setPaymentMethod('efectivo');
    setReceivedBy('');
    setPaidTo('empresa');
    setPaymentProof(null);
    setLocalError('');
  }, [order]);

  const attachProof = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setLocalError('La constancia debe ser una foto o captura.');
      return;
    }
    if (file.size > 1_500_000) {
      setLocalError('La constancia pesa más de 1.5 MB. Usa una foto más liviana.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setPaymentProof({ name: file.name, type: file.type, dataUrl: String(reader.result || '') });
      setLocalError('');
    };
    reader.readAsDataURL(file);
  };

  return (
    <Dialog open={Boolean(order)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar pago</DialogTitle>
          <DialogDescription>
            {order ? `Pedido ${order.externalOrderNumber} · ${formatMoney(order.total, order.currency)}` : ''}
          </DialogDescription>
        </DialogHeader>
        {(localError || error) && (
          <div role="alert" className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
            <AlertCircle className="size-4 shrink-0" /> {localError || error}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {RECORD_PAYMENT_METHODS.map((method) => (
            <button
              key={method.value}
              type="button"
              onClick={() => {
                setPaymentMethod(method.value);
                if (method.value === 'efectivo') setPaymentProof(null);
                if (method.value !== 'efectivo') setReceivedBy('');
                if (method.value !== 'yape_plin' && method.value !== 'transferencia') setPaidTo('empresa');
              }}
              className={cn(
                'inline-flex h-9 cursor-pointer items-center rounded-md border px-3 text-sm font-medium',
                paymentMethod === method.value ? 'border-foreground bg-foreground text-background' : 'border-border bg-background hover:bg-muted',
              )}
            >
              {method.label}
            </button>
          ))}
        </div>
        {paymentMethod === 'efectivo' && (
          <div className="space-y-1.5">
            <Label htmlFor="pay-received-by">¿Quién cobró?</Label>
            <Input id="pay-received-by" value={receivedBy} onChange={(event) => setReceivedBy(event.target.value)} placeholder="Opcional" />
          </div>
        )}
        {(paymentMethod === 'yape_plin' || paymentMethod === 'transferencia') && (
          <div className="space-y-1.5">
            <Label>Pagaron a</Label>
            <div className="flex flex-wrap gap-2">
              {[{ value: 'empresa', label: 'Empresa' }, { value: 'vendedor', label: 'Vendedor' }].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setPaidTo(option.value as 'empresa' | 'vendedor')}
                  className={cn(
                    'inline-flex h-9 cursor-pointer items-center rounded-md border px-3 text-sm font-medium',
                    paidTo === option.value ? 'border-foreground bg-foreground text-background' : 'border-border bg-background hover:bg-muted',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">A veces pagan al vendedor.</p>
          </div>
        )}
        {(paymentMethod === 'yape_plin' || paymentMethod === 'transferencia') && (
          <div className="space-y-1.5">
            <Label>Constancia</Label>
            {paymentProof ? (
              <div className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5">
                <img src={paymentProof.dataUrl} alt="" className="size-12 rounded object-cover" />
                <span className="min-w-0 flex-1 truncate text-sm">{paymentProof.name}</span>
                <Button type="button" variant="ghost" size="icon-sm" className="size-8 cursor-pointer" aria-label="Quitar constancia" onClick={() => setPaymentProof(null)}>
                  <X />
                </Button>
              </div>
            ) : (
              <label className="flex h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-sm text-muted-foreground hover:bg-muted/40">
                <ImagePlus className="size-5" />
                Foto opcional
                <input type="file" accept="image/*" className="sr-only" onChange={(event) => attachProof(event.target.files?.[0])} />
              </label>
            )}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" className="cursor-pointer" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button
            type="button"
            className="cursor-pointer"
            disabled={busy}
            onClick={() => onSubmit({
              paymentMethod,
              receivedBy,
              paidTo: paymentMethod === 'yape_plin' || paymentMethod === 'transferencia' ? paidTo : undefined,
              paymentProof,
            })}
          >
            {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Banknote />}
            {busy ? 'Guardando…' : 'Registrar pago'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
