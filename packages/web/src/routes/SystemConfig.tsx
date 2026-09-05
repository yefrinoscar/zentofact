import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CircleAlert, CircleCheck, Info, RefreshCw } from 'lucide-react';
import api from '../lib/api';
import { usePermissions } from '../hooks/usePermissions';
import { runtimeEnvironmentLabel } from '../lib/runtimeEnv';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Switch } from '../components/ui/switch';

type ReadinessStep = {
  id: string;
  label: string;
  detail: string;
  ok: boolean;
  blocking: boolean;
};

type FlagState = {
  key: string;
  label: string;
  description: string;
  envVar: string;
  docsPath: string | null;
  effective: boolean;
  source: string;
  sourceLabel: string;
  killSwitch: boolean;
  confirmWord: string | null;
  requireListings: boolean;
  dbValue: boolean | null;
};

type AuditEntry = {
  id: number;
  key: string | null;
  enabled: boolean;
  forced: boolean;
  reason: string | null;
  actorName: string | null;
  createdAt: string;
};

type SystemConfigResponse = {
  flags: Record<string, FlagState>;
  catalogInventory: { counts: unknown; steps: ReadinessStep[]; error: string | null };
  recentChanges: AuditEntry[];
};

type RipleyCatalogItem = {
  sellerSku: string;
  title: string;
  mainSku?: string;
  reason?: string;
  pending?: { lines: number; orders: number; units: number };
};

type RipleyCatalogReport = {
  dryRun: boolean;
  activeOffers: number;
  inactiveOffers: number;
  associated: RipleyCatalogItem[];
  created: RipleyCatalogItem[];
  kept: RipleyCatalogItem[];
  unassociated: RipleyCatalogItem[];
  errors: Array<{ companyName: string; message: string }>;
};

function CatalogReportSection({ title, items }: { title: string; items: RipleyCatalogItem[] }) {
  if (items.length === 0) return null;
  return <section>
    <h3 className="font-medium text-foreground">{title}</h3>
    <ul className="mt-2 divide-y divide-border border-y border-border">
      {items.map((item) => <li key={item.sellerSku} className="flex items-start justify-between gap-4 py-2.5">
        <span className="min-w-0"><span className="block truncate text-sm text-foreground">{item.title}</span><span className="mt-0.5 block font-mono text-xs text-muted-foreground">{item.sellerSku}</span></span>
        <span className="shrink-0 text-right text-xs text-muted-foreground">{item.mainSku || 'Sin asociación'}{item.pending?.lines ? <span className="block text-amber-700">{item.pending.lines} ventas pendientes</span> : null}</span>
      </li>)}
    </ul>
  </section>;
}

const FLAG_ORDER = [
  'catalog_inventory',
  'marketplace_publication_mutation',
  'falabella_sync',
  'ripley_sync',
  'mercado_libre_sync',
];

