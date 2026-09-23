import { useEffect, useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { es } from 'date-fns/locale';
import { Calendar } from './ui/calendar';
import { dateFromKey, dateKey, documentDateRangeFirstMonth, type DocumentDateRange } from '../lib/documentDateRange';

/**
 * Rango en dos clics: el primero fija el inicio y el segundo cierra el rango.
 * Mientras se elige el fin, la banda sigue al cursor para ver el rango antes de confirmarlo.
 */
export function RangeCalendar({
  value,
  max,
  onCommit,
  numberOfMonths = 2,
}: {
  value: DocumentDateRange;
  max: string;
  onCommit: (range: DocumentDateRange) => void;
  numberOfMonths?: number;
}) {
  const maxDate = dateFromKey(max);
  const [from, setFrom] = useState<Date>(() => dateFromKey(value.from));
  const [to, setTo] = useState<Date | undefined>(() => dateFromKey(value.to));
  const [hovered, setHovered] = useState<Date | undefined>();
  const [month, setMonth] = useState<Date>(() => dateFromKey(documentDateRangeFirstMonth(value.from, max, numberOfMonths)));

  useEffect(() => {
    setFrom(dateFromKey(value.from));
    setTo(dateFromKey(value.to));
    setHovered(undefined);
    setMonth(dateFromKey(documentDateRangeFirstMonth(value.from, max, numberOfMonths)));
  }, [value.from, value.to, numberOfMonths, max]);

  const choosingEnd = !to;
  const preview: DateRange = choosingEnd && hovered
    ? (hovered < from ? { from: hovered, to: from } : { from, to: hovered })
    : { from, to };

  const selectDay = (_range: DateRange | undefined, triggerDate: Date) => {
    if (!choosingEnd) {
      setFrom(triggerDate);
      setTo(undefined);
      setHovered(undefined);
      return;
    }
    const next = triggerDate < from ? { from: triggerDate, to: from } : { from, to: triggerDate };
    setFrom(next.from);
    setTo(next.to);
    setHovered(undefined);
    onCommit({ from: dateKey(next.from), to: dateKey(next.to) });
  };

  return (
    <div className="flex flex-col">
      <Calendar
        mode="range"
        resetOnSelect
        selected={preview}
        onSelect={selectDay}
        onDayMouseEnter={(day, modifiers) => {
          if (choosingEnd && !modifiers.disabled) setHovered(day);
        }}
        onDayMouseLeave={() => setHovered(undefined)}
        month={month}
        onMonthChange={setMonth}
        numberOfMonths={numberOfMonths}
        locale={es}
        disabled={{ after: maxDate }}
        autoFocus
      />
      <div className="mt-1.5 flex items-center justify-between gap-3 border-t border-border/60 px-1 pt-2">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {choosingEnd ? 'Elige el fin' : 'Elige el inicio y luego el fin'}
        </p>
        <button
          type="button"
          className="rounded-md px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
          onClick={() => onCommit({ from: max, to: max })}
        >
          Hoy
        </button>
      </div>
    </div>
  );
}
