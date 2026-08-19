import { useEffect, useRef, useState } from 'react';
import { es } from 'date-fns/locale';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './ui/button';
import { Calendar } from './ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { cn } from '../lib/cn';
import { addDaysToDateKey, dateFromKey, todayInLima } from '../lib/documentDateRange';

const WEEKDAY = new Intl.DateTimeFormat('es-PE', { weekday: 'short' });
const DAY = new Intl.DateTimeFormat('es-PE', { day: 'numeric' });
const FULL = new Intl.DateTimeFormat('es-PE', { weekday: 'long', day: 'numeric', month: 'short' });
const VISIBLE_DAYS = 10;
const SLIDE_MS = 280;
const MAX_SLIDE_DAYS = 4;

function weekdayLabel(date: Date) {
  return WEEKDAY.format(date).replace(/\.$/, '');
}

function daysBetween(from: string, to: string) {
  return Math.round((dateFromKey(to).getTime() - dateFromKey(from).getTime()) / 86_400_000);
}

function rangeDays(from: string, count: number) {
  return Array.from({ length: count }, (_, index) => addDaysToDateKey(from, index));
}

function latestStart(max: string) {
  return addDaysToDateKey(max, 1 - VISIBLE_DAYS);
}

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function DayStrip({
  value,
  onChange,
  max = todayInLima(),
  className,
}: {
  value: string;
  onChange: (date: string) => void;
  max?: string;
  className?: string;
}) {
  const initialStart = latestStart(max);
  const [trackStart, setTrackStart] = useState(initialStart);
  const [trackCount, setTrackCount] = useState(VISIBLE_DAYS);
  const [shift, setShift] = useState(0);
  const [enableTransition, setEnableTransition] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => dateFromKey(value));
  const startRef = useRef(initialStart);
  const valueRef = useRef(value);
  const pendingStart = useRef<string | null>(null);
  const animating = useRef(false);
  const frameRef = useRef(0);
  const timeoutRef = useRef(0);
  valueRef.current = value;

  const clearTimers = () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    frameRef.current = 0;
    timeoutRef.current = 0;
  };

  useEffect(() => () => clearTimers(), []);

  const commitStart = (nextStart: string) => {
    clearTimers();
    startRef.current = nextStart;
    setTrackStart(nextStart);
    setTrackCount(VISIBLE_DAYS);
    setShift(0);
    setEnableTransition(false);
    pendingStart.current = null;
    animating.current = false;
  };

  const playSlide = (fromShift: number, toShift: number, nextStart: string, nextTrackStart: string, nextTrackCount: number) => {
    animating.current = true;
    pendingStart.current = nextStart;
    setTrackStart(nextTrackStart);
    setTrackCount(nextTrackCount);
    setEnableTransition(false);
    setShift(fromShift);

    const finish = () => {
      if (pendingStart.current) commitStart(pendingStart.current);
    };

    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = requestAnimationFrame(() => {
        setEnableTransition(true);
        setShift(toShift);
        timeoutRef.current = window.setTimeout(finish, SLIDE_MS + 80);
      });
    });
  };

  const slideWindow = (nextStart: string) => {
    if (animating.current) {
      commitStart(pendingStart.current || startRef.current);
    }

    const from = startRef.current;
    const delta = daysBetween(from, nextStart);
    if (delta === 0) return;
    if (prefersReducedMotion()) {
      commitStart(nextStart);
      return;
    }

    const visualDelta = Math.min(Math.abs(delta), MAX_SLIDE_DAYS);
    if (delta > 0) {
      const visualStart = addDaysToDateKey(nextStart, -visualDelta);
      playSlide(0, -visualDelta, nextStart, visualStart, VISIBLE_DAYS + visualDelta);
      return;
    }

    playSlide(-visualDelta, 0, nextStart, nextStart, VISIBLE_DAYS + visualDelta);
  };

  const ensureVisible = (selected: string) => {
    const currentStart = startRef.current;
    const currentEnd = addDaysToDateKey(currentStart, VISIBLE_DAYS - 1);
    if (selected >= currentStart && selected <= currentEnd) return;
    if (selected < currentStart) {
      slideWindow(selected);
      return;
    }
    const alignedStart = addDaysToDateKey(selected, 1 - VISIBLE_DAYS);
    slideWindow(alignedStart > latestStart(max) ? latestStart(max) : alignedStart);
  };

  const select = (next: string) => {
    if (!next || next > max || next === valueRef.current) return;
    valueRef.current = next;
    ensureVisible(next);
    onChange(next);
  };

  const days = rangeDays(trackStart, trackCount);
  const canGoForward = value < max;
  const selectedDate = dateFromKey(value);

  return (
    <div className={cn('flex w-full items-center gap-1.5', className)} role="group" aria-label="Fecha de salida">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="shrink-0"
        aria-label="Día anterior"
        onClick={() => select(addDaysToDateKey(valueRef.current, -1))}
      >
        <ChevronLeft />
      </Button>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div
          className="flex will-change-transform"
          style={{
            width: `${(trackCount / VISIBLE_DAYS) * 100}%`,
            transform: `translate3d(${trackCount ? (shift / trackCount) * 100 : 0}%, 0, 0)`,
            transition: enableTransition ? `transform ${SLIDE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)` : 'none',
          }}
          onTransitionEnd={(event) => {
            if (event.propertyName !== 'transform' || event.target !== event.currentTarget) return;
            if (pendingStart.current) commitStart(pendingStart.current);
          }}
        >
          {days.map((day) => {
            const date = dateFromKey(day);
            const selected = day === value;
            const isToday = day === max;
            return (
              <button
                key={day}
                type="button"
                onClick={() => select(day)}
                aria-current={selected ? 'date' : undefined}
                aria-label={FULL.format(date)}
                className="box-border shrink-0 px-0.5 py-0"
                style={{ width: `${100 / trackCount}%` }}
              >
                <span
                  className={cn(
                    'flex h-full w-full flex-col items-center justify-center rounded-lg px-1 py-2 text-center transition-colors duration-200',
                    selected
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <span className="text-[10px] font-medium uppercase leading-none tracking-wide">
                    {isToday ? 'Hoy' : weekdayLabel(date)}
                  </span>
                  <span className="mt-1.5 text-sm font-semibold tabular-nums leading-none">{DAY.format(date)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="shrink-0"
        aria-label="Día siguiente"
        onClick={() => select(addDaysToDateKey(valueRef.current, 1))}
        disabled={!canGoForward}
      >
        <ChevronRight />
      </Button>
      <Popover
        open={calendarOpen}
        onOpenChange={(open) => {
          setCalendarOpen(open);
          if (open) setVisibleMonth(dateFromKey(valueRef.current));
        }}
      >
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="icon" className="shrink-0" aria-label="Elegir fecha en el calendario">
            <CalendarDays />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-2">
          <Calendar
            mode="single"
            required
            numberOfMonths={1}
            timeZone="America/Lima"
            noonSafe
            selected={selectedDate}
            month={visibleMonth}
            onMonthChange={setVisibleMonth}
            onSelect={(next) => {
              if (!next) return;
              select(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(next));
              setCalendarOpen(false);
            }}
            locale={es}
            disabled={{ after: dateFromKey(max) }}
            classNames={{ months: 'relative flex' }}
            autoFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
