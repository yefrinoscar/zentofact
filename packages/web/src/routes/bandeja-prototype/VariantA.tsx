// A — Tablero: cuatro columnas de plazo. Imprimir el grupo desde el encabezado.
import { cn } from '../../lib/cn';
import { logisticsUrgencyMeta, LOGISTICS_URGENCIES } from '../../lib/logistics-inbox';
import {
  BoardOrder,
  EmptyState,
  PrintGroupButton,
  StageTabs,
  groupByUrgency,
  type BandejaView,
} from './shared';

const RAIL: Record<string, string> = {
  overdue: 'border-l-rose-500',
  today: 'border-l-amber-400',
  tomorrow: 'border-l-sky-500',
  later: 'border-l-zinc-300',
};

export function BoardColumns({ view }: { view: BandejaView }) {
  const groups = new Map(groupByUrgency(view.orders, view.now).map((group) => [group.key, group.orders]));
  return (
    <div className={cn('grid gap-6', view.stage === 'shipped' ? 'grid-cols-1' : 'md:grid-cols-2 xl:grid-cols-4')}>
      {LOGISTICS_URGENCIES.map((column) => {
        const orders = view.stage === 'shipped' && column.value !== 'later' ? [] : (groups.get(column.value) || []);
        if (view.stage === 'shipped' && column.value !== 'later') return null;
        const meta = logisticsUrgencyMeta(column.value);
        return (
          <section key={column.value} className={cn('border-l-2 pl-3', view.stage === 'shipped' ? 'border-l-transparent' : RAIL[column.value])}>
            <div className="mb-1 flex items-center justify-between gap-2">
              <h2 className={cn('text-sm font-semibold', meta.textClass)}>
                {view.stage === 'shipped' ? 'Enviados' : column.label} {orders.length}
              </h2>
              <PrintGroupButton orders={orders} view={view} label={column.label} />
            </div>
            <ul className="divide-y divide-border/70">
              {orders.map((order) => <BoardOrder key={order.id} order={order} view={view} />)}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export function VariantA({ view }: { view: BandejaView }) {
  return (
    <div className="space-y-4 pb-16">
      <StageTabs view={view} />
      <EmptyState view={view}>
        <BoardColumns view={view} />
      </EmptyState>
    </div>
  );
}
