import { useState, type ReactNode } from 'react';
import { CalendarDays, Check, Package } from 'lucide-react';
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
    <nav aria-label="Pasos de la venta">
      <ol className="flex items-center">
        {steps.map((step, index) => {
          const state = stateOf(step.id);
          const reachable = state !== 'pending';
          return (
            <li key={step.id} className={cn('flex min-w-0 items-center', index > 0 && 'flex-1')}>
              {index > 0 ? <span aria-hidden="true" className="mx-1 h-px min-w-2 flex-1 bg-border sm:mx-2" /> : null}
              <button
                type="button"
                disabled={!reachable}
                aria-current={state === 'current' ? 'step' : undefined}
                onClick={() => onSelect(step.id)}
                className={cn(
                  'flex h-9 shrink-0 items-center gap-2 rounded-md px-1.5 text-sm transition-colors',
                  reachable ? 'cursor-pointer hover:bg-muted' : 'cursor-default',
                )}
              >
                <span
                  className={cn(
                    'grid size-6 shrink-0 place-items-center rounded-md text-[11px] font-semibold tabular-nums',
                    state === 'current' && 'bg-foreground text-background',
                    state === 'done' && 'bg-muted text-foreground',
                    state === 'invalid' && 'border border-destructive text-destructive',
                    state === 'pending' && 'border border-border text-muted-foreground',
                  )}
                >
                  {state === 'done' ? <Check className="size-3.5" /> : index + 1}
                </span>
                <span
                  className={cn(
                    'truncate',
                    state === 'current' ? 'font-medium text-foreground' : 'hidden text-muted-foreground sm:inline',
                    state === 'invalid' && 'sm:text-destructive',
                  )}
                >
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
      className="inline-flex min-h-11 flex-wrap items-center gap-0.5 rounded-xl bg-muted p-1 sm:min-h-9"
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
              'inline-flex h-9 cursor-pointer items-center rounded-lg px-3 text-sm font-medium transition-colors sm:h-7',
              selected
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
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
      <span className={cn('grid shrink-0 place-items-center rounded-md bg-muted', box)} aria-hidden="true">
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
      className={cn('shrink-0 rounded-md bg-muted object-cover', box)}
    />
  );
}
