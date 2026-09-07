import { useState } from 'react';
import { PackageCheck } from 'lucide-react';
import { Button } from '../components/ui/button';
import { ProductThumb, QuantityTag, type LogisticsOrder } from './bandeja-prototype/shared';

export function BandejaPackingChecklist({ order, disabled, onReady }: {
  order: LogisticsOrder; disabled: boolean; onReady: () => void;
}) {
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const complete = order.items.length > 0 && order.items.every((item) => checked.has(item.id));
  return <div className="col-span-full space-y-3 border-t pt-3">
    <p className="text-xs text-muted-foreground">Comprueba cada producto y su cantidad.</p>
    {order.items.map((item) => <label key={item.id} className="flex cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-muted">
      <input type="checkbox" className="daisy-checkbox daisy-checkbox-sm border border-muted-foreground text-primary" aria-label={`Comprobar ${item.description} del pedido ${order.externalOrderNumber}`} checked={checked.has(item.id)} disabled={disabled} onChange={() => setChecked((current) => {
        const next = new Set(current);
        if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
        return next;
      })} />
      <ProductThumb item={item} className="size-10 rounded bg-white" />
      <span className="min-w-0 flex-1 text-sm">{item.description}</span><QuantityTag item={item} />
    </label>)}
    <div className="flex items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{order.items.filter((item) => checked.has(item.id)).length} de {order.items.length} productos revisados</span><Button size="sm" disabled={disabled || !complete} onClick={onReady}><PackageCheck />Marcar listo</Button></div>
  </div>;
}
