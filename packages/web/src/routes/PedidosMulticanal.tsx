import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  Loader2,
  PackageCheck,
  RefreshCw,
  Search,
  Store,
  Truck,
} from 'lucide-react';
import api from '../lib/api';
import { cn } from '../lib/cn';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
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
  customer?: { name?: string; documentNumber?: string };
  shipping?: { type?: string; trackingCode?: string };
  orderedAt?: string | null;
  promisedShippingAt?: string | null;
  providerUpdatedAt?: string | null;
};

type OrderDetail = ManagedOrder & {
  items: Array<{
    id: number;
    sku?: string | null;
    description: string;
    quantity: number;
    total?: number | null;
  }>;
  events: Array<{
    id: number;
    eventType: string;
    source: string;
    newValues?: Record<string, unknown>;
    providerOccurredAt?: string | null;
    createdAt: string;
  }>;
  documents: Array<{
    id: number;
    kind: string;
    number?: string | null;
    status?: string | null;
  }>;
};

const PAGE_SIZE = 25;

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

function companyName(company: Company) {
  return company.nombre || company.nombreComercial || company.razonSocial || `Empresa ${company.id}`;
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
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
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
  return (
    <Badge variant="outline" className={cn('rounded-md', classes)}>
      {DOCUMENT_LABELS[status] || status}{type}
    </Badge>
  );
}

function policyLabel(account: ChannelAccount) {
  if (account.documentRequirement === 'disabled') return 'Sin comprobante';
  const requirement = account.documentRequirement === 'required' ? 'Obligatorio' : 'Opcional';
  const type = account.documentTypePolicy === 'customer_choice'
    ? 'elección'
    : account.documentTypePolicy === 'automatic'
      ? 'automático'
      : account.documentTypePolicy;
  return `${requirement} · ${type}`;
}

