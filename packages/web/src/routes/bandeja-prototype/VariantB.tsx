// B — Plazo: elige Vencen hoy (tabs nuestros) e imprime solo ese grupo, como Falabella.
import { logisticsUrgencyMeta } from '../../lib/logistics-inbox';
import {
  BoardOrder,
  EmptyState,
  PrintGroupButton,
  StageTabs,
  UrgencyTabs,
  type BandejaView,
} from './shared';
import { BoardColumns } from './VariantA';

export function VariantB({ view }: { view: BandejaView }) {
  const focused = view.stage !== 'shipped' ? view.urgency : null;
  const meta = focused ? logisticsUrgencyMeta(focused) : null;

  return (
    <div className="space-y-4 pb-16">
      <StageTabs view={view} />
      <UrgencyTabs view={view} />
      {focused && meta ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <h2 className={`text-sm font-semibold ${meta.textClass}`}>{meta.label}</h2>
            <PrintGroupButton orders={view.orders} view={view} label={meta.label} emphasize />
          </div>
          <EmptyState view={view}>
            <ul className="divide-y divide-border">
              {view.orders.map((order) => <BoardOrder key={order.id} order={order} view={view} />)}
            </ul>
          </EmptyState>
        </>
      ) : (
        <EmptyState view={view}>
          <BoardColumns view={view} />
        </EmptyState>
      )}
    </div>
  );
}
