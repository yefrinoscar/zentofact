import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';

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
      <DialogContent showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>{stage === 'choose' ? 'Cambiar fecha de registro' : stage === 'review' ? 'Confirmación 1 de 2' : 'Confirmación 2 de 2'}</DialogTitle>
          <DialogDescription>
            Este cambio mueve el pedido y sus productos al día elegido en los reportes de ventas. No cambia la fecha de entrega, los comprobantes emitidos ni la fecha en el marketplace.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm">Fecha actual: <strong>{displayOrderDate(currentDate)}</strong></p>
        {stage === 'choose' ? (
          <label className="space-y-2 text-sm">
            <span className="block font-medium">Nueva fecha de registro</span>
            <input className="input w-full" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
        ) : (
          <p className="text-sm">Nueva fecha: <strong>{displayOrderDate(date)}</strong></p>
        )}
        <p className="text-sm text-muted-foreground">
          {stage === 'final' ? 'Confirma nuevamente para guardar. El cambio quedará registrado en la actividad del pedido.' : 'Solo los administradores pueden hacer este cambio. Se necesitan dos confirmaciones para guardarlo.'}
        </p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button className="btn btn-ghost" type="button" disabled={pending} onClick={onClose}>Cancelar</button>
          <button className="btn" type="button" disabled={pending || !date || date === currentDate} onClick={() => {
            if (stage === 'choose') setStage('review');
            else if (stage === 'review') setStage('final');
            else onConfirm(date);
          }}>
            {pending ? 'Guardando…' : stage === 'choose' ? 'Revisar cambio' : stage === 'review' ? 'Confirmar cambio de fecha' : 'Confirmar y guardar'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
