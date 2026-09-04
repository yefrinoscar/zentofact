import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, CheckCircle2, Clock, Loader2, PackageMinus, Pause, Play,
  RefreshCw, RotateCcw, XCircle,
} from 'lucide-react';
import api from '../lib/api';
import { cn } from '../lib/cn';

type Config = {
  inventoryEnabled: boolean;
  inventoryLabel?: string;
  inventorySourceLabel?: string;
  inventoryKillSwitch?: boolean;
  paused: boolean;
  stats: Record<string, number>;
  workerIntervalSeconds: number;
  batchSize: number;
};

type Job = {
  id: number;
  company: string;
  order_number: string;
  order_id: string | null;
  status: string;
  source: string;
  attempts: number;
  result: Record<string, unknown> | null;
  last_error: string | null;
  updated_at: string;
};

type OrderPreview = {
  error?: string;
  company?: string;
  order?: {
    orderNumber?: string;
    status?: string;
    total?: string | number | null;
    itemsCount?: number;
    stockApplied?: number;
    orderedAt?: string;
    promisedShippingAt?: string;
  };
  stock?: {
    applied?: number | null;
    skipped?: number | null;
    missing?: boolean;
  };
};

const STATUS_STYLES: Record<string, { cls: string; icon: typeof Clock; label: string }> = {
  done: { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle2, label: 'Descontado' },
  pending: { cls: 'bg-amber-50 text-amber-700 border-amber-200', icon: Clock, label: 'En cola' },
  processing: { cls: 'bg-blue-50 text-blue-700 border-blue-200', icon: Loader2, label: 'Procesando' },
  skipped: { cls: 'bg-slate-100 text-slate-600 border-slate-200', icon: XCircle, label: 'Omitido' },
  failed: { cls: 'bg-red-50 text-red-700 border-red-200', icon: AlertTriangle, label: 'Falló' },
};

const FILTERS = [
  ['all', 'Todas'],
  ['done', 'Descontados'],
  ['pending', 'En cola'],
  ['processing', 'Procesando'],
  ['failed', 'Fallidos'],
  ['skipped', 'Omitidos'],
] as const;

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.skipped;
  const Icon = style.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium', style.cls)}>
      <Icon className={cn('h-3 w-3', status === 'processing' && 'animate-spin')} />
      {style.label}
    </span>
  );
}

function SourceBadge({ source }: { source: string }) {
  const labels: Record<string, string> = {
    webhook: 'Webhook',
    cron: 'Cron',
    catchup: 'Recuperación',
    listen: 'Escucha',
    manual: 'Venta manual',
    system: 'Sistema',
  };
  const label = labels[source] || source || 'Sistema';
  const fromWebhook = source === 'webhook';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        fromWebhook
          ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
          : 'border-slate-200 bg-slate-50 text-slate-600',
      )}
      title={fromWebhook ? 'Encolado al entrar el pedido' : 'Encolado por otro flujo'}
    >
      {label}
    </span>
  );
}

function money(value?: string | number | null) {
  const parsed = Number(String(value ?? '').replace(/,/g, ''));
  if (!Number.isFinite(parsed)) return '-';
  return new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(parsed);
}

