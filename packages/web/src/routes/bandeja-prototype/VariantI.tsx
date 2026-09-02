// I — Tiendas: agrupa por seller corto (LIMBO, MANTA RAYA, YAKURUNA).
import { RefreshCw } from 'lucide-react';
import { cn } from '../../lib/cn';
import { sellerShortName } from '../../lib/seller-name';
import {
  logisticsChannelDotClass,
  logisticsChannelLabel,
  logisticsDeadlineLabel,
  logisticsDeliveryLabel,
  logisticsUrgency,
  logisticsUrgencyMeta,
  LOGISTICS_STAGES,
} from '../../lib/logistics-inbox';
import { Button } from '../../components/ui/button';
import { ActionButton, EmptyState, ProductThumb, QuantityTag, type BandejaView, type LogisticsOrder } from './shared';

function groupBySeller(orders: LogisticsOrder[]) {
  const groups = new Map<string, LogisticsOrder[]>();
  for (const order of orders) {
    const name = sellerShortName(order.companyName);
    const list = groups.get(name) || [];
    list.push(order);
    groups.set(name, list);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
}

export function VariantI({ view }: { view: BandejaView }) {
  const groups = groupBySeller(view.orders);

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
              onClick={() => view.setStage(tab.value)}
              className={cn(view.stage === tab.value ? 'font-semibold' : 'text-muted-foreground')}
            >
              {tab.label} {view.counts[tab.value]}
            </button>
          ))}
        </div>
        <Button size="sm" variant="ghost" onClick={view.refresh} disabled={view.refreshing}>
          <RefreshCw className={cn(view.refreshing && 'animate-spin')} />
        </Button>
      </div>

      <EmptyState view={view}>
        <div className="space-y-6">
          {groups.map(([seller, orders]) => (
            <section key={seller}>
              <h2 className="mb-2 flex items-baseline gap-2 text-lg font-semibold tracking-tight">
                {seller}
                <span className="text-sm font-normal text-muted-foreground">{orders.length}</span>
              </h2>
              <ul className="divide-y divide-border rounded-xl border border-border">
                {orders.map((order) => {
                  const meta = logisticsUrgencyMeta(logisticsUrgency(order, view.now));
                  return (
                    <li key={order.id} className="flex items-center gap-3 px-3 py-2">
                      <span className={cn('size-2.5 shrink-0 rounded-full', logisticsChannelDotClass(order.channelCode))} title={logisticsChannelLabel(order.channelCode)} />
                      <button type="button" onClick={() => view.openOrder(order)} className="w-28 truncate text-left font-mono text-sm font-semibold hover:underline">
                        {order.externalOrderNumber}
                      </button>
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        {order.items.map((item) => (
                          <span key={item.id} className="flex min-w-0 items-center gap-1.5">
                            <ProductThumb item={item} className="size-8 rounded" />
                            <span className="hidden truncate text-xs md:inline">{item.description}</span>
                            <QuantityTag item={item} />
                          </span>
                        ))}
                      </div>
                      <span className={cn('w-32 text-right text-xs font-semibold', meta.textClass)}>{logisticsDeadlineLabel(order, view.now)}</span>
                      <span className="hidden w-16 text-xs text-muted-foreground lg:block">{logisticsDeliveryLabel(order)}</span>
                      <ActionButton order={order} view={view} />
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </EmptyState>
    </div>
  );
}
