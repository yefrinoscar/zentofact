import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, ImageIcon, Loader2, Maximize2, Search } from 'lucide-react';
import falabellaLogo from '../assets/falabella.png';
import ripleyLogo from '../assets/logo-blanco.svg';
import api from '../lib/api';
import { copyText } from '../lib/clipboard';
import { cn } from '../lib/cn';
import { productImageSrc } from '../lib/logistics-inbox';
import { usePermissions } from '../hooks/usePermissions';
import {
  cancellationKind,
  cancellationKindLabel,
  extraProductsLabel,
  parseCanceledDateRange,
  returnDecisionHelper,
  returnDecisionSummary,
  returnOutcomeLabel,
  returnUnitLabel,
  returnUnits,
  setReturnLineStock,
  setReturnUnit,
  stockApprovalLabel,
  type CancellationKind,
  type ReturnLineDecision,
  type ReturnUnitDestination,
} from '../lib/canceled-orders-presentation';
import { sellerShortName } from '../lib/seller-name';
import DocumentDateRangePicker from '../components/DocumentDateRangePicker';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger } from '../components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TablePanel, TablePanelFooter, TableRow,
} from '../components/ui/table';
import {
  Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious,
} from '../components/ui/pagination';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
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
};

type CanceledOrder = {
  id: number;
  companyId: number | null;
  companyName: string | null;
  channelCode: string;
  channelName: string;
  externalOrderId: string;
  externalOrderNumber: string;
  kind: CancellationKind;
  fulfillmentStatus: string;
  orderStatus: string;
  currency: string;
  total: number | null;
  orderedAt?: string | null;
  cancelledAt?: string | null;
  returnedAt?: string | null;
  changedAt?: string | null;
  documentKind?: string | null;
  documentNumber?: string | null;
  documentStatus?: string | null;
  creditNoteNumber?: string | null;
  creditNoteStatus?: string | null;
  stockApproval?: 'pending' | 'approved' | 'not_required' | null;
  pendingReturnQuantity?: number;
  items?: Array<{
    name?: string | null;
    sku?: string | null;
    quantity?: number;
    imageUrl?: string | null;
    shopSku?: string | null;
    orderItemId?: number | null;
    productId?: number | null;
    approvalId?: number | null;
    approvalStatus?: string | null;
    stockQuantity?: number | null;
    mermaQuantity?: number | null;
  }>;
};

type ProductImagePreview = {
  src: string;
  name: string;
  sku: string;
};

const PAGE_SIZE = 50;
const SEARCH_DELAY_MS = 250;
const FALLBACK_CHANNELS = [
  { id: -1, code: 'falabella', name: 'Falabella' },
  { id: -3, code: 'ripley', name: 'Ripley' },
  { id: -4, code: 'manual', name: 'Venta manual' },
];

const money = (value: number | null | undefined, currency = 'PEN') => {
  try {
    return new Intl.NumberFormat('es-PE', { style: 'currency', currency }).format(Number(value || 0));
  } catch {
    return `S/ ${Number(value || 0).toFixed(2)}`;
  }
};

