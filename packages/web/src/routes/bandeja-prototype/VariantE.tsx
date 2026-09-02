// E — Tickets: una ficha grande por pedido, dos columnas.
import { RefreshCw } from 'lucide-react';
import { cn } from '../../lib/cn';
import { sellerShortName } from '../../lib/seller-name';
import {
  logisticsChannelLabel,
  logisticsDeadlineLabel,
  logisticsDeliveryLabel,
  logisticsUrgency,
  LOGISTICS_STAGES,
} from '../../lib/logistics-inbox';
import { Button } from '../../components/ui/button';
import { ActionButton, EmptyState, ProductThumb, QuantityTag, type BandejaView } from './shared';

const BAR: Record<string, string> = {
  overdue: 'bg-rose-500',
  today: 'bg-amber-400',
  tomorrow: 'bg-sky-500',
  later: 'bg-zinc-300',
};

export function VariantE({ view }: { view: BandejaView }) {
  return (
    <div className="space-y-4 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Flujo de pedidos" className="flex gap-2">
          {LOGISTICS_STAGES.map((tab) => {
            const active = view.stage === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => view.setStage(tab.value)}
                className={cn('text-sm', active ? 'font-semibold text-foreground' : 'text-muted-foreground')}
              >
                {tab.label}
                <span className="ml-1 tabular-nums">{view.counts[tab.value]}</span>
              </button>
            );
          })}
        </div>
        <Button size="sm" variant="ghost" onClick={view.refresh} disabled={view.refreshing}>
          <RefreshCw className={cn(view.refreshing && 'animate-spin')} />
          {view.canSync ? 'Sincronizar' : 'Actualizar'}
        </Button>
      </div>

      <EmptyState view={view}>
        <ul className="grid gap-3 md:grid-cols-2">
          {view.orders.map((order) => {
            const urgency = logisticsUrgency(order, view.now);
            return (
              <li key={order.id} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                <div className={cn('h-1.5', BAR[urgency])} />
                <div className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <button type="button" onClick={() => view.openOrder(order)} className="text-left">
                      <p className="font-mono text-lg font-semibold">{order.externalOrderNumber}</p>
                      <p className="text-xs text-muted-foreground">
                        {sellerShortName(order.companyName)} · {logisticsChannelLabel(order.channelCode)}
                      </p>
                    </button>
                    <p className="text-right text-xs font-semibold">{logisticsDeadlineLabel(order, view.now)}</p>
                  </div>
                  <p className="text-sm">{order.customer?.name || 'Sin cliente'} · {logisticsDeliveryLabel(order)}</p>
                  <ul className="space-y-1.5">
                    {order.items.map((item) => (
                      <li key={item.id} className="flex items-center gap-2">
                        <ProductThumb item={item} className="size-12 rounded-md" />
                        <span className="min-w-0 flex-1 truncate text-sm">{item.description}</span>
                        <QuantityTag item={item} />
                      </li>
                    ))}
                  </ul>
                  <ActionButton order={order} view={view} full />
                </div>
              </li>
            );
          })}
        </ul>
      </EmptyState>
    </div>
  );
}
