import { FormEvent, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { flexRender, getCoreRowModel, type ColumnDef, useReactTable } from '@tanstack/react-table';
import { AlertCircle, ChevronLeft, ChevronRight, Loader2, PackageSearch, Plus, Search } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatAttentionDeadline, formatAttentionIngress } from '@/lib/order-attention-presentation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TablePanel,
  TablePanelFooter,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const PAGE_SIZE = 50;

type Company = { id: number; nombre?: string | null; nombreComercial?: string | null; razonSocial?: string | null };
type Channel = { code: string; name: string };
type ManagedOrder = {
  id: number;
  companyId: number | null;
  channelCode: string;
  channelName: string;
  channelAccountName: string;
  companyName: string;
  externalOrderId: string;
  externalOrderNumber: string;
  orderStatus: string;
  fulfillmentStatus: string;
  providerStatus: string | null;
  currency: string;
  total: number | null;
  customer: { name?: string; documentNumber?: string; phone?: string };
  shipping: { address?: string; district?: string; trackingCode?: string };
  orderedAt: string | null;
  promisedShippingAt: string | null;
  problem: string | null;
};

type OrderItem = {
  id: number;
  sku?: string | null;
  providerSku?: string | null;
  description: string;
  quantity: number;
  total?: number | null;
};

type OrderDetail = ManagedOrder & { items: OrderItem[] };

const FULFILLMENT_LABELS: Record<string, string> = {
  unmapped: 'Sin mapear',
  pending: 'Pendiente',
  preparing: 'Preparando',
  ready_to_ship: 'Listo para enviar',
  shipped: 'Enviado',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
  returned: 'Devuelto',
  failed: 'Fallido',
};

function companyLabel(company: Company) {
  return String(company.nombreComercial || company.nombre || company.razonSocial || `Tienda ${company.id}`);
}

function money(value: number | null, currency: string) {
  if (value === null) return '—';
  try { return new Intl.NumberFormat('es-PE', { style: 'currency', currency: currency || 'PEN' }).format(value); }
  catch { return `${currency || 'PEN'} ${value.toFixed(2)}`; }
}

function StatusBadge({ status }: { status: string }) {
  const classes = status === 'delivered' || status === 'shipped'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : status === 'pending'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : status === 'ready_to_ship' || status === 'preparing'
        ? 'border-sky-200 bg-sky-50 text-sky-700'
        : status === 'cancelled' || status === 'returned' || status === 'failed' || status === 'unmapped'
          ? 'border-rose-200 bg-rose-50 text-rose-700'
          : 'border-border bg-muted text-muted-foreground';
  return <Badge variant="outline" className={cn('rounded-md', classes)}>{FULFILLMENT_LABELS[status] || status}</Badge>;
}

function ChannelBadge({ code, name }: { code: string; name: string }) {
  const classes = code === 'falabella'
    ? 'border-orange-200 bg-orange-50 text-orange-800'
    : code === 'ripley'
      ? 'border-violet-200 bg-violet-50 text-violet-800'
      : 'border-slate-200 bg-slate-50 text-slate-700';
  return <Badge variant="outline" className={cn('rounded-md text-[10px]', classes)}>{name || code}</Badge>;
}

function Deadline({ value }: { value: string | null }) {
  const deadline = formatAttentionDeadline(value);
  const classes = deadline.tone === 'danger'
    ? 'bg-rose-100 text-rose-700'
    : deadline.tone === 'warning'
      ? 'bg-amber-100 text-amber-800'
      : deadline.tone === 'info'
        ? 'bg-sky-100 text-sky-700'
        : 'bg-muted text-muted-foreground';
  return <span className={cn('inline-flex whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-medium', classes)}>{deadline.label}</span>;
}

