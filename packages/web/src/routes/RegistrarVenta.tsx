import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowLeft,
  Banknote,
  ImagePlus,
  Loader2,
  Package,
  Search,
  Store,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import api from '../lib/api';
import { cn } from '../lib/cn';
import { SHIPPING_CARRIERS, type ShippingCarrier } from '../lib/shipping-carrier';
import { PlacePicker, type MapPlace } from '../components/PlacePicker';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';

type Company = {
  id: number;
  nombre?: string | null;
  nombreComercial?: string | null;
  razonSocial?: string | null;
};

type ChannelAccount = {
  id: number;
  companyId: number;
  channelCode: string;
  active: boolean;
};

type CatalogProduct = {
  id: number;
  mainSku: string;
  name: string;
  imageUrl?: string | null;
  referencePrice?: number | null;
  sellerPriceMin?: number | null;
  available?: number | null;
  listings?: Array<{ shopSku?: string | null }>;
};

type SaleLine = {
  id: string;
  productId: number;
  sku: string;
  name: string;
  imageUrl?: string | null;
  shopSku?: string | null;
  catalogPrice: number;
  unitPrice: number;
  quantity: number;
};

const SALE_SOURCES = [
  { value: 'marketplace', label: 'Marketplace' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'telefono', label: 'Teléfono' },
  { value: 'otro', label: 'Otro' },
] as const;

const PAYMENT_METHODS = [
  { value: 'despues', label: 'Después' },
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'yape_plin', label: 'Yape / Plin' },
  { value: 'transferencia', label: 'Transferencia' },
] as const;

const PICKUP_ADDRESS = 'Av. La Marina 2055, San Miguel';

const NUMBER_INPUT = '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

function formatMoney(value: number) {
  try {
    return new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(Number(value || 0));
  } catch {
    return `S/ ${Number(value || 0).toFixed(2)}`;
  }
}

