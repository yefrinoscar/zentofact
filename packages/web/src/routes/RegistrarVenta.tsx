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
  PAYMENT_METHODS,
  PICKUP_ADDRESS,
  SALE_SOURCES,
  buildManualSaleOrderPayload,
  limaTodayKey,
  productPrice,
  saleLinesTotal,
  validateManualSale,
  type CatalogProductForSale,
  type PaymentMethod,
  type SaleLine,
  type SaleSource,
} from '../lib/registrar-venta';
import {
  applyOptimisticSale,
  buildOptimisticSale,
  humanizeSaleError,
  saleValidationField,
  type OptimisticHome,
  type SaleValidationField,
} from '../lib/sale-feedback';
import { SHIPPING_CARRIERS, type ShippingCarrier } from '../lib/shipping-carrier';
import {
  DEFAULT_DELIVERY_LOCATION,
  OWN_DELIVERY_CARRIER,
  deliveryProvincesForDepartment,
  districtsForDeliveryLocation,
  findLimaMetropolitanDistrict,
  ownDeliveryQuote,
  type DeliveryLocation,
} from '../lib/own-delivery';
import { PlacePicker, type MapPlace } from '../components/PlacePicker';
import { ProductSearchPicker } from '../components/ProductSearchPicker';
import { useOperatorSnackbar } from '../components/OperatorSnackbar';
import { Button } from '../components/ui/button';
import { Calendar } from '../components/ui/calendar';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { dateFromKey } from '../lib/documentDateRange';

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
    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap" role="radiogroup" aria-label={ariaLabel}>
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
              'h-11 min-w-0 cursor-pointer rounded-md border px-3 text-sm font-medium transition-colors sm:h-9 sm:flex-none',
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
  const { can } = usePermissions();
  const afterSavePath = can('salesperson') && !can('order_management') ? '/mis-ventas' : '/orders';

  const [accounts, setAccounts] = useState<ChannelAccount[]>([]);
  const [loadError, setLoadError] = useState('');
  const [saleSource, setSaleSource] = useState<SaleSource>('marketplace');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [lines, setLines] = useState<SaleLine[]>([]);
  const [delivery, setDelivery] = useState<'recojo' | 'envio'>('envio');
  const [deliveryDate, setDeliveryDate] = useState(limaTodayKey);
  const [shippingCarrier, setShippingCarrier] = useState<ShippingCarrier | ''>('');
  const [dropoffPlace, setDropoffPlace] = useState<MapPlace | null>(null);
  const [deliveryLocation, setDeliveryLocation] = useState<DeliveryLocation>(DEFAULT_DELIVERY_LOCATION);
  const [ownDeliveryDistanceKm, setOwnDeliveryDistanceKm] = useState('');
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

  const manualAccount = useMemo(
    () => accounts.find((account) => account.channelCode === 'manual' && account.active) || null,
    [accounts],
  );
  const products = (productsQuery.data?.products || []) as CatalogProduct[];
  const productTotal = saleLinesTotal(lines);
  const ownDeliveryDistance = ownDeliveryDistanceKm === '' ? null : Number(ownDeliveryDistanceKm);
  const ownDelivery = shippingCarrier === OWN_DELIVERY_CARRIER
    ? ownDeliveryQuote(ownDeliveryDistance)
    : null;
  const shippingAmount = ownDelivery?.amount || 0;
  const total = productTotal + shippingAmount;
  const deliveryProvinces = deliveryProvincesForDepartment(deliveryLocation.department);
  const deliveryDistricts = districtsForDeliveryLocation(deliveryLocation);

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
      deliveryLocation,
      ownDeliveryDistanceKm: ownDeliveryDistance,
      shippingNote,
      saleSource,
      paymentMethod,
      receivedBy,
      paymentProof,
    });
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
        deliveryLocation,
        ownDeliveryDistanceKm: ownDeliveryDistance,
        shippingNote,
        saleSource,
        paymentMethod,
        receivedBy,
        paymentProof,
      });
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

  return (
    <form onSubmit={submit} className="mx-auto max-w-3xl space-y-6 pb-[calc(9rem+env(safe-area-inset-bottom))] sm:space-y-8 sm:pb-4">
      <div>
        <Button type="button" variant="ghost" className="-ml-2 h-11 cursor-pointer px-2 sm:h-9" onClick={() => navigate(afterSavePath)}>
          <ArrowLeft /> Volver
        </Button>
      </div>

      {setupError && (
        <p className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
          {setupError}
        </p>
      )}

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">Origen</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Cómo llegó esta venta.</p>
        </div>
        <Choice value={saleSource} options={SALE_SOURCES} onChange={setSaleSource} ariaLabel="Origen de la venta" />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">Cliente</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Con el teléfono alcanza para coordinar.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="customer-name">Nombre</Label>
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
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="customer-phone">Teléfono</Label>
            <Input id="customer-phone" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} placeholder="999 999 999" inputMode="tel" autoComplete="tel" />
          </div>
        </div>
        <FieldHint message={fieldErrors.customer} />
      </section>

      <section className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-sm font-medium">Productos</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">El precio se puede ajustar si es venta por mayor.</p>
          </div>
          <Button type="button" variant="outline" className="h-11 w-full cursor-pointer sm:h-9 sm:w-auto" onClick={() => setPickerOpen(true)}>
            <Search /> Buscar producto
          </Button>
        </div>

        {lines.length === 0 && (
          <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            Aún no hay productos. Ábrelo y elige del catálogo.
          </p>
        )}
        <FieldHint message={fieldErrors.products} />

        {lines.length > 0 && (
          <ul className="divide-y divide-border rounded-md border border-border">
            {lines.map((line) => (
              <li key={line.id} className="p-3">
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
        <FieldHint message={fieldErrors.lines} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Entrega</h2>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div
            className="inline-flex w-full overflow-hidden rounded-md border border-border sm:w-auto"
            role="radiogroup"
            aria-label="Método de entrega"
          >
            <button
              type="button"
              role="radio"
              aria-checked={delivery === 'envio'}
              onClick={() => {
                setDelivery('envio');
                clearFieldError('delivery');
              }}
              className={cn(
                'h-11 min-w-0 flex-1 cursor-pointer border-r border-border px-3 text-sm font-medium transition-colors sm:h-9 sm:flex-none',
                delivery === 'envio' ? 'bg-foreground text-background' : 'bg-background text-foreground hover:bg-muted',
              )}
            >
              Envío
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={delivery === 'recojo'}
              onClick={() => {
                setDelivery('recojo');
                setShippingCarrier('');
                setDropoffPlace(null);
                setOwnDeliveryDistanceKm('');
                setShippingNote('');
                clearFieldError('delivery');
              }}
              className={cn(
                'h-11 min-w-0 flex-1 cursor-pointer px-3 text-sm font-medium transition-colors sm:h-9 sm:flex-none',
                delivery === 'recojo' ? 'bg-foreground text-background' : 'bg-background text-foreground hover:bg-muted',
              )}
            >
              Recojo
            </button>
          </div>
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

        {delivery === 'envio' ? (
          <div className="space-y-3">
            <div
              className="inline-flex w-full overflow-hidden rounded-md border border-border sm:w-auto"
              role="radiogroup"
              aria-label="Reparto"
            >
              {SHIPPING_CARRIERS.map((carrier, index) => {
                const selected = shippingCarrier === carrier.value;
                return (
                  <button
                    key={carrier.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      setShippingCarrier(carrier.value);
                      if (carrier.value !== OWN_DELIVERY_CARRIER) setOwnDeliveryDistanceKm('');
                      clearFieldError('delivery');
                    }}
                    className={cn(
                      'h-11 min-w-0 flex-1 cursor-pointer truncate px-3 text-sm font-medium transition-colors sm:h-9 sm:flex-none',
                      index < SHIPPING_CARRIERS.length - 1 && 'border-r border-border',
                      selected ? 'bg-foreground text-background' : 'bg-background text-foreground hover:bg-muted',
                    )}
                  >
                    {carrier.label}
                  </button>
                );
              })}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="delivery-department">Departamento</Label>
                <Select
                  value={deliveryLocation.department}
                  onValueChange={(department) => {
                    const province = deliveryProvincesForDepartment(department)[0] || '';
                    setDeliveryLocation({ department, province, district: '', ubigeo: '' });
                    clearFieldError('delivery');
                  }}
                >
                  <SelectTrigger id="delivery-department" aria-label="Departamento de entrega">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEFAULT_DELIVERY_LOCATION.department}>{DEFAULT_DELIVERY_LOCATION.department}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="delivery-province">Provincia</Label>
                <Select
                  value={deliveryLocation.province}
                  onValueChange={(province) => {
                    setDeliveryLocation((current) => ({ ...current, province, district: '', ubigeo: '' }));
                    clearFieldError('delivery');
                  }}
                >
                  <SelectTrigger id="delivery-province" aria-label="Provincia de entrega">
                    <SelectValue placeholder="Selecciona provincia" />
                  </SelectTrigger>
                  <SelectContent>
                    {deliveryProvinces.map((province) => <SelectItem key={province} value={province}>{province}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="delivery-district">Distrito</Label>
                <Select
                  value={deliveryLocation.district}
                  onValueChange={(districtName) => {
                    const district = deliveryDistricts.find((candidate) => candidate.name === districtName);
                    if (!district) return;
                    setDeliveryLocation((current) => ({ ...current, district: district.name, ubigeo: district.ubigeo }));
                    clearFieldError('delivery');
                  }}
                >
                  <SelectTrigger id="delivery-district" aria-label="Distrito de entrega">
                    <SelectValue placeholder="Selecciona distrito" />
                  </SelectTrigger>
                  <SelectContent>
                    {deliveryDistricts.map((district) => <SelectItem key={district.ubigeo} value={district.name}>{district.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {shippingCarrier === OWN_DELIVERY_CARRIER && (
              <div className="grid gap-3 border-y border-border py-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-end">
                <div className="space-y-1.5">
                  <Label htmlFor="own-delivery-distance">Distancia estimada</Label>
                  <Input
                    id="own-delivery-distance"
                    type="number"
                    min={0.1}
                    max={25}
                    step="0.1"
                    inputMode="decimal"
                    value={ownDeliveryDistanceKm}
                    onChange={(event) => {
                      setOwnDeliveryDistanceKm(event.target.value);
                      clearFieldError('delivery');
                    }}
                    placeholder="km"
                    className={cn(NUMBER_INPUT, 'tabular-nums')}
                  />
                </div>
                <div className="min-w-0 pb-0.5 sm:pb-1">
                  <p className="text-xs text-muted-foreground">Tarifa de envío</p>
                  <p className="text-lg font-semibold tabular-nums">{ownDelivery ? formatMoney(ownDelivery.amount) : '—'}</p>
                  <p className="text-xs text-muted-foreground">10 km · S/ 10 &nbsp; 15 km · S/ 20 &nbsp; 25 km · S/ 25</p>
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Dirección</Label>
              <PlacePicker
                value={dropoffPlace}
                onChange={(place) => {
                  setDropoffPlace(place);
                  const district = findLimaMetropolitanDistrict(place.district);
                  if (district) {
                    setDeliveryLocation({
                      department: DEFAULT_DELIVERY_LOCATION.department,
                      province: DEFAULT_DELIVERY_LOCATION.province,
                      district: district.name,
                      ubigeo: district.ubigeo,
                    });
                  }
                  clearFieldError('delivery');
                }}
                placeholder="Calle o toca el mapa"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="shipping-note">Referencia</Label>
              <Input
                id="shipping-note"
                value={shippingNote}
                onChange={(event) => {
                  setShippingNote(event.target.value);
                  clearFieldError('delivery');
                }}
                placeholder="Dpto, color de puerta…"
              />
            </div>
          </div>
        ) : (
          <p className="pb-1 text-sm leading-6 text-muted-foreground sm:pb-0">{PICKUP_ADDRESS}</p>
        )}
        <FieldHint message={fieldErrors.delivery} />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">Pago</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Puedes registrarlo ahora o después.</p>
        </div>
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
          <div className="space-y-1.5">
            <Label htmlFor="received-by">¿Quién cobró?</Label>
            <Input id="received-by" value={receivedBy} onChange={(event) => setReceivedBy(event.target.value)} placeholder="Opcional" />
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
      </section>

      {/* Spacer so the fixed bar never covers the last fields on mobile. */}
      <div className="h-2 sm:hidden" aria-hidden="true" />

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/90 sm:static sm:z-auto sm:border-0 sm:bg-transparent sm:px-0 sm:py-4 sm:backdrop-blur-none">
        <div className="mx-auto flex max-w-3xl items-end justify-between gap-3 pb-[env(safe-area-inset-bottom)]">
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>Productos</span>
              <span className="tabular-nums">{formatMoney(productTotal)}</span>
            </div>
            {shippingCarrier === OWN_DELIVERY_CARRIER && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>Envío propio</span>
                <span className="tabular-nums">{ownDelivery ? formatMoney(shippingAmount) : '—'}</span>
              </div>
            )}
            <div className="flex items-baseline gap-3">
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="truncate text-xl font-semibold tabular-nums">{formatMoney(total)}</p>
            </div>
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
