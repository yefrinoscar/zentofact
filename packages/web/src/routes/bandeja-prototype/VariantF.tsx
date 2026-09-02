// F — Uno a uno: un pedido a pantalla completa, como estación de empaque.
import { useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { cn } from '../../lib/cn';
import { sellerShortName } from '../../lib/seller-name';
import {
  logisticsChannelLabel,
  logisticsDeadlineLabel,
  logisticsDeliveryLabel,
  logisticsUrgency,
  logisticsUrgencyMeta,
  LOGISTICS_STAGES,
} from '../../lib/logistics-inbox';
import { Button } from '../../components/ui/button';
import { ActionButton, EmptyState, ProductThumb, QuantityTag, type BandejaView } from './shared';

export function VariantF({ view }: { view: BandejaView }) {
  const [index, setIndex] = useState(0);
  const safeIndex = view.orders.length ? Math.min(index, view.orders.length - 1) : 0;
  const order = view.orders[safeIndex] || null;
  const urgency = order ? logisticsUrgency(order, view.now) : 'later';
  const meta = logisticsUrgencyMeta(urgency);

  return (
    <div className="space-y-4 pb-16">
      <div className="flex items-center justify-between gap-3">
        <div role="tablist" aria-label="Flujo de pedidos" className="flex gap-3 text-sm">
          {LOGISTICS_STAGES.map((tab) => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={view.stage === tab.value}
              onClick={() => { view.setStage(tab.value); setIndex(0); }}
              className={cn(view.stage === tab.value ? 'font-semibold' : 'text-muted-foreground')}
            >
              {tab.label} {view.counts[tab.value]}
            </button>
          ))}
        </div>
        <Button size="icon-sm" variant="ghost" onClick={view.refresh} disabled={view.refreshing} aria-label={view.canSync ? 'Sincronizar' : 'Actualizar'}>
          <RefreshCw className={cn(view.refreshing && 'animate-spin')} />
        </Button>
      </div>

      <EmptyState view={view}>
        {order && (
          <article className="mx-auto max-w-2xl space-y-5">
            <div className="flex items-center justify-between gap-2">
              <Button size="icon" variant="outline" disabled={safeIndex === 0} onClick={() => setIndex(safeIndex - 1)} aria-label="Pedido anterior">
                <ChevronLeft />
              </Button>
              <p className="text-xs text-muted-foreground">{safeIndex + 1} / {view.orders.length}</p>
              <Button size="icon" variant="outline" disabled={safeIndex >= view.orders.length - 1} onClick={() => setIndex(safeIndex + 1)} aria-label="Siguiente pedido">
                <ChevronRight />
              </Button>
            </div>
            <div className="text-center">
              <button type="button" onClick={() => view.openOrder(order)} className="font-mono text-3xl font-semibold hover:underline">
                {order.externalOrderNumber}
              </button>
              <p className={cn('mt-1 text-lg font-semibold', meta.textClass)}>{logisticsDeadlineLabel(order, view.now)}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {sellerShortName(order.companyName)} · {logisticsChannelLabel(order.channelCode)} · {logisticsDeliveryLabel(order)}
              </p>
              <p className="mt-1 text-sm">{order.customer?.name || 'Sin cliente'}</p>
            </div>
            <ul className="space-y-3">
              {order.items.map((item) => (
                <li key={item.id} className="flex items-center gap-4 rounded-2xl bg-muted/60 p-3">
                  <ProductThumb item={item} className="size-20 rounded-xl" />
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-medium">{item.description}</p>
                    {item.sku && <p className="font-mono text-xs text-muted-foreground">{item.sku}</p>}
                  </div>
                  <span className="rounded-lg bg-foreground px-3 py-1 font-mono text-xl font-semibold text-background">
                    x{item.quantity}
                  </span>
                </li>
              ))}
            </ul>
            <ActionButton order={order} view={view} size="default" full />
            <div className="flex justify-center gap-1">
              {view.orders.map((row, rowIndex) => (
                <button
                  key={row.id}
                  type="button"
                  aria-label={row.externalOrderNumber}
                  onClick={() => setIndex(rowIndex)}
                  className={cn('size-2 rounded-full', rowIndex === safeIndex ? 'bg-foreground' : 'bg-muted-foreground/30')}
                />
              ))}
            </div>
          </article>
        )}
      </EmptyState>
    </div>
  );
}
