import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ALL_BANDEJA_VARIANTS } from './bandeja-variants';

export function BandejaVersionPicker({ current }: { current: string }) {
  const [params, setParams] = useSearchParams();
  const index = Math.max(0, ALL_BANDEJA_VARIANTS.findIndex((variant) => variant.key === current));
  const choose = (key: string) => {
    const next = new URLSearchParams(params);
    next.set('variant', key);
    setParams(next, { replace: true });
  };
  const cycle = (direction: number) => choose(ALL_BANDEJA_VARIANTS[(index + direction + ALL_BANDEJA_VARIANTS.length) % ALL_BANDEJA_VARIANTS.length].key);
  return <nav aria-label="Versiones de la bandeja" className="fixed inset-x-4 bottom-4 z-50 mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-1 rounded-full bg-zinc-950 p-1.5 text-white shadow-xl">
    <button type="button" onClick={() => cycle(-1)} aria-label="Versión anterior" className="grid size-9 shrink-0 place-items-center rounded-full hover:bg-white/15"><ChevronLeft className="size-4" /></button>
    <select aria-label="Elegir versión de la bandeja" className="min-w-0 max-w-64 rounded bg-zinc-950 px-2 py-2 text-xs text-white outline-offset-2" value={current} onChange={(event) => choose(event.target.value)}>
      {ALL_BANDEJA_VARIANTS.map((variant) => <option key={variant.key} value={variant.key}>Versión {variant.key} · {variant.name}</option>)}
    </select>
    <button type="button" onClick={() => cycle(1)} aria-label="Versión siguiente" className="grid size-9 shrink-0 place-items-center rounded-full hover:bg-white/15"><ChevronRight className="size-4" /></button>
  </nav>;
}
