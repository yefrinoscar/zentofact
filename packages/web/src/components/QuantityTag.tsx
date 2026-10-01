import { cn } from '../lib/cn';
import { logisticsQuantityLabel } from '../lib/logistics-inbox';

/** Cantidad de unidades de un producto, con el mismo tratamiento que la bandeja. */
export function QuantityTag({ quantity, className }: { quantity?: number | null; className?: string }) {
  const many = (Number(quantity) || 0) > 1;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums',
        many ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground',
        className,
      )}
    >
      {logisticsQuantityLabel({ quantity })}
    </span>
  );
}
