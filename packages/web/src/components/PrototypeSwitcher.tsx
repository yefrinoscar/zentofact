import { useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../lib/cn';

export type PrototypeVariant = { key: string; name: string };

export function PrototypeSwitcher({
  variants,
  current,
  onChange,
}: {
  variants: PrototypeVariant[];
  current: string;
  onChange: (key: string) => void;
}) {
  const index = Math.max(0, variants.findIndex((variant) => variant.key === current));
  const active = variants[index] || variants[0];

  const cycle = (delta: number) => {
    const next = variants[(index + delta + variants.length) % variants.length];
    if (next) onChange(next.key);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        cycle(-1);
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        cycle(1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-3 sm:bottom-6">
      <div
        className={cn(
          'pointer-events-auto flex items-center gap-1 rounded-full border border-foreground/20 bg-foreground px-1.5 py-1 text-background shadow-lg',
        )}
        role="navigation"
        aria-label="Variantes de prototipo"
      >
        <button
          type="button"
          className="grid size-8 cursor-pointer place-items-center rounded-full hover:bg-background/15"
          aria-label="Variante anterior"
          onClick={() => cycle(-1)}
        >
          <ChevronLeft className="size-4" />
        </button>
        <p className="min-w-48 px-2 text-center text-xs font-medium tabular-nums">
          {active?.key} — {active?.name}
        </p>
        <button
          type="button"
          className="grid size-8 cursor-pointer place-items-center rounded-full hover:bg-background/15"
          aria-label="Variante siguiente"
          onClick={() => cycle(1)}
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}
