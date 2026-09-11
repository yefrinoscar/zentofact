import { cn } from '../lib/cn';
import { LOGISTICS_URGENCIES } from '../lib/logistics-inbox';
import type { BandejaView } from './bandeja-prototype/shared';

const SUMMARY_URGENCIES = LOGISTICS_URGENCIES.filter((item) => item.value !== 'overdue');

export function BandejaDeadlineSummary({ view, error }: { view: BandejaView; error: boolean }) {
  const unavailable = view.loading || error;
  const total = SUMMARY_URGENCIES.reduce((sum, item) => sum + view.counts.urgency[item.value], 0);

  return (
    <section aria-label="Resumen de plazos" aria-busy={view.fetching} className="space-y-2.5">
      <div className="hidden flex-wrap items-baseline justify-between gap-x-3 gap-y-1 sm:flex">
        <h2 className="text-sm font-semibold">Prioridad de entrega</h2>
        <p className="text-xs text-muted-foreground">
          {error ? 'No se pudo cargar el resumen' : view.loading ? 'Cargando plazos…' : <><span className="font-medium tabular-nums text-foreground">{total.toLocaleString('es-PE')}</span> sin enviar<span className="hidden sm:inline"> · por preparar y listos</span></>}
        </p>
      </div>
      <dl className="grid grid-cols-3 gap-1 py-2 sm:gap-0 sm:overflow-hidden sm:rounded-xl sm:border sm:border-border sm:bg-muted/20 sm:py-0">
        {SUMMARY_URGENCIES.map((urgency, index) => (
          <div key={urgency.value} className={cn(
            'relative min-w-0 px-1 py-1 text-center sm:px-5 sm:py-4 sm:text-left',
            index < 2 && 'sm:border-r sm:border-border',
          )}>
            {urgency.value !== 'later' && <button
              type="button"
              className="absolute inset-0 hidden rounded-sm focus-visible:outline-2 focus-visible:outline-ring sm:block"
              aria-label={urgency.label}
              aria-pressed={view.urgency === urgency.value}
              disabled={unavailable}
              onClick={() => view.setUrgency(view.urgency === urgency.value ? null : urgency.value)}
            />}
            <dt className="whitespace-nowrap text-[11px] font-medium text-muted-foreground sm:text-sm">
              {urgency.label}
            </dt>
            <dd className={cn('mt-1 text-center text-2xl font-semibold tracking-tight tabular-nums sm:text-left sm:text-4xl', urgency.textClass)}>
              {unavailable ? '—' : view.counts.urgency[urgency.value].toLocaleString('es-PE')}
            </dd>
            <dd className="mt-1 hidden text-xs text-muted-foreground sm:block">
              {urgency.value === 'later' ? 'Después de mañana' : urgency.description}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
