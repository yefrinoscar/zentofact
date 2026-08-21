import { useCallback, useEffect, useState } from 'react';
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

const FLAG_ORDER = [
  'catalog_inventory',
  'marketplace_publication_mutation',
  'falabella_sync',
  'ripley_sync',
];

export default function SystemConfig() {
  const { user } = usePermissions();
  const [config, setConfig] = useState<SystemConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<FlagState | null>(null);
  const [confirmText, setConfirmText] = useState('');

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
                </div>
              );
            })}
          </div>
        </div>
      </section>

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
