import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';

type PrototypeVariant = {
  key: string;
  name: string;
};

export function PrototypeSwitcher({
  variants,
  param = 'variant',
}: {
  variants: PrototypeVariant[];
  param?: string;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentKey = searchParams.get(param) || variants[0]?.key || '';
  const index = Math.max(0, variants.findIndex((item) => item.key === currentKey));

  useEffect(() => {
    if (import.meta.env.PROD || !variants.length) return undefined;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        const variant = variants[(index - 1 + variants.length) % variants.length];
        const next = new URLSearchParams(searchParams);
        next.set(param, variant.key);
        setSearchParams(next, { replace: true });
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        const variant = variants[(index + 1) % variants.length];
        const next = new URLSearchParams(searchParams);
        next.set(param, variant.key);
        setSearchParams(next, { replace: true });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, variants, searchParams, param, setSearchParams]);

  if (import.meta.env.PROD || !variants.length) return null;
  const current = variants[index] || variants[0];

  const go = (nextIndex: number) => {
    const variant = variants[(nextIndex + variants.length) % variants.length];
    const next = new URLSearchParams(searchParams);
    next.set(param, variant.key);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[80] flex justify-center px-3">
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-white shadow-2xl">
        <button
          type="button"
          className="grid size-8 place-items-center rounded-full hover:bg-white/10"
          aria-label="Variante anterior"
          onClick={() => go(index - 1)}
        >
          <ChevronLeft className="size-4" />
        </button>
        <p className="min-w-44 px-1 text-center text-xs font-medium tracking-wide">
          {current.key} — {current.name}
        </p>
        <button
          type="button"
          className="grid size-8 place-items-center rounded-full hover:bg-white/10"
          aria-label="Siguiente variante"
          onClick={() => go(index + 1)}
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}
