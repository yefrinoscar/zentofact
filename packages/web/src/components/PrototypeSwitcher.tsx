import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../lib/cn';

export type PrototypeVariant = { key: string; name: string };

type SwitcherGroup = {
  param: string;
  current: string;
  variants: PrototypeVariant[];
  listenKeys?: boolean;
  prefix?: string;
};

function usePrototypeCycle({ param, current, variants, listenKeys = true }: SwitcherGroup) {
  const [params, setParams] = useSearchParams();
  const index = Math.max(0, variants.findIndex((variant) => variant.key === current));
  const active = variants[index] || variants[0];

  const cycle = (direction: number) => {
    if (!variants.length) return;
    const next = variants[(index + direction + variants.length) % variants.length];
    const nextParams = new URLSearchParams(params);
    nextParams.set(param, next.key);
    setParams(nextParams, { replace: true });
  };

  useEffect(() => {
    if (!listenKeys) return undefined;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
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
  }, [index, variants, params, setParams, listenKeys, param]);

  return { active, cycle };
}

function SwitcherPill({
  param,
  current,
  variants,
  listenKeys = true,
  prefix,
}: SwitcherGroup) {
  const { active, cycle } = usePrototypeCycle({ param, current, variants, listenKeys });
  return (
    <div className="flex items-center gap-2 rounded-full bg-zinc-950 px-2 py-1.5 text-white shadow-2xl ring-1 ring-white/20">
      <button type="button" className="grid size-8 place-items-center rounded-full hover:bg-white/10" onClick={() => cycle(-1)} aria-label={`Anterior ${prefix || param}`}>
        <ChevronLeft className="size-4" />
      </button>
      <p className="min-w-52 px-2 text-center text-xs font-medium tracking-wide">
        {prefix ? `${prefix} ` : ''}{active.key} — {active.name}
      </p>
      <button type="button" className="grid size-8 place-items-center rounded-full hover:bg-white/10" onClick={() => cycle(1)} aria-label={`Siguiente ${prefix || param}`}>
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

export function PrototypeSwitcher({
  variants,
  current,
  param = 'variant',
  listenKeys = true,
}: {
  variants: PrototypeVariant[];
  current: string;
  param?: string;
  listenKeys?: boolean;
}) {
  return (
    <div data-prototype-switcher className="pointer-events-none fixed inset-x-0 bottom-4 z-[80] flex justify-center px-4">
      <div className="pointer-events-auto">
        <SwitcherPill param={param} current={current} variants={variants} listenKeys={listenKeys} />
      </div>
    </div>
  );
}

export function PrototypeSwitcherGroup({
  groups,
  className,
}: {
  groups: SwitcherGroup[];
  className?: string;
}) {
  return (
    <div data-prototype-switcher className={cn('pointer-events-none fixed inset-x-0 bottom-4 z-[80] flex justify-center px-4', className)}>
      <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2">
        {groups.map((group) => (
          <SwitcherPill key={group.param} {...group} />
        ))}
      </div>
    </div>
  );
}
