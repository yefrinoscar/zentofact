import { FormEvent, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Check,
  ChevronRight,
  ImageIcon,
  Loader2,
  PackageCheck,
  Printer,
  RefreshCw,
  Search,
  Store,
} from 'lucide-react';
import api from '@/lib/api';
import { cn } from '@/lib/cn';
import {
  attentionDeadlineTabs,
  filterAttentionDeadline,
  formatAttentionDeadline,
  formatAttentionIngress,
} from '@/lib/order-attention-presentation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type AttentionProduct = {
  id: number;
  sku: string;
  name: string;
  quantity: number;
  imageUrl: string | null;
};

type AttentionOrder = {
  id: number;
  companyId: number | null;
  companyName: string;
  channelCode: string;
  channelName: string;
  externalOrderId: string;
  orderNumber: string;
  fulfillmentStatus: 'pending' | 'ready_to_ship';
  providerStatus: string | null;
  orderedAt: string | null;
  promisedShippingAt: string | null;
  total: number | null;
  currency: string;
  customerName: string;
  labelCount: number;
  products: AttentionProduct[];
  action: 'mark_ready' | 'print_label' | 'external';
};

type AttentionLabel = AttentionOrder & {
  labelIndex: number;
  printed: boolean;
  printCount: number;
  lastPrintedAt: string | null;
};

type AttentionResponse = {
  pending: AttentionOrder[];
  ready: AttentionLabel[];
  counts: {
    pendingOrders: number;
    readyLabels: number;
    readyOrders: number;
    problems: number;
  };
};

type Company = {
  id: number;
  nombre?: string | null;
  nombreComercial?: string | null;
  razonSocial?: string | null;
};

type Channel = { code: string; name: string };

function companyLabel(company: Company) {
  return String(company.nombreComercial || company.nombre || company.razonSocial || `Tienda ${company.id}`);
}

function formatMoney(value: number | null, currency: string) {
  if (value === null) return '—';
  try {
    return new Intl.NumberFormat('es-PE', { style: 'currency', currency: currency || 'PEN' }).format(value);
  } catch {
    return `${currency || 'PEN'} ${value.toFixed(2)}`;
  }
}

