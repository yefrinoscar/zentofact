import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ColumnDef, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import {
  AlertCircle,
  Banknote,
  Check,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Copy,
  Eye,
  FileText,
  ImagePlus,
  Loader2,
  MoreHorizontal,
  Package,
  PackageSearch,
  Plus,
  RefreshCw,
  Search,
  Store,
  WandSparkles,
  X,
} from 'lucide-react';
import falabellaLogo from '../assets/falabella.png';
import api from '../lib/api';
import { cn } from '../lib/cn';
import { shippingCarrierLabel } from '../lib/shipping-carrier';
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
  total?: number | null;
};

type OrderEvent = {
  id: number;
  eventType: string;
  source: string;
  providerOccurredAt?: string | null;
  createdAt: string;
};

type ManagedOrder = {
  id: number;
  companyId: number;
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
  total?: number | null;
  customer?: { name?: string; documentNumber?: string; phone?: string };
  shipping?: {
    type?: string;
    carrier?: string;
    trackingCode?: string;
    address?: string;
    district?: string;
    reference?: string;
    lat?: number;
    lng?: number;
  };
  metadata?: {
    paymentMethod?: string;
    saleSource?: string;
    delivery?: string;
    shippingCarrier?: string;
    receivedBy?: string;
  };
  orderedAt?: string | null;
  promisedShippingAt?: string | null;
  providerUpdatedAt?: string | null;
  demo?: boolean;
  demoItems?: OrderItem[];
};

type OrderDetail = ManagedOrder & {
  items: OrderItem[];
  events: OrderEvent[];
  documents: Array<{
    id: number;
    kind: string;
    number?: string | null;
    status?: string | null;
  }>;
};

type SalesPulseSeller = {
  companyId: number;
  companyName: string;
  ordersCount: number;
  salesTotal: number;
  manualOrdersCount: number;
  lastSaleAt?: string | null;
};

type SalesPulse = {
  date: string;
  ordersCount: number;
  salesTotal: number;
  unitsSold: number;
  sellersWithSales: number;
  sellersWithoutSales: number;
  sellers: SalesPulseSeller[];
  topProducts: Array<{
    sku: string;
    name: string;
    imageUrl?: string | null;
    shopSku?: string | null;
    unitsSold: number;
    ordersCount: number;
    salesTotal: number;
    sellersCount: number;
    channelCodes: string[];
  }>;
  channels: Array<{
    code: string;
    name: string;
    ordersCount: number;
    salesTotal: number;
  }>;
};

const DAY_LIMIT = 500;
const RANKING_SIZE = 6;
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
  { id: -4, code: 'manual', name: 'Venta manual', active: true, defaultAutoCreateOrders: false },
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

function limaDate(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(date);
}

