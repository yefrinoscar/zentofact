import { useEffect, useMemo, useRef, useState } from 'react';
import * as Select from '@radix-ui/react-select';
import {
  AlertCircle,
  Calendar as CalendarIcon,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  Loader2,
  RefreshCw,
  Upload,
  X,
} from 'lucide-react';
import { addDays, format } from 'date-fns';
import { DayPicker, type DateRange } from 'react-day-picker';
import { useAppStore } from '../stores/app';
import api from '../lib/api';

type Company = {
  id: number;
  ruc: string;
  razonSocial: string;
  falabellaApiUserId?: string | null;
  falabellaApiKey?: string | null;
};

type InvoiceKind = 'BOLETA' | 'FACTURA' | 'NOTA_DE_CREDITO';
type DocumentSource = 'local_boleta' | 'local_credit_note' | 'manual';
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

type OrdersResponse = {
  ok?: boolean;
  status?: number;
  totalCount?: number | null;
  orders?: FalabellaOrderPayload[];
  error?: {
    Head?: {
      ErrorCode?: string | number;
      ErrorMessage?: string;
    };
    Body?: unknown;
  } | string;
};

type ResolvedDocumentOption = {
  kind: InvoiceKind;
  source: DocumentSource;
  boletaId?: number;
  creditNoteId?: number;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceType: InvoiceKind;
  pdfPath: string;
  estadoSunat?: string;
};

