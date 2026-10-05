import { OrderDateDialog, orderDateKey, formatRegistrationDate } from '../components/OrderDateDialog';
import OrderDocumentPanel from '../components/OrderDocumentPanel';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ColumnDef, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import {
  AlertCircle,
  Banknote,
  Check,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  Clock3,
  Copy,
  Eye,
  FileText,
  Hash,
  ImagePlus,
  Loader2,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Package,
  PanelTop,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Store,
  Tags,
  Truck,
  UserRound,
  X,
} from 'lucide-react';
import { ChannelMark } from '../components/channel-mark';
import { BuyerConversation } from '../components/buyer-messages/BuyerConversation';
import { QuantityTag } from '../components/QuantityTag';
import api from '../lib/api';
import { cn } from '../lib/cn';
import { usePermissions } from '../hooks/usePermissions';
import { SHIPPING_CARRIERS } from '../lib/shipping-carrier';
import { mercadoLibreDispatchCopy, sellerDispatchesMercadoLibre } from '../lib/logistics-inbox';
import {
  buildManualOrderEditPayload,
  MANUAL_EDIT_DOCUMENT_TYPES,
  validateManualOrderEdit,
  type ManualOrderEditDraft,
  type ManualOrderEditLine,
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

type OrderEvent = {
  id: number;
  eventType: string;
  source: string;
  actorName?: string | null;
  actorUserId?: string | null;
  payload?: { orderDate?: string };
  previousValues?: { orderedAt?: string };
  newValues?: { orderedAt?: string };
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

function documentTone(status: string) {
  return status === 'accepted'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
    : status === 'rejected' || status === 'cancelled'
      ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300'
      : status === 'pending'
        ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300'
        : 'border-border bg-muted/40 text-muted-foreground';
}

function documentTypeLabel(order: ManagedOrder) {
  if (order.documentDecision?.type === 'factura') return 'Factura';
  if (order.documentDecision?.type === 'boleta') return 'Boleta';
  return '';
}

function documentBadge(order: ManagedOrder) {
  if (order.documentRequirement === 'disabled') {
    return <Badge variant="outline" className="rounded-md text-muted-foreground">No aplica</Badge>;
  }
  const status = order.documentStatus;
  const type = documentTypeLabel(order);
  return (
    <Badge variant="outline" className={cn('rounded-md', documentTone(status))}>
      {DOCUMENT_LABELS[status] || status}{type ? ` · ${type}` : ''}
    </Badge>
  );
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

  const goToGenerateDocument = (order: ManagedOrder) => {
    setDetailTab('summary');
    void openDetail(order, 'summary');
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
  const [editOrder, setEditOrder] = useState<OrderDetail | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [commissionEditing, setCommissionEditing] = useState<number | null>(null);
  const [commissionDraft, setCommissionDraft] = useState('');
  const [commissionSaving, setCommissionSaving] = useState(false);
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

  const companies = (Array.isArray(companiesQuery.data) ? companiesQuery.data : []) as Company[];
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

  const loadRipleyLogistics = async (order: ManagedOrder, sandbox: boolean) => {
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
  };

  const openDetail = async (order: ManagedOrder, tab = 'products') => {
    setDetailTab(tab);
    setDetailOpen(true);
    setDetail(null);
    setRipleyLogistics(null);
    setRipleyActionNote('');
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
  };

  const saveCommission = async (item: OrderItem) => {
    if (!detail) return;
    const amount = Number(commissionDraft.replace(',', '.'));
    if (!Number.isFinite(amount) || amount < 0) return;
    setCommissionSaving(true);
    try {
      const updated = await api.updateManagedOrderItemCommission(detail.id, item.id, amount);
      setDetail(updated);
      setCommissionEditing(null);
    } finally {
      setCommissionSaving(false);
    }
  };

  const openEdit = async (order: ManagedOrder) => {
    setEditOpen(true);
    setEditOrder(null);
    setEditLoading(true);
    try {
      setEditOrder(await api.getManagedOrder(order.id));
    } catch {
      setEditOpen(false);
    } finally {
      setEditLoading(false);
    }
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

  const editMutation = useMutation({
    mutationFn: (input: { orderId: number; payload: ReturnType<typeof buildManualOrderEditPayload> }) =>
      api.updateManagedOrder(input.orderId, input.payload),
    onSuccess: (updated, input) => {
      void queryClient.invalidateQueries({ queryKey: ['managed-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['managed-order-sales-pulse'] });
      setEditOpen(false);
      setEditOrder(null);
      if (detail?.id === input.orderId) {
        void api.getManagedOrder(input.orderId).then(setDetail).catch(() => {});
      }
      setSuccessMessage(`Venta ${updated?.externalOrderNumber || ''} actualizada.`);
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
                  <DropdownMenuItem onClick={() => void openEdit(row.original)}>
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
         <SheetContent className="sm:max-w-xl">
          {detailLoading ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="size-5 animate-spin motion-reduce:animate-none" /> Cargando detalle…
            </div>
          ) : detail ? (
            <>

               <SheetHeader className="border-b border-border bg-muted/20 px-6 py-5 pr-16">
                 <div className="flex min-w-0 items-start gap-3">
                   <ChannelMark code={detail.channelCode} name={detail.channelName} size="lg" ripley="wordmark" />
                   <div className="min-w-0 flex-1">
                     <SheetDescription className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Detalle de pedido</SheetDescription>
                     <SheetTitle className="text-2xl tracking-tight">{detail.externalOrderNumber}</SheetTitle>
                     <p className="mt-1 truncate text-sm text-muted-foreground">
                       {[detail.channelName, sellerCellLabel(detail, companyById)].filter(Boolean).join(' · ')}
                     </p>
                   </div>
                   <div className="hidden shrink-0 text-right sm:block">
                     <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total</p>
                     <p className="mt-1 text-lg font-semibold tabular-nums">{formatMoney(detail.total, detail.currency)}</p>
                   </div>
                 </div>
               </SheetHeader>
                 <Tabs key={detail.id} value={detailTab} onValueChange={setDetailTab} className="min-h-0 flex-1 gap-0 overflow-hidden">
                 <TabsList aria-label="Secciones del pedido" className="h-16 w-full shrink-0 justify-start gap-1 overflow-x-auto border-b border-border px-6 py-2">
                   <TabsTrigger value="summary" className="h-full flex-none rounded-xl px-4 text-sm text-muted-foreground data-[state=active]:bg-muted data-[state=active]:text-foreground">
                     <PanelTop /> Resumen
                   </TabsTrigger>
                   <TabsTrigger value="products" className="h-full flex-none rounded-xl px-4 text-sm text-muted-foreground data-[state=active]:bg-muted data-[state=active]:text-foreground">
                     <Package /> Productos <span className="tabular-nums text-muted-foreground">{detail.items.length}</span>
                   </TabsTrigger>
                   <TabsTrigger value="activity" className="h-full flex-none rounded-xl px-4 text-sm text-muted-foreground data-[state=active]:bg-muted data-[state=active]:text-foreground">
                    <Clock3 /> Actividad <span className="tabular-nums text-muted-foreground">{detail.events.length}</span>
                  </TabsTrigger>
                  {detail.channelCode === 'mercado_libre' && (
                    <TabsTrigger value="messages" className="h-full flex-none rounded-xl px-4 text-sm text-muted-foreground data-[state=active]:bg-muted data-[state=active]:text-foreground">
                      <MessageCircle /> Mensajes
                    </TabsTrigger>
                  )}
                </TabsList>

                <TabsContent value="summary" className="min-h-0 overflow-y-auto">
                   <section className="border-b border-border px-6 py-5">
                     <div className="mb-4 flex items-end justify-between gap-3">
                       <div>
                         <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Estado actual</p>
                         <h3 className="mt-1 text-lg font-semibold tracking-tight">Resumen del pedido</h3>
                       </div>
                       <span className="text-xs text-muted-foreground">{detail.items.length} {detail.items.length === 1 ? 'producto' : 'productos'}</span>
                     </div>
                      <div className="space-y-0.5">
                      <DetailField icon={<Clock3 />} label="Fecha de registro" content={(
                        <div className="flex flex-wrap items-center gap-2">
                          <span>{formatRegistrationDate(detail.orderedAt || detail.createdAt)}</span>
                          {isAdmin && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              className="cursor-pointer text-muted-foreground hover:text-foreground"
                              aria-label="Cambiar fecha de registro"
                              title="Cambiar fecha de registro"
                              onClick={() => { dateMutation.reset(); setDateOrder(detail); }}
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                          )}
                        </div>
                      )} />
                      <DetailField icon={<Truck />} label="Despacho" content={fulfillmentBadge(detail.fulfillmentStatus)} />
                      <DetailField icon={<Banknote />} label="Pago" content={paymentBadge(detail.paymentStatus) || <span className="text-muted-foreground">Sin dato</span>} />
                      <DetailField icon={<Package />} label="Entrega" content={deliveryBadge(detail)} />
                      <DetailField icon={<FileText />} label="Comprobante" content={<button type="button" onClick={() => setDetailTab('summary')} aria-label="Ver comprobante del pedido">{documentBadge(detail)}</button>} />
                       <DetailField icon={<CircleDollarSign />} label="Total" content={<span className="font-semibold tabular-nums">{formatMoney(detail.total, detail.currency)}</span>} />
                      {Number(detail.shippingAmount) > 0 && (
                        // Un solo cobro, el de la zona. Los kilómetros son referencia.
                        <DetailField
                          icon={<Truck />}
                          label="Envío"
                          content={(
                            <span>
                              <span className="tabular-nums">{formatMoney(detail.shippingAmount, detail.currency)}</span>
                              <span className="block text-xs text-muted-foreground tabular-nums">
                                {detail.shipping?.priceZone ? `Zona ${detail.shipping.priceZone}` : 'Envío propio'}
                                {detail.shipping?.zoneLabel ? ` · ${detail.shipping.zoneLabel}` : ''}
                                {detail.shipping?.distanceKm != null ? ` · ${Number(detail.shipping.distanceKm).toFixed(1).replace('.', ',')} km` : ''}
                              </span>
                            </span>
                          )}
                        />
                      )}
                    </div>
                  </section>

                  {detail.channelCode === 'mercado_libre' && (
                    <section className="border-b border-border px-6 py-5">
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold">Envío de Mercado Libre</h3>
                        {detail.metadata?.shippingMode && (
                          <Badge variant="outline" className="uppercase">{detail.metadata.shippingMode}</Badge>
                        )}
                        {sellerDispatchesMercadoLibre(detail.metadata?.logisticType) && (
                          <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">Despachas tú</Badge>
                        )}
                      </div>
                      <div className="space-y-0.5">
                        <DetailField
                          icon={<Clock3 />}
                          label="Entrega estimada"
                          content={<span className="font-medium">{formatEstimatedDelivery(detail.promisedShippingAt)}</span>}
                        />
                        <DetailField
                          icon={<Truck />}
                          label="Despacho"
                          content={<span>{mercadoLibreDispatchCopy(detail.metadata?.logisticType)}</span>}
                        />
                        <DetailField
                          icon={<Store />}
                          label="Transportista"
                          content={<span className="font-medium">{detail.shipping?.carrier || 'Mercado Envíos'}</span>}
                        />
                        <DetailField
                          icon={<Hash />}
                          label="Seguimiento"
                          content={<span className="break-all font-mono text-xs">{detail.shipping?.trackingCode || '—'}</span>}
                        />
                        <DetailField
                          icon={<UserRound />}
                          label="Destinatario"
                          content={(
                            <span>
                              <span className="font-medium">{detail.customer?.name || 'Sin nombre'}</span>
                              {detail.customer?.documentNumber ? (
                                <span className="block text-xs text-muted-foreground">DNI {detail.customer.documentNumber}</span>
                              ) : null}
                            </span>
                          )}
                        />
                        <DetailField
                          icon={<MapPin />}
                          label="Dirección"
                          content={(
                            <span className="whitespace-pre-wrap">
                              <span>{shippingAddress(detail.shipping) || '—'}</span>
                              {[detail.shipping?.district || detail.shipping?.city, detail.shipping?.region].filter(Boolean).length ? (
                                <span className="block text-xs text-muted-foreground">
                                  {[detail.shipping?.district || detail.shipping?.city, detail.shipping?.region].filter(Boolean).join(' · ')}
                                </span>
                              ) : null}
                            </span>
                          )}
                        />
                      </div>
                    </section>
                  )}

                  {detail.channelCode === 'ripley' && (
                   <section className="border-b border-border px-6 py-5">
                      <div className="mb-3 flex items-center gap-2">
                        <h3 className="text-sm font-semibold">Logística Ripley</h3>
                        {ripleyLogistics?.sandbox && <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">Sandbox simulado</Badge>}
                      </div>
                      <div className="space-y-0.5">
                        <DetailField icon={<Store />} label="Estado comercial" content={<span className="font-medium">{detail.providerStatus || 'Sin dato'}</span>} />
                        <DetailField icon={<Truck />} label="Estado logístico" content={<span className="font-medium">{detail.metadata?.ripleySvc?.statusManagement || 'SVC no configurado o pendiente de sincronizar'}</span>} />
                        <DetailField icon={<Package />} label="Bultos" content={<span className="font-medium tabular-nums">{detail.metadata?.ripleySvc?.packages ?? '—'}</span>} />
                        <DetailField icon={<Hash />} label="Orden interna SVC" content={<span className="break-all font-mono text-xs">{detail.metadata?.ripleySvc?.orderId || '—'}</span>} />
                        <DetailField icon={<Tags />} label="Etiquetas SVC" content={<span className="font-medium tabular-nums">{ripleyLogistics?.labels ?? '—'}</span>} />
                        <DetailField icon={<ClipboardList />} label="Manifiestos SVC" content={<span className="font-medium tabular-nums">{ripleyLogistics?.manifests ?? '—'}</span>} />
                      </div>

                      {ripleyLogistics && !ripleyLogistics.error && (
                        <div className="mt-5 space-y-3">
                          <p className="text-xs font-medium text-muted-foreground">Acciones logísticas</p>
                          <div className="flex flex-wrap items-end gap-2">
                            <div className="w-28 space-y-1">
                              <Label htmlFor="ripley-packages" className="text-xs">Bultos</Label>
                              <Input
                                id="ripley-packages"
                                type="number"
                                min={1}
                                value={ripleyPackages}
                                onChange={(event) => setRipleyPackages(event.target.value)}
                                disabled={Boolean(ripleyLogistics.manifestId)}
                              />
                            </div>
                            <Button
                              variant="outline"
                              onClick={updateRipleyPackages}
                              disabled={Boolean(ripleyAction) || Boolean(ripleyLogistics.manifestId) || Number(ripleyPackages) < 1}
                            >
                              {ripleyAction === 'packages' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                              Regenerar etiqueta
                            </Button>
                            <Button variant="outline" onClick={downloadRipleyLabels} disabled={Boolean(ripleyAction) || !ripleyLogistics.labelId}>
                              {ripleyAction === 'labels' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                              Descargar etiquetas
                            </Button>
                          </div>

                          {!ripleyLogistics.manifestId && Number(ripleyLogistics.eligibleLabels) > 0 && (
                            <div className="grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)_auto] sm:items-end">
                              <div className="space-y-1">
                                <Label htmlFor="ripley-pickup-date" className="text-xs">Fecha de recojo</Label>
                                <Input id="ripley-pickup-date" type="date" value={ripleyPickupDate} onChange={(event) => setRipleyPickupDate(event.target.value)} />
                              </div>
                              <div className="space-y-1">
                                <Label htmlFor="ripley-warehouse" className="text-xs">Dirección de almacén</Label>
                                <Input id="ripley-warehouse" value={ripleyWarehouseAddress} onChange={(event) => setRipleyWarehouseAddress(event.target.value)} />
                              </div>
                              <Button onClick={createRipleyManifest} disabled={Boolean(ripleyAction) || !ripleyPickupDate || !ripleyWarehouseAddress.trim()}>
                                {ripleyAction === 'manifest' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Agendar y crear manifiesto
                              </Button>
                            </div>
                          )}

                          {ripleyLogistics.manifestId && (
                            <div className="flex flex-wrap gap-2">
                              <Button onClick={downloadRipleyManifest} disabled={Boolean(ripleyAction)}>
                                {ripleyAction === 'manifest-pdf' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Descargar manifiesto
                              </Button>
                              <Button variant="outline" onClick={detachRipleyLabel} disabled={Boolean(ripleyAction)}>
                                {ripleyAction === 'detach' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Excluir etiqueta
                              </Button>
                            </div>
                          )}
                          {ripleyActionNote && <p className="text-xs text-muted-foreground">{ripleyActionNote}</p>}
                        </div>
                      )}
                      {ripleyLogistics?.error && <p className="mt-3 text-xs text-amber-700">{ripleyLogistics.error}</p>}
                      <p className="mt-3 text-xs leading-5 text-muted-foreground">
                        {ripleyLogistics?.sandbox
                          ? 'Vista de prueba local: no consulta Seller Center ni modifica pedidos reales.'
                          : 'Las etiquetas y manifiestos pertenecen a Seller Center; se sincronizan por polling separado de la orden comercial.'}
                      </p>
                    </section>
                  )}

                  <OrderDocumentPanel key={detail.id} order={detail} onUpdated={async () => setDetail(await api.getManagedOrder(detail.id))} />
                </TabsContent>

                 <TabsContent value="products" className="min-h-0 overflow-y-auto px-6 py-5">
                   <div className="mb-5 flex items-end justify-between gap-3">
                     <div>
                       <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Detalle comercial</p>
                       <h3 className="mt-1 text-lg font-semibold tracking-tight">Productos del pedido</h3>
                     </div>
                     <p className="text-right text-xs text-muted-foreground">Comisión fija<br />por unidad</p>
                   </div>
                   <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                     {detail.items.length ? detail.items.map((item) => (
                       <div key={item.id} className="flex items-start justify-between gap-4 px-4 py-4 transition-colors hover:bg-muted/30">
                         <div className="flex min-w-0 items-start gap-3">
                           <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Package className="size-4" /></span>
                           <div className="min-w-0">
                             <p className="font-medium leading-5">{item.description || item.sku || 'Producto'}</p>
                             <p className="mt-1 text-xs text-muted-foreground"><span className="font-mono">{item.sku || 'Sin SKU'}</span> · {item.quantity} {Number(item.quantity) === 1 ? 'unidad' : 'unidades'}</p>
                           </div>
                         </div>
                         <div className="shrink-0 text-right">
                           <span className="block font-medium tabular-nums">{formatMoney(item.total, detail.currency)}</span>
                           {commissionEditing === item.id ? (
                             <div className="mt-1 flex items-center justify-end gap-1">
                               <Label htmlFor={`commission-${item.id}`} className="sr-only">Comisión fija</Label>
                                  <div className="relative">
                                    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-medium text-muted-foreground">S/</span>
                                    <Input
                                  id={`commission-${item.id}`}
                                  type="text"
                                  inputMode="decimal"
                                  autoComplete="off"
                                  aria-label="Monto de comisión en soles"
                                  className="h-10 w-32 rounded-lg pl-9 pr-3 text-right text-base tabular-nums [appearance:textfield]"
                                  value={commissionDraft}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                      event.preventDefault();
                                      void saveCommission(item);
                                    }
                                  }}
                                  onChange={(event) => {
                                    const next = event.target.value.replace(/[^0-9.,]/g, '').replace(',', '.');
                                    const [whole, decimals = ''] = next.split('.');
                                    setCommissionDraft(decimals.length > 2 ? `${whole}.${decimals.slice(0, 2)}` : next);
                                  }}
                                  autoFocus
                                    />
                                  </div>
                                <Button size="sm" className="h-10 rounded-lg px-3" disabled={commissionSaving} onClick={() => void saveCommission(item)}>
                                  {commissionSaving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}<span className="sr-only">Guardar comisión</span>
                                </Button>
                                <Button size="sm" variant="ghost" className="h-10 rounded-lg px-3" onClick={() => setCommissionEditing(null)}><X className="size-4" /><span className="sr-only">Cancelar</span></Button>
                             </div>
                           ) : isAdmin ? (
                             <button
                               type="button"
                               className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                               onClick={() => { setCommissionEditing(item.id); setCommissionDraft(String(item.commissionAmount ?? 0)); }}
                             >
                               Comisión {formatMoney(item.commissionAmount, detail.currency)} <Pencil className="size-3" />
                             </button>
                           ) : <span className="mt-1 block text-xs text-muted-foreground">Comisión {formatMoney(item.commissionAmount, detail.currency)}</span>}
                         </div>
                      </div>
                    )) : <p className="py-3 text-sm text-muted-foreground">El canal todavía no informó el detalle de productos.</p>}
                  </div>
                </TabsContent>

                <TabsContent value="activity" className="min-h-0 overflow-y-auto px-5 py-5">
                  <h3 className="mb-3 text-sm font-semibold">Actividad del pedido</h3>
                  <div className="space-y-1">
                    {[...detail.events].reverse().map((event) => (
                      <div key={event.id} className="flex gap-3 py-2.5">
                        {event.eventType.includes('created') ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <Clock3 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                        <div className="min-w-0">
                          <p className="font-medium">{EVENT_LABELS[event.eventType] || event.eventType}</p>
                          {event.eventType === 'order.created' && event.payload?.orderDate && <p className="mt-1 text-xs">Fecha de registro elegida: {event.payload.orderDate}</p>}
                          {event.eventType === 'order.date_changed' && <p className="mt-1 text-xs">{formatRegistrationDate(event.previousValues?.orderedAt)} → {formatRegistrationDate(event.newValues?.orderedAt)}</p>}
                          <p className="mt-0.5 text-xs text-muted-foreground">{event.actorName || event.actorUserId || SOURCE_LABELS[event.source] || event.source} · {formatRegistrationDate(event.providerOccurredAt || event.createdAt)}</p>
                        </div>
                      </div>
                    ))}
                    {!detail.events.length && <p className="text-sm text-muted-foreground">Todavía no hay eventos registrados.</p>}
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
          ) : null}
        </SheetContent>
      </Sheet>

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

      <EditManualOrderDialog
        open={editOpen}
        order={editOrder}
        loading={editLoading}
        busy={editMutation.isPending}
        error={(editMutation.error as Error | undefined)?.message || ''}
        onClose={() => {
          editMutation.reset();
          setEditOpen(false);
          setEditOrder(null);
        }}
        onSubmit={(payload) => {
          if (!editOrder) return;
          editMutation.mutate({ orderId: editOrder.id, payload });
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

function ProductThumb({ url, shopSku, sku, name }: { url?: string | null; shopSku?: string | null; sku?: string | null; name: string }) {
  const candidates = [productImageSrc(url), productImageSrc(null, shopSku), productImageSrc(null, null, sku)].filter((src, index, list) => src && list.indexOf(src) === index);
  const [failedCount, setFailedCount] = useState(0);
  const src = candidates[failedCount] || '';
  if (!src) {
    return (
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted" aria-hidden="true">
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
      className="size-8 shrink-0 rounded-md bg-muted object-cover"
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

function DetailField({ icon, label, content }: { icon: React.ReactNode; label: string; content: React.ReactNode }) {
  return (
    <div className="grid min-h-10 grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)] items-center gap-4 py-2">
      <p className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0">
        {icon}
        <span>{label}</span>
      </p>
      <div className="min-w-0 overflow-hidden text-sm text-foreground [&>*]:max-w-full">{content}</div>
    </div>
  );
}

const EMPTY_MANUAL_EDIT_DRAFT: ManualOrderEditDraft = {
  customerName: '',
  customerPhone: '',
  documentType: '1',
  documentNumber: '',
  legalName: '',
  deliveryType: 'recojo',
  carrier: '',
  address: '',
  reference: '',
  deliveryDate: '',
  lines: [],
};

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

function EditManualOrderDialog({
  open,
  order,
  loading,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  order: OrderDetail | null;
  loading: boolean;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (payload: ReturnType<typeof buildManualOrderEditPayload>) => void;
}) {
  const [draft, setDraft] = useState<ManualOrderEditDraft>(EMPTY_MANUAL_EDIT_DRAFT);
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (!order) {
      setDraft(EMPTY_MANUAL_EDIT_DRAFT);
      return;
    }
    setDraft(manualEditDraftFromOrder(order));
    setLocalError('');
  }, [order]);

  const patch = (change: Partial<ManualOrderEditDraft>) =>
    setDraft((current) => ({ ...current, ...change }));
  const patchLine = (id: number, change: Partial<ManualOrderEditLine>) =>
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) => (line.id === id ? { ...line, ...change } : line)),
    }));

  const submit = () => {
    const invalid = validateManualOrderEdit(draft);
    if (invalid) {
      setLocalError(invalid);
      return;
    }
    setLocalError('');
    onSubmit(buildManualOrderEditPayload(draft));
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar venta</DialogTitle>
          <DialogDescription>
            {order ? `Pedido ${order.externalOrderNumber}. Corrige cliente, entrega o líneas.` : 'Cargando pedido…'}
          </DialogDescription>
        </DialogHeader>
        {(localError || error) && (
          <div role="alert" className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
            <AlertCircle className="size-4 shrink-0" /> {localError || error}
          </div>
        )}
        {loading || !order ? (
          <div className="flex flex-1 items-center justify-center gap-2 py-10 text-muted-foreground">
            <Loader2 className="size-5 animate-spin motion-reduce:animate-none" /> Cargando pedido…
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cliente</p>
              <div className="space-y-1.5">
                <Label htmlFor="edit-customer-name">Nombre</Label>
                <Input id="edit-customer-name" value={draft.customerName} onChange={(event) => patch({ customerName: event.target.value })} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-customer-phone">Teléfono</Label>
                  <Input id="edit-customer-phone" inputMode="numeric" value={draft.customerPhone} onChange={(event) => patch({ customerPhone: event.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-customer-document">Documento</Label>
                  <div className="flex gap-2">
                    <Select value={draft.documentType} onValueChange={(value) => patch({ documentType: value })}>
                      <SelectTrigger className="w-24" aria-label="Tipo de documento"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MANUAL_EDIT_DOCUMENT_TYPES.map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input id="edit-customer-document" value={draft.documentNumber} onChange={(event) => patch({ documentNumber: event.target.value })} />
                  </div>
                </div>
              </div>
              {draft.documentType === '6' && (
                <div className="space-y-1.5">
                  <Label htmlFor="edit-customer-legal">Razón social</Label>
                  <Input id="edit-customer-legal" value={draft.legalName} onChange={(event) => patch({ legalName: event.target.value })} />
                </div>
              )}
            </div>

            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Entrega</p>
              <div className="flex flex-wrap gap-2">
                {(['recojo', 'envio'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => patch({ deliveryType: option, ...(option === 'recojo' ? { carrier: '' } : {}) })}
                    className={cn(
                      'inline-flex h-9 cursor-pointer items-center rounded-md border px-3 text-sm font-medium',
                      draft.deliveryType === option ? 'border-foreground bg-foreground text-background' : 'border-border bg-background hover:bg-muted',
                    )}
                  >
                    {option === 'recojo' ? 'Recojo' : 'Envío'}
                  </button>
                ))}
              </div>
              {draft.deliveryType === 'envio' && (
                <>
                  <div className="space-y-1.5">
                    <Label>Repartidor</Label>
                    <Select value={draft.carrier} onValueChange={(value) => patch({ carrier: value })}>
                      <SelectTrigger aria-label="Repartidor"><SelectValue placeholder="Elige repartidor" /></SelectTrigger>
                      <SelectContent>
                        {SHIPPING_CARRIERS.map((carrier) => (
                          <SelectItem key={carrier.value} value={carrier.value}>{carrier.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-address">Dirección</Label>
                    <Input id="edit-address" value={draft.address} onChange={(event) => patch({ address: event.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-reference">Referencia</Label>
                    <Input id="edit-reference" value={draft.reference} onChange={(event) => patch({ reference: event.target.value })} />
                  </div>
                </>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="edit-delivery-date">Fecha de entrega</Label>
                <Input id="edit-delivery-date" type="date" value={draft.deliveryDate} onChange={(event) => patch({ deliveryDate: event.target.value })} />
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Productos</p>
              <ul className="divide-y divide-border rounded-md border border-border">
                {draft.lines.map((line) => (
                  <li key={line.id} className="grid grid-cols-[minmax(0,1fr)_4.5rem_6.5rem] items-center gap-2 px-3 py-2">
                    <span className="truncate text-sm" title={line.name}>{line.name}</span>
                    <Input
                      aria-label={`Cantidad de ${line.name}`}
                      inputMode="numeric"
                      value={line.quantity}
                      onChange={(event) => {
                        const raw = event.target.value;
                        if (!/^\d*$/.test(raw)) return;
                        patchLine(line.id, { quantity: raw });
                      }}
                      className="h-9"
                    />
                    <Input
                      aria-label={`Precio de ${line.name}`}
                      inputMode="decimal"
                      value={line.unitPrice}
                      onChange={(event) => {
                        const raw = event.target.value;
                        if (!/^\d*(?:[.,]\d*)?$/.test(raw)) return;
                        patchLine(line.id, { unitPrice: raw });
                      }}
                      className="h-9"
                    />
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">Cantidad y precio de cada línea. El comprobante emitido no cambia.</p>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" className="h-10 cursor-pointer sm:h-9" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button className="h-10 cursor-pointer sm:h-9" onClick={submit} disabled={busy || loading || !order}>
            {busy ? <><Loader2 className="animate-spin motion-reduce:animate-none" /> Guardando…</> : 'Guardar cambios'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
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