function hoursAgo(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function documentDecision(type: 'boleta' | 'factura' | null = 'boleta') {
  return { enabled: true, required: false, type, needsCustomerChoice: false };
}

function createDemoOrders(companyId: number): ManagedOrder[] {
  return [
    {
      id: -101,
      companyId,
      channelAccountId: -11,
      channelCode: 'mercado_libre',
      channelName: 'Mercado Libre',
      channelAccountName: 'Tienda principal',
      externalOrderId: 'ML-200483',
      externalOrderNumber: 'ML-200483',
      orderStatus: 'confirmed',
      paymentStatus: 'paid',
      fulfillmentStatus: 'preparing',
      documentStatus: 'pending',
      documentRequirement: 'optional',
      documentTypePolicy: 'automatic',
      requestedDocumentType: 'factura',
      documentDecision: documentDecision('factura'),
      currency: 'PEN',
      total: 219.8,
      customer: { name: 'María Salazar', documentNumber: '20548796321' },
      orderedAt: hoursAgo(1.2),
      promisedShippingAt: hoursAgo(-22),
      demo: true,
      demoItems: [
        { id: -1, sku: 'ZF-AUD-002', description: 'Audífonos Bluetooth Pro', quantity: 1, total: 89.9 },
        { id: -2, sku: 'ZF-MOC-001', description: 'Mochila urbana impermeable', quantity: 1, total: 129.9 },
      ],
    },
    {
      id: -102,
      companyId,
      channelAccountId: -12,
      channelCode: 'falabella',
      channelName: 'Falabella',
      channelAccountName: 'Seller principal',
      externalOrderId: 'FAL-78432',
      externalOrderNumber: 'FAL-78432',
      orderStatus: 'confirmed',
      paymentStatus: 'paid',
      fulfillmentStatus: 'ready_to_ship',
      documentStatus: 'accepted',
      documentRequirement: 'optional',
      documentTypePolicy: 'automatic',
      documentDecision: documentDecision('boleta'),
      currency: 'PEN',
      total: 159,
      customer: { name: 'José Ramírez', documentNumber: '74261835' },
      shipping: { trackingCode: 'FALPE983201' },
      orderedAt: hoursAgo(3.5),
      promisedShippingAt: hoursAgo(-18),
      demo: true,
      demoItems: [{ id: -3, sku: 'ZF-CAM-004', description: 'Cámara WiFi para hogar', quantity: 1, total: 159 }],
    },
    {
      id: -103,
      companyId,
      channelAccountId: -13,
      channelCode: 'ripley',
      channelName: 'Ripley',
      channelAccountName: 'Marketplace Ripley',
      externalOrderId: 'RIP-99104',
      externalOrderNumber: 'RIP-99104',
      orderStatus: 'confirmed',
      paymentStatus: 'paid',
      fulfillmentStatus: 'pending',
      documentStatus: 'not_requested',
      documentRequirement: 'optional',
      documentTypePolicy: 'automatic',
      documentDecision: documentDecision(null),
      currency: 'PEN',
      total: 72.5,
      customer: { name: 'Lucía Torres', documentNumber: '46128730' },
      orderedAt: hoursAgo(6),
      promisedShippingAt: hoursAgo(-30),
      demo: true,
      demoItems: [{ id: -4, sku: 'ZF-ORG-005', description: 'Organizador modular 3 niveles', quantity: 1, total: 72.5 }],
    },
    {
      id: -104,
      companyId,
      channelAccountId: -14,
      channelCode: 'manual',
      channelName: 'Venta manual',
      channelAccountName: 'Tienda física',
      externalOrderId: 'VTA-1042',
      externalOrderNumber: 'VTA-1042',
      orderStatus: 'completed',
      paymentStatus: 'pending',
      fulfillmentStatus: 'delivered',
      documentStatus: 'accepted',
      documentRequirement: 'optional',
      documentTypePolicy: 'automatic',
      documentDecision: documentDecision('boleta'),
      currency: 'PEN',
      total: 109.8,
      customer: { name: 'Carlos Vega', documentNumber: '41876532' },
      shipping: { type: 'recojo', address: 'Av. La Marina 2055, San Miguel' },
      metadata: { paymentMethod: 'despues', saleSource: 'whatsapp', delivery: 'recojo' },
      orderedAt: hoursAgo(19),
      demo: true,
      demoItems: [{ id: -5, sku: 'ZF-BOT-003', description: 'Botella térmica 750 ml', quantity: 2, total: 109.8 }],
    },
    {
      id: -105,
      companyId,
      channelAccountId: -11,
      channelCode: 'mercado_libre',
      channelName: 'Mercado Libre',
      channelAccountName: 'Tienda principal',
      externalOrderId: 'ML-200419',
      externalOrderNumber: 'ML-200419',
      orderStatus: 'confirmed',
      paymentStatus: 'paid',
      fulfillmentStatus: 'shipped',
      documentStatus: 'issued',
      documentRequirement: 'optional',
      documentTypePolicy: 'automatic',
      documentDecision: documentDecision('boleta'),
      currency: 'PEN',
      total: 129.9,
      customer: { name: 'Andrea Flores', documentNumber: '72519480' },
      shipping: { trackingCode: 'MELI1028841' },
      orderedAt: hoursAgo(28),
      demo: true,
      demoItems: [{ id: -6, sku: 'ZF-MOC-001', description: 'Mochila urbana impermeable', quantity: 1, total: 129.9 }],
    },
    {
      id: -106,
      companyId,
      channelAccountId: -12,
      channelCode: 'falabella',
      channelName: 'Falabella',
      channelAccountName: 'Seller principal',
      externalOrderId: 'FAL-78398',
      externalOrderNumber: 'FAL-78398',
      orderStatus: 'cancelled',
      paymentStatus: 'refunded',
      fulfillmentStatus: 'cancelled',
      documentStatus: 'cancelled',
      documentRequirement: 'optional',
      documentTypePolicy: 'automatic',
      documentDecision: documentDecision('boleta'),
      currency: 'PEN',
      total: 89.9,
      customer: { name: 'Pedro Campos', documentNumber: '47821096' },
      orderedAt: hoursAgo(36),
      demo: true,
      demoItems: [{ id: -7, sku: 'ZF-AUD-002', description: 'Audífonos Bluetooth Pro', quantity: 1, total: 89.9 }],
    },
  ];
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
    return SALE_SOURCE_LABELS[order.metadata?.saleSource || ''] || 'Manual';
  }
  return order.channelName;
}