export default function PedidosMulticanal() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [accounts, setAccounts] = useState<ChannelAccount[]>([]);
  const [orders, setOrders] = useState<ManagedOrder[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [companyId, setCompanyId] = useState('all');
  const [channelCode, setChannelCode] = useState('all');
  const [fulfillmentStatus, setFulfillmentStatus] = useState('all');
  const [documentStatus, setDocumentStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    Promise.all([
      api.listCompanies(),
      api.listOrderChannels(),
      api.listOrderChannelAccounts({ active: true }),
    ]).then(([companyRows, channelRows, accountRows]) => {
      setCompanies(Array.isArray(companyRows) ? companyRows : []);
      setChannels(Array.isArray(channelRows) ? channelRows : []);
      setAccounts(Array.isArray(accountRows) ? accountRows : []);
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
        documentStatus: documentStatus === 'all' ? undefined : documentStatus,
        search: search.trim() || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      });
      if (requestId !== requestRef.current) return;
      setOrders(Array.isArray(result?.orders) ? result.orders : []);
      setTotalCount(Number(result?.totalCount || 0));
    } catch (error: any) {
      if (requestId !== requestRef.current) return;
      setOrders([]);
      setTotalCount(0);
      setLoadError(error?.message || 'No se pudieron cargar los pedidos.');
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [channelCode, companyId, documentStatus, fulfillmentStatus, page, search]);

  useEffect(() => {
    const timer = window.setTimeout(load, search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search]);

  useEffect(() => {
    setPage(1);
  }, [companyId, channelCode, fulfillmentStatus, documentStatus]);

  const filteredAccounts = useMemo(() => accounts.filter((account) => (
    (companyId === 'all' || account.companyId === Number(companyId))
    && (channelCode === 'all' || account.channelCode === channelCode)
  )), [accounts, channelCode, companyId]);

  const companyById = useMemo(
    () => new Map(companies.map((company) => [company.id, companyName(company)])),
    [companies],
  );

  const pageAmount = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const pendingDocuments = orders.filter((order) => (
    order.documentRequirement !== 'disabled' && order.documentStatus === 'pending'
  )).length;
  const activeOrders = orders.filter((order) => (
    !['delivered', 'cancelled', 'returned', 'failed'].includes(order.fulfillmentStatus)
  )).length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const openDetail = async (order: ManagedOrder) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    try {
      setDetail(await api.getManagedOrder(order.id));
    } catch (error: any) {
      setLoadError(error?.message || 'No se pudo abrir el pedido.');
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Store} label="Pedidos encontrados" value={String(totalCount)} hint="Todos los canales filtrados" />
        <MetricCard icon={Truck} label="En operación" value={String(activeOrders)} hint="En esta página" tone="sky" />
        <MetricCard icon={FileText} label="Por emitir" value={String(pendingDocuments)} hint="Comprobantes de esta página" tone="amber" />
        <MetricCard icon={PackageCheck} label="Monto visible" value={formatMoney(pageAmount)} hint={`Página ${page} de ${totalPages}`} tone="emerald" />
      </section>

      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="font-medium text-foreground">Canales configurados</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              La creación automática y el comprobante se definen por cuenta de canal.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {filteredAccounts.length ? filteredAccounts.map((account) => (
              <div key={account.id} className="rounded-xl border border-border bg-muted/30 px-3 py-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span>{account.channelName}</span>
                  {account.autoCreateOrders && <Badge variant="secondary">Automático</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{account.displayName} · {policyLabel(account)}</p>
              </div>
            )) : (
              <p className="text-sm text-muted-foreground">No hay cuentas para estos filtros.</p>
            )}
          </div>
        </div>
      </section>

      <TablePanel>
        <TablePanelHeader>
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="font-medium text-foreground">Todos los pedidos</h2>
              <p className="mt-1 text-sm text-muted-foreground">Una identidad y un timeline por pedido, sin importar su origen.</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <div className="relative min-w-56 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                  placeholder="Pedido o cliente"
                  className="pl-9"
                />
              </div>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="Empresa" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las empresas</SelectItem>
                  {companies.map((company) => <SelectItem key={company.id} value={String(company.id)}>{companyName(company)}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={channelCode} onValueChange={setChannelCode}>
                <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder="Canal" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los canales</SelectItem>
                  {channels.filter((channel) => channel.active).map((channel) => (
                    <SelectItem key={channel.code} value={channel.code}>{channel.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={fulfillmentStatus} onValueChange={setFulfillmentStatus}>
                <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="Despacho" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los despachos</SelectItem>
                  {Object.entries(FULFILLMENT_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={documentStatus} onValueChange={setDocumentStatus}>
                <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder="Comprobante" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Comprobante</SelectItem>
                  {Object.entries(DOCUMENT_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="outline" size="icon" onClick={load} disabled={loading} aria-label="Actualizar pedidos">
                <RefreshCw className={cn(loading && 'animate-spin')} />
              </Button>
            </div>
          </div>
        </TablePanelHeader>

        {loadError && (
          <div className="flex items-center gap-2 border-b border-rose-200 bg-rose-50 px-5 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
            <AlertCircle className="size-4 shrink-0" /> {loadError}
          </div>
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pedido</TableHead>
              <TableHead>Canal</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Despacho</TableHead>
              <TableHead>Comprobante</TableHead>
              <TableHead>Fecha</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <div className="flex h-36 items-center justify-center gap-2 text-muted-foreground">
                    <Loader2 className="size-5 animate-spin" /> Cargando pedidos…
                  </div>
                </TableCell>
              </TableRow>
            ) : orders.length ? orders.map((order) => (
              <TableRow
                key={order.id}
                className="cursor-pointer"
                onClick={() => openDetail(order)}
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') openDetail(order);
                }}
              >
                <TableCell>
                  <div className="font-medium text-foreground">{order.externalOrderNumber}</div>
                  <div className="text-xs text-muted-foreground">{companyById.get(order.companyId) || `Empresa ${order.companyId}`}</div>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" className="rounded-md">{order.channelName}</Badge>
                  <div className="mt-1 text-xs text-muted-foreground">{order.channelAccountName}</div>
                </TableCell>
                <TableCell>
                  <div className="max-w-48 truncate">{order.customer?.name || 'Sin nombre'}</div>
                  {order.customer?.documentNumber && <div className="text-xs text-muted-foreground">{order.customer.documentNumber}</div>}
                </TableCell>
                <TableCell>{fulfillmentBadge(order.fulfillmentStatus)}</TableCell>
                <TableCell>{documentBadge(order)}</TableCell>
                <TableCell>
                  <div>{formatDate(order.orderedAt)}</div>
                  {order.promisedShippingAt && <div className="mt-1 text-xs text-muted-foreground">Entrega: {formatDate(order.promisedShippingAt)}</div>}
                </TableCell>
                <TableCell className="text-right font-medium">{formatMoney(order.total, order.currency)}</TableCell>
              </TableRow>
            )) : (
              <TableRow>
                <TableCell colSpan={7}>
                  <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
                    <Store className="size-7 text-muted-foreground/60" />
                    <p className="font-medium">No hay pedidos para estos filtros</p>
                    <p className="text-sm text-muted-foreground">Falabella los agregará automáticamente en la próxima sincronización.</p>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <TablePanelFooter>
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              {totalCount ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, totalCount)} de ${totalCount}` : '0 pedidos'}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}>
                <ChevronLeft /> Anterior
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage((current) => current + 1)}>
                Siguiente <ChevronRight />
              </Button>
            </div>
          </div>
        </TablePanelFooter>
      </TablePanel>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
          {detailLoading ? (
            <div className="flex h-56 items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" /> Cargando detalle…
            </div>
          ) : detail ? (
            <>
              <DialogHeader>
                <DialogTitle>Pedido {detail.externalOrderNumber}</DialogTitle>
                <DialogDescription>
                  {detail.channelName} · {detail.channelAccountName} · {companyById.get(detail.companyId)}
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-3 sm:grid-cols-3">
                <DetailStat label="Despacho" content={fulfillmentBadge(detail.fulfillmentStatus)} />
                <DetailStat label="Comprobante" content={documentBadge(detail)} />
                <DetailStat label="Total" content={<span className="font-semibold">{formatMoney(detail.total, detail.currency)}</span>} />
              </div>

              <section>
                <h3 className="mb-3 font-medium">Productos</h3>
                <div className="divide-y divide-border rounded-xl border border-border">
                  {detail.items.length ? detail.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-4 px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{item.description || item.sku || 'Producto'}</p>
                        <p className="text-xs text-muted-foreground">{item.sku || 'Sin SKU'} · Cant. {item.quantity}</p>
                      </div>
                      <span className="shrink-0">{formatMoney(item.total, detail.currency)}</span>
                    </div>
                  )) : <p className="px-4 py-5 text-sm text-muted-foreground">El canal todavía no informó el detalle de productos.</p>}
                </div>
              </section>

              {detail.documents.length > 0 && (
                <section>
                  <h3 className="mb-3 font-medium">Comprobantes vinculados</h3>
                  <div className="flex flex-wrap gap-2">
                    {detail.documents.map((document) => (
                      <Badge key={document.id} variant="outline" className="h-auto rounded-lg px-3 py-2">
                        <FileText /> {document.number || document.kind} · {document.status || 'Sin estado'}
                      </Badge>
                    ))}
                  </div>
                </section>
              )}

              <section>
                <h3 className="mb-3 font-medium">Timeline</h3>
                <div className="space-y-3">
                  {[...detail.events].reverse().map((event) => (
                    <div key={event.id} className="flex gap-3">
                      <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-muted">
                        {event.eventType.includes('created') ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Clock3 className="size-4 text-muted-foreground" />}
                      </div>
                      <div className="min-w-0 border-b border-border pb-3">
                        <p className="font-medium">{event.eventType}</p>
                        <p className="text-xs text-muted-foreground">{event.source} · {formatDate(event.providerOccurredAt || event.createdAt)}</p>
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

function MetricCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'slate',
}: {
  icon: typeof Store;
  label: string;
  value: string;
  hint: string;
  tone?: 'slate' | 'sky' | 'amber' | 'emerald';
}) {
  const iconClass = {
    slate: 'bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-300',
    sky: 'bg-sky-100 text-sky-600 dark:bg-sky-950 dark:text-sky-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  }[tone];
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        </div>
        <span className={cn('grid size-10 place-items-center rounded-xl', iconClass)}><Icon className="size-5" /></span>
      </div>
    </div>
  );
}

function DetailStat({ label, content }: { label: string; content: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-3">
      <p className="mb-2 text-xs text-muted-foreground">{label}</p>
      {content}
    </div>
  );
}
