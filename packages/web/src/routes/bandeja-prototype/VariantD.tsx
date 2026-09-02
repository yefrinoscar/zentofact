// D — Turno: cuatro bloques de plazo son el filtro principal. Lista densa debajo.
import { RefreshCw, Search } from 'lucide-react';
import { cn } from '../../lib/cn';
import { sellerShortName } from '../../lib/seller-name';
import {
  logisticsChannelDotClass,
  logisticsDeadlineLabel,
  logisticsDeliveryLabel,
  LOGISTICS_STAGES,
  LOGISTICS_URGENCIES,
} from '../../lib/logistics-inbox';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { ActionButton, EmptyState, ProductThumb, QuantityTag, type BandejaView } from './shared';

const BLOCK: Record<string, string> = {
  overdue: 'bg-rose-600 text-white',
  today: 'bg-amber-400 text-amber-950',
  tomorrow: 'bg-sky-600 text-white',
  later: 'bg-zinc-200 text-zinc-800',
};
const BLOCK_OFF: Record<string, string> = {
  overdue: 'bg-rose-50 text-rose-800',
  today: 'bg-amber-50 text-amber-900',
  tomorrow: 'bg-sky-50 text-sky-800',
  later: 'bg-zinc-50 text-zinc-600',
};

export function VariantD({ view }: { view: BandejaView }) {
  return (
    <div className="space-y-3 pb-16">
      <div className="flex items-stretch gap-2">
        <div className="grid flex-1 grid-cols-2 gap-2 md:grid-cols-4">
          {LOGISTICS_URGENCIES.map((item) => {
            const active = view.urgency === item.value;
            const count = view.counts.urgency[item.value];
            return (
              <button
                key={item.value}
                type="button"
                aria-pressed={active}
                onClick={() => view.setUrgency(active ? null : item.value)}
                className={cn(
                  'rounded-xl px-3 py-2.5 text-left transition',
                  view.stage === 'shipped' ? 'pointer-events-none opacity-40' : active || !view.urgency ? BLOCK[item.value] : BLOCK_OFF[item.value],
                )}
              >
                <span className="block text-[11px] font-semibold uppercase tracking-wide opacity-80">{item.label}</span>
                <span className="block font-mono text-2xl font-semibold leading-none">{count}</span>
              </button>
            );
          })}
        </div>
        <Button size="icon" variant="outline" className="h-auto" onClick={view.refresh} disabled={view.refreshing} aria-label={view.canSync ? 'Sincronizar' : 'Actualizar'}>
          <RefreshCw className={cn(view.refreshing && 'animate-spin')} />
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Flujo de pedidos" className="flex gap-1 text-xs">
          {LOGISTICS_STAGES.map((tab) => {
            const active = view.stage === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => view.setStage(tab.value)}
                className={cn('rounded-md px-2 py-1', active ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted')}
              >
                {tab.label} {view.counts[tab.value]}
              </button>
            );
          })}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={view.searchInput}
            onChange={(event) => view.setSearchInput(event.target.value)}
            placeholder="Buscar"
            aria-label="Buscar pedidos"
            className="h-8 w-40 pl-7 text-xs"
          />
        </div>
      </div>

      <EmptyState view={view}>
        <ul className="divide-y divide-border">
          {view.orders.map((order) => {
            const item = order.items[0];
            return (
              <li key={order.id} className="flex items-center gap-3 py-2">
                <span className={cn('size-2 shrink-0 rounded-full', logisticsChannelDotClass(order.channelCode))} />
                <button type="button" onClick={() => view.openOrder(order)} className="w-28 truncate text-left font-mono text-sm font-semibold hover:underline">
                  {order.externalOrderNumber}
                </button>
                {item && <ProductThumb item={item} className="size-8 rounded" />}
                <p className="min-w-0 flex-1 truncate text-sm">{item?.description || 'Sin productos'}</p>
                {item && <QuantityTag item={item} />}
                <span className="hidden w-28 truncate text-xs text-muted-foreground md:block">{sellerShortName(order.companyName)}</span>
                <span className="hidden w-20 truncate text-xs text-muted-foreground lg:block">{logisticsDeliveryLabel(order)}</span>
                <span className="w-32 text-right text-xs font-medium">{logisticsDeadlineLabel(order, view.now)}</span>
                <ActionButton order={order} view={view} />
              </li>
            );
          })}
        </ul>
      </EmptyState>
    </div>
  );
}
