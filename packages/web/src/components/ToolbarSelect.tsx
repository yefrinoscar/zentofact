import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export function ToolbarSelect({
  value,
  onValueChange,
  'aria-label': ariaLabel,
  className,
  children,
}: {
  value: string;
  onValueChange: (value: string) => void;
  'aria-label': string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('relative', className)}>
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        className="h-9 w-full appearance-none rounded-xl border border-transparent bg-input/50 py-2 pl-3 pr-8 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}
