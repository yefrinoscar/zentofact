import { cn } from '../lib/cn';
import { LOGISTICS_URGENCIES } from '../lib/logistics-inbox';
import type { BandejaView } from './bandeja-prototype/shared';

const mobileLabels = { overdue: 'Vencidos', today: 'Hoy', tomorrow: 'Mañana', later: 'Próximos' };
const SUMMARY_URGENCIES = LOGISTICS_URGENCIES.filter((item) => item.value !== 'overdue');

export function BandejaDeadlineSummary({ view, error }: { view: BandejaView; error: boolean }) {
  const unavailable = view.loading || error;
  const total = SUMMARY_URGENCIES.reduce((sum, item) => sum + view.counts.urgency[item.value], 0);

  return (
    <section aria-label="Resumen de plazos" aria-busy={view.fetching} className="space-y-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold">Prioridad de entrega</h2>
        <p className="text-xs text-muted-foreground">
          {error ? 'No se pudo cargar el resumen' : view.loading ? 'Cargando plazos…' : <><span className="font-medium tabular-nums text-foreground">{total.toLocaleString('es-PE')}</span> sin enviar<span className="hidden sm:inline"> · por preparar y listos</span></>}
        </p>
      </div>
      <dl className="daisy-stats grid grid-flow-row grid-cols-3 overflow-hidden rounded-xl border border-border bg-muted/20 shadow-none">
        {SUMMARY_URGENCIES.map((urgency, index) => (
          <div key={urgency.value} className={cn(
            'daisy-stat min-w-0 gap-1 border-0 px-1 py-3 text-center sm:px-5 sm:py-4 sm:text-left',
            index < 2 && 'border-r border-border',
          )}>
            <button
              type="button"
              className="contents text-left"
              disabled={unavailable || urgency.value === 'later'}
              aria-pressed={view.urgency === urgency.value}
              onClick={() => view.setUrgency(view.urgency === urgency.value ? null : urgency.value)}
            >
              <dt className="daisy-stat-title flex items-center justify-center gap-2 whitespace-normal text-[11px] font-medium text-foreground sm:justify-start sm:text-sm">
                <span aria-hidden="true" className={cn('hidden size-1.5 shrink-0 rounded-full sm:block', urgency.dotClass)} />
                <span className="sm:hidden">{mobileLabels[urgency.value]}</span><span className="hidden sm:inline">{urgency.label}</span>
              </dt>
              <dd className={cn('daisy-stat-value mt-1 break-all text-2xl font-semibold tracking-tight tabular-nums sm:text-4xl', urgency.textClass)}>
                {unavailable ? '—' : view.counts.urgency[urgency.value].toLocaleString('es-PE')}
              </dd>
              <dd className="daisy-stat-desc mt-1 hidden whitespace-normal text-xs text-muted-foreground sm:block">
                {urgency.value === 'later' ? 'Después de mañana' : urgency.description}
              </dd>
            </button>
          </div>
        ))}
      </dl>
    </section>
  );
}