function deliveryLabel(order: ManagedOrder) {
  const type = order.shipping?.type || order.metadata?.delivery || '';
  if (type === 'recojo') return 'Recojo';
  const carrier = shippingCarrierLabel(order.shipping?.carrier || order.metadata?.shippingCarrier);
  if (carrier) return carrier;
  if (type === 'envio') return 'Envío';
  if (order.shipping?.trackingCode) return 'Envío';
  if (order.channelCode !== 'manual') return 'Marketplace';
  return '—';
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

function channelTone(code: string) {
  return {
    falabella: 'border-lime-200 bg-lime-50 text-lime-800 dark:border-lime-900 dark:bg-lime-950/40 dark:text-lime-300',
    mercado_libre: 'border-yellow-200 bg-yellow-50 text-yellow-800 dark:border-yellow-900 dark:bg-yellow-950/40 dark:text-yellow-300',
    ripley: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800 dark:border-fuchsia-900 dark:bg-fuchsia-950/40 dark:text-fuchsia-300',
    manual: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300',
  }[code] || 'border-border bg-muted text-muted-foreground';
}

function ChannelMark({ code, name, size = 'sm' }: { code: string; name: string; size?: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'size-4' : 'size-8';
  if (code === 'falabella') {
    return <img src={falabellaLogo} alt="Falabella" className={cn('shrink-0 rounded-sm object-contain', box)} />;
  }
  return (
    <span className={cn('grid shrink-0 place-items-center rounded-sm border font-bold', channelTone(code), size === 'sm' ? 'size-4 text-[8px]' : 'size-8 text-xs')} aria-hidden="true">
      {name.slice(0, 2).toUpperCase()}
    </span>
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

function dayLabel(date: string) {
  if (date === todayInLima()) return 'hoy';
  return new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00`));
}

function demoDetail(order: ManagedOrder): OrderDetail {
  const createdAt = order.orderedAt || new Date().toISOString();
  return {
    ...order,
    items: order.demoItems || [],
    events: [
      { id: order.id * 10, eventType: 'order.created', source: order.channelCode === 'manual' ? 'manual' : 'webhook', createdAt },
      ...(['preparing', 'ready_to_ship', 'shipped', 'delivered'].includes(order.fulfillmentStatus)
        ? [{ id: order.id * 10 - 1, eventType: 'order.updated', source: 'system', createdAt: hoursAgo(0.5) }]
        : []),
    ],
    documents: ['issued', 'accepted'].includes(order.documentStatus)
      ? [{ id: order.id * 100, kind: order.documentDecision.type || 'boleta', number: order.documentDecision.type === 'factura' ? 'F001-001284' : 'B001-004821', status: order.documentStatus }]
      : [],
  };
}

export default function PedidosMulticanal() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState('all');
  const [channelCode, setChannelCode] = useState('all');
  const [fulfillmentStatus, setFulfillmentStatus] = useState('all');
  const [date, setDate] = useState(todayInLima);
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [hasRealOrders, setHasRealOrders] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [syncNote, setSyncNote] = useState('');
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [productsOpen, setProductsOpen] = useState(false);
  const [paymentOrder, setPaymentOrder] = useState<ManagedOrder | null>(null);
  const [demoPaymentOverrides, setDemoPaymentOverrides] = useState<Record<number, { paymentStatus: string; paymentMethod: string }>>({});
  const syncNoteTimer = useRef(0);
  const searchTimer = useRef(0);

  useEffect(() => () => {
    if (syncNoteTimer.current) window.clearTimeout(syncNoteTimer.current);
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
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
  const orderFilters = useMemo(() => ({
    companyId: companyId === 'all' ? undefined : Number(companyId),
    channelCode: channelCode === 'all' ? undefined : channelCode,
    fulfillmentStatus: fulfillmentStatus === 'all' ? undefined : fulfillmentStatus,
    from: date,
    to: date,
    search: submittedSearch || undefined,
    limit: DAY_LIMIT,
    offset: 0,
  }), [channelCode, companyId, date, fulfillmentStatus, submittedSearch]);
  const ordersQuery = useQuery({
    queryKey: ['managed-orders', orderFilters],
    queryFn: () => api.listManagedOrders(orderFilters),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
  const pulseQuery = useQuery({
    queryKey: ['managed-order-sales-pulse', date],
    queryFn: async () => {
      const [pulse, catalogSales] = await Promise.all([
        api.getManagedOrderSalesPulse({ date }),
        api.listTodayProductSales({ date, limit: 80 }).catch(() => null),
      ]);
      const photos = new Map<string, { imageUrl?: string | null; shopSku?: string | null }>();
      for (const product of Array.isArray(catalogSales?.products) ? catalogSales.products : []) {
        const key = String(product.sku || '').trim().toLowerCase();
        if (!key) continue;
        photos.set(key, { imageUrl: product.imageUrl, shopSku: product.shopSku });
      }
      return {
        ...pulse,
        topProducts: (pulse?.topProducts || []).map((product: SalesPulse['topProducts'][number]) => {
          const extra = photos.get(String(product.sku || '').trim().toLowerCase());
          return {
            ...product,
            imageUrl: product.imageUrl || extra?.imageUrl || null,
            shopSku: product.shopSku || extra?.shopSku || null,
          };
        }),
      } as SalesPulse;
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });

  const companies = (Array.isArray(companiesQuery.data) ? companiesQuery.data : []) as Company[];
  const channels = (Array.isArray(channelsQuery.data) ? channelsQuery.data : []) as Channel[];
  const orders = (Array.isArray(ordersQuery.data?.orders) ? ordersQuery.data.orders : []) as ManagedOrder[];
  const totalCount = Number(ordersQuery.data?.totalCount || 0);
  const salesPulse = pulseQuery.data || null;
  const loading = ordersQuery.isPending && !ordersQuery.data;
  const fetching = ordersQuery.isFetching;
  const loadError = (ordersQuery.error as Error | undefined)?.message
    || (companiesQuery.error as Error | undefined)?.message
    || '';
  const pulseLoading = pulseQuery.isPending && !pulseQuery.data;
  const pulseError = (pulseQuery.error as Error | undefined)?.message || '';

  useEffect(() => {
    if (totalCount > 0) setHasRealOrders(true);
  }, [totalCount]);

  const channelCatalog = useMemo(() => FALLBACK_CHANNELS.map((fallback) => (
    channels.find((channel) => channel.code === fallback.code) || fallback
  )), [channels]);

  const demoOrders = useMemo(
    () => createDemoOrders(Number(companyId === 'all' ? companies[0]?.id || 1 : companyId)).map((order) => {
      const override = demoPaymentOverrides[order.id];
      return override ? { ...order, paymentStatus: override.paymentStatus, metadata: { ...order.metadata, paymentMethod: override.paymentMethod } } : order;
    }),
    [companies, companyId, demoPaymentOverrides],
  );

  const filteredDemoOrders = useMemo(() => {
    const term = submittedSearch.toLowerCase();
    return demoOrders.filter((order) => (
      (channelCode === 'all' || order.channelCode === channelCode)
      && (fulfillmentStatus === 'all' || order.fulfillmentStatus === fulfillmentStatus)
      && limaDate(order.orderedAt) === date
      && (!term || [order.externalOrderNumber, order.customer?.name, order.customer?.documentNumber, order.customer?.phone]
        .some((value) => String(value || '').toLowerCase().includes(term)))
    ));
  }, [channelCode, date, demoOrders, fulfillmentStatus, submittedSearch]);

  const demoMode = !loading && !loadError && !hasRealOrders;
  const displayedOrders = demoMode ? filteredDemoOrders : orders;
  const displayedTotal = demoMode ? filteredDemoOrders.length : totalCount;

  const companyById = useMemo(
    () => new Map(companies.map((company) => [company.id, companyName(company)])),
    [companies],
  );

  useEffect(() => {
    const registered = (location.state as { registered?: string } | null)?.registered;
    if (!registered) return;
    setSuccessMessage(`Venta ${registered} registrada.`);
    setHasRealOrders(true);
    void queryClient.invalidateQueries({ queryKey: ['managed-orders'] });
    void queryClient.invalidateQueries({ queryKey: ['managed-order-sales-pulse'] });
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate, queryClient]);

  const openDetail = async (order: ManagedOrder) => {
    setDetailOpen(true);
    setDetail(null);
    if (order.demo) {
      setDetail(demoDetail(order));
      setDetailLoading(false);
      return;
    }
    setDetailLoading(true);
    try {
      setDetail(await api.getManagedOrder(order.id));
    } catch (error: any) {
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const pulseSellers = useMemo(() => {
    const sellers = salesPulse?.sellers || [];
    return [...sellers].sort((left, right) => {
      if ((right.ordersCount > 0) !== (left.ordersCount > 0)) return left.ordersCount > 0 ? -1 : 1;
      if (right.salesTotal !== left.salesTotal) return right.salesTotal - left.salesTotal;
      return left.companyName.localeCompare(right.companyName, 'es');
    });
  }, [salesPulse]);
  const soldProducts = salesPulse?.topProducts || [];
  const rankingProducts = soldProducts.slice(0, RANKING_SIZE);
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
    mutationFn: () => api.syncOrdersInbox({ date }),
    onMutate: () => {
      setSyncNote('');
    },
    onSuccess: async (result) => {
      const failed = Number(result?.failed || 0);
      if (result?.status === 'already_running') markSyncNote('En curso');
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
      paymentProof: { name: string; type: string; dataUrl: string } | null;
    }) => {
      if (input.order.demo) {
        return { ...input.order, paymentStatus: 'paid', metadata: { ...input.order.metadata, paymentMethod: input.paymentMethod } };
      }
      return api.updateManagedOrderPayment(input.order.id, {
        paymentMethod: input.paymentMethod,
        receivedBy: input.receivedBy || undefined,
        paymentProof: input.paymentProof,
      });
    },
    onSuccess: (updated, input) => {
      if (input.order.demo) {
        setDemoPaymentOverrides((current) => ({
          ...current,
          [input.order.id]: { paymentStatus: 'paid', paymentMethod: input.paymentMethod },
        }));
      } else {
        void queryClient.invalidateQueries({ queryKey: ['managed-orders'] });
        void queryClient.invalidateQueries({ queryKey: ['managed-order-sales-pulse'] });
      }
      setPaymentOrder(null);
      setSuccessMessage(`Pago de ${updated.externalOrderNumber || input.order.externalOrderNumber} registrado.`);
    },
  });

  const columns = useMemo<ColumnDef<ManagedOrder>[]>(() => [
    {
      id: 'order',
      header: 'Pedido',
      size: 168,
      cell: ({ row }) => <CopyableOrderNumber value={row.original.externalOrderNumber} />,
    },
    {
      id: 'seller',
      header: 'Seller',
      size: 132,
      cell: ({ row }) => (
        <div className="flex min-w-0 items-center gap-1.5">
          <ChannelMark code={row.original.channelCode} name={row.original.channelName} />
          <span className="truncate">{companyById.get(row.original.companyId) || `Empresa ${row.original.companyId}`}</span>
        </div>
      ),
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
      id: 'phone',
      header: 'Teléfono',
      size: 116,
      cell: ({ row }) => (
        <span className="truncate font-mono text-[13px] tabular-nums text-muted-foreground">{row.original.customer?.phone || '—'}</span>
      ),
    },
    {
      id: 'origin',
      header: 'Origen',
      size: 124,
      cell: ({ row }) => (
        <div className="flex min-w-0 items-center gap-1.5">
          <ChannelMark code={row.original.channelCode} name={row.original.channelName} />
          <span className="truncate">{originLabel(row.original)}</span>
        </div>
      ),
    },
    {
      id: 'delivery',
      header: 'Entrega',
      size: 108,
      cell: ({ row }) => <span className="truncate">{deliveryLabel(row.original)}</span>,
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
      header: 'Hora',
      size: 72,
      cell: ({ row }) => (
        <span className="tabular-nums text-muted-foreground">{formatTime(row.original.orderedAt)}</span>
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
              <DropdownMenuItem onClick={() => void openDetail(row.original)}>
                <Eye /> Ver detalle
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ], [companyById]);

  const table = useReactTable({
    data: displayedOrders,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (order) => String(order.id),
  });

  const filterTriggerClass = 'h-9 w-auto min-w-[7.25rem] max-w-[11rem] rounded-md border-border bg-background';
  const filterMenuClass = 'w-auto min-w-[14rem]';

  return (
    <div className="space-y-4">
      <DayStrip value={date} onChange={setDate} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">Ventas de {dayLabel(date)}</h2>
            {demoMode && <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300"><WandSparkles /> Demo</Badge>}
          </div>
          {pulseLoading ? (
            <div className="mt-1 h-8 w-64 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          ) : (
            <div className="mt-1 flex flex-wrap items-baseline gap-x-5 gap-y-1">
              <p className="text-2xl font-semibold tracking-tight tabular-nums">{salesPulse ? formatMoney(salesPulse.salesTotal) : '—'}</p>
              <p className="text-sm text-muted-foreground">{salesPulse ? salesPulse.ordersCount : displayedTotal} {Number(salesPulse?.ordersCount ?? displayedTotal) === 1 ? 'pedido' : 'pedidos'}</p>
            </div>
          )}
          {pulseError && (
            <Button type="button" variant="ghost" size="xs" onClick={() => void pulseQuery.refetch()} className="mt-1 h-7 cursor-pointer px-0 text-destructive">
              Reintentar
            </Button>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => void syncRealData()}
            disabled={syncing}
            aria-live="polite"
            className={cn(
              'h-9 min-w-36 cursor-pointer',
              syncNote === 'Actualizado' && 'border-emerald-200 text-emerald-700 dark:border-emerald-900 dark:text-emerald-300',
              (syncNote === 'Error' || syncNote === 'Incompleto') && 'border-rose-200 text-rose-700 dark:border-rose-900 dark:text-rose-300',
            )}
          >
            {syncing ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : syncNote === 'Actualizado' ? <Check /> : <RefreshCw />}
            {syncing ? 'Actualizando…' : syncNote || 'Actualizar'}
          </Button>
          <Button onClick={() => navigate('/orders/nueva')} className="h-9 cursor-pointer">
            <Plus /> Registrar venta
          </Button>
        </div>
      </div>

      <section className="overflow-hidden rounded-md border border-border bg-card">
        <div className="grid lg:grid-cols-[minmax(0,1.5fr)_minmax(16rem,0.5fr)]">
          <div className="min-w-0 lg:border-r lg:border-border">
            <div className="flex items-center justify-between gap-3 px-4 py-2 sm:px-5">
              <h3 className="text-sm font-semibold">Productos vendidos</h3>
              {soldProducts.length > 0 && (
                <Button type="button" variant="link" size="xs" className="h-7 cursor-pointer px-0 text-primary" onClick={() => setProductsOpen(true)}>
                  Ver todos
                </Button>
              )}
            </div>
            <TodayProducts products={rankingProducts} loading={pulseLoading} />
          </div>

          <aside aria-label="Sellers">
            <div className="flex items-center justify-between gap-3 px-4 py-2 sm:px-5">
              <h3 className="text-sm font-semibold">Sellers</h3>
              <span className="text-xs font-medium tabular-nums text-muted-foreground">
                {salesPulse ? `${salesPulse.sellersWithSales}/${pulseSellers.length}` : '—'} sellers con ventas
              </span>
            </div>
            <SellerList
              sellers={pulseSellers}
              loading={pulseLoading}
              selectedCompanyId={companyId}
              onSelect={(sellerId) => {
                setCompanyId(companyId === String(sellerId) ? 'all' : String(sellerId));
              }}
            />
          </aside>
        </div>
      </section>

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
          </div>
        </div>
        {hasActiveFilters && (
          <div className="flex flex-wrap items-center gap-1.5">
            {search.trim() && <FilterChip label={search.trim()} onRemove={() => { setSearch(''); setSubmittedSearch(''); }} />}
            {selectedSellerName && <FilterChip label={selectedSellerName} onRemove={() => setCompanyId('all')} />}
            {selectedChannelName && <FilterChip label={selectedChannelName} onRemove={() => setChannelCode('all')} />}
            {selectedStatusLabel && <FilterChip label={selectedStatusLabel} onRemove={() => setFulfillmentStatus('all')} />}
          </div>
        )}
        {demoMode && <p className="text-xs text-muted-foreground">La muestra desaparece cuando registres o sincronices el primer pedido real.</p>}
      </div>

      <OrdersVirtualTable
        table={table}
        aria-label={`Pedidos de ${dayLabel(date)}`}
        loading={loading}
        fetching={fetching}
        onRowClick={openDetail}
        empty={(
          <div className="flex flex-col items-center gap-2 py-14 text-center">
            <Store className="size-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">No hay pedidos para estos filtros</p>
            <p className="text-sm text-muted-foreground">Prueba otra búsqueda o registra una venta manual.</p>
            <Button size="sm" className="mt-2 cursor-pointer" onClick={() => navigate('/orders/nueva')}><Plus /> Registrar venta</Button>
          </div>
        )}
        footer={(
          <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            {fetching && <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />}
            {displayedTotal} {displayedTotal === 1 ? 'pedido' : 'pedidos'}
          </p>
        )}
      />

      <Sheet open={productsOpen} onOpenChange={setProductsOpen}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader className="border-b border-border px-5 py-4 pr-16">
            <SheetTitle>Productos vendidos</SheetTitle>
            <SheetDescription>
              {soldProducts.length} {soldProducts.length === 1 ? 'producto' : 'productos'} · {dayLabel(date)}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <TodayProducts products={soldProducts} loading={false} />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="sm:max-w-lg">
          {detailLoading ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="size-5 animate-spin motion-reduce:animate-none" /> Cargando detalle…
            </div>
          ) : detail ? (
            <>
              <SheetHeader className="border-b border-border px-5 py-4 pr-16">
                <div className="flex min-w-0 items-center gap-3">
                  <ChannelMark code={detail.channelCode} name={detail.channelName} size="md" />
                  <div className="min-w-0">
                    <SheetTitle>Pedido {detail.externalOrderNumber}</SheetTitle>
                    <SheetDescription className="mt-1 truncate">
                      {detail.channelName} · {companyById.get(detail.companyId) || `Empresa ${detail.companyId}`}
                    </SheetDescription>
                  </div>
                </div>
              </SheetHeader>
              <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <DetailStat label="Despacho" content={fulfillmentBadge(detail.fulfillmentStatus)} />
                  <DetailStat label="Pago" content={paymentBadge(detail.paymentStatus) || <span className="text-sm text-muted-foreground">Sin dato</span>} />
                  <DetailStat label="Entrega" content={<span className="text-sm font-medium">{deliveryLabel(detail)}</span>} />
                  <DetailStat label="Comprobante" content={documentBadge(detail)} />
                  <DetailStat label="Total" content={<span className="font-semibold tabular-nums">{formatMoney(detail.total, detail.currency)}</span>} />
                </div>

                <section>
                  <h3 className="mb-3 text-sm font-medium">Productos</h3>
                  <div className="divide-y divide-border rounded-md border border-border">
                    {detail.items.length ? detail.items.map((item) => (
                      <div key={item.id} className="flex items-center justify-between gap-4 px-4 py-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted"><Package className="size-4 text-muted-foreground" /></span>
                          <div className="min-w-0">
                            <p className="truncate font-medium">{item.description || item.sku || 'Producto'}</p>
                            <p className="text-xs text-muted-foreground"><span className="font-mono">{item.sku || 'Sin SKU'}</span> · Cant. {item.quantity}</p>
                          </div>
                        </div>
                        <span className="shrink-0 tabular-nums">{formatMoney(item.total, detail.currency)}</span>
                      </div>
                    )) : <p className="px-4 py-5 text-sm text-muted-foreground">El canal todavía no informó el detalle de productos.</p>}
                  </div>
                </section>

                {detail.documents.length > 0 && (
                  <section>
                    <h3 className="mb-3 text-sm font-medium">Comprobantes vinculados</h3>
                    <div className="flex flex-wrap gap-2">
                      {detail.documents.map((document) => (
                        <Badge key={document.id} variant="outline" className="h-auto rounded-md px-3 py-2">
                          <FileText /> {document.number || document.kind} · {DOCUMENT_LABELS[document.status || ''] || document.status || 'Sin estado'}
                        </Badge>
                      ))}
                    </div>
                  </section>
                )}

                <section>
                  <h3 className="mb-3 text-sm font-medium">Actividad</h3>
                  <div className="space-y-3">
                    {[...detail.events].reverse().map((event) => (
                      <div key={event.id} className="flex gap-3">
                        <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-muted">
                          {event.eventType.includes('created') ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Clock3 className="size-4 text-muted-foreground" />}
                        </div>
                        <div className="min-w-0 border-b border-border pb-3">
                          <p className="font-medium">{EVENT_LABELS[event.eventType] || event.eventType}</p>
                          <p className="text-xs text-muted-foreground">{SOURCE_LABELS[event.source] || event.source} · {formatDate(event.providerOccurredAt || event.createdAt)}</p>
                        </div>
                      </div>
                    ))}
                    {!detail.events.length && <p className="text-sm text-muted-foreground">Todavía no hay eventos registrados.</p>}
                  </div>
                </section>
              </div>
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
      <span className="grid size-10 shrink-0 place-items-center rounded-md bg-muted" aria-hidden="true">
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
      className="size-10 shrink-0 rounded-md bg-muted object-cover"
    />
  );
}

function TodayProducts({ products, loading }: { products: SalesPulse['topProducts']; loading: boolean }) {
  if (loading) {
    return (
      <div className="divide-y divide-border" aria-label="Cargando productos vendidos">
        {[0, 1, 2, 3, 4, 5].map((item) => (
          <div key={item} className="flex h-14 items-center gap-2.5 px-4 sm:px-5">
            <div className="size-10 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
            <div className="h-3 flex-1 animate-pulse rounded bg-muted motion-reduce:animate-none" />
            <div className="h-3 w-14 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          </div>
        ))}
      </div>
    );
  }

  if (!products.length) {
    return (
      <div className="flex min-h-40 flex-col items-center justify-center gap-2 px-6 py-8 text-center">
        <PackageSearch className="size-6 text-muted-foreground/60" />
        <p className="text-sm font-medium">Aún no hay productos vendidos</p>
        <p className="text-xs text-muted-foreground">Cuando ingrese una venta, aparecerá aquí.</p>
      </div>
    );
  }

  return (
    <ol className="divide-y divide-border">
      {products.map((product, index) => (
        <li key={`${product.sku}:${product.name}`} className="grid grid-cols-[1.25rem_2.5rem_minmax(0,1fr)_auto] items-center gap-2.5 px-4 py-2 sm:px-5">
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
          <ProductThumb url={product.imageUrl} shopSku={product.shopSku} sku={product.sku} name={product.name} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium leading-5" title={product.name}>{product.name}</p>
            <p className="truncate font-mono text-[11px] text-muted-foreground">{product.sku}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-sm font-semibold tabular-nums leading-5">{formatMoney(product.salesTotal)}</p>
            <p className="text-xs tabular-nums text-muted-foreground">{product.unitsSold} unid.</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function SellerList({
  sellers,
  selectedCompanyId,
  onSelect,
  loading = false,
}: {
  sellers: SalesPulseSeller[];
  selectedCompanyId: string;
  onSelect: (companyId: number) => void;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-1.5 px-4 py-2 sm:px-5" aria-label="Cargando sellers">
        {[0, 1, 2, 3].map((item) => <div key={item} className="h-8 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />)}
      </div>
    );
  }

  if (!sellers.length) {
    return (
      <div className="flex min-h-24 items-center justify-center px-4 py-6 text-sm text-muted-foreground">
        No hay sellers activos
      </div>
    );
  }

  return (
    <div className="max-h-64 overflow-y-auto px-2 pb-2 sm:px-3">
      {sellers.map((seller) => {
        const selected = selectedCompanyId === String(seller.companyId);
        const sold = seller.ordersCount > 0;
        return (
          <button
            key={seller.companyId}
            type="button"
            onClick={() => onSelect(seller.companyId)}
            aria-pressed={selected}
            className={cn(
              'flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
              selected && 'bg-primary/8 ring-1 ring-primary/20',
              !sold && 'text-muted-foreground',
            )}
          >
            {sold
              ? <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" />
              : <CircleDashed className="size-3.5 shrink-0" />}
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{titleCaseSeller(seller.companyName)}</span>
            {sold && <span className="shrink-0 text-xs font-semibold tabular-nums">{formatMoney(seller.salesTotal)}</span>}
          </button>
        );
      })}
    </div>
  );
}

function DetailStat({ label, content }: { label: string; content: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <p className="mb-2 text-xs text-muted-foreground">{label}</p>
      {content}
    </div>
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
    paymentProof: { name: string; type: string; dataUrl: string } | null;
  }) => void;
}) {
  const [paymentMethod, setPaymentMethod] = useState<(typeof RECORD_PAYMENT_METHODS)[number]['value']>('efectivo');
  const [receivedBy, setReceivedBy] = useState('');
  const [paymentProof, setPaymentProof] = useState<{ name: string; type: string; dataUrl: string } | null>(null);
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (!order) return;
    setPaymentMethod('efectivo');
    setReceivedBy('');
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
            onClick={() => onSubmit({ paymentMethod, receivedBy, paymentProof })}
          >
            {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Banknote />}
            {busy ? 'Guardando…' : 'Registrar pago'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
