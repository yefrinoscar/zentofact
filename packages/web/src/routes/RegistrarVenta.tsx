import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Banknote,
  CalendarDays,
  ImagePlus,
  Loader2,
  Package,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { es } from 'date-fns/locale';
import api from '../lib/api';
import { usePermissions } from '../hooks/usePermissions';
import { cn } from '../lib/cn';
import {
  BOLETA_IDENTITIES,
  DOCUMENT_REQUESTS,
  PAYMENT_METHODS,
  PICKUP_ADDRESS,
  SALE_SOURCES,
  buildManualSaleOrderPayload,
  limaTodayKey,
  productPrice,
  saleLinesTotal,
  validateManualSale,
  type BoletaIdentity,
  type CatalogProductForSale,
  type DocumentRequest,
  type PaymentMethod,
  type SaleLine,
  type SaleSource,
} from '../lib/registrar-venta';
import {
  OWN_FLEET_CARRIER,
  OWN_FLEET_COVERAGE_HINT,
  OWN_FLEET_OUT_OF_RANGE_MESSAGE,
  quoteOwnFleetShipping,
  saleTotals,
} from '../lib/own-fleet-shipping';
import {
  applyOptimisticSale,
  buildOptimisticSale,
  humanizeSaleError,
  saleValidationField,
  type OptimisticHome,
  type SaleValidationField,
} from '../lib/sale-feedback';
import { SHIPPING_CARRIERS, type ShippingCarrier } from '../lib/shipping-carrier';
import { PlacePicker, type MapPlace } from '../components/PlacePicker';
import { ProductSearchPicker } from '../components/ProductSearchPicker';
import { useOperatorSnackbar } from '../components/OperatorSnackbar';
import { Button } from '../components/ui/button';
import { Calendar } from '../components/ui/calendar';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { dateFromKey } from '../lib/documentDateRange';
import { RegistrarVentaPrototype } from './registrar-venta-prototype';
import type { SaleFormView } from './registrar-venta-prototype/view';

type ChannelAccount = {
  id: number;
  companyId: number;
  channelCode: string;
  active: boolean;
};

type CatalogProduct = CatalogProductForSale;

const NUMBER_INPUT = '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

function formatMoney(value: number) {
  try {
    return new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(Number(value || 0));
  } catch {
    return `S/ ${Number(value || 0).toFixed(2)}`;
  }
}

function formatDeliveryDateLabel(value: string, nowKey = limaTodayKey()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Elegir fecha';
  const date = dateFromKey(value);
  const sameYear = value.slice(0, 4) === nowKey.slice(0, 4);
  return new Intl.DateTimeFormat('es-PE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' as const }),
  }).format(date).replace(/\.$/, '').toLocaleLowerCase('es-PE');
}

