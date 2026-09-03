import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Switch } from '../components/ui/switch';
import { type AppTheme, getStoredTheme, setStoredTheme } from '../lib/theme';
import {
  devLoadingDelayMs,
  isDevLoadingDelayEnabled,
  setDevLoadingDelayEnabled,
} from '../config/dev';
import { useAppStore } from '../stores/app';
import { usePermissions } from '../hooks/usePermissions';
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
                  Mantiene visible el skeleton inicial durante {devLoadingDelayMs / 1000} segundos para revisar la transición del Gestor de Sellers.
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
