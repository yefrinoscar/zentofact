import { useState } from 'react';
import { CalendarDays, Package } from 'lucide-react';
import { es } from 'date-fns/locale';
import { cn } from '../../lib/cn';
import { limaTodayKey } from '../../lib/registrar-venta';
import { dateFromKey } from '../../lib/documentDateRange';
import { Button } from '../../components/ui/button';
import { Calendar } from '../../components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';

export const NUMBER_INPUT = '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

export function formatMoney(value: number) {
  try {
    return new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(Number(value || 0));
  } catch {
    return `S/ ${Number(value || 0).toFixed(2)}`;
  }
}

function formatDeliveryDateLabel(value: string, nowKey = limaTodayKey()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Elegir fecha';
  const date = dateFromKey(value);
  const sameYear = value.slice(0, 4) === nowKey.slice(0, 4);
  return new Intl.DateTimeFormat('es-PE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' as const }),
  }).format(date).replace(/\.$/, '').toLocaleLowerCase('es-PE');
}

export function DeliveryDatePicker({
  value,
  onChange,
  minDateKey,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  minDateKey: string;
  ariaLabel: string;
  className?: string;
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
          aria-label={ariaLabel}
          className={cn(
            'h-9 justify-between gap-2 px-3 font-normal tabular-nums',
            !selected && 'text-muted-foreground',
            className,
          )}
        >
          <span className="truncate">{formatDeliveryDateLabel(value, minDateKey)}</span>
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
    <div className="inline-flex min-h-9 flex-wrap items-center gap-0.5 rounded-xl bg-muted p-1" role="radiogroup" aria-label={ariaLabel}>
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
              'h-7 cursor-pointer rounded-lg px-3 text-sm font-medium transition-colors',
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

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="inline-flex h-9 items-center rounded-xl bg-muted p-1" role="radiogroup" aria-label={ariaLabel}>
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
              'h-7 cursor-pointer rounded-lg px-3 text-sm font-medium transition-colors',
              selected ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
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
  const box = size === 'sm' ? 'size-9' : 'size-11';
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
