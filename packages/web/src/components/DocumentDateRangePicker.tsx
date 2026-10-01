import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { RangeCalendar } from './RangeCalendar';
import { useIsMobile } from '../hooks/useIsMobile';
import {
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
  const isMobile = useIsMobile();

  const presets = [
    { label: 'Este mes', range: defaultDocumentDateRange() },
    { label: '30 días', range: documentDateRangeForLastDays(30) },
    { label: '90 días', range: documentDateRangeForLastDays(90) },
  ];

  const commit = (range: DocumentDateRange) => {
    onChange(range);
    setOpen(false);
  };

  return (
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="flex h-9 items-center rounded-xl bg-muted p-1" role="group" aria-label="Periodo rápido">
        {presets.map((preset) => {
          const active = isSameDocumentDateRange(value, preset.range);
          return (
            <button
              key={preset.label}
              type="button"
              aria-pressed={active}
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
          <Button
            variant="outline"
            aria-label={`Periodo: ${documentDateRangeLabel(value)}`}
            className="h-9 w-full justify-start rounded-lg bg-background px-3 text-left text-sm font-normal sm:w-[250px]"
          >
            <CalendarDays className="size-4 text-foreground" />
            <span className="truncate">{documentDateRangeLabel(value)}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto max-w-[calc(100vw-2rem)] rounded-xl p-2 shadow-lg">
          <RangeCalendar
            value={value}
            max={todayInLima()}
            onCommit={commit}
            numberOfMonths={isMobile ? 1 : 2}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
