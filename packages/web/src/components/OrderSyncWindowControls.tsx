import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import {
  ORDER_SYNC_INTERVAL_OPTIONS,
  ORDER_SYNC_LOOKBACK_OPTIONS,
  clampOrderSyncIntervalMinutes,
  clampOrderSyncLookbackDays,
  orderSyncIntervalLabel,
  orderSyncLookbackLabel,
} from '../lib/order-sync-presentation';

function withCurrent<T extends number>(options: readonly T[], current: number) {
  return options.includes(current as T) ? options : [current, ...options];
}

export function OrderSyncWindowControls({
  intervalMinutes,
  lookbackDays,
  onIntervalMinutes,
  onLookbackDays,
  disabled = false,
  compact = false,
}: {
  intervalMinutes: number;
  lookbackDays: number;
  onIntervalMinutes: (minutes: number) => void;
  onLookbackDays: (days: number) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const interval = clampOrderSyncIntervalMinutes(intervalMinutes);
  const lookback = clampOrderSyncLookbackDays(lookbackDays);
  return (
    <div className={compact
      ? 'flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground'
      : 'flex flex-wrap items-center gap-2 text-sm text-muted-foreground'}
    >
      <span>Cada</span>
      <Select
        value={String(interval)}
        onValueChange={(value) => onIntervalMinutes(Number(value))}
        disabled={disabled}
      >
        <SelectTrigger
          aria-label="Intervalo de sincronización"
          className={compact ? 'h-8 w-[104px]' : 'w-[130px]'}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {withCurrent(ORDER_SYNC_INTERVAL_OPTIONS, interval).map((minutes) => (
            <SelectItem key={minutes} value={String(minutes)}>{orderSyncIntervalLabel(minutes)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span>últimos</span>
      <Select
        value={String(lookback)}
        onValueChange={(value) => onLookbackDays(Number(value))}
        disabled={disabled}
      >
        <SelectTrigger
          aria-label="Ventana de sincronización"
          className={compact ? 'h-8 w-[104px]' : 'w-[110px]'}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {withCurrent(ORDER_SYNC_LOOKBACK_OPTIONS, lookback).map((days) => (
            <SelectItem key={days} value={String(days)}>{orderSyncLookbackLabel(days)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
