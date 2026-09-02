// H — Canales: tres bandas Falabella / Ripley / Manual. El canal es la sección.
import { RefreshCw } from 'lucide-react';
import { cn } from '../../lib/cn';
import { sellerShortName } from '../../lib/seller-name';
import {
  logisticsDeadlineLabel,
  logisticsDeliveryLabel,
  LOGISTICS_STAGES,
} from '../../lib/logistics-inbox';
import { Button } from '../../components/ui/button';
import { ActionButton, EmptyState, ProductThumb, QuantityTag, type BandejaView, type LogisticsOrder } from './shared';

const CHANNELS = [
  { value: 'falabella', label: 'Falabella', wrap: 'border-lime-200 bg-lime-50/60', head: 'text-lime-800' },
  { value: 'ripley', label: 'Ripley', wrap: 'border-violet-200 bg-violet-50/60', head: 'text-violet-800' },
  { value: 'manual', label: 'Manual', wrap: 'border-teal-200 bg-teal-50/60', head: 'text-teal-800' },
] as const;

export function VariantH({ view }: { view: BandejaView }) {
  return (
    <div className="space-y-3 pb-16">
      <div className="flex items-center justify-between gap-3">
        <div role="tablist" aria-label="Flujo de pedidos" className="flex gap-2 text-sm">
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
        <div className="space-y-3">
          {CHANNELS.map((channel) => {
            const orders = view.orders.filter((order) => order.channelCode === channel.value);
            if (!orders.length) return null;
            return (
              <section key={channel.value} className={cn('rounded-2xl border p-3', channel.wrap)}>
                <h2 className={cn('mb-2 text-sm font-semibold', channel.head)}>
                  {channel.label} · {orders.length}
                </h2>
                <ul className="space-y-1">
                  {orders.map((order) => <ChannelRow key={order.id} order={order} view={view} />)}
                </ul>
              </section>
            );
          })}
        </div>
      </EmptyState>
    </div>
  );
}

function ChannelRow({ order, view }: { order: LogisticsOrder; view: BandejaView }) {
  return (
    <li className="flex items-center gap-3 rounded-lg bg-white/80 px-2 py-1.5">
      <button type="button" onClick={() => view.openOrder(order)} className="w-28 truncate text-left font-mono text-sm font-semibold hover:underline">
        {order.externalOrderNumber}
      </button>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {order.items.slice(0, 2).map((item) => (
          <span key={item.id} className="flex min-w-0 items-center gap-1.5">
            <ProductThumb item={item} className="size-8 rounded" />
            <span className="hidden truncate text-xs md:inline">{item.description}</span>
            <QuantityTag item={item} />
          </span>
        ))}
      </div>
      <span className="hidden w-24 truncate text-xs text-muted-foreground lg:block">{sellerShortName(order.companyName)}</span>
      <span className="w-28 text-right text-xs font-medium">{logisticsDeadlineLabel(order, view.now)}</span>
      <span className="hidden w-16 text-xs text-muted-foreground xl:block">{logisticsDeliveryLabel(order)}</span>
      <ActionButton order={order} view={view} />
    </li>
  );
}
