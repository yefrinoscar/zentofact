import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  RefreshCw, Copy, Check, AlertTriangle, CheckCircle2, XCircle, Clock, Loader2,
  Radio, ChevronDown, Settings as SettingsIcon, Search, Building2, Pause, Play, RotateCcw,
  Plus, Trash2,
} from 'lucide-react';
import api from '../lib/api';
import { cn } from '../lib/cn';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '../components/ui/select';
import { Switch } from '../components/ui/switch';

type CompanyCfg = { id: number; nombre: string; ruc: string; hasFalabella: boolean; enabled: boolean };
type CronCfg = { enabled: boolean; intervalMinutes: number; windowDays: number };
type Config = {
  globalEnabled: boolean; dryRun: boolean; sunatEnv: 'beta' | 'produccion' | 'segun-empresa'; reconcileEnabled: boolean;
  paused: boolean; stats: Record<string, number>; cron: CronCfg;
  companies: CompanyCfg[]; webhookBase: string; webhookSecretSet: boolean;
};
type Job = {
  id: number; company: string; order_number: string; order_id: string | null;
  status: string; source: string; attempts: number; result: string | null;
  last_error: string | null; boleta_numero: string | null; current_step?: string | null; updated_at: string;
};
type OrderPreview = {
  error?: string;
  source?: string;
  order?: {
    orderNumber?: string;
    customer?: string;
    status?: string;
    total?: string | number | null;
    createdAt?: string;
    updatedAt?: string;
    paymentMethod?: string;
    itemsCount?: string | number;
    invoiceRequired?: boolean;
  };
  document?: {
    boleta?: { numeroCompleto?: string; estadoSunat?: string; total?: string | number | null } | null;
    factura?: { numeroCompleto?: string; estadoSunat?: string; total?: string | number | null } | null;
  } | null;
};
type Evt = { id: number; company: string; company_id?: number; order_number: string | null; event: string; processed: boolean; received_at: string };
type FalabellaWebhook = {
  webhookId: string;
  callbackUrl: string;
  webhookSource: string;
  events: string[];
  raw?: any;
};

const WEBHOOK_EVENTS = [
  { value: 'onOrderCreated', label: 'Orden creada' },
  { value: 'onOrderItemsStatusChanged', label: 'Cambio de estado de items' },
  { value: 'onFeedCreated', label: 'Feed creado' },
  { value: 'onFeedCompleted', label: 'Feed completado' },
  { value: 'onProductCreated', label: 'Producto creado' },
  { value: 'onProductUpdated', label: 'Producto actualizado' },
  { value: 'onProductQcStatusChanged', label: 'QC de producto modificado' },
];

const DEFAULT_WEBHOOK_EVENTS = ['onOrderCreated', 'onOrderItemsStatusChanged'];

function sunatLabel(env: string) {
  return env === 'beta' ? 'SUNAT beta' : env === 'produccion' ? 'SUNAT producción' : 'SUNAT (según empresa)';
}

const STATUS_STYLES: Record<string, { cls: string; icon: any; label: string }> = {
  done: { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle2, label: 'Emitida' },
  pending: { cls: 'bg-amber-50 text-amber-700 border-amber-200', icon: Clock, label: 'En cola' },
  processing: { cls: 'bg-blue-50 text-blue-700 border-blue-200', icon: Loader2, label: 'Procesando' },
  skipped: { cls: 'bg-slate-100 text-slate-600 border-slate-200', icon: XCircle, label: 'Omitida' },
  failed: { cls: 'bg-red-50 text-red-700 border-red-200', icon: AlertTriangle, label: 'Falló' },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.skipped;
  const Icon = s.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium', s.cls)}>
      <Icon className={cn('h-3 w-3', status === 'processing' && 'animate-spin')} />
      {s.label}
    </span>
  );
}