function DeliveryDatePicker({
  value,
  onChange,
  minDateKey,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  minDateKey: string;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = /^\d{4}-\d{2}-\d{2}$/.test(value) ? dateFromKey(value) : undefined;
  const minDate = dateFromKey(minDateKey);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          id="delivery-date"
          aria-label={ariaLabel}
          className={cn(
            'h-11 w-full justify-between gap-2 px-3 font-normal tabular-nums sm:h-9 sm:w-44',
            !selected && 'text-muted-foreground',
          )}
        >
          <span className="truncate">{formatDeliveryDateLabel(value, minDateKey)}</span>
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <Calendar
          mode="single"
          required
          numberOfMonths={1}
          timeZone="America/Lima"
          noonSafe
          locale={es}
          selected={selected}
          disabled={{ before: minDate }}
          onSelect={(date) => {
            if (!date) return;
            onChange(new Intl.DateTimeFormat('en-CA', {
              timeZone: 'America/Lima',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
            }).format(date));
            setOpen(false);
          }}
          classNames={{ months: 'relative flex' }}
          autoFocus
        />
      </PopoverContent>
    </Popover>
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

function Choice<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T | '';
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'h-11 min-w-0 cursor-pointer rounded-md border px-3 text-sm font-medium transition-colors sm:h-9',
              selected
                ? 'border-foreground bg-foreground text-background'
                : 'border-border bg-background text-foreground hover:bg-muted',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      className="inline-flex h-9 items-center rounded-xl bg-muted p-1"
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'h-7 cursor-pointer rounded-lg px-3 text-sm font-medium transition-colors',
              selected ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function FormSection({
  title,
  hint,
  error,
  action,
  children,
}: {
  title: string;
  hint?: string;
  error?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 py-6 first:pt-0">
      <div className={cn('flex flex-col gap-3', action && 'sm:flex-row sm:items-start sm:justify-between')}>
        <div className="min-w-0">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
          {hint ? <p className="mt-1 text-sm text-muted-foreground">{hint}</p> : null}
        </div>
        {action}
      </div>
      {children}
      <FieldHint message={error} />
    </section>
  );
}

function FieldRow({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[8.25rem_minmax(0,1fr)] sm:items-start sm:gap-x-4">
      <Label htmlFor={htmlFor} className="text-sm text-muted-foreground sm:pt-2">{label}</Label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const PROOF_MAX_BYTES = 1_500_000;

async function readPaymentProof(file: File): Promise<{ name: string; type: string; dataUrl: string }> {
  if (file.size <= PROOF_MAX_BYTES) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('No se pudo leer la constancia.'));
      reader.readAsDataURL(file);
    });
    return { name: file.name, type: file.type || 'image/jpeg', dataUrl };
  }

  const bitmap = await createImageBitmap(file);
  const maxEdge = 1600;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    throw new Error('No se pudo comprimir la constancia en este dispositivo.');
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  let quality = 0.82;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);
  while (dataUrl.length * 0.75 > PROOF_MAX_BYTES && quality > 0.45) {
    quality -= 0.12;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
  }
  if (dataUrl.length * 0.75 > PROOF_MAX_BYTES) {
    throw new Error('La constancia sigue pesando demasiado. Usa una foto más liviana.');
  }
  const baseName = file.name.replace(/\.[^.]+$/, '') || 'constancia';
  return { name: `${baseName}.jpg`, type: 'image/jpeg', dataUrl };
}

