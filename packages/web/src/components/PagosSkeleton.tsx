import { Skeleton } from '@/components/ui/skeleton';
import { TablePanel } from '@/components/ui/table';
import { cn } from '@/lib/utils';

function KpiMetricSkeleton() {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1.5">
        <Skeleton className="size-2 rounded-[2px]" />
        <Skeleton className="h-3 w-16" />
      </div>
      <Skeleton className="mt-1 h-[17px] w-[7.25rem]" />
      <Skeleton className="mt-1 h-3 w-14" />
    </div>
  );
}

function SettlementKpiSkeleton() {
  return (
    <div
      className="grid grid-cols-1 items-start gap-x-8 gap-y-8 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]"
      aria-hidden
    >
      <div className="min-w-0">
        <div className="flex items-start gap-4">
          <KpiMetricSkeleton />
          <KpiMetricSkeleton />
        </div>
        <Skeleton className="mt-1 h-3 w-44" />
        <Skeleton className="mt-2 h-[148px] w-full" />
      </div>
      <div className="min-w-0">
        <KpiMetricSkeleton />
        <div className="mt-1.5 flex flex-wrap items-start gap-x-4 gap-y-1">
          <div className="flex items-start gap-1.5">
            <Skeleton className="mt-[3px] size-2 rounded-[2px]" />
            <Skeleton className="mt-px h-3 w-14" />
            <div>
              <Skeleton className="h-3 w-16" />
              <Skeleton className="mt-0.5 h-2.5 w-12" />
            </div>
          </div>
          <div className="flex items-start gap-1.5">
            <Skeleton className="mt-[3px] size-2 rounded-[2px]" />
            <Skeleton className="mt-px h-3 w-14" />
            <div>
              <Skeleton className="h-3 w-16" />
              <Skeleton className="mt-0.5 h-2.5 w-12" />
            </div>
          </div>
        </div>
        <Skeleton className="mt-1 h-3 w-32" />
        <div className="mt-2 flex w-max items-start gap-3">
          <div className="grid grid-cols-10 gap-[3px]">
            {Array.from({ length: 100 }, (_, index) => (
              <span key={index} className="size-[11px] animate-pulse rounded-[2px] bg-muted" />
            ))}
          </div>
          <div className="flex min-w-0 flex-col gap-1 pt-0.5">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="flex items-center gap-1.5">
                <Skeleton className="size-2 rounded-[2px]" />
                <Skeleton className="h-3 w-14" />
                <Skeleton className="h-3 w-7" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="min-w-0">
        <div className="flex items-start gap-4">
          <KpiMetricSkeleton />
          <KpiMetricSkeleton />
        </div>
        <Skeleton className="mt-1 h-3 w-40" />
        <div className="mt-2 grid w-full place-items-center">
          <Skeleton className="size-[148px] rounded-full" />
        </div>
      </div>
    </div>
  );
}

const TABLE_COLUMNS = [
  { width: 128, lines: 1, align: 'start' as const },
  { width: 132, lines: 1, align: 'start' as const },
  { width: 100, lines: 1, align: 'start' as const },
  { width: 104, pill: true, align: 'start' as const },
  { width: 96, lines: 1, align: 'start' as const },
  { width: 88, lines: 2, align: 'start' as const },
  { width: 92, lines: 2, align: 'end' as const },
  { width: 84, lines: 1, align: 'end' as const },
  { width: 108, lines: 2, align: 'end' as const },
  { width: 92, lines: 2, align: 'end' as const },
  { width: 92, lines: 1, align: 'end' as const },
  { width: 108, lines: 2, align: 'end' as const },
  { width: 108, lines: 2, align: 'end' as const },
];

function PagosTableSkeleton() {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[720px]">
        <div className="flex border-b border-border bg-muted">
          {TABLE_COLUMNS.map((column, index) => (
            <div
              key={index}
              className={cn(
                'flex h-10 shrink-0 items-center px-2.5',
                column.align === 'end' && 'justify-end',
              )}
              style={{ width: column.width, minWidth: column.width }}
            >
              <Skeleton className="h-3 w-14" />
            </div>
          ))}
        </div>
        {Array.from({ length: 10 }, (_, row) => (
          <div key={row} className="flex border-b border-border/70">
            {TABLE_COLUMNS.map((column, index) => (
              <div
                key={index}
                className={cn(
                  'flex h-[52px] shrink-0 items-center px-2.5',
                  column.align === 'end' && 'justify-end',
                )}
                style={{ width: column.width, minWidth: column.width }}
              >
                {column.pill ? (
                  <Skeleton className="h-5 w-16 rounded-full" />
                ) : column.lines === 2 ? (
                  <div className={cn('space-y-1', column.align === 'end' && 'flex flex-col items-end')}>
                    <Skeleton className="h-3.5 w-16" />
                    <Skeleton className="h-2.5 w-12" />
                  </div>
                ) : (
                  <Skeleton className={cn('h-3.5', index === 0 ? 'w-20' : 'w-16')} />
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function PagosSkeleton() {
  return (
    <div className="space-y-4 pb-8" role="status" aria-live="polite" aria-label="Cargando pagos">
      <SettlementKpiSkeleton />
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-9 w-[8.75rem]" />
        <Skeleton className="h-9 w-[8.25rem]" />
        <Skeleton className="h-9 w-[11.25rem]" />
        <Skeleton className="h-9 w-[8.75rem]" />
        <Skeleton className="h-9 w-[6.25rem]" />
      </div>
      <TablePanel>
        <PagosTableSkeleton />
      </TablePanel>
    </div>
  );
}