function SourceBadge({ source }: { source: string }) {
  const fromWebhook = source === 'webhook';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        fromWebhook
          ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
          : 'border-slate-200 bg-slate-50 text-slate-600',
      )}
      title={fromWebhook ? 'Encolado por callback de Falabella' : 'Encontrado por revisión automática'}
    >
      {fromWebhook ? 'Webhook' : 'Cron'}
    </span>
  );
}

function OrderPreviewCard({ preview, loading }: { preview: OrderPreview | null; loading: boolean }) {
  const order = preview?.order;
  const document = preview?.document?.boleta || preview?.document?.factura || null;
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
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{order.customer || 'Cliente no informado'}</p>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
            <span className="text-muted-foreground">Estado</span>
            <span className="truncate text-right font-medium text-foreground" title={order.status}>{order.status || '-'}</span>
            <span className="text-muted-foreground">Total</span>
            <span className="text-right font-medium text-foreground">{money(order.total)}</span>
            <span className="text-muted-foreground">Items</span>
            <span className="text-right text-foreground">{order.itemsCount || '-'}</span>
            <span className="text-muted-foreground">Creada</span>
            <span className="text-right text-foreground">{formatDateTime(order.createdAt)}</span>
            <span className="text-muted-foreground">Factura</span>
            <span className={cn('text-right font-medium', order.invoiceRequired ? 'text-amber-700' : 'text-emerald-700')}>
              {order.invoiceRequired ? 'Requerida' : 'No requerida'}
            </span>
          </div>
          {document && (
            <div className="rounded-md border border-border bg-muted/30 px-2.5 py-2 text-xs">
              <p className="font-medium text-foreground">{document.numeroCompleto}</p>
              <p className="mt-0.5 text-muted-foreground">{document.estadoSunat || 'Documento local'}{document.total ? ` · ${money(document.total)}` : ''}</p>
            </div>
          )}
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">Pasa el cursor para cargar la orden.</span>
      )}
    </div>
  );
}

function SearchableOrderNumber({ job }: { job: Job }) {
  const orderId = String(job.order_id || '').trim();
  const orderNumber = String(job.order_number || '').trim();
  const orderNumberIsFallbackId = !!orderId && orderId === orderNumber;
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
        const response = await api.autoEmitOrderPreview(job.id);
        setPreview(response?.error ? { error: response.error } : response);
      } catch (error: any) {
        setPreview({ error: error?.message || 'No se pudo cargar la orden.' });
      } finally {
        setLoading(false);
      }
    }, 180);
  };

  const hide = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    setOpen(false);
  };

  if (orderNumberIsFallbackId) {
    return <span className="text-xs text-muted-foreground">Resolviendo orden</span>;
  }
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
        {orderNumber || <span className="font-sans text-muted-foreground">Sin orden</span>}
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

function shortName(nombre: string) {
  return nombre.replace(/\s*(E\.?\s?I\.?\s?R\.?\s?L\.?|S\.?\s?R\.?\s?L\.?|S\.?\s?A\.?\s?C\.?|S\.?\s?A\.?)\.?\s*$/i, '').trim() || nombre;
}

