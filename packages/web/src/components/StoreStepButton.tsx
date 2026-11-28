import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, PackageCheck, Truck } from 'lucide-react';
import api from '../lib/api';
import {
  nextStoreStep,
  STORE_SHIPPING_CARRIERS,
  storeShipInputError,
  storeStepSuccessCopy,
  type LogisticsOrderLike,
  type StoreStep,
} from '../lib/logistics-inbox';
import { useOperatorSnackbar } from './OperatorSnackbar';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

type StoreOrder = LogisticsOrderLike & { id: number; externalOrderNumber?: string | null };

const STEP_ICONS: Record<StoreStep, typeof PackageCheck> = {
  confirm: CheckCircle2,
  ready: PackageCheck,
  ship: Truck,
  deliver: PackageCheck,
};

/**
 * Siguiente paso de despacho de un pedido de la tienda web: Confirmar, Listo
 * (o Listo para recoger), Enviado con transportista y seguimiento, y Entregado
 * (o Recogido). Cada paso avisa a la tienda por webhook desde el servidor.
 */
export function StoreStepButton({
  order,
  disabled = false,
  size = 'sm',
  className,
  onDone,
}: {
  order: StoreOrder;
  disabled?: boolean;
  size?: 'sm' | 'lg' | 'default';
  className?: string;
  onDone?: (result: { step: StoreStep; fulfillmentStatus: string }) => void;
}) {
  const queryClient = useQueryClient();
  const { showSnackbar } = useOperatorSnackbar();
  const [shipOpen, setShipOpen] = useState(false);
  const [carrier, setCarrier] = useState(String(order.shipping?.carrier || '').trim().toLowerCase());
  const [trackingNumber, setTrackingNumber] = useState('');
  const [trackingUrl, setTrackingUrl] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const next = nextStoreStep(order);

  const mutation = useMutation({
    mutationFn: (input: { step: StoreStep; carrier?: string; trackingNumber?: string; trackingUrl?: string }) => (
      api.markStoreOrderStep({ orderId: order.id, ...input })
    ),
    onSuccess: (result, input) => {
      setShipOpen(false);
      showSnackbar({ message: storeStepSuccessCopy(input.step, order), tone: 'success' });
      onDone?.({ step: input.step, fulfillmentStatus: result?.fulfillmentStatus });
      void queryClient.invalidateQueries({ queryKey: ['logistics-inbox'] });
      void queryClient.invalidateQueries({ queryKey: ['managed-orders'] });
    },
    onError: (error, input) => {
      const message = (error as Error)?.message || 'No se pudo actualizar el pedido.';
      if (input.step === 'ship') setFormError(message);
      else showSnackbar({ message, tone: 'error', duration: 8000 });
    },
  });

  if (!next) return null;
  const Icon = STEP_ICONS[next.step];
  const busy = mutation.isPending;

  const run = () => {
    if (next.step === 'ship') {
      setFormError(null);
      mutation.reset();
      setShipOpen(true);
      return;
    }
    mutation.mutate({ step: next.step });
  };

  const submitShip = () => {
    const input = { carrier, trackingNumber: trackingNumber.trim(), trackingUrl: trackingUrl.trim() };
    const error = storeShipInputError(input);
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    mutation.mutate({
      step: 'ship',
      carrier: input.carrier,
      trackingNumber: input.trackingNumber || undefined,
      trackingUrl: input.trackingUrl || undefined,
    });
  };

  return (
    <>
      <Button
        type="button"
        size={size}
        variant={next.step === 'confirm' ? 'default' : 'outline'}
        className={className}
        disabled={disabled || busy}
        onClick={run}
      >
        {busy && !shipOpen ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Icon />}
        {next.label}
      </Button>
      <Dialog open={shipOpen} onOpenChange={(open) => !open && !busy && setShipOpen(false)}>
        <DialogContent className="sm:max-w-md" showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>Marcar enviado</DialogTitle>
            <DialogDescription>
              Pedido {order.externalOrderNumber || order.id}. La tienda avisará al cliente con estos datos.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(event) => { event.preventDefault(); submitShip(); }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor={`store-ship-carrier-${order.id}`}>Transportista</Label>
              <select
                id={`store-ship-carrier-${order.id}`}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={carrier}
                onChange={(event) => setCarrier(event.target.value)}
                disabled={busy}
              >
                <option value="">Elige el transportista</option>
                {STORE_SHIPPING_CARRIERS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`store-ship-tracking-${order.id}`}>Número de seguimiento</Label>
              <Input
                id={`store-ship-tracking-${order.id}`}
                value={trackingNumber}
                onChange={(event) => setTrackingNumber(event.target.value)}
                placeholder="Opcional"
                autoComplete="off"
                disabled={busy}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`store-ship-url-${order.id}`}>URL de seguimiento</Label>
              <Input
                id={`store-ship-url-${order.id}`}
                type="url"
                inputMode="url"
                value={trackingUrl}
                onChange={(event) => setTrackingUrl(event.target.value)}
                placeholder="Opcional · https://"
                autoComplete="off"
                disabled={busy}
              />
            </div>
            {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShipOpen(false)} disabled={busy}>Cancelar</Button>
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Truck />}
                Marcar enviado
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
