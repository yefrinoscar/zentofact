import { useEffect, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import api from '../lib/api';

const OUTPUT_DIR_KEY = 'boletas.outputDir';

export default function Settings() {
  const [outputDir, setOutputDir] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem(OUTPUT_DIR_KEY);
    if (saved) {
      setOutputDir(saved);
      return;
    }
    api.getHomeDir().then((home: string) => setOutputDir(`${home}/boletas-emitidas`)).catch(() => {});
  }, []);

  const selectOutput = async () => {
    const directory = await api.selectOutputDir();
    if (!directory) return;
    localStorage.setItem(OUTPUT_DIR_KEY, directory);
    setOutputDir(directory);
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <h2 className="text-base font-semibold text-foreground">Salida por defecto</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Los PDFs generados se copiarán en esta carpeta automáticamente.
        </p>
        <div className="mt-3 rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-muted-foreground">
          {outputDir || 'Sin carpeta seleccionada'}
        </div>

        <button
          onClick={selectOutput}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium transition hover:bg-accent"
        >
          <FolderOpen className="h-4 w-4" /> Seleccionar carpeta
        </button>
      </div>

      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <h3 className="font-semibold text-foreground">Acerca de</h3>
        <p className="mt-2 text-sm text-muted-foreground">Boletas SUNAT v1.0.0</p>
        <p className="text-sm text-muted-foreground">Generación de boletas electrónicas peruanas</p>
      </div>
    </div>
  );
}
