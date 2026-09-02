// PROTOTYPE A — "Cola por plazo": una sola lista agrupada por urgencia; sin tarjetas ni paneles.
import { Loader2, PackageCheck, Printer, RefreshCw, Search } from 'lucide-react';
import { cn } from '../../lib/cn';
import { sellerShortName } from '../../lib/seller-name';
import {
  canMarkFalabellaReady,
  canPrintLogisticsLabel,
  formatLogisticsDateTime,
  logisticsChannelDotClass,
  logisticsChannelLabel,
  logisticsDeadlineLabel,
  logisticsDeliveryLabel,
  logisticsElapsedLabel,
  logisticsUrgencyMeta,
  LOGISTICS_CHANNELS,
  LOGISTICS_STAGES,
} from '../../lib/logistics-inbox';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { Input } from '../../components/ui/input';
import { ActionButton, groupByUrgency, ProductThumb, QuantityTag, type BandejaView } from './shared';

const RAIL: Record<string, string> = {
  overdue: 'border-rose-500',
  today: 'border-orange-400',
  tomorrow: 'border-indigo-400',
  later: 'border-border',
};
const HEAD: Record<string, string> = {
  overdue: 'text-rose-700',
  today: 'text-orange-700',
  tomorrow: 'text-indigo-700',
  later: 'text-muted-foreground',
};

