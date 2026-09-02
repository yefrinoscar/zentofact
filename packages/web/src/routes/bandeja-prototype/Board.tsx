// Tablero B: una columna por plazo real. Sin Próximos ni Todos.
// Se recorre con flechas junto al refresh, sin barra nativa encima de las tarjetas.
import { useLayoutEffect, useRef, useState, type WheelEvent } from 'react';
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

function useColumnScroll(itemCount: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  const update = () => {
    const el = ref.current;
    if (!el) return;
    setCanPrev(el.scrollLeft > 8);
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
  };

  useLayoutEffect(() => {
    update();
    const onResize = () => update();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [itemCount]);

  const move = (direction: -1 | 1) => {
    const el = ref.current;
    if (!el) return;
    const step = Math.max(280, Math.round(el.clientWidth * 0.7));
    el.scrollTo({ left: el.scrollLeft + direction * step, behavior: 'smooth' });
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!delta) return;
    event.preventDefault();
    el.scrollLeft += delta;
    update();
  };

  return { ref, canPrev, canNext, move, update, onWheel };
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
  const scroll = useColumnScroll(columns.length);
  const showArrows = view.stage !== 'shipped' && (scroll.canPrev || scroll.canNext);

  return (
    <div className="space-y-3 pb-16">
      <StageTabs
        view={view}
        tools={showArrows ? (
          <>
            <Button size="icon-sm" variant="ghost" onClick={() => scroll.move(-1)} disabled={!scroll.canPrev} aria-label="Ver plazos anteriores">
              <ChevronLeft />
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={() => scroll.move(1)} disabled={!scroll.canNext} aria-label="Ver plazos siguientes">
              <ChevronRight />
            </Button>
          </>
        ) : null}
      />
      <EmptyState view={view}>
        <div
          ref={scroll.ref}
          onScroll={scroll.update}
          onWheel={scroll.onWheel}
          className="overflow-x-hidden"
        >
          <div className="flex w-max gap-3">
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
        </div>
      </EmptyState>
    </div>
  );
}