export default function TodosPedidos() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialSearch = searchParams.get('search') || '';
  const initialProblem = searchParams.get('problem') === 'true' ? 'problems' : 'all';
  const [search, setSearch] = useState(initialSearch);
  const [submittedSearch, setSubmittedSearch] = useState(initialSearch);
  const [companyId, setCompanyId] = useState('all');
  const [channelCode, setChannelCode] = useState('all');
  const [fulfillmentStatus, setFulfillmentStatus] = useState('all');
  const [problem, setProblem] = useState(initialProblem);
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const filters = useMemo(() => ({
    companyId: companyId === 'all' ? undefined : Number(companyId),
    channelCode: channelCode === 'all' ? undefined : channelCode,
    fulfillmentStatus: fulfillmentStatus === 'all' ? undefined : fulfillmentStatus,
    problem: problem === 'problems' ? true : undefined,
    search: submittedSearch || undefined,
    limit: PAGE_SIZE,
    offset: pageIndex * PAGE_SIZE,
  }), [channelCode, companyId, fulfillmentStatus, pageIndex, problem, submittedSearch]);
  const ordersQuery = useQuery({
    queryKey: ['managed-orders', 'history', filters],
    queryFn: () => api.listManagedOrders(filters),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
  const companiesQuery = useQuery({ queryKey: ['order-companies'], queryFn: () => api.listCompanies(), staleTime: 5 * 60_000 });
  const channelsQuery = useQuery({ queryKey: ['order-channels'], queryFn: () => api.listOrderChannels(), staleTime: 5 * 60_000 });
  const detailQuery = useQuery({
    queryKey: ['managed-order-detail', selectedId],
    queryFn: () => api.getManagedOrder(Number(selectedId)) as Promise<OrderDetail>,
    enabled: selectedId !== null,
  });

  const orders = (Array.isArray(ordersQuery.data?.orders) ? ordersQuery.data.orders : []) as ManagedOrder[];
  const totalCount = Number(ordersQuery.data?.totalCount || 0);
  const companies = (Array.isArray(companiesQuery.data) ? companiesQuery.data : []) as Company[];
  const channels = (Array.isArray(channelsQuery.data) ? channelsQuery.data : []) as Channel[];
  const canNext = (pageIndex + 1) * PAGE_SIZE < totalCount;

  const resetPage = () => setPageIndex(0);
  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setSubmittedSearch(search.trim());
    resetPage();
  };
  const clearFilters = () => {
    setSearch('');
    setSubmittedSearch('');
    setCompanyId('all');
    setChannelCode('all');
    setFulfillmentStatus('all');
    setProblem('all');
    resetPage();
  };

  const columns = useMemo<ColumnDef<ManagedOrder>[]>(() => [
    {
      id: 'order',
      header: 'Pedido',
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate font-mono text-xs font-semibold">{row.original.externalOrderNumber}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.original.customer?.name || 'Cliente no informado'}</p>
        </div>
      ),
    },
    {
      id: 'ingress',
      header: 'Ingresó',
      cell: ({ row }) => {
        const ingress = formatAttentionIngress(row.original.orderedAt);
        return <div className="whitespace-nowrap text-xs"><p className="font-medium">{ingress.relative}</p><p className="text-muted-foreground">{ingress.exact}</p></div>;
      },
    },
    {
      id: 'delivery',
      header: 'Entrega',
      cell: ({ row }) => <Deadline value={row.original.promisedShippingAt} />,
    },
    {
      id: 'seller',
      header: 'Tienda',
      cell: ({ row }) => (
        <div className="min-w-0"><p className="max-w-40 truncate text-xs font-medium" title={row.original.companyName}>{row.original.companyName || 'Sin tienda'}</p><div className="mt-1"><ChannelBadge code={row.original.channelCode} name={row.original.channelName} /></div></div>
      ),
    },
    {
      id: 'status',
      header: 'Estado',
      cell: ({ row }) => <div className="flex flex-wrap items-center gap-1.5"><StatusBadge status={row.original.fulfillmentStatus} />{row.original.problem && <Tooltip><TooltipTrigger asChild><Badge variant="outline" className="cursor-help rounded-md border-rose-200 bg-rose-50 text-rose-700"><AlertCircle /> Con problemas</Badge></TooltipTrigger><TooltipContent className="max-w-72">{row.original.problem}</TooltipContent></Tooltip>}</div>,
    },
    {
      id: 'total',
      header: () => <span className="block text-right">Total</span>,
      cell: ({ row }) => <span className="block whitespace-nowrap text-right text-xs font-semibold tabular-nums">{money(row.original.total, row.original.currency)}</span>,
    },
    {
      id: 'action',
      header: '',
      cell: ({ row }) => {
        const actionable = !row.original.problem && ['pending', 'ready_to_ship'].includes(row.original.fulfillmentStatus);
        return (
          <div onClick={(event) => event.stopPropagation()}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => actionable
                ? navigate(`/pedidos?search=${encodeURIComponent(row.original.externalOrderNumber)}`)
                : setSelectedId(row.original.id)}
            >
              {actionable ? 'Atender' : 'Ver'} <ChevronRight />
            </Button>
          </div>
        );
      },
    },
  ], [navigate]);
  const table = useReactTable({ data: orders, columns, getCoreRowModel: getCoreRowModel(), getRowId: (order) => String(order.id) });
  const hasFilters = Boolean(submittedSearch || companyId !== 'all' || channelCode !== 'all' || fulfillmentStatus !== 'all' || problem !== 'all');
  const detail = detailQuery.data;

  return (
    <div className="space-y-4">
      <form onSubmit={submitSearch} className="flex flex-col gap-2 xl:flex-row xl:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar pedido, cliente, SKU o producto" className="h-9 pl-9" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={channelCode} onValueChange={(value) => { setChannelCode(value); resetPage(); }}>
            <SelectTrigger className="h-9 w-40"><SelectValue placeholder="Marketplace" /></SelectTrigger>
            <SelectContent><SelectItem value="all">Todos los canales</SelectItem>{channels.map((channel) => <SelectItem key={channel.code} value={channel.code}>{channel.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={companyId} onValueChange={(value) => { setCompanyId(value); resetPage(); }}>
            <SelectTrigger className="h-9 w-44"><SelectValue placeholder="Tienda" /></SelectTrigger>
            <SelectContent><SelectItem value="all">Todas las tiendas</SelectItem>{companies.map((company) => <SelectItem key={company.id} value={String(company.id)}>{companyLabel(company)}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={fulfillmentStatus} onValueChange={(value) => { setFulfillmentStatus(value); resetPage(); }}>
            <SelectTrigger className="h-9 w-44"><SelectValue placeholder="Estado" /></SelectTrigger>
            <SelectContent><SelectItem value="all">Todos los estados</SelectItem>{Object.entries(FULFILLMENT_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={problem} onValueChange={(value) => { setProblem(value); resetPage(); }}>
            <SelectTrigger className="h-9 w-40"><SelectValue placeholder="Problemas" /></SelectTrigger>
            <SelectContent><SelectItem value="all">Todos</SelectItem><SelectItem value="problems">Con problemas</SelectItem></SelectContent>
          </Select>
          <Button type="submit" variant="outline" size="sm" className="h-9">Buscar</Button>
          {hasFilters && <Button type="button" variant="ghost" size="sm" className="h-9" onClick={clearFilters}>Limpiar</Button>}
          <Button type="button" size="sm" className="h-9" onClick={() => navigate('/orders/nueva')}><Plus /> Registrar venta</Button>
        </div>
      </form>

      {ordersQuery.error && <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{(ordersQuery.error as Error).message}</div>}

      <TablePanel>
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>{headerGroup.headers.map((header) => <TableHead key={header.id}>{header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}</TableHead>)}</TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {ordersQuery.isPending && !ordersQuery.data ? (
              <TableRow><TableCell colSpan={columns.length}><div className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-5 animate-spin" /> Cargando pedidos…</div></TableCell></TableRow>
            ) : table.getRowModel().rows.length ? table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} className="cursor-pointer" onClick={() => setSelectedId(row.original.id)}>
                {row.getVisibleCells().map((cell) => <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}
              </TableRow>
            )) : (
              <TableRow><TableCell colSpan={columns.length}><div className="grid min-h-64 place-items-center text-center"><div><PackageSearch className="mx-auto size-8 text-muted-foreground/40" /><p className="mt-2 text-sm font-medium">No hay pedidos con estos filtros</p><p className="mt-1 text-sm text-muted-foreground">Prueba otra búsqueda o limpia los filtros.</p></div></div></TableCell></TableRow>
            )}
          </TableBody>
        </Table>
        <TablePanelFooter>
          <p className="text-sm text-muted-foreground">{totalCount ? `${pageIndex * PAGE_SIZE + 1}–${Math.min((pageIndex + 1) * PAGE_SIZE, totalCount)} de ${totalCount} pedidos` : '0 pedidos'}</p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon-sm" disabled={pageIndex === 0} onClick={() => setPageIndex((current) => Math.max(0, current - 1))} aria-label="Página anterior"><ChevronLeft /></Button>
            <span className="text-xs font-medium tabular-nums">Página {pageIndex + 1}</span>
            <Button variant="outline" size="icon-sm" disabled={!canNext} onClick={() => setPageIndex((current) => current + 1)} aria-label="Página siguiente"><ChevronRight /></Button>
          </div>
        </TablePanelFooter>
      </TablePanel>

      <Sheet open={selectedId !== null} onOpenChange={(open) => { if (!open) setSelectedId(null); }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{detail?.externalOrderNumber || 'Detalle del pedido'}</SheetTitle>
            <SheetDescription>{detail ? `${detail.channelName} · ${detail.companyName}` : 'Cargando información…'}</SheetDescription>
          </SheetHeader>
          {detailQuery.isPending ? (
            <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-5 animate-spin" /> Cargando detalle…</div>
          ) : detail ? (
            <div className="space-y-5 px-4 pb-6">
              <div className="flex flex-wrap items-center gap-2"><StatusBadge status={detail.fulfillmentStatus} /><ChannelBadge code={detail.channelCode} name={detail.channelName} />{detail.problem && <Tooltip><TooltipTrigger asChild><Badge variant="outline" className="cursor-help border-rose-200 bg-rose-50 text-rose-700"><AlertCircle /> Con problemas</Badge></TooltipTrigger><TooltipContent className="max-w-72">{detail.problem}</TooltipContent></Tooltip>}</div>
              {detail.problem && <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"><p className="font-medium">Requiere revisión</p><p className="mt-1">{detail.problem}</p></div>}
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-xs text-muted-foreground">Cliente</dt><dd className="mt-1 font-medium">{detail.customer?.name || 'No informado'}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Total</dt><dd className="mt-1 font-medium">{money(detail.total, detail.currency)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Ingresó</dt><dd className="mt-1">{formatAttentionIngress(detail.orderedAt).exact}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Entrega</dt><dd className="mt-1"><Deadline value={detail.promisedShippingAt} /></dd></div>
              </dl>
              <section>
                <h3 className="text-sm font-semibold">Productos</h3>
                <div className="mt-2 divide-y divide-border rounded-md border border-border">
                  {(detail.items || []).map((item) => <div key={item.id} className="flex items-start justify-between gap-3 px-3 py-3 text-sm"><div className="min-w-0"><p className="line-clamp-2 font-medium">{item.description || 'Producto sin nombre'}</p><p className="mt-1 font-mono text-xs text-muted-foreground">{item.sku || item.providerSku || 'Sin SKU'}</p></div><span className="shrink-0 font-semibold">×{item.quantity}</span></div>)}
                  {!detail.items?.length && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Sin productos informados.</p>}
                </div>
              </section>
              {!detail.problem && ['pending', 'ready_to_ship'].includes(detail.fulfillmentStatus) && (
                <Button className="w-full" onClick={() => navigate(`/pedidos?search=${encodeURIComponent(detail.externalOrderNumber)}`)}>Atender pedido <ChevronRight /></Button>
              )}
            </div>
          ) : detailQuery.error ? <p className="px-4 text-sm text-rose-700">{(detailQuery.error as Error).message}</p> : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