function fullDateTime(value?: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace('T', ' ').slice(0, 19);
  return date.toLocaleString('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatJobDetail(job: Job) {
  const result = job.result || {};
  const applied = Number(result.applied);
  const skipped = Number(result.skipped);
  if (job.last_error) return job.last_error;
  if (Number.isFinite(applied) && applied > 0) return `${applied} línea${applied === 1 ? '' : 's'} descontada${applied === 1 ? '' : 's'}`;
  const reserved = Number(result.reserved);
  if (Number.isFinite(reserved) && reserved > 0) return `${reserved} línea${reserved === 1 ? '' : 's'} reservada${reserved === 1 ? '' : 's'}`;
  if (Number.isFinite(skipped) && skipped > 0) return `${skipped} línea${skipped === 1 ? '' : 's'} omitida${skipped === 1 ? '' : 's'}`;
  if (result.supersededByOrderId) return 'Reemplazado por job canónico';
  if (typeof result.missing === 'boolean' && result.missing) return 'Esperando pedido canónico';
  return job.status === 'done' ? 'Sin cambios de stock' : '—';
}

function OrderPreviewCard({ preview, loading }: { preview: OrderPreview | null; loading: boolean }) {
  const order = preview?.order;
  return (
    <div className="w-80 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-xl">
      {loading ? (
        <div className="space-y-2">
          <div className="h-4 w-28 animate-pulse rounded bg-muted" />
          <div className="h-3 w-full animate-pulse rounded bg-muted" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
        </div>
      ) : preview?.error ? (
        <div className="flex gap-2 text-xs text-red-600">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{preview.error}</span>
        </div>
      ) : order ? (
        <div className="space-y-3">
          <div>
            <p className="font-mono text-sm font-semibold text-foreground">{order.orderNumber || '-'}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{preview?.company || 'Empresa'}</p>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
            <span className="text-muted-foreground">Estado</span>
            <span className="truncate text-right font-medium text-foreground">{order.status || '-'}</span>
            <span className="text-muted-foreground">Total</span>
            <span className="text-right font-medium text-foreground">{money(order.total)}</span>
            <span className="text-muted-foreground">Items</span>
            <span className="text-right text-foreground">{order.itemsCount ?? '-'}</span>
            <span className="text-muted-foreground">Stock aplicado</span>
            <span className="text-right font-medium text-foreground">{order.stockApplied ?? 0} u</span>
          </div>
          {preview?.stock && (
            <div className="rounded-md border border-border bg-muted/30 px-2.5 py-2 text-xs">
              <p className="font-medium text-foreground">
                {preview.stock.applied != null ? `${preview.stock.applied} descontadas` : 'Sin descuento aún'}
              </p>
              {preview.stock.skipped != null && Number(preview.stock.skipped) > 0 && (
                <p className="mt-0.5 text-muted-foreground">{preview.stock.skipped} omitidas</p>
              )}
            </div>
          )}
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">Pasa el cursor para cargar el pedido.</span>
      )}
    </div>
  );
}

function SearchableOrderNumber({ job }: { job: Job }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<OrderPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const timerRef = useRef<number | null>(null);

  const show = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setPosition({
        top: Math.min(rect.bottom + 10, window.innerHeight - 260),
        left: Math.min(rect.left, window.innerWidth - 340),
      });
    }
    setOpen(true);
    if (preview || loading) return;
    timerRef.current = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await api.stockJobsOrderPreview(job.id);
        setPreview(response?.error ? { error: response.error } : response);
      } catch (error: any) {
        setPreview({ error: error?.message || 'No se pudo cargar el pedido.' });
      } finally {
        setLoading(false);
      }
    }, 180);
  };

  const hide = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="rounded px-1 py-0.5 font-mono text-xs text-foreground underline decoration-border underline-offset-4 transition hover:bg-accent hover:decoration-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
      >
        {job.order_number || <span className="font-sans text-muted-foreground">Sin orden</span>}
      </button>
      {open && createPortal(
        <div
          className="fixed z-[1000]"
          style={{ top: position.top, left: Math.max(12, position.left) }}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={hide}
        >
          <OrderPreviewCard preview={preview} loading={loading} />
        </div>,
        document.body,
      )}
    </>
  );
}

