// PROTOTYPE C — "Tickets": una tarjeta por pedido, agrupadas por urgencia, acción grande al pie.
import { Loader2, PackageCheck, Printer, RefreshCw } from 'lucide-react';
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
  logisticsUrgencyMeta,
  LOGISTICS_CHANNELS,
  LOGISTICS_STAGES,
} from '../../lib/logistics-inbox';
import { Button } from '../../components/ui/button';
import { ActionButton, groupByUrgency, ProductThumb, QuantityTag, type BandejaView } from './shared';

const TOP: Record<string, string> = {
  overdue: 'border-t-rose-500',
  today: 'border-t-orange-400',
  tomorrow: 'border-t-indigo-400',
  later: 'border-t-slate-300',
};

export function VariantC({ view }: { view: BandejaView }) {
  const groups = view.stage === 'shipped' ? [{ key: 'later' as const, orders: view.orders }] : groupByUrgency(view.orders, view.now);
  const printable = view.orders.filter(canPrintLogisticsLabel);
  const readyCandidates = view.orders.filter(canMarkFalabellaReady);
  const summary = (['overdue', 'today', 'tomorrow', 'later'] as const)
    .filter((key) => view.counts.urgency[key] > 0)
    .map((key) => `${view.counts.urgency[key]} ${logisticsUrgencyMeta(key).label.toLowerCase()}`)
    .join(' · ');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label="Flujo de pedidos">
          {LOGISTICS_STAGES.map((tab) => (
            <button key={tab.value} type="button" role="tab" aria-selected={view.stage === tab.value} onClick={() => view.setStage(tab.value)}
              className={cn('rounded-md px-3 py-1.5 text-sm font-medium', view.stage === tab.value ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
              {tab.label} <span className="ml-1 tabular-nums text-muted-foreground">{view.counts[tab.value]}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {LOGISTICS_CHANNELS.filter((channel) => channel.value !== 'all').map((channel) => {
            const active = view.channelCode === channel.value;
            return (
              <button key={channel.value} type="button" aria-pressed={active} onClick={() => view.setChannelCode(active ? 'all' : channel.value)}
                className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs', active ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground')}>
                <span className={cn('size-1.5 rounded-full', logisticsChannelDotClass(channel.value))} />{channel.label}
              </button>
            );
          })}
          {printable.length > 0 && view.stage !== 'shipped' && (
            <Button size="sm" onClick={() => view.printOrders(printable)} disabled={view.printing}><Printer /> Imprimir {printable.length}</Button>
          )}
          {readyCandidates.length > 0 && view.canDispatch && (
            <Button size="sm" variant="outline" onClick={() => view.requestBulkReady(readyCandidates)}><PackageCheck /> Marcar todos</Button>
          )}
          <Button size="icon-sm" variant="outline" onClick={view.refresh} disabled={view.refreshing} aria-label="Sincronizar">{view.refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}</Button>
        </div>
      </div>
      {summary && view.stage !== 'shipped' && <p className="text-sm text-muted-foreground">{summary}</p>}

      {view.orders.length === 0 && <p className="py-20 text-center text-sm text-muted-foreground">{view.emptyCopy}</p>}
      {groups.map((group) => {
        const meta = logisticsUrgencyMeta(group.key);
        return (
          <section key={group.key} className="space-y-2">
            {view.stage !== 'shipped' && <h2 className="flex items-center gap-2 text-sm font-semibold"><span className={cn('size-2 rounded-full', meta.dotClass)} />{meta.label} <span className="text-muted-foreground">{group.orders.length}</span></h2>}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {group.orders.map((order) => (
                <article key={order.id} className={cn('flex flex-col rounded-lg border border-border border-t-2 bg-card', view.stage !== 'shipped' && TOP[group.key])}>
                  <header className="flex items-start justify-between gap-2 px-4 pt-3">
                    <div className="min-w-0">
                      <button type="button" onClick={() => view.openOrder(order)} className="font-mono text-base font-semibold hover:underline">{order.externalOrderNumber}</button>
                      <p className="truncate text-xs text-muted-foreground">{order.customer?.name || 'Sin cliente'} · {logisticsDeliveryLabel(order)}</p>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground"><span className={cn('size-1.5 rounded-full', logisticsChannelDotClass(order.channelCode))} />{logisticsChannelLabel(order.channelCode)}</span>
                  </header>
                  <ul className="flex-1 space-y-2 px-4 py-3">
                    {order.items.map((item) => (
                      <li key={item.id} className="flex items-center gap-2">
                        <ProductThumb item={item} className="size-10" />
                        <span className="min-w-0 flex-1 truncate text-sm">{item.description}</span>
                        <QuantityTag item={item} />
                      </li>
                    ))}
                  </ul>
                  <footer className="flex items-center justify-between gap-2 border-t border-border px-4 py-2.5">
                    <div className="min-w-0 text-xs">
                      <p className={cn('font-semibold', group.key === 'overdue' ? 'text-rose-700' : 'text-foreground')}>{view.stage === 'shipped' ? formatLogisticsDateTime(order.updatedAt) : logisticsDeadlineLabel(order, view.now)}</p>
                      <p className="truncate text-muted-foreground">{sellerShortName(order.companyName)}</p>
                    </div>
                    <ActionButton order={order} view={view} />
                  </footer>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
