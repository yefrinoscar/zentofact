// Tablero B: una columna por plazo real. Sin Próximos ni Todos.
// El recorre es con flechas a los lados, no con la barra nativa encima de las tarjetas.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn';
import { logisticsUrgencyMeta } from '../../lib/logistics-inbox';
import { Button } from '../../components/ui/button';
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

const COLUMN_STEP = 332;

function ColumnRail({ children, itemCount }: { children: ReactNode; itemCount: number }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  const update = () => {
    const el = scroller.current;
    if (!el) return;
    setCanPrev(el.scrollLeft > 4);
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };

  useLayoutEffect(() => {
    update();
    const el = scroller.current;
    if (!el) return;
    const onResize = () => update();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [itemCount]);

  const move = (direction: -1 | 1) => {
    scroller.current?.scrollBy({ left: direction * COLUMN_STEP, behavior: 'smooth' });
  };

  const showArrows = canPrev || canNext;

  return (
    <div className="flex items-start gap-2">
      {showArrows && (
        <Button
          size="icon-sm"
          variant="outline"
          className="mt-1 shrink-0"
          onClick={() => move(-1)}
          disabled={!canPrev}
          aria-label="Ver plazos anteriores"
        >
          <ChevronLeft />
        </Button>
      )}
      <div
        ref={scroller}
        onScroll={update}
        className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>
      {showArrows && (
        <Button
          size="icon-sm"
          variant="outline"
          className="mt-1 shrink-0"
          onClick={() => move(1)}
          disabled={!canNext}
          aria-label="Ver plazos siguientes"
        >
          <ChevronRight />
        </Button>
      )}
    </div>
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
  const columns = view.stage === 'shipped'
    ? [{ key: 'shipped', label: 'Enviados', tone: 'later' as const, orders: view.orders }]
    : buildDeadlineColumns(view.orders, view.now);

  return (
    <div className="space-y-3 pb-16">
      <StageTabs view={view} />
      <EmptyState view={view}>
        <ColumnRail itemCount={columns.length}>
          <div className="flex gap-3">
            {columns.map((column) => {
              const meta = logisticsUrgencyMeta(column.tone);
              const named = column.key === 'overdue' || column.key === 'today' || column.key === 'tomorrow' || column.key === 'shipped';
              return (
                <section
                  key={column.key}
                  className={cn(
                    'rounded-xl p-2',
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
        </ColumnRail>
      </EmptyState>
    </div>
  );
}
