import { useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { OrderRegistrationDatePicker } from './OrderRegistrationDatePicker';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';

export function orderDateKey(value?: string | null) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(value ? new Date(value) : new Date());
}

export function formatRegistrationDate(value?: string | null) {
  return value ? new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Lima' }).format(new Date(value)) : 'Sin fecha';
}

export function displayOrderDate(value: string) {
  return new Intl.DateTimeFormat('es-PE', { dateStyle: 'long', timeZone: 'America/Lima' })
    .format(new Date(`${value}T12:00:00-05:00`));
}

export function OrderDateDialog({ currentDate, initialDate, chooseDate = false, pending, error, onClose, onConfirm }: {
  currentDate: string;
  initialDate: string;
  chooseDate?: boolean;
  pending: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: (date: string) => void;
}) {
  const [date, setDate] = useState(initialDate);
  const [stage, setStage] = useState<'choose' | 'review' | 'final'>(chooseDate ? 'choose' : 'review');
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
      <DialogContent showCloseButton={!pending} className="gap-5 rounded-xl sm:max-w-md">
        <DialogHeader className="gap-2 pr-8">
          <DialogTitle>{stage === 'choose' ? 'Cambiar fecha de registro' : stage === 'review' ? 'Confirmar cambio de fecha' : 'Guardar nueva fecha'}</DialogTitle>
          <DialogDescription>
            El pedido y sus productos aparecerán en el día elegido en los reportes de ventas.
          </DialogDescription>
        </DialogHeader>
        {stage === 'choose' ? (
          <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Fecha actual</p>
              <p className="text-sm font-medium">{displayOrderDate(currentDate)}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-order-date">Nueva fecha de registro</Label>
              <OrderRegistrationDatePicker id="new-order-date" value={date} onChange={setDate} disabled={pending} />
            </div>
          </div>
        ) : (
          <>
            <p className="text-xs font-medium text-muted-foreground">Confirmación {stage === 'review' ? '1' : '2'} de 2</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-y border-border py-4">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Fecha actual</p>
                <p className="text-sm">{displayOrderDate(currentDate)}</p>
              </div>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Nueva fecha</p>
                <p className="text-sm font-semibold">{displayOrderDate(date)}</p>
              </div>
            </div>
          </>
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">
          {stage === 'final'
            ? 'Al guardar, la actividad conservará ambas fechas, tu usuario y la hora del cambio.'
            : 'La entrega, los comprobantes y la fecha del marketplace se mantienen. El cambio quedará en Actividad.'}
        </p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter className="gap-2 border-t border-border pt-4">
          <Button variant="outline" type="button" disabled={pending} onClick={onClose}>Cancelar</Button>
          <Button type="button" disabled={pending || date === currentDate} onClick={() => {
            if (stage === 'choose') setStage('review');
            else if (stage === 'review') setStage('final');
            else onConfirm(date);
          }}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {pending ? 'Guardando…' : stage === 'choose' ? 'Revisar cambio' : stage === 'review' ? 'Confirmar cambio' : 'Confirmar y guardar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
