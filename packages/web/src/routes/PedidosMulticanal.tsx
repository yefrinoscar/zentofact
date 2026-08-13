import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Clock3,
  FileText,
  Loader2,
  Package,
  PackageSearch,
  Plus,
  RefreshCw,
  Search,
  Store,
  Trash2,
  Users,
  WandSparkles,
  X,
} from 'lucide-react';
import falabellaLogo from '../assets/falabella.png';
import api from '../lib/api';
import { cn } from '../lib/cn';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TablePanel,
  TablePanelFooter,
  TablePanelHeader,
  TableRow,
} from '../components/ui/table';
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
  shipping?: { type?: string; trackingCode?: string };
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

type CatalogProduct = {
  sku: string;
  name: string;
  price: number;
  stock: number;
};

type ManualLine = {
  id: string;
  productSku: string;
  quantity: number;
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

const PAGE_SIZE = 10;

const FALLBACK_CHANNELS: Channel[] = [
  { id: -1, code: 'falabella', name: 'Falabella', active: true, defaultAutoCreateOrders: true },
  { id: -2, code: 'mercado_libre', name: 'Mercado Libre', active: true, defaultAutoCreateOrders: true },
  { id: -3, code: 'ripley', name: 'Ripley', active: true, defaultAutoCreateOrders: true },
  { id: -4, code: 'manual', name: 'Venta manual', active: true, defaultAutoCreateOrders: false },
];

const DEMO_PRODUCTS: CatalogProduct[] = [
  { sku: 'ZF-MOC-001', name: 'Mochila urbana impermeable', price: 129.9, stock: 18 },
  { sku: 'ZF-AUD-002', name: 'Audífonos Bluetooth Pro', price: 89.9, stock: 32 },
  { sku: 'ZF-BOT-003', name: 'Botella térmica 750 ml', price: 54.9, stock: 25 },
  { sku: 'ZF-CAM-004', name: 'Cámara WiFi para hogar', price: 159, stock: 11 },
  { sku: 'ZF-ORG-005', name: 'Organizador modular 3 niveles', price: 72.5, stock: 9 },
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
};

const SOURCE_LABELS: Record<string, string> = {
  api: 'API',
  webhook: 'Webhook',
  sync: 'Sincronización',
  manual: 'Registro manual',
  user: 'Usuario',
  system: 'Sistema',
};

function companyName(company: Company) {
  const candidates = [company.nombreComercial, company.nombre, company.razonSocial]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .map((value) => value
      .replace(/^(?:importaciones|inversiones|tiendas|la tienda del)\s+/i, '')
      .replace(/\s+(?:per[uú]|e\.?i\.?r\.?l\.?|s\.?r\.?l\.?|s\.?a\.?c\.?)$/i, '')
      .trim());
  return candidates.sort((left, right) => left.length - right.length)[0] || `Empresa ${company.id}`;
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

function limaDateOffset(days: number) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' })
    .format(new Date(Date.now() + days * 24 * 60 * 60 * 1000));
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
      paymentStatus: 'paid',
      fulfillmentStatus: 'delivered',
      documentStatus: 'accepted',
      documentRequirement: 'optional',
      documentTypePolicy: 'automatic',
      documentDecision: documentDecision('boleta'),
      currency: 'PEN',
      total: 109.8,
      customer: { name: 'Carlos Vega', documentNumber: '41876532' },
      shipping: { type: 'Tienda física' },
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

function documentBadge(order: ManagedOrder) {
  if (order.documentRequirement === 'disabled') {
    return <Badge variant="outline" className="rounded-md text-muted-foreground">No aplica</Badge>;
  }
  const status = order.documentStatus;
  const classes = status === 'accepted'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
    : status === 'rejected' || status === 'cancelled'
      ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300'
      : status === 'pending'
        ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300'
        : 'border-border bg-muted/40 text-muted-foreground';
  const type = order.documentDecision?.type
    ? ` · ${order.documentDecision.type === 'factura' ? 'Factura' : 'Boleta'}`
    : '';
  return <Badge variant="outline" className={cn('rounded-md', classes)}>{DOCUMENT_LABELS[status] || status}{type}</Badge>;
}

function channelTone(code: string) {
  return {
    falabella: 'border-lime-200 bg-lime-50 text-lime-800 dark:border-lime-900 dark:bg-lime-950/40 dark:text-lime-300',
    mercado_libre: 'border-yellow-200 bg-yellow-50 text-yellow-800 dark:border-yellow-900 dark:bg-yellow-950/40 dark:text-yellow-300',
    ripley: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800 dark:border-fuchsia-900 dark:bg-fuchsia-950/40 dark:text-fuchsia-300',
    manual: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300',
  }[code] || 'border-border bg-muted text-muted-foreground';
}

function ChannelMark({ code, name }: { code: string; name: string }) {
  if (code === 'falabella') {
    return <img src={falabellaLogo} alt="Falabella" className="size-8 shrink-0 rounded-lg object-contain" />;
  }
  return (
    <span className={cn('grid size-8 shrink-0 place-items-center rounded-md border text-xs font-bold', channelTone(code))} aria-hidden="true">
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

function ChannelIcon({ code, name, size = 'md' }: { code: string; name?: string; size?: 'sm' | 'md' }) {
  if (code === 'falabella') {
    return <img src={falabellaLogo} alt="Falabella" className={cn('shrink-0 rounded-md object-contain', size === 'sm' ? 'size-5' : 'size-8')} />;
  }
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded-md border font-bold',
        channelTone(code),
        size === 'sm' ? 'size-5 text-[8px]' : 'size-8 text-xs',
      )}
      aria-label={name || code}
    >
      {(name || code).slice(0, 2).toUpperCase()}
    </span>
  );
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

function newLine(): ManualLine {
  return { id: Math.random().toString(36).slice(2), productSku: '', quantity: 1 };
}

export default function PedidosMulticanal() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [accounts, setAccounts] = useState<ChannelAccount[]>([]);
  const [orders, setOrders] = useState<ManagedOrder[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [hasRealOrders, setHasRealOrders] = useState(false);
  const [companyId, setCompanyId] = useState('all');
  const [channelCode, setChannelCode] = useState('all');
  const [fulfillmentStatus, setFulfillmentStatus] = useState('all');
  const [dateRange, setDateRange] = useState<'today' | '7days' | 'all'>('today');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [salesPulse, setSalesPulse] = useState<SalesPulse | null>(null);
  const [pulseLoading, setPulseLoading] = useState(true);
  const [pulseError, setPulseError] = useState('');
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [manualCompanyId, setManualCompanyId] = useState('');
  const [saleSource, setSaleSource] = useState('tienda_fisica');
  const [customerName, setCustomerName] = useState('');
  const [customerDocument, setCustomerDocument] = useState('');
  const [documentType, setDocumentType] = useState('boleta');
  const [notes, setNotes] = useState('');
  const [manualLines, setManualLines] = useState<ManualLine[]>([newLine()]);
  const requestRef = useRef(0);

  useEffect(() => {
    Promise.all([
      api.listCompanies(),
      api.listOrderChannels(),
      api.listOrderChannelAccounts({ active: true }),
    ]).then(([companyRows, channelRows, accountRows]) => {
      const nextCompanies = Array.isArray(companyRows) ? companyRows : [];
      const nextAccounts = Array.isArray(accountRows) ? accountRows : [];
      setCompanies(nextCompanies);
      setChannels(Array.isArray(channelRows) ? channelRows : []);
      setAccounts(nextAccounts);
      const firstManual = nextAccounts.find((account) => account.channelCode === 'manual');
      setManualCompanyId(String(firstManual?.companyId || nextCompanies[0]?.id || ''));
    }).catch((error: any) => {
      setLoadError(error?.message || 'No se pudo cargar la configuración de canales.');
    });
  }, []);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setLoadError('');
    try {
      const result = await api.listManagedOrders({
        companyId: companyId === 'all' ? undefined : Number(companyId),
        channelCode: channelCode === 'all' ? undefined : channelCode,
        fulfillmentStatus: fulfillmentStatus === 'all' ? undefined : fulfillmentStatus,
        from: dateRange === 'today' ? limaDateOffset(0) : dateRange === '7days' ? limaDateOffset(-6) : undefined,
        to: dateRange === 'all' ? undefined : limaDateOffset(0),
        search: search.trim() || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      });
      if (requestId !== requestRef.current) return;
      const nextOrders = Array.isArray(result?.orders) ? result.orders : [];
      const nextTotal = Number(result?.totalCount || 0);
      setOrders(nextOrders);
      setTotalCount(nextTotal);
      if (nextTotal > 0) setHasRealOrders(true);
    } catch (error: any) {
      if (requestId !== requestRef.current) return;
      setOrders([]);
      setTotalCount(0);
      setLoadError(error?.message || 'No se pudieron cargar los pedidos.');
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [channelCode, companyId, dateRange, fulfillmentStatus, page, search]);

  const loadSalesPulse = useCallback(async () => {
    setPulseLoading(true);
    setPulseError('');
    try {
      setSalesPulse(await api.getManagedOrderSalesPulse());
    } catch (error: any) {
      setPulseError(error?.message || 'No se pudo cargar la actividad de hoy.');
    } finally {
      setPulseLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(load, search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search]);

  useEffect(() => {
    loadSalesPulse();
  }, [loadSalesPulse]);

  useEffect(() => {
    setPage(1);
  }, [companyId, channelCode, fulfillmentStatus, dateRange]);

  const channelCatalog = useMemo(() => FALLBACK_CHANNELS.map((fallback) => (
    channels.find((channel) => channel.code === fallback.code) || fallback
  )), [channels]);

  const demoOrders = useMemo(
    () => createDemoOrders(Number(companyId === 'all' ? companies[0]?.id || 1 : companyId)),
    [companies, companyId],
  );

  const filteredDemoOrders = useMemo(() => {
    const term = search.trim().toLowerCase();
    const from = dateRange === 'today' ? limaDateOffset(0) : dateRange === '7days' ? limaDateOffset(-6) : '';
    return demoOrders.filter((order) => (
      (channelCode === 'all' || order.channelCode === channelCode)
      && (fulfillmentStatus === 'all' || order.fulfillmentStatus === fulfillmentStatus)
      && (!from || limaDate(order.orderedAt) >= from)
      && (!term || [order.externalOrderNumber, order.customer?.name, order.customer?.documentNumber]
        .some((value) => String(value || '').toLowerCase().includes(term)))
    ));
  }, [channelCode, dateRange, demoOrders, fulfillmentStatus, search]);

  const demoMode = !loading && !loadError && !hasRealOrders;
  const displayedOrders = demoMode ? filteredDemoOrders : orders;
  const displayedTotal = demoMode ? filteredDemoOrders.length : totalCount;
  const totalPages = demoMode ? 1 : Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const companyById = useMemo(
    () => new Map(companies.map((company) => [company.id, companyName(company)])),
    [companies],
  );

  const manualAccounts = useMemo(
    () => accounts.filter((account) => account.channelCode === 'manual' && account.active),
    [accounts],
  );
  const availableManualCompanies = useMemo(
    () => companies.filter((company) => manualAccounts.some((account) => account.companyId === company.id)),
    [companies, manualAccounts],
  );
  const manualTotal = manualLines.reduce((sum, line) => {
    const product = DEMO_PRODUCTS.find((item) => item.sku === line.productSku);
    return sum + Number(product?.price || 0) * Math.max(1, Number(line.quantity || 1));
  }, 0);

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
      setLoadError(error?.message || 'No se pudo abrir el pedido.');
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const resetManualForm = () => {
    setSaleSource('tienda_fisica');
    setCustomerName('');
    setCustomerDocument('');
    setDocumentType('boleta');
    setNotes('');
    setManualLines([newLine()]);
    setCreateError('');
  };

  const openCreate = () => {
    const filteredCompany = companyId !== 'all'
      ? availableManualCompanies.find((company) => company.id === Number(companyId))
      : null;
    setManualCompanyId(String(filteredCompany?.id || availableManualCompanies[0]?.id || ''));
    setCreateOpen(true);
    setCreateError('');
  };

  const updateLine = (lineId: string, patch: Partial<ManualLine>) => {
    setManualLines((current) => current.map((line) => line.id === lineId ? { ...line, ...patch } : line));
  };

  const createManualOrder = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreateError('');
    const selectedCompanyId = Number(manualCompanyId);
    const account = manualAccounts.find((item) => item.companyId === selectedCompanyId);
    const selectedLines = manualLines.map((line) => ({
      line,
      product: DEMO_PRODUCTS.find((product) => product.sku === line.productSku),
    })).filter((entry) => entry.product);

    if (!account) {
      setCreateError('Esta empresa todavía no tiene habilitado el canal de venta manual.');
      return;
    }
    if (!customerName.trim()) {
      setCreateError('Ingresa el nombre del cliente.');
      return;
    }
    if (!selectedLines.length || selectedLines.length !== manualLines.length) {
      setCreateError('Selecciona un producto en cada línea de la venta.');
      return;
    }

    setCreating(true);
    try {
      const orderNumber = `VTA-${new Date().toISOString().replace(/\D/g, '').slice(2, 14)}`;
      await api.createManagedOrder({
        companyId: selectedCompanyId,
        channelAccountId: account.id,
        externalOrderId: orderNumber,
        externalOrderNumber: orderNumber,
        orderStatus: 'confirmed',
        paymentStatus: 'paid',
        fulfillmentStatus: saleSource === 'tienda_fisica' ? 'delivered' : 'pending',
        requestedDocumentType: documentType === 'none' ? null : documentType,
        currency: 'PEN',
        subtotal: manualTotal,
        total: manualTotal,
        customer: {
          name: customerName.trim(),
          documentNumber: customerDocument.trim(),
        },
        shipping: { type: saleSource },
        metadata: { origin: 'manual_ui', saleSource, notes: notes.trim(), catalog: 'demo' },
        orderedAt: new Date().toISOString(),
        itemsComplete: true,
        items: selectedLines.map(({ line, product }, index) => ({
          externalItemId: `${orderNumber}-${index + 1}`,
          sku: product!.sku,
          description: product!.name,
          quantity: Math.max(1, Number(line.quantity || 1)),
          unitPrice: product!.price,
          total: product!.price * Math.max(1, Number(line.quantity || 1)),
        })),
      });
      setHasRealOrders(true);
      setCompanyId('all');
      setChannelCode('all');
      setFulfillmentStatus('all');
      setDateRange('today');
      setSearch('');
      setPage(1);
      setCreateOpen(false);
      resetManualForm();
      setSuccessMessage(`Venta ${orderNumber} registrada correctamente.`);
      await Promise.all([load(), loadSalesPulse()]);
    } catch (error: any) {
      setCreateError(error?.message || 'No se pudo registrar la venta.');
    } finally {
      setCreating(false);
    }
  };

  const pulseSellers = salesPulse?.sellers || [];
  const sellersWithSales = pulseSellers.filter((seller) => seller.ordersCount > 0);
  const sellersWithoutSales = pulseSellers.filter((seller) => seller.ordersCount === 0);
  const hasActiveFilters = companyId !== 'all' || channelCode !== 'all' || fulfillmentStatus !== 'all' || dateRange !== 'today' || Boolean(search.trim());
  const clearFilters = () => {
    setCompanyId('all');
    setChannelCode('all');
    setFulfillmentStatus('all');
    setDateRange('today');
    setSearch('');
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-md border border-border bg-card" aria-labelledby="sales-pulse-title">
        <div className="flex flex-col gap-4 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <h2 id="sales-pulse-title" className="flex items-center gap-2 text-base font-semibold">
              <CalendarDays className="size-4 text-muted-foreground" /> Ventas de hoy
              {demoMode && <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300"><WandSparkles /> Demo</Badge>}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">Todos los productos vendidos, sin importar el canal.</p>
          </div>
          <div className="flex items-center gap-2">
            {pulseError && <Button type="button" variant="ghost" onClick={loadSalesPulse} className="h-11 cursor-pointer text-destructive">Reintentar</Button>}
            <Button onClick={openCreate} disabled={!availableManualCompanies.length} size="lg" className="min-h-11 cursor-pointer">
              <Plus /> Registrar venta
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4">
          <TodayMetric label="Venta total" value={salesPulse ? formatMoney(salesPulse.salesTotal) : '—'} loading={pulseLoading} />
          <TodayMetric className="border-l border-border" label="Ventas válidas" value={salesPulse ? String(salesPulse.ordersCount) : '—'} loading={pulseLoading} />
          <TodayMetric className="border-t border-border sm:border-l sm:border-t-0" label="Unidades" value={salesPulse ? String(salesPulse.unitsSold) : '—'} loading={pulseLoading} />
          <TodayMetric className="border-l border-t border-border sm:border-t-0" label="Sellers activos" value={salesPulse ? `${salesPulse.sellersWithSales} / ${pulseSellers.length}` : '—'} loading={pulseLoading} />
        </div>

        <div className="flex min-h-12 flex-wrap items-center gap-x-5 gap-y-2 border-y border-border bg-muted/20 px-4 py-2 sm:px-5" aria-label="Ventas de hoy por canal">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Canales</span>
          {pulseLoading ? <span className="text-sm text-muted-foreground">Actualizando…</span> : salesPulse?.channels.length ? salesPulse.channels.map((channel) => (
            <span key={channel.code} className="flex items-center gap-2 text-sm">
              <ChannelIcon code={channel.code} name={channel.name} size="sm" />
              <span className="font-medium">{channel.name}</span>
              <span className="tabular-nums text-muted-foreground">{channel.ordersCount}</span>
            </span>
          )) : <span className="text-sm text-muted-foreground">Aún no hay ventas registradas hoy.</span>}
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1.55fr)_minmax(18rem,0.45fr)]">
          <div className="min-w-0 lg:border-r lg:border-border">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
              <div>
                <h3 className="text-sm font-semibold">Productos vendidos</h3>
                <p className="text-xs text-muted-foreground">Ordenados por unidades vendidas hoy</p>
              </div>
              <span className="text-xs text-muted-foreground">Top {salesPulse?.topProducts.length || 0}</span>
            </div>
            <TodayProducts products={salesPulse?.topProducts || []} loading={pulseLoading} />
          </div>

          <aside aria-label="Cobertura de sellers">
            <div className="border-b border-border px-4 py-3 sm:px-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Cobertura de sellers</h3>
                  <p className="text-xs text-muted-foreground">Quién registró ventas hoy</p>
                </div>
                <span className="text-sm font-semibold tabular-nums">{salesPulse ? `${salesPulse.sellersWithSales}/${pulseSellers.length}` : '—'}</span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-[width] duration-200 motion-reduce:transition-none"
                  style={{ width: pulseSellers.length ? `${(sellersWithSales.length / pulseSellers.length) * 100}%` : '0%' }}
                />
              </div>
            </div>
            <SellerGroup
              title="Sin ventas"
              count={sellersWithoutSales.length}
              sellers={sellersWithoutSales}
              loading={pulseLoading}
              selectedCompanyId={companyId}
              onSelect={(sellerId) => {
                setCompanyId(companyId === String(sellerId) ? 'all' : String(sellerId));
                setPage(1);
              }}
              emptySales
            />
            <SellerGroup
              title="Con ventas"
              count={sellersWithSales.length}
              sellers={sellersWithSales}
              loading={pulseLoading}
              selectedCompanyId={companyId}
              onSelect={(sellerId) => {
                setCompanyId(companyId === String(sellerId) ? 'all' : String(sellerId));
                setPage(1);
              }}
              className="border-t border-border"
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

      <TablePanel>
        <TablePanelHeader className="space-y-4 bg-card">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Buscar pedido, cliente o documento"
                aria-label="Buscar pedidos"
                className="h-11 pl-9 sm:h-9"
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:flex">
              <Select value={dateRange} onValueChange={(value) => setDateRange(value as 'today' | '7days' | 'all')}>
                <SelectTrigger className="w-full data-[size=default]:h-11 sm:data-[size=default]:h-9 xl:w-36"><SelectValue placeholder="Período" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Hoy</SelectItem>
                  <SelectItem value="7days">Últimos 7 días</SelectItem>
                  <SelectItem value="all">Todo el historial</SelectItem>
                </SelectContent>
              </Select>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger className="w-full data-[size=default]:h-11 sm:data-[size=default]:h-9 xl:w-40"><SelectValue placeholder="Seller" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los sellers</SelectItem>
                  {companies.map((company) => <SelectItem key={company.id} value={String(company.id)}>{companyName(company)}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={channelCode} onValueChange={setChannelCode}>
                <SelectTrigger className="w-full data-[size=default]:h-11 sm:data-[size=default]:h-9 xl:w-40"><SelectValue placeholder="Origen" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los orígenes</SelectItem>
                  {channelCatalog.map((channel) => <SelectItem key={channel.code} value={channel.code}>{channel.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={fulfillmentStatus} onValueChange={setFulfillmentStatus}>
                <SelectTrigger className="w-full data-[size=default]:h-11 sm:data-[size=default]:h-9 xl:w-40"><SelectValue placeholder="Estado" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los estados</SelectItem>
                  {Object.entries(FULFILLMENT_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {hasActiveFilters && (
              <Button variant="ghost" size="icon" className="size-11 cursor-pointer sm:size-9" onClick={clearFilters} aria-label="Limpiar filtros" title="Limpiar filtros"><X /></Button>
            )}
            <Button variant="outline" size="icon" className="size-11 cursor-pointer sm:size-9" onClick={() => Promise.all([load(), loadSalesPulse()])} disabled={loading || pulseLoading} aria-label="Actualizar pedidos" title="Actualizar pedidos">
              <RefreshCw className={cn((loading || pulseLoading) && 'animate-spin motion-reduce:animate-none')} />
            </Button>
          </div>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">{dateRange === 'today' ? 'Pedidos de hoy' : dateRange === '7days' ? 'Pedidos de los últimos 7 días' : 'Todos los pedidos'} · {displayedTotal}</p>
              <p className="text-xs text-muted-foreground">Selecciona una fila para revisar productos y actividad.</p>
            </div>
            {demoMode && <p className="text-xs text-muted-foreground">La muestra desaparece cuando registres o sincronices el primer pedido real.</p>}
          </div>
        </TablePanelHeader>

        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[42%] sm:w-[32%] lg:w-[20%]">Pedido</TableHead>
              <TableHead className="hidden w-[20%] md:table-cell">Seller</TableHead>
              <TableHead className="hidden w-[20%] lg:table-cell">Cliente</TableHead>
              <TableHead className="w-[34%] sm:w-[28%] lg:w-[16%]">Estado</TableHead>
              <TableHead className="hidden w-[17%] xl:table-cell">Fecha</TableHead>
              <TableHead className="w-[24%] text-right sm:w-[20%] lg:w-[13%]">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <div className="flex h-36 items-center justify-center gap-2 text-muted-foreground">
                    <Loader2 className="size-5 animate-spin motion-reduce:animate-none" /> Cargando pedidos…
                  </div>
                </TableCell>
              </TableRow>
            ) : displayedOrders.length ? displayedOrders.map((order) => (
              <TableRow
                key={order.id}
                className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
                onClick={() => openDetail(order)}
                tabIndex={0}
                aria-label={`Abrir pedido ${order.externalOrderNumber}`}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openDetail(order);
                  }
                }}
              >
                <TableCell>
                  <div className="truncate font-mono font-medium text-foreground">{order.externalOrderNumber}</div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground md:hidden">{companyById.get(order.companyId) || `Empresa ${order.companyId}`}</div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground lg:hidden">{order.customer?.name || 'Cliente sin nombre'}</div>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <div className="flex min-w-0 items-center gap-2">
                    <ChannelMark code={order.channelCode} name={order.channelName} />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{companyById.get(order.companyId) || `Empresa ${order.companyId}`}</div>
                      {order.channelCode !== 'falabella' && <div className="truncate text-xs text-muted-foreground">{order.channelName}</div>}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  <div className="truncate">{order.customer?.name || 'Sin nombre'}</div>
                  {order.customer?.documentNumber && <div className="mt-0.5 font-mono text-xs text-muted-foreground">{order.customer.documentNumber}</div>}
                </TableCell>
                <TableCell>{fulfillmentBadge(order.fulfillmentStatus)}</TableCell>
                <TableCell className="hidden xl:table-cell">
                  <div>{formatDate(order.orderedAt)}</div>
                  {order.promisedShippingAt && <div className="mt-0.5 text-xs text-muted-foreground">Límite: {formatDate(order.promisedShippingAt)}</div>}
                </TableCell>
                <TableCell className="truncate text-right font-medium tabular-nums">{formatMoney(order.total, order.currency)}</TableCell>
              </TableRow>
            )) : (
              <TableRow>
                <TableCell colSpan={6}>
                  <div className="flex flex-col items-center gap-2 py-14 text-center">
                    <Store className="size-8 text-muted-foreground/50" />
                    <p className="text-sm font-medium">No hay pedidos para estos filtros</p>
                    <p className="text-sm text-muted-foreground">Prueba otra búsqueda o registra una venta manual.</p>
                    <Button size="sm" className="mt-2 h-11 cursor-pointer sm:h-8" onClick={openCreate} disabled={!availableManualCompanies.length}><Plus /> Registrar venta</Button>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <TablePanelFooter>
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              {displayedTotal ? demoMode ? `Mostrando ${displayedTotal} de muestra` : `Mostrando ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, totalCount)} de ${totalCount}` : '0 pedidos'}
            </p>
            {!demoMode && totalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-11 cursor-pointer sm:h-8" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}>
                  <ChevronLeft /> Anterior
                </Button>
                <Button variant="outline" size="sm" className="h-11 cursor-pointer sm:h-8" disabled={page >= totalPages || loading} onClick={() => setPage((current) => current + 1)}>
                  Siguiente <ChevronRight />
                </Button>
              </div>
            )}
          </div>
        </TablePanelFooter>
      </TablePanel>

      <Dialog open={createOpen} onOpenChange={(open) => !creating && setCreateOpen(open)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto [&_[data-slot=dialog-close]]:size-11 sm:max-w-2xl">
          <form onSubmit={createManualOrder} className="space-y-5 [&_[data-slot=select-trigger]]:h-11 [&_input]:h-11">
            <DialogHeader>
              <DialogTitle>Registrar venta</DialogTitle>
              <DialogDescription>Registra la venta para que el equipo pueda verla y gestionarla aquí.</DialogDescription>
            </DialogHeader>

            {createError && (
              <div role="alert" className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
                <AlertCircle className="size-4 shrink-0" /> {createError}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Seller" htmlFor="manual-company">
                <Select value={manualCompanyId} onValueChange={setManualCompanyId} disabled={creating}>
                  <SelectTrigger id="manual-company" className="w-full data-[size=default]:h-11"><SelectValue placeholder="Selecciona una empresa" /></SelectTrigger>
                  <SelectContent>
                    {availableManualCompanies.map((company) => <SelectItem key={company.id} value={String(company.id)}>{companyName(company)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Origen de la venta" htmlFor="sale-source">
                <Select value={saleSource} onValueChange={setSaleSource} disabled={creating}>
                  <SelectTrigger id="sale-source" className="w-full data-[size=default]:h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tienda_fisica">Tienda física</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="instagram">Instagram</SelectItem>
                    <SelectItem value="telefono">Teléfono</SelectItem>
                    <SelectItem value="otro">Otro canal</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Cliente" htmlFor="customer-name">
                <Input id="customer-name" value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Nombre o razón social" disabled={creating} />
              </Field>
              <Field label="DNI o RUC" htmlFor="customer-document" hint="Opcional">
                <Input id="customer-document" value={customerDocument} onChange={(event) => setCustomerDocument(event.target.value)} placeholder="Documento del cliente" inputMode="numeric" disabled={creating} />
              </Field>
              <Field label="Comprobante" htmlFor="document-type">
                <Select value={documentType} onValueChange={setDocumentType} disabled={creating}>
                  <SelectTrigger id="document-type" className="w-full data-[size=default]:h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="boleta">Boleta</SelectItem>
                    <SelectItem value="factura">Factura</SelectItem>
                    <SelectItem value="none">Sin comprobante por ahora</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Nota interna" htmlFor="sale-notes" hint="Opcional">
                <Input id="sale-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Ej. recoger en tienda" disabled={creating} />
              </Field>
            </div>

            <section className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium">Productos</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">Catálogo de muestra para probar el flujo de registro.</p>
                </div>
                <Button type="button" variant="outline" size="sm" className="h-11 cursor-pointer" onClick={() => setManualLines((current) => [...current, newLine()])} disabled={creating}>
                  <Plus /> Agregar
                </Button>
              </div>
              <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
                {manualLines.map((line, index) => (
                  <div key={line.id} className="grid gap-2 sm:grid-cols-[1fr_6rem_2rem] sm:items-center">
                    <Select value={line.productSku} onValueChange={(value) => updateLine(line.id, { productSku: value })} disabled={creating}>
                      <SelectTrigger aria-label={`Producto ${index + 1}`} className="w-full bg-background data-[size=default]:h-11"><SelectValue placeholder="Selecciona un producto" /></SelectTrigger>
                      <SelectContent>
                        {DEMO_PRODUCTS.map((product) => (
                          <SelectItem key={product.sku} value={product.sku}>
                            {product.name} · {formatMoney(product.price)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      min={1}
                      max={99}
                      value={line.quantity}
                      onChange={(event) => updateLine(line.id, { quantity: Math.max(1, Number(event.target.value || 1)) })}
                      aria-label={`Cantidad del producto ${index + 1}`}
                      className="bg-background"
                      disabled={creating}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="size-11 cursor-pointer"
                      aria-label={`Eliminar producto ${index + 1}`}
                      title="Eliminar producto"
                      onClick={() => setManualLines((current) => current.filter((item) => item.id !== line.id))}
                      disabled={creating || manualLines.length === 1}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between rounded-md bg-muted/40 px-4 py-3">
                <span className="text-sm text-muted-foreground">Total de la venta</span>
                <span className="text-base font-semibold tabular-nums">{formatMoney(manualTotal)}</span>
              </div>
            </section>

            <DialogFooter>
              <Button type="button" variant="outline" className="h-11 cursor-pointer" onClick={() => setCreateOpen(false)} disabled={creating}>Cancelar</Button>
              <Button type="submit" className="h-11 cursor-pointer" disabled={creating || !manualCompanyId || manualTotal <= 0}>
                {creating ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Package />} {creating ? 'Registrando…' : 'Registrar venta'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-h-[88vh] overflow-y-auto [&_[data-slot=dialog-close]]:size-11 sm:max-w-3xl">
          {detailLoading ? (
            <div className="flex h-56 items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="size-5 animate-spin motion-reduce:animate-none" /> Cargando detalle…
            </div>
          ) : detail ? (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3 pr-8">
                  <ChannelMark code={detail.channelCode} name={detail.channelName} />
                  <div>
                    <DialogTitle>Pedido {detail.externalOrderNumber}</DialogTitle>
                    <DialogDescription>{detail.channelName} · {detail.channelAccountName} · {companyById.get(detail.companyId) || `Empresa ${detail.companyId}`}</DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <div className="grid gap-3 sm:grid-cols-3">
                <DetailStat label="Despacho" content={fulfillmentBadge(detail.fulfillmentStatus)} />
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
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={htmlFor}>{label}</Label>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function TodayMetric({ label, value, loading, className }: { label: string; value: string; loading: boolean; className?: string }) {
  return (
    <div className={cn('min-w-0 px-4 py-3 sm:px-5 sm:py-4', className)}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {loading ? (
        <div className="mt-2 h-6 w-24 animate-pulse rounded bg-muted motion-reduce:animate-none" />
      ) : (
        <p className="mt-1 truncate text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">{value}</p>
      )}
    </div>
  );
}

function TodayProducts({ products, loading }: { products: SalesPulse['topProducts']; loading: boolean }) {
  if (loading) {
    return (
      <div className="divide-y divide-border" aria-label="Cargando productos vendidos hoy">
        {[0, 1, 2, 3, 4].map((item) => (
          <div key={item} className="flex h-[4.5rem] items-center gap-3 px-4 sm:px-5">
            <div className="size-9 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
            <div className="flex-1 space-y-2"><div className="h-3 w-2/3 animate-pulse rounded bg-muted motion-reduce:animate-none" /><div className="h-2.5 w-28 animate-pulse rounded bg-muted motion-reduce:animate-none" /></div>
            <div className="h-4 w-16 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          </div>
        ))}
      </div>
    );
  }

  if (!products.length) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center gap-2 px-6 text-center">
        <PackageSearch className="size-8 text-muted-foreground/60" />
        <p className="text-sm font-medium">Aún no hay productos vendidos hoy</p>
        <p className="max-w-sm text-sm text-muted-foreground">Cuando ingrese una venta desde cualquier canal, sus productos aparecerán aquí.</p>
      </div>
    );
  }

  return (
    <ol className="divide-y divide-border">
      {products.map((product, index) => (
        <li key={`${product.sku}:${product.name}`} className="grid min-h-[4.5rem] grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 sm:grid-cols-[2rem_minmax(0,1fr)_auto_auto] sm:px-5">
          <span className="font-mono text-xs tabular-nums text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground" title={product.name}>{product.name}</p>
            <div className="mt-1 flex items-center gap-2">
              <span className="truncate font-mono text-xs text-muted-foreground">{product.sku}</span>
              <span className="hidden items-center gap-1 sm:flex" aria-label={`Canales: ${product.channelCodes.join(', ')}`}>
                {product.channelCodes.map((code) => <ChannelIcon key={code} code={code} size="sm" />)}
              </span>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold tabular-nums">{product.unitsSold}</p>
            <p className="text-[11px] text-muted-foreground">unidades</p>
          </div>
          <div className="hidden min-w-24 text-right sm:block">
            <p className="text-sm font-medium tabular-nums">{formatMoney(product.salesTotal)}</p>
            <p className="text-[11px] text-muted-foreground">{product.ordersCount} {product.ordersCount === 1 ? 'pedido' : 'pedidos'}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function SellerGroup({
  title,
  count,
  sellers,
  selectedCompanyId,
  onSelect,
  emptySales = false,
  loading = false,
  className,
}: {
  title: string;
  count: number;
  sellers: SalesPulseSeller[];
  selectedCompanyId: string;
  onSelect: (companyId: number) => void;
  emptySales?: boolean;
  loading?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 px-4 py-4 sm:px-5', className)}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {emptySales ? <CircleDashed className="size-3.5" /> : <CheckCircle2 className="size-3.5 text-emerald-600" />}
          {title}
        </p>
        <span className="text-xs font-medium tabular-nums text-muted-foreground">{count}</span>
      </div>
      <div className="max-h-40 overflow-y-auto">
        {loading ? (
          <div className="space-y-2 py-1" aria-label={`Cargando sellers ${title.toLowerCase()}`}>
            {[0, 1, 2].map((item) => <div key={item} className="h-9 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />)}
          </div>
        ) : sellers.length ? sellers.map((seller) => {
          const selected = selectedCompanyId === String(seller.companyId);
          const initials = seller.companyName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
          return (
            <button
              key={seller.companyId}
              type="button"
              onClick={() => onSelect(seller.companyId)}
              aria-pressed={selected}
              className={cn(
                'flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-md px-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                selected && 'bg-primary/8 ring-1 ring-primary/20',
              )}
            >
              <span className={cn(
                'grid size-7 shrink-0 place-items-center rounded-full text-[10px] font-semibold',
                emptySales ? 'bg-muted text-muted-foreground' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
              )}>{initials || '—'}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{seller.companyName}</span>
              <span className="shrink-0 text-right">
                {emptySales ? (
                  <span className="text-xs text-muted-foreground">Sin ventas</span>
                ) : (
                  <>
                    <span className="block text-xs font-semibold tabular-nums">{formatMoney(seller.salesTotal)}</span>
                    <span className="block text-[11px] text-muted-foreground">{seller.ordersCount} {seller.ordersCount === 1 ? 'venta' : 'ventas'}</span>
                  </>
                )}
              </span>
            </button>
          );
        }) : (
          <div className="flex min-h-20 items-center gap-2 px-2 text-sm text-muted-foreground">
            {emptySales ? <Users className="size-4" /> : <CircleDashed className="size-4" />}
            {emptySales ? 'Todos registraron ventas' : 'Aún no hay ventas hoy'}
          </div>
        )}
      </div>
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
