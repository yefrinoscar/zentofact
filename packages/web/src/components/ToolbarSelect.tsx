import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ToolbarSelectOption = {
  value: string;
  label: string;
};

export function ToolbarSelect({
  value,
  onValueChange,
  options,
  'aria-label': ariaLabel,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: ToolbarSelectOption[];
  'aria-label': string;
  className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        className="h-9 w-full cursor-pointer appearance-none rounded-xl border border-transparent bg-input/50 px-3 py-2 pr-8 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}