export default function SystemConfig() {
  const { user } = usePermissions();
  const [config, setConfig] = useState<SystemConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<FlagState | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [ripleyReport, setRipleyReport] = useState<RipleyCatalogReport | null>(null);
  const [ripleySyncing, setRipleySyncing] = useState(false);
  const [mercadoLibreReport, setMercadoLibreReport] = useState<RipleyCatalogReport | null>(null);
  const [mercadoLibreSyncing, setMercadoLibreSyncing] = useState(false);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setConfig(await api.getSystemConfig());
    } catch (loadError: any) {
      setError(loadError?.message || 'No se pudo cargar la configuración.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const applyFlag = async (flag: FlagState, enabled: boolean, extra: { confirm?: string } = {}) => {
    setBusyKey(flag.key);
    setError('');
    try {
      await api.updateSystemFlag(flag.key, { enabled, ...extra });
    } catch (applyError: any) {
      setError(applyError?.message || 'No se pudo actualizar el flag.');
    } finally {
      setBusyKey(null);
      // Recarga siempre: sincroniza el checklist y el estado real del servidor.
      try {
        setConfig(await api.getSystemConfig());
      } catch {
        setLoading(true);
        await loadConfig();
      }
    }
  };

  const onSwitchChange = (flag: FlagState, next: boolean) => {
    if (next && flag.confirmWord) {
      setConfirmText('');
      setConfirmTarget(flag);
      return;
    }
    applyFlag(flag, next);
  };

  const submitConfirmation = async () => {
    if (!confirmTarget) return;
    await applyFlag(confirmTarget, true, { confirm: confirmText.trim().toUpperCase() });
    setConfirmTarget(null);
    setConfirmText('');
  };

  const syncMercadoLibreCatalog = async (dryRun: boolean) => {
    setMercadoLibreSyncing(true);
    setError('');
    try {
      const report = await api.syncMercadoLibreCatalog({ dryRun }) as RipleyCatalogReport & { itemsReceived?: number };
      setMercadoLibreReport({
        ...report,
        activeOffers: report.activeOffers ?? report.itemsReceived ?? 0,
        inactiveOffers: report.inactiveOffers ?? 0,
      });
      if (!dryRun) setConfig(await api.getSystemConfig());
    } catch (syncError: unknown) {
      setError(syncError instanceof Error ? syncError.message : 'No se pudo preparar el catálogo de Mercado Libre.');
    } finally {
      setMercadoLibreSyncing(false);
    }
  };

  const syncRipleyCatalog = async (dryRun: boolean) => {
    setRipleySyncing(true);
    setError('');
    try {
      const report = await api.syncRipleyCatalog({ dryRun }) as RipleyCatalogReport;
      setRipleyReport(report);
      if (!dryRun) setConfig(await api.getSystemConfig());
    } catch (syncError: unknown) {
      setError(syncError instanceof Error ? syncError.message : 'No se pudo preparar el catálogo de Ripley.');
    } finally {
      setRipleySyncing(false);
    }
  };

  const flags = config
    ? FLAG_ORDER.map((key) => config.flags[key]).filter(Boolean)
    : [];

  return (
    <div className="max-w-5xl text-foreground">
      <section>
        <div className="grid gap-6 sm:grid-cols-[220px_1fr] sm:items-start">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Flags operativos</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Estado de este ambiente: <span className="font-medium text-foreground">{runtimeEnvironmentLabel()}</span>.
              Los cambios aplican en caliente, sin redeploy.
            </p>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              La variable de entorno actúa como kill-switch: si está en{' '}
              <code className="rounded bg-muted px-1 py-0.5">false</code>, apaga el flag aunque la
              base de datos lo tenga prendido.
            </p>
          </div>

          <div className="space-y-4">
            {(loading || !config) && (
              <div className="space-y-3">
                <div className="h-24 animate-pulse rounded-xl bg-muted" />
                <div className="h-24 animate-pulse rounded-xl bg-muted" />
              </div>
            )}

            {!loading && error && (
              <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {flags.map((flag) => {
              const checklist = flag.key === 'catalog_inventory' ? config?.catalogInventory : null;
              return (
                <div key={flag.key} className="rounded-xl border border-border p-4">
                  <div className="flex items-start justify-between gap-6">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <label htmlFor={`flag-${flag.key}`} className="text-sm font-medium text-foreground">
                          {flag.label}
                        </label>
                        <Badge variant={flag.effective ? 'default' : 'secondary'}>
                          {flag.effective ? 'Encendido' : 'Apagado'}
                        </Badge>
                        <Badge variant="outline">{flag.sourceLabel}</Badge>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{flag.description}</p>
                      {flag.key === 'catalog_inventory' && (
                        <p className="mt-1 text-xs">
                          <Link to="/descuentos-stock" className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">
                            Ver cola de descuentos
                          </Link>
                        </p>
                      )}
                    </div>
                    <Switch
                      id={`flag-${flag.key}`}
                      checked={flag.effective}
                      disabled={busyKey === flag.key || flag.killSwitch}
                      onCheckedChange={(next) => onSwitchChange(flag, next)}
                      aria-label={flag.label}
                    />
                  </div>

                  {flag.killSwitch && (
                    <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                      Kill-switch activo: {flag.envVar} está en false en este ambiente. Quítalo o ponlo
                      en true en Railway para poder controlar el flag desde aquí.
                    </p>
                  )}

                  {checklist && checklist.error && (
                    <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
                      <Info className="mt-0.5 size-4 shrink-0" />
                      {checklist.error}
                    </p>
                  )}

                  {checklist && checklist.steps.length > 0 && (
                    <ul className="mt-3 space-y-2 border-t border-border pt-3">
                      {checklist.steps.map((step) => (
                        <li key={step.id} className="flex items-start gap-2 text-xs leading-relaxed">
                          {step.ok
                            ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                            : step.blocking
                              ? <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
                              : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />}
                          <span>
                            <span className={step.ok ? 'text-muted-foreground' : 'font-medium text-foreground'}>
                              {step.label}
                            </span>
                            {' — '}
                            <span className="text-muted-foreground">{step.detail}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {checklist?.steps.some((step) => step.id === 'mapping_clean' && !step.ok) && (
                    <div className="mt-3 border-t border-border pt-3">
                      <Button type="button" variant="outline" size="sm" onClick={() => void syncRipleyCatalog(true)} disabled={ripleySyncing}>
                        <RefreshCw className={ripleySyncing ? 'animate-spin' : ''} />
                        Revisar catálogo Ripley
                      </Button>
                    </div>
                  )}
                  {flag.key === 'mercado_libre_sync' && (
                    <div className="mt-3 border-t border-border pt-3">
                      <Button type="button" variant="outline" size="sm" onClick={() => void syncMercadoLibreCatalog(true)} disabled={mercadoLibreSyncing}>
                        <RefreshCw className={mercadoLibreSyncing ? 'animate-spin' : ''} />
                        Revisar catálogo Mercado Libre
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <Dialog open={ripleyReport != null} onOpenChange={(open) => { if (!open) setRipleyReport(null); }}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>{ripleyReport?.dryRun ? 'Revisión del catálogo Ripley' : 'Catálogo Ripley preparado'}</DialogTitle>
            <DialogDescription>
              {ripleyReport
                ? `${ripleyReport.activeOffers} publicaciones activas revisadas. ${ripleyReport.inactiveOffers} inactivas no se tocarán.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {ripleyReport && (
            <div className="min-h-0 space-y-5 overflow-y-auto pr-2 text-sm">
              <CatalogReportSection title={`Asociar a productos existentes (${ripleyReport.associated.length})`} items={ripleyReport.associated} />
              <CatalogReportSection title={`Crear productos maestros (${ripleyReport.created.length})`} items={ripleyReport.created} />
              <CatalogReportSection title={`Conservar asociaciones existentes (${ripleyReport.kept.length})`} items={ripleyReport.kept} />
              <CatalogReportSection title={`No modificar (${ripleyReport.unassociated.length})`} items={ripleyReport.unassociated} />
              {ripleyReport.errors.length > 0 && (
                <div><h3 className="font-medium text-destructive">Errores ({ripleyReport.errors.length})</h3><ul className="mt-2 space-y-1 text-xs text-destructive">{ripleyReport.errors.map((item) => <li key={`${item.companyName}:${item.message}`}>{item.companyName}: {item.message}</li>)}</ul></div>
              )}
              <p className="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
                Preparar el catálogo no descuenta ventas anteriores. Primero valida el stock físico de los productos con saldos no auditables; después concilia las ventas pendientes.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRipleyReport(null)}>Cerrar</Button>
            {ripleyReport?.dryRun && <Button type="button" onClick={() => void syncRipleyCatalog(false)} disabled={ripleySyncing}>{ripleySyncing && <RefreshCw className="animate-spin" />} Aplicar cambios</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={mercadoLibreReport != null} onOpenChange={(open) => { if (!open) setMercadoLibreReport(null); }}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>{mercadoLibreReport?.dryRun ? 'Revisión del catálogo Mercado Libre' : 'Catálogo Mercado Libre preparado'}</DialogTitle>
            <DialogDescription>
              {mercadoLibreReport
                ? `${mercadoLibreReport.activeOffers} publicaciones revisadas por SELLER_SKU.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {mercadoLibreReport && (
            <div className="min-h-0 space-y-5 overflow-y-auto pr-2 text-sm">
              <CatalogReportSection title={`Asociar a productos existentes (${mercadoLibreReport.associated.length})`} items={mercadoLibreReport.associated} />
              <CatalogReportSection title={`Crear productos maestros (${mercadoLibreReport.created.length})`} items={mercadoLibreReport.created} />
              <CatalogReportSection title={`Conservar asociaciones existentes (${mercadoLibreReport.kept.length})`} items={mercadoLibreReport.kept} />
              <CatalogReportSection title={`Sin asociación (${mercadoLibreReport.unassociated.length})`} items={mercadoLibreReport.unassociated} />
              {mercadoLibreReport.errors.length > 0 && (
                <div><h3 className="font-medium text-destructive">Errores ({mercadoLibreReport.errors.length})</h3><ul className="mt-2 space-y-1 text-xs text-destructive">{mercadoLibreReport.errors.map((item) => <li key={`${item.companyName}:${item.message}`}>{item.companyName}: {item.message}</li>)}</ul></div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setMercadoLibreReport(null)}>Cerrar</Button>
            {mercadoLibreReport?.dryRun && <Button type="button" onClick={() => void syncMercadoLibreCatalog(false)} disabled={mercadoLibreSyncing}>{mercadoLibreSyncing && <RefreshCw className="animate-spin" />} Aplicar cambios</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <section className="mt-8 border-t border-border pt-8">
        <div className="grid gap-6 sm:grid-cols-[220px_1fr] sm:items-start">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Cambios recientes</h2>
            <p className="mt-1 text-sm text-muted-foreground">Últimos ajustes registrados con auditoría.</p>
          </div>

          <div className="flex items-start justify-between gap-4">
            {config && config.recentChanges.length > 0 ? (
              <ul className="w-full space-y-2">
                {config.recentChanges.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-4 py-2.5 text-sm"
                  >
                    <span className="min-w-0 truncate">
                      <span className="font-medium text-foreground">
                        {config.flags[entry.key ?? '']?.label || entry.key || 'Flag'}
                      </span>
                      <span className="text-muted-foreground">
                        {' '}→ {entry.enabled ? 'encendido' : 'apagado'}{entry.forced ? ' (forzado)' : ''}
                        {entry.reason ? ` · ${entry.reason}` : ''}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDateTime(entry.createdAt)} · {entry.actorName || 'sistema'}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="w-full text-sm text-muted-foreground">Todavía no hay cambios registrados.</p>
            )}
            <Button variant="ghost" size="icon-sm" onClick={loadConfig} disabled={loading} aria-label="Recargar configuración">
              <RefreshCw className={loading ? 'animate-spin' : ''} />
            </Button>
          </div>
        </div>
      </section>

      <p className="mt-8 text-xs text-muted-foreground">
        Sesión de {user?.email || 'superadministrador'} · los cambios quedan auditados con tu usuario.
      </p>

      <Dialog open={confirmTarget != null} onOpenChange={(open) => !open && setConfirmTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirmar encendido</DialogTitle>
            <DialogDescription>
              Vas a permitir que el sistema llame APIs reales del marketplace. Esta acción queda
              auditada a tu nombre. Escribe{' '}
              <span className="font-semibold text-foreground">{confirmTarget?.confirmWord}</span> para continuar.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
            placeholder={confirmTarget?.confirmWord || ''}
            aria-label="Palabra de confirmación"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmTarget(null)}>Cancelar</Button>
            <Button
              onClick={submitConfirmation}
              disabled={busyKey !== null || confirmText.trim().toUpperCase() !== confirmTarget?.confirmWord}
            >
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function formatDateTime(value?: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace('T', ' ').slice(0, 16);
  return date.toLocaleString('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
