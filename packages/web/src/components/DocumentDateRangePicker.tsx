import { useEffect, useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { es } from 'date-fns/locale';
import { CalendarDays } from 'lucide-react';
import { Button } from './ui/button';
import { Calendar } from './ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import {
  dateFromKey,
  dateKey,
  defaultDocumentDateRange,
  documentDateRangeForLastDays,
  documentDateRangeLabel,
  isSameDocumentDateRange,
  todayInLima,
  type DocumentDateRange,
} from '../lib/documentDateRange';

export default function DocumentDateRangePicker({
  value,
  onChange,
}: {
  value: DocumentDateRange;
  onChange: (range: DocumentDateRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange>({ from: dateFromKey(value.from), to: dateFromKey(value.to) });

  useEffect(() => {
    setDraft({ from: dateFromKey(value.from), to: dateFromKey(value.to) });
  }, [value.from, value.to]);

  const selectRange = (next: DateRange | undefined) => {
    const selected = next || { from: undefined, to: undefined };
    setDraft(selected);
    if (!selected.from || !selected.to) return;
    onChange({ from: dateKey(selected.from), to: dateKey(selected.to) });
    setOpen(false);
  };

  const presets = [
    { label: 'Este mes', range: defaultDocumentDateRange() },
    { label: '30 días', range: documentDateRangeForLastDays(30) },
    { label: '90 días', range: documentDateRangeForLastDays(90) },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="flex h-9 items-center rounded-xl bg-muted p-1">
        {presets.map((preset) => {
          const active = isSameDocumentDateRange(value, preset.range);
          return (
            <button
              key={preset.label}
              type="button"
              onClick={() => onChange(preset.range)}
              className={`h-7 rounded-lg px-3 text-xs font-medium transition-colors ${active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="h-9 w-full justify-start rounded-lg bg-background px-3 text-left text-sm font-normal sm:w-[250px]">
            <CalendarDays className="size-4 text-foreground" />
            <span className="truncate">{documentDateRangeLabel(value)}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto max-w-[calc(100vw-2rem)] rounded-xl p-2 shadow-lg">
          <Calendar
            mode="range"
            selected={draft}
            onSelect={selectRange}
            defaultMonth={draft.from}
            numberOfMonths={2}
            locale={es}
            disabled={{ after: dateFromKey(todayInLima()) }}
            autoFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
