import { CalendarDays } from 'lucide-react';
import { formatSalesCount, formatSalesMoney, type SalesDayPoint } from '../lib/product-sales-presentation';
import { Badge } from './ui/badge';
import { Skeleton } from './ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TablePanel, TableRow } from './ui/table';

const fullDayLabel = new Intl.DateTimeFormat('es-PE', {
  weekday: 'long',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

const parseDate = (date: string) => new Date(`${date}T12:00:00Z`);
const sentenceCaseDay = (date: string) => {
  const label = fullDayLabel.format(parseDate(date));
  return `${label.charAt(0).toLocaleUpperCase('es-PE')}${label.slice(1)}`;
};

export function SalesOverview({ daily, loading }: { daily: SalesDayPoint[]; loading: boolean }) {
  const rows = [...daily].sort((left, right) => right.date.localeCompare(left.date));
  const peakRevenue = rows.reduce((peak, row) => Math.max(peak, row.revenue), 0);

  return (
    <section aria-labelledby="daily-sales-title">
      <div className="mb-2 flex items-end justify-between gap-3">
        <div>
          <h2 id="daily-sales-title" className="flex items-center gap-2 text-sm font-semibold">
            <CalendarDays className="size-4 text-muted-foreground" aria-hidden="true" />
            Venta por día
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Fecha, ventas y unidades del periodo.</p>
        </div>
        {!loading && rows.length > 0 ? (
          <span className="text-xs tabular-nums text-muted-foreground">{formatSalesCount(rows.length)} días</span>
        ) : null}
      </div>

      <TablePanel aria-label="Venta por día" aria-busy={loading}>
        {loading ? <DailySalesSkeleton /> : rows.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">Sin ventas en este periodo.</div>
        ) : (
          <div className="max-h-[25rem] overflow-y-auto">
            <Table className="daisy-table daisy-table-sm">
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-9 w-[52%] px-3 text-xs">Fecha</TableHead>
                  <TableHead className="h-9 w-[28%] px-3 text-right text-xs">Ventas</TableHead>
                  <TableHead className="h-9 w-[20%] px-3 text-right text-xs">Uds. vendidas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const isPeak = peakRevenue > 0 && row.revenue === peakRevenue;
                  return (
                    <TableRow key={row.date} className="hover:bg-muted/30">
                      <TableCell className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <time dateTime={row.date}>
                            {sentenceCaseDay(row.date)}
                          </time>
                          {isPeak ? <Badge variant="secondary" className="h-5 text-[10px]">Mayor venta</Badge> : null}
                        </div>
                      </TableCell>
                      <TableCell className="px-3 py-2.5 text-right font-medium tabular-nums">
                        {formatSalesMoney(row.revenue)}
                      </TableCell>
                      <TableCell className="px-3 py-2.5 text-right tabular-nums">
                        {formatSalesCount(row.units)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </TablePanel>
    </section>
  );
}

function DailySalesSkeleton() {
  return (
    <Table className="table-fixed" aria-label="Cargando venta por día">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-[52%]"><Skeleton className="h-4 w-16" /></TableHead>
          <TableHead className="w-[28%]"><Skeleton className="ml-auto h-4 w-14" /></TableHead>
          <TableHead className="w-[20%]"><Skeleton className="ml-auto h-4 w-16" /></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: 7 }, (_, index) => (
          <TableRow key={index} className="hover:bg-transparent">
            <TableCell><Skeleton className="h-4 w-40 max-w-full" /></TableCell>
            <TableCell><Skeleton className="ml-auto h-4 w-20" /></TableCell>
            <TableCell><Skeleton className="ml-auto h-4 w-10" /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
