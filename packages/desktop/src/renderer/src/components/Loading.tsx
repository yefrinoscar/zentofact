import { Loader2 } from 'lucide-react';

// Bloque de carga centrado, para usar dentro de paneles/tablas mientras se
// consultan datos del DB remoto (Neon). Reemplaza el "No se encontró..." que
// antes parpadeaba porque la carga local era instantánea.
export function Loading({
  label = 'Cargando...',
  className = '',
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground ${className}`}
    >
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
      <span>{label}</span>
    </div>
  );
}

// Spinner en línea para botones/acciones.
export function Spinner({ className = '' }: { className?: string }) {
  return <Loader2 className={`h-4 w-4 animate-spin ${className}`} />;
}

// Bloque gris animado para placeholders de contenido.
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} />;
}