function SkeletonRows() {
  return (
    <div className="divide-y divide-border/50">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-3.5">
          <div className="h-4 w-40 animate-pulse rounded bg-muted" />
          <div className="h-4 w-24 animate-pulse rounded bg-muted" />
          <div className="h-5 w-20 animate-pulse rounded-full bg-muted" />
          <div className="h-4 flex-1 animate-pulse rounded bg-muted" />
          <div className="h-4 w-12 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

function timeAgo(iso: string) {
  const d = new Date(iso).getTime();
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return `hace ${s}s`;
  if (s < 3600) return `hace ${Math.floor(s / 60)}m`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)}h`;
  return new Date(iso).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
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

function formatDateTime(value?: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace('T', ' ').slice(0, 16);
  return date.toLocaleString('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function money(value?: string | number | null) {
  const parsed = Number(String(value ?? '').replace(/,/g, ''));
  if (!Number.isFinite(parsed)) return '-';
  return new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(parsed);
}

const FILTERS = [
  ['all', 'Todas'], ['done', 'Emitidas'], ['pending', 'En cola'],
  ['processing', 'Procesando'], ['failed', 'Fallidas'], ['skipped', 'Omitidas'],
] as const;
const DEV_CRON_INTERVAL_SECONDS = 10 / 60;

export default function AutoEmision() {
  const [config, setConfig] = useState<Config | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [events, setEvents] = useState<Evt[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<string>('all');
  const [configOpen, setConfigOpen] = useState(false);
  const [webhookCompanyId, setWebhookCompanyId] = useState<number | null>(null);
  const [webhooks, setWebhooks] = useState<FalabellaWebhook[]>([]);
  const [webhooksLoading, setWebhooksLoading] = useState(false);
  const [webhookSaving, setWebhookSaving] = useState(false);
  const [webhookError, setWebhookError] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>(DEFAULT_WEBHOOK_EVENTS);
  const [webhookIdQuery, setWebhookIdQuery] = useState('');
  const [callbackUrl, setCallbackUrl] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const showDevCronInterval = ['localhost', '127.0.0.1'].includes(window.location.hostname);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  const loadConfig = useCallback(async () => {
    try { setConfig(await api.autoEmitGetConfig()); } catch { /* noop */ }
  }, []);

  const loadLogs = useCallback(async (spin = false) => {
    if (spin) setRefreshing(true);
    try {
      const [j, e] = await Promise.all([api.autoEmitJobs(60), api.autoEmitEvents(40)]);
      setJobs(j || []); setEvents(e || []);
    } catch { /* noop */ }
    finally { if (spin) setRefreshing(false); }
  }, []);

  useEffect(() => {
    (async () => { await Promise.all([loadConfig(), loadLogs()]); setLoading(false); })();
  }, [loadConfig, loadLogs]);

  // Auto-actualización de la lista cada 3s (siempre en vivo).
  useEffect(() => {
    timer.current = window.setInterval(loadLogs, 3000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [loadLogs]);

  const setEnabled = async (id: number, enabled: boolean) => {
    const flip = (val: boolean) => setConfig((prev) => prev
      ? { ...prev, companies: prev.companies.map((c) => (c.id === id ? { ...c, enabled: val } : c)) } : prev);
    flip(enabled);
    try {
      await api.autoEmitSetCompany(id, enabled);
      await Promise.all([loadConfig(), loadLogs()]);
    } catch { flip(!enabled); }
  };

  const togglePaused = async () => {
    if (!config) return;
    const next = !config.paused;
    setConfig((prev) => (prev ? { ...prev, paused: next } : prev));
    try { await api.autoEmitSetPaused(next); } catch { setConfig((prev) => (prev ? { ...prev, paused: !next } : prev)); }
  };

  const setDryRun = async (dryRun: boolean) => {
    if (!config || dryRun === config.dryRun) return;
    if (!dryRun && !window.confirm(
      `¿Activar EMISIÓN real?\n\nCada orden que cumpla condiciones se emitirá como comprobante REAL a ${sunatLabel(config.sunatEnv)} y se subirá a Falabella. Cada comprobante es irreversible.\n\n¿Continuar?`
    )) return;
    setConfig((prev) => (prev ? { ...prev, dryRun } : prev));
    try { await api.autoEmitSetDryRun(dryRun); } catch { setConfig((prev) => (prev ? { ...prev, dryRun: !dryRun } : prev)); }
  };

  const setCron = async (patch: Partial<CronCfg>) => {
    if (!config) return;
    const next = { ...config.cron, ...patch };
    setConfig((prev) => (prev ? { ...prev, cron: next } : prev));
    try { await api.autoEmitSetCron(patch); } catch { setConfig((prev) => (prev ? { ...prev, cron: config.cron } : prev)); }
  };

  const webhookCompanies = config?.companies.filter((company) => company.hasFalabella) || [];
  const selectedWebhookCompanyId = webhookCompanyId || webhookCompanies[0]?.id || null;
  const selectedWebhookCompany = webhookCompanies.find((company) => company.id === selectedWebhookCompanyId) || null;

  const defaultCallbackUrl = selectedWebhookCompanyId
    ? `${config?.webhookBase || ''}/${selectedWebhookCompanyId}${config?.webhookSecretSet ? '?secret=***' : ''}`
    : '';
  const customCallbackUrl = callbackUrl.trim();
  const previewCallbackUrl = customCallbackUrl || defaultCallbackUrl;

  const loadWebhooks = useCallback(async (companyId = selectedWebhookCompanyId, ids?: string[]) => {
    if (!companyId) return;
    setWebhooksLoading(true);
    setWebhookError('');
    try {
      const response = await api.autoEmitGetWebhooks(companyId, ids);
      if (response?.error) throw new Error(typeof response.error === 'string' ? response.error : response.error?.Head?.ErrorMessage || 'Falabella devolvió un error.');
      setWebhooks(response?.webhooks || []);
    } catch (error: any) {
      setWebhookError(error?.message || 'No se pudieron consultar los webhooks de Falabella.');
      setWebhooks([]);
    } finally {
      setWebhooksLoading(false);
    }
  }, [selectedWebhookCompanyId]);

  useEffect(() => {
    if (!configOpen || !selectedWebhookCompanyId) return;
    void loadWebhooks(selectedWebhookCompanyId);
  }, [configOpen, selectedWebhookCompanyId, loadWebhooks]);

  const toggleWebhookEvent = (event: string) => {
    setSelectedEvents((current) => (
      current.includes(event)
        ? current.filter((item) => item !== event)
        : [...current, event]
    ));
  };

  const createWebhook = async () => {
    if (!selectedWebhookCompanyId || !selectedEvents.length) return;
    if (!customCallbackUrl && !config?.webhookSecretSet) {
      setWebhookError('Falta el secreto del webhook o una URL callback personalizada.');
      return;
    }
    if (/localhost|127\.0\.0\.1/i.test(previewCallbackUrl) && !window.confirm(
      'La URL callback es local. Falabella no podrá llamarla desde internet. ¿Crear de todas formas para prueba?'
    )) return;
    setWebhookSaving(true);
    setWebhookError('');
    try {
      const response = await api.autoEmitCreateWebhook(selectedWebhookCompanyId, selectedEvents, customCallbackUrl || undefined);
      if (response?.error) throw new Error(typeof response.error === 'string' ? response.error : response.error?.Head?.ErrorMessage || 'Falabella rechazó la creación del webhook.');
      await loadWebhooks(selectedWebhookCompanyId);
    } catch (error: any) {
      setWebhookError(error?.message || 'No se pudo crear el webhook en Falabella.');
    } finally {
      setWebhookSaving(false);
    }
  };

  const consultWebhooks = () => {
    const ids = webhookIdQuery
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    void loadWebhooks(selectedWebhookCompanyId || undefined, ids.length ? ids : undefined);
  };

  const deleteWebhook = async (webhookId: string) => {
    if (!selectedWebhookCompanyId || !webhookId) return;
    if (!window.confirm(`¿Eliminar webhook ${webhookId}?`)) return;
    setWebhookSaving(true);
    setWebhookError('');
    try {
      const response = await api.autoEmitDeleteWebhook(selectedWebhookCompanyId, webhookId);
      if (response?.error) throw new Error(typeof response.error === 'string' ? response.error : response.error?.Head?.ErrorMessage || 'Falabella rechazó la eliminación del webhook.');
      await loadWebhooks(selectedWebhookCompanyId);
    } catch (error: any) {
      setWebhookError(error?.message || 'No se pudo eliminar el webhook en Falabella.');
    } finally {
      setWebhookSaving(false);
    }
  };

  const retryJob = async (id: number) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, status: 'pending', last_error: null } : j)));
    try { await api.autoEmitRetryJob(id); } catch { /* noop */ }
    await Promise.all([loadLogs(), loadConfig()]);
  };

  const copyWebhook = async () => {
    if (!config) return;
    try { await navigator.clipboard.writeText(`${config.webhookBase}/{companyId}?secret=***`); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Cargando…</div>;
  }
  if (!config) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">No se pudo cargar la emisión automática.</div>;
  }

  const activeCompanies = config.companies.filter((c) => c.enabled);
  const emitClass = config.sunatEnv === 'beta' ? 'bg-blue-500' : 'bg-red-500';

  return (
    <div className="space-y-5">
      {/* Barra superior */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Empresas (multiselect) */}
        <div ref={menuRef} className="relative shrink-0">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card pl-3 pr-2.5 text-sm font-medium text-foreground shadow-sm transition hover:bg-accent"
          >
            <Building2 className="h-4 w-4 text-muted-foreground" />
            Empresas
            {activeCompanies.length > 0 && (
              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold text-emerald-700">{activeCompanies.length}</span>
            )}
            <ChevronDown className={cn('h-4 w-4 opacity-50 transition-transform', menuOpen && 'rotate-180')} />
          </button>
          {menuOpen && (
            <div className="absolute left-0 z-30 mt-2 w-[340px] overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
              <div className="flex items-center gap-2 border-b border-border px-3">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input
                  autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar empresa…"
                  className="h-10 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
              </div>
              <div className="max-h-[300px] overflow-auto p-1">
                {config.companies.filter((c) => `${c.nombre} ${c.ruc}`.toLowerCase().includes(search.toLowerCase())).map((c) => (
                  <button
                    key={c.id} onClick={() => c.hasFalabella && setEnabled(c.id, !c.enabled)} disabled={!c.hasFalabella}
                    title={!c.hasFalabella ? 'Configura las credenciales Falabella primero' : ''}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span className={cn('grid h-4 w-4 shrink-0 place-items-center rounded border transition', c.enabled ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-input')}>
                      {c.enabled && <Check className="h-3 w-3" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-foreground">{c.nombre}</span>
                      <span className="block truncate text-xs text-muted-foreground">RUC {c.ruc}{!c.hasFalabella && ' · sin Falabella'}</span>
                    </span>
                  </button>
                ))}
                {config.companies.filter((c) => `${c.nombre} ${c.ruc}`.toLowerCase().includes(search.toLowerCase())).length === 0 && (
                  <p className="px-3 py-6 text-center text-sm text-muted-foreground">Sin resultados.</p>
                )}
              </div>
              {activeCompanies.length > 0 && (
                <div className="border-t border-border p-1">
                  <button onClick={() => activeCompanies.forEach((c) => setEnabled(c.id, false))} className="w-full rounded-lg px-2.5 py-2 text-center text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground">
                    Limpiar selección
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modo (simular/emitir) + pausar + configuración */}
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center rounded-lg bg-muted p-0.5">
            <button
              onClick={() => setDryRun(true)}
              className={cn('rounded-md px-3 py-1.5 text-xs font-medium transition', config.dryRun ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
            >Simular</button>
            <button
              onClick={() => setDryRun(false)}
              title={`Emitir de verdad a ${sunatLabel(config.sunatEnv)}`}
              className={cn('rounded-md px-3 py-1.5 text-xs font-medium transition', !config.dryRun ? cn(emitClass, 'text-white shadow-sm') : 'text-muted-foreground hover:text-foreground')}
            >Emitir</button>
          </div>
          {config.dryRun && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5" /> Solo simula · no envía
            </span>
          )}

          <button
            onClick={togglePaused}
            title={config.paused ? 'Cola pausada. Clic para reanudar.' : 'Pausar el procesamiento de la cola.'}
            className={cn('inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition',
              config.paused ? 'border-amber-300 bg-amber-100 text-amber-800 hover:bg-amber-200' : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground')}
          >
            {config.paused ? <><Play className="h-4 w-4" /> Reanudar</> : <><Pause className="h-4 w-4" /> Pausar cola</>}
          </button>
          <button
            onClick={() => setConfigOpen(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <SettingsIcon className="h-4 w-4" /> Configuración
          </button>
        </div>
      </div>

      {/* Aviso: cola pausada */}
      {config.paused && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <Pause className="h-4 w-4 shrink-0" />
          <span className="font-medium">Cola pausada.</span> No se procesan emisiones. Los webhooks siguen encolándose.
        </div>
      )}

      {/* Emisiones */}
      <div className="rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Emisiones automáticas</h2>
            <p className="text-xs text-muted-foreground">Boletas y facturas de las órdenes que llegan de Falabella.</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" title="La lista se actualiza sola cada 3s">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> En vivo
            </span>
            <button onClick={() => loadLogs(true)} disabled={refreshing} className="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-60" title="Refrescar ahora">
              <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
            </button>
          </div>
        </div>

        {/* Filtro por estado (tabs shadcn) */}
        <div className="border-b border-border px-5 py-3">
          <Tabs value={filter} onValueChange={setFilter}>
            <TabsList className="flex-wrap">
              {FILTERS.map(([key, label]) => {
                const count = key === 'all' ? Object.values(config.stats || {}).reduce((a, b) => a + b, 0) : (config.stats?.[key] || 0);
                return (
                  <TabsTrigger key={key} value={key}>
                    {label}
                    <span className={cn('rounded-full px-1.5 text-[11px]', key === 'failed' && count > 0 ? 'bg-red-200 text-red-800' : 'bg-muted-foreground/15 text-muted-foreground')}>{count}</span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
        </div>

        <div className="max-h-[520px] overflow-auto">
          {(() => {
            const shownJobs = filter === 'all' ? jobs : jobs.filter((j) => j.status === filter);
            if (refreshing && jobs.length === 0) return <SkeletonRows />;
            if (jobs.length === 0) return <p className="p-10 text-center text-sm text-muted-foreground">Aún no hay emisiones automáticas.</p>;
            if (shownJobs.length === 0) return <p className="p-10 text-center text-sm text-muted-foreground">Nada en este filtro.</p>;
            return (
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
                  {shownJobs.map((j) => {
                    const failed = j.status === 'failed';
                    return (
                      <tr key={j.id} className="border-b border-border/50 last:border-0 hover:bg-accent/30">
                        <td className="px-5 py-2.5 text-foreground">{j.company}</td>
                        <td className="px-5 py-2.5"><SearchableOrderNumber job={j} /></td>
                        <td className="px-5 py-2.5"><StatusBadge status={j.status} /></td>
                        <td className="px-5 py-2.5"><SourceBadge source={j.source} /></td>
                        <td className="px-5 py-2.5 text-xs">
                          {j.boleta_numero && <span className="font-medium text-foreground">{j.boleta_numero} </span>}
                          <span className={failed ? 'text-red-600' : 'text-muted-foreground'} title={j.last_error || undefined}>
                            {j.last_error || j.result || (j.current_step ? `Etapa: ${j.current_step}` : <span className="opacity-50">—</span>)}
                          </span>
                          {j.attempts > 1 && <span className="ml-1 text-muted-foreground opacity-60">(intento {j.attempts})</span>}
                          {(failed || j.status === 'skipped') && (
                            <button onClick={() => retryJob(j.id)} title="Volver a intentar" className="ml-2 inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground">
                              <RotateCcw className="h-3 w-3" /> Reintentar
                            </button>
                          )}
                        </td>
                        <td className="px-5 py-2.5 whitespace-nowrap text-xs text-muted-foreground" title={timeAgo(j.updated_at)}>
                          <span className="block text-foreground">{fullDateTime(j.updated_at)}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            );
          })()}
        </div>
      </div>

      {/* Configuración (modal con tabs) */}
      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogContent className="max-h-[88vh] max-w-5xl overflow-hidden">
          <DialogHeader><DialogTitle>Configuración</DialogTitle></DialogHeader>
          <div className="max-h-[calc(88vh-66px)] overflow-auto p-5">
            <Tabs defaultValue="cron">
              <TabsList className="mb-4">
                <TabsTrigger value="cron">Revisión automática</TabsTrigger>
                <TabsTrigger value="webhook">Webhook</TabsTrigger>
              </TabsList>

              {/* Cron */}
              <TabsContent value="cron" className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">Red de seguridad</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">Revisa Falabella cada cierto tiempo y encola las órdenes listas que el webhook no haya atrapado.</p>
                  </div>
                  <Switch checked={config.cron.enabled} onCheckedChange={(v) => setCron({ enabled: v })} />
                </div>
                {config.cron.enabled && (
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <span>Revisar</span>
                    <Select value={String(config.cron.intervalMinutes)} onValueChange={(v) => setCron({ intervalMinutes: Number(v) })}>
                      <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(showDevCronInterval ? [DEV_CRON_INTERVAL_SECONDS, 15, 30, 60, 120, 240, 360, 720] : [15, 30, 60, 120, 240, 360, 720]).map((m) => (
                          <SelectItem key={m} value={String(m)}>cada {m < 1 ? `${Math.round(m * 60)}s` : m < 60 ? `${m} min` : `${m / 60} h`}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span>los últimos</span>
                    <Select value={String(config.cron.windowDays)} onValueChange={(v) => setCron({ windowDays: Number(v) })}>
                      <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, 5, 7, 15, 30].map((d) => (
                          <SelectItem key={d} value={String(d)}>{d} día{d > 1 ? 's' : ''}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </TabsContent>

              {/* Webhook */}
              <TabsContent value="webhook" className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">Webhook de Falabella</p>
                  {config.webhookSecretSet
                    ? <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><Check className="h-3.5 w-3.5" /> secreto ok</span>
                    : <span className="inline-flex items-center gap-1 text-xs text-red-600"><AlertTriangle className="h-3.5 w-3.5" /> falta secreto</span>}
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-xs text-foreground">
                  <span className="truncate">{config.webhookBase}/<span className="text-muted-foreground">{'{companyId}'}</span>?secret=<span className="text-muted-foreground">***</span></span>
                  <button onClick={copyWebhook} className="ml-auto shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="Copiar">
                    {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">Regístralo en el portal de Falabella para el evento <code className="rounded bg-muted px-1">onOrderItemsStatusChanged</code>.</p>

                <div className="rounded-xl border border-border bg-background p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">Gestor de webhooks en Falabella</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">Crea, consulta y elimina los webhooks registrados en Seller Center.</p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)_auto] lg:items-end">
                    <div className="min-w-0">
                      <p className="mb-1.5 text-xs font-medium text-muted-foreground">Empresa</p>
                      <Select
                        value={selectedWebhookCompanyId ? String(selectedWebhookCompanyId) : ''}
                        onValueChange={(value) => setWebhookCompanyId(Number(value))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecciona empresa" />
                        </SelectTrigger>
                        <SelectContent>
                          {webhookCompanies.map((company) => (
                            <SelectItem key={company.id} value={String(company.id)}>
                              {shortName(company.nombre)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <label className="mt-3 block">
                        <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Consultar por ID</span>
                        <input
                          value={webhookIdQuery}
                          onChange={(event) => setWebhookIdQuery(event.target.value)}
                          placeholder="Opcional, separados por coma"
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
                        />
                      </label>
                    </div>

                    <div className="min-w-0">
                      <p className="mb-1.5 text-xs font-medium text-muted-foreground">Eventos</p>
                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {WEBHOOK_EVENTS.map((event) => {
                          const checked = selectedEvents.includes(event.value);
                          return (
                            <button
                              key={event.value}
                              type="button"
                              onClick={() => toggleWebhookEvent(event.value)}
                              className={cn(
                                'inline-flex min-h-9 items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs font-medium transition',
                                checked ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
                              )}
                            >
                              <span className={cn('grid h-3.5 w-3.5 place-items-center rounded border', checked ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-input')}>
                                {checked && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                              </span>
                              {event.label}
                            </button>
                          );
                        })}
                      </div>
                      <label className="mt-3 block">
                        <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Callback personalizado</span>
                        <input
                          value={callbackUrl}
                          onChange={(event) => setCallbackUrl(event.target.value)}
                          placeholder={defaultCallbackUrl || 'Se genera con el secreto local'}
                          className="h-9 w-full rounded-md border border-input bg-background px-3 font-mono text-xs text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
                        />
                      </label>
                    </div>

                    <div className="flex gap-2 lg:flex-col">
                      <button
                        onClick={consultWebhooks}
                        disabled={!selectedWebhookCompanyId || webhooksLoading}
                        className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <RefreshCw className={cn('h-3.5 w-3.5', webhooksLoading && 'animate-spin')} />
                        Consultar
                      </button>
                      <button
                        onClick={createWebhook}
                        disabled={!selectedWebhookCompanyId || !selectedEvents.length || webhookSaving || (!config.webhookSecretSet && !customCallbackUrl)}
                        className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {webhookSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                        Crear
                      </button>
                    </div>
                  </div>

                  {webhookError && (
                    <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                      {webhookError}
                    </div>
                  )}

                  <div className="mt-4 overflow-hidden rounded-lg border border-border">
                    {webhooksLoading ? (
                      <div className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Consultando Falabella…
                      </div>
                    ) : webhooks.length === 0 ? (
                      <p className="px-3 py-6 text-center text-sm text-muted-foreground">No hay webhooks registrados para esta empresa.</p>
                    ) : (
                      <div className="max-h-56 overflow-auto divide-y divide-border">
                        {webhooks.map((webhook) => (
                          <div key={webhook.webhookId || webhook.callbackUrl} className="grid gap-3 px-3 py-3 text-xs md:grid-cols-[160px_minmax(0,1fr)_auto] md:items-start">
                            <div className="min-w-0">
                              <span className="block font-mono font-semibold text-foreground">{webhook.webhookId || 'sin ID'}</span>
                              {webhook.webhookSource && <span className="mt-1 inline-flex rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{webhook.webhookSource}</span>}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate font-mono text-muted-foreground" title={webhook.callbackUrl}>{webhook.callbackUrl || '-'}</p>
                              <div className="mt-2 flex flex-wrap gap-1">
                                {webhook.events.length ? webhook.events.map((event) => (
                                  <span key={event} className="rounded-full bg-blue-50 px-2 py-0.5 font-medium text-blue-700">{event}</span>
                                )) : <span className="text-muted-foreground">Sin eventos informados</span>}
                              </div>
                            </div>
                            <button
                              onClick={() => deleteWebhook(webhook.webhookId)}
                              disabled={!webhook.webhookId || webhookSaving}
                              className="inline-flex h-8 items-center gap-1.5 self-start rounded-md border border-red-200 px-2.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Eliminar
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <p className="mb-1.5 text-xs font-medium text-foreground">Últimos webhooks recibidos</p>
                  <div className="max-h-40 space-y-0.5 overflow-auto">
                    {events.length === 0
                      ? <p className="py-3 text-center text-xs text-muted-foreground">Sin eventos todavía.</p>
                      : events.map((e) => (
                        <div key={e.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent/50">
                          <Radio className="h-3 w-3 shrink-0 text-blue-500" />
                          <span className="truncate text-foreground">{e.company || `Empresa ${e.company_id ?? ''}`}</span>
                          <span className="truncate text-muted-foreground">· orden {e.order_number || '—'}</span>
                          <span className="ml-auto shrink-0 text-muted-foreground">{timeAgo(e.received_at)}</span>
                        </div>
                      ))}
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
