import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import * as Select from '@radix-ui/react-select';
import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileText,
  FilePlus2,
  Loader2,
  RefreshCw,
  Send,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import { useAppStore } from '../stores/app';
import api from '../lib/api';

// Tooltip estilo shadcn (sin dependencia): burbuja oscura al hover con flecha.
function Tooltip({ content, children }: { content: React.ReactNode; children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
    >
      {children}
      {show && (
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium text-background shadow-md"
        >
          {content}
          <span className="absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1 rotate-45 bg-foreground" />
        </span>
      )}
    </span>
  );
}

function sunatReason(raw?: string): string {
  if (!raw) return '';
  let msg = raw;
  try {
    const parsed = JSON.parse(raw);
    msg = parsed.message || parsed.error || parsed.description || raw;
  } catch { /* texto plano */ }
  return String(msg)
    .replace(/&#243;/g, 'ó')
    .replace(/&#[0-9]+;/g, '')
    .replace(/\[Paso[^\]]*\]\s*/g, '')
    .trim();
}

function emissionStatusInfo(status: EmissionItemStatus) {
  switch (status) {
    case 'creating':
      return { label: 'Creando', className: 'border-blue-200 bg-blue-50 text-blue-700', icon: Loader2 };
    case 'sending':
      return { label: 'Enviando', className: 'border-amber-200 bg-amber-50 text-amber-700', icon: Loader2 };
    case 'accepted':
      return { label: 'Aceptada', className: 'border-emerald-200 bg-emerald-50 text-emerald-700', icon: CheckCircle2 };
    case 'rejected':
      return { label: 'Rechazada', className: 'border-red-200 bg-red-50 text-red-700', icon: XCircle };
    case 'skipped':
      return { label: 'Omitida', className: 'border-slate-200 bg-slate-50 text-slate-700', icon: AlertCircle };
    default:
      return { label: 'Pendiente', className: 'border-border bg-muted/40 text-muted-foreground', icon: FileText };
  }
}

function inferEmissionStatus(message: string): EmissionItemStatus {
  const normalized = message.toLowerCase();
  if (normalized.includes('creando')) return 'creating';
  if (normalized.includes('enviando')) return 'sending';
  if (normalized.includes('aceptada') || normalized.includes('aceptado')) return 'accepted';
  if (normalized.includes('rechazada') || normalized.includes('rechazado') || normalized.includes('error')) return 'rejected';
  if (normalized.includes('omitida') || normalized.includes('omitido')) return 'skipped';
  return 'pending';
}

function parseEmissionProgress(status: string) {
  const match = status.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (!match) return null;
  const message = match[2]?.trim() || status;
  return {
    orderNumber: match[1].trim(),
    message,
    status: inferEmissionStatus(message),
    numeroCompleto: message.match(/\b[BF]\d{3}-\d{6}\b/)?.[0] || '',
  };
}

// Celda de estado del documento local: ícono por estado + tooltip shadcn.
// El refresh solo aparece si NO está aceptado (ya aceptado = estado final).
function DocumentStatusCell({ label, status, reason, boletaId, facturaId }: { label: string; status: string; reason?: string; boletaId?: number; facturaId?: number }) {
  const [current, setCurrent] = useState(status);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => setCurrent(status), [status]);
  const s = String(current || '').toUpperCase();
  const accepted = s === 'ACEPTADO';
  const canRefresh = boletaId != null || facturaId != null;
  const hasDocumentLabel = Boolean(String(label || '').trim() && String(label || '').trim() !== '-');
  const noDocument = !hasDocumentLabel && !canRefresh;

  const refresh = async () => {
    if (!canRefresh) return;
    setRefreshing(true);
    try {
      const r: any = boletaId != null
        ? await api.refreshBoletaStatus(boletaId)
        : await api.refreshFacturaStatus(facturaId as number);
      if (r?.estadoSunat) setCurrent(r.estadoSunat);
    } catch { /* noop */ }
    setRefreshing(false);
  };

  const readableReason = sunatReason(reason);
  const view = noDocument
    ? { Icon: XCircle, color: 'text-muted-foreground', title: 'Sin documento' }
    : accepted
    ? { Icon: CheckCircle2, color: 'text-emerald-600', title: 'Aceptado por SUNAT' }
    : s === 'RECHAZADO'
    ? { Icon: XCircle, color: 'text-red-600', title: readableReason || 'Rechazado por SUNAT' }
    : { Icon: AlertCircle, color: 'text-amber-500', title: `${current || 'Enviado'} · pendiente de confirmación en SUNAT` };
  const Icon = view.Icon;

  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-xs">{label}</span>
      <Tooltip content={view.title}>
        <span className={`inline-flex ${view.color}`}>
          <Icon className="h-4 w-4" />
        </span>
      </Tooltip>
      {!noDocument && !accepted && canRefresh && (
        <Tooltip content="Actualizar estado en SUNAT">
          <button
            type="button" onClick={refresh} disabled={refreshing}
            className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </Tooltip>
      )}
    </div>
  );
}

type Company = {
  id: number;
  ruc: string;
  razonSocial: string;
  nombre?: string | null;
  direccion?: string | null;
  ubigeo?: string | null;
  usuarioSol?: string | null;
  claveSol?: string | null;
  certificado?: string | null;
  certificadoPassword?: string | null;
  modoProduccion?: boolean | null;
  falabellaApiUserId?: string | null;
  falabellaApiKey?: string | null;
};

const FALABELLA_COMPANIES_CACHE_KEY = 'boletas.falabellaApi.companies';
const APP_STORE_KEY = 'boletas.app';

