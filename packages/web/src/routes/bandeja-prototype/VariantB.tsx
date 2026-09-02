// B — Tablero: cuatro columnas de plazo, una tarjeta por pedido.
import { RefreshCw } from 'lucide-react';
import { cn } from '../../lib/cn';
import { sellerShortName } from '../../lib/seller-name';
import {
  logisticsChannelDotClass,
  logisticsDeadlineLabel,
  logisticsDeliveryLabel,
  logisticsUrgencyMeta,
  LOGISTICS_STAGES,
  LOGISTICS_URGENCIES,
} from '../../lib/logistics-inbox';
import { Button } from '../../components/ui/button';
import { ActionButton, EmptyState, ProductThumb, QuantityTag, groupByUrgency, type BandejaView } from './shared';

const COLUMN: Record<string, string> = {
  overdue: 'bg-rose-50',
  today: 'bg-amber-50',
  tomorrow: 'bg-sky-50',
  later: 'bg-zinc-50',
};

export function VariantB({ view }: { view: BandejaView }) {
  const groups = new Map(groupByUrgency(view.orders, view.now).map((group) => [group.key, group.orders]));

  return (
    <div className="space-y-3 pb-16">
      <div className="flex items-center justify-between gap-3">
        <div role="tablist" aria-label="Flujo de pedidos" className="flex gap-4 text-sm">
          {LOGISTICS_STAGES.map((tab) => {
            const active = view.stage === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => view.setStage(tab.value)}
                className={cn('pb-1', active ? 'border-b-2 border-foreground font-semibold' : 'text-muted-foreground')}
              >
                {tab.label} {view.counts[tab.value]}
              </button>
            );
          })}
        </div>
        <Button size="icon-sm" variant="ghost" onClick={view.refresh} disabled={view.refreshing} aria-label={view.canSync ? 'Sincronizar' : 'Actualizar'}>
          <RefreshCw className={cn(view.refreshing && 'animate-spin')} />
        </Button>
      </div>

      <EmptyState view={view}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {LOGISTICS_URGENCIES.map((column) => {
            const orders = view.stage === 'shipped' && column.value !== 'later' ? [] : (groups.get(column.value) || []);
            if (view.stage === 'shipped' && column.value !== 'later') return null;
            const meta = logisticsUrgencyMeta(column.value);
            return (
              <section key={column.value} className={cn('rounded-xl p-2', view.stage === 'shipped' ? 'bg-zinc-50 xl:col-span-4' : COLUMN[column.value])}>
                <h2 className={cn('px-2 py-1.5 text-xs font-semibold uppercase tracking-wide', meta.textClass)}>
                  {view.stage === 'shipped' ? 'Enviados' : column.label} · {orders.length}
                </h2>
                <ul className="space-y-2">
                  {orders.map((order) => (
                    <li key={order.id} className="rounded-lg border border-white/80 bg-white p-2.5 shadow-sm">
                      <button type="button" onClick={() => view.openOrder(order)} className="flex w-full items-center gap-1.5 text-left">
                        <span className={cn('size-2 rounded-full', logisticsChannelDotClass(order.channelCode))} />
                        <span className="truncate font-mono text-sm font-semibold">{order.externalOrderNumber}</span>
                      </button>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {sellerShortName(order.companyName)} · {logisticsDeliveryLabel(order)}
                      </p>
                      <ul className="mt-2 space-y-1">
                        {order.items.slice(0, 2).map((item) => (
                          <li key={item.id} className="flex items-center gap-2">
                            <ProductThumb item={item} className="size-8 rounded" />
                            <span className="min-w-0 flex-1 truncate text-xs">{item.description}</span>
                            <QuantityTag item={item} />
                          </li>
                        ))}
                      </ul>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className={cn('text-[11px] font-medium', meta.textClass)}>{logisticsDeadlineLabel(order, view.now)}</span>
                        <ActionButton order={order} view={view} />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </EmptyState>
    </div>
  );
}
