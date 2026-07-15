import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Inbox,
  Loader2,
  RefreshCw,
  Search,
  Store,
  Truck,
} from 'lucide-react';
import api from '../lib/api';
import { useAppStore } from '../stores/app';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';

type InboxOrder = {
  id: number;
  companyId: number;
  companyName: string;
  companyRuc: string;
  orderId: string;
  orderNumber: string;
  createdAt: string | null;
  firstSeenAt: string | null;
  promisedShippingAt: string | null;
  falabellaStatus: string;
  shippingType: string;
  invoiceRequired: boolean;
  total: number;
  currency: string;
  customerName: string;
  itemsCount: number | null;
};

type InboxResponse = {
  orders: InboxOrder[];
  totalCount: number;
  lastSyncedAt: string | null;
};

type CompanyOption = { id: number; name: string };
type UrgencyKey = 'overdue' | 'today' | 'tomorrow' | 'later';

const LIMA_TIME_ZONE = 'America/Lima';
const BOARD_LIMIT = 500;

const COLUMNS: Array<{
  key: UrgencyKey;
  title: string;
  description: string;
  icon: typeof AlertCircle;
  headerClass: string;
  countClass: string;
  empty: string;
}> = [
  {
    key: 'overdue',
    title: 'Vencidos',
    description: 'Debieron entregarse antes',
    icon: AlertCircle,
    headerClass: 'border-red-200 bg-red-50/80 text-red-800',
    countClass: 'bg-red-100 text-red-700',
    empty: 'No tienes pedidos vencidos.',
  },
  {
    key: 'today',
    title: 'Vencen hoy',
    description: 'Prioridad del día',
    icon: Clock3,
    headerClass: 'border-amber-200 bg-amber-50/80 text-amber-800',
    countClass: 'bg-amber-100 text-amber-700',
    empty: 'Nada más vence hoy.',
  },
  {
    key: 'tomorrow',
    title: 'Vencen mañana',
    description: 'Prepara con anticipación',
    icon: CalendarClock,
    headerClass: 'border-sky-200 bg-sky-50/80 text-sky-800',
    countClass: 'bg-sky-100 text-sky-700',
    empty: 'No hay entregas para mañana.',
  },
  {
    key: 'later',
    title: 'Próximos',
    description: 'Después de mañana',
    icon: Truck,
    headerClass: 'border-border bg-muted/40 text-foreground',
    countClass: 'bg-muted text-muted-foreground',
    empty: 'No hay pedidos posteriores.',
  },
];

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function limaDateKey(date: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: LIMA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function tomorrowKey(now: Date) {
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return limaDateKey(tomorrow);
}

function formatDateTime(value: string | null | undefined) {
  const date = parseDate(value);
  if (!date) return 'Sin fecha informada';
  return new Intl.DateTimeFormat('es-PE', {
    timeZone: LIMA_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatTime(value: string | null | undefined) {
  const date = parseDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('es-PE', {
    timeZone: LIMA_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatMoney(value: number, currency = 'PEN') {
  try {
    return new Intl.NumberFormat('es-PE', { style: 'currency', currency }).format(value || 0);
  } catch {
    return new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(value || 0);
  }
}

function elapsedLabel(value: string | null | undefined, now: Date) {
  const date = parseDate(value);
  if (!date) return '';
  const minutes = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60_000));
  if (minutes < 60) return `hace ${Math.max(1, minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} día${days === 1 ? '' : 's'}`;
}

function overdueLabel(value: string | null | undefined, now: Date) {
  const deadline = parseDate(value);
  if (!deadline) return 'Sin plazo informado';
  const minutes = Math.max(1, Math.floor((now.getTime() - deadline.getTime()) / 60_000));
  if (minutes < 60) return `Venció hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Venció hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `Venció hace ${days} día${days === 1 ? '' : 's'}`;
}

function urgencyFor(order: InboxOrder, now: Date): UrgencyKey {
  const deadline = parseDate(order.promisedShippingAt);
  if (!deadline) return 'later';
  if (deadline.getTime() < now.getTime()) return 'overdue';
  const deadlineDay = limaDateKey(deadline);
  if (deadlineDay === limaDateKey(now)) return 'today';
  if (deadlineDay === tomorrowKey(now)) return 'tomorrow';
  return 'later';
}

function deadlineLabel(order: InboxOrder, now: Date) {
  const urgency = urgencyFor(order, now);
  if (!order.promisedShippingAt) return 'Sin plazo informado';
  if (urgency === 'overdue') return overdueLabel(order.promisedShippingAt, now);
  if (urgency === 'today') return `Hoy · ${formatTime(order.promisedShippingAt)}`;
  if (urgency === 'tomorrow') return `Mañana · ${formatTime(order.promisedShippingAt)}`;
  return formatDateTime(order.promisedShippingAt);
}

function statusMeta(status: string) {
  const key = status.toLowerCase();
  if (key.includes('ready_to_ship')) {
    return {
      label: 'Listo para entregar',
      className: 'border-sky-200 bg-sky-50 text-sky-700',
    };
  }
  return {
    label: 'Por preparar',
    className: 'border-amber-200 bg-amber-50 text-amber-700',
  };
}

function OrderCard({ order, now, onOpen }: { order: InboxOrder; now: Date; onOpen: () => void }) {
  const urgency = urgencyFor(order, now);
  const status = statusMeta(order.falabellaStatus);
  const deadlineTone = urgency === 'overdue'
    ? 'text-red-700'
    : urgency === 'today'
      ? 'text-amber-700'
      : 'text-foreground';

  return (
    <article className="rounded-md border border-border bg-card p-3.5 transition-colors hover:border-foreground/20">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`flex items-center gap-1.5 text-sm font-semibold ${deadlineTone}`}>
            {urgency === 'overdue' && <AlertCircle className="size-4 shrink-0" />}
            {deadlineLabel(order, now)}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Límite de entrega al operador</p>
        </div>
        <Badge variant="outline" className={`rounded-md ${status.className}`}>{status.label}</Badge>
      </div>

      <div className="mt-3 border-t border-border/70 pt-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <button type="button" onClick={onOpen} className="font-mono text-sm font-semibold text-foreground hover:underline">
              {order.orderNumber}
            </button>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{order.companyName}</p>
          </div>
          <p className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{formatMoney(order.total, order.currency)}</p>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className="text-muted-foreground">Ingresó</p>
            <p className="mt-0.5 font-medium text-foreground">{elapsedLabel(order.createdAt, now)}</p>
            <p className="text-[11px] text-muted-foreground">{formatDateTime(order.createdAt)}</p>
          </div>
          <div className="text-right">
            <p className="text-muted-foreground">Contenido</p>
            <p className="mt-0.5 font-medium text-foreground">
              {order.itemsCount ?? '-'} producto{order.itemsCount === 1 ? '' : 's'}
            </p>
            <p className="text-[11px] text-muted-foreground">{order.invoiceRequired ? 'Factura' : 'Boleta'}</p>
          </div>
        </div>
      </div>

      <Button variant="ghost" size="sm" className="mt-3 w-full justify-between" onClick={onOpen}>
        Ver pedido <ArrowRight />
      </Button>
    </article>
  );
}

export default function Pedidos() {
  const navigate = useNavigate();
  const setActiveCompanyId = useAppStore((state) => state.setActiveCompanyId);
  const [data, setData] = useState<InboxResponse | null>(null);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [companyId, setCompanyId] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [syncMessage, setSyncMessage] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<InboxOrder | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const load = async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const response = await api.getOrdersInbox({
        companyId: companyId === 'all' ? undefined : Number(companyId),
        view: 'actionable',
        search: search || undefined,
        limit: BOARD_LIMIT,
        offset: 0,
      }) as InboxResponse;
      setData(response);
      if (companyId === 'all' && !search) {
        const unique = new Map<number, CompanyOption>();
        for (const order of response.orders) unique.set(order.companyId, { id: order.companyId, name: order.companyName });
        setCompanies([...unique.values()].sort((a, b) => a.name.localeCompare(b.name, 'es')));
      }
    } catch (nextError: any) {
      setError(nextError?.message || 'No se pudieron cargar los pedidos pendientes.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
    // La carga depende únicamente de los filtros visibles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, search]);

  const syncAll = async () => {
    setRefreshing(true);
    setError('');
    setSyncMessage('');
    try {
      const result = await api.syncOrdersInbox();
      const failed = Number(result?.failed || 0);
      setSyncMessage(failed
        ? `${result.successful} tiendas actualizadas; ${failed} no pudieron sincronizarse.`
        : 'Pedidos actualizados con Falabella.');
      await load(true);
    } catch (nextError: any) {
      setError(nextError?.message || 'No se pudieron sincronizar las tiendas.');
    } finally {
      setRefreshing(false);
    }
  };

  const grouped = useMemo(() => {
    const groups: Record<UrgencyKey, InboxOrder[]> = { overdue: [], today: [], tomorrow: [], later: [] };
    for (const order of data?.orders || []) groups[urgencyFor(order, now)].push(order);
    for (const orders of Object.values(groups)) {
      orders.sort((a, b) => {
        const deadlineA = parseDate(a.promisedShippingAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const deadlineB = parseDate(b.promisedShippingAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        return deadlineA - deadlineB || String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
      });
    }
    return groups;
  }, [data?.orders, now]);

  const total = data?.totalCount || 0;
  const selectedUrgency = selectedOrder ? urgencyFor(selectedOrder, now) : null;
  const selectedStatus = selectedOrder ? statusMeta(selectedOrder.falabellaStatus) : null;

  const openStore = (order: InboxOrder) => {
    setActiveCompanyId(order.companyId);
    navigate('/falabella-api');
  };

  return (
    <div className="space-y-4">
      <section className="flex flex-col gap-4 rounded-md border border-border bg-card px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
            <Inbox className="size-5" />
          </span>
          <div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <p className="text-2xl font-semibold tabular-nums text-foreground">{total}</p>
              <p className="text-sm font-medium text-foreground">pedidos por despachar</p>
            </div>
            <p className="text-sm text-muted-foreground">Atiéndelos en orden según su límite de entrega.</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          {grouped.overdue.length > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 font-medium text-red-700">
              <AlertCircle className="size-4" /> {grouped.overdue.length} vencido{grouped.overdue.length === 1 ? '' : 's'}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 font-medium text-amber-700">
            <Clock3 className="size-4" /> {grouped.today.length} vence{grouped.today.length === 1 ? '' : 'n'} hoy
          </span>
          <span className="text-xs text-muted-foreground">
            {data?.lastSyncedAt ? `Actualizado ${formatDateTime(data.lastSyncedAt)}` : 'Sin sincronización registrada'}
          </span>
        </div>
      </section>

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={companyId} onValueChange={setCompanyId}>
            <SelectTrigger className="w-full border-border bg-background sm:w-[230px]">
              <Store className="size-4 text-muted-foreground" />
              <SelectValue placeholder="Todas las tiendas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las tiendas</SelectItem>
              {companies.map((company) => (
                <SelectItem key={company.id} value={String(company.id)}>{company.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Buscar pedido, cliente o tienda"
              className="pl-9"
              aria-label="Buscar pedidos pendientes"
            />
          </div>
        </div>
        <Button onClick={() => void syncAll()} disabled={refreshing}>
          {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Sincronizar pedidos
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {syncMessage && !error && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">
          <CheckCircle2 className="size-4 shrink-0" />
          <span>{syncMessage}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-md border border-border bg-card py-20 text-sm text-muted-foreground">
          <Loader2 className="size-5 animate-spin" /> Cargando pedidos pendientes…
        </div>
      ) : total === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-border bg-card py-16 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-emerald-50 text-emerald-700">
            <CheckCircle2 className="size-6" />
          </span>
          <p className="text-sm font-medium text-foreground">No tienes pedidos pendientes de despacho</p>
          <p className="text-sm text-muted-foreground">Todo está al día con los filtros actuales.</p>
        </div>
      ) : (
        <div className="overflow-x-auto pb-2">
          <div className="grid min-w-[1120px] grid-cols-4 gap-3">
            {COLUMNS.map((column) => {
              const Icon = column.icon;
              const orders = grouped[column.key];
              return (
                <section key={column.key} className="flex min-h-[420px] flex-col rounded-md border border-border bg-muted/15">
                  <header className={`flex items-center justify-between gap-3 rounded-t-md border-b px-3.5 py-3 ${column.headerClass}`}>
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Icon className="size-4 shrink-0" />
                      <div className="min-w-0">
                        <h2 className="text-sm font-semibold">{column.title}</h2>
                        <p className="truncate text-[11px] opacity-75">{column.description}</p>
                      </div>
                    </div>
                    <span className={`grid min-w-7 place-items-center rounded-md px-1.5 py-1 text-xs font-semibold tabular-nums ${column.countClass}`}>
                      {orders.length}
                    </span>
                  </header>
                  <div className="max-h-[calc(100vh-21rem)] min-h-[340px] flex-1 space-y-2.5 overflow-y-auto p-2.5">
                    {orders.map((order) => (
                      <OrderCard key={order.id} order={order} now={now} onOpen={() => setSelectedOrder(order)} />
                    ))}
                    {orders.length === 0 && (
                      <div className="flex h-36 items-center justify-center px-4 text-center text-xs text-muted-foreground">
                        {column.empty}
                      </div>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}

      <Dialog open={Boolean(selectedOrder)} onOpenChange={(open) => !open && setSelectedOrder(null)}>
        <DialogContent className="sm:max-w-lg">
          {selectedOrder && selectedUrgency && selectedStatus && (
            <>
              <DialogHeader>
                <div className="flex flex-wrap items-center gap-2 pr-8">
                  <DialogTitle className="font-mono">Pedido {selectedOrder.orderNumber}</DialogTitle>
                  <Badge variant="outline" className={`rounded-md ${selectedStatus.className}`}>{selectedStatus.label}</Badge>
                </div>
                <DialogDescription>{selectedOrder.companyName}</DialogDescription>
              </DialogHeader>

              <div className={`rounded-md border p-4 ${selectedUrgency === 'overdue' ? 'border-red-200 bg-red-50' : selectedUrgency === 'today' ? 'border-amber-200 bg-amber-50' : 'border-border bg-muted/30'}`}>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Límite para entregar al operador logístico</p>
                <p className={`mt-1 text-xl font-semibold ${selectedUrgency === 'overdue' ? 'text-red-700' : selectedUrgency === 'today' ? 'text-amber-700' : 'text-foreground'}`}>
                  {deadlineLabel(selectedOrder, now)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Fecha informada por Falabella: {formatDateTime(selectedOrder.promisedShippingAt)}</p>
              </div>

              <dl className="grid grid-cols-2 gap-x-5 gap-y-4 rounded-md border border-border p-4 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Ingresó</dt>
                  <dd className="mt-1 font-medium text-foreground">{formatDateTime(selectedOrder.createdAt)}</dd>
                  <dd className="text-xs text-muted-foreground">{elapsedLabel(selectedOrder.createdAt, now)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Total</dt>
                  <dd className="mt-1 font-semibold tabular-nums text-foreground">{formatMoney(selectedOrder.total, selectedOrder.currency)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Cliente</dt>
                  <dd className="mt-1 font-medium text-foreground">{selectedOrder.customerName || 'No informado'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Contenido</dt>
                  <dd className="mt-1 font-medium text-foreground">{selectedOrder.itemsCount ?? '-'} producto{selectedOrder.itemsCount === 1 ? '' : 's'}</dd>
                  <dd className="text-xs text-muted-foreground">Requiere {selectedOrder.invoiceRequired ? 'factura' : 'boleta'}</dd>
                </div>
              </dl>

              <DialogFooter>
                <Button variant="outline" onClick={() => setSelectedOrder(null)}>Cerrar</Button>
                <Button onClick={() => openStore(selectedOrder)}>
                  Gestionar pedido <ArrowRight />
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