function readCachedCompanies(): Company[] {
  try {
    const raw = localStorage.getItem(FALABELLA_COMPANIES_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCachedCompanies(companies: Company[]) {
  try {
    localStorage.setItem(FALABELLA_COMPANIES_CACHE_KEY, JSON.stringify(companies));
  } catch {
    // Ignore cache write failures; the service remains the source of truth.
  }
}

function readCachedActiveCompanyId(): number | null {
  try {
    const raw = localStorage.getItem(APP_STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const id = Number(parsed?.state?.activeCompanyId);
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

type InvoiceKind = 'BOLETA' | 'FACTURA' | 'NOTA_DE_CREDITO';
type DocumentSource = 'local_boleta' | 'local_factura' | 'local_credit_note' | 'manual';
type PdfMode = 'auto' | 'local_file' | 'selected_file';

type FalabellaOrderPayload = {
  Order?: FalabellaOrder;
} & FalabellaOrder;

type FalabellaOrder = {
  OrderId?: string | number;
  OrderNumber?: string | number;
  CustomerFirstName?: string;
  CustomerLastName?: string;
  Price?: string | number;
  GrandTotal?: string | number;
  CreatedAt?: string;
  UpdatedAt?: string;
  PaymentMethod?: string;
  ItemsCount?: string | number;
  InvoiceRequired?: boolean | string | number;
  Statuses?: Array<{ Status?: string }>;
};

type ResolvedDocumentOption = {
  kind: InvoiceKind;
  source: DocumentSource;
  boletaId?: number;
  facturaId?: number;
  creditNoteId?: number;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceType: InvoiceKind;
  pdfPath: string;
  estadoSunat?: string;
  respuestaSunat?: string;
  falabellaPdfUploadedAt?: string;
};

type ResolvedDocumentResponse = {
  orderNumber: string;
  boleta?: {
    id: number;
    numeroCompleto: string;
    fechaEmision: string;
    pdfPath: string;
    estadoSunat?: string;
    respuestaSunat?: string;
    falabellaPdfUploadedAt?: string;
    total?: string;
    cliente?: string;
    clienteDocumento?: string;
    codigoHash?: string;
    xmlPath?: string;
  } | null;
  factura?: {
    id: number;
    numeroCompleto: string;
    fechaEmision: string;
    pdfPath: string;
    estado?: string;
    estadoSunat?: string;
    respuestaSunat?: string;
    total?: string;
    cliente?: string;
    clienteDocumento?: string;
    codigoHash?: string;
    xmlPath?: string;
    falabellaPdfUploadedAt?: string;
  } | null;
  creditNote?: {
    id: number;
    numeroCompleto: string;
    fechaEmision: string;
    pdfPath: string;
    estadoSunat?: string;
    respuestaSunat?: string;
  } | null;
  options: ResolvedDocumentOption[];
  defaultKind: InvoiceKind;
};

type OrderItemsResponse = {
  ok?: boolean;
  status?: number;
  orderItems?: Array<{ OrderItemId?: string | number }>;
  orderItemIds?: string[];
  error?: {
    Head?: {
      ErrorCode?: string | number;
      ErrorMessage?: string;
    };
    Body?: unknown;
  } | string;
};

type UploadInvoiceResponse = {
  ok?: boolean;
  status?: number;
  error?: {
    Head?: {
      ErrorCode?: string | number;
      ErrorMessage?: string;
    };
    Body?: unknown;
  } | string;
  data?: unknown;
  rawText?: string;
};

type UploadModalState = {
  open: boolean;
  loading: boolean;
  submitting: boolean;
  lockedBoleta: boolean;
  error: string;
  uploadResult: UploadInvoiceResponse | null;
  order: FalabellaOrder | null;
  orderItemIds: string[];
  resolved: ResolvedDocumentResponse | null;
  selectedKind: InvoiceKind;
  source: DocumentSource;
  boletaId?: number;
  facturaId?: number;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceType: InvoiceKind;
  pdfMode: PdfMode;
  pdfPath: string;
  pdfBase64: string;
  pdfName: string;
  previewHtml: string;
  previewUrl: string;
};

type FalabellaBatchResult = {
  boletaId: number;
  numeroCompleto: string;
  orderNumber: string;
  ok?: boolean;
  skipped?: boolean;
  status?: number;
  orderId?: string | number;
  error?: unknown;
  orderItemIds?: string[];
};

type FalabellaBatchCandidate = {
  id: number;
  numeroCompleto: string;
  orderNumber: string;
  fechaEmision: string;
  estadoSunat: string;
  pdfPath: string;
  orderId?: string | number;
  total: number;
  uploadedAt?: string;
  reason?: string;
};

type FalabellaBatchState = {
  open: boolean;
  running: boolean;
  current: number;
  total: number;
  currentLabel: string;
  error: string;
  eligible: FalabellaBatchCandidate[];
  skipped: FalabellaBatchCandidate[];
  results: FalabellaBatchResult[];
};

type EmitBoletaModalState = {
  open: boolean;
  loading: boolean;
  processing: boolean;
  error: string;
  rows: InvoiceFlowRow[];
  ventas: any[];
  emissionItems: EmissionItem[];
  warningsByOrder: Record<string, string[]>;
  validationErrors: string[];
  previewHtml: string;
  previewTitle: string;
  previewLoadingOrder: string;
  expandedOrders: Record<string, boolean>;
  result: any | null;
  progress: { current: number; total: number; status: string };
  log: string[];
};

type EmissionItemStatus = 'pending' | 'creating' | 'sending' | 'accepted' | 'rejected' | 'skipped';

type EmissionItem = {
  orderNumber: string;
  invoiceKind: InvoiceKind;
  numeroCompleto: string;
  status: EmissionItemStatus;
  message: string;
  error: string;
};

type InvoiceFlowBucket = 'ready_to_invoice' | 'has_document' | 'not_ready' | 'review';
type InvoiceFlowFilter = InvoiceFlowBucket;

type InvoiceFlowRow = {
  order: FalabellaOrder;
  orderNumber: string;
  orderId: string;
  createdAt: string;
  status: string;
  statusKey: string;
  statusLabel: string;
  statusDescription: string;
  invoiceKind: 'BOLETA' | 'FACTURA';
  total: number;
  bucket: InvoiceFlowBucket;
  actionLabel: string;
  documentLabel: string;
  documentStatus: string;
  documentReason: string;
  documentKind?: InvoiceKind;
  documentSource?: DocumentSource;
  documentId?: number;
  documentDate?: string;
  documentPdfPath?: string;
  documentUploadedAt?: string;
};

type InvoiceFlowState = {
  loading: boolean;
  error: string;
  rows: InvoiceFlowRow[];
  totalOrders: number;
  checkedOrders: number;
};

function formatDate(value?: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace('T', ' ').slice(0, 19);
  return new Intl.DateTimeFormat('es-PE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function normalizeOrder(order: FalabellaOrderPayload): FalabellaOrder {
  if (order?.Order && typeof order.Order === 'object') return order.Order;
  return order;
}

function formatStatus(order: FalabellaOrder) {
  const statuses = order.Statuses;
  if (Array.isArray(statuses)) return statuses.map((entry) => entry.Status).filter(Boolean).join(', ') || '-';
  if (statuses && typeof statuses === 'object') {
    const status = (statuses as { Status?: string; Name?: string }).Status || (statuses as { Status?: string; Name?: string }).Name;
    return status || JSON.stringify(statuses);
  }
  return String(statuses || '-');
}

function normalizeStatusKey(order: FalabellaOrder) {
  return formatStatus(order).toLowerCase().replace(/\s+/g, '_');
}

function orderTotal(order: FalabellaOrder) {
  const value = order.GrandTotal ?? order.Price ?? 0;
  const parsed = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number) {
  return new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(value || 0);
}

function monthStart(month: string) {
  return `${month}-01T00:00:00+00:00`;
}

function monthEnd(month: string) {
  const [year, monthText] = month.split('-').map(Number);
  const lastDay = new Date(year, monthText, 0).getDate();
  return `${month}-${String(lastDay).padStart(2, '0')}T23:59:59+00:00`;
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const monthNames = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

function parseMonth(value: string) {
  const [yearRaw, monthRaw] = value.split('-');
  const year = Number(yearRaw) || new Date().getFullYear();
  const monthIndex = Math.max(0, Math.min(11, (Number(monthRaw) || 1) - 1));
  return { year, monthIndex };
}

function formatMonthLabel(value: string) {
  const { year, monthIndex } = parseMonth(value);
  return `${monthNames[monthIndex]} ${year}`;
}

function monthValue(year: number, monthIndex: number) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
}

function canInvoiceFromStatus(statusKey: string) {
  return ['ready_to_ship', 'shipped', 'delivered'].some((status) => statusKey.includes(status));
}

function statusInfo(statusKey: string) {
  if (statusKey.includes('ready_to_ship')) {
    return {
      label: 'Lista para enviar',
      description: 'Falabella ya permite emitir el comprobante.',
    };
  }
  if (statusKey.includes('delivered')) {
    return {
      label: 'Entregada',
      description: 'La venta ya fue entregada; si no tiene documento, falta emitirlo.',
    };
  }
  if (statusKey.includes('shipped')) {
    return {
      label: 'Enviada',
      description: 'La venta ya fue despachada; si no tiene documento, falta emitirlo.',
    };
  }
  if (statusKey.includes('pending')) {
    return {
      label: 'Pendiente',
      description: 'Aún no está lista para enviar.',
    };
  }
  if (statusKey.includes('returned')) {
    return {
      label: 'Devuelta',
      description: 'La orden fue devuelta; revisar antes de emitir.',
    };
  }
  if (statusKey.includes('canceled')) {
    return {
      label: 'Cancelada',
      description: 'La orden fue cancelada; no debería emitirse automáticamente.',
    };
  }
  if (statusKey.includes('failed')) {
    return {
      label: 'Fallida',
      description: 'Falabella marca la orden como fallida; revisar manualmente.',
    };
  }
  return {
    label: statusKey || 'Sin estado',
    description: 'Estado devuelto por Falabella no mapeado por la app.',
  };
}

function companyHasApi(company?: Company | null) {
  return !!company?.falabellaApiUserId && !!company?.falabellaApiKey;
}

function sellerDisplayName(company?: Company | null) {
  return String(company?.nombre || company?.razonSocial || '').trim() || 'Empresa';
}

function sellerDisplayDetail(company?: Company | null) {
  const name = sellerDisplayName(company);
  const legalName = String(company?.razonSocial || '').trim();
  const ruc = String(company?.ruc || '').trim();
  const parts = [];
  if (legalName && legalName !== name) parts.push(legalName);
  if (ruc) parts.push(ruc);
  return parts.join(' · ');
}

function isInvoiceRequired(value: FalabellaOrder['InvoiceRequired']) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') return value.toLowerCase() === 'true' || value === '1';
  return false;
}

function getOrderInvoiceKind(order?: FalabellaOrder | null): 'BOLETA' | 'FACTURA' {
  return isInvoiceRequired(order?.InvoiceRequired) ? 'FACTURA' : 'BOLETA';
}

function normalizeInvoiceDate(value?: string) {
  if (!value) return '';
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

function falabellaErrorMessage(value: unknown, fallback: string) {
  if (!value) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const maybeHead = (value as { Head?: { ErrorMessage?: string } }).Head;
    if (maybeHead?.ErrorMessage) return maybeHead.ErrorMessage;
  }
  return fallback;
}

function facturaErrorMessage(value: any, fallback: string) {
  if (!value) return fallback;
  const parts = [
    value.message,
    value.error_code ? `Código: ${value.error_code}` : '',
    value.error?.message,
    value.error?.description,
    typeof value.error === 'string' ? value.error : '',
  ].filter(Boolean).map(String);
  if (parts.length) return parts.join(' · ');
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function formatDateOnly(value?: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-PE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function documentKindLabel(kind: InvoiceKind) {
  if (kind === 'NOTA_DE_CREDITO') return 'Nota de crédito';
  if (kind === 'FACTURA') return 'Factura';
  return 'Boleta';
}

function resolvePdfMode(option?: ResolvedDocumentOption | null): PdfMode {
  if (!option) return 'selected_file';
  if (option.source === 'local_boleta' && option.boletaId) return 'auto';
  if (option.source === 'local_factura' && option.facturaId) return 'auto';
  if (option.pdfPath) return 'local_file';
  return 'selected_file';
}

function SelectTrigger({
  value,
  placeholder,
}: {
  value?: string;
  placeholder: string;
}) {
  return (
    <Select.Trigger className="inline-flex h-[46px] w-full items-center justify-between rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none transition focus:border-ring data-[placeholder]:text-muted-foreground">
      <Select.Value placeholder={placeholder}>{value}</Select.Value>
      <Select.Icon>
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </Select.Icon>
    </Select.Trigger>
  );
}

function MonthPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const selected = parseMonth(value);
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(selected.year);

  useEffect(() => {
    setViewYear(parseMonth(value).year);
  }, [value]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((next) => !next)}
        className="inline-flex h-[46px] min-w-[220px] items-center justify-between gap-3 rounded-xl border border-input bg-background px-3 text-sm outline-none transition hover:border-ring"
      >
        <span className="inline-flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{formatMonthLabel(value)}</span>
        </span>
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-[320px] rounded-xl border border-border bg-popover p-3 shadow-xl">
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setViewYear((year) => year - 1)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition hover:bg-accent"
              aria-label="Año anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="text-sm font-semibold">{viewYear}</div>
            <button
              type="button"
              onClick={() => setViewYear((year) => year + 1)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition hover:bg-accent"
              aria-label="Año siguiente"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {monthNames.map((name, index) => {
              const month = monthValue(viewYear, index);
              const active = month === value;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => {
                    onChange(month);
                    setOpen(false);
                  }}
                  className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'border border-border bg-background text-foreground hover:bg-accent'
                  }`}
                >
                  {name.slice(0, 3)}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function InvoiceFlowSkeleton() {
  return (
    <div className="space-y-5" aria-live="polite">
      <div className="grid gap-6 md:grid-cols-[minmax(220px,0.8fr)_1fr]">
        <div className="animate-pulse">
          <div className="h-4 w-36 rounded bg-muted" />
          <div className="mt-4 h-12 w-20 rounded bg-muted" />
          <div className="mt-3 h-4 w-28 rounded bg-muted" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1].map((item) => (
            <div key={item} className="animate-pulse">
              <div className="flex items-center justify-between gap-3">
                <div className="h-3 w-20 rounded bg-muted" />
                <div className="h-3 w-6 rounded bg-muted" />
              </div>
              <div className="mt-3 h-2 rounded-full bg-muted" />
              <div className="mt-3 h-7 w-32 rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-xl bg-muted p-1">
        <div className="grid gap-1 md:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-20 animate-pulse rounded-lg bg-background/70" />
          ))}
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="border-b border-border bg-muted/30 px-4 py-3">
          <div className="h-4 w-44 animate-pulse rounded bg-muted" />
          <div className="mt-2 h-3 w-72 animate-pulse rounded bg-muted" />
        </div>
        <div className="divide-y divide-border/70">
          {[0, 1, 2, 3, 4].map((item) => (
            <div key={item} className="grid grid-cols-6 gap-4 px-4 py-4">
              <div className="h-4 animate-pulse rounded bg-muted" />
              <div className="h-4 animate-pulse rounded bg-muted" />
              <div className="h-4 animate-pulse rounded bg-muted" />
              <div className="h-4 animate-pulse rounded bg-muted" />
              <div className="h-4 animate-pulse rounded bg-muted" />
              <div className="h-4 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function createEmptyUploadState(): UploadModalState {
  return {
    open: false,
    loading: false,
    submitting: false,
    lockedBoleta: false,
    error: '',
    uploadResult: null,
    order: null,
    orderItemIds: [],
    resolved: null,
    selectedKind: 'BOLETA',
    source: 'manual',
    invoiceNumber: '',
    invoiceDate: '',
    invoiceType: 'BOLETA',
    pdfMode: 'selected_file',
    pdfPath: '',
    pdfBase64: '',
    pdfName: '',
    previewHtml: '',
    previewUrl: '',
  };
}

function createEmptyFalabellaBatchState(): FalabellaBatchState {
  return {
    open: false,
    running: false,
    current: 0,
    total: 0,
    currentLabel: '',
    error: '',
    eligible: [],
    skipped: [],
    results: [],
  };
}

function createEmptyEmitBoletaState(): EmitBoletaModalState {
  return {
    open: false,
    loading: false,
    processing: false,
    error: '',
    rows: [],
    ventas: [],
    emissionItems: [],
    warningsByOrder: {},
    validationErrors: [],
    previewHtml: '',
    previewTitle: '',
    previewLoadingOrder: '',
    expandedOrders: {},
    result: null,
    progress: { current: 0, total: 0, status: '' },
    log: [],
  };
}

export default function FalabellaApi() {
  const navigate = useNavigate();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const setActiveCompanyId = useAppStore((s) => s.setActiveCompanyId);

  const [companies, setCompanies] = useState<Company[]>(() => readCachedCompanies());
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(() => activeCompanyId || readCachedActiveCompanyId());
  const [uploadModal, setUploadModal] = useState<UploadModalState>(createEmptyUploadState);
  const [falabellaBatch, setFalabellaBatch] = useState<FalabellaBatchState>(createEmptyFalabellaBatchState);
  const [emitBoletaModal, setEmitBoletaModal] = useState<EmitBoletaModalState>(createEmptyEmitBoletaState);
  const [emitCloseCountdown, setEmitCloseCountdown] = useState(0);
  const [flowMonth, setFlowMonth] = useState(currentMonth);
  const [selectedFlowFilter, setSelectedFlowFilter] = useState<InvoiceFlowFilter>('ready_to_invoice');
  const [selectedReadyOrders, setSelectedReadyOrders] = useState<Set<string>>(() => new Set());
  const [documentSelectionMode, setDocumentSelectionMode] = useState(false);
  const [selectedDocumentOrders, setSelectedDocumentOrders] = useState<Set<string>>(() => new Set());
  const falabellaSunatEnv = String((import.meta as any).env?.VITE_SUNAT_ENV || '').trim().toLowerCase();
  const falabellaProductionMode = falabellaSunatEnv
    ? falabellaSunatEnv.startsWith('prod')
    : !(import.meta as any).env?.DEV;
  const [invoiceFlow, setInvoiceFlow] = useState<InvoiceFlowState>({
    loading: false,
    error: '',
    rows: [],
    totalOrders: 0,
    checkedOrders: 0,
  });

  const autoLoadKeyRef = useRef('');
  const uploadDocumentRefreshKeyRef = useRef('');

  useEffect(() => {
    const className = 'app-modal-open';
    if (uploadModal.open) {
      document.documentElement.classList.add(className);
      document.body.classList.add(className);
    } else {
      document.documentElement.classList.remove(className);
      document.body.classList.remove(className);
    }

    return () => {
      document.documentElement.classList.remove(className);
      document.body.classList.remove(className);
    };
  }, [uploadModal.open]);

  useEffect(() => {
    if (!uploadModal.open || uploadModal.loading || !selectedCompanyId || !uploadModal.order) return;

    const localDocument = uploadModal.source === 'local_boleta'
      || uploadModal.source === 'local_factura'
      || uploadModal.source === 'local_credit_note';
    if (!localDocument) return;

    const orderNumber = String(uploadModal.order.OrderNumber || '').trim();
    if (!orderNumber) return;

    const refreshKey = [
      selectedCompanyId,
      orderNumber,
      uploadModal.source,
      uploadModal.selectedKind,
      uploadModal.invoiceNumber,
      uploadModal.invoiceDate,
    ].join(':');
    if (uploadDocumentRefreshKeyRef.current === refreshKey) return;
    uploadDocumentRefreshKeyRef.current = refreshKey;

    let cancelled = false;
    api.falabellaApiResolveDocument(selectedCompanyId, orderNumber)
      .then((nextResolved: ResolvedDocumentResponse) => {
        if (cancelled) return;

        setUploadModal((current) => {
          const currentOrderNumber = String(current.order?.OrderNumber || '').trim();
          if (!current.open || currentOrderNumber !== orderNumber) return current;

          const option = nextResolved.options.find((entry) => (
            entry.source === current.source
            && entry.kind === current.selectedKind
            && (current.boletaId == null || entry.boletaId === current.boletaId)
            && (current.facturaId == null || entry.facturaId === current.facturaId)
          )) || nextResolved.options.find((entry) => entry.kind === current.selectedKind)
            || nextResolved.options[0];
          const nextDoc = current.source === 'local_boleta'
            ? nextResolved.boleta
            : current.source === 'local_factura'
              ? nextResolved.factura
              : nextResolved.creditNote;
          const nextInvoiceDate = normalizeInvoiceDate(option?.invoiceDate || nextDoc?.fechaEmision) || current.invoiceDate;
          const nextInvoiceNumber = option?.invoiceNumber || nextDoc?.numeroCompleto || current.invoiceNumber;

          if (
            current.resolved === nextResolved
            && current.invoiceDate === nextInvoiceDate
            && current.invoiceNumber === nextInvoiceNumber
          ) {
            return current;
          }

          return {
            ...current,
            resolved: nextResolved,
            source: option?.source || current.source,
            boletaId: option?.boletaId ?? current.boletaId,
            facturaId: option?.facturaId ?? current.facturaId,
            invoiceNumber: nextInvoiceNumber,
            invoiceDate: nextInvoiceDate,
            invoiceType: option?.invoiceType || current.invoiceType,
          };
        });
      })
      .catch(() => {
        // Keep the modal usable with its current data if the silent refresh fails.
      });

    return () => {
      cancelled = true;
    };
  }, [
    selectedCompanyId,
    uploadModal.open,
    uploadModal.loading,
    uploadModal.order?.OrderNumber,
    uploadModal.source,
    uploadModal.selectedKind,
    uploadModal.boletaId,
    uploadModal.facturaId,
    uploadModal.invoiceNumber,
    uploadModal.invoiceDate,
  ]);

  useEffect(() => {
    api.listCompanies().then((list: Company[]) => {
      const next = Array.isArray(list) ? list : [];
      setCompanies(next);
      writeCachedCompanies(next);

      if (activeCompanyId && next.some((company) => company.id === activeCompanyId)) {
        setSelectedCompanyId(activeCompanyId);
        return;
      }

      if (selectedCompanyId && next.some((company) => company.id === selectedCompanyId)) {
        return;
      }

      const firstReady = next.find((company) => companyHasApi(company));
      setSelectedCompanyId(firstReady?.id || next[0]?.id || null);
    }).catch(() => {
      setCompanies((current) => current.length ? current : []);
    });
  }, [activeCompanyId, selectedCompanyId]);

  const selectedCompany = useMemo(
    () => companies.find((company) => company.id === selectedCompanyId) || null,
    [companies, selectedCompanyId],
  );

  const flowStats = useMemo(() => {
    const base = {
      totalBoleta: 0,
      totalBoletaAmount: 0,
      boletaWithDocument: 0,
      boletaWithDocumentAmount: 0,
      boletaWithoutDocument: 0,
      boletaWithoutDocumentAmount: 0,
      totalFactura: 0,
      totalFacturaAmount: 0,
      facturaWithDocument: 0,
      facturaWithDocumentAmount: 0,
      facturaWithoutDocument: 0,
      facturaWithoutDocumentAmount: 0,
      readyToInvoice: 0,
      readyToInvoiceAmount: 0,
      hasDocument: 0,
      hasDocumentAmount: 0,
      notReady: 0,
      notReadyAmount: 0,
      review: 0,
      reviewAmount: 0,
    };

    for (const row of invoiceFlow.rows) {
      if (row.invoiceKind === 'BOLETA') {
        base.totalBoleta += 1;
        base.totalBoletaAmount += row.total;
        if (row.bucket === 'has_document') {
          base.boletaWithDocument += 1;
          base.boletaWithDocumentAmount += row.total;
        } else {
          base.boletaWithoutDocument += 1;
          base.boletaWithoutDocumentAmount += row.total;
        }
      } else if (row.invoiceKind === 'FACTURA') {
        base.totalFactura += 1;
        base.totalFacturaAmount += row.total;
        if (row.bucket === 'has_document') {
          base.facturaWithDocument += 1;
          base.facturaWithDocumentAmount += row.total;
        } else {
          base.facturaWithoutDocument += 1;
          base.facturaWithoutDocumentAmount += row.total;
        }
      }
      if (row.bucket === 'ready_to_invoice') {
        base.readyToInvoice += 1;
        base.readyToInvoiceAmount += row.total;
      } else if (row.bucket === 'has_document') {
        base.hasDocument += 1;
        base.hasDocumentAmount += row.total;
      } else if (row.bucket === 'not_ready') {
        base.notReady += 1;
        base.notReadyAmount += row.total;
      } else {
        base.review += 1;
        base.reviewAmount += row.total;
      }
    }

    return base;
  }, [invoiceFlow.rows]);

  const filteredFlowRows = useMemo(
    () => invoiceFlow.rows.filter((row) => row.bucket === selectedFlowFilter),
    [invoiceFlow.rows, selectedFlowFilter],
  );

  const filteredFlowKindStats = useMemo(() => {
    let boletas = 0;
    let facturas = 0;
    for (const row of filteredFlowRows) {
      if (row.invoiceKind === 'FACTURA') facturas += 1;
      else boletas += 1;
    }
    return { boletas, facturas };
  }, [filteredFlowRows]);

  const readyBoletaRows = useMemo(
    () => invoiceFlow.rows.filter((row) => row.bucket === 'ready_to_invoice' && row.invoiceKind === 'BOLETA'),
    [invoiceFlow.rows],
  );

  const allReadyBoletasSelected = readyBoletaRows.length > 0
    && readyBoletaRows.every((row) => selectedReadyOrders.has(row.orderNumber));

  const selectedReadyTotal = readyBoletaRows
    .filter((row) => selectedReadyOrders.has(row.orderNumber))
    .reduce((sum, row) => sum + row.total, 0);

  const documentUploadCandidates = useMemo(() => {
    const eligible: FalabellaBatchCandidate[] = [];
    const skipped: FalabellaBatchCandidate[] = [];

    for (const row of filteredFlowRows) {
      if (row.bucket !== 'has_document') continue;

      const base: FalabellaBatchCandidate = {
        id: row.documentId || 0,
        numeroCompleto: row.documentLabel || '',
        orderNumber: row.orderNumber,
        fechaEmision: normalizeInvoiceDate(row.documentDate) || normalizeInvoiceDate(row.createdAt),
        estadoSunat: row.documentStatus || '',
        pdfPath: row.documentPdfPath || '',
        orderId: row.orderId || undefined,
        total: row.total,
        uploadedAt: row.documentUploadedAt || '',
      };

      if (row.documentKind !== 'BOLETA' || row.documentSource !== 'local_boleta') {
        skipped.push({ ...base, reason: 'No es una boleta local' });
        continue;
      }
      if (!base.id) {
        skipped.push({ ...base, reason: 'Falta el ID local de la boleta' });
        continue;
      }
      if (!base.orderNumber) {
        skipped.push({ ...base, reason: 'Falta número de orden' });
        continue;
      }
      if (!base.numeroCompleto || base.numeroCompleto === '-') {
        skipped.push({ ...base, reason: 'Falta número de boleta' });
        continue;
      }
      if (!base.fechaEmision) {
        skipped.push({ ...base, reason: 'Falta fecha de emisión' });
        continue;
      }
      if (String(base.estadoSunat || '').toUpperCase() !== 'ACEPTADO') {
        skipped.push({ ...base, reason: 'La boleta aún no está ACEPTADO en SUNAT' });
        continue;
      }
      eligible.push(base);
    }

    return { eligible, skipped };
  }, [filteredFlowRows]);

  const pendingDocumentCandidates = useMemo(
    () => documentUploadCandidates.eligible.filter((candidate) => !candidate.uploadedAt),
    [documentUploadCandidates.eligible],
  );

  const selectedDocumentCandidates = useMemo(
    () => documentUploadCandidates.eligible.filter((candidate) => selectedDocumentOrders.has(candidate.orderNumber)),
    [documentUploadCandidates.eligible, selectedDocumentOrders],
  );

  const allDocumentCandidatesSelected = documentUploadCandidates.eligible.length > 0
    && documentUploadCandidates.eligible.every((candidate) => selectedDocumentOrders.has(candidate.orderNumber));

  const pendingDocumentCandidatesSelected = pendingDocumentCandidates.length > 0
    && pendingDocumentCandidates.every((candidate) => selectedDocumentOrders.has(candidate.orderNumber));

  const selectedDocumentTotal = selectedDocumentCandidates.reduce((sum, candidate) => sum + candidate.total, 0);

  const selectedFlowMeta = useMemo(() => {
    const meta: Record<InvoiceFlowFilter, { title: string; description: string }> = {
      ready_to_invoice: {
        title: 'Sin documento listo para emitir',
        description: 'Órdenes listas para emitir boleta o factura desde la app.',
      },
      has_document: {
        title: 'Con documento local',
        description: 'Órdenes que ya tienen boleta, factura o nota local asociada por número de orden.',
      },
      not_ready: {
        title: 'Aún no listas',
        description: 'Órdenes pendientes en Falabella. Todavía no se debería emitir comprobante.',
      },
      review: {
        title: 'Revisar antes de emitir',
        description: 'Órdenes devueltas, canceladas, fallidas o con un estado no mapeado. La app no debería emitirlas automáticamente.',
      },
    };
    return meta[selectedFlowFilter];
  }, [selectedFlowFilter]);

  const showDocumentLocalColumn = selectedFlowFilter !== 'ready_to_invoice' && selectedFlowFilter !== 'not_ready';
  const showSelectionColumn = selectedFlowFilter === 'ready_to_invoice' || (selectedFlowFilter === 'has_document' && documentSelectionMode);
  const flowTableColumnCount = (showSelectionColumn ? 1 : 0) + 6 + (showDocumentLocalColumn ? 1 : 0);

  const flowTabs = useMemo(() => ([
    {
      value: 'not_ready' as InvoiceFlowFilter,
      label: 'Pendientes',
      description: 'Esperar avance',
      count: flowStats.notReady,
      amount: flowStats.notReadyAmount,
      activeClass: 'bg-background text-amber-700 shadow-sm ring-1 ring-border',
      badgeClass: 'bg-amber-100 text-amber-700',
    },
    {
      value: 'ready_to_invoice' as InvoiceFlowFilter,
      label: 'Sin documento',
      description: 'Listas para documentar',
      count: flowStats.readyToInvoice,
      amount: flowStats.readyToInvoiceAmount,
      activeClass: 'bg-background text-red-700 shadow-sm ring-1 ring-border',
      badgeClass: 'bg-red-100 text-red-700',
    },
    {
      value: 'has_document' as InvoiceFlowFilter,
      label: 'Con documento',
      description: 'Ya cruzadas',
      count: flowStats.hasDocument,
      amount: flowStats.hasDocumentAmount,
      activeClass: 'bg-background text-emerald-700 shadow-sm ring-1 ring-border',
      badgeClass: 'bg-emerald-100 text-emerald-700',
    },
    {
      value: 'review' as InvoiceFlowFilter,
      label: 'Revisión',
      description: 'No automáticas',
      count: flowStats.review,
      amount: flowStats.reviewAmount,
      activeClass: 'bg-background text-slate-800 shadow-sm ring-1 ring-border',
      badgeClass: 'bg-slate-100 text-slate-700',
    },
  ]), [flowStats]);

  const closeUploadModal = () => {
    setUploadModal(createEmptyUploadState());
  };

  const closeFalabellaBatch = () => {
    if (falabellaBatch.running) return;
    setFalabellaBatch(createEmptyFalabellaBatchState());
  };

  const closeEmitBoletaModal = () => {
    if (emitBoletaModal.processing) return;
    setEmitCloseCountdown(0);
    setEmitBoletaModal(createEmptyEmitBoletaState());
  };

  const selectCompany = async (companyId: number) => {
    setSelectedCompanyId(companyId);
    setSelectedReadyOrders(new Set());
    setDocumentSelectionMode(false);
    setSelectedDocumentOrders(new Set());
    setActiveCompanyId(companyId);
    await api.setActiveCompanyId(companyId);
  };

  const toggleReadyOrder = (orderNumber: string) => {
    setSelectedReadyOrders((current) => {
      const next = new Set(current);
      if (next.has(orderNumber)) {
        next.delete(orderNumber);
      } else {
        next.add(orderNumber);
      }
      return next;
    });
  };

  const toggleAllReadyOrders = () => {
    setSelectedReadyOrders(() => {
      if (allReadyBoletasSelected) return new Set();
      return new Set(readyBoletaRows.map((row) => row.orderNumber));
    });
  };

  const toggleDocumentOrder = (orderNumber: string) => {
    setSelectedDocumentOrders((current) => {
      const next = new Set(current);
      if (next.has(orderNumber)) {
        next.delete(orderNumber);
      } else {
        next.add(orderNumber);
      }
      return next;
    });
  };

  const toggleAllDocumentOrders = () => {
    setSelectedDocumentOrders(() => {
      if (allDocumentCandidatesSelected) return new Set();
      if (pendingDocumentCandidatesSelected) {
        return new Set(documentUploadCandidates.eligible.map((candidate) => candidate.orderNumber));
      }
      if (pendingDocumentCandidates.length > 0) {
        return new Set(pendingDocumentCandidates.map((candidate) => candidate.orderNumber));
      }
      return new Set(documentUploadCandidates.eligible.map((candidate) => candidate.orderNumber));
    });
  };

  const openEmitBoletaModal = async (rows: InvoiceFlowRow[]) => {
    if (!selectedCompanyId || !selectedCompany) return;
    setEmitCloseCountdown(0);

    const readyRows = rows.filter((row) => row.bucket === 'ready_to_invoice');
    if (!readyRows.length) {
      setEmitBoletaModal({
        ...createEmptyEmitBoletaState(),
        open: true,
        error: 'No hay documentos listos para emitir en la selección.',
      });
      return;
    }

    setEmitBoletaModal({
      ...createEmptyEmitBoletaState(),
      open: true,
      loading: true,
      rows: readyRows,
    });

    try {
      const prepared = await Promise.all(readyRows.map(async (row) => {
        const buildFn = row.invoiceKind === 'FACTURA'
          ? api.falabellaApiBuildFacturaVenta
          : api.falabellaApiBuildBoletaVenta;
        const response = await buildFn(selectedCompanyId, row.order);
        if (response?.error) {
          throw new Error(`${row.orderNumber}: ${falabellaErrorMessage(response.error, 'No se pudo preparar la emisión.')}`);
        }
        return {
          row,
          venta: response.venta,
          warnings: response.warnings || [],
        };
      }));

      const ventas = prepared.map((entry) => entry.venta);
      const warningsByOrder = prepared.reduce((acc: Record<string, string[]>, entry) => {
        acc[entry.row.orderNumber] = entry.warnings;
        return acc;
      }, {});
      const emissionItems = prepared.map((entry): EmissionItem => ({
        orderNumber: String(entry.venta?.orderNumber || entry.row.orderNumber || ''),
        invoiceKind: entry.row.invoiceKind,
        numeroCompleto: '',
        status: 'pending',
        message: 'Pendiente',
        error: '',
      }));
      const validationErrors = await api.validateVentas(ventas);

      setEmitBoletaModal((current) => ({
        ...current,
        loading: false,
        rows: readyRows,
        ventas,
        emissionItems,
        warningsByOrder,
        expandedOrders: ventas.length === 1 && ventas[0]?.orderNumber
          ? { [String(ventas[0].orderNumber)]: true }
          : {},
        validationErrors,
      }));
    } catch (nextError: any) {
      setEmitBoletaModal((current) => ({
        ...current,
        loading: false,
        error: nextError?.message || 'No se pudo preparar la emisión.',
      }));
    }
  };

  const openSelectedEmitBoletaModal = () => {
    const rows = readyBoletaRows.filter((row) => selectedReadyOrders.has(row.orderNumber));
    void openEmitBoletaModal(rows);
  };

  const openFalabellaBatchUpload = () => {
    if (!documentSelectionMode) {
      setDocumentSelectionMode(true);
      setSelectedDocumentOrders(new Set(pendingDocumentCandidates.map((candidate) => candidate.orderNumber)));
      return;
    }

    setFalabellaBatch({
      ...createEmptyFalabellaBatchState(),
      open: true,
      eligible: selectedDocumentCandidates,
      skipped: documentUploadCandidates.skipped,
      total: selectedDocumentCandidates.length,
    });
  };

  const uploadFalabellaBatch = async () => {
    if (!selectedCompanyId || falabellaBatch.running || !falabellaBatch.eligible.length) return;

    setFalabellaBatch((current) => ({
      ...current,
      running: true,
      current: 0,
      total: current.eligible.length,
      currentLabel: '',
      error: '',
      results: [],
    }));

    for (let index = 0; index < falabellaBatch.eligible.length; index += 1) {
      const boleta = falabellaBatch.eligible[index];

      setFalabellaBatch((current) => ({
        ...current,
        current: index,
        currentLabel: `${boleta.numeroCompleto} · orden ${boleta.orderNumber}`,
      }));

      try {
        const response = await api.falabellaApiUploadBoletaPdf({
          companyId: selectedCompanyId,
          boletaId: boleta.id,
          orderNumber: boleta.orderNumber,
          orderId: boleta.orderId,
          invoiceNumber: boleta.numeroCompleto,
          invoiceDate: boleta.fechaEmision,
          pdfPath: boleta.pdfPath,
        });

        setFalabellaBatch((current) => ({
          ...current,
          current: index + 1,
          results: [
            ...current.results,
            {
              boletaId: boleta.id,
              numeroCompleto: boleta.numeroCompleto,
              orderNumber: boleta.orderNumber,
              ok: response?.ok,
              skipped: response?.skipped,
              status: response?.status,
              orderId: response?.orderId,
              error: response?.error,
              orderItemIds: response?.orderItemIds,
            },
          ],
        }));
      } catch (nextError: any) {
        setFalabellaBatch((current) => ({
          ...current,
          current: index + 1,
          results: [
            ...current.results,
            {
              boletaId: boleta.id,
              numeroCompleto: boleta.numeroCompleto,
              orderNumber: boleta.orderNumber,
              ok: false,
              error: nextError?.message || 'No se pudo subir la boleta a Falabella.',
            },
          ],
        }));
      }
    }

    setFalabellaBatch((current) => ({
      ...current,
      running: false,
      currentLabel: '',
    }));
    setDocumentSelectionMode(false);
    setSelectedDocumentOrders(new Set());

    try {
      await loadInvoiceFlowPrototype();
    } catch (nextError: any) {
      setFalabellaBatch((current) => ({
        ...current,
        error: nextError?.message || 'El lote terminó, pero no se pudo refrescar la tabla.',
      }));
    }
  };

  const openBoletaPreview = async (venta: any) => {
    if (!selectedCompany?.id) return;
    const orderNumber = String(venta?.orderNumber || '');
    setEmitBoletaModal((current) => ({
      ...current,
      previewLoadingOrder: orderNumber,
      error: '',
    }));

    try {
      const hasFacturaRow = emitBoletaModal.rows.some((r) => r.orderNumber === orderNumber && r.invoiceKind === 'FACTURA');
      const preview = hasFacturaRow
        ? await api.previewFacturaHtml(selectedCompany.id, venta)
        : await api.previewBoletaHtml(selectedCompany.id, venta);
      setEmitBoletaModal((current) => ({
        ...current,
        previewLoadingOrder: '',
        previewHtml: preview?.html || '',
        previewTitle: `${preview?.numeroCompleto || 'Vista previa'} · ${venta.client?.razonSocial || orderNumber}`,
      }));
    } catch (nextError: any) {
      setEmitBoletaModal((current) => ({
        ...current,
        previewLoadingOrder: '',
        error: nextError?.message || 'No se pudo generar la vista previa.',
      }));
    }
  };

  const updateEmissionItem = (
    orderNumber: string,
    update: Partial<Pick<EmissionItem, 'status' | 'message' | 'numeroCompleto' | 'error'>>,
  ) => {
    const key = String(orderNumber || '').trim();
    if (!key) return;
    setEmitBoletaModal((current) => ({
      ...current,
      emissionItems: current.emissionItems.map((item) => (
        item.orderNumber === key
          ? {
              ...item,
              ...update,
              numeroCompleto: update.numeroCompleto || item.numeroCompleto,
              error: update.error ?? item.error,
            }
          : item
      )),
    }));
  };

  const submitEmitBoletas = async () => {
    if (!selectedCompany || !emitBoletaModal.ventas.length || emitBoletaModal.validationErrors.length) return;

    setEmitBoletaModal((current) => ({
      ...current,
      processing: true,
      error: '',
      result: null,
      progress: { current: 0, total: current.ventas.length, status: 'Iniciando...' },
      log: [],
    }));

    try {
      const isFacturaEmission = emitBoletaModal.rows.some((r) => r.invoiceKind === 'FACTURA');

      if (isFacturaEmission) {
        const facturaResults: any[] = [];
        let successCount = 0;
        let errorCount = 0;

        for (let i = 0; i < emitBoletaModal.ventas.length; i++) {
          const venta = emitBoletaModal.ventas[i];
          const orderNumber = String(venta?.orderNumber || '');

          updateEmissionItem(orderNumber, { status: 'creating', message: `Creando factura ${orderNumber}...` });
          setEmitBoletaModal((state) => ({
            ...state,
            progress: { current: i, total: emitBoletaModal.ventas.length, status: `Creando factura ${orderNumber}...` },
            log: [...state.log, `Creando factura ${orderNumber}...`].slice(-80),
          }));

          try {
            const branches = await api.listBranches(selectedCompany.id);
            const branchId = branches.find((b: any) => b.codigo === '0000')?.id || branches.find((b: any) => b.codigo === '0001')?.id || branches[0]?.id;
            if (!branchId) throw new Error('La empresa no tiene sucursales activas.');

            const created = await api.createFactura({
              company_id: selectedCompany.id,
              branch_id: branchId,
              serie: falabellaProductionMode ? (venta.serie || 'F001') : 'F999',
              fecha_emision: venta.fechaEmision,
              moneda: venta.moneda || 'PEN',
              metodo_envio: 'individual',
              client: {
                tipo_documento: venta.client.tipoDocumento,
                numero_documento: venta.client.numeroDocumento,
                razon_social: venta.client.razonSocial,
                direccion: venta.client.direccion || undefined,
              },
              detalles: venta.detalles,
              order_number: orderNumber || undefined,
              persistCorrelative: falabellaProductionMode,
              datos_adicionales: [
                {
                  source: 'falabella-api',
                  environment: falabellaProductionMode ? 'produccion' : 'beta',
                  orderNumber,
                },
              ],
            });

            const facturaId = created?.id;
            if (!facturaId) throw new Error('No se obtuvo ID de factura');

            updateEmissionItem(orderNumber, {
              status: 'sending',
              numeroCompleto: created.numeroCompleto,
              message: `Enviando ${created.numeroCompleto} a SUNAT...`,
            });
            setEmitBoletaModal((state) => ({
              ...state,
              progress: { current: i, total: emitBoletaModal.ventas.length, status: `Enviando factura ${created.numeroCompleto} a SUNAT...` },
              log: [...state.log, `Enviando factura ${created.numeroCompleto} a SUNAT...`].slice(-80),
            }));

            const sendResult = await api.sendFacturaToSunat(facturaId);
            const accepted = String(sendResult?.success || '').toLowerCase() === 'true' || sendResult?.success === true;
            const errorMessage = accepted ? '' : facturaErrorMessage(sendResult, 'Error al enviar a SUNAT');

            facturaResults.push({
              numeroCompleto: created.numeroCompleto,
              estadoSunat: accepted ? 'ACEPTADO' : 'RECHAZADO',
              orderNumber,
              error: accepted ? undefined : errorMessage,
            });

            if (accepted) {
              successCount++;
              updateEmissionItem(orderNumber, {
                status: 'accepted',
                numeroCompleto: created.numeroCompleto,
                message: `${created.numeroCompleto} aceptada por SUNAT.`,
                error: '',
              });
            } else {
              errorCount++;
              updateEmissionItem(orderNumber, {
                status: 'rejected',
                numeroCompleto: created.numeroCompleto,
                message: `${created.numeroCompleto} rechazada por SUNAT.`,
                error: errorMessage,
              });
              setEmitBoletaModal((state) => ({
                ...state,
                log: [...state.log, `Error ${created.numeroCompleto}: ${errorMessage}`].slice(-80),
              }));
            }
          } catch (itemError: any) {
            errorCount++;
            const errorMessage = facturaErrorMessage(itemError, 'Error en la emisión');
            facturaResults.push({
              numeroCompleto: venta.numeroCompleto || orderNumber,
              estadoSunat: 'ERROR',
              orderNumber,
              error: errorMessage,
            });
            updateEmissionItem(orderNumber, {
              status: 'rejected',
              message: 'Error en la emisión.',
              error: errorMessage,
            });

            setEmitBoletaModal((state) => ({
              ...state,
              log: [...state.log, `Error: ${errorMessage}`].slice(-80),
            }));
          }
        }

        const result = {
          success: errorCount === 0,
          total: emitBoletaModal.ventas.length,
          exitosas: successCount,
          rechazadas: errorCount,
          boletas: facturaResults,
        };

        setEmitBoletaModal((current) => ({
          ...current,
          processing: false,
          result,
          error: result.success ? '' : `${errorCount} de ${emitBoletaModal.ventas.length} facturas tuvieron errores.`,
        }));

        if (result.success) {
          setSelectedReadyOrders(new Set());
          await loadInvoiceFlowPrototype();
          navigate('/documentos?tab=facturas&days=7');
        }
      } else {
        api.onProgress((data: any) => {
          const progressCurrent = Number(data?.current || 0);
          const progressTotal = Number(data?.total || 0);
          const status = typeof data?.status === 'string'
            ? data.status
            : data?.status == null
              ? ''
              : JSON.stringify(data.status);
          const progressEvent = parseEmissionProgress(status);
          setEmitBoletaModal((state) => {
            if (!state.open) return state;
            return {
              ...state,
              progress: { current: progressCurrent, total: progressTotal, status },
              emissionItems: progressEvent
                ? state.emissionItems.map((item) => (
                    item.orderNumber === progressEvent.orderNumber
                      ? {
                          ...item,
                          status: progressEvent.status,
                          message: progressEvent.message,
                          numeroCompleto: progressEvent.numeroCompleto || item.numeroCompleto,
                          error: progressEvent.status === 'rejected' ? progressEvent.message.replace(/^Rechazada:\s*/i, '') : item.error,
                        }
                      : item
                  ))
                : state.emissionItems,
              log: status ? [...state.log, status].slice(-80) : state.log,
            };
          });
        });

        const homeDir = await api.getHomeDir();
        const savedOutputDir = localStorage.getItem('boletas.outputDir');
        const outputDir = savedOutputDir || (homeDir ? `${homeDir}/boletas-emitidas` : 'boletas-emitidas');
        const result = await api.processWorkflow({
          companyId: selectedCompany.id,
          ruc: selectedCompany.ruc,
          razonSocial: selectedCompany.razonSocial,
          direccion: selectedCompany.direccion || '',
          ubigeo: selectedCompany.ubigeo || '',
          usuarioSol: selectedCompany.usuarioSol || '',
          claveSol: selectedCompany.claveSol || '',
          certificadoBase64: selectedCompany.certificado || '',
          certificadoPassword: selectedCompany.certificadoPassword || '',
          outputDir,
        }, emitBoletaModal.ventas);

        const workflowResult = result?.result || result;
        const rejectedCount = Number(workflowResult?.rechazadas || 0);
        const success = Boolean(result?.success) && rejectedCount === 0;
        const resultError = typeof result?.error === 'string'
          ? result.error
          : result?.error
            ? JSON.stringify(result.error)
            : '';

        setEmitBoletaModal((current) => ({
          ...current,
          processing: false,
          result: { ...result, success },
          emissionItems: current.emissionItems.map((item) => {
            const emitted = Array.isArray(workflowResult?.boletas)
              ? workflowResult.boletas.find((boleta: any) => String(boleta?.orderNumber || '') === item.orderNumber)
              : null;
            if (!emitted) return item;
            const estado = String(emitted.estadoSunat || '').toUpperCase();
            const nextStatus: EmissionItemStatus = estado === 'ACEPTADO'
              ? 'accepted'
              : estado === 'OMITIDO'
                ? 'skipped'
                : 'rejected';
            return {
              ...item,
              status: nextStatus,
              numeroCompleto: emitted.numeroCompleto || item.numeroCompleto,
              message: nextStatus === 'accepted'
                ? `${emitted.numeroCompleto || 'Boleta'} aceptada por SUNAT.`
                : nextStatus === 'skipped'
                  ? String(emitted.error || 'Orden omitida.')
                  : String(emitted.error || 'Rechazada por SUNAT.'),
              error: nextStatus === 'rejected' ? String(emitted.error || 'Rechazada por SUNAT.') : '',
            };
          }),
          error: success ? '' : resultError || `${rejectedCount || 'Algunas'} boleta(s) tuvieron errores.`,
        }));

        if (Boolean(result?.success)) {
          if (success) {
            setSelectedReadyOrders(new Set());
          }
          await loadInvoiceFlowPrototype();
        }
      }
    } catch (nextError: any) {
      const message = typeof nextError?.message === 'string'
        ? nextError.message
        : nextError
          ? JSON.stringify(nextError)
          : '';
      setEmitBoletaModal((current) => ({
        ...current,
        processing: false,
        error: message || 'No se pudo emitir.',
      }));
    }
  };

  const applyResolvedOption = (kind: InvoiceKind) => {
    setUploadModal((current) => {
      const option = current.resolved?.options.find((entry) => entry.kind === kind);
      if (!option) return current;

      const nextPdfMode = resolvePdfMode(option);
      return {
        ...current,
        error: '',
        uploadResult: null,
        selectedKind: option.kind,
        source: option.source,
        boletaId: option.boletaId,
        invoiceNumber: option.invoiceNumber || current.invoiceNumber,
        invoiceDate: normalizeInvoiceDate(option.invoiceDate) || current.invoiceDate,
        invoiceType: option.invoiceType,
        pdfMode: nextPdfMode,
        pdfPath: nextPdfMode === 'local_file' ? option.pdfPath || '' : current.pdfPath,
      };
    });
  };

  const loadInvoiceFlowPrototype = async () => {
    if (!selectedCompanyId) return;

    setSelectedReadyOrders(new Set());
    setDocumentSelectionMode(false);
    setSelectedDocumentOrders(new Set());
    setInvoiceFlow({
      loading: true,
      error: '',
      rows: [],
      totalOrders: 0,
      checkedOrders: 0,
    });

    try {
      const collected = new Map<string, FalabellaOrder>();
      const limit = 100;
      for (let offset = 0; offset < 10000; offset += limit) {
        const response = await api.falabellaApiGetOrders(selectedCompanyId, {
          createdAfter: monthStart(flowMonth),
          createdBefore: monthEnd(flowMonth),
          limit,
          offset,
        });

        if (response?.error) {
          throw new Error(falabellaErrorMessage(response.error, 'Falabella devolvió un error.'));
        }

        const pageOrders = ((response?.orders || []) as FalabellaOrderPayload[]).map(normalizeOrder);
        let added = 0;
        for (const order of pageOrders) {
          const orderNumber = String(order.OrderNumber || '').trim();
          if (orderNumber && !collected.has(orderNumber)) {
            collected.set(orderNumber, order);
            added += 1;
          }
        }

        if (pageOrders.length < limit || added === 0) break;
      }

      const ordered = Array.from(collected.values()).sort((a, b) => String(b.CreatedAt || '').localeCompare(String(a.CreatedAt || '')));
      setInvoiceFlow((current) => ({
        ...current,
        checkedOrders: 0,
        totalOrders: ordered.length,
      }));

      const rows = await Promise.all(ordered.map(async (order): Promise<InvoiceFlowRow> => {
        const orderNumber = String(order.OrderNumber || '').trim();
        const orderId = String(order.OrderId || '').trim();
        const invoiceKind = getOrderInvoiceKind(order);
        const statusKey = normalizeStatusKey(order);
        const falabellaStatus = statusInfo(statusKey);
        const readyByStatus = canInvoiceFromStatus(statusKey);
        const resolved = orderNumber
          ? await api.falabellaApiResolveDocument(selectedCompanyId, orderNumber) as ResolvedDocumentResponse
          : null;
        const existingOption = resolved?.options?.find((option) => option.invoiceNumber)
          || (resolved?.boleta
            ? {
                kind: 'BOLETA' as InvoiceKind,
                source: 'local_boleta' as DocumentSource,
                boletaId: resolved.boleta.id,
                invoiceNumber: resolved.boleta.numeroCompleto,
                invoiceDate: resolved.boleta.fechaEmision,
                invoiceType: 'BOLETA' as InvoiceKind,
                pdfPath: resolved.boleta.pdfPath,
                estadoSunat: resolved.boleta.estadoSunat,
                respuestaSunat: resolved.boleta.respuestaSunat,
                falabellaPdfUploadedAt: resolved.boleta.falabellaPdfUploadedAt,
              }
            : null)
          || (resolved?.creditNote
            ? {
                kind: 'NOTA_DE_CREDITO' as InvoiceKind,
                source: 'local_credit_note' as DocumentSource,
                creditNoteId: resolved.creditNote.id,
                invoiceNumber: resolved.creditNote.numeroCompleto,
                invoiceDate: resolved.creditNote.fechaEmision,
                invoiceType: 'NOTA_DE_CREDITO' as InvoiceKind,
                pdfPath: resolved.creditNote.pdfPath,
                estadoSunat: resolved.creditNote.estadoSunat,
                respuestaSunat: resolved.creditNote.respuestaSunat,
              }
            : null);
        const hasDocument = Boolean(existingOption);
        const documentLabel = existingOption?.invoiceNumber
          || resolved?.boleta?.numeroCompleto
          || resolved?.creditNote?.numeroCompleto
          || '-';
        const documentStatus = existingOption?.estadoSunat || resolved?.boleta?.estadoSunat || resolved?.factura?.estadoSunat || resolved?.creditNote?.estadoSunat || '';
        const documentReason = existingOption?.respuestaSunat || resolved?.boleta?.respuestaSunat || resolved?.factura?.respuestaSunat || resolved?.creditNote?.respuestaSunat || '';
        let bucket: InvoiceFlowBucket;
        let actionLabel: string;

        if (hasDocument) {
          bucket = 'has_document';
          actionLabel = 'Ya tiene documento';
        } else if (readyByStatus) {
          bucket = 'ready_to_invoice';
          actionLabel = 'Emitir';
        } else if (statusKey.includes('pending')) {
          bucket = 'not_ready';
          actionLabel = 'Esperar a que esté lista';
        } else {
          bucket = 'review';
          actionLabel = statusKey.includes('canceled') || statusKey.includes('returned')
            ? 'No hay documento emitido; no corresponde nota de crédito.'
            : falabellaStatus.description;
        }

        return {
          order,
          orderNumber,
          orderId,
          createdAt: String(order.CreatedAt || ''),
          status: formatStatus(order),
          statusKey,
          statusLabel: falabellaStatus.label,
          statusDescription: falabellaStatus.description,
          invoiceKind,
          total: orderTotal(order),
          bucket,
          actionLabel,
          documentLabel,
          documentStatus,
          documentReason,
          documentKind: existingOption?.kind,
          documentSource: existingOption?.source,
          documentId: existingOption?.boletaId || existingOption?.facturaId || existingOption?.creditNoteId,
          documentDate: existingOption?.invoiceDate,
          documentPdfPath: existingOption?.pdfPath || '',
          documentUploadedAt: existingOption?.falabellaPdfUploadedAt || '',
        };
      }));

      setInvoiceFlow({
        loading: false,
        error: '',
        rows,
        totalOrders: ordered.length,
        checkedOrders: ordered.length,
      });
    } catch (nextError: any) {
      setInvoiceFlow((current) => ({
        ...current,
        loading: false,
        error: nextError?.message || 'No se pudo analizar el flujo de boletas por API.',
      }));
    }
  };

  useEffect(() => {
    if (!selectedCompanyId || !selectedCompany || !companyHasApi(selectedCompany) || !flowMonth) return;

    const key = [
      selectedCompanyId,
      flowMonth,
      selectedCompany.falabellaApiUserId || '',
      selectedCompany.falabellaApiKey || '',
    ].join(':');

    if (autoLoadKeyRef.current === key) return;
    autoLoadKeyRef.current = key;
    void loadInvoiceFlowPrototype();
  }, [
    selectedCompanyId,
    selectedCompany?.falabellaApiUserId,
    selectedCompany?.falabellaApiKey,
    flowMonth,
  ]);

  useEffect(() => {
    if (!emitBoletaModal.open || !emitBoletaModal.result?.success || emitBoletaModal.previewHtml) {
      if (!emitBoletaModal.result?.success) setEmitCloseCountdown(0);
      return;
    }

    setEmitCloseCountdown(5);
    const interval = window.setInterval(() => {
      setEmitCloseCountdown((current) => {
        if (current <= 1) {
          window.clearInterval(interval);
          setEmitBoletaModal(createEmptyEmitBoletaState());
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [emitBoletaModal.open, emitBoletaModal.result?.success, emitBoletaModal.previewHtml]);

  const openUploadModal = async (order: FalabellaOrder, lockedBoleta = false) => {
    if (!selectedCompanyId) return;

    const orderId = order.OrderId;
    const orderNumber = order.OrderNumber;

    if (!orderId || !orderNumber) {
      setUploadModal({
        ...createEmptyUploadState(),
        open: true,
        lockedBoleta,
        error: 'La orden no tiene OrderId u OrderNumber disponibles para subir el documento.',
        order,
      });
      return;
    }

    setUploadModal({
      ...createEmptyUploadState(),
      open: true,
      loading: true,
      lockedBoleta,
      order,
    });

    try {
      const [itemsResponse, resolvedResponse] = await Promise.all([
        lockedBoleta ? Promise.resolve({ orderItemIds: [] }) : api.falabellaApiGetOrderItems(selectedCompanyId, orderId),
        api.falabellaApiResolveDocument(selectedCompanyId, String(orderNumber)),
      ]);

      if (itemsResponse?.error) {
        throw new Error(falabellaErrorMessage(itemsResponse.error, 'No se pudieron obtener los items de la orden.'));
      }

      const resolved = resolvedResponse as ResolvedDocumentResponse;
      const fallbackKind = getOrderInvoiceKind(order);
      const selectedKind = lockedBoleta
        ? 'BOLETA'
        : resolved.boleta || resolved.creditNote
        ? (resolved.defaultKind || fallbackKind)
        : fallbackKind;
      const option = lockedBoleta
        ? resolved.options.find((entry) => entry.kind === 'BOLETA' && entry.source === 'local_boleta')
          || resolved.options.find((entry) => entry.kind === 'BOLETA')
        : resolved.options.find((entry) => entry.kind === selectedKind) || resolved.options[0];
      const pdfMode = lockedBoleta ? 'auto' : resolvePdfMode(option);

      setUploadModal({
        open: true,
        loading: false,
        submitting: false,
        lockedBoleta,
        error: '',
        uploadResult: null,
        order,
        orderItemIds: (itemsResponse?.orderItemIds || []).map((value: string) => String(value)),
        resolved,
        selectedKind: lockedBoleta ? 'BOLETA' : option?.kind || selectedKind,
        source: lockedBoleta ? 'local_boleta' : option?.source || 'manual',
        boletaId: option?.boletaId,
        facturaId: option?.facturaId,
        invoiceNumber: option?.invoiceNumber || '',
        invoiceDate: normalizeInvoiceDate(option?.invoiceDate),
        invoiceType: lockedBoleta ? 'BOLETA' : option?.invoiceType || selectedKind,
        pdfMode,
        pdfPath: pdfMode === 'local_file' ? option?.pdfPath || '' : '',
        pdfBase64: '',
        pdfName: '',
        previewHtml: '',
        previewUrl: '',
      });
    } catch (nextError: any) {
      setUploadModal({
        ...createEmptyUploadState(),
        open: true,
        loading: false,
        lockedBoleta,
        error: nextError?.message || 'No se pudo preparar la subida del documento.',
        order,
      });
    }
  };

  const pickPdfFile = async () => {
    try {
      const filePath = await api.selectPdfFile();
      if (!filePath) return;

      const pdfBase64 = await api.readFileBase64(filePath);
      setUploadModal((current) => ({
        ...current,
        error: '',
        uploadResult: null,
        pdfMode: 'selected_file',
        pdfPath: filePath,
        pdfBase64,
        pdfName: String(filePath).split('/').pop() || filePath,
      }));
    } catch (nextError: any) {
      setUploadModal((current) => ({
        ...current,
        error: nextError?.message || 'No se pudo leer el PDF seleccionado.',
      }));
    }
  };

  const submitUpload = async () => {
    if (!selectedCompanyId || !uploadModal.order) return;

    const localDocumentDate = normalizeInvoiceDate(uploadModal.lockedBoleta
      ? uploadModal.resolved?.boleta?.fechaEmision
      : uploadModal.source === 'local_factura'
        ? uploadModal.resolved?.factura?.fechaEmision
        : '');
    const invoiceDateForUpload = localDocumentDate || uploadModal.invoiceDate;

    if (!uploadModal.lockedBoleta && !uploadModal.orderItemIds.length) {
      setUploadModal((current) => ({
        ...current,
        error: 'La orden no tiene OrderItemIds disponibles.',
      }));
      return;
    }

    if (!uploadModal.invoiceNumber.trim()) {
      setUploadModal((current) => ({
        ...current,
        error: 'Debes indicar el número del documento.',
      }));
      return;
    }

    if (!invoiceDateForUpload) {
      setUploadModal((current) => ({
        ...current,
        error: 'Debes indicar la fecha del documento.',
      }));
      return;
    }

    if (uploadModal.lockedBoleta && !uploadModal.boletaId) {
      setUploadModal((current) => ({
        ...current,
        error: 'No se encontró la boleta local para generar el PDF. Recarga el mes y vuelve a intentar.',
      }));
      return;
    }

    if (uploadModal.pdfMode === 'selected_file' && !uploadModal.pdfBase64) {
      setUploadModal((current) => ({
        ...current,
        error: 'Debes seleccionar un PDF para subir.',
      }));
      return;
    }

    if (uploadModal.pdfMode === 'local_file' && !uploadModal.pdfPath) {
      setUploadModal((current) => ({
        ...current,
        error: 'No se encontró un PDF local para este documento.',
      }));
      return;
    }

    setUploadModal((current) => ({
      ...current,
      submitting: true,
      error: '',
      uploadResult: null,
    }));

    try {
      const response = uploadModal.lockedBoleta
        ? await api.falabellaApiUploadBoletaPdf({
            companyId: selectedCompanyId,
            boletaId: uploadModal.boletaId,
            orderNumber: String(uploadModal.order?.OrderNumber || ''),
            orderId: uploadModal.order?.OrderId,
            invoiceNumber: uploadModal.invoiceNumber.trim(),
            invoiceDate: invoiceDateForUpload,
            pdfPath: uploadModal.pdfPath,
          })
        : await api.falabellaApiUploadInvoicePdf({
            companyId: selectedCompanyId,
            orderNumber: String(uploadModal.order?.OrderNumber || ''),
            orderItemIds: uploadModal.orderItemIds,
            invoiceNumber: uploadModal.invoiceNumber.trim(),
            invoiceDate: invoiceDateForUpload,
            invoiceType: uploadModal.invoiceType,
            source: uploadModal.pdfMode === 'selected_file' ? 'manual' : uploadModal.source,
            boletaId: uploadModal.pdfMode === 'auto' ? uploadModal.boletaId : undefined,
            facturaId: uploadModal.pdfMode === 'auto' ? uploadModal.facturaId : undefined,
            pdfPath: uploadModal.pdfMode === 'local_file' ? uploadModal.pdfPath : uploadModal.pdfMode === 'selected_file' ? uploadModal.pdfPath : undefined,
            pdfBase64: uploadModal.pdfMode === 'selected_file' ? uploadModal.pdfBase64 : undefined,
          });

      const nextError = response?.error
        ? falabellaErrorMessage(response.error, 'Falabella devolvió un error al subir el documento.')
        : !response?.ok
          ? response?.rawText || 'Falabella rechazó la subida del documento.'
          : '';

      setUploadModal((current) => ({
        ...current,
        submitting: false,
        error: nextError,
        uploadResult: response,
        resolved: response?.falabellaPdfUpload?.uploadedAt && current.resolved?.boleta
          ? {
              ...current.resolved,
              boleta: {
                ...current.resolved.boleta,
                falabellaPdfUploadedAt: response.falabellaPdfUpload.uploadedAt,
              },
            }
          : current.resolved,
      }));
      if (!nextError && response?.ok) {
        await loadInvoiceFlowPrototype();
      }
    } catch (nextError: any) {
      setUploadModal((current) => ({
        ...current,
        submitting: false,
        error: nextError?.message || 'No se pudo subir el documento a Falabella.',
      }));
    }
  };

  const selectedDocumentOption = useMemo(
    () => uploadModal.resolved?.options.find((option) => option.kind === uploadModal.selectedKind) || null,
    [uploadModal.resolved, uploadModal.selectedKind],
  );

  const canUseAutoPdf = (selectedDocumentOption?.source === 'local_boleta' && !!selectedDocumentOption.boletaId)
    || (selectedDocumentOption?.source === 'local_factura' && !!selectedDocumentOption.facturaId);

  // Pantalla limpia (misma que boleta) también para facturas locales aceptadas (auto-PDF).
  const showCleanUpload = uploadModal.lockedBoleta || (uploadModal.source === 'local_factura' && uploadModal.pdfMode === 'auto');
  const cleanDocTipo = uploadModal.lockedBoleta ? 'Boleta' : 'Factura';
  const cleanDoc = uploadModal.lockedBoleta ? uploadModal.resolved?.boleta : uploadModal.resolved?.factura;
  const cleanDocDate = normalizeInvoiceDate(cleanDoc?.fechaEmision) || uploadModal.invoiceDate;
  const canUseLocalFile = !!selectedDocumentOption?.pdfPath;

  return (
    <div className="space-y-5">
      <section className="space-y-5">
        <div>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-[min(420px,calc(100vw-3rem))]">
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Empresa</label>
                <Select.Root
                  value={selectedCompanyId ? String(selectedCompanyId) : undefined}
                  onValueChange={(value) => void selectCompany(Number(value))}
                >
                  <SelectTrigger
                    placeholder="Selecciona una empresa"
                    value={selectedCompany ? `${sellerDisplayName(selectedCompany)}${sellerDisplayDetail(selectedCompany) ? ` · ${sellerDisplayDetail(selectedCompany)}` : ''}` : undefined}
                  />
                  <Select.Portal>
                    <Select.Content
                      position="popper"
                      sideOffset={8}
                      className="z-50 w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-border bg-popover shadow-xl"
                    >
                      <Select.Viewport className="p-1.5">
                        {companies.map((company) => (
                          <Select.Item
                            key={company.id}
                            value={String(company.id)}
                            className="relative flex cursor-default select-none items-center rounded-lg px-3 py-2.5 pr-8 text-sm outline-none transition focus:bg-accent focus:text-accent-foreground"
                          >
                            <div className="min-w-0">
                              <div className="truncate font-medium">{sellerDisplayName(company)}</div>
                              <div className="truncate text-xs text-muted-foreground">{sellerDisplayDetail(company)}</div>
                            </div>
                            <Select.ItemIndicator className="absolute right-2 inline-flex items-center">
                              <Check className="h-4 w-4" />
                            </Select.ItemIndicator>
                          </Select.Item>
                        ))}
                      </Select.Viewport>
                    </Select.Content>
                  </Select.Portal>
                </Select.Root>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Mes</label>
                <MonthPicker value={flowMonth} onChange={setFlowMonth} />
              </div>
            </div>
          </div>
        </div>

        {selectedCompany && !companyHasApi(selectedCompany) && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            La empresa activa no tiene credenciales de Falabella API configuradas.
          </div>
        )}

        {invoiceFlow.loading && <InvoiceFlowSkeleton />}

        {invoiceFlow.error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {invoiceFlow.error}
          </div>
        )}

        {!invoiceFlow.loading && !invoiceFlow.error && selectedCompany && companyHasApi(selectedCompany) && (
          <>
            <div>
              <div className="grid gap-6 md:grid-cols-[minmax(220px,0.8fr)_1fr]">
                <div>
                  <p className="text-sm text-muted-foreground">
                    {invoiceFlow.rows.length} orden{invoiceFlow.rows.length === 1 ? '' : 'es'} del mes
                  </p>
                  <p className="mt-2 text-5xl font-semibold tracking-normal text-foreground">
                    {money(flowStats.totalBoletaAmount + flowStats.totalFacturaAmount)}
                  </p>
                  <div className="mt-2 grid max-w-xs grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-xs font-medium text-foreground/70">Emitido</p>
                      <p className="font-medium text-foreground">{money(flowStats.hasDocumentAmount)}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Pendiente</p>
                      <p className="text-muted-foreground">
                        {money((flowStats.totalBoletaAmount + flowStats.totalFacturaAmount) - flowStats.hasDocumentAmount)}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Boletas</p>
                      <p className="text-sm font-semibold text-foreground">{flowStats.totalBoleta}</p>
                    </div>
                    <div
                      className="relative mt-2 h-2 overflow-hidden rounded-full bg-muted"
                      title={`${flowStats.boletaWithDocument} con documento · ${flowStats.boletaWithoutDocument} sin documento`}
                    >
                      <div
                        className="absolute inset-y-0 left-0 rounded-full bg-emerald-200"
                        style={{ width: `${invoiceFlow.rows.length ? Math.round((flowStats.totalBoleta / invoiceFlow.rows.length) * 100) : 0}%` }}
                      />
                      <div
                        className="absolute inset-y-0 left-0 rounded-full bg-emerald-500"
                        style={{ width: `${invoiceFlow.rows.length ? Math.round((flowStats.boletaWithDocument / invoiceFlow.rows.length) * 100) : 0}%` }}
                      />
                    </div>
                    <p className="mt-2 text-xl font-semibold text-foreground">{money(flowStats.totalBoletaAmount)}</p>
                    <div className="mt-1 grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <p className="text-[11px] font-medium text-emerald-700/80">Emitido</p>
                        <p className="font-medium text-emerald-700">{money(flowStats.boletaWithDocumentAmount)}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-medium text-muted-foreground">Pendiente</p>
                        <p className="text-muted-foreground">{money(flowStats.boletaWithoutDocumentAmount)}</p>
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Facturas</p>
                      <p className="text-sm font-semibold text-foreground">{flowStats.totalFactura}</p>
                    </div>
                    <div
                      className="relative mt-2 h-2 overflow-hidden rounded-full bg-muted"
                      title={`${flowStats.facturaWithDocument} con documento · ${flowStats.facturaWithoutDocument} sin documento`}
                    >
                      <div
                        className="absolute inset-y-0 left-0 rounded-full bg-sky-200"
                        style={{ width: `${invoiceFlow.rows.length ? Math.round((flowStats.totalFactura / invoiceFlow.rows.length) * 100) : 0}%` }}
                      />
                      <div
                        className="absolute inset-y-0 left-0 rounded-full bg-sky-500"
                        style={{ width: `${invoiceFlow.rows.length ? Math.round((flowStats.facturaWithDocument / invoiceFlow.rows.length) * 100) : 0}%` }}
                      />
                    </div>
                    <p className="mt-2 text-xl font-semibold text-foreground">{money(flowStats.totalFacturaAmount)}</p>
                    <div className="mt-1 grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <p className="text-[11px] font-medium text-sky-700/80">Emitido</p>
                        <p className="font-medium text-sky-700">{money(flowStats.facturaWithDocumentAmount)}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-medium text-muted-foreground">Pendiente</p>
                        <p className="text-muted-foreground">{money(flowStats.facturaWithoutDocumentAmount)}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl bg-muted p-1">
              <div role="tablist" aria-label="Estados de órdenes Falabella" className="grid gap-1 md:grid-cols-4">
                {flowTabs.map((tab) => {
                  const active = selectedFlowFilter === tab.value;
                  return (
                    <button
                      key={tab.value}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setSelectedFlowFilter(tab.value)}
                      className={`rounded-lg px-3 py-2.5 text-left text-sm transition ${active ? tab.activeClass : 'text-muted-foreground hover:bg-background/70 hover:text-foreground'}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{tab.label}</p>
                          <p className="mt-0.5 truncate text-xs opacity-80">{tab.description}</p>
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${active ? tab.badgeClass : 'bg-background text-muted-foreground'}`}>
                          {tab.count}
                        </span>
                      </div>
                      <p className="mt-2 text-xs font-medium opacity-80">{money(tab.amount)}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="border-b border-border bg-muted/30 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{selectedFlowMeta.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {selectedFlowMeta.description}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {(selectedFlowFilter === 'ready_to_invoice' || selectedFlowFilter === 'has_document') && (
                      <>
                        <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700">
                          {filteredFlowKindStats.boletas} boleta{filteredFlowKindStats.boletas === 1 ? '' : 's'}
                        </span>
                        <span className="rounded-full bg-sky-50 px-2.5 py-1 font-medium text-sky-700">
                          {filteredFlowKindStats.facturas} factura{filteredFlowKindStats.facturas === 1 ? '' : 's'}
                        </span>
                      </>
                    )}
                    <span className="rounded-full bg-background px-3 py-1 font-medium text-muted-foreground">
                      Mostrando {filteredFlowRows.length} orden(es)
                    </span>
                  </div>
                </div>
                {selectedFlowFilter === 'ready_to_invoice' && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={readyBoletaRows.length === 0}
                      onClick={toggleAllReadyOrders}
                      className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {allReadyBoletasSelected ? 'Quitar selección' : 'Seleccionar boletas'}
                    </button>
                    <button
                      type="button"
                      disabled={selectedReadyOrders.size === 0}
                      onClick={openSelectedEmitBoletaModal}
                      className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Send className="h-3.5 w-3.5" />
                      Emitir seleccionados
                    </button>
                    <span className="text-xs text-muted-foreground">
                      {selectedReadyOrders.size} boleta(s) seleccionada(s) · {money(selectedReadyTotal)}
                    </span>
                  </div>
                )}
                {selectedFlowFilter === 'has_document' && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {documentSelectionMode && (
                      <button
                        type="button"
                        disabled={documentUploadCandidates.eligible.length === 0}
                        onClick={toggleAllDocumentOrders}
                        className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {allDocumentCandidatesSelected
                          ? 'Quitar selección'
                          : pendingDocumentCandidatesSelected
                            ? 'Seleccionar todas'
                            : 'Seleccionar todas'}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={documentSelectionMode ? selectedDocumentOrders.size === 0 : documentUploadCandidates.eligible.length === 0}
                      onClick={openFalabellaBatchUpload}
                      className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      {documentSelectionMode ? 'Subir seleccionadas' : 'Subir boletas'}
                    </button>
                    {documentSelectionMode && (
                      <button
                        type="button"
                        onClick={() => {
                          setDocumentSelectionMode(false);
                          setSelectedDocumentOrders(new Set());
                        }}
                        className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground transition hover:bg-accent"
                      >
                        Cancelar
                      </button>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {documentSelectionMode
                        ? `${selectedDocumentOrders.size} seleccionada(s) · ${money(selectedDocumentTotal)}`
                        : `${pendingDocumentCandidates.length} pendiente(s) por subir · ${documentUploadCandidates.eligible.length - pendingDocumentCandidates.length} ya subida(s)`}
                    </span>
                  </div>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background">
                    <tr className="text-left text-muted-foreground">
                      {showSelectionColumn && (
                        <th className="w-10 p-3 font-medium" aria-label="Seleccionar" />
                      )}
                      <th className="p-3 font-medium">Orden de venta</th>
                      <th className="p-3 font-medium">Creada</th>
                      <th className="p-3 font-medium">Estado</th>
                      <th className="p-3 font-medium">Comprobante</th>
                      {showDocumentLocalColumn && <th className="p-3 font-medium">N° de boleta</th>}
                      <th className="p-3 font-medium">Siguiente paso</th>
                      <th className="p-3 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFlowRows.map((row) => {
                      const badgeClass = row.bucket === 'ready_to_invoice'
                        ? 'bg-red-100 text-red-700'
                        : row.bucket === 'has_document'
                          ? 'bg-emerald-100 text-emerald-700'
                          : row.bucket === 'not_ready'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-slate-100 text-slate-700';
                      const statusClass = row.statusKey.includes('delivered')
                        ? 'bg-emerald-100 text-emerald-700'
                        : row.statusKey.includes('shipped') || row.statusKey.includes('ready_to_ship')
                          ? 'bg-sky-100 text-sky-700'
                        : row.statusKey.includes('pending')
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-slate-100 text-slate-700';
                      const canSelectDocument = documentUploadCandidates.eligible.some((candidate) => candidate.orderNumber === row.orderNumber);
                      return (
                        <tr key={`${row.orderId}-${row.orderNumber}`} className="border-t border-border/70">
                          {showSelectionColumn && (
                            <td className="p-3 align-middle">
                              {selectedFlowFilter === 'ready_to_invoice' ? (
                                <button
                                  type="button"
                                  role="checkbox"
                                  aria-checked={selectedReadyOrders.has(row.orderNumber)}
                                  disabled={row.invoiceKind !== 'BOLETA'}
                                  onClick={() => toggleReadyOrder(row.orderNumber)}
                                  aria-label={`Seleccionar orden ${row.orderNumber}`}
                                  className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 ${
                                    selectedReadyOrders.has(row.orderNumber)
                                      ? 'border-primary bg-primary text-primary-foreground'
                                      : 'border-input bg-background hover:border-primary'
                                  }`}
                                >
                                  {selectedReadyOrders.has(row.orderNumber) && <Check className="h-3.5 w-3.5 stroke-[3]" />}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  role="checkbox"
                                  aria-checked={selectedDocumentOrders.has(row.orderNumber)}
                                  disabled={!canSelectDocument}
                                  onClick={() => toggleDocumentOrder(row.orderNumber)}
                                  aria-label={`Seleccionar boleta ${row.documentLabel || row.orderNumber}`}
                                  className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-30 ${
                                    selectedDocumentOrders.has(row.orderNumber)
                                      ? 'border-primary bg-primary text-primary-foreground'
                                      : 'border-input bg-background hover:border-primary'
                                  }`}
                                >
                                  {selectedDocumentOrders.has(row.orderNumber) && <Check className="h-3.5 w-3.5 stroke-[3]" />}
                                </button>
                              )}
                            </td>
                          )}
                          <td className="p-3 align-middle">
                            <button
                              type="button"
                              onClick={() => void navigator.clipboard?.writeText(row.orderNumber)}
                              className="font-mono text-xs font-medium text-foreground underline-offset-2 hover:underline"
                              title="Copiar número de orden"
                            >
                              {row.orderNumber || '-'}
                            </button>
                          </td>
                          <td className="p-3 align-middle text-xs">{formatDate(row.createdAt)}</td>
                          <td className="p-3 align-middle">
                            <span
                              title={row.statusDescription}
                              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusClass}`}
                            >
                              {row.statusLabel}
                            </span>
                          </td>
                          <td className="p-3 align-middle">
                            <span className={row.invoiceKind === 'FACTURA'
                              ? 'inline-flex rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-medium text-indigo-700'
                              : 'inline-flex rounded-full bg-violet-100 px-2.5 py-1 text-xs font-medium text-violet-700'}
                            >
                              {row.invoiceKind === 'FACTURA' ? 'Factura' : 'Boleta'}
                            </span>
                          </td>
                          {showDocumentLocalColumn && (
                            <td className="p-3 align-middle">
                              <DocumentStatusCell
                                label={row.documentLabel}
                                status={row.documentStatus}
                                reason={row.documentReason}
                                boletaId={row.documentKind === 'BOLETA' ? row.documentId : undefined}
                                facturaId={row.documentKind === 'FACTURA' ? row.documentId : undefined}
                              />
                            </td>
                          )}
                          <td className="p-3 align-middle">
                            {row.bucket === 'ready_to_invoice' ? (
                              <button
                                type="button"
                                disabled={row.invoiceKind === 'BOLETA' && selectedReadyOrders.size > 0}
                                title={row.invoiceKind === 'FACTURA' ? 'Emitir factura electrónica' : selectedReadyOrders.size > 0 ? 'Hay boletas seleccionadas: usa "Emitir seleccionados"' : undefined}
                                onClick={() => void openEmitBoletaModal([row])}
                                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                              >
                                <FilePlus2 className="h-3.5 w-3.5" />
                                Emitir
                              </button>
                            ) : row.bucket === 'has_document' && row.invoiceKind === 'BOLETA' ? (
                              row.documentUploadedAt ? (
                                <Tooltip content="Ya lo subiste a Falabella">
                                  <button
                                    type="button"
                                    onClick={() => void openUploadModal(row.order, true)}
                                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 text-xs font-medium text-indigo-400 transition hover:bg-indigo-100/60"
                                  >
                                    <Upload className="h-3.5 w-3.5" />
                                    Volver a subir
                                  </button>
                                </Tooltip>
                              ) : (
                                <Tooltip content={String(row.documentStatus || '').toUpperCase() === 'ACEPTADO' ? 'Subir la boleta a Falabella' : 'La boleta debe estar ACEPTADA por SUNAT para subirla'}>
                                  <button
                                    type="button"
                                    disabled={String(row.documentStatus || '').toUpperCase() !== 'ACEPTADO'}
                                    onClick={() => void openUploadModal(row.order, true)}
                                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:hover:bg-muted"
                                  >
                                    <Upload className="h-3.5 w-3.5" />
                                    Subir documento
                                  </button>
                                </Tooltip>
                              )
                            ) : row.bucket === 'has_document' ? (
                              // Facturas / notas de crédito con documento: también permiten (re)subir el PDF a Falabella.
                              row.documentUploadedAt ? (
                                <Tooltip content="Ya lo subiste a Falabella. Puedes volver a subirlo para reemplazarlo.">
                                  <button
                                    type="button"
                                    onClick={() => void openUploadModal(row.order, false)}
                                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 text-xs font-medium text-indigo-400 transition hover:bg-indigo-100/60"
                                  >
                                    <Upload className="h-3.5 w-3.5" />
                                    Volver a subir
                                  </button>
                                </Tooltip>
                              ) : (
                                <Tooltip content={String(row.documentStatus || '').toUpperCase() === 'ACEPTADO' ? 'Subir el documento a Falabella' : 'El documento debe estar ACEPTADO por SUNAT para subirlo'}>
                                  <button
                                    type="button"
                                    disabled={String(row.documentStatus || '').toUpperCase() !== 'ACEPTADO'}
                                    onClick={() => void openUploadModal(row.order, false)}
                                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:hover:bg-muted"
                                  >
                                    <Upload className="h-3.5 w-3.5" />
                                    Subir documento
                                  </button>
                                </Tooltip>
                              )
                            ) : (
                              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${badgeClass}`}>
                                {row.actionLabel}
                              </span>
                            )}
                          </td>
                          <td className="p-3 align-middle text-right">{money(row.total)}</td>
                        </tr>
                      );
                    })}
                    {filteredFlowRows.length === 0 && (
                      <tr>
                        <td colSpan={flowTableColumnCount} className="p-8 text-center text-sm text-muted-foreground">
                          No hay órdenes en este estado.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </section>

      {emitBoletaModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="flex max-h-[92vh] w-full max-w-[min(1400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-foreground">
                  Emitir a SUNAT
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {emitBoletaModal.loading
                    ? 'Preparando datos de Falabella...'
                    : `${emitBoletaModal.ventas.length || emitBoletaModal.rows.length} orden(es) · ${money(emitBoletaModal.ventas.reduce((sum, venta) => sum + Number(venta?.total || 0), 0))}`}
                </p>
              </div>
              <button
                type="button"
                onClick={closeEmitBoletaModal}
                disabled={emitBoletaModal.processing}
                aria-label="Cerrar"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
              {emitBoletaModal.loading ? (
                <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-4 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Consultando items y armando venta SUNAT...
                </div>
              ) : (
                <div className="space-y-4">
                  {emitBoletaModal.error && (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                      {emitBoletaModal.error}
                    </div>
                  )}

                  {emitBoletaModal.validationErrors.length > 0 && (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                      {emitBoletaModal.validationErrors.map((error, index) => (
                        <p key={index}>{error}</p>
                      ))}
                    </div>
                  )}

                  {emitBoletaModal.ventas.length > 0 && (() => {
                    const single = emitBoletaModal.ventas.length === 1;
                    const kindForVenta = (venta: any) => (
                      emitBoletaModal.rows.find((row) => row.orderNumber === String(venta?.orderNumber || ''))?.invoiceKind || 'BOLETA'
                    );
                    const labelForVenta = (venta: any) => documentKindLabel(kindForVenta(venta));
                    const emissionForVenta = (venta: any) => (
                      emitBoletaModal.emissionItems.find((item) => item.orderNumber === String(venta?.orderNumber || ''))
                    );
                    const renderEmissionStatus = (item?: EmissionItem) => {
                      const current = item || {
                        status: 'pending' as EmissionItemStatus,
                        message: 'Pendiente',
                        numeroCompleto: '',
                        error: '',
                      };
                      const info = emissionStatusInfo(current.status);
                      const Icon = info.icon;
                      const spinning = current.status === 'creating' || current.status === 'sending';
                      return (
                        <div className="min-w-0">
                          <span className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium ${info.className}`}>
                            <Icon className={`h-3.5 w-3.5 ${spinning ? 'animate-spin' : ''}`} />
                            {info.label}
                          </span>
                          {current.numeroCompleto && (
                            <p className="mt-1 truncate font-mono text-xs text-foreground">{current.numeroCompleto}</p>
                          )}
                          {current.error ? (
                            <p className="mt-1 line-clamp-2 text-xs text-red-700" title={current.error}>{current.error}</p>
                          ) : current.message && current.message !== 'Pendiente' ? (
                            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground" title={current.message}>{current.message}</p>
                          ) : null}
                        </div>
                      );
                    };
                    const renderItems = (venta: any) => (
                      <div className="rounded-xl border border-border bg-background">
                        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Items de {labelForVenta(venta).toLowerCase()}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{venta.detalles?.length || 0} producto(s) enviados a SUNAT</p>
                          </div>
                          <span className="rounded-md bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700">{labelForVenta(venta)}</span>
                        </div>
                        <div className="grid grid-cols-[130px_minmax(240px,1fr)_70px_115px_115px] gap-3 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                          <div>Código</div>
                          <div>Descripción</div>
                          <div className="text-right">Cant.</div>
                          <div className="text-right">Valor unit.</div>
                          <div className="text-right">Bruto</div>
                        </div>
                        <div className="divide-y divide-border/70">
                          {(venta.detalles || []).map((detalle: any, detailIndex: number) => (
                            <div
                              key={`${detalle.codigo}-${detailIndex}`}
                              className="grid grid-cols-[130px_minmax(240px,1fr)_70px_115px_115px] items-center gap-3 px-4 py-2.5 text-sm"
                            >
                              <div className="font-mono text-xs text-foreground">{detalle.codigo || '-'}</div>
                              <div className="font-medium text-foreground">{detalle.descripcion || '-'}</div>
                              <div className="text-right tabular-nums">{detalle.cantidad || 0}</div>
                              <div className="text-right tabular-nums">{money(Number(detalle.mtoValorUnitario || 0))}</div>
                              <div className="text-right font-medium tabular-nums">{money(Number(detalle.mtoBruto || 0))}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );

                    if (single) {
                      const venta = emitBoletaModal.ventas[0];
                      const orderNumber = String(venta.orderNumber || '');
                      const orderWarnings = emitBoletaModal.warningsByOrder[orderNumber] || [];
                      const documentLabel = labelForVenta(venta);
                      const emissionItem = emissionForVenta(venta);
                      return (
                        <div className="space-y-4">
                          <div className="overflow-hidden rounded-xl border border-border bg-background">
                            <div className="grid grid-cols-[minmax(120px,0.9fr)_minmax(108px,0.65fr)_minmax(180px,1.6fr)_72px_minmax(88px,0.6fr)_minmax(128px,0.85fr)_minmax(86px,0.6fr)] items-center gap-3 bg-muted/30 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                              <div>Orden</div>
                              <div>Fecha emisión</div>
                              <div>Cliente</div>
                              <div className="text-center">Items</div>
                              <div className="text-right">Total</div>
                              <div>SUNAT</div>
                              <div className="text-right">Preview</div>
                            </div>
                            <div className="grid grid-cols-[minmax(120px,0.9fr)_minmax(108px,0.65fr)_minmax(180px,1.6fr)_72px_minmax(88px,0.6fr)_minmax(128px,0.85fr)_minmax(86px,0.6fr)] items-center gap-3 px-4 py-4 text-sm">
                              <div className="font-mono text-xs text-foreground">{venta.orderNumber || '-'}</div>
                              <div className="text-foreground">{venta.fechaEmision || '-'}</div>
                              <div>
                                <p className="truncate font-medium text-foreground" title={venta.client?.razonSocial || '-'}>
                                  {venta.client?.razonSocial || '-'}
                                </p>
                                <div className="mt-1 flex flex-wrap items-center gap-2">
                                  <span className="font-mono text-xs text-muted-foreground">{venta.client?.numeroDocumento || '-'}</span>
                                  <span className="rounded-md bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700">{documentLabel}</span>
                                </div>
                                {kindForVenta(venta) === 'FACTURA' && venta.client?.direccion && (
                                  <p className="mt-1 truncate text-xs text-muted-foreground" title={venta.client.direccion}>
                                    {venta.client.direccion}
                                  </p>
                                )}
                              </div>
                              <div className="text-center">
                                <button
                                  type="button"
                                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium"
                                >
                                  <ChevronDown className="h-3.5 w-3.5" />
                                  {venta.detalles?.length || 0}
                                  {orderWarnings.length > 0 && <AlertCircle className="h-3.5 w-3.5 text-amber-600" />}
                                </button>
                              </div>
                              <div className="text-right font-semibold tabular-nums text-foreground">{money(Number(venta.total || 0))}</div>
                              <div>{renderEmissionStatus(emissionItem)}</div>
                              <div className="text-right">
                                <button
                                  type="button"
                                  onClick={() => void openBoletaPreview(venta)}
                                  disabled={emitBoletaModal.processing || emitBoletaModal.previewLoadingOrder === orderNumber}
                                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-medium transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {emitBoletaModal.previewLoadingOrder === orderNumber ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Eye className="h-3.5 w-3.5" />
                                  )}
                                  Preview
                                </button>
                              </div>
                            </div>
                            {orderWarnings.length > 0 && (
                              <div className="border-t border-border px-4 py-3">
                                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                                  {orderWarnings.map((warning, warningIndex) => (
                                    <p key={warningIndex}>{warning}</p>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                          {renderItems(venta)}
                        </div>
                      );
                    }

                    return (
                      <div className="overflow-x-auto rounded-xl border border-border bg-background">
                        <div className="w-full min-w-[900px]">
                          <div className="grid grid-cols-[minmax(120px,0.9fr)_minmax(108px,0.65fr)_minmax(180px,1.6fr)_72px_minmax(88px,0.6fr)_minmax(128px,0.85fr)_minmax(86px,0.6fr)] gap-3 bg-muted/30 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                            <div>Orden</div>
                            <div>Fecha emisión</div>
                            <div>Cliente</div>
                            <div className="text-center">Items</div>
                            <div className="text-right">Total</div>
                            <div>SUNAT</div>
                            <div className="text-right">Preview</div>
                          </div>
                          {emitBoletaModal.ventas.map((venta) => {
                            const orderNumber = String(venta.orderNumber || '');
                            const orderWarnings = emitBoletaModal.warningsByOrder[orderNumber] || [];
                            const expanded = !!emitBoletaModal.expandedOrders[orderNumber];
                            const documentLabel = labelForVenta(venta);
                            const emissionItem = emissionForVenta(venta);
                            const toggleExpanded = () => setEmitBoletaModal((current) => ({
                              ...current,
                              expandedOrders: {
                                ...current.expandedOrders,
                                [orderNumber]: !current.expandedOrders[orderNumber],
                              },
                            }));
                            return (
                              <div key={orderNumber} className="border-t border-border/70">
                                <div className="grid grid-cols-[minmax(120px,0.9fr)_minmax(108px,0.65fr)_minmax(180px,1.6fr)_72px_minmax(88px,0.6fr)_minmax(128px,0.85fr)_minmax(86px,0.6fr)] items-center gap-3 px-4 py-3 text-sm">
                                  <div className="font-mono text-xs text-foreground">{venta.orderNumber || '-'}</div>
                                  <div className="text-foreground">{venta.fechaEmision || '-'}</div>
                                  <div>
                                    <p className="truncate font-medium text-foreground" title={venta.client?.razonSocial || '-'}>
                                      {venta.client?.razonSocial || '-'}
                                    </p>
                                    <div className="mt-1 flex flex-wrap items-center gap-2">
                                      <span className="font-mono text-xs text-muted-foreground">{venta.client?.numeroDocumento || '-'}</span>
                                      <span className="rounded-md bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700">{documentLabel}</span>
                                    </div>
                                    {kindForVenta(venta) === 'FACTURA' && venta.client?.direccion && (
                                      <p className="mt-1 truncate text-xs text-muted-foreground" title={venta.client.direccion}>
                                        {venta.client.direccion}
                                      </p>
                                    )}
                                  </div>
                                  <div className="text-center">
                                    <button
                                      type="button"
                                      onClick={toggleExpanded}
                                      aria-expanded={expanded}
                                      className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition hover:bg-accent ${
                                        orderWarnings.length ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-border'
                                      }`}
                                    >
                                      {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                      {venta.detalles?.length || 0}
                                      {orderWarnings.length > 0 && <AlertCircle className="h-3.5 w-3.5" />}
                                    </button>
                                  </div>
                                  <div className="text-right tabular-nums text-foreground">{money(Number(venta.total || 0))}</div>
                                  <div>{renderEmissionStatus(emissionItem)}</div>
                                  <div className="text-right">
                                    <button
                                      type="button"
                                      onClick={() => void openBoletaPreview(venta)}
                                      disabled={emitBoletaModal.processing || emitBoletaModal.previewLoadingOrder === orderNumber}
                                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      {emitBoletaModal.previewLoadingOrder === orderNumber ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Eye className="h-3.5 w-3.5" />
                                      )}
                                      Ver
                                    </button>
                                  </div>
                                </div>
                                {expanded && (
                                  <div className="border-t border-border/70 bg-muted/10 px-4 py-4">
                                    {orderWarnings.length > 0 && (
                                      <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                                        {orderWarnings.map((warning, warningIndex) => (
                                          <p key={warningIndex}>{warning}</p>
                                        ))}
                                      </div>
                                    )}
                                    {renderItems(venta)}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {(emitBoletaModal.processing || (emitBoletaModal.log.length > 0 && !emitBoletaModal.result?.success)) && (
                    <div className="rounded-xl border border-border bg-background p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-medium">Progreso SUNAT</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {emitBoletaModal.progress.status || 'Preparando...'}
                          </p>
                        </div>
                        <span className="text-xs font-medium text-muted-foreground">
                          {emitBoletaModal.progress.current} / {emitBoletaModal.progress.total}
                        </span>
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${emitBoletaModal.progress.total ? Math.min(100, (emitBoletaModal.progress.current / emitBoletaModal.progress.total) * 100) : 0}%` }}
                        />
                      </div>
                      <div className="mt-3 max-h-32 overflow-auto rounded-lg bg-muted/30 p-3 font-mono text-xs text-muted-foreground">
                        {emitBoletaModal.log.length ? emitBoletaModal.log.map((line, index) => (
                          <div key={`${line}-${index}`}>{line}</div>
                        )) : 'Sin eventos todavía.'}
                      </div>
                    </div>
                  )}

                  {emitBoletaModal.result && (
                    <div className={`rounded-xl border p-4 text-sm ${
                      emitBoletaModal.result?.success
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        : 'border-amber-200 bg-amber-50 text-amber-900'
                    }`}>
                      {(() => {
                        const workflowResult = emitBoletaModal.result?.result || emitBoletaModal.result;
                        const boletas = Array.isArray(workflowResult?.boletas)
                          ? workflowResult.boletas
                          : [];
                        const total = Number(workflowResult?.total || boletas.length || emitBoletaModal.ventas.length || 0);
                        const exitosas = Number(workflowResult?.exitosas || boletas.filter((b: any) => String(b?.estadoSunat || '').toUpperCase() === 'ACEPTADO').length || 0);
                        const rechazadas = Number(workflowResult?.rechazadas || 0);
                        const failedBoletas = boletas.filter((boleta: any) => {
                          const estado = String(boleta?.estadoSunat || '').toUpperCase();
                          return Boolean(boleta?.error) || (estado && estado !== 'ACEPTADO' && estado !== 'OMITIDO');
                        });
                        return (
                          <>
                            <p className="font-medium">
                              {emitBoletaModal.result?.success ? 'Emisión individual finalizada' : 'Emisión individual finalizada con errores'}
                            </p>
                            <div className="mt-2 grid gap-2 sm:grid-cols-3">
                              <div>
                                <p className="text-xs opacity-80">Documentos</p>
                                <p className="font-semibold">{exitosas} aceptada(s){rechazadas ? ` · ${rechazadas} rechazada(s)` : ''} / {total}</p>
                              </div>
                              <div>
                                <p className="text-xs opacity-80">Modo</p>
                                <p className="font-semibold">1x1 individual</p>
                              </div>
                              <div>
                                <p className="text-xs opacity-80">Estado</p>
                                <p className="font-semibold">{emitBoletaModal.result?.success ? 'Completado' : 'Revisar rechazos'}</p>
                              </div>
                            </div>
                            {failedBoletas.length > 0 && (
                              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">
                                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-red-700">Detalle de fallas</p>
                                <div className="mt-2 space-y-2">
                                  {failedBoletas.map((boleta: any, index: number) => (
                                    <div key={`${boleta?.numeroCompleto || index}-${index}`} className="text-xs">
                                      <p className="font-medium">
                                        {String(boleta?.numeroCompleto || 'Boleta')}
                                        {boleta?.orderNumber ? ` · Orden ${boleta.orderNumber}` : ''}
                                        {boleta?.estadoSunat ? ` · ${boleta.estadoSunat}` : ''}
                                      </p>
                                      <p className="mt-0.5 text-red-700/90">
                                        {String(boleta?.error || boleta?.summaryResponse || boleta?.summaryResponseCode || 'SUNAT no devolvió detalle adicional.')}
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4">
              <div className="text-xs text-muted-foreground">
                {emitBoletaModal.result?.success
                  ? `Este modal se cerrará en ${emitCloseCountdown || 5} segundo${(emitCloseCountdown || 5) === 1 ? '' : 's'}.`
                  : emitBoletaModal.result
                    ? 'Revisa el estado y el motivo por cada documento emitido.'
                    : 'Fecha de emisión: fecha de creación de la venta en Falabella.'}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={closeEmitBoletaModal}
                  disabled={emitBoletaModal.processing}
                  className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-xs font-medium transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {emitBoletaModal.result?.success ? 'Cerrar ahora' : 'Cerrar'}
                </button>
                {!emitBoletaModal.result && (
                  <button
                    type="button"
                    onClick={submitEmitBoletas}
                    disabled={
                      emitBoletaModal.loading
                      || emitBoletaModal.processing
                      || emitBoletaModal.ventas.length === 0
                      || emitBoletaModal.validationErrors.length > 0
                    }
                    className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {emitBoletaModal.processing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    {emitBoletaModal.ventas.length > 1 ? 'Emitir seleccionados' : 'Emitir'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {emitBoletaModal.open && emitBoletaModal.previewHtml && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <FileText className="h-4 w-4 text-primary" />
                  Preview de boleta
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground">{emitBoletaModal.previewTitle}</div>
              </div>
              <button
                type="button"
                onClick={() => setEmitBoletaModal((current) => ({ ...current, previewHtml: '', previewTitle: '' }))}
                className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium transition hover:bg-accent"
              >
                Cerrar
              </button>
            </div>
            <div className="min-h-0 flex-1 bg-muted/10 p-4">
              <iframe
                title={emitBoletaModal.previewTitle || 'Preview de boleta'}
                srcDoc={emitBoletaModal.previewHtml}
                className="h-[76vh] w-full rounded-lg border border-border bg-white"
              />
            </div>
          </div>
        </div>
      )}

      {falabellaBatch.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div>
                <h3 className="text-base font-semibold text-foreground">Subir boletas a Falabella</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {falabellaBatch.eligible.length} lista(s) · {falabellaBatch.skipped.length} omitida(s)
                </p>
              </div>
              <button
                type="button"
                onClick={closeFalabellaBatch}
                disabled={falabellaBatch.running}
                aria-label="Cerrar"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
              {falabellaBatch.running && (
                <div className="mb-4 rounded-xl border border-border bg-background p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium">Subiendo PDF</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {falabellaBatch.currentLabel || 'Preparando...'}
                      </p>
                    </div>
                    <span className="text-xs font-medium text-muted-foreground">
                      {falabellaBatch.current} / {falabellaBatch.total}
                    </span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${falabellaBatch.total ? Math.min(100, (falabellaBatch.current / falabellaBatch.total) * 100) : 0}%` }}
                    />
                  </div>
                </div>
              )}

              {falabellaBatch.error && (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  {falabellaBatch.error}
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-border bg-background">
                  <div className="border-b border-border px-4 py-3">
                    <p className="text-sm font-medium">Se subirán</p>
                    <p className="mt-1 text-xs text-muted-foreground">Boletas aceptadas con orden Falabella asociada.</p>
                  </div>
                  <div className="max-h-64 overflow-auto divide-y divide-border/70">
                    {falabellaBatch.eligible.length ? falabellaBatch.eligible.map((boleta) => (
                      <div key={`${boleta.id}-${boleta.orderNumber}`} className="px-4 py-3 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-mono text-xs font-medium">{boleta.numeroCompleto}</span>
                          <span className="text-xs text-muted-foreground">{money(boleta.total)}</span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          Orden {boleta.orderNumber} · {boleta.fechaEmision}
                        </div>
                      </div>
                    )) : (
                      <div className="px-4 py-6 text-sm text-muted-foreground">No hay boletas listas en este filtro.</div>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-background">
                  <div className="border-b border-border px-4 py-3">
                    <p className="text-sm font-medium">Omitidas</p>
                    <p className="mt-1 text-xs text-muted-foreground">No se enviarán en este lote.</p>
                  </div>
                  <div className="max-h-64 overflow-auto divide-y divide-border/70">
                    {falabellaBatch.skipped.length ? falabellaBatch.skipped.map((boleta, index) => (
                      <div key={`${boleta.orderNumber}-${index}`} className="px-4 py-3 text-sm">
                        <div className="font-mono text-xs font-medium">{boleta.numeroCompleto || boleta.orderNumber || '-'}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{boleta.reason || 'No aplica'}</div>
                      </div>
                    )) : (
                      <div className="px-4 py-6 text-sm text-muted-foreground">No hay omisiones.</div>
                    )}
                  </div>
                </div>
              </div>

              {falabellaBatch.results.length > 0 && (
                <div className="mt-4 rounded-xl border border-border bg-background">
                  <div className="border-b border-border px-4 py-3">
                    <p className="text-sm font-medium">Resultado</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {falabellaBatch.results.filter((result) => result.ok && !result.error).length} enviada(s) · {falabellaBatch.results.filter((result) => !result.ok || result.error).length} con error
                    </p>
                  </div>
                  <div className="max-h-64 overflow-auto divide-y divide-border/70">
                    {falabellaBatch.results.map((result) => {
                      const ok = result.ok && !result.error;
                      return (
                        <div key={`${result.boletaId}-${result.orderNumber}`} className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[170px_minmax(0,1fr)]">
                          <div>
                            <div className="font-mono text-xs font-medium">{result.numeroCompleto}</div>
                            <div className="mt-1 text-xs text-muted-foreground">Orden {result.orderNumber}</div>
                          </div>
                          <div className={ok ? 'text-emerald-700' : 'text-red-700'}>
                            {ok
                              ? `Enviada${result.status ? ` · HTTP ${result.status}` : ''}`
                              : falabellaErrorMessage(result.error, 'Falabella rechazó la subida.')}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-4">
              <button
                type="button"
                onClick={closeFalabellaBatch}
                disabled={falabellaBatch.running}
                className="inline-flex h-[42px] items-center rounded-xl border border-border px-4 text-sm font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={() => void uploadFalabellaBatch()}
                disabled={falabellaBatch.running || falabellaBatch.eligible.length === 0 || falabellaBatch.results.length > 0}
                className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {falabellaBatch.running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {falabellaBatch.running ? 'Subiendo...' : 'Subir lote'}
              </button>
            </div>
          </div>
        </div>
      )}

      {uploadModal.open && createPortal((
        <>
          <div className="app-modal-backdrop" aria-hidden="true" />
          <div className="app-modal-layer">
          <div className="max-h-[90vh] w-full max-w-6xl overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div>
                <h3 className="text-base font-semibold text-foreground">
                  {showCleanUpload ? `Subir ${cleanDocTipo.toLowerCase()} a Falabella` : 'Subir documento a Falabella'}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Orden {uploadModal.order?.OrderNumber || '-'} · ID {uploadModal.order?.OrderId || '-'}
                </p>
              </div>
              <button
                type="button"
                onClick={closeUploadModal}
                aria-label="Cerrar"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border transition hover:bg-accent"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[calc(90vh-80px)] overflow-auto px-5 py-4">
              {uploadModal.loading && (
                <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-4 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {showCleanUpload ? `Preparando ${cleanDocTipo.toLowerCase()}...` : 'Preparando documento y consultando OrderItemIds...'}
                </div>
              )}

              {!uploadModal.loading && (
                <div className="space-y-4">
                  {showCleanUpload ? (
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
                      <div className="rounded-xl border border-border bg-background p-6">
                        <div className="flex items-start justify-between gap-6 border-b border-border pb-5">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">{cleanDocTipo} electrónica</p>
                            <p className="mt-2 font-mono text-2xl font-semibold text-foreground">{uploadModal.invoiceNumber || '-'}</p>
                          </div>
                          <div className="rounded-lg border border-border px-4 py-3 text-right">
                            <p className="text-xs text-muted-foreground">Estado SUNAT</p>
                            <p className="mt-1 text-sm font-semibold text-emerald-700">{cleanDoc?.estadoSunat || '-'}</p>
                          </div>
                        </div>

                        <div className="grid gap-4 border-b border-border py-5 md:grid-cols-2">
                          <div>
                            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Cliente</p>
                            <p className="mt-2 text-sm font-semibold text-foreground">{cleanDoc?.cliente || '-'}</p>
                            <p className="mt-1 font-mono text-xs text-muted-foreground">{cleanDoc?.clienteDocumento || '-'}</p>
                          </div>
                          <div>
                            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Orden</p>
                            <p className="mt-2 font-mono text-sm font-semibold text-foreground">{uploadModal.order?.OrderNumber || '-'}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{formatDateOnly(cleanDocDate)}</p>
                          </div>
                        </div>

                        <div className="grid gap-4 py-5 md:grid-cols-3">
                          <div className="rounded-lg bg-muted/35 px-4 py-3">
                            <p className="text-xs text-muted-foreground">Total</p>
                            <p className="mt-1 text-lg font-semibold text-foreground">{money(Number(cleanDoc?.total || 0))}</p>
                          </div>
                          <div className="rounded-lg bg-muted/35 px-4 py-3">
                            <p className="text-xs text-muted-foreground">Fecha</p>
                            <p className="mt-1 text-sm font-medium text-foreground">{formatDateOnly(cleanDocDate)}</p>
                          </div>
                          <div className="rounded-lg bg-muted/35 px-4 py-3">
                            <p className="text-xs text-muted-foreground">Tipo</p>
                            <p className="mt-1 text-sm font-medium text-foreground">{cleanDocTipo}</p>
                          </div>
                        </div>

                        <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
                          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">XML / SUNAT</p>
                          <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
                            {cleanDoc?.codigoHash
                              ? `Hash: ${cleanDoc.codigoHash}`
                              : cleanDoc?.xmlPath
                                ? cleanDoc.xmlPath
                                : `XML registrado en la ${cleanDocTipo.toLowerCase()} local`}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="rounded-xl border border-border bg-background p-4">
                          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">{cleanDocTipo}</p>
                          <p className="mt-2 font-mono text-xl font-semibold text-foreground">{uploadModal.invoiceNumber || '-'}</p>
                          <dl className="mt-4 space-y-3 text-sm">
                            <div className="flex items-center justify-between gap-4">
                              <dt className="text-muted-foreground">Orden</dt>
                              <dd className="font-mono text-foreground">{uploadModal.order?.OrderNumber || '-'}</dd>
                            </div>
                            <div className="flex items-center justify-between gap-4">
                              <dt className="text-muted-foreground">Fecha</dt>
                              <dd className="text-foreground">{formatDateOnly(cleanDocDate)}</dd>
                            </div>
                          </dl>
                        </div>

                        <div className="rounded-xl border border-border bg-background p-4">
                          <p className="text-sm font-medium text-foreground">Subida a Falabella</p>
                          <p className="mt-2 text-sm text-muted-foreground">
                            Al subir, se generará el PDF en memoria, se enviará a Falabella y se descartará.
                          </p>
                          {cleanDoc?.falabellaPdfUploadedAt && (
                            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                              Subida el {formatDate(cleanDoc.falabellaPdfUploadedAt)}. Puedes volver a subirla si necesitas reemplazarla.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                  <div className="grid gap-4 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
                    <div className="rounded-xl border border-border bg-background p-4">
                      <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                        Order Items
                      </p>
                      <p className="mt-2 text-sm text-foreground">
                        {uploadModal.orderItemIds.length
                          ? `${uploadModal.orderItemIds.length} item(s) listos para enviar`
                          : 'No se encontraron items para esta orden'}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {uploadModal.orderItemIds.length > 0 ? uploadModal.orderItemIds.map((orderItemId) => (
                          <span
                            key={orderItemId}
                            className="inline-flex rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
                          >
                            {orderItemId}
                          </span>
                        )) : (
                          <span className="text-xs text-muted-foreground">Sin `orderItemIds`</span>
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl border border-border bg-background p-4">
                      <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                        Historial local
                      </p>
                      <div className="mt-3 space-y-2 text-sm text-foreground">
                        <div className="flex items-center justify-between gap-3">
                          <span>Boleta</span>
                          <span className={uploadModal.resolved?.boleta ? 'text-emerald-700' : 'text-muted-foreground'}>
                            {uploadModal.resolved?.boleta?.numeroCompleto || 'No encontrada'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>Nota de crédito</span>
                          <span className={uploadModal.resolved?.creditNote ? 'text-emerald-700' : 'text-muted-foreground'}>
                            {uploadModal.resolved?.creditNote?.numeroCompleto || 'No encontrada'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  )}

                  {!showCleanUpload && (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Tipo de documento</label>
                      <Select.Root
                        value={uploadModal.selectedKind}
                        onValueChange={(value) => applyResolvedOption(value as InvoiceKind)}
                      >
                        <SelectTrigger
                          placeholder="Selecciona el tipo"
                          value={documentKindLabel(uploadModal.selectedKind)}
                        />
                        <Select.Portal>
                          <Select.Content
                            position="popper"
                            sideOffset={8}
                            className="z-50 w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-border bg-popover shadow-xl"
                          >
                            <Select.Viewport className="p-1.5">
                              {(uploadModal.resolved?.options || []).map((option) => (
                                <Select.Item
                                  key={option.kind}
                                  value={option.kind}
                                  className="relative flex cursor-default select-none items-center rounded-lg px-3 py-2.5 pr-8 text-sm outline-none transition focus:bg-accent focus:text-accent-foreground"
                                >
                                  <div className="min-w-0">
                                    <div className="font-medium">{documentKindLabel(option.kind)}</div>
                                    <div className="text-xs text-muted-foreground">
                                      {option.invoiceNumber || 'Completar manualmente'}
                                    </div>
                                  </div>
                                  <Select.ItemIndicator className="absolute right-2 inline-flex items-center">
                                    <Check className="h-4 w-4" />
                                  </Select.ItemIndicator>
                                </Select.Item>
                              ))}
                            </Select.Viewport>
                          </Select.Content>
                        </Select.Portal>
                      </Select.Root>
                    </div>

                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Fuente PDF</label>
                      <Select.Root
                        value={uploadModal.pdfMode}
                        onValueChange={(value) => {
                          setUploadModal((current) => ({
                            ...current,
                            error: '',
                            uploadResult: null,
                            pdfMode: value as PdfMode,
                          }));
                        }}
                      >
                        <SelectTrigger
                          placeholder="Selecciona la fuente"
                          value={
                            uploadModal.pdfMode === 'auto'
                              ? 'Generar desde boleta local'
                              : uploadModal.pdfMode === 'local_file'
                                ? 'Usar PDF local'
                                : 'Elegir PDF manual'
                          }
                        />
                        <Select.Portal>
                          <Select.Content
                            position="popper"
                            sideOffset={8}
                            className="z-50 w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-border bg-popover shadow-xl"
                          >
                            <Select.Viewport className="p-1.5">
                              {canUseAutoPdf && (
                                <Select.Item
                                  value="auto"
                                  className="relative flex cursor-default select-none items-center rounded-lg px-3 py-2.5 pr-8 text-sm outline-none transition focus:bg-accent focus:text-accent-foreground"
                                >
                                  <Select.ItemText>Generar desde boleta local</Select.ItemText>
                                  <Select.ItemIndicator className="absolute right-2 inline-flex items-center">
                                    <Check className="h-4 w-4" />
                                  </Select.ItemIndicator>
                                </Select.Item>
                              )}
                              {canUseLocalFile && (
                                <Select.Item
                                  value="local_file"
                                  className="relative flex cursor-default select-none items-center rounded-lg px-3 py-2.5 pr-8 text-sm outline-none transition focus:bg-accent focus:text-accent-foreground"
                                >
                                  <Select.ItemText>Usar PDF local</Select.ItemText>
                                  <Select.ItemIndicator className="absolute right-2 inline-flex items-center">
                                    <Check className="h-4 w-4" />
                                  </Select.ItemIndicator>
                                </Select.Item>
                              )}
                              <Select.Item
                                value="selected_file"
                                className="relative flex cursor-default select-none items-center rounded-lg px-3 py-2.5 pr-8 text-sm outline-none transition focus:bg-accent focus:text-accent-foreground"
                              >
                                <Select.ItemText>Elegir PDF manual</Select.ItemText>
                                <Select.ItemIndicator className="absolute right-2 inline-flex items-center">
                                  <Check className="h-4 w-4" />
                                </Select.ItemIndicator>
                              </Select.Item>
                            </Select.Viewport>
                          </Select.Content>
                        </Select.Portal>
                      </Select.Root>
                    </div>
                  </div>
                  )}

                  {!showCleanUpload && (
                  <div className="grid gap-4 md:grid-cols-[minmax(0,1.5fr)_220px]">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Número de documento</label>
                        <input
                          type="text"
                          value={uploadModal.invoiceNumber}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setUploadModal((current) => ({
                              ...current,
                              invoiceNumber: nextValue,
                              uploadResult: null,
                              error: '',
                            }));
                          }}
                          placeholder="B001-00012345"
                          className="h-[46px] w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none transition focus:border-ring"
                        />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Fecha</label>
                        <input
                          type="date"
                          value={uploadModal.invoiceDate}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setUploadModal((current) => ({
                              ...current,
                              invoiceDate: nextValue,
                              uploadResult: null,
                              error: '',
                            }));
                          }}
                          className="h-[46px] w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none transition focus:border-ring"
                        />
                    </div>
                  </div>
                  )}

                  {!showCleanUpload && (
                  <div className="rounded-xl border border-border bg-background p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          PDF a subir
                        </p>
                        {uploadModal.pdfMode === 'auto' && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {uploadModal.lockedBoleta
                              ? 'Se generará el PDF de esta boleta local y se subirá a Falabella.'
                              : 'Se generará el PDF desde la boleta local aceptada al momento de subir.'}
                          </p>
                        )}
                        {uploadModal.pdfMode === 'local_file' && (
                          <p className="mt-1 text-xs text-muted-foreground break-all">
                            {uploadModal.pdfPath || selectedDocumentOption?.pdfPath || 'No hay ruta PDF local disponible.'}
                          </p>
                        )}
                        {uploadModal.pdfMode === 'selected_file' && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {uploadModal.pdfName || 'Selecciona un PDF manual para este documento.'}
                          </p>
                        )}
                      </div>

                      {uploadModal.pdfMode === 'selected_file' && (
                        <button
                          type="button"
                          onClick={() => void pickPdfFile()}
                          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground transition hover:bg-accent"
                        >
                          <FileText className="h-3.5 w-3.5" />
                          Seleccionar PDF
                        </button>
                      )}
                    </div>
                  </div>
                  )}

                  {uploadModal.error && (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        <p>{uploadModal.error}</p>
                      </div>
                    </div>
                  )}

                  {uploadModal.uploadResult?.ok && (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                      {uploadModal.lockedBoleta ? 'Boleta subida correctamente a Falabella.' : 'Documento enviado correctamente a Falabella.'} HTTP {uploadModal.uploadResult.status || '-'}.
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
                    <button
                      type="button"
                      onClick={closeUploadModal}
                      className="inline-flex h-[42px] items-center rounded-xl border border-border px-4 text-sm font-medium text-foreground transition hover:bg-accent"
                    >
                      Cerrar
                    </button>
                    <button
                      type="button"
                      onClick={() => void submitUpload()}
                      disabled={uploadModal.submitting || uploadModal.loading}
                      className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {uploadModal.submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      {uploadModal.submitting
                        ? 'Subiendo...'
                        : showCleanUpload
                          ? cleanDoc?.falabellaPdfUploadedAt
                            ? `Volver a subir ${cleanDocTipo.toLowerCase()}`
                            : `Generar y subir ${cleanDocTipo.toLowerCase()}`
                          : 'Subir documento'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
          </div>
        </>
      ), document.body)}
    </div>
  );
}
