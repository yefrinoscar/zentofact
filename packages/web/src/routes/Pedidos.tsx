import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Clock3,
  Inbox,
  Loader2,
  PackageCheck,
  ReceiptText,
  RefreshCw,
  Search,
  Store,
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

type OrderStage = 'nuevo' | 'por_emitir' | 'en_proceso' | 'atencion' | 'completado';

type InboxOrder = {
  id: number;
  companyId: number;
  companyName: string;
  companyRuc: string;
  orderId: string;
  orderNumber: string;
  createdAt: string | null;
  updatedAt: string | null;
  firstSeenAt: string | null;
  falabellaStatus: string;
  invoiceRequired: boolean;
  total: number;
  currency: string;
  customerName: string;
  itemsCount: number | null;
  stage: OrderStage;
  document: null | {
    id: number;
    kind: 'BOLETA' | 'FACTURA';
    number: string;
    status: string;
    date: string;
  };
};

type CompanySummary = {
  companyId: number;
  companyName: string;
  total: number;
  open: number;
  openAmount: number;
};

type InboxResponse = {
  orders: InboxOrder[];
  totalCount: number;
  summary: {
    total: number;
    open: number;
    new: number;
    ready: number;
    processing: number;
    attention: number;
    completed: number;
    openAmount: number;
    byCompany: CompanySummary[];
  };
  lastSyncedAt: string | null;
};

const PAGE_SIZE = 10;

const STAGES: Record<OrderStage, {
  label: string;
  shortLabel: string;
  description: string;
  next: string;
  className: string;
}> = {
  nuevo: {
    label: 'Recién ingresado',
    shortLabel: 'Nuevos',
    description: 'El pedido llegó y todavía no tiene comprobante.',
    next: 'Esperar confirmación de Falabella',
    className: 'border-amber-200 bg-amber-50 text-amber-700',
  },
  por_emitir: {
    label: 'Listo para emitir',
    shortLabel: 'Por emitir',
    description: 'Falabella ya permite emitir el comprobante.',
    next: 'Emitir boleta o factura',
    className: 'border-sky-200 bg-sky-50 text-sky-700',
  },
  en_proceso: {
    label: 'En proceso',
    shortLabel: 'En proceso',
    description: 'El comprobante existe y sigue en proceso.',
    next: 'Revisar respuesta de SUNAT',
    className: 'border-violet-200 bg-violet-50 text-violet-700',
  },
  atencion: {
    label: 'Requiere atención',
    shortLabel: 'Atención',
    description: 'Hay un rechazo, devolución, cancelación o estado excepcional.',
    next: 'Revisar la incidencia',
    className: 'border-red-200 bg-red-50 text-red-700',
  },
  completado: {
    label: 'Completado',
    shortLabel: 'Completados',
    description: 'El pedido ya cuenta con un comprobante resuelto.',
    next: 'Sin acciones pendientes',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  },
};

function formatMoney(value: number, currency = 'PEN') {
  try {
    return new Intl.NumberFormat('es-PE', { style: 'currency', currency }).format(value || 0);
  } catch {
    return new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(value || 0);
  }
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('es-PE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Lima',
  }).format(date);
}

function falabellaStatusLabel(status: string) {
  const key = status.toLowerCase();
  if (key.includes('ready_to_ship')) return 'Lista para enviar';
  if (key.includes('delivered')) return 'Entregada';
  if (key.includes('shipped')) return 'Enviada';
  if (key.includes('pending')) return 'Pendiente';
  if (key.includes('returned')) return 'Devuelta';
  if (key.includes('cancel')) return 'Cancelada';
  if (key.includes('failed')) return 'Fallida';
  return status ? status.replace(/_/g, ' ') : 'Sin estado';
}

function StageBadge({ stage }: { stage: OrderStage }) {
  const meta = STAGES[stage];
  return <Badge variant="outline" className={`rounded-md ${meta.className}`}>{meta.label}</Badge>;
}

function Metric({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: typeof Inbox;
  tone: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 px-4 py-3.5">
      <span className={`grid size-9 shrink-0 place-items-center rounded-md ${tone}`}>
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-2xl font-semibold tabular-nums text-foreground">{value}</span>
        <span className="block truncate text-xs text-muted-foreground">{label}</span>
      </span>
    </div>
  );
}

