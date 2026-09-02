// PROTOTYPE — ¿el plazo va arriba o Listos se queda como ahora?
// A: plazo abajo (barra Falabella). C: plazo arriba, Listos al lado.
import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { cn } from '../../lib/cn';
import {
  logisticsUrgency,
  parseLogisticsDate,
  type LogisticsStage,
} from '../../lib/logistics-inbox';
import { Button } from '../../components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs';
import {
  BoardCard,
  EmptyState,
  PrintGroupButton,
  StageTabs,
  type BandejaView,
  type LogisticsOrder,
} from './shared';

const LIMA = 'America/Lima';

function limaDateKey(date: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: LIMA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function datePillLabel(key: string, now: Date) {
  const [year, month, day] = key.split('-').map(Number);
  if (!year || !month || !day) return key;
  return new Intl.DateTimeFormat('es-PE', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    ...(year === Number(limaDateKey(now).slice(0, 4)) ? {} : { year: 'numeric' as const }),
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function orderDeadlineKey(order: LogisticsOrder, now: Date) {
  const deadline = parseLogisticsDate(order.promisedShippingAt);
  if (!deadline) return 'no-date';
  const urgency = logisticsUrgency(order, now);
  if (urgency === 'overdue') return 'overdue';
  if (urgency === 'today') return 'today';
  if (urgency === 'tomorrow') return 'tomorrow';
  return limaDateKey(deadline);
}

function deadlineTabLabel(key: string, now: Date) {
  if (key === 'all') return 'Todos';
  if (key === 'overdue') return 'Vencidos';
  if (key === 'today') return 'Vencen hoy';
  if (key === 'tomorrow') return 'Vencen mañana';
  if (key === 'no-date') return 'Sin fecha';
  return datePillLabel(key, now);
}

function badgeClass(key: string, active: boolean) {
  if (!active) return 'bg-background text-muted-foreground';
  if (key === 'overdue') return 'bg-rose-100 text-rose-800';
  if (key === 'today') return 'bg-amber-100 text-amber-800';
  return 'bg-sky-100 text-sky-800';
}

type DeadlineTab = { value: string; label: string; orders: LogisticsOrder[] };

function buildDeadlineTabs(orders: LogisticsOrder[], now: Date): DeadlineTab[] {
  const groups = new Map<string, LogisticsOrder[]>();
  for (const order of orders) {
    const key = orderDeadlineKey(order, now);
    const list = groups.get(key) || [];
    list.push(order);
    groups.set(key, list);
  }
  const later = [...groups.keys()]
    .filter((key) => key !== 'overdue' && key !== 'today' && key !== 'tomorrow' && key !== 'no-date')
    .sort((left, right) => left.localeCompare(right));
  const keys = ['overdue', 'today', 'tomorrow', ...later, 'no-date'].filter((key) => (groups.get(key) || []).length);
  return [
    { value: 'all', label: 'Todos', orders },
    ...keys.map((key) => ({ value: key, label: deadlineTabLabel(key, now), orders: groups.get(key) || [] })),
  ].filter((tab) => tab.orders.length);
}

function defaultTab(tabs: DeadlineTab[]) {
  return tabs.find((tab) => tab.value === 'overdue')?.value
    || tabs.find((tab) => tab.value === 'today')?.value
    || tabs[0]?.value
    || 'all';
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
        <TabsTrigger value="shipped">Enviados {view.counts.shipped}</TabsTrigger>
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