function base64Blob(base64: string, mimeType: string) {
  const binary = window.atob(base64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
}

function ChannelBadge({ code, name }: { code: string; name: string }) {
  const classes = code === 'falabella'
    ? 'border-orange-200 bg-orange-50 text-orange-800'
    : code === 'ripley'
      ? 'border-violet-200 bg-violet-50 text-violet-800'
      : 'border-slate-200 bg-slate-50 text-slate-700';
  return <Badge variant="outline" className={cn('rounded-md text-[10px] uppercase tracking-wide', classes)}>{name || code}</Badge>;
}

function ProductImage({ product }: { product: AttentionProduct }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-white">
      <ImageIcon className="size-4 text-muted-foreground/40" />
      {product.imageUrl && !failed && (
        <img
          src={product.imageUrl}
          alt=""
          className="absolute inset-0 size-full object-contain p-0.5"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
      {product.quantity > 1 && (
        <span className="absolute bottom-0.5 right-0.5 rounded bg-foreground px-1 py-0.5 text-[9px] font-semibold leading-none text-background shadow">
          ×{product.quantity}
        </span>
      )}
    </div>
  );
}

function ProductSummary({ products }: { products: AttentionProduct[] }) {
  if (!products.length) return <p className="text-xs text-muted-foreground">Productos aún no informados</p>;
  return (
    <div className="space-y-1.5">
      {products.map((product) => (
        <div key={`${product.id}:${product.sku}`} className="flex min-w-0 items-center gap-2.5">
          <ProductImage product={product} />
          <div className="min-w-0">
            <p className="line-clamp-2 text-xs font-medium leading-4 text-foreground">{product.name}</p>
            <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{product.sku || 'Sin SKU'}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function DeadlinePill({ value, now }: { value: string | null; now: Date }) {
  const deadline = formatAttentionDeadline(value, now);
  const classes = deadline.tone === 'danger'
    ? 'bg-rose-100 text-rose-700'
    : deadline.tone === 'warning'
      ? 'bg-amber-100 text-amber-800'
      : deadline.tone === 'info'
        ? 'bg-sky-100 text-sky-700'
        : 'bg-muted text-muted-foreground';
  return <span className={cn('inline-flex w-fit whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-medium', classes)}>{deadline.label}</span>;
}

function AttentionRow({
  order,
  now,
  loading,
  onAction,
  onOpen,
}: {
  order: AttentionOrder | AttentionLabel;
  now: Date;
  loading: boolean;
  onAction: () => void;
  onOpen: () => void;
}) {
  const ingress = formatAttentionIngress(order.orderedAt, now);
  const label = 'labelIndex' in order ? order : null;
  const actionLabel = order.action === 'mark_ready'
    ? 'Marcar listo'
    : order.action === 'print_label'
      ? label?.printed ? 'Impresa' : 'Imprimir'
      : 'Ver detalle';
  return (
    <article className="grid gap-3 px-4 py-4 transition-colors hover:bg-muted/25">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <button type="button" onClick={onOpen} className="truncate font-mono text-sm font-semibold hover:underline">
            {order.orderNumber}
          </button>
          {label && order.labelCount > 1 && (
            <p className="mt-1 w-fit rounded-md border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-800">
              Mismo pedido · etiqueta {label.labelIndex}/{order.labelCount}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <ChannelBadge code={order.channelCode} name={order.channelName} />
          <span className="text-xs font-semibold tabular-nums">{formatMoney(order.total, order.currency)}</span>
        </div>
      </div>

      <ProductSummary products={order.products} />

      <div className="grid grid-cols-[0.85fr_1.05fr_1fr] gap-2 border-t border-border/70 pt-2.5 text-[11px]">
        <div className="min-w-0">
          <p className="text-muted-foreground">Ingresó</p>
          <p className="mt-0.5 font-medium text-foreground">{ingress.relative}</p>
          <p className="truncate text-muted-foreground">{ingress.exact}</p>
        </div>
        <div className="min-w-0">
          <p className="text-muted-foreground">Entrega</p>
          <div className="mt-1"><DeadlinePill value={order.promisedShippingAt} now={now} /></div>
        </div>
        <div className="min-w-0">
          <p className="text-muted-foreground">Tienda</p>
          <p className="mt-0.5 line-clamp-2 font-medium text-foreground" title={order.companyName}>{order.companyName}</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={onOpen} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
          Ver detalle <ChevronRight className="size-3" />
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant={label?.printed ? 'outline' : order.action === 'external' ? 'outline' : 'default'}
              className={cn('min-w-28', label?.printed && 'border-emerald-200 text-emerald-700')}
              onClick={onAction}
              disabled={loading}
            >
              {loading ? <Loader2 className="animate-spin" /> : order.action === 'mark_ready' ? <PackageCheck /> : order.action === 'print_label' ? label?.printed ? <Check /> : <Printer /> : <ChevronRight />}
              {actionLabel}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {label?.printed
              ? `Impresa ${label.printCount} ${label.printCount === 1 ? 'vez' : 'veces'}. Pulsa para reimprimir.`
              : order.action === 'external'
                ? `Esta acción todavía debe completarse en ${order.channelName}.`
                : actionLabel}
          </TooltipContent>
        </Tooltip>
      </div>
    </article>
  );
}

function EmptyColumn({ children }: { children: string }) {
  return (
    <div className="grid min-h-52 place-items-center px-6 text-center">
      <div><Store className="mx-auto size-7 text-muted-foreground/40" /><p className="mt-2 text-sm text-muted-foreground">{children}</p></div>
    </div>
  );
}

export default function PedidosPorAtender() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialSearch = searchParams.get('search') || '';
  const [companyId, setCompanyId] = useState('all');
  const [channelCode, setChannelCode] = useState('all');
  const [search, setSearch] = useState(initialSearch);
  const [submittedSearch, setSubmittedSearch] = useState(initialSearch);
  const [deadlineScope, setDeadlineScope] = useState('all');
  const [readyConfirmation, setReadyConfirmation] = useState<AttentionOrder[] | null>(null);
  const [readyLoadingIds, setReadyLoadingIds] = useState<Set<number>>(new Set());
  const [printingKeys, setPrintingKeys] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const now = new Date();

  const filters = useMemo(() => ({
    companyId: companyId === 'all' ? undefined : Number(companyId),
    channelCode: channelCode === 'all' ? undefined : channelCode,
    search: submittedSearch || undefined,
  }), [channelCode, companyId, submittedSearch]);
  const attentionQuery = useQuery({
    queryKey: ['order-attention', filters],
    queryFn: () => api.listOrderAttention(filters) as Promise<AttentionResponse>,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
  const companiesQuery = useQuery({ queryKey: ['order-companies'], queryFn: () => api.listCompanies(), staleTime: 5 * 60_000 });
  const channelsQuery = useQuery({ queryKey: ['order-channels'], queryFn: () => api.listOrderChannels(), staleTime: 5 * 60_000 });

  const data = attentionQuery.data || { pending: [], ready: [], counts: { pendingOrders: 0, readyLabels: 0, readyOrders: 0, problems: 0 } };
  const allWork = useMemo(() => [...data.pending, ...data.ready], [data.pending, data.ready]);
  const deadlineTabs = useMemo(() => attentionDeadlineTabs(allWork, now), [allWork, now]);
  const visiblePending = useMemo(() => filterAttentionDeadline(data.pending, deadlineScope, now), [data.pending, deadlineScope, now]);
  const visibleReady = useMemo(() => filterAttentionDeadline(data.ready, deadlineScope, now), [data.ready, deadlineScope, now]);
  const companies = (Array.isArray(companiesQuery.data) ? companiesQuery.data : []) as Company[];
  const channels = (Array.isArray(channelsQuery.data) ? channelsQuery.data : []) as Channel[];
  const supportedPending = visiblePending.filter((order) => order.action === 'mark_ready');
  const unprintedLabels = visibleReady.filter((order) => order.action === 'print_label' && !order.printed);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setSubmittedSearch(search.trim());
    setDeadlineScope('all');
  };

  const openOrder = (order: AttentionOrder) => navigate(`/orders?search=${encodeURIComponent(order.orderNumber)}`);

  const markReady = async () => {
    const candidates = readyConfirmation || [];
    if (!candidates.length) return;
    setReadyLoadingIds(new Set(candidates.map((order) => order.id)));
    setError('');
    setMessage('');
    const failed: AttentionOrder[] = [];
    let succeeded = 0;
    try {
      for (let index = 0; index < candidates.length; index += 4) {
        const chunk = candidates.slice(index, index + 4);
        const results = await Promise.allSettled(chunk.map((order) => (
          api.falabellaApiSetReadyToShip(Number(order.companyId), order.externalOrderId)
        )));
        results.forEach((result, resultIndex) => {
          if (result.status === 'fulfilled') succeeded += 1;
          else failed.push(chunk[resultIndex]);
        });
      }
      if (succeeded) setMessage(`${succeeded} pedido${succeeded === 1 ? '' : 's'} marcado${succeeded === 1 ? '' : 's'} como listo${succeeded === 1 ? '' : 's'}.`);
      if (failed.length) setError(`No se pudieron preparar ${failed.length} pedido${failed.length === 1 ? '' : 's'}. Puedes reintentar.`);
      await attentionQuery.refetch();
    } finally {
      setReadyLoadingIds(new Set());
      setReadyConfirmation(null);
    }
  };

  const printLabels = async (labels: AttentionLabel[]) => {
    const printable = labels.filter((label) => label.action === 'print_label');
    if (!printable.length) return;
    const keys = new Set(printable.map((label) => `${label.id}:${label.labelIndex}`));
    const preview = window.open('', '_blank');
    if (preview) {
      preview.opener = null;
      preview.document.write('<title>Preparando etiquetas</title><p style="font:16px system-ui;padding:32px">Preparando etiquetas…</p>');
      preview.document.close();
    }
    setPrintingKeys(keys);
    setError('');
    setMessage('');
    try {
      const result = await api.falabellaApiGetShippingLabelsA4(printable.map((label) => ({
        companyId: Number(label.companyId),
        orderId: label.externalOrderId,
        orderNumber: label.orderNumber,
        labelIndex: label.labelIndex,
      })));
      if (!result?.base64) throw new Error('No se pudo crear el PDF de etiquetas.');
      const url = URL.createObjectURL(base64Blob(result.base64, 'application/pdf'));
      if (preview) preview.location.replace(url);
      else {
        const link = document.createElement('a');
        link.href = url;
        link.download = result.filename || 'etiquetas.pdf';
        link.click();
      }
      setMessage(`${printable.length} etiqueta${printable.length === 1 ? '' : 's'} preparada${printable.length === 1 ? '' : 's'} para imprimir.`);
      await attentionQuery.refetch();
      window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
    } catch (nextError) {
      preview?.close();
      setError(nextError instanceof Error ? nextError.message : 'No se pudieron imprimir las etiquetas.');
    } finally {
      setPrintingKeys(new Set());
    }
  };

  const clearFilters = () => {
    setCompanyId('all');
    setChannelCode('all');
    setSearch('');
    setSubmittedSearch('');
    setDeadlineScope('all');
  };

  return (
    <div className="space-y-4">
      <form onSubmit={submitSearch} className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar pedido, SKU o producto" className="h-9 pl-9" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={channelCode} onValueChange={(value) => { setChannelCode(value); setDeadlineScope('all'); }}>
            <SelectTrigger className="h-9 w-40"><SelectValue placeholder="Marketplace" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los canales</SelectItem>
              {channels.map((channel) => <SelectItem key={channel.code} value={channel.code}>{channel.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={companyId} onValueChange={(value) => { setCompanyId(value); setDeadlineScope('all'); }}>
            <SelectTrigger className="h-9 w-44"><SelectValue placeholder="Tienda" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las tiendas</SelectItem>
              {companies.map((company) => <SelectItem key={company.id} value={String(company.id)}>{companyLabel(company)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button type="submit" variant="outline" size="sm" className="h-9">Buscar</Button>
          {(companyId !== 'all' || channelCode !== 'all' || submittedSearch || deadlineScope !== 'all') && (
            <Button type="button" variant="ghost" size="sm" className="h-9" onClick={clearFilters}>Limpiar</Button>
          )}
          <Button type="button" variant="outline" size="icon-sm" className="size-9" onClick={() => void attentionQuery.refetch()} disabled={attentionQuery.isFetching} aria-label="Actualizar bandeja">
            <RefreshCw className={cn(attentionQuery.isFetching && 'animate-spin')} />
          </Button>
        </div>
      </form>

      {message && <div role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>}
      {error && <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      {attentionQuery.error && <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{(attentionQuery.error as Error).message}</div>}

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="border-b border-border bg-muted/30 px-3 py-2.5">
          <div role="tablist" aria-label="Filtrar por entrega" className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-muted p-1">
            {deadlineTabs.map((tab) => (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={deadlineScope === tab.value}
                onClick={() => setDeadlineScope(tab.value)}
                className={cn(
                  'inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition',
                  deadlineScope === tab.value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {tab.label}<span className="rounded-full bg-background px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">{tab.count}</span>
              </button>
            ))}
          </div>
        </div>

        {attentionQuery.isPending && !attentionQuery.data ? (
          <div className="flex min-h-80 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-5 animate-spin" /> Cargando pedidos por atender…</div>
        ) : (
          <div className="grid xl:grid-cols-2">
            <section className="min-w-0 xl:border-r xl:border-border" aria-labelledby="pending-column-title">
              <header className="flex min-h-16 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                <div><h2 id="pending-column-title" className="font-semibold">Pendientes</h2><p className="text-xs text-muted-foreground">{visiblePending.length} pedido{visiblePending.length === 1 ? '' : 's'} por preparar</p></div>
                {supportedPending.length > 0 && <Button size="sm" onClick={() => setReadyConfirmation(supportedPending)}><PackageCheck /> Marcar todos</Button>}
              </header>
              <div className="divide-y divide-border/70">
                {visiblePending.map((order) => (
                  <AttentionRow
                    key={order.id}
                    order={order}
                    now={now}
                    loading={readyLoadingIds.has(order.id)}
                    onOpen={() => openOrder(order)}
                    onAction={() => order.action === 'mark_ready' ? setReadyConfirmation([order]) : openOrder(order)}
                  />
                ))}
                {visiblePending.length === 0 && <EmptyColumn>No hay pedidos pendientes con estos filtros.</EmptyColumn>}
              </div>
            </section>

            <section className="min-w-0 border-t border-border xl:border-t-0" aria-labelledby="ready-column-title">
              <header className="flex min-h-16 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                <div><h2 id="ready-column-title" className="font-semibold">Listos para enviar</h2><p className="text-xs text-muted-foreground">{visibleReady.length} etiqueta{visibleReady.length === 1 ? '' : 's'} de {new Set(visibleReady.map((label) => label.id)).size} pedido{new Set(visibleReady.map((label) => label.id)).size === 1 ? '' : 's'}</p></div>
                {unprintedLabels.length > 0 && <Button size="sm" onClick={() => void printLabels(unprintedLabels)} disabled={printingKeys.size > 0}><Printer /> Imprimir etiquetas</Button>}
              </header>
              <div className="divide-y divide-border/70">
                {visibleReady.map((label) => {
                  const key = `${label.id}:${label.labelIndex}`;
                  return (
                    <AttentionRow
                      key={key}
                      order={label}
                      now={now}
                      loading={printingKeys.has(key)}
                      onOpen={() => openOrder(label)}
                      onAction={() => label.action === 'print_label' ? void printLabels([label]) : openOrder(label)}
                    />
                  );
                })}
                {visibleReady.length === 0 && <EmptyColumn>No hay etiquetas listas con estos filtros.</EmptyColumn>}
              </div>
            </section>
          </div>
        )}
      </section>

      <Dialog open={Boolean(readyConfirmation)} onOpenChange={(open) => { if (!open) setReadyConfirmation(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Marcar pedidos como listos</DialogTitle>
            <DialogDescription>
              Se prepararán {readyConfirmation?.length || 0} pedido{readyConfirmation?.length === 1 ? '' : 's'} en Falabella. Después estarán disponibles sus etiquetas.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReadyConfirmation(null)}>Cancelar</Button>
            <Button onClick={() => void markReady()} disabled={readyLoadingIds.size > 0}>{readyLoadingIds.size > 0 ? <Loader2 className="animate-spin" /> : <PackageCheck />} Confirmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
