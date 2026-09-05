import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Loader2, Search } from 'lucide-react';
import falabellaLogo from '../assets/falabella.png';
import ripleyLogo from '../assets/logo-blanco.svg';
import api from '../lib/api';
import { copyText } from '../lib/clipboard';
import { cn } from '../lib/cn';
import { usePermissions } from '../hooks/usePermissions';
import {
  cancellationKind,
  cancellationKindLabel,
  creditNoteAction,
  documentTag,
  parseCanceledDateRange,
  stockApprovalLabel,
  type CancellationKind,
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';

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
  }>;
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

const mutedTagClass = 'rounded-full bg-muted px-2.5 font-medium text-muted-foreground';

function HoverNumber({
  number,
  label,
  children,
}: {
  number?: string | null;
  label: string;
  children: ReactNode;
}) {
  const value = String(number || '').trim();
  if (!value) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="cursor-help rounded-full" aria-label={`${label} ${value}`}>
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{value}</TooltipContent>
    </Tooltip>
  );
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
  if (lines.length === 0) return [{ name: null, sku: null, quantity: 0 }];
  return lines;
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
  const [approveError, setApproveError] = useState('');
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
    mutationFn: (orderId: number) => api.approveReturnStock(orderId),
    onSuccess: async () => {
      setApproveOrder(null);
      setApproveError('');
      await queryClient.invalidateQueries({ queryKey: ['canceled-orders'] });
    },
    onError: (error) => {
      setApproveError(error instanceof Error ? error.message : 'No se pudo aprobar la devolución.');
    },
  });

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-3">
      <div className="space-y-2">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => applySearch(event.target.value)}
            placeholder="Buscar pedido o comprobante"
            aria-label="Buscar cancelados"
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

      <TablePanel aria-label="Pedidos cancelados y devueltos">
        {loading && orders.length === 0 ? (
          <p className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Cargando cancelados…
          </p>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-14 text-center">
            <Ban className="size-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">No hay pedidos cancelados o devueltos en este rango</p>
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
                  <TableHead>Seller</TableHead>
                  <TableHead>Comprobante</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  {canApproveReturn && <TableHead className="text-right">Aprobar</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => {
                  const kindValue = order.kind || cancellationKind(order);
                  const note = creditNoteAction(order);
                  const document = documentTag(order.documentKind, order.documentNumber);
                  const products = productLines(order.items);
                  return (
                    <TableRow key={order.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <ChannelMark code={order.channelCode} />
                          <button
                            type="button"
                            onClick={() => void copyText(order.externalOrderNumber)}
                            className="font-mono text-xs font-medium text-foreground underline-offset-2 hover:underline"
                            title="Copiar número de pedido"
                          >
                            {order.externalOrderNumber}
                          </button>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="max-w-[220px] space-y-1.5">
                          {products.map((item, index) => (
                            <div key={`${item.sku || item.name || 'item'}-${index}`}>
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
                        </div>
                      </TableCell>
                      <TableCell>
                        {order.companyName ? (
                          <Badge
                            variant="outline"
                            className="max-w-full truncate rounded-md bg-muted/45 px-2 py-0.5 font-medium text-foreground"
                            title={order.companyName}
                          >
                            {order.companyName}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {document ? (
                            <HoverNumber number={document.number} label={document.label}>
                              <Badge variant="outline" className={mutedTagClass}>{document.label}</Badge>
                            </HoverNumber>
                          ) : null}
                          <HoverNumber number={note.number} label="Nota de crédito">
                            <Badge variant="outline" className={mutedTagClass}>{note.label}</Badge>
                          </HoverNumber>
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

      <Dialog open={Boolean(approveOrder)} onOpenChange={(open) => { if (!open && !approveMutation.isPending) setApproveOrder(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aprobar devolución</DialogTitle>
            <DialogDescription>
              El pedido {approveOrder?.externalOrderNumber} pasa al stock que se puede vender.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1 text-sm">
            {productLines(approveOrder?.items).map((item, index) => (
              <p key={`${item.sku || item.name || 'item'}-${index}`}>
                {item.name || item.sku || '—'}
                {item.sku && item.name ? ` · ${item.sku}` : ''}
                {Number(item.quantity) > 0 ? ` · ${Number(item.quantity)} u` : ''}
              </p>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            {Number(approveOrder?.pendingReturnQuantity) === 1
              ? '1 unidad deja de estar por aprobar.'
              : Number(approveOrder?.pendingReturnQuantity) > 1
                ? `${approveOrder?.pendingReturnQuantity} unidades dejan de estar por aprobar.`
                : 'Las unidades dejan de estar por aprobar.'}
          </p>
          {approveError && (
            <p className="text-sm text-rose-700">{approveError}</p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={approveMutation.isPending}
              onClick={() => setApproveOrder(null)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={!approveOrder || approveMutation.isPending}
              onClick={() => approveOrder && approveMutation.mutate(approveOrder.id)}
            >
              {approveMutation.isPending ? <Loader2 className="animate-spin" /> : null}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </TooltipProvider>
  );
}
