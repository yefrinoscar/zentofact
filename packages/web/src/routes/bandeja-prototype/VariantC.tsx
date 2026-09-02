// C — Picking: agrupa por producto. El operador arma por SKU, no por pedido.
import { RefreshCw } from 'lucide-react';
import { cn } from '../../lib/cn';
import { sellerShortName } from '../../lib/seller-name';
import {
  logisticsDeadlineLabel,
  logisticsUrgency,
  logisticsUrgencyMeta,
  LOGISTICS_STAGES,
} from '../../lib/logistics-inbox';
import { Button } from '../../components/ui/button';
import { EmptyState, ProductThumb, type BandejaView, type LogisticsItem, type LogisticsOrder } from './shared';

type ProductGroup = {
  key: string;
  item: LogisticsItem;
  quantity: number;
  orders: LogisticsOrder[];
};

function groupByProduct(orders: LogisticsOrder[]): ProductGroup[] {
  const groups = new Map<string, ProductGroup>();
  for (const order of orders) {
    for (const item of order.items) {
      const key = String(item.sku || item.description);
      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, { key, item, quantity: item.quantity, orders: [order] });
        continue;
      }
      existing.quantity += item.quantity;
      if (!existing.orders.some((row) => row.id === order.id)) existing.orders.push(order);
    }
  }
  return [...groups.values()].sort((a, b) => b.quantity - a.quantity);
}

export function VariantC({ view }: { view: BandejaView }) {
  const groups = groupByProduct(view.orders);

  return (
    <div className="space-y-3 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-3">
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
                className={cn('rounded-full px-3 py-1 text-xs font-medium', active ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600')}
              >
                {tab.label} {view.counts[tab.value]}
              </button>
            );
          })}
        </div>
        <Button size="sm" variant="outline" onClick={view.refresh} disabled={view.refreshing}>
          <RefreshCw className={cn(view.refreshing && 'animate-spin')} />
          {view.canSync ? 'Sincronizar' : 'Actualizar'}
        </Button>
      </div>

      <EmptyState view={view}>
        <ul className="divide-y divide-zinc-200">
          {groups.map((group) => (
            <li key={group.key} className="grid gap-3 py-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] md:items-center">
              <div className="flex items-center gap-3">
                <ProductThumb item={group.item} className="size-16 rounded-lg" />
                <div className="min-w-0">
                  <p className="truncate font-medium">{group.item.description}</p>
                  <p className="font-mono text-xs text-muted-foreground">{group.item.sku || 'sin SKU'}</p>
                </div>
                <span className="rounded-md bg-zinc-900 px-2 py-1 font-mono text-sm font-semibold text-white">x{group.quantity}</span>
              </div>
              <ul className="space-y-1 text-xs">
                {group.orders.map((order) => {
                  const meta = logisticsUrgencyMeta(logisticsUrgency(order, view.now));
                  return (
                    <li key={order.id}>
                      <button type="button" onClick={() => view.openOrder(order)} className="hover:underline">
                        <span className="font-mono font-semibold">{order.externalOrderNumber}</span>
                        <span className="text-muted-foreground"> · {sellerShortName(order.companyName)}</span>
                        <span className={cn('ml-1', meta.textClass)}>{logisticsDeadlineLabel(order, view.now)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <Button size="sm" onClick={() => view.printOrders(group.orders)} disabled={view.printing}>
                Imprimir {group.orders.length}
              </Button>
            </li>
          ))}
        </ul>
      </EmptyState>
    </div>
  );
}
