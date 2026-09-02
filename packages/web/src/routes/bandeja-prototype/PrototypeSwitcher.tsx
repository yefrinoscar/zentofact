// PROTOTYPE — barra flotante para cambiar de variante con ?variant= y flechas.
import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export const VARIANTS = [
  { key: 'A', name: 'Cola por plazo' },
  { key: 'B', name: 'Mesa de trabajo' },
  { key: 'C', name: 'Tickets' },
] as const;

export type VariantKey = (typeof VARIANTS)[number]['key'];

export function useVariant(): [VariantKey, (key: VariantKey) => void] {
  const [params, setParams] = useSearchParams();
  const raw = String(params.get('variant') || 'A').toUpperCase();
  const current = (VARIANTS.find((variant) => variant.key === raw)?.key || 'A') as VariantKey;
  const set = (key: VariantKey) => {
    const next = new URLSearchParams(params);
    next.set('variant', key);
    setParams(next, { replace: true });
  };
  return [current, set];
}

export function PrototypeSwitcher({ current, onChange }: { current: VariantKey; onChange: (key: VariantKey) => void }) {
  if (import.meta.env.PROD) return null;
  const index = VARIANTS.findIndex((variant) => variant.key === current);
  const step = (delta: number) => onChange(VARIANTS[(index + delta + VARIANTS.length) % VARIANTS.length].key);
  return (
    <div
      className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-zinc-900 px-2 py-1.5 text-xs text-white shadow-xl ring-1 ring-white/20"
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') step(-1);
        if (event.key === 'ArrowRight') step(1);
      }}
    >
      <button type="button" className="grid size-7 place-items-center rounded-full hover:bg-white/10" onClick={() => step(-1)} aria-label="Variante anterior"><ChevronLeft className="size-4" /></button>
      <span className="px-1 font-mono">PROTOTIPO · {current} — {VARIANTS[index].name}</span>
      <button type="button" className="grid size-7 place-items-center rounded-full hover:bg-white/10" onClick={() => step(1)} aria-label="Variante siguiente"><ChevronRight className="size-4" /></button>
    </div>
  );
}
