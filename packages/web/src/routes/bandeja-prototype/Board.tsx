// Tablero B: cuatro columnas de plazo, una tarjeta por pedido.
// Refinamientos: tabs nuestros + imprimir el grupo de la columna.
import { cn } from '../../lib/cn';
import { sellerShortName } from '../../lib/seller-name';
import {
  logisticsDeadlineLabel,
  logisticsDeliveryLabel,
  logisticsUrgencyMeta,
  LOGISTICS_URGENCIES,
} from '../../lib/logistics-inbox';
import {
  ActionButton,
  ChannelMark,
  EmptyState,
  PrintGroupButton,
  ProductThumb,
  QuantityTag,
  StageTabs,
  groupByUrgency,
  type BandejaView,
  type LogisticsOrder,
} from './shared';

const COLUMN: Record<string, string> = {
  overdue: 'bg-rose-50',
  today: 'bg-amber-50',
  tomorrow: 'bg-sky-50',
  later: 'bg-zinc-50',
};

function BoardCard({
  order,
  view,
  showRowAction,
}: {
  order: LogisticsOrder;
  view: BandejaView;
  showRowAction: boolean;
}) {
  const meta = logisticsUrgencyMeta(order.urgency);
  return (
    <li className="rounded-lg border border-white/80 bg-white p-2.5 shadow-sm">
      <button type="button" onClick={() => view.openOrder(order)} className="flex w-full items-center gap-1.5 text-left">
        <ChannelMark code={order.channelCode} />
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
        {showRowAction && <ActionButton order={order} view={view} />}
      </div>
    </li>
  );
}

export function Board({
  view,
  emphasizePrint = false,
  showRowAction = true,
}: {
  view: BandejaView;
  emphasizePrint?: boolean;
  showRowAction?: boolean;
}) {
  const groups = new Map(groupByUrgency(view.orders, view.now).map((group) => [group.key, group.orders]));

  return (
    <div className="space-y-3 pb-16">
      <StageTabs view={view} />
      <EmptyState view={view}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {LOGISTICS_URGENCIES.map((column) => {
            const orders = view.stage === 'shipped' && column.value !== 'later' ? [] : (groups.get(column.value) || []);
            if (view.stage === 'shipped' && column.value !== 'later') return null;
            const meta = logisticsUrgencyMeta(column.value);
            return (
              <section key={column.value} className={cn('rounded-xl p-2', view.stage === 'shipped' ? 'bg-zinc-50 xl:col-span-4' : COLUMN[column.value])}>
                <div className="mb-1 flex items-center justify-between gap-1 px-1 py-1">
                  <h2 className={cn('text-xs font-semibold uppercase tracking-wide', meta.textClass)}>
                    {view.stage === 'shipped' ? 'Enviados' : column.label} · {orders.length}
                  </h2>
                  <PrintGroupButton orders={orders} view={view} label={column.label} emphasize={emphasizePrint} />
                </div>
                <ul className="space-y-2">
                  {orders.map((order) => (
                    <BoardCard key={order.id} order={order} view={view} showRowAction={showRowAction} />
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
