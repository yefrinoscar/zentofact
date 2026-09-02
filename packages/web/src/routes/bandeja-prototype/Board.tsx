// Tablero B: una columna por plazo real, scroll horizontal. Sin Próximos ni Todos.
import { cn } from '../../lib/cn';
import { logisticsUrgencyMeta } from '../../lib/logistics-inbox';
import {
  BoardCard,
  EmptyState,
  PrintGroupButton,
  StageTabs,
  buildDeadlineColumns,
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
  const columns = view.stage === 'shipped'
    ? [{ key: 'shipped', label: 'Enviados', tone: 'later' as const, orders: view.orders }]
    : buildDeadlineColumns(view.orders, view.now);

  return (
    <div className="space-y-3 pb-16">
      <StageTabs view={view} />
      <EmptyState view={view}>
        <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2">
          {columns.map((column) => {
            const meta = logisticsUrgencyMeta(column.tone);
            const named = column.key === 'overdue' || column.key === 'today' || column.key === 'tomorrow' || column.key === 'shipped';
            return (
              <section
                key={column.key}
                className={cn(
                  'snap-start rounded-xl p-2',
                  view.stage === 'shipped' ? 'min-w-0 w-full bg-zinc-50' : cn('w-[20rem] shrink-0', COLUMN[column.tone]),
                )}
              >
                <div className="mb-1 flex items-center justify-between gap-1 px-1 py-1">
                  <h2 className={cn('text-xs font-semibold tracking-wide', named && 'uppercase', meta.textClass)}>
                    {column.label} · {column.orders.length}
                  </h2>
                  <PrintGroupButton orders={column.orders} view={view} label={column.label} emphasize={emphasizePrint} />
                </div>
                <ul className="space-y-2">
                  {column.orders.map((order) => (
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