function formatChangedAt(value?: string | null) {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-PE', {
    timeZone: 'America/Lima',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function companyName(company: Company) {
  return sellerShortName(company.nombreComercial || company.nombre || company.razonSocial);
}

function kindBadgeClass(kind: CancellationKind) {
  return kind === 'returned'
    ? 'border-amber-200 bg-amber-50 text-amber-800'
    : 'border-slate-200 bg-slate-100 text-slate-700';
}

function ChannelMark({ code }: { code?: string | null }) {
  const value = String(code || '').trim().toLowerCase();
  if (value === 'falabella') {
    return <img src={falabellaLogo} alt="Falabella" title="Falabella" className="size-5 shrink-0 rounded-sm object-contain" />;
  }
  if (value === 'ripley') {
    return (
      <span className="grid size-5 shrink-0 place-items-center overflow-hidden rounded-sm border border-zinc-700 bg-zinc-950" title="Ripley" aria-label="Ripley">
        <img src={ripleyLogo} alt="" className="h-4 w-auto" />
      </span>
    );
  }
  return (
    <span className="grid size-5 shrink-0 place-items-center rounded-sm bg-teal-100 text-[9px] font-bold text-teal-800" title="Venta manual" aria-label="Venta manual">
      M
    </span>
  );
}

function productLines(items: CanceledOrder['items'] = []) {
  const lines = items.filter((item) => item.name || item.sku);
  if (lines.length === 0) return [{ name: null, sku: null, quantity: 0, imageUrl: null, shopSku: null }];
  return lines;
}

function pendingReturnDecisions(order: CanceledOrder | null): ReturnLineDecision[] {
  return productLines(order?.items)
    .filter((item) => item.approvalStatus === 'pending' && item.orderItemId)
    .map((item) => {
      const quantity = Number(item.quantity || 0);
      return {
        orderItemId: Number(item.orderItemId),
        quantity,
        stockQuantity: quantity,
        mermaQuantity: 0,
        units: Array.from({ length: quantity }, () => 'stock' as const),
      };
    });
}

function ProductThumb({
  item,
  onOpen,
}: {
  item: NonNullable<CanceledOrder['items']>[number];
  onOpen: (preview: ProductImagePreview) => void;
}) {
  const [failed, setFailed] = useState(false);
  const src = productImageSrc(item.imageUrl, item.shopSku || item.sku);
  const name = item.name || item.sku || 'Producto';
  const canOpen = Boolean(src) && !failed;
  const body = (
    <>
      <ImageIcon className="size-4 text-muted-foreground/40" />
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover transition-transform duration-200 group-hover:scale-105"
          onError={() => setFailed(true)}
        />
      ) : null}
    </>
  );
  if (canOpen) {
    return (
      <button
        type="button"
        onClick={() => onOpen({ src, name, sku: item.sku || '' })}
        aria-label={`Ampliar foto de ${name}`}
        title="Ampliar foto"
        className="group relative grid size-12 shrink-0 cursor-zoom-in place-items-center overflow-hidden rounded-lg bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {body}
        <span className="absolute inset-0 grid place-items-center bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true">
          <Maximize2 className="size-4" />
        </span>
      </button>
    );
  }
  return (
    <span className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted" aria-hidden="true">
      {body}
    </span>
  );
}

function keepWhenStackedDialog(event: Event, previewOpen: boolean) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest('[data-slot="dialog-content"]')) {
    event.preventDefault();
    return;
  }
  if (previewOpen && target.closest('[data-slot="dialog-overlay"]')) {
    event.preventDefault();
  }
}

