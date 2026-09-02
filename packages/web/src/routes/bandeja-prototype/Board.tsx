// Tablero B: cuatro columnas de plazo, una tarjeta por pedido.
// Refinamientos: tabs nuestros + imprimir el grupo de la columna.
import { cn } from '../../lib/cn';
import { logisticsUrgencyMeta, LOGISTICS_URGENCIES } from '../../lib/logistics-inbox';
import {
  BoardCard,
  EmptyState,
  PrintGroupButton,
  StageTabs,
  groupByUrgency,
  type BandejaView,
} from './shared';

const COLUMN: Record<string, string> = {
  overdue: 'bg-rose-50',
  today: 'bg-amber-50',
  tomorrow: 'bg-sky-50',
  later: 'bg-zinc-50',
};

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
