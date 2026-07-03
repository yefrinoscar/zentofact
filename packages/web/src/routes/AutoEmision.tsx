import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Zap, ZapOff, RefreshCw, Play, Copy, Check, AlertTriangle,
  CheckCircle2, XCircle, Clock, Loader2, Radio, ChevronDown, Settings as SettingsIcon,
  Search, Building2, Pause, RotateCcw,
} from 'lucide-react';
import api from '../lib/api';

type CompanyCfg = { id: number; nombre: string; ruc: string; hasFalabella: boolean; enabled: boolean };
type Config = {
  globalEnabled: boolean; dryRun: boolean; reconcileEnabled: boolean;
  paused: boolean; stats: Record<string, number>;
  companies: CompanyCfg[]; webhookBase: string; webhookSecretSet: boolean;
};
type Job = {
  id: number; company: string; order_number: string; order_id: string | null;
  status: string; source: string; attempts: number; result: string | null;
  last_error: string | null; boleta_numero: string | null; updated_at: string;
};
type Evt = { id: number; company: string; order_number: string | null; event: string; processed: boolean; received_at: string };

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
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${s.cls}`}>
      <Icon className={`h-3 w-3 ${status === 'processing' ? 'animate-spin' : ''}`} />
      {s.label}
    </span>
  );
}

// Nombre corto para resúmenes (quita el tipo societario).
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

export default function AutoEmision() {
  const [config, setConfig] = useState<Config | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [events, setEvents] = useState<Evt[]>([]);
  const [live, setLive] = useState(true);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<string>('all');
  const [configOpen, setConfigOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  const loadConfig = useCallback(async () => {
    try { setConfig(await api.autoEmitGetConfig()); } catch (e) { /* noop */ }
  }, []);

  const loadLogs = useCallback(async (spin = false) => {
    if (spin) setRefreshing(true);
    try {
      const [j, e] = await Promise.all([api.autoEmitJobs(60), api.autoEmitEvents(40)]);
      setJobs(j || []); setEvents(e || []);
    } catch (e) { /* noop */ }
    finally { if (spin) setRefreshing(false); }
  }, []);

  useEffect(() => {
    (async () => { await Promise.all([loadConfig(), loadLogs()]); setLoading(false); })();
  }, [loadConfig, loadLogs]);

  useEffect(() => {
    if (!live) { if (timer.current) window.clearInterval(timer.current); return; }
    timer.current = window.setInterval(loadLogs, 3000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [live, loadLogs]);

  // Optimista: refleja el cambio al instante; si el servidor falla, revierte.
  const setEnabled = async (id: number, enabled: boolean) => {
    const flip = (val: boolean) => setConfig((prev) => prev
      ? { ...prev, companies: prev.companies.map((c) => (c.id === id ? { ...c, enabled: val } : c)) }
      : prev);
    flip(enabled);
    try {
      await api.autoEmitSetCompany(id, enabled);
    } catch {
      flip(!enabled); // revertir al estado anterior
    }
  };

  const runNow = async () => {
    setRunning(true);
    try { await api.autoEmitRun(5); await loadLogs(); } finally { setRunning(false); }
  };

  // Pausa/reanuda la cola (optimista).
  const togglePaused = async () => {
    if (!config) return;
    const next = !config.paused;
    setConfig((prev) => (prev ? { ...prev, paused: next } : prev));
    try { await api.autoEmitSetPaused(next); } catch { setConfig((prev) => (prev ? { ...prev, paused: !next } : prev)); }
  };

  // Reintenta un job fallido/omitido (optimista → pending).
  const retryJob = async (id: number) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, status: 'pending', last_error: null } : j)));
    try { await api.autoEmitRetryJob(id); } catch { /* noop */ }
    await Promise.all([loadLogs(), loadConfig()]);
  };

  const copyWebhook = async () => {
    if (!config) return;
    const url = `${config.webhookBase}/{companyId}?secret=***`;
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Cargando…</div>;
  }
  if (!config) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">No se pudo cargar la configuración de emisión automática.</div>;
  }

  const activeCompanies = config.companies.filter((c) => c.enabled);

  return (
    <div className="space-y-5">
      {/* Barra superior: dropdown de empresas (switch por empresa) + acceso a Configuración */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div ref={menuRef} className="relative shrink-0">
            {/* Trigger tipo faceted-filter shadcn */}
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card pl-3 pr-2.5 text-sm font-medium text-foreground shadow-sm transition hover:bg-accent"
            >
              <Building2 className="h-4 w-4 text-muted-foreground" />
              Empresas
              {activeCompanies.length > 0 && (
                <>
                  <span className="mx-0.5 h-5 w-px bg-border" />
                  {activeCompanies.length <= 2 ? (
                    <span className="flex items-center gap-1">
                      {activeCompanies.map((c) => (
                        <span key={c.id} className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700">{shortName(c.nombre)}</span>
                      ))}
                    </span>
                  ) : (
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold text-emerald-700">{activeCompanies.length} activas</span>
                  )}
                </>
              )}
              <ChevronDown className={`h-4 w-4 opacity-50 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Popover tipo command shadcn: buscador + filas con checkbox */}
            {menuOpen && (
              <div className="absolute left-0 z-30 mt-2 w-[340px] overflow-hidden rounded-xl border border-border bg-card shadow-xl">
                <div className="flex items-center gap-2 border-b border-border px-3">
                  <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <input
                    autoFocus
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar empresa…"
                    className="h-10 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                  />
                </div>
                <div className="max-h-[300px] overflow-auto p-1">
                  {config.companies
                    .filter((c) => `${c.nombre} ${c.ruc}`.toLowerCase().includes(search.toLowerCase()))
                    .map((c) => (
                      <button
                        key={c.id}
                        onClick={() => c.hasFalabella && setEnabled(c.id, !c.enabled)}
                        disabled={!c.hasFalabella}
                        title={!c.hasFalabella ? 'Configura las credenciales Falabella primero' : ''}
                        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <span className={`grid h-4 w-4 shrink-0 place-items-center rounded border transition ${c.enabled ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-input'}`}>
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
                    <button
                      onClick={() => activeCompanies.forEach((c) => setEnabled(c.id, false))}
                      className="w-full rounded-lg px-2.5 py-2 text-center text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
                    >
                      Limpiar selección
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {config.dryRun && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
              <AlertTriangle className="h-3.5 w-3.5" /> Modo prueba
            </span>
          )}
          {/* Prender / apagar la cola en caliente */}
          <button
            onClick={togglePaused}
            title={config.paused ? 'La cola está pausada: no se procesan emisiones. Clic para reanudar.' : 'Pausar el procesamiento de la cola sin apagar el servidor.'}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition ${
              config.paused
                ? 'border-amber-300 bg-amber-100 text-amber-800 hover:bg-amber-200'
                : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
            }`}
          >
            {config.paused ? <><Play className="h-4 w-4" /> Reanudar cola</> : <><Pause className="h-4 w-4" /> Pausar cola</>}
          </button>
          <button
            onClick={() => setConfigOpen((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition ${configOpen ? 'border-border bg-accent text-foreground' : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'}`}
          >
            <SettingsIcon className="h-4 w-4" /> Configuración
          </button>
        </div>
      </div>

      {/* Aviso: cola pausada */}
      {config.paused && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <Pause className="h-4 w-4 shrink-0" />
          <span className="font-medium">Cola pausada.</span> No se procesan emisiones hasta que la reanudes. Los webhooks siguen encolándose.
        </div>
      )}

      {/* Panel de Configuración (oculto por defecto) */}
      {configOpen && (
        <div className="space-y-4 rounded-2xl border border-border bg-muted/30 p-5">
          {/* Estado del servidor */}
          <div className="flex flex-wrap items-center gap-3">
            <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${config.globalEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
              {config.globalEnabled ? <Zap className="h-3.5 w-3.5" /> : <ZapOff className="h-3.5 w-3.5" />}
              {config.globalEnabled ? 'Servidor activo' : 'Servidor apagado (falta AUTO_EMIT_ENABLED=true)'}
            </span>
            {config.globalEnabled && <span className="text-xs text-muted-foreground">worker cada 20s · red de seguridad {config.reconcileEnabled ? 'ON' : 'OFF'}</span>}
            <button
              onClick={runNow}
              disabled={running}
              title="Fuerza la revisión de la cola ahora mismo (normalmente es cada 20s). Útil para pruebas."
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Revisar cola ahora
            </button>
          </div>

          {/* Webhook */}
          <div>
            <div className="mb-1.5 flex items-center gap-2">
              <span className="text-xs font-semibold text-foreground">Webhook de Falabella</span>
              {config.webhookSecretSet
                ? <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><Check className="h-3 w-3" /> secreto ok</span>
                : <span className="inline-flex items-center gap-1 text-xs text-red-600"><AlertTriangle className="h-3 w-3" /> falta secreto</span>}
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 font-mono text-xs text-foreground">
              <span className="truncate">{config.webhookBase}/<span className="text-muted-foreground">{'{companyId}'}</span>?secret=<span className="text-muted-foreground">***</span></span>
              <button onClick={copyWebhook} className="ml-auto shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="Copiar">
                {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">Regístralo en el portal de Falabella para el evento <code className="rounded bg-muted px-1">onOrderItemsStatusChanged</code>.</p>
          </div>

          {/* Webhooks recibidos (diagnóstico) */}
          <div>
            <p className="mb-1.5 text-xs font-semibold text-foreground">Últimos webhooks recibidos</p>
            <div className="max-h-40 space-y-0.5 overflow-auto rounded-lg border border-border bg-card p-1">
              {events.length === 0
                ? <p className="px-3 py-3 text-center text-xs text-muted-foreground">Sin eventos todavía.</p>
                : events.map((e) => (
                  <div key={e.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-xs">
                    <Radio className="h-3 w-3 shrink-0 text-blue-500" />
                    <span className="truncate text-foreground">{e.company || `Empresa ${e.company_id ?? ''}`}</span>
                    <span className="truncate text-muted-foreground">· orden {e.order_number || '—'}</span>
                    <span className="ml-auto shrink-0 text-muted-foreground">{timeAgo(e.received_at)}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Emisiones (cola) — lo principal */}
      <div className="rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Emisiones automáticas</h2>
            <p className="text-xs text-muted-foreground">Boletas emitidas por las órdenes que llegan de Falabella.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setLive((v) => !v)} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${live ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-border text-muted-foreground'}`}>
              <Radio className={`h-3 w-3 ${live ? 'animate-pulse' : ''}`} /> {live ? 'En vivo' : 'Pausado'}
            </button>
            <button onClick={() => loadLogs(true)} disabled={refreshing} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-60" title="Refrescar"><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /></button>
          </div>
        </div>
        {/* Resumen por estado (clic para filtrar) */}
        <div className="flex flex-wrap gap-2 border-b border-border px-5 py-3">
          {([['all', 'Todas'], ['done', 'Emitidas'], ['pending', 'En cola'], ['processing', 'Procesando'], ['failed', 'Fallidas'], ['skipped', 'Omitidas']] as const).map(([key, label]) => {
            const count = key === 'all'
              ? Object.values(config.stats || {}).reduce((a, b) => a + b, 0)
              : (config.stats?.[key] || 0);
            const active = filter === key;
            const isFail = key === 'failed';
            return (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                  active
                    ? isFail ? 'border-red-300 bg-red-100 text-red-700' : 'border-foreground/20 bg-accent text-foreground'
                    : 'border-border text-muted-foreground hover:bg-accent'
                }`}
              >
                {label}
                <span className={`rounded-full px-1.5 ${isFail && count > 0 ? 'bg-red-200 text-red-800' : 'bg-muted text-muted-foreground'}`}>{count}</span>
              </button>
            );
          })}
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
                      <td className="px-5 py-2.5 font-mono text-xs text-muted-foreground">{j.order_number}</td>
                      <td className="px-5 py-2.5"><StatusBadge status={j.status} /></td>
                      <td className="px-5 py-2.5 text-xs">
                        {j.boleta_numero && <span className="font-medium text-foreground">{j.boleta_numero} </span>}
                        <span className={failed ? 'text-red-600' : 'text-muted-foreground'} title={j.last_error || undefined}>
                          {j.last_error || j.result || <span className="opacity-50">—</span>}
                        </span>
                        {j.attempts > 1 && <span className="ml-1 text-muted-foreground opacity-60">(intento {j.attempts})</span>}
                        {(failed || j.status === 'skipped') && (
                          <button
                            onClick={() => retryJob(j.id)}
                            title="Volver a intentar esta emisión"
                            className="ml-2 inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
                          >
                            <RotateCcw className="h-3 w-3" /> Reintentar
                          </button>
                        )}
                      </td>
                      <td className="px-5 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{timeAgo(j.updated_at)}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