function SkeletonRows() {
  return (
    <div className="divide-y divide-border/50">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="flex items-center gap-4 px-5 py-3.5">
          <div className="h-4 w-40 animate-pulse rounded bg-muted" />
          <div className="h-4 w-24 animate-pulse rounded bg-muted" />
          <div className="h-5 w-20 animate-pulse rounded-full bg-muted" />
          <div className="h-4 flex-1 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

export default function DescuentosCola() {
  const [config, setConfig] = useState<Config | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const timer = useRef<number | null>(null);

  const loadConfig = useCallback(async () => {
    try { setConfig(await api.stockJobsGetConfig()); } catch { /* noop */ }
  }, []);

  const loadJobs = useCallback(async (spin = false) => {
    if (spin) setRefreshing(true);
    try {
      const rows = await api.stockJobsList(60);
      setJobs(rows || []);
    } catch { /* noop */ }
    finally { if (spin) setRefreshing(false); }
  }, []);

  useEffect(() => {
    (async () => {
      await Promise.all([loadConfig(), loadJobs()]);
      setLoading(false);
    })();
  }, [loadConfig, loadJobs]);

  useEffect(() => {
    timer.current = window.setInterval(() => {
      void loadJobs();
      void loadConfig();
    }, 3000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [loadJobs, loadConfig]);

  const togglePaused = async () => {
    if (!config) return;
    const next = !config.paused;
    setConfig((prev) => (prev ? { ...prev, paused: next } : prev));
    try { await api.stockJobsSetPaused(next); } catch {
      setConfig((prev) => (prev ? { ...prev, paused: !next } : prev));
    }
  };

  const retryJob = async (id: number) => {
    setJobs((prev) => prev.map((job) => (job.id === id ? { ...job, status: 'pending', last_error: null } : job)));
    try { await api.stockJobsRetry(id); } catch { /* noop */ }
    await Promise.all([loadJobs(), loadConfig()]);
  };

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="h-9 w-40 animate-pulse rounded-lg bg-muted" />
        <div className="rounded-2xl border border-border bg-card p-5">
          <SkeletonRows />
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        No se pudo cargar la cola de descuentos.
      </div>
    );
  }

  const shownJobs = filter === 'all' ? jobs : jobs.filter((job) => job.status === filter);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
              config.inventoryEnabled
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-amber-300 bg-amber-50 text-amber-800',
            )}
            title={config.inventorySourceLabel ? `Mismo interruptor que Configuración del sistema (${config.inventorySourceLabel}).` : 'Mismo interruptor que Configuración del sistema.'}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', config.inventoryEnabled ? 'bg-emerald-500' : 'bg-amber-500')} />
            {config.inventoryEnabled ? 'Descuento encendido' : 'Descuento apagado'}
          </span>
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <PackageMinus className="h-4 w-4" />
            Worker cada {config.workerIntervalSeconds}s · lotes de {config.batchSize}
          </span>
        </div>
        <button
          onClick={togglePaused}
          title={config.paused ? 'Reanuda el worker de esta cola. No cambia el descuento del sistema.' : 'Pausa el worker de esta cola. No apaga el descuento del sistema.'}
          className={cn(
            'inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition',
            config.paused
              ? 'border-amber-300 bg-amber-100 text-amber-800 hover:bg-amber-200'
              : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {config.paused ? <><Play className="h-4 w-4" /> Reanudar</> : <><Pause className="h-4 w-4" /> Pausar cola</>}
        </button>
      </div>

      {!config.inventoryEnabled && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="font-medium">Descuento apagado</span>
            {' '}en Configuración del sistema. Los pedidos se encolan y no se descuentan.
            {config.inventoryKillSwitch ? ' Kill-switch de entorno activo.' : ''}
          </span>
          <Link
            to="/system-config"
            className="shrink-0 font-medium underline decoration-amber-700/40 underline-offset-4 hover:decoration-amber-800"
          >
            Abrir configuración
          </Link>
        </div>
      )}

      {config.paused && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <Pause className="h-4 w-4 shrink-0" />
          <span>
            <span className="font-medium">Cola pausada.</span> El worker no corre. El descuento del sistema no cambia.
          </span>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Descuentos de stock</h2>
            <p className="text-xs text-muted-foreground">Desde pendiente. El stock queda reservado hasta listo para enviar.</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" title="La lista se refresca cada 3 s. No indica si el descuento está encendido.">
              <span className="h-2 w-2 animate-pulse rounded-full bg-slate-400" /> Actualizando
            </span>
            <button
              onClick={() => Promise.all([loadJobs(true), loadConfig()])}
              disabled={refreshing}
              className="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-60"
              title="Refrescar ahora"
            >
              <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
            </button>
          </div>
        </div>

        <div className="border-b border-border px-5 py-3">
          <div
            role="tablist"
            aria-label="Filtrar por estado"
            className="inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-2xl bg-muted p-1"
          >
            {FILTERS.map(([key, label]) => {
              const count = key === 'all'
                ? Object.values(config.stats || {}).reduce((sum, value) => sum + Number(value || 0), 0)
                : Number(config.stats?.[key] || 0);
              const active = filter === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(key)}
                  className={cn(
                    'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-medium transition-colors',
                    active
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <span>{label}</span>
                  <span
                    className={cn(
                      'min-w-5 rounded-full px-1.5 py-0.5 text-center text-[11px] font-semibold tabular-nums leading-none',
                      active
                        ? key === 'failed' && count > 0
                          ? 'bg-destructive/15 text-destructive'
                          : 'bg-muted text-foreground'
                        : key === 'failed' && count > 0
                          ? 'bg-destructive/10 text-destructive'
                          : 'bg-background/70 text-muted-foreground',
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="max-h-[520px] overflow-auto">
          {refreshing && jobs.length === 0 ? <SkeletonRows /> : null}
          {!refreshing && jobs.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">Aún no hay descuentos en cola.</p>
          ) : null}
          {jobs.length > 0 && shownJobs.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">Nada en este filtro.</p>
          ) : null}
          {shownJobs.length > 0 ? (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-5 py-2.5 font-medium">Empresa</th>
                  <th className="px-5 py-2.5 font-medium">Orden</th>
                  <th className="px-5 py-2.5 font-medium">Estado</th>
                  <th className="px-5 py-2.5 font-medium">Origen</th>
                  <th className="px-5 py-2.5 font-medium">Detalle</th>
                  <th className="px-5 py-2.5 font-medium">Cuándo</th>
                </tr>
              </thead>
              <tbody>
                {shownJobs.map((job) => {
                  const failed = job.status === 'failed';
                  const canRetry = failed || job.status === 'skipped';
                  return (
                    <tr key={job.id} className="border-b border-border/50 last:border-0 hover:bg-accent/30">
                      <td className="px-5 py-2.5 text-foreground">{job.company}</td>
                      <td className="px-5 py-2.5"><SearchableOrderNumber job={job} /></td>
                      <td className="px-5 py-2.5"><StatusBadge status={job.status} /></td>
                      <td className="px-5 py-2.5"><SourceBadge source={job.source} /></td>
                      <td className="px-5 py-2.5 text-xs">
                        <span className={failed ? 'text-red-600' : 'text-muted-foreground'} title={job.last_error || undefined}>
                          {formatJobDetail(job)}
                        </span>
                        {job.attempts > 1 && <span className="ml-1 text-muted-foreground opacity-60">(intento {job.attempts})</span>}
                        {canRetry && (
                          <button
                            onClick={() => retryJob(job.id)}
                            title="Volver a intentar"
                            className="ml-2 inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
                          >
                            <RotateCcw className="h-3 w-3" /> Reintentar
                          </button>
                        )}
                      </td>
                      <td className="px-5 py-2.5 whitespace-nowrap text-xs text-muted-foreground">
                        <span className="block text-foreground">{fullDateTime(job.updated_at)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}
        </div>
      </div>
    </div>
  );
}
