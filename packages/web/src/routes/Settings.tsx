import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { type AppTheme, getStoredTheme, setStoredTheme } from '../lib/theme';

export default function Settings() {
  const [theme, setTheme] = useState<AppTheme>(() => getStoredTheme());

  const changeTheme = (value: string) => {
    const nextTheme = value === 'dark' ? 'dark' : 'light';
    setTheme(nextTheme);
    setStoredTheme(nextTheme);
  };

  return (
    <div className="max-w-5xl text-foreground">
      <section>
        <div className="grid gap-6 sm:grid-cols-[220px_1fr] sm:items-start">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Apariencia</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Preferencias visuales guardadas en este navegador.
            </p>
          </div>

          <div className="pt-1">
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
        </div>
      </section>
    </div>
  );
}
