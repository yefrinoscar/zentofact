import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { es } from 'react-day-picker/locale';
import { Button } from './ui/button';
import { Calendar } from './ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

export function OrderRegistrationDatePicker({ id, value, onChange, disabled = false }: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = new Date(`${value}T12:00:00-05:00`);
  const label = new Intl.DateTimeFormat('es-PE', { dateStyle: 'long', timeZone: 'America/Lima' }).format(selected);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" disabled={disabled} className="h-10 w-full justify-start gap-2 font-normal sm:max-w-72" aria-label={`Elegir fecha de registro, ${label}`}>
          <CalendarDays className="size-4 text-muted-foreground" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto max-w-[calc(100vw-2rem)] rounded-xl p-2">
        <Calendar
          mode="single"
          required
          selected={selected}
          defaultMonth={selected}
          numberOfMonths={1}
          timeZone="America/Lima"
          noonSafe
          locale={es}
          classNames={{ months: 'relative flex' }}
          onSelect={(date) => {
            if (!date) return;
            onChange(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date));
            setOpen(false);
          }}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}