export function VariantA({ view }: { view: BandejaView }) {
  const groups = view.stage === 'shipped'
    ? [{ key: 'later' as const, orders: view.orders }]
    : groupByUrgency(view.orders, view.now);
  const printable = view.orders.filter(canPrintLogisticsLabel);
  const readyCandidates = view.orders.filter(canMarkFalabellaReady);
  const selecting = view.labelSelection !== null;
  const selected = printable.filter((order) => view.labelSelection?.has(order.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border">
        <div role="tablist" aria-label="Flujo de pedidos" className="-mb-px flex gap-1">
          {LOGISTICS_STAGES.map((tab) => {
            const active = view.stage === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => view.setStage(tab.value)}
                className={cn(
                  'flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition',
                  active ? 'border-foreground font-semibold text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {tab.label}
                <span className={cn('rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums', active ? tab.badgeClass : 'bg-muted text-muted-foreground')}>{view.counts[tab.value]}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1.5 pb-2">
          {LOGISTICS_CHANNELS.map((channel) => {
            const active = view.channelCode === channel.value;
            return (
              <button
                key={channel.value}
                type="button"
                aria-pressed={active}
                onClick={() => view.setChannelCode(channel.value)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition',
                  active ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {channel.value !== 'all' && <span className={cn('size-1.5 rounded-full', logisticsChannelDotClass(channel.value))} />}
                {channel.label}
              </button>
            );
          })}
          <div className="relative ml-2">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={view.searchInput} onChange={(event) => view.setSearchInput(event.target.value)} placeholder="Buscar" aria-label="Buscar pedidos" className="h-8 w-36 pl-7 text-xs shadow-none" />
          </div>
          <Button size="icon-sm" variant="ghost" onClick={view.refresh} disabled={view.refreshing} aria-label={view.canSync ? 'Sincronizar' : 'Actualizar'}>
            {view.refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          </Button>
        </div>
      </div>

      {(printable.length > 0 || readyCandidates.length > 0) && view.stage !== 'shipped' && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{view.totalCount} pedido{view.totalCount === 1 ? '' : 's'} · actualizado {view.updatedAt ? formatLogisticsDateTime(view.updatedAt.toISOString()) : '—'}</span>
          <div className="flex items-center gap-1.5">
            {selecting ? (
              <>
                <span className="text-foreground">{selected.length} de {printable.length} etiquetas</span>
                <Button size="sm" variant="ghost" onClick={() => view.setLabelSelection(null)}>Cancelar</Button>
                <Button size="sm" onClick={() => view.printOrders(selected)} disabled={!selected.length || view.printing}>
                  {view.printing ? <Loader2 className="animate-spin" /> : <Printer />} Imprimir {selected.length || ''}
                </Button>
              </>
            ) : (
              <>
                {printable.length > 0 && (
                  <Button size="sm" variant="outline" onClick={() => view.setLabelSelection(new Set(printable.map((order) => order.id)))}>
                    <Printer /> Imprimir etiquetas
                  </Button>
                )}
                {readyCandidates.length > 0 && view.canDispatch && (
                  <Button size="sm" variant="outline" onClick={() => view.requestBulkReady(readyCandidates)}>
                    <PackageCheck /> Marcar todos ({readyCandidates.length})
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {view.loading ? (
        <p className="py-20 text-center text-sm text-muted-foreground">Cargando pedidos…</p>
      ) : view.orders.length === 0 ? (
        <p className="py-20 text-center text-sm text-muted-foreground">{view.emptyCopy}</p>
      ) : groups.map((group) => {
        const meta = logisticsUrgencyMeta(group.key);
        return (
          <section key={group.key} aria-label={meta.label}>
            {view.stage !== 'shipped' && (
              <h2 className={cn('mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide', HEAD[group.key])}>
                {meta.label}
                <span className="font-mono text-[11px] font-medium opacity-70">{group.orders.length}</span>
              </h2>
            )}
            <ul className="divide-y divide-border">
              {group.orders.map((order) => {
                const isSelected = Boolean(view.labelSelection?.has(order.id));
                return (
                  <li
                    key={order.id}
                    className={cn(
                      'grid grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)_minmax(0,0.9fr)_auto] items-center gap-4 border-l-[3px] py-3 pl-3 pr-1 transition hover:bg-muted/40',
                      view.stage === 'shipped' ? 'border-l-transparent' : RAIL[group.key],
                      isSelected && 'bg-indigo-50/60',
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {selecting && canPrintLogisticsLabel(order) && (
                        <Checkbox checked={isSelected} onCheckedChange={() => view.toggleLabel(order)} aria-label={`Seleccionar ${order.externalOrderNumber}`} />
                      )}
                      <div className="min-w-0">
                        <button type="button" onClick={() => view.openOrder(order)} className="flex items-center gap-1.5 font-mono text-sm font-semibold hover:underline">
                          <span className={cn('size-2 rounded-full', logisticsChannelDotClass(order.channelCode))} title={logisticsChannelLabel(order.channelCode)} />
                          {order.externalOrderNumber}
                        </button>
                        <p className="truncate text-xs text-muted-foreground">{order.customer?.name || 'Sin cliente'} · {sellerShortName(order.companyName)} · {logisticsDeliveryLabel(order)}</p>
                      </div>
                    </div>
                    <div className="min-w-0 space-y-1">
                      {order.items.slice(0, 3).map((item) => (
                        <div key={item.id} className="flex min-w-0 items-center gap-2">
                          <ProductThumb item={item} className="size-9" />
                          <span className="min-w-0 flex-1 truncate text-sm" title={item.description}>{item.description}</span>
                          <QuantityTag item={item} />
                        </div>
                      ))}
                      {order.items.length > 3 && <p className="pl-11 text-xs text-muted-foreground">+{order.items.length - 3} más</p>}
                    </div>
                    <div className="min-w-0 text-right text-xs">
                      {view.stage === 'shipped'
                        ? <p className="font-medium">{formatLogisticsDateTime(order.updatedAt)}</p>
                        : <p className={cn('font-semibold', HEAD[group.key], group.key === 'later' && 'text-foreground')}>{logisticsDeadlineLabel(order, view.now)}</p>}
                      <p className="text-muted-foreground">Ingresó {logisticsElapsedLabel(order.createdAt || order.orderedAt, view.now)}</p>
                    </div>
                    <div className="w-32 text-right"><ActionButton order={order} view={view} /></div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