function productPrice(product: CatalogProduct) {
  const value = Number(product.sellerPriceMin ?? product.referencePrice ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
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
              'h-11 min-w-0 flex-1 cursor-pointer rounded-md border px-3 text-sm font-medium transition-colors sm:h-9 sm:flex-none',
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

export default function RegistrarVenta() {
  const navigate = useNavigate();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [accounts, setAccounts] = useState<ChannelAccount[]>([]);
  const [loadError, setLoadError] = useState('');
  const [saleSource, setSaleSource] = useState<(typeof SALE_SOURCES)[number]['value']>('marketplace');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [lines, setLines] = useState<SaleLine[]>([]);
  const [delivery, setDelivery] = useState<'recojo' | 'envio'>('envio');
  const [shippingCarrier, setShippingCarrier] = useState<ShippingCarrier | ''>('');
  const [dropoffPlace, setDropoffPlace] = useState<MapPlace | null>(null);
  const [shippingNote, setShippingNote] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<(typeof PAYMENT_METHODS)[number]['value']>('despues');
  const [receivedBy, setReceivedBy] = useState('');
  const [paymentProof, setPaymentProof] = useState<{ name: string; type: string; dataUrl: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  useEffect(() => {
    Promise.all([
      api.listCompanies(),
      api.listOrderChannelAccounts({ active: true }),
    ]).then(([companyRows, accountRows]) => {
      setCompanies(Array.isArray(companyRows) ? companyRows : []);
      setAccounts(Array.isArray(accountRows) ? accountRows : []);
    }).catch((error: any) => {
      setLoadError(error?.message || 'No se pudo cargar el canal de venta manual.');
    });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setSubmittedSearch(search.trim()), 220);
    return () => window.clearTimeout(timer);
  }, [search]);

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
  const defaultCompany = useMemo(
    () => companies.find((company) => company.id === manualAccount?.companyId) || companies[0] || null,
    [companies, manualAccount],
  );
  const products = (productsQuery.data?.products || []) as CatalogProduct[];
  const total = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);

  const addProduct = (product: CatalogProduct) => {
    const sku = String(product.mainSku || '').trim();
    const price = productPrice(product);
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
    setLines((current) => current.map((line) => line.id === id ? { ...line, ...patch } : line));
  };

  const attachProof = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setCreateError('La constancia debe ser una foto o captura.');
      return;
    }
    if (file.size > 1_500_000) {
      setCreateError('La constancia pesa más de 1.5 MB. Usa una foto más liviana.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setPaymentProof({ name: file.name, type: file.type, dataUrl: String(reader.result || '') });
      setCreateError('');
    };
    reader.readAsDataURL(file);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreateError('');
    if (!manualAccount || !defaultCompany) {
      setCreateError('Todavía no hay un canal de venta manual habilitado.');
      return;
    }
    if (!customerName.trim()) {
      setCreateError('Escribe el nombre del cliente.');
      return;
    }
    if (!lines.length) {
      setCreateError('Agrega al menos un producto.');
      return;
    }
    if (lines.some((line) => line.quantity < 1 || line.unitPrice < 0)) {
      setCreateError('Revisa cantidad y precio de cada producto.');
      return;
    }
    if (delivery === 'envio' && !shippingCarrier) {
      setCreateError('Elige el reparto: Marvisuar, Shaloom o Dinsides.');
      return;
    }
    if (delivery === 'envio' && !dropoffPlace) {
      setCreateError('Marca la dirección de envío en el mapa.');
      return;
    }

    setCreating(true);
    try {
      const paidNow = paymentMethod !== 'despues';
      const orderNumber = `VTA-${new Date().toISOString().replace(/\D/g, '').slice(2, 14)}`;
      await api.createManagedOrder({
        companyId: defaultCompany.id,
        channelAccountId: manualAccount.id,
        externalOrderId: orderNumber,
        externalOrderNumber: orderNumber,
        orderStatus: 'confirmed',
        paymentStatus: paidNow ? 'paid' : 'pending',
        fulfillmentStatus: 'ready_to_ship',
        requestedDocumentType: 'boleta',
        currency: 'PEN',
        subtotal: total,
        total,
        customer: {
          name: customerName.trim(),
          phone: customerPhone.trim(),
        },
        shipping: {
          type: delivery,
          carrier: delivery === 'envio' ? shippingCarrier : undefined,
          address: delivery === 'envio' ? dropoffPlace?.label || '' : PICKUP_ADDRESS,
          district: delivery === 'envio' ? dropoffPlace?.district || '' : '',
          reference: delivery === 'envio' ? shippingNote.trim() : '',
          lat: delivery === 'envio' ? dropoffPlace?.lat : undefined,
          lng: delivery === 'envio' ? dropoffPlace?.lng : undefined,
        },
        metadata: {
          origin: 'manual_ui',
          saleSource,
          delivery,
          shippingCarrier: delivery === 'envio' ? shippingCarrier : '',
          paymentMethod,
          receivedBy: paymentMethod === 'efectivo' ? receivedBy.trim() : '',
          paymentProof,
          catalog: 'real',
        },
        orderedAt: new Date().toISOString(),
        itemsComplete: true,
        items: lines.map((line, index) => ({
          externalItemId: `${orderNumber}-${index + 1}`,
          sku: line.sku,
          description: line.name,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          total: line.unitPrice * line.quantity,
          metadata: { productId: line.productId, catalogPrice: line.catalogPrice },
        })),
      });
      navigate('/orders', { replace: true, state: { registered: orderNumber } });
    } catch (error: any) {
      setCreateError(error?.message || 'No se pudo registrar la venta.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <form onSubmit={submit} className="mx-auto max-w-3xl space-y-6 pb-24 sm:space-y-8 sm:pb-4">
      <div>
        <Button type="button" variant="ghost" className="-ml-2 h-11 cursor-pointer px-2 sm:h-9" onClick={() => navigate('/orders')}>
          <ArrowLeft /> Volver
        </Button>
      </div>

      {(loadError || createError) && (
        <div role="alert" className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
          <AlertCircle className="size-4 shrink-0" /> {createError || loadError}
        </div>
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
            <Input id="customer-name" value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Nombre del cliente" autoComplete="name" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="customer-phone">Teléfono</Label>
            <Input id="customer-phone" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} placeholder="999 999 999" inputMode="tel" autoComplete="tel" />
          </div>
        </div>
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
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">Entrega</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Recojo en tienda o envío a domicilio.</p>
        </div>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Método de entrega">
          <button
            type="button"
            role="radio"
            aria-checked={delivery === 'envio'}
            onClick={() => setDelivery('envio')}
            className={cn(
              'inline-flex h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium sm:h-9 sm:flex-none',
              delivery === 'envio' ? 'border-foreground bg-foreground text-background' : 'border-border bg-background hover:bg-muted',
            )}
          >
            <Truck className="size-4" /> Envío
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={delivery === 'recojo'}
            onClick={() => {
              setDelivery('recojo');
              setShippingCarrier('');
            }}
            className={cn(
              'inline-flex h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium sm:h-9 sm:flex-none',
              delivery === 'recojo' ? 'border-foreground bg-foreground text-background' : 'border-border bg-background hover:bg-muted',
            )}
          >
            <Store className="size-4" /> Recojo
          </button>
        </div>
        {delivery === 'envio' ? (
          <div className="space-y-3">
            <div className="space-y-2">
              <div>
                <Label>Reparto</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">Puede ser Marvisuar, Shaloom o Dinsides.</p>
              </div>
              <Choice
                value={shippingCarrier}
                options={SHIPPING_CARRIERS}
                onChange={(value) => setShippingCarrier(value)}
                ariaLabel="Reparto"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Dirección de envío</Label>
              <PlacePicker value={dropoffPlace} onChange={setDropoffPlace} placeholder="Busca la calle o toca el mapa" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="shipping-note">Referencia</Label>
              <Input id="shipping-note" value={shippingNote} onChange={(event) => setShippingNote(event.target.value)} placeholder="Dpto, color de puerta…" />
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{PICKUP_ADDRESS}</p>
        )}
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

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:static sm:z-auto sm:border-0 sm:bg-transparent sm:px-0 sm:py-4 sm:backdrop-blur-none">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 pb-[env(safe-area-inset-bottom)]">
          <div>
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-xl font-semibold tabular-nums">{formatMoney(total)}</p>
          </div>
          <Button type="submit" className="h-11 cursor-pointer" disabled={creating || !lines.length}>
            {creating ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Banknote />}
            {creating ? 'Registrando…' : 'Registrar venta'}
          </Button>
        </div>
      </div>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
          <DialogHeader className="border-b border-border px-5 py-4 pr-14">
            <DialogTitle>Elegir producto</DialogTitle>
            <DialogDescription>Busca por nombre o SKU y toca para agregarlo.</DialogDescription>
          </DialogHeader>
          <div className="border-b border-border px-5 py-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por nombre o SKU"
                aria-label="Buscar producto"
                className="h-11 pl-9"
                autoFocus
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {productsQuery.isFetching && !products.length ? (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground">Buscando productos…</p>
            ) : !products.length ? (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                {submittedSearch ? 'No hay productos con esa búsqueda.' : 'Escribe para buscar en el catálogo.'}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {products.map((product) => (
                  <li key={product.id}>
                    <button
                      type="button"
                      onClick={() => addProduct(product)}
                      className="flex w-full cursor-pointer items-center gap-3 px-5 py-3 text-left hover:bg-muted/50"
                    >
                      <ProductPhoto url={product.imageUrl} shopSku={product.listings?.[0]?.shopSku} sku={product.mainSku} name={product.name} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{product.name}</span>
                        <span className="block truncate font-mono text-[11px] text-muted-foreground">{product.mainSku}</span>
                      </span>
                      <span className="shrink-0 text-sm font-medium tabular-nums">{formatMoney(productPrice(product))}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </form>
  );
}
