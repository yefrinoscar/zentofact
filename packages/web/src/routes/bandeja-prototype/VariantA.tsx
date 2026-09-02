// A — Estación: cola a la izquierda, pedido activo a la derecha.
import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
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
import { ActionButton, EmptyState, ProductThumb, QuantityTag, groupByUrgency, type BandejaView, type LogisticsOrder } from './shared';

export function VariantA({ view }: { view: BandejaView }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = view.orders.find((order) => order.id === selectedId) || view.orders[0] || null;
  const groups = view.stage === 'shipped'
    ? [{ key: 'later' as const, orders: view.orders }]
    : groupByUrgency(view.orders, view.now);

  return (
    <div className="space-y-3 pb-16">
      <div className="flex items-center justify-between gap-3">
        <div role="tablist" aria-label="Flujo de pedidos" className="flex gap-1 rounded-lg bg-stone-100 p-1">
          {LOGISTICS_STAGES.map((tab) => {
            const active = view.stage === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => view.setStage(tab.value)}
                className={cn('rounded-md px-3 py-1.5 text-xs font-medium', active ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-800')}
              >
                {tab.label} <span className="tabular-nums">{view.counts[tab.value]}</span>
              </button>
            );
          })}
        </div>
        <Button size="sm" variant="ghost" onClick={view.refresh} disabled={view.refreshing} aria-label={view.canSync ? 'Sincronizar' : 'Actualizar'}>
          <RefreshCw className={cn(view.refreshing && 'animate-spin')} />
        </Button>
      </div>

      <EmptyState view={view}>
        <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <ol className="space-y-3">
            {groups.map((group) => {
              const meta = logisticsUrgencyMeta(group.key);
              return (
                <li key={group.key}>
                  <p className={cn('mb-1 text-[11px] font-semibold uppercase tracking-wide', meta.textClass)}>
                    {meta.label} · {group.orders.length}
                  </p>
                  <ul className="space-y-1">
                    {group.orders.map((order) => (
                      <QueueRow key={order.id} order={order} active={selected?.id === order.id} view={view} onSelect={() => setSelectedId(order.id)} />
                    ))}
                  </ul>
                </li>
              );
            })}
          </ol>
          {selected && <WorkPanel order={selected} view={view} />}
        </div>
      </EmptyState>
    </div>
  );
}

function QueueRow({ order, active, view, onSelect }: { order: LogisticsOrder; active: boolean; view: BandejaView; onSelect: () => void }) {
  const item = order.items[0];
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left',
        active ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-200 bg-white hover:border-stone-400',
      )}
    >
      {item && <ProductThumb item={item} className="size-8 rounded" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-xs font-semibold">{order.externalOrderNumber}</span>
        <span className={cn('block truncate text-[11px]', active ? 'text-white/70' : 'text-muted-foreground')}>
          {logisticsDeadlineLabel(order, view.now)}
        </span>
      </span>
      {item && item.quantity > 1 && (
        <span className={cn('font-mono text-[11px] font-semibold', active ? 'text-white' : 'text-foreground')}>x{item.quantity}</span>
      )}
    </button>
  );
}

function WorkPanel({ order, view }: { order: LogisticsOrder; view: BandejaView }) {
  const urgency = logisticsUrgency(order, view.now);
  const meta = logisticsUrgencyMeta(urgency);
  return (
    <article className="rounded-xl border border-stone-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button type="button" onClick={() => view.openOrder(order)} className="font-mono text-xl font-semibold hover:underline">
            {order.externalOrderNumber}
          </button>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {sellerShortName(order.companyName)} · {logisticsChannelLabel(order.channelCode)} · {logisticsDeliveryLabel(order)}
          </p>
        </div>
        <p className={cn('text-sm font-semibold', meta.textClass)}>{logisticsDeadlineLabel(order, view.now)}</p>
      </div>
      <p className="mt-3 text-sm">{order.customer?.name || 'Sin cliente'}</p>
      {(order.shipping?.address || order.shipping?.district) && (
        <p className="text-xs text-muted-foreground">{[order.shipping?.address, order.shipping?.district].filter(Boolean).join(', ')}</p>
      )}
      <ul className="mt-4 space-y-2">
        {order.items.map((item) => (
          <li key={item.id} className="flex items-center gap-3 rounded-lg bg-stone-50 p-2">
            <ProductThumb item={item} className="size-14 rounded-md" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{item.description}</p>
              {item.sku && <p className="font-mono text-[11px] text-muted-foreground">{item.sku}</p>}
            </div>
            <QuantityTag item={item} />
          </li>
        ))}
      </ul>
      <div className="mt-5">
        <ActionButton order={order} view={view} size="default" full />
      </div>
    </article>
  );
}
