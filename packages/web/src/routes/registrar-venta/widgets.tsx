import { useState, type ReactNode } from 'react';
import { CalendarDays, Check, Package, type LucideIcon } from 'lucide-react';
import { es } from 'date-fns/locale';
import { cn } from '../../lib/cn';
import { formatSaleDate } from '../../lib/sale-summary';
import { dateFromKey } from '../../lib/documentDateRange';
import { Button } from '../../components/ui/button';
import { Calendar } from '../../components/ui/calendar';
import { Label } from '../../components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';

export const NUMBER_INPUT = '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

export type StepState = 'done' | 'current' | 'invalid' | 'pending';

const STEP_BADGE: Record<StepState, string> = {
  done: 'bg-emerald-500/12 text-emerald-700 ring-1 ring-emerald-500/30 dark:text-emerald-400',
  current: 'bg-primary text-primary-foreground shadow-sm ring-4 ring-primary/15',
  invalid: 'bg-destructive/10 text-destructive ring-1 ring-destructive/30',
  pending: 'bg-muted text-muted-foreground ring-1 ring-border',
};

const STEP_LABEL: Record<StepState, string> = {
  done: 'text-foreground/70',
  current: 'font-semibold text-foreground',
  invalid: 'font-medium text-destructive',
  pending: 'text-muted-foreground',
};

export function SaleStepper<T extends string>({
  steps,
  current,
  stateOf,
  onSelect,
}: {
  steps: ReadonlyArray<{ id: T; label: string }>;
  current: T;
  stateOf: (id: T) => StepState;
  onSelect: (id: T) => void;
}) {
  return (
    <nav aria-label="Pasos de la venta" className="rounded-md border border-border bg-card px-2 py-2 sm:px-3">
      <ol className="flex items-center">
        {steps.map((step, index) => {
          const state = stateOf(step.id);
          const reachable = state !== 'pending';
          // El tramo se pinta cuando el paso anterior ya quedó atrás.
          const filled = stateOf(steps[index - 1]?.id) !== 'pending' && state !== 'pending';
          return (
            <li key={step.id} className={cn('flex min-w-0 items-center', index > 0 && 'flex-1')}>
              {index > 0 ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    'mx-1 h-0.5 min-w-2 flex-1 rounded-full sm:mx-2',
                    filled ? 'bg-emerald-500/40' : 'bg-border',
                  )}
                />
              ) : null}
              <button
                type="button"
                disabled={!reachable}
                aria-current={state === 'current' ? 'step' : undefined}
                onClick={() => onSelect(step.id)}
                className={cn(
                  'flex h-10 shrink-0 items-center gap-2 rounded-md px-2 text-sm transition-colors',
                  reachable ? 'cursor-pointer hover:bg-muted/60' : 'cursor-default',
                )}
              >
                <span
                  className={cn(
                    'grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold tabular-nums transition-colors',
                    STEP_BADGE[state],
                  )}
                >
                  {state === 'done' ? <Check className="size-3.5" strokeWidth={3} /> : index + 1}
                </span>
                <span className={cn('truncate', STEP_LABEL[state], state !== 'current' && 'hidden sm:inline')}>
                  {step.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Superficie de un paso: franja de contexto arriba y el formulario debajo. */
export function StepPanel({
  title,
  hint,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  hint: string;
  icon: LucideIcon;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-md border border-border bg-card">
      <header className="flex items-center gap-3 border-b border-border bg-muted/40 px-4 py-3 sm:px-5">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-background text-muted-foreground ring-1 ring-border">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold leading-tight">{title}</h2>
          <p className="truncate text-xs text-muted-foreground">{hint}</p>
        </div>
        {action}
      </header>
      <div className="px-4 py-5 sm:px-5">{children}</div>
    </section>
  );
}

export function DeliveryDatePicker({
  value,
  onChange,
  minDateKey,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  minDateKey: string;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = /^\d{4}-\d{2}-\d{2}$/.test(value) ? dateFromKey(value) : undefined;
  const minDate = dateFromKey(minDateKey);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          id="delivery-date"
          aria-label={ariaLabel}
          className={cn(
            'h-11 w-full justify-between gap-2 px-3 font-normal tabular-nums sm:h-9 sm:w-44',
            !selected && 'text-muted-foreground',
          )}
        >
          <span className="truncate">{formatSaleDate(value, minDateKey)}</span>
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <Calendar
          mode="single"
          required
          numberOfMonths={1}
          timeZone="America/Lima"
          noonSafe
          locale={es}
          selected={selected}
          disabled={{ before: minDate }}
          onSelect={(date) => {
            if (!date) return;
            onChange(new Intl.DateTimeFormat('en-CA', {
              timeZone: 'America/Lima',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
            }).format(date));
            setOpen(false);
          }}
          classNames={{ months: 'relative flex' }}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}

export function Choice<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T | '';
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      className="inline-flex min-h-11 flex-wrap items-center gap-0.5 rounded-xl bg-muted p-1 ring-1 ring-border/70 sm:min-h-9"
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex h-9 cursor-pointer items-center rounded-lg px-3 text-sm transition-colors sm:h-7',
              selected
                ? 'bg-background font-semibold text-foreground shadow-sm ring-1 ring-border'
                : 'font-medium text-muted-foreground hover:bg-background/60 hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function FieldRow({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[8.25rem_minmax(0,1fr)] sm:items-start sm:gap-x-4">
      <Label htmlFor={htmlFor} className="text-sm text-muted-foreground sm:pt-2">{label}</Label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function FieldHint({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-sm text-destructive">{message}</p>;
}

function falabellaMediaUrl(shopSku?: string | null) {
  const sku = String(shopSku || '').trim();
  if (!sku || !/^[A-Za-z0-9_-]+$/.test(sku)) return '';
  return `https://media.falabella.com/falabellaPE/${sku}_01`;
}

function productImageSrc(url?: string | null, shopSku?: string | null, sku?: string | null) {
  const value = String(url || '').trim() || falabellaMediaUrl(shopSku) || falabellaMediaUrl(sku);
  if (!value) return '';
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'https:' && /(^|\.)falabella\.com$/i.test(parsed.hostname)) {
      return `/catalog/image?url=${encodeURIComponent(value)}`;
    }
  } catch {
    return value;
  }
  return value;
}

export function ProductPhoto({ url, shopSku, sku, name, size = 'md' }: {
  url?: string | null;
  shopSku?: string | null;
  sku?: string | null;
  name: string;
  size?: 'sm' | 'md';
}) {
  const candidates = [productImageSrc(url), productImageSrc(null, shopSku), productImageSrc(null, null, sku)]
    .filter((src, index, list) => src && list.indexOf(src) === index);
  const [failedCount, setFailedCount] = useState(0);
  const src = candidates[failedCount] || '';
  const box = size === 'sm' ? 'size-9' : 'size-12';
  if (!src) {
    return (
      <span className={cn('grid shrink-0 place-items-center rounded-md bg-muted ring-1 ring-border', box)} aria-hidden="true">
        <Package className="size-4 text-muted-foreground" />
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      title={name}
      loading="lazy"
      decoding="async"
      onError={() => setFailedCount((current) => current + 1)}
      className={cn('shrink-0 rounded-md bg-muted object-cover ring-1 ring-border', box)}
    />
  );
}
