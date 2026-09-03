// PROTOTYPE — ¿el plazo va arriba o Listos se queda como ahora?
// A: plazo abajo (barra Falabella). C: plazo arriba, Listos al lado.
import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { cn } from '../../lib/cn';
import { type LogisticsStage } from '../../lib/logistics-inbox';
import { Button } from '../../components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs';
import {
  BoardCard,
  EmptyState,
  PrintGroupButton,
  StageTabs,
  buildDeadlineColumns,
  type BandejaView,
  type LogisticsOrder,
} from './shared';

function badgeClass(key: string, active: boolean) {
  if (!active) return 'bg-background text-muted-foreground';
  if (key === 'overdue') return 'bg-rose-100 text-rose-800';
  if (key === 'today') return 'bg-amber-100 text-amber-800';
  return 'bg-sky-100 text-sky-800';
}

type DeadlineTab = { value: string; label: string; orders: LogisticsOrder[] };

function buildDeadlineTabs(orders: LogisticsOrder[], now: Date): DeadlineTab[] {
  return buildDeadlineColumns(orders, now).map((column) => ({
    value: column.key,
    label: column.label,
    orders: column.orders,
  }));
}

function defaultTab(tabs: DeadlineTab[]) {
  return tabs.find((tab) => tab.value === 'today')?.value
    || tabs[0]?.value
    || 'today';
}

function DeadlinePills({
  tabs,
  selected,
  onSelect,
}: {
  tabs: DeadlineTab[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div role="tablist" aria-label="Plazo de entrega" className="flex max-w-full gap-1 overflow-x-auto rounded-2xl bg-muted p-1">
      {tabs.map((tab) => {
        const active = selected === tab.value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(tab.value)}
            className={cn(
              'inline-flex shrink-0 items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-medium transition',
              active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
            <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums', badgeClass(tab.value, active))}>
              {tab.orders.length}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function CompactStage({ view }: { view: BandejaView }) {
  return (
    <Tabs value={view.stage} onValueChange={(value) => view.setStage(value as LogisticsStage)}>
      <TabsList aria-label="Flujo de pedidos">
        <TabsTrigger value="pending">Pendientes {view.counts.pending}</TabsTrigger>
        <TabsTrigger value="ready">Listos {view.counts.ready}</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

function CardList({
  view,
  orders,
  showRowAction,
}: {
  view: BandejaView;
  orders: LogisticsOrder[];
  showRowAction: boolean;
}) {
  if (!orders.length) {
    return <p className="py-16 text-center text-sm text-muted-foreground">Ningún pedido en este plazo.</p>;
  }
  return (
    <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      {orders.map((order) => (
        <BoardCard key={order.id} order={order} view={view} showRowAction={showRowAction} />
      ))}
    </ul>
  );
}

function useDeadlineTabs(view: BandejaView) {
  const tabs = buildDeadlineTabs(view.orders, view.now);
  const [tab, setTab] = useState<string | null>(null);
  const selected = tabs.some((item) => item.value === tab) ? tab! : defaultTab(tabs);
  const visible = tabs.find((item) => item.value === selected)?.orders || view.orders;
  const label = tabs.find((item) => item.value === selected)?.label || 'Pedidos';
  return { tabs, selected, setTab, visible, label };
}

export function DeadlineBelow({ view }: { view: BandejaView }) {
  const { tabs, selected, setTab, visible, label } = useDeadlineTabs(view);
  return (
    <div className="space-y-3 pb-16">
      <StageTabs view={view} />
      {view.stage !== 'shipped' && tabs.length > 0 && (
        <DeadlinePills tabs={tabs} selected={selected} onSelect={setTab} />
      )}
      <div className="flex justify-end">
        <PrintGroupButton orders={visible} view={view} label={label} emphasize />
      </div>
      <EmptyState view={view}>
        <CardList view={view} orders={view.stage === 'shipped' ? view.orders : visible} showRowAction />
      </EmptyState>
    </div>
  );
}

export function DeadlineAbove({ view }: { view: BandejaView }) {
  const { tabs, selected, setTab, visible, label } = useDeadlineTabs(view);
  return (
    <div className="space-y-3 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {view.stage === 'shipped' ? <CompactStage view={view} /> : (
          <DeadlinePills tabs={tabs} selected={selected} onSelect={setTab} />
        )}
        <div className="flex items-center gap-2">
          {view.stage !== 'shipped' && <CompactStage view={view} />}
          <Button size="icon-sm" variant="ghost" onClick={view.refresh} disabled={view.refreshing} aria-label={view.canSync ? 'Sincronizar' : 'Actualizar'}>
            <RefreshCw className={cn(view.refreshing && 'animate-spin')} />
          </Button>
        </div>
      </div>
      <div className="flex justify-end">
        <PrintGroupButton orders={visible} view={view} label={label} emphasize />
      </div>
      <EmptyState view={view}>
        <CardList view={view} orders={view.stage === 'shipped' ? view.orders : visible} showRowAction />
      </EmptyState>
    </div>
  );
}
