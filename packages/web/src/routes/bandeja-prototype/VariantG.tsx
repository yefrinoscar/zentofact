// G — Tabla: una sola tabla operativa, el plazo es una celda, no una sección.
import { RefreshCw, Search } from 'lucide-react';
import { cn } from '../../lib/cn';
import { sellerShortName } from '../../lib/seller-name';
import {
  logisticsChannelLabel,
  logisticsDeadlineLabel,
  logisticsDeliveryLabel,
  logisticsUrgency,
  logisticsUrgencyMeta,
  LOGISTICS_CHANNELS,
  LOGISTICS_STAGES,
} from '../../lib/logistics-inbox';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { ActionButton, EmptyState, ProductThumb, QuantityTag, type BandejaView } from './shared';

export function VariantG({ view }: { view: BandejaView }) {
  return (
    <div className="space-y-3 pb-16">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Flujo de pedidos" className="flex rounded-md border border-border">
          {LOGISTICS_STAGES.map((tab) => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={view.stage === tab.value}
              onClick={() => view.setStage(tab.value)}
              className={cn('px-3 py-1.5 text-xs', view.stage === tab.value ? 'bg-muted font-semibold' : 'text-muted-foreground')}
            >
              {tab.label} {view.counts[tab.value]}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Canal" className="flex gap-1 text-xs">
          {LOGISTICS_CHANNELS.map((channel) => (
            <button
              key={channel.value}
              type="button"
              aria-pressed={view.channelCode === channel.value}
              onClick={() => view.setChannelCode(channel.value)}
              className={cn('rounded px-2 py-1', view.channelCode === channel.value ? 'bg-foreground text-background' : 'text-muted-foreground')}
            >
              {channel.label}
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={view.searchInput}
            onChange={(event) => view.setSearchInput(event.target.value)}
            placeholder="Buscar"
            aria-label="Buscar pedidos"
            className="h-8 w-36 pl-7 text-xs"
          />
        </div>
        <Button size="sm" variant="ghost" onClick={view.refresh} disabled={view.refreshing}>
          <RefreshCw className={cn(view.refreshing && 'animate-spin')} />
        </Button>
      </div>

      <EmptyState view={view}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-2 pr-3 font-medium">Pedido</th>
                <th className="py-2 pr-3 font-medium">Productos</th>
                <th className="py-2 pr-3 font-medium">Plazo</th>
                <th className="py-2 pr-3 font-medium">Entrega</th>
                <th className="py-2 font-medium">Acción</th>
              </tr>
            </thead>
            <tbody>
              {view.orders.map((order) => {
                const urgency = logisticsUrgency(order, view.now);
                const meta = logisticsUrgencyMeta(urgency);
                return (
                  <tr key={order.id} className="border-b border-border/70">
                    <td className="py-2 pr-3 align-top">
                      <button type="button" onClick={() => view.openOrder(order)} className="font-mono font-semibold hover:underline">
                        {order.externalOrderNumber}
                      </button>
                      <p className="text-[11px] text-muted-foreground">
                        {sellerShortName(order.companyName)} · {logisticsChannelLabel(order.channelCode)}
                      </p>
                    </td>
                    <td className="py-2 pr-3">
                      <ul className="space-y-1">
                        {order.items.map((item) => (
                          <li key={item.id} className="flex items-center gap-2">
                            <ProductThumb item={item} className="size-7 rounded" />
                            <span className="min-w-0 truncate text-xs">{item.description}</span>
                            <QuantityTag item={item} />
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className={cn('py-2 pr-3 text-xs font-semibold', meta.textClass)}>{logisticsDeadlineLabel(order, view.now)}</td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">{logisticsDeliveryLabel(order)}</td>
                    <td className="py-2"><ActionButton order={order} view={view} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </EmptyState>
    </div>
  );
}