export default function Pedidos() {
  const navigate = useNavigate();
  const setActiveCompanyId = useAppStore((state) => state.setActiveCompanyId);
  const [data, setData] = useState<InboxResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [syncMessage, setSyncMessage] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [companyId, setCompanyId] = useState('all');
  const [stage, setStage] = useState('all');
  const [view, setView] = useState<'open' | 'all'>('open');
  const [days, setDays] = useState('0');
  const [page, setPage] = useState(1);
  const [selectedOrder, setSelectedOrder] = useState<InboxOrder | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search, companyId, stage, view, days]);

  const load = async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const response = await api.getOrdersInbox({
        companyId: companyId === 'all' ? undefined : Number(companyId),
        stage: stage === 'all' ? undefined : stage,
        view,
        days: Number(days),
        search: search || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      });
      setData(response as InboxResponse);
    } catch (nextError: any) {
      setError(nextError?.message || 'No se pudo cargar la bandeja de pedidos.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
    // load cambia cuando cambian los filtros de esta pantalla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, companyId, stage, view, days, page]);

  const syncAll = async () => {
    setSyncing(true);
    setError('');
    setSyncMessage('');
    try {
      const result = await api.syncOrdersInbox();
      const failed = Number(result?.failed || 0);
      setSyncMessage(failed
        ? `Se actualizaron ${result.successful} de ${result.stores} tiendas; ${failed} requiere revisión.`
        : `${result.successful} tienda${result.successful === 1 ? '' : 's'} actualizada${result.successful === 1 ? '' : 's'}.`);
      await load(true);
    } catch (nextError: any) {
      setError(nextError?.message || 'No se pudieron sincronizar las tiendas.');
    } finally {
      setSyncing(false);
    }
  };

  const companies = data?.summary.byCompany || [];
  const totalPages = Math.max(1, Math.ceil((data?.totalCount || 0) / PAGE_SIZE));
  const from = data?.totalCount ? (page - 1) * PAGE_SIZE + 1 : 0;
  const to = Math.min(page * PAGE_SIZE, data?.totalCount || 0);
  const summary = data?.summary;
  const selectedMeta = selectedOrder ? STAGES[selectedOrder.stage] : null;

  const selectedCompanyName = useMemo(
    () => companyId === 'all' ? 'Todas las tiendas' : companies.find((company) => String(company.companyId) === companyId)?.companyName || 'Tienda',
    [companyId, companies],
  );

  const openStore = (order: InboxOrder) => {
    setActiveCompanyId(order.companyId);
    navigate('/falabella-api');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-9 rounded-xl bg-muted p-1">
            <button
              type="button"
              onClick={() => {
                setView('open');
                if (stage === 'completado') setStage('all');
              }}
              className={`rounded-lg px-3 text-sm font-medium transition-colors ${view === 'open' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Pendientes
            </button>
            <button
              type="button"
              onClick={() => setView('all')}
              className={`rounded-lg px-3 text-sm font-medium transition-colors ${view === 'all' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Todos
            </button>
          </div>
          <Select value={companyId} onValueChange={setCompanyId}>
            <SelectTrigger className="w-[210px] border-border bg-background">
              <Store className="size-4 text-muted-foreground" />
              <SelectValue placeholder="Todas las tiendas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las tiendas</SelectItem>
              {companies.map((company) => (
                <SelectItem key={company.companyId} value={String(company.companyId)}>{company.companyName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={stage}
            onValueChange={(value) => {
              setStage(value);
              if (value === 'completado') setView('all');
            }}
          >
            <SelectTrigger className="w-[180px] border-border bg-background">
              <SelectValue placeholder="Todas las etapas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las etapas</SelectItem>
              {(Object.keys(STAGES) as OrderStage[]).map((key) => (
                <SelectItem key={key} value={key}>{STAGES[key].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-[150px] border-border bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Todo el tiempo</SelectItem>
              <SelectItem value="7">Últimos 7 días</SelectItem>
              <SelectItem value="30">Últimos 30 días</SelectItem>
              <SelectItem value="90">Últimos 90 días</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Buscar orden, cliente o tienda"
              className="pl-9"
              aria-label="Buscar pedidos"
            />
          </div>
          <Button variant="outline" onClick={() => void load(true)} disabled={refreshing || loading}>
            <RefreshCw className={refreshing ? 'animate-spin' : ''} />
            Actualizar
          </Button>
          <Button onClick={() => void syncAll()} disabled={syncing}>
            {syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Sincronizar tiendas
          </Button>
        </div>
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

      <section className="overflow-hidden rounded-md border border-border bg-card">
        <div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-6">
          <Metric label="Pendientes totales" value={summary?.open || 0} icon={Inbox} tone="bg-primary/10 text-primary" />
          <Metric label="Recién ingresados" value={summary?.new || 0} icon={CircleDot} tone="bg-amber-50 text-amber-700" />
          <Metric label="Listos para emitir" value={summary?.ready || 0} icon={ReceiptText} tone="bg-sky-50 text-sky-700" />
          <Metric label="En proceso" value={summary?.processing || 0} icon={Clock3} tone="bg-violet-50 text-violet-700" />
          <Metric label="Requieren atención" value={summary?.attention || 0} icon={AlertCircle} tone="bg-red-50 text-red-700" />
          <Metric label="Completados" value={summary?.completed || 0} icon={PackageCheck} tone="bg-emerald-50 text-emerald-700" />
        </div>
        <div className="flex flex-col gap-1 border-t border-border bg-muted/20 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span className="text-muted-foreground">Valor de pedidos pendientes</span>
          <span className="font-semibold tabular-nums text-foreground">{formatMoney(summary?.openAmount || 0)}</span>
        </div>
      </section>

      {companies.length > 0 && (
        <section className="rounded-md border border-border bg-card px-4 py-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">Pendientes por tienda</p>
              <p className="text-xs text-muted-foreground">Dónde se concentra la carga de trabajo actual.</p>
            </div>
            <span className="text-xs text-muted-foreground">{companies.length} tienda{companies.length === 1 ? '' : 's'}</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {companies.map((company) => (
              <button
                key={company.companyId}
                type="button"
                onClick={() => setCompanyId(String(company.companyId))}
                className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-left transition-colors hover:bg-muted/40 ${companyId === String(company.companyId) ? 'border-primary bg-primary/5' : 'border-border'}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">{company.companyName}</span>
                  <span className="block text-xs text-muted-foreground">{formatMoney(company.openAmount)} pendientes</span>
                </span>
                <span className="text-xl font-semibold tabular-nums text-foreground">{company.open}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <TablePanel className={refreshing ? 'opacity-70' : undefined}>
        <TablePanelHeader className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">{selectedCompanyName}</p>
            <p className="text-xs text-muted-foreground">
              {view === 'open' ? 'Pedidos que aún tienen un paso pendiente.' : 'Historial completo de pedidos.'}
            </p>
          </div>
          <div className="text-xs text-muted-foreground">
            {data?.lastSyncedAt ? `Actualizado ${formatDate(data.lastSyncedAt)}` : 'Aún sin sincronización registrada'}
          </div>
        </TablePanelHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
            Cargando pedidos…
          </div>
        ) : data?.orders.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pedido</TableHead>
                <TableHead>Tienda</TableHead>
                <TableHead>Ingreso</TableHead>
                <TableHead>Etapa</TableHead>
                <TableHead className="hidden lg:table-cell">Estado Falabella</TableHead>
                <TableHead className="hidden xl:table-cell">Comprobante</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="w-24 text-right">Acción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.orders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell>
                    <button type="button" onClick={() => setSelectedOrder(order)} className="text-left hover:underline">
                      <span className="block font-mono text-xs font-semibold text-foreground">{order.orderNumber}</span>
                      <span className="block max-w-48 truncate text-xs text-muted-foreground">{order.customerName || 'Cliente no informado'}</span>
                    </button>
                  </TableCell>
                  <TableCell>
                    <span className="block max-w-44 truncate font-medium text-foreground">{order.companyName}</span>
                    <span className="block font-mono text-xs text-muted-foreground">{order.companyRuc}</span>
                  </TableCell>
                  <TableCell>
                    <span className="block text-sm text-foreground">{formatDate(order.createdAt)}</span>
                    {order.itemsCount !== null && <span className="block text-xs text-muted-foreground">{order.itemsCount} producto{order.itemsCount === 1 ? '' : 's'}</span>}
                  </TableCell>
                  <TableCell><StageBadge stage={order.stage} /></TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <span className="text-sm text-muted-foreground">{falabellaStatusLabel(order.falabellaStatus)}</span>
                  </TableCell>
                  <TableCell className="hidden xl:table-cell">
                    {order.document ? (
                      <span>
                        <span className="block font-mono text-xs font-medium text-foreground">{order.document.number}</span>
                        <span className="block text-xs text-muted-foreground">{order.document.status || 'Pendiente'}</span>
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">Sin emitir</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatMoney(order.total, order.currency)}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setSelectedOrder(order)} aria-label={`Ver pedido ${order.orderNumber}`}>
                      Ver <ArrowRight />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="flex flex-col items-center gap-2 py-14 text-center">
            <Inbox className="size-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">No hay pedidos para estos filtros</p>
            <p className="text-sm text-muted-foreground">Prueba otra etapa, tienda o periodo.</p>
          </div>
        )}

        {!loading && (
          <TablePanelFooter className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">Mostrando {from}–{to} de {data?.totalCount || 0}</p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
                <ChevronLeft /> Anterior
              </Button>
              <span className="min-w-16 text-center text-xs text-muted-foreground">{page} de {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>
                Siguiente <ChevronRight />
              </Button>
            </div>
          </TablePanelFooter>
        )}
      </TablePanel>

      <Dialog open={Boolean(selectedOrder)} onOpenChange={(open) => !open && setSelectedOrder(null)}>
        <DialogContent className="sm:max-w-xl">
          {selectedOrder && selectedMeta && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2 pr-8">
                  <DialogTitle className="font-mono">Pedido {selectedOrder.orderNumber}</DialogTitle>
                  <StageBadge stage={selectedOrder.stage} />
                </div>
                <DialogDescription>{selectedMeta.description}</DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-3 rounded-md border border-border p-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Tienda</p>
                    <p className="font-medium text-foreground">{selectedOrder.companyName}</p>
                    <p className="font-mono text-xs text-muted-foreground">RUC {selectedOrder.companyRuc}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Cliente</p>
                    <p className="font-medium text-foreground">{selectedOrder.customerName || 'No informado'}</p>
                  </div>
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Comprobante requerido</p>
                      <p className="font-medium text-foreground">{selectedOrder.invoiceRequired ? 'Factura' : 'Boleta'}</p>
                    </div>
                    <p className="text-lg font-semibold tabular-nums text-foreground">{formatMoney(selectedOrder.total, selectedOrder.currency)}</p>
                  </div>
                </div>

                <div className="space-y-3 rounded-md border border-border p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recorrido del pedido</p>
                  <div className="space-y-0">
                    <div className="flex gap-3 pb-4">
                      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700"><CheckCircle2 className="size-3.5" /></span>
                      <div>
                        <p className="text-sm font-medium text-foreground">Pedido recibido</p>
                        <p className="text-xs text-muted-foreground">{formatDate(selectedOrder.createdAt)}</p>
                      </div>
                    </div>
                    <div className="flex gap-3 pb-4">
                      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><CircleDot className="size-3.5" /></span>
                      <div>
                        <p className="text-sm font-medium text-foreground">{selectedMeta.label}</p>
                        <p className="text-xs text-muted-foreground">{falabellaStatusLabel(selectedOrder.falabellaStatus)}</p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"><ArrowRight className="size-3.5" /></span>
                      <div>
                        <p className="text-sm font-medium text-foreground">Siguiente paso</p>
                        <p className="text-xs text-muted-foreground">{selectedMeta.next}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {selectedOrder.document && (
                <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-muted/30 px-4 py-3">
                  <div>
                    <p className="text-xs text-muted-foreground">{selectedOrder.document.kind === 'FACTURA' ? 'Factura emitida' : 'Boleta emitida'}</p>
                    <p className="font-mono text-sm font-medium text-foreground">{selectedOrder.document.number}</p>
                  </div>
                  <Badge variant="outline" className="rounded-md">SUNAT: {selectedOrder.document.status || 'Pendiente'}</Badge>
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setSelectedOrder(null)}>Cerrar</Button>
                <Button onClick={() => openStore(selectedOrder)}>
                  Gestionar en Falabella <ArrowRight />
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