type ResolvedDocumentResponse = {
  orderNumber: string;
  boleta?: {
    id: number;
    numeroCompleto: string;
    fechaEmision: string;
    pdfPath: string;
    estadoSunat?: string;
  } | null;
  creditNote?: {
    id: number;
    numeroCompleto: string;
    fechaEmision: string;
    pdfPath: string;
    estadoSunat?: string;
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
  error: string;
  uploadResult: UploadInvoiceResponse | null;
  order: FalabellaOrder | null;
  orderItemIds: string[];
  resolved: ResolvedDocumentResponse | null;
  selectedKind: InvoiceKind;
  source: DocumentSource;
  boletaId?: number;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceType: InvoiceKind;
  pdfMode: PdfMode;
  pdfPath: string;
  pdfBase64: string;
  pdfName: string;
};

const STATUS_OPTIONS = [
  { value: 'all', label: 'Todos' },
  { value: 'pending', label: 'pending' },
  { value: 'ready_to_ship', label: 'ready_to_ship' },
  { value: 'shipped', label: 'shipped' },
  { value: 'delivered', label: 'delivered' },
  { value: 'canceled', label: 'canceled' },
  { value: 'returned', label: 'returned' },
  { value: 'failed', label: 'failed' },
];

function toApiStartOfDay(date: Date) {
  return `${format(date, 'yyyy-MM-dd')}T00:00:00+00:00`;
}

function toApiEndOfDay(date: Date) {
  return `${format(date, 'yyyy-MM-dd')}T23:59:59+00:00`;
}

function formatRangeLabel(range: DateRange | undefined) {
  if (!range?.from) return 'Selecciona un rango';
  if (!range.to) return format(range.from, 'dd MMM yyyy');
  return `${format(range.from, 'dd MMM yyyy')} - ${format(range.to, 'dd MMM yyyy')}`;
}

function formatDate(value?: string) {
  if (!value) return '-';
  return value.replace('T', ' ').slice(0, 19);
}

function normalizeOrder(order: FalabellaOrderPayload): FalabellaOrder {
  if (order?.Order && typeof order.Order === 'object') return order.Order;
  return order;
}

function formatStatus(order: FalabellaOrder) {
  const statuses = Array.isArray(order.Statuses) ? order.Statuses : [];
  return statuses.map((entry) => entry.Status).filter(Boolean).join(', ') || '-';
}

function companyHasApi(company?: Company | null) {
  return !!company?.falabellaApiUserId && !!company?.falabellaApiKey;
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

function documentKindLabel(kind: InvoiceKind) {
  if (kind === 'NOTA_DE_CREDITO') return 'Nota de crédito';
  if (kind === 'FACTURA') return 'Factura';
  return 'Boleta';
}

function resolvePdfMode(option?: ResolvedDocumentOption | null): PdfMode {
  if (!option) return 'selected_file';
  if (option.source === 'local_boleta' && option.boletaId) return 'auto';
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

function createEmptyUploadState(): UploadModalState {
  return {
    open: false,
    loading: false,
    submitting: false,
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
  };
}

export default function FalabellaApi() {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const setActiveCompanyId = useAppStore((s) => s.setActiveCompanyId);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    const today = new Date();
    return { from: addDays(today, -6), to: today };
  });
  const [dateMenuOpen, setDateMenuOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [invoiceTypeFilter, setInvoiceTypeFilter] = useState<'all' | 'BOLETA' | 'FACTURA'>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<OrdersResponse | null>(null);
  const [uploadModal, setUploadModal] = useState<UploadModalState>(createEmptyUploadState);

  const dateMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!dateMenuRef.current?.contains(event.target as Node)) {
        setDateMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  useEffect(() => {
    api.listCompanies().then((list: Company[]) => {
      const next = Array.isArray(list) ? list : [];
      setCompanies(next);

      if (activeCompanyId && next.some((company) => company.id === activeCompanyId)) {
        setSelectedCompanyId(activeCompanyId);
        return;
      }

      const firstReady = next.find((company) => companyHasApi(company));
      setSelectedCompanyId(firstReady?.id || next[0]?.id || null);
    }).catch(() => {
      setCompanies([]);
    });
  }, [activeCompanyId]);

  const selectedCompany = useMemo(
    () => companies.find((company) => company.id === selectedCompanyId) || null,
    [companies, selectedCompanyId],
  );

  const orders = useMemo(
    () => (result?.orders || []).map(normalizeOrder),
    [result],
  );

  const filteredOrders = useMemo(() => {
    if (invoiceTypeFilter === 'all') return orders;
    return orders.filter((order) => getOrderInvoiceKind(order) === invoiceTypeFilter);
  }, [orders, invoiceTypeFilter]);

  const selectCompany = async (companyId: number) => {
    setSelectedCompanyId(companyId);
    setActiveCompanyId(companyId);
    await api.setActiveCompanyId(companyId);
  };

  const closeUploadModal = () => {
    setUploadModal(createEmptyUploadState());
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

  const loadOrders = async () => {
    if (!selectedCompanyId) return;

    setLoading(true);
    setError('');
    setResult(null);

    try {
      const response = await api.falabellaApiGetOrders(selectedCompanyId, {
        updatedAfter: dateRange?.from ? toApiStartOfDay(dateRange.from) : undefined,
        updatedBefore: dateRange?.to ? toApiEndOfDay(dateRange.to) : dateRange?.from ? toApiEndOfDay(dateRange.from) : undefined,
        limit: 20,
        status: status || undefined,
      });

      if (response?.error) {
        setError(falabellaErrorMessage(response.error, 'Falabella devolvió un error.'));
      }

      setResult(response);
    } catch (nextError: any) {
      setError(nextError?.message || 'No se pudo consultar Falabella API.');
    } finally {
      setLoading(false);
    }
  };

  const openUploadModal = async (order: FalabellaOrder) => {
    if (!selectedCompanyId) return;

    const orderId = order.OrderId;
    const orderNumber = order.OrderNumber;

    if (!orderId || !orderNumber) {
      setUploadModal({
        ...createEmptyUploadState(),
        open: true,
        error: 'La orden no tiene OrderId u OrderNumber disponibles para subir el documento.',
        order,
      });
      return;
    }

    setUploadModal({
      ...createEmptyUploadState(),
      open: true,
      loading: true,
      order,
    });

    try {
      const [itemsResponse, resolvedResponse] = await Promise.all([
        api.falabellaApiGetOrderItems(selectedCompanyId, orderId),
        api.falabellaApiResolveDocument(selectedCompanyId, String(orderNumber)),
      ]);

      if (itemsResponse?.error) {
        throw new Error(falabellaErrorMessage(itemsResponse.error, 'No se pudieron obtener los items de la orden.'));
      }

      const resolved = resolvedResponse as ResolvedDocumentResponse;
      const fallbackKind = getOrderInvoiceKind(order);
      const selectedKind = resolved.boleta || resolved.creditNote
        ? (resolved.defaultKind || fallbackKind)
        : fallbackKind;
      const option = resolved.options.find((entry) => entry.kind === selectedKind) || resolved.options[0];
      const pdfMode = resolvePdfMode(option);

      setUploadModal({
        open: true,
        loading: false,
        submitting: false,
        error: '',
        uploadResult: null,
        order,
        orderItemIds: (itemsResponse?.orderItemIds || []).map((value: string) => String(value)),
        resolved,
        selectedKind: option?.kind || selectedKind,
        source: option?.source || 'manual',
        boletaId: option?.boletaId,
        invoiceNumber: option?.invoiceNumber || '',
        invoiceDate: normalizeInvoiceDate(option?.invoiceDate),
        invoiceType: option?.invoiceType || selectedKind,
        pdfMode,
        pdfPath: pdfMode === 'local_file' ? option?.pdfPath || '' : '',
        pdfBase64: '',
        pdfName: '',
      });
    } catch (nextError: any) {
      setUploadModal({
        ...createEmptyUploadState(),
        open: true,
        loading: false,
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

    if (!uploadModal.orderItemIds.length) {
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

    if (!uploadModal.invoiceDate) {
      setUploadModal((current) => ({
        ...current,
        error: 'Debes indicar la fecha del documento.',
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
      const response = await api.falabellaApiUploadInvoicePdf({
        companyId: selectedCompanyId,
        orderNumber: String(uploadModal.order?.OrderNumber || ''),
        orderItemIds: uploadModal.orderItemIds,
        invoiceNumber: uploadModal.invoiceNumber.trim(),
        invoiceDate: uploadModal.invoiceDate,
        invoiceType: uploadModal.invoiceType,
        source: uploadModal.pdfMode === 'selected_file' ? 'manual' : uploadModal.source,
        boletaId: uploadModal.pdfMode === 'auto' ? uploadModal.boletaId : undefined,
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
      }));
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

  const canUseAutoPdf = selectedDocumentOption?.source === 'local_boleta' && !!selectedDocumentOption.boletaId;
  const canUseLocalFile = !!selectedDocumentOption?.pdfPath;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="space-y-4">
          <div className="max-w-md">
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Empresa</label>
            <Select.Root
              value={selectedCompanyId ? String(selectedCompanyId) : undefined}
              onValueChange={(value) => void selectCompany(Number(value))}
            >
              <SelectTrigger
                placeholder="Selecciona una empresa"
                value={selectedCompany ? `${selectedCompany.nombre || selectedCompany.razonSocial} (${selectedCompany.ruc})` : undefined}
              />
              <Select.Portal>
                <Select.Content
                  position="popper"
                  sideOffset={8}
                  className="z-50 w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-border bg-popover shadow-xl"
                >
                  <Select.ScrollUpButton className="flex h-8 items-center justify-center text-muted-foreground">
                    <ChevronUp className="h-4 w-4" />
                  </Select.ScrollUpButton>
                  <Select.Viewport className="p-1.5">
                    {companies.map((company) => {
                      const ready = companyHasApi(company);
                      return (
                        <Select.Item
                          key={company.id}
                          value={String(company.id)}
                          className="relative flex cursor-default select-none items-center rounded-lg px-3 py-2.5 pr-8 text-sm outline-none transition focus:bg-accent focus:text-accent-foreground"
                        >
                          <div className="min-w-0">
                            <div className="truncate font-medium">{company.nombre || company.razonSocial}</div>
                            <div className="truncate text-xs text-muted-foreground">{company.ruc}</div>
                          </div>
                          <Select.ItemIndicator className="absolute right-2 inline-flex items-center">
                            <Check className="h-4 w-4" />
                          </Select.ItemIndicator>
                          {!ready && (
                            <span className="ml-2 inline-flex shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                              Falta API
                            </span>
                          )}
                        </Select.Item>
                      );
                    })}
                  </Select.Viewport>
                  <Select.ScrollDownButton className="flex h-8 items-center justify-center text-muted-foreground">
                    <ChevronDown className="h-4 w-4" />
                  </Select.ScrollDownButton>
                </Select.Content>
              </Select.Portal>
            </Select.Root>
          </div>

          <div className="grid grid-cols-1 gap-3 border-t border-border pt-4 md:grid-cols-[minmax(0,2fr)_220px_220px_auto]">
            <div ref={dateMenuRef} className="relative">
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Rango de actualización</label>
              <button
                type="button"
                onClick={() => setDateMenuOpen((value) => !value)}
                className="flex w-full items-center justify-between rounded-xl border border-input bg-background px-3 py-2.5 text-left text-sm outline-none transition hover:border-ring"
              >
                <span className="truncate">{formatRangeLabel(dateRange)}</span>
                <CalendarIcon className="ml-3 h-4 w-4 shrink-0 text-muted-foreground" />
              </button>

              {dateMenuOpen && (
                <div className="absolute left-0 top-[calc(100%+0.5rem)] z-20 rounded-2xl border border-border bg-popover p-3 shadow-xl">
                  <DayPicker
                    mode="range"
                    selected={dateRange}
                    onSelect={setDateRange}
                    numberOfMonths={2}
                    defaultMonth={dateRange?.from}
                    className="text-sm"
                    classNames={{
                      months: 'flex flex-col gap-4 sm:flex-row',
                      month: 'space-y-4',
                      month_caption: 'flex items-center justify-center pt-1 relative',
                      caption_label: 'text-sm font-medium',
                      nav: 'flex items-center gap-1',
                      button_previous: 'absolute left-1 inline-flex h-7 w-7 items-center justify-center rounded-md border border-border hover:bg-accent',
                      button_next: 'absolute right-1 inline-flex h-7 w-7 items-center justify-center rounded-md border border-border hover:bg-accent',
                      month_grid: 'w-full border-collapse space-y-1',
                      weekdays: 'flex',
                      weekday: 'w-9 text-[0.8rem] font-normal text-muted-foreground',
                      week: 'mt-2 flex w-full',
                      day: 'h-9 w-9 p-0 text-center text-sm',
                      day_button: 'h-9 w-9 rounded-md hover:bg-accent aria-selected:opacity-100',
                      range_start: 'bg-primary text-primary-foreground rounded-l-md',
                      range_middle: 'bg-accent text-accent-foreground rounded-none',
                      range_end: 'bg-primary text-primary-foreground rounded-r-md',
                      selected: 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
                      today: 'border border-border font-semibold',
                      outside: 'text-muted-foreground opacity-50',
                      disabled: 'text-muted-foreground opacity-50',
                      hidden: 'invisible',
                    }}
                  />
                  <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                    <button
                      type="button"
                      onClick={() => {
                        const today = new Date();
                        setDateRange({ from: addDays(today, -6), to: today });
                      }}
                      className="text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      Últimos 7 días
                    </button>
                    <button
                      type="button"
                      onClick={() => setDateMenuOpen(false)}
                      className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                    >
                      Listo
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Estado</label>
              <Select.Root
                value={status || 'all'}
                onValueChange={(value) => setStatus(value === 'all' ? '' : value)}
              >
                <SelectTrigger placeholder="Todos" value={status || 'Todos'} />
                <Select.Portal>
                  <Select.Content
                    position="popper"
                    sideOffset={8}
                    className="z-50 w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-border bg-popover shadow-xl"
                  >
                    <Select.Viewport className="p-1.5">
                      {STATUS_OPTIONS.map((option) => (
                        <Select.Item
                          key={option.value}
                          value={option.value}
                          className="relative flex cursor-default select-none items-center rounded-lg px-3 py-2.5 pr-8 text-sm outline-none transition focus:bg-accent focus:text-accent-foreground"
                        >
                          <Select.ItemText>{option.label}</Select.ItemText>
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
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Tipo</label>
              <Select.Root
                value={invoiceTypeFilter}
                onValueChange={(value) => setInvoiceTypeFilter(value as 'all' | 'BOLETA' | 'FACTURA')}
              >
                <SelectTrigger
                  placeholder="Todos"
                  value={invoiceTypeFilter === 'all' ? 'Todos' : invoiceTypeFilter}
                />
                <Select.Portal>
                  <Select.Content
                    position="popper"
                    sideOffset={8}
                    className="z-50 w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-border bg-popover shadow-xl"
                  >
                    <Select.Viewport className="p-1.5">
                      {[
                        { value: 'all', label: 'Todos' },
                        { value: 'BOLETA', label: 'BOLETA' },
                        { value: 'FACTURA', label: 'FACTURA' },
                      ].map((option) => (
                        <Select.Item
                          key={option.value}
                          value={option.value}
                          className="relative flex cursor-default select-none items-center rounded-lg px-3 py-2.5 pr-8 text-sm outline-none transition focus:bg-accent focus:text-accent-foreground"
                        >
                          <Select.ItemText>{option.label}</Select.ItemText>
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

            <div className="flex items-end">
              <button
                type="button"
                disabled={!selectedCompany || !companyHasApi(selectedCompany) || loading}
                onClick={() => void loadOrders()}
                className="inline-flex h-[46px] items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {loading ? 'Consultando...' : 'Listar órdenes'}
              </button>
            </div>
          </div>
        </div>
      </section>

      {error && (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">La consulta a Falabella API falló</p>
              <p className="mt-1">{error}</p>
            </div>
          </div>
        </section>
      )}

      {(result || loading) && !error && (
        <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-5 py-4">
            <p className="text-sm text-muted-foreground">
              {loading
                ? 'Consultando órdenes en Falabella...'
                : `${filteredOrders.length} órdenes mostradas${result?.totalCount ? ` de ${result.totalCount}` : ''}`}
            </p>
          </div>

          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/35">
                <tr className="text-left">
                  <th className="p-3 font-medium text-muted-foreground">Orden</th>
                  <th className="p-3 font-medium text-muted-foreground">Cliente</th>
                  <th className="p-3 font-medium text-muted-foreground">Creado</th>
                  <th className="p-3 font-medium text-muted-foreground">Actualizado</th>
                  <th className="p-3 font-medium text-muted-foreground">Monto</th>
                  <th className="p-3 font-medium text-muted-foreground">Tipo</th>
                  <th className="p-3 font-medium text-muted-foreground">Estado</th>
                  <th className="p-3 font-medium text-muted-foreground">Documento</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={8} className="p-10 text-center text-muted-foreground">
                      Cargando órdenes...
                    </td>
                  </tr>
                )}

                {!loading && filteredOrders.map((order) => (
                  <tr key={String(order.OrderId || order.OrderNumber)} className="border-t border-border/70">
                    <td className="p-3">
                      <div className="font-medium text-foreground">{order.OrderNumber || '-'}</div>
                      <div className="text-xs text-muted-foreground">ID {order.OrderId || '-'}</div>
                    </td>
                    <td className="p-3">
                      {[order.CustomerFirstName, order.CustomerLastName].filter(Boolean).join(' ') || '-'}
                    </td>
                    <td className="p-3 text-xs">{formatDate(order.CreatedAt)}</td>
                    <td className="p-3 text-xs">{formatDate(order.UpdatedAt)}</td>
                    <td className="p-3">{order.GrandTotal || order.Price || '-'}</td>
                    <td className="p-3">
                      <span
                        className={
                          getOrderInvoiceKind(order) === 'FACTURA'
                            ? 'inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800'
                            : 'inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800'
                        }
                      >
                        {getOrderInvoiceKind(order)}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                        {formatStatus(order)}
                      </span>
                    </td>
                    <td className="p-3">
                      <button
                        type="button"
                        onClick={() => void openUploadModal(order)}
                        className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground transition hover:bg-accent"
                      >
                        <Upload className="h-3.5 w-3.5" />
                        Subir PDF
                      </button>
                    </td>
                  </tr>
                ))}

                {!loading && filteredOrders.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-10 text-center text-muted-foreground">
                      No hay órdenes para esos filtros.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {uploadModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div>
                <h3 className="text-base font-semibold text-foreground">Subir documento a Falabella</h3>
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
                  Preparando documento y consultando OrderItemIds...
                </div>
              )}

              {!uploadModal.loading && (
                <div className="space-y-4">
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

                  <div className="rounded-xl border border-border bg-background p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">PDF a subir</p>
                        {uploadModal.pdfMode === 'auto' && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Se generará el PDF desde la boleta local aceptada al momento de subir.
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
                      Documento enviado correctamente a Falabella. HTTP {uploadModal.uploadResult.status || '-'}.
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
                      {uploadModal.submitting ? 'Subiendo...' : 'Subir documento'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