function ProductPhoto({ url, shopSku, sku, name }: { url?: string | null; shopSku?: string | null; sku?: string | null; name: string }) {
  const candidates = [productImageSrc(url), productImageSrc(null, shopSku), productImageSrc(null, null, sku)].filter((src, index, list) => src && list.indexOf(src) === index);
  const [failedCount, setFailedCount] = useState(0);
  const src = candidates[failedCount] || '';
  if (!src) {
    return (
      <span className="grid size-12 shrink-0 place-items-center rounded-md bg-muted" aria-hidden="true">
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
      className="size-12 shrink-0 rounded-md bg-muted object-cover"
    />
  );
}

function FieldHint({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-sm text-destructive">{message}</p>;
}

export default function RegistrarVenta() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showSnackbar } = useOperatorSnackbar();
  const { can, isAdmin } = usePermissions();
  const afterSavePath = can('salesperson') && !can('order_management') ? '/mis-ventas' : '/orders';

  const [accounts, setAccounts] = useState<ChannelAccount[]>([]);
  const [loadError, setLoadError] = useState('');
  const [saleSource, setSaleSource] = useState<SaleSource>('marketplace');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [documentRequest, setDocumentRequest] = useState<DocumentRequest>('none');
  const [boletaIdentity, setBoletaIdentity] = useState<BoletaIdentity>('dni');
  const [customerDocumentNumber, setCustomerDocumentNumber] = useState('');
  const [legalName, setLegalName] = useState('');
  const [fiscalAddress, setFiscalAddress] = useState('');
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [lines, setLines] = useState<SaleLine[]>([]);
  const [delivery, setDelivery] = useState<'recojo' | 'envio'>('envio');
  const [deliveryDate, setDeliveryDate] = useState(limaTodayKey);
  const [shippingCarrier, setShippingCarrier] = useState<ShippingCarrier | ''>('');
  const [dropoffPlace, setDropoffPlace] = useState<MapPlace | null>(null);
  const [shippingNote, setShippingNote] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('despues');
  const [receivedBy, setReceivedBy] = useState('');
  const [paymentProof, setPaymentProof] = useState<{ name: string; type: string; dataUrl: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<SaleValidationField, string>>>({});

  const clearFieldError = (field: SaleValidationField) => {
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const showFieldError = (message: string) => {
    const field = saleValidationField(message) ?? 'customer';
    setFieldErrors({ [field]: message });
  };

  useEffect(() => {
    api.listOrderChannelAccounts({ active: true }).then((accountRows) => {
      setAccounts(Array.isArray(accountRows) ? accountRows : []);
    }).catch((error: any) => {
      setLoadError(error?.message || 'No se pudo cargar el canal de venta manual.');
    });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setSubmittedSearch(search.trim()), 220);
    return () => window.clearTimeout(timer);
  }, [search]);

  const submitProductSearch = () => {
    setSubmittedSearch(search.trim());
  };

  const productsQuery = useQuery({
    queryKey: ['sale-product-search', submittedSearch],
    queryFn: () => api.listCatalogProducts({
      search: submittedSearch || undefined,
      status: 'active',
      sortBy: 'updatedAt',
      sortDir: 'desc',
      limit: 12,
    }),
    enabled: pickerOpen,
    staleTime: 15_000,
  });

  const fleetQuery = useQuery({
    queryKey: ['own-fleet-config'],
    queryFn: api.getOwnFleetConfig,
    staleTime: 30_000,
  });
  const fleetConfig = fleetQuery.data;

  const manualAccount = useMemo(
    () => accounts.find((account) => account.channelCode === 'manual' && account.active) || null,
    [accounts],
  );
  const products = (productsQuery.data?.products || []) as CatalogProduct[];
  const productsTotal = saleLinesTotal(lines);
  const shippingQuote = delivery === 'envio' && shippingCarrier === OWN_FLEET_CARRIER
    ? quoteOwnFleetShipping(dropoffPlace, fleetConfig)
    : null;
  const totals = saleTotals(productsTotal, shippingQuote);
  const total = totals.total;

  const addProduct = (product: CatalogProduct) => {
    const sku = String(product.mainSku || '').trim();
    const price = productPrice(product);
    clearFieldError('products');
    clearFieldError('lines');
    setLines((current) => {
      const existing = current.find((line) => line.productId === product.id);
      if (existing) {
        return current.map((line) => line.productId === product.id ? { ...line, quantity: line.quantity + 1 } : line);
      }
      return [...current, {
        id: `${product.id}-${Date.now()}`,
        productId: product.id,
        sku,
        name: product.name,
        imageUrl: product.imageUrl,
        shopSku: product.listings?.[0]?.shopSku || null,
        catalogPrice: price,
        unitPrice: price,
        quantity: 1,
      }];
    });
    setSearch('');
    setSubmittedSearch('');
    setPickerOpen(false);
  };

  const updateLine = (id: string, patch: Partial<SaleLine>) => {
    clearFieldError('lines');
    setLines((current) => current.map((line) => line.id === id ? { ...line, ...patch } : line));
  };

  const attachProof = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showSnackbar({ message: 'La constancia debe ser una foto o captura.', tone: 'error', duration: 6000 });
      return;
    }
    void readPaymentProof(file)
      .then((proof) => {
        setPaymentProof(proof);
      })
      .catch((error: Error) => {
        showSnackbar({
          message: humanizeSaleError(error.message || 'No se pudo adjuntar la constancia.'),
          tone: 'error',
          duration: 6000,
        });
      });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFieldErrors({});
    const validationError = validateManualSale({
      channelAccountId: manualAccount?.id,
      customerName,
      customerPhone,
      lines,
      delivery,
      deliveryDate,
      shippingCarrier,
      dropoffPlace,
      shippingNote,
      saleSource,
      paymentMethod,
      receivedBy,
      paymentProof,
      documentRequest,
      boletaIdentity,
      customerDocumentNumber,
      legalName,
      fiscalAddress,
    }, fleetConfig);
    if (validationError) {
      showFieldError(validationError);
      return;
    }

    let payload;
    try {
      payload = buildManualSaleOrderPayload({
        channelAccountId: manualAccount!.id,
        customerName,
        customerPhone,
        lines,
        delivery,
        deliveryDate,
        shippingCarrier,
        dropoffPlace,
        shippingNote,
        saleSource,
        paymentMethod,
        receivedBy,
        paymentProof,
        documentRequest,
        boletaIdentity,
        customerDocumentNumber,
        legalName,
        fiscalAddress,
      }, fleetConfig);
    } catch (error: any) {
      showFieldError(humanizeSaleError(error?.message));
      return;
    }

    const registered = {
      number: payload.externalOrderNumber,
      customer: String(payload.customer?.name || customerName).trim(),
      total: Number(payload.total) || 0,
    };
    const optimisticSale = buildOptimisticSale({
      orderNumber: registered.number,
      customerName: registered.customer,
      total: registered.total,
      paymentMethod,
      orderedAt: payload.orderedAt,
    });
    const previousHome = queryClient.getQueryData<OptimisticHome>(['salesperson-home']);
    queryClient.setQueryData<OptimisticHome>(['salesperson-home'], (current) => (
      applyOptimisticSale(current ?? previousHome, optimisticSale, Number(previousHome?.commissionPercent) || 0)
    ));

    // Optimistic: show the list with the new sale right away, then confirm in the background.
    setCreating(true);
    navigate(afterSavePath, {
      replace: true,
      state: { registered },
    });

    try {
      await api.createManagedOrder(payload);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['salesperson-home'] }),
        queryClient.invalidateQueries({ queryKey: ['managed-orders'] }),
        queryClient.invalidateQueries({ queryKey: ['managed-order-sales-pulse'] }),
      ]);
    } catch (error: any) {
      queryClient.setQueryData(['salesperson-home'], previousHome);
      navigate(afterSavePath, {
        replace: true,
        state: { saveFailed: true, saveError: error?.message },
      });
    } finally {
      setCreating(false);
    }
  };

  const channelMissing = !loadError && accounts.length > 0 && !manualAccount;
  const setupError = loadError
    ? humanizeSaleError(loadError)
    : channelMissing
      ? 'Todavía no hay un canal de venta manual habilitado.'
      : '';

  const fillDemo = () => {
    setCustomerName('Ana Pérez');
    setCustomerPhone('999111222');
    setSaleSource('whatsapp');
    setDocumentRequest('boleta');
    setBoletaIdentity('dni');
    setCustomerDocumentNumber('12345678');
    setDelivery('envio');
    setShippingCarrier('nosotros');
    setPaymentMethod('yape_plin');
    setLines([{
      id: 'demo-ag301',
      productId: 1,
      sku: 'AG301',
      name: 'Coche Bastón tipo Paraguas Liviano plegable Celeste',
      catalogPrice: 189.9,
      unitPrice: 189.9,
      quantity: 1,
    }]);
  };

  const view: SaleFormView = {
    afterSavePath,
    setupError,
    isAdmin,
    creating,
    submitDisabled: creating || !!loadError || channelMissing,
    saleSource,
    setSaleSource,
    customerName,
    setCustomerName: (value) => {
      setCustomerName(value);
      clearFieldError('customer');
    },
    customerPhone,
    setCustomerPhone,
    documentRequest,
    setDocumentRequest,
    boletaIdentity,
    setBoletaIdentity,
    customerDocumentNumber,
    setCustomerDocumentNumber,
    legalName,
    setLegalName,
    fiscalAddress,
    setFiscalAddress,
    lines,
    setLines,
    updateLine,
    delivery,
    setDelivery,
    deliveryDate,
    setDeliveryDate,
    shippingCarrier,
    setShippingCarrier,
    dropoffPlace,
    setDropoffPlace,
    shippingNote,
    setShippingNote,
    paymentMethod,
    setPaymentMethod,
    receivedBy,
    setReceivedBy,
    paymentProof,
    setPaymentProof,
    attachProof,
    fieldErrors,
    clearFieldError,
    setPickerOpen,
    pickerOpen,
    search,
    setSearch,
    submitProductSearch,
    products,
    productsFetching: productsQuery.isFetching,
    submittedSearch,
    addProduct,
    shippingQuote,
    totals,
    total,
    fillDemo,
    navigate,
    submit,
  };

  if (import.meta.env.DEV) {
    return <RegistrarVentaPrototype view={view} />;
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-3xl pb-[calc(9rem+env(safe-area-inset-bottom))] sm:pb-4">
      <div className="pb-4">
        <Button type="button" variant="ghost" className="-ml-2 h-11 cursor-pointer px-2 sm:h-9" onClick={() => navigate(afterSavePath)}>
          <ArrowLeft /> Volver
        </Button>
      </div>

      {setupError && (
        <p className="mb-6 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
          {setupError}
        </p>
      )}

      <div className="divide-y divide-border">
      <FormSection title="Origen">
        <Choice value={saleSource} options={SALE_SOURCES} onChange={setSaleSource} ariaLabel="Origen de la venta" />
      </FormSection>

      <FormSection title="Cliente" error={fieldErrors.customer || fieldErrors.document}>
        <FieldRow label="Nombre" htmlFor="customer-name">
          <Input
            id="customer-name"
            value={customerName}
            onChange={(event) => {
              setCustomerName(event.target.value);
              clearFieldError('customer');
            }}
            placeholder="Nombre del cliente"
            autoComplete="name"
            aria-invalid={!!fieldErrors.customer}
          />
        </FieldRow>
        <FieldRow label="Teléfono" htmlFor="customer-phone">
          <Input
            id="customer-phone"
            value={customerPhone}
            onChange={(event) => setCustomerPhone(event.target.value)}
            placeholder="999 999 999"
            inputMode="tel"
            autoComplete="tel"
          />
        </FieldRow>
        <FieldRow label="Comprobante">
          <Choice
            value={documentRequest}
            options={DOCUMENT_REQUESTS}
            onChange={(value) => {
              setDocumentRequest(value);
              if (value === 'factura' && !legalName.trim()) setLegalName(customerName);
              setCustomerDocumentNumber('');
              clearFieldError('document');
            }}
            ariaLabel="Comprobante"
          />
          {documentRequest !== 'none' ? (
            <p className="mt-1.5 text-xs text-muted-foreground">Se emite después desde Pedidos.</p>
          ) : null}
        </FieldRow>
        {documentRequest === 'boleta' && (
          <FieldRow label={boletaIdentity === 'ce' ? 'CE' : 'DNI'} htmlFor="customer-document">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Segmented
                value={boletaIdentity}
                options={BOLETA_IDENTITIES}
                onChange={(value) => {
                  setBoletaIdentity(value);
                  setCustomerDocumentNumber('');
                  clearFieldError('document');
                }}
                ariaLabel="Tipo de documento"
              />
              <Input
                id="customer-document"
                value={customerDocumentNumber}
                onChange={(event) => {
                  const next = boletaIdentity === 'dni'
                    ? event.target.value.replace(/\D/g, '').slice(0, 8)
                    : event.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
                  setCustomerDocumentNumber(next);
                  clearFieldError('document');
                }}
                placeholder={boletaIdentity === 'ce' ? '001234567' : '12345678'}
                inputMode={boletaIdentity === 'dni' ? 'numeric' : 'text'}
                autoComplete="off"
                aria-invalid={!!fieldErrors.document}
                className="sm:max-w-56"
              />
            </div>
          </FieldRow>
        )}
        {documentRequest === 'factura' && (
          <>
            <FieldRow label="RUC" htmlFor="customer-ruc">
              <Input
                id="customer-ruc"
                value={customerDocumentNumber}
                onChange={(event) => {
                  setCustomerDocumentNumber(event.target.value.replace(/\D/g, '').slice(0, 11));
                  clearFieldError('document');
                }}
                placeholder="20123456789"
                inputMode="numeric"
                autoComplete="off"
                aria-invalid={!!fieldErrors.document}
              />
            </FieldRow>
            <FieldRow label="Razón social" htmlFor="legal-name">
              <Input
                id="legal-name"
                value={legalName}
                onChange={(event) => {
                  setLegalName(event.target.value);
                  clearFieldError('document');
                }}
                placeholder="Empresa S.A.C."
                autoComplete="organization"
                aria-invalid={!!fieldErrors.document}
              />
            </FieldRow>
            <FieldRow label="Dirección fiscal" htmlFor="fiscal-address">
              <Input
                id="fiscal-address"
                value={fiscalAddress}
                onChange={(event) => {
                  setFiscalAddress(event.target.value);
                  clearFieldError('document');
                }}
                placeholder="Av. …"
                autoComplete="street-address"
                aria-invalid={!!fieldErrors.document}
              />
            </FieldRow>
          </>
        )}
      </FormSection>

      <FormSection
        title="Productos"
        hint="Ajusta el precio si es por mayor."
        error={fieldErrors.products || fieldErrors.lines}
        action={(
          <Button type="button" variant="outline" className="h-11 w-full cursor-pointer sm:h-9 sm:w-auto" onClick={() => setPickerOpen(true)}>
            <Search /> Buscar producto
          </Button>
        )}
      >
        {lines.length === 0 && (
          <p className="text-sm text-muted-foreground">Busca un producto del catálogo.</p>
        )}

        {lines.length > 0 && (
          <ul className="divide-y divide-border">
            {lines.map((line, index) => (
              <li key={line.id} className={cn('py-3', index === 0 && 'pt-0')}>
                <div className="flex items-start gap-3">
                  <ProductPhoto url={line.imageUrl} shopSku={line.shopSku} sku={line.sku} name={line.name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-sm font-medium leading-5">{line.name}</p>
                        <p className="font-mono text-[11px] text-muted-foreground">{line.sku}</p>
                      </div>
                      <Button type="button" variant="ghost" size="icon-sm" className="size-9 shrink-0 cursor-pointer" aria-label={`Quitar ${line.name}`} onClick={() => setLines((current) => current.filter((item) => item.id !== line.id))}>
                        <Trash2 />
                      </Button>
                    </div>
                    <div className="mt-3 grid grid-cols-[4.75rem_minmax(0,1fr)_auto] items-end gap-2">
                      <div className="space-y-1">
                        <Label htmlFor={`qty-${line.id}`} className="text-[11px] text-muted-foreground">Cant.</Label>
                        <Input
                          id={`qty-${line.id}`}
                          type="number"
                          inputMode="numeric"
                          min={1}
                          value={line.quantity}
                          onChange={(event) => updateLine(line.id, { quantity: Math.max(1, Math.floor(Number(event.target.value || 1))) })}
                          className={cn('h-10 bg-background sm:h-9', NUMBER_INPUT)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`price-${line.id}`} className="text-[11px] text-muted-foreground">Precio</Label>
                        <Input
                          id={`price-${line.id}`}
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.01"
                          value={line.unitPrice}
                          onChange={(event) => updateLine(line.id, { unitPrice: Math.max(0, Number(event.target.value || 0)) })}
                          className={cn('h-10 bg-background tabular-nums sm:h-9', NUMBER_INPUT)}
                        />
                      </div>
                      <p className="min-w-16 pb-2 text-right text-sm font-semibold tabular-nums">{formatMoney(line.unitPrice * line.quantity)}</p>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </FormSection>

      <FormSection title="Entrega" error={fieldErrors.delivery}>
        <FieldRow label="Cómo">
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                value={delivery}
                options={[
                  { value: 'envio', label: 'Envío' },
                  { value: 'recojo', label: 'Recojo' },
                ]}
                onChange={(value) => {
                  setDelivery(value);
                  if (value === 'recojo') {
                    setShippingCarrier('');
                    setDropoffPlace(null);
                    setShippingNote('');
                  }
                  clearFieldError('delivery');
                }}
                ariaLabel="Método de entrega"
              />
              <DeliveryDatePicker
                value={deliveryDate}
                onChange={(value) => {
                  setDeliveryDate(value);
                  clearFieldError('delivery');
                }}
                minDateKey={limaTodayKey()}
                ariaLabel={delivery === 'envio' ? 'Fecha de entrega' : 'Fecha de recojo'}
              />
            </div>
          </FieldRow>

          {delivery === 'envio' ? (
            <>
              <FieldRow label="Reparto">
                <Choice
                  value={shippingCarrier}
                  options={SHIPPING_CARRIERS}
                  onChange={(value) => {
                    setShippingCarrier(value);
                    clearFieldError('delivery');
                  }}
                  ariaLabel="Reparto"
                />
                {shippingCarrier === OWN_FLEET_CARRIER && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {OWN_FLEET_COVERAGE_HINT}
                    {isAdmin ? (
                      <>
                        {' '}
                        <button
                          type="button"
                          className="cursor-pointer underline-offset-2 hover:underline"
                          onClick={() => navigate('/orders/envio')}
                        >
                          Distritos
                        </button>
                      </>
                    ) : null}
                  </p>
                )}
              </FieldRow>
              <FieldRow label="Dirección">
                <PlacePicker
                  value={dropoffPlace}
                  onChange={(place) => {
                    setDropoffPlace(place);
                    clearFieldError('delivery');
                  }}
                  placeholder="Distrito de Lima metropolitana"
                />
                {shippingCarrier === OWN_FLEET_CARRIER && dropoffPlace && shippingQuote?.charged && (
                  <div className="mt-3 space-y-1 text-sm">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-muted-foreground">
                        {shippingQuote.zoneLabel || 'Distrito'}
                      </span>
                      <span className="shrink-0 tabular-nums">{formatMoney(shippingQuote.districtAmount)}</span>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-muted-foreground">
                        {shippingQuote.distanceKm.toFixed(1).replace('.', ',')} km
                      </span>
                      <span className="shrink-0 tabular-nums">{formatMoney(shippingQuote.distanceAmount)}</span>
                    </div>
                  </div>
                )}
                {shippingCarrier === OWN_FLEET_CARRIER && dropoffPlace && shippingQuote && !shippingQuote.charged && (
                  <p className="mt-2 text-sm text-destructive">{OWN_FLEET_OUT_OF_RANGE_MESSAGE}</p>
                )}
                {shippingCarrier === OWN_FLEET_CARRIER && !dropoffPlace && (
                  <p className="mt-1.5 text-xs text-muted-foreground">Busca un distrito de Lima metropolitana.</p>
                )}
              </FieldRow>
              <FieldRow label="Referencia" htmlFor="shipping-note">
                <Input
                  id="shipping-note"
                  value={shippingNote}
                  onChange={(event) => {
                    setShippingNote(event.target.value);
                    clearFieldError('delivery');
                  }}
                  placeholder="Dpto, color de puerta…"
                />
              </FieldRow>
            </>
          ) : (
            <FieldRow label="Tienda">
              <p className="sm:pt-2 text-sm leading-6 text-muted-foreground">{PICKUP_ADDRESS}</p>
            </FieldRow>
          )}
      </FormSection>

      <FormSection title="Pago">
        <Choice
          value={paymentMethod}
          options={PAYMENT_METHODS}
          onChange={(value) => {
            setPaymentMethod(value);
            if (value === 'efectivo' || value === 'despues') setPaymentProof(null);
            if (value !== 'efectivo') setReceivedBy('');
          }}
          ariaLabel="Método de pago"
        />
        {paymentMethod === 'efectivo' && (
          <FieldRow label="¿Quién cobró?" htmlFor="received-by">
            <Input id="received-by" value={receivedBy} onChange={(event) => setReceivedBy(event.target.value)} placeholder="Opcional" />
          </FieldRow>
        )}
        {(paymentMethod === 'yape_plin' || paymentMethod === 'transferencia') && (
          <FieldRow label="Constancia">
            {paymentProof ? (
              <div className="flex items-center gap-2">
                <img src={paymentProof.dataUrl} alt="" className="size-10 rounded-md object-cover" />
                <span className="min-w-0 flex-1 truncate text-sm">{paymentProof.name}</span>
                <Button type="button" variant="ghost" size="icon-sm" className="size-8 cursor-pointer" aria-label="Quitar constancia" onClick={() => setPaymentProof(null)}>
                  <X />
                </Button>
              </div>
            ) : (
              <label className="inline-flex h-9 cursor-pointer items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                <ImagePlus className="size-4" />
                Foto opcional
                <input type="file" accept="image/*" className="sr-only" onChange={(event) => attachProof(event.target.files?.[0])} />
              </label>
            )}
          </FieldRow>
        )}
      </FormSection>
      </div>

      <div className="h-2 sm:hidden" aria-hidden="true" />

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/90 sm:static sm:z-auto sm:border-0 sm:bg-transparent sm:px-0 sm:py-6 sm:backdrop-blur-none">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 pb-[env(safe-area-inset-bottom)]">
          <div className="min-w-0">
            {totals.shipping > 0 ? (
              <>
                <p className="truncate text-xs text-muted-foreground">
                  Productos {formatMoney(totals.products)} · Distrito {formatMoney(totals.districtAmount)} · Distancia {formatMoney(totals.distanceAmount)}
                </p>
                <p className="truncate text-xl font-semibold tabular-nums">{formatMoney(total)}</p>
              </>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">Total</p>
                <p className="truncate text-xl font-semibold tabular-nums">{formatMoney(total)}</p>
              </>
            )}
          </div>
          <Button type="submit" className="h-11 shrink-0 cursor-pointer" disabled={creating || !!loadError || channelMissing}>
            {creating ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Banknote />}
            {creating ? 'Listo…' : 'Registrar venta'}
          </Button>
        </div>
      </div>

      <ProductSearchPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        search={search}
        onSearchChange={setSearch}
        onSubmitSearch={submitProductSearch}
        products={products}
        isFetching={productsQuery.isFetching}
        submittedSearch={submittedSearch}
        onSelect={addProduct}
      />
    </form>
  );
}
