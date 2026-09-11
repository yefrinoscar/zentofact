import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Switch } from '../components/ui/switch';
import { Button } from '../components/ui/button';
import { type AppTheme, getStoredTheme, setStoredTheme } from '../lib/theme';
import {
  devLoadingDelayMs,
  isDevLoadingDelayEnabled,
  setDevLoadingDelayEnabled,
} from '../config/dev';
import { useAppStore } from '../stores/app';
import { usePermissions } from '../hooks/usePermissions';
import api from '../lib/api';
import { copyText } from '../lib/clipboard';
import EnvioPropio from './EnvioPropio';

export default function Settings() {
  const { isAdmin } = usePermissions();
  const canEditOwnFleet = isAdmin;
  const [theme, setTheme] = useState<AppTheme>(() => getStoredTheme());
  const [simulateLoading, setSimulateLoading] = useState(() => isDevLoadingDelayEnabled());
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed);
  const setSidebarCollapsed = useAppStore((state) => state.setSidebarCollapsed);

  const changeTheme = (value: string) => {
    const nextTheme = value === 'dark' ? 'dark' : 'light';
    setTheme(nextTheme);
    setStoredTheme(nextTheme);
  };

  const changeSimulatedLoading = (enabled: boolean) => {
    setSimulateLoading(enabled);
    setDevLoadingDelayEnabled(enabled);
  };

  return (
    <div className="text-foreground">
      {canEditOwnFleet ? (
        <section>
          <div className="grid gap-6 sm:grid-cols-[220px_1fr] sm:items-start">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Envío propio</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Almacén, zonas y cobertura de Express.
              </p>
            </div>

            <div className="pt-1">
              <EnvioPropio />
            </div>
          </div>
        </section>
      ) : null}

      {canEditOwnFleet ? <PrintStationSettings /> : null}

      <section className={canEditOwnFleet ? 'mt-8 border-t border-border pt-8' : undefined}>
        <div className="grid gap-6 sm:grid-cols-[220px_1fr] sm:items-start">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Apariencia</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Preferencias visuales guardadas en este navegador.
            </p>
          </div>

          <div className="space-y-6 pt-1">
            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Tema
              </label>
              <Tabs value={theme} onValueChange={changeTheme}>
                <TabsList>
                  <TabsTrigger value="light">Light theme</TabsTrigger>
                  <TabsTrigger value="dark">Dark theme</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <div className="flex items-start justify-between gap-6 border-t border-border pt-4">
              <div>
                <label htmlFor="collapse-sidebar" className="text-sm font-medium text-foreground">
                  Colapsar menú lateral
                </label>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Muestra solo los iconos para dejar más espacio al contenido.
                </p>
              </div>
              <Switch
                id="collapse-sidebar"
                checked={sidebarCollapsed}
                onCheckedChange={setSidebarCollapsed}
                aria-label="Colapsar menú lateral"
              />
            </div>
          </div>
        </div>
      </section>

      {import.meta.env.DEV && (
        <section className="mt-8 border-t border-border pt-8">
          <div className="grid gap-6 sm:grid-cols-[220px_1fr] sm:items-start">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Desarrollo</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Herramientas locales que nunca se habilitan en producción.
              </p>
            </div>

            <div className="flex items-start justify-between gap-6 border-t border-border pt-4">
              <div>
                <label htmlFor="simulate-loading" className="text-sm font-medium text-foreground">
                  Simular carga lenta
                </label>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Mantiene visible el skeleton inicial durante {devLoadingDelayMs / 1000} segundos para revisar la transición de Pagos y el Gestor de Sellers.
                </p>
              </div>
              <Switch
                id="simulate-loading"
                checked={simulateLoading}
                onCheckedChange={changeSimulatedLoading}
                aria-label="Simular carga lenta en desarrollo"
              />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function formatStationTime(value?: string | null) {
  if (!value) return 'Nunca';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Nunca';
  return new Intl.DateTimeFormat('es-PE', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function PrintStationSettings() {
  const queryClient = useQueryClient();
  const [freshToken, setFreshToken] = useState('');
  const station = useQuery({
    queryKey: ['print-station'],
    queryFn: () => api.getPrintStation(),
    refetchInterval: 10_000,
  });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api.setPrintStationEnabled(enabled),
    onSuccess: (data) => queryClient.setQueryData(['print-station'], data),
  });
  const rotate = useMutation({
    mutationFn: () => api.rotatePrintStationToken(),
    onSuccess: (data) => {
      queryClient.setQueryData(['print-station'], data);
      setFreshToken(data.token || '');
    },
  });
  const data = station.data;
  const pending = data?.pendingCount || 0;

  return (
    <section className="mt-8 border-t border-border pt-8">
      <div className="grid gap-6 sm:grid-cols-[220px_1fr] sm:items-start">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Impresión automática</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            La PC de empaque junta 4 etiquetas en una hoja A4. Si hay 7 u 8, imprime dos hojas. Si no se juntan 4, imprime lo que haya al cumplirse una hora. No imprime nada hasta que el agente de esa PC arranque.
          </p>
        </div>
        <div className="space-y-4 pt-1">
          <div className="flex items-start justify-between gap-6">
            <div>
              <label htmlFor="auto-print" className="text-sm font-medium text-foreground">
                Imprimir al juntar hoja o cada hora
              </label>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {data?.listening ? 'El agente está escuchando.' : 'El agente no está conectado. Enciende la PC de empaque.'}
                {' '}
                {pending === 1 ? '1 pedido en cola.' : `${pending} pedidos en cola.`}
                {data?.lastError ? ` Último error: ${data.lastError}` : ''}
              </p>
            </div>
            <Switch
              id="auto-print"
              checked={data?.enabled === true}
              onCheckedChange={(enabled) => toggle.mutate(enabled)}
              disabled={!data || toggle.isPending}
              aria-label="Activar impresión automática"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Última conexión {formatStationTime(data?.lastSeenAt)}. Última impresión {formatStationTime(data?.lastBatchAt)}.
            {data?.hasToken && data.tokenSuffix ? ` Token …${data.tokenSuffix}.` : ' Todavía no hay token.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={rotate.isPending}
              onClick={() => rotate.mutate()}
            >
              {data?.hasToken ? 'Generar token nuevo' : 'Crear token de la PC'}
            </Button>
            {freshToken ? (
              <Button type="button" size="sm" onClick={() => copyText(freshToken)}>
                Copiar token
              </Button>
            ) : null}
          </div>
          {freshToken ? (
            <p className="break-all font-mono text-xs text-foreground">{freshToken}</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