function DestinationChoice({
  destination,
  selected,
  disabled,
  unitLabel,
  onSelect,
}: {
  destination: ReturnUnitDestination;
  selected: boolean;
  disabled: boolean;
  unitLabel: string;
  onSelect: () => void;
}) {
  const merma = destination === 'merma';
  const label = merma ? 'Merma' : 'A stock';
  return (
    <Button
      type="button"
      size="xs"
      variant={selected ? 'default' : 'outline'}
      disabled={disabled}
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${label} unidad ${unitLabel}`}
      className={cn(
        merma && selected && 'border-rose-600 bg-rose-600 text-white hover:bg-rose-600/90',
        merma && !selected && 'border-rose-200 text-rose-800 hover:bg-rose-50 hover:text-rose-900',
        !merma && selected && 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-600/90',
        !merma && !selected && 'border-emerald-200 text-emerald-800 hover:bg-emerald-50 hover:text-emerald-900',
      )}
    >
      {label}
    </Button>
  );
}

function ProductImageDialog({ preview, onClose }: { preview: ProductImagePreview | null; onClose: () => void }) {
  return (
    <Dialog open={preview !== null} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent
        overlayClassName="z-[90] bg-black/70"
        className="z-[90] max-h-[94vh] gap-0 overflow-hidden bg-zinc-950 p-0 text-white sm:max-w-5xl [&_[data-slot=dialog-close]]:bg-white/10 [&_[data-slot=dialog-close]]:text-white [&_[data-slot=dialog-close]]:hover:bg-white/20"
      >
        {preview ? (
          <>
            <DialogHeader className="sr-only">
              <DialogTitle>Foto de {preview.name}</DialogTitle>
              <DialogDescription>
                {preview.sku ? `Vista ampliada del producto con SKU ${preview.sku}.` : 'Vista ampliada del producto.'}
              </DialogDescription>
            </DialogHeader>
            <figure className="min-h-0">
              <div className="flex min-h-64 items-center justify-center overflow-hidden p-4 sm:min-h-[32rem] sm:p-8">
                <img src={preview.src} alt={preview.name} className="max-h-[calc(94vh-8rem)] max-w-full object-contain" />
              </div>
              <figcaption className="border-t border-white/10 bg-black/30 px-5 py-4 pr-16">
                <p className="line-clamp-2 text-sm font-medium text-white">{preview.name}</p>
                {preview.sku ? <p className="mt-1 font-mono text-xs text-white/60">SKU {preview.sku}</p> : null}
              </figcaption>
            </figure>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export default function Cancelados() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const canApproveReturn = can('return_stock_approve');
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedRange = parseCanceledDateRange(searchParams);
  const [companyId, setCompanyId] = useState('all');
  const [channelCode, setChannelCode] = useState('all');
  const [kind, setKind] = useState<'all' | CancellationKind | 'pending_approval'>('all');
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [page, setPage] = useState(0);
  const [approveOrder, setApproveOrder] = useState<CanceledOrder | null>(null);
  const [approveDecisions, setApproveDecisions] = useState<ReturnLineDecision[]>([]);
  const [approveError, setApproveError] = useState('');
  const [productsOrder, setProductsOrder] = useState<CanceledOrder | null>(null);
  const [imagePreview, setImagePreview] = useState<ProductImagePreview | null>(null);
  const searchTimer = useRef(0);

  const applySearch = (value: string) => {
    setSearch(value);
    window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => {
      setSubmittedSearch(value.trim());
      setPage(0);
    }, SEARCH_DELAY_MS);
  };

  const updateRange = (range: { from: string; to: string }) => {
    setPage(0);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('from', range.from);
      next.set('to', range.to);
      return next;
    });
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
  const filters = useMemo(() => ({
    companyId: companyId === 'all' ? undefined : Number(companyId),
    channelCode: channelCode === 'all' ? undefined : channelCode,
    kind: kind === 'pending_approval' || kind === 'all' ? undefined : kind,
    approval: kind === 'pending_approval' ? 'pending' as const : undefined,
    from: selectedRange.from,
    to: selectedRange.to,
    search: submittedSearch || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  }), [channelCode, companyId, kind, page, selectedRange.from, selectedRange.to, submittedSearch]);
  const ordersQuery = useQuery({
    queryKey: ['canceled-orders', filters],
    queryFn: () => api.listCanceledOrders(filters),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });

  const companies = (Array.isArray(companiesQuery.data) ? companiesQuery.data : []) as Company[];
  const channels = (Array.isArray(channelsQuery.data) ? channelsQuery.data : []) as Channel[];
  const orders = (Array.isArray(ordersQuery.data?.orders) ? ordersQuery.data.orders : []) as CanceledOrder[];
  const totalCount = Number(ordersQuery.data?.totalCount || 0);
  const loading = ordersQuery.isPending && !ordersQuery.data;
  const loadError = (ordersQuery.error as Error | undefined)?.message
    || (companiesQuery.error as Error | undefined)?.message
    || '';
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const selectedSellerName = companyId === 'all'
    ? ''
    : companyName(companies.find((company) => String(company.id) === companyId) || { id: Number(companyId) });
  const channelCatalog = FALLBACK_CHANNELS.map((fallback) => (
    channels.find((channel) => channel.code === fallback.code) || fallback
  ));
  const selectedChannelName = channelCatalog.find((channel) => channel.code === channelCode)?.name || '';
  const hasActiveFilters = companyId !== 'all' || channelCode !== 'all' || kind !== 'all' || Boolean(search.trim());
  const filterTriggerClass = 'h-9 w-auto min-w-[7.25rem] max-w-[11rem] rounded-md border-border bg-background';
  const selectedKindLabel = kind === 'all'
    ? 'Estado'
    : kind === 'pending_approval'
      ? 'Por aprobar'
      : cancellationKindLabel(kind);
  const approveMutation = useMutation({
    mutationFn: ({ orderId, lines }: { orderId: number; lines: ReturnLineDecision[] }) => (
      api.approveReturnStock(orderId, {
        lines: lines.map((line) => ({
          orderItemId: line.orderItemId,
          stockQuantity: line.stockQuantity,
          mermaQuantity: line.mermaQuantity,
        })),
      })
    ),
    onSuccess: async () => {
      setApproveOrder(null);
      setApproveDecisions([]);
      setApproveError('');
      await queryClient.invalidateQueries({ queryKey: ['canceled-orders'] });
    },
    onError: (error) => {
      setApproveError(error instanceof Error ? error.message : 'No se pudo aprobar la devolución.');
    },
  });
  const approveSummary = returnDecisionSummary(approveDecisions);
  const approveItems = productLines(approveOrder?.items);
  const productsViewItems = productLines(productsOrder?.items);

  return (
      <div className="space-y-3">
      <div className="space-y-2">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => applySearch(event.target.value)}
            placeholder="Buscar pedido"
            aria-label="Buscar devoluciones"
            className="h-9 pl-9"
          />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <DocumentDateRangePicker value={selectedRange} onChange={updateRange} />
          <Select value={companyId} onValueChange={(value) => { setCompanyId(value); setPage(0); }}>
            <SelectTrigger className={filterTriggerClass} aria-label="Filtrar por seller">
              <span className="truncate">{companyId === 'all' ? 'Seller' : selectedSellerName}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los sellers</SelectItem>
              {companies.map((company) => (
                <SelectItem key={company.id} value={String(company.id)}>{companyName(company)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={channelCode} onValueChange={(value) => { setChannelCode(value); setPage(0); }}>
            <SelectTrigger className={filterTriggerClass} aria-label="Filtrar por origen">
              <span className="truncate">{channelCode === 'all' ? 'Origen' : selectedChannelName}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los orígenes</SelectItem>
              {channelCatalog.map((channel) => (
                <SelectItem key={channel.code} value={channel.code}>{channel.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={kind} onValueChange={(value) => { setKind(value as typeof kind); setPage(0); }}>
            <SelectTrigger className={filterTriggerClass} aria-label="Filtrar por estado">
              <span className="truncate">{selectedKindLabel}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Canceladas y devueltas</SelectItem>
              <SelectItem value="cancelled">Cancelada</SelectItem>
              <SelectItem value="returned">Devuelta</SelectItem>
              <SelectItem value="pending_approval">Por aprobar</SelectItem>
            </SelectContent>
          </Select>
          {hasActiveFilters && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="h-9 cursor-pointer"
              onClick={() => {
                setCompanyId('all');
                setChannelCode('all');
                setKind('all');
                setSearch('');
                setSubmittedSearch('');
                setPage(0);
              }}
            >
              Limpiar
            </Button>
          )}
        </div>
      </div>

      {loadError && (
        <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {loadError}
        </div>
      )}

      <TablePanel aria-label="Devoluciones">
        {loading && orders.length === 0 ? (
          <p className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Cargando devoluciones…
          </p>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-14 text-center">
            <Ban className="size-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">No hay devoluciones en este rango</p>
            <p className="text-sm text-muted-foreground">Cambia las fechas o espera el próximo sync.</p>
          </div>
        ) : (
          <div className="relative overflow-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Pedido</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead>Cambio</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  {canApproveReturn && <TableHead className="text-right">Aprobar</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => {
                  const kindValue = order.kind || cancellationKind(order);
                  const products = productLines(order.items);
                  const outcome = returnOutcomeLabel(products);
                  return (
                    <TableRow key={order.id}>
                      <TableCell>
                        <div className="flex items-start gap-2">
                          <ChannelMark code={order.channelCode} />
                          <div className="min-w-0 space-y-1">
                            {order.companyName ? (
                              <Badge
                                variant="outline"
                                className="max-w-full truncate rounded-full bg-muted px-2.5 font-medium text-foreground"
                                title={order.companyName}
                              >
                                {order.companyName}
                              </Badge>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => void copyText(order.externalOrderNumber)}
                              className="block font-mono text-xs font-medium text-foreground underline-offset-2 hover:underline"
                              title="Copiar número de pedido"
                            >
                              {order.externalOrderNumber}
                            </button>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="max-w-[280px] space-y-1.5">
                          {products.slice(0, 1).map((item, index) => (
                            <div key={`${item.sku || item.name || 'item'}-${index}`} className="flex items-start gap-2.5">
                              <ProductThumb item={item} onOpen={setImagePreview} />
                              <div className="min-w-0">
                                <p className="line-clamp-2 text-sm leading-5">
                                  {item.name || item.sku || '—'}
                                  {Number(item.quantity) > 1 ? ` ×${Number(item.quantity)}` : ''}
                                </p>
                                {item.sku && item.name ? (
                                  <button
                                    type="button"
                                    onClick={() => void copyText(item.sku || '')}
                                    className="font-mono text-xs text-muted-foreground underline-offset-2 hover:underline"
                                    title="Copiar SKU"
                                  >
                                    {item.sku}
                                  </button>
                                ) : null}
                                {products.length > 1 ? (
                                  <button
                                    type="button"
                                    onClick={() => setProductsOrder(order)}
                                    className="mt-1 block text-xs font-medium text-foreground underline-offset-2 hover:underline"
                                  >
                                    {extraProductsLabel(products.length)}
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatChangedAt(order.changedAt || order.cancelledAt || order.returnedAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className={cn('rounded-full', kindBadgeClass(kindValue))}>
                            {cancellationKindLabel(kindValue)}
                          </Badge>
                          {order.stockApproval === 'pending' && (
                            <Badge variant="outline" className="rounded-full border-amber-300 bg-amber-50 text-amber-800">
                              {stockApprovalLabel(order.stockApproval)}
                            </Badge>
                          )}
                          {order.stockApproval !== 'pending' && outcome && (
                            <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-100 text-slate-700">
                              {outcome}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium">{money(order.total, order.currency)}</TableCell>
                      {canApproveReturn && (
                        <TableCell className="text-right">
                          {order.stockApproval === 'pending' ? (
                            <Button
                              type="button"
                              size="sm"
                              className="h-7 px-2.5"
                              onClick={() => {
                                setApproveError('');
                                setApproveDecisions(pendingReturnDecisions(order));
                                setApproveOrder(order);
                              }}
                            >
                              Aprobar
                            </Button>
                          ) : null}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        {totalCount > 0 && (
          <TablePanelFooter className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {totalCount} pedido{totalCount === 1 ? '' : 's'}
            </p>
            {pageCount > 1 && (
              <Pagination className="mx-0 w-auto justify-end">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      href="#"
                      onClick={(event) => {
                        event.preventDefault();
                        setPage((current) => Math.max(0, current - 1));
                      }}
                      aria-disabled={page === 0}
                      className={page === 0 ? 'pointer-events-none opacity-50' : undefined}
                    />
                  </PaginationItem>
                  <PaginationItem>
                    <span className="px-2 text-sm text-muted-foreground">{page + 1} / {pageCount}</span>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationNext
                      href="#"
                      onClick={(event) => {
                        event.preventDefault();
                        setPage((current) => Math.min(pageCount - 1, current + 1));
                      }}
                      aria-disabled={page + 1 >= pageCount}
                      className={page + 1 >= pageCount ? 'pointer-events-none opacity-50' : undefined}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            )}
          </TablePanelFooter>
        )}
      </TablePanel>

      <Dialog open={Boolean(productsOrder)} onOpenChange={(open) => { if (!open && !imagePreview) setProductsOrder(null); }}>
        <DialogContent
          className="sm:max-w-lg"
          onPointerDownOutside={(event) => keepWhenStackedDialog(event, Boolean(imagePreview))}
          onFocusOutside={(event) => keepWhenStackedDialog(event, Boolean(imagePreview))}
          onInteractOutside={(event) => keepWhenStackedDialog(event, Boolean(imagePreview))}
          onEscapeKeyDown={(event) => { if (imagePreview) event.preventDefault(); }}
        >
          <DialogHeader>
            <DialogTitle>Productos del pedido</DialogTitle>
            <DialogDescription>
              {productsOrder?.externalOrderNumber}
              {productsOrder?.companyName ? ` · ${productsOrder.companyName}` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {productsViewItems.map((item, index) => (
              <div key={`${item.sku || item.name || 'item'}-${index}`} className="flex items-start gap-3">
                <ProductThumb item={item} onOpen={setImagePreview} />
                <div className="min-w-0">
                  <p className="text-sm leading-5">{item.name || item.sku || '—'}</p>
                  {item.sku ? <p className="font-mono text-xs text-muted-foreground">{item.sku}</p> : null}
                  {Number(item.quantity) > 0 ? <p className="text-xs text-muted-foreground">{Number(item.quantity)} u</p> : null}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(approveOrder)} onOpenChange={(open) => { if (!open && !approveMutation.isPending && !imagePreview) { setApproveOrder(null); setApproveDecisions([]); } }}>
        <DialogContent
          className="sm:max-w-2xl"
          onPointerDownOutside={(event) => keepWhenStackedDialog(event, Boolean(imagePreview))}
          onFocusOutside={(event) => keepWhenStackedDialog(event, Boolean(imagePreview))}
          onInteractOutside={(event) => keepWhenStackedDialog(event, Boolean(imagePreview))}
          onEscapeKeyDown={(event) => { if (imagePreview) event.preventDefault(); }}
        >
          <DialogHeader>
            <DialogTitle>Revisar devolución</DialogTitle>
            <DialogDescription>
              Marca stock o merma en cada unidad.
            </DialogDescription>
          </DialogHeader>
          {approveDecisions.length > 1 || approveDecisions.some((line) => line.quantity > 1) ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="xs"
                variant="outline"
                className="border-emerald-200 text-emerald-800 hover:bg-emerald-50"
                disabled={approveMutation.isPending}
                onClick={() => setApproveDecisions((current) => current.map((line) => setReturnLineStock(line, line.quantity)))}
              >
                Todo a stock
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                className="border-rose-200 text-rose-800 hover:bg-rose-50"
                disabled={approveMutation.isPending}
                onClick={() => setApproveDecisions((current) => current.map((line) => setReturnLineStock(line, 0)))}
              >
                Todo a merma
              </Button>
            </div>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">Producto</th>
                  <th className="pb-2 pl-5 font-medium">Unidad</th>
                  <th className="pb-2 font-medium">Destino</th>
                </tr>
              </thead>
              <tbody>
                {approveDecisions.flatMap((line) => {
                  const item = approveItems.find((row) => Number(row.orderItemId) === line.orderItemId) || {
                    name: null,
                    sku: null,
                    quantity: line.quantity,
                  };
                  const units = returnUnits(line);
                  return units.map((destination, unitIndex) => (
                    <tr
                      key={`${line.orderItemId}-${unitIndex}`}
                      className={cn(
                        'align-middle',
                        unitIndex === 0 ? 'border-t border-border' : null,
                      )}
                    >
                      {unitIndex === 0 ? (
                        <td rowSpan={Math.max(1, line.quantity)} className="py-2.5 pr-3 align-top">
                          <div className="flex items-start gap-2.5">
                            <ProductThumb item={item} onOpen={setImagePreview} />
                            <div className="min-w-0">
                              <p className="line-clamp-2 text-sm leading-5">{item.name || item.sku || '—'}</p>
                              {item.sku ? (
                                <p className="font-mono text-xs text-muted-foreground">{item.sku}</p>
                              ) : null}
                            </div>
                          </div>
                        </td>
                      ) : null}
                      <td className="py-2 pl-5 font-mono text-xs text-muted-foreground">
                        {returnUnitLabel(unitIndex, line.quantity)}
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-1.5">
                          <DestinationChoice
                            destination="stock"
                            selected={destination === 'stock'}
                            disabled={approveMutation.isPending}
                            onSelect={() => setApproveDecisions((current) => current.map((row) => (
                              row.orderItemId === line.orderItemId ? setReturnUnit(row, unitIndex, 'stock') : row
                            )))}
                          />
                          <DestinationChoice
                            destination="merma"
                            selected={destination === 'merma'}
                            disabled={approveMutation.isPending}
                            onSelect={() => setApproveDecisions((current) => current.map((row) => (
                              row.orderItemId === line.orderItemId ? setReturnUnit(row, unitIndex, 'merma') : row
                            )))}
                          />
                        </div>
                      </td>
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted-foreground">{returnDecisionHelper(approveSummary)}</p>
          {approveError && (
            <p className="text-sm text-rose-700">{approveError}</p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={approveMutation.isPending}
              onClick={() => { setApproveOrder(null); setApproveDecisions([]); }}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={!approveOrder || approveMutation.isPending || (approveDecisions.length > 0 && !approveSummary.balanced)}
              onClick={() => approveOrder && approveMutation.mutate({ orderId: approveOrder.id, lines: approveDecisions })}
            >
              {approveMutation.isPending ? <Loader2 className="animate-spin" /> : null}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ProductImageDialog preview={imagePreview} onClose={() => setImagePreview(null)} />
      </div>
  );
}
