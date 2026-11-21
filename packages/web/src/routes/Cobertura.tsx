import { useState } from 'react';
import { ExternalLink, Search, X } from 'lucide-react';
import {
  DINSIDES_AGENCY_AMOUNT,
  DINSIDES_COVERAGE_URL,
  DINSIDES_MIN_AMOUNT,
  DINSIDES_PACKAGE_LIMIT,
  DINSIDES_PICKUP_AMOUNT,
  DINSIDES_ZONE_LIST,
  searchDinsidesZones,
} from '../lib/dinsides-coverage';
import { dinsidesTierFor } from '../lib/dinsides-map';
import { formatSaleMoney } from '../lib/sale-summary';
import { cn } from '../lib/cn';
import { DinsidesCoverageMap } from '../components/DinsidesCoverageMap';

const SUGGESTION_LIMIT = 8;

function soles(amount: number) {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

/** Buscador de tarifas de Dinsides, con el mapa como apoyo visual. */
export default function Cobertura() {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const zone = DINSIDES_ZONE_LIST.find((row) => row.name === selected) ?? null;
  const typed = query.trim();
  const searching = typed !== '' && typed !== zone?.name;
  const suggestions = searching ? searchDinsidesZones(typed).slice(0, SUGGESTION_LIMIT) : [];
  const notFound = searching && suggestions.length === 0;
  const showSuggestions = open && suggestions.length > 0;

  const choose = (name: string) => {
    setSelected(name);
    setQuery(name);
    setOpen(false);
    setHighlight(0);
  };
  const reset = () => {
    setSelected(null);
    setQuery('');
    setHighlight(0);
  };

  return (
    <div className="space-y-6">
      <div className="relative mx-auto max-w-2xl">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' && suggestions.length) {
              event.preventDefault();
              setHighlight((index) => (index + 1) % suggestions.length);
            }
            if (event.key === 'ArrowUp' && suggestions.length) {
              event.preventDefault();
              setHighlight((index) => (index - 1 + suggestions.length) % suggestions.length);
            }
            if (event.key === 'Enter' && suggestions[highlight]) {
              event.preventDefault();
              choose(suggestions[highlight].name);
            }
            if (event.key === 'Escape') reset();
          }}
          placeholder="¿A qué distrito envías?"
          aria-label="Buscar distrito"
          aria-autocomplete="list"
          aria-expanded={showSuggestions}
          spellCheck={false}
          autoComplete="off"
          autoFocus
          className="h-14 w-full rounded-xl border border-input bg-background pl-12 pr-12 text-base shadow-sm outline-none transition-shadow placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/15"
        />
        {query ? (
          <button
            type="button"
            onClick={reset}
            className="absolute right-3 top-1/2 grid size-8 -translate-y-1/2 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Limpiar búsqueda"
          >
            <X className="size-4" />
          </button>
        ) : null}

        {showSuggestions ? (
          <ul
            role="listbox"
            className="absolute inset-x-0 top-full z-20 mt-2 overflow-hidden rounded-xl border border-border bg-popover py-1 shadow-lg"
          >
            {suggestions.map((row, index) => (
              <li key={row.name} role="option" aria-selected={index === highlight}>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => choose(row.name)}
                  className={cn(
                    'flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-left text-sm',
                    index === highlight && 'bg-muted',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: dinsidesTierFor(row.amount).top }} />
                    <span className="truncate font-medium">{row.name}</span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">{formatSaleMoney(row.amount)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:items-center">
        <div className="space-y-4">
          <section aria-live="polite" className="rounded-xl bg-primary px-5 py-5 text-primary-foreground">
            {zone ? (
              <>
                <p className="text-xs font-medium uppercase tracking-wider opacity-75">Sí llegamos a {zone.name}</p>
                <p className="mt-2 flex items-baseline gap-1.5">
                  <span className="text-2xl font-semibold opacity-80">S/</span>
                  <span className="text-6xl font-bold tracking-tight tabular-nums">{soles(zone.amount)}</span>
                </p>
                <p className="mt-2 text-sm opacity-80">Tarifa regular de Dinsides por envío a {zone.name}.</p>
              </>
            ) : notFound ? (
              <>
                <p className="text-xs font-medium uppercase tracking-wider opacity-75">Sin tarifa regular</p>
                <p className="mt-2 text-2xl font-semibold leading-tight">Dinsides no llega a «{typed}»</p>
                <p className="mt-2 text-sm opacity-80">
                  Envíalo a una agencia Shalom, Olva o Marvisur por {formatSaleMoney(DINSIDES_AGENCY_AMOUNT)}.
                </p>
              </>
            ) : (
              <>
                <p className="text-xs font-medium uppercase tracking-wider opacity-75">Lima y Callao</p>
                <p className="mt-2 flex items-baseline gap-2">
                  <span className="text-6xl font-bold tracking-tight tabular-nums">{DINSIDES_ZONE_LIST.length}</span>
                  <span className="text-3xl font-semibold">zonas</span>
                </p>
                <p className="mt-2 text-sm opacity-80">
                  Desde {formatSaleMoney(DINSIDES_MIN_AMOUNT)}. Busca el distrito o tócalo en el mapa.
                </p>
              </>
            )}
          </section>

          <dl className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border px-3 py-3">
              <dt className="text-lg font-semibold tabular-nums">{formatSaleMoney(DINSIDES_AGENCY_AMOUNT)}</dt>
              <dd className="mt-0.5 text-xs leading-4 text-muted-foreground">Envío a agencia Shalom, Olva o Marvisur</dd>
            </div>
            <div className="rounded-lg border border-border px-3 py-3">
              <dt className="text-lg font-semibold tabular-nums">{formatSaleMoney(DINSIDES_PICKUP_AMOUNT)}</dt>
              <dd className="mt-0.5 text-xs leading-4 text-muted-foreground">Retiro en sede Cercado o Gamarra</dd>
            </div>
          </dl>

          <div className="space-y-1.5 text-xs text-muted-foreground">
            <p>{DINSIDES_PACKAGE_LIMIT}. Medidas mayores, se cotiza con Dinsides.</p>
            <a
              href={DINSIDES_COVERAGE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-primary"
            >
              Ver en dinsides.com
              <ExternalLink className="size-3" />
            </a>
          </div>
        </div>

        <div className="min-w-0">
          <DinsidesCoverageMap selected={selected} onSelect={choose} />
        </div>
      </div>
    </div>
  );
}
