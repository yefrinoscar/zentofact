// C — Limpio: el tablero sin riel de color. Una lista por plazo e imprimir el grupo.
import {
  BoardOrder,
  EmptyState,
  PrintGroupButton,
  StageTabs,
  groupByUrgency,
  type BandejaView,
} from './shared';
import { LOGISTICS_URGENCIES } from '../../lib/logistics-inbox';

export function VariantC({ view }: { view: BandejaView }) {
  const groups = groupByUrgency(view.orders, view.now);
  const sections = view.stage === 'shipped'
    ? [{ key: 'later' as const, orders: view.orders }]
    : groups;

  return (
    <div className="space-y-4 pb-16">
      <StageTabs view={view} />
      <EmptyState view={view}>
        <div className="space-y-8">
          {sections.map((section) => {
            const column = LOGISTICS_URGENCIES.find((item) => item.value === section.key) || LOGISTICS_URGENCIES[3];
            return (
              <section key={section.key}>
                <div className="mb-1 flex items-baseline justify-between gap-3 border-b border-border pb-1">
                  <h2 className="text-sm font-semibold">
                    {view.stage === 'shipped' ? 'Enviados' : column.label} {section.orders.length}
                  </h2>
                  <PrintGroupButton orders={section.orders} view={view} label={column.label} />
                </div>
                <ul>
                  {section.orders.map((order) => <BoardOrder key={order.id} order={order} view={view} />)}
                </ul>
              </section>
            );
          })}
        </div>
      </EmptyState>
    </div>
  );
}
