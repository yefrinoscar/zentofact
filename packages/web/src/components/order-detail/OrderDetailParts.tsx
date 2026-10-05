import { useRef, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

export type StatusTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

const DOT_TONE: Record<StatusTone, string> = {
  success: 'bg-emerald-500',
  info: 'bg-sky-500',
  warning: 'bg-amber-500',
  danger: 'bg-rose-500',
  neutral: 'bg-muted-foreground/40',
};

export function StatusDot({ tone, className }: { tone: StatusTone; className?: string }) {
  return <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', DOT_TONE[tone], className)} />;
}

/** Pestañas tipo Notion: pastilla suave en la activa, sin subrayado. Igual que la ficha de producto. */
export const DRAWER_TAB_CLASS = 'h-8 flex-none rounded-lg px-2.5 text-[13px] font-medium text-muted-foreground shadow-none hover:bg-muted/70 hover:text-foreground data-active:bg-muted! data-active:font-semibold data-active:text-foreground! after:hidden [&[data-state=active]>span]:bg-background [&[data-state=active]>span]:text-foreground [&_svg]:size-3.5';

export function TabCount({ value }: { value: number }) {
  return <span className="ml-0.5 min-w-4 rounded-full bg-foreground/[0.06] px-1.5 text-[11px] leading-4 tabular-nums text-muted-foreground">{value}</span>;
}

export type Metric = { label: string; value: ReactNode; hint?: ReactNode; tone?: StatusTone; onSelect?: () => void };

/** Cuatro métricas del pedido con la misma retícula: total y los tres estados operativos. */
export function MetricStrip({ metrics }: { metrics: Metric[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-4">
      {metrics.map((metric) => {
        const body = (
          <>
            <dt className="text-xs text-muted-foreground">{metric.label}</dt>
            <dd className="mt-1 flex min-w-0 items-center gap-2 text-[15px] font-medium leading-6">
              {metric.tone && <StatusDot tone={metric.tone} className="size-2" />}
              <span className="truncate">{metric.value}</span>
            </dd>
            {metric.hint ? <dd className="mt-0.5 truncate text-xs text-muted-foreground">{metric.hint}</dd> : null}
          </>
        );
        return metric.onSelect ? (
          <button
            key={metric.label}
            type="button"
            onClick={metric.onSelect}
            className="-m-2 min-w-0 cursor-pointer rounded-lg p-2 text-left transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {body}
          </button>
        ) : (
          <div key={metric.label} className="min-w-0">{body}</div>
        );
      })}
    </dl>
  );
}

export function PropertySection({
  title,
  hint,
  aside,
  id,
  children,
}: {
  title: string;
  hint?: string;
  aside?: ReactNode;
  id?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-label={title} className="scroll-mt-6">
      <div className="mb-2 flex min-h-6 items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <h3 className="text-sm font-semibold">{title}</h3>
          {hint && <span className="truncate text-xs text-muted-foreground">{hint}</span>}
        </div>
        {aside && <div className="flex shrink-0 items-center gap-2">{aside}</div>}
      </div>
      <div className="-mx-2">{children}</div>
    </section>
  );
}

const ROW_CLASS = 'grid min-h-9 grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)] items-center gap-x-3 rounded-lg px-2 transition-colors sm:grid-cols-[10rem_minmax(0,1fr)]';
const LABEL_CLASS = 'flex min-w-0 items-center gap-2 truncate text-sm text-muted-foreground [&_svg]:size-3.5 [&_svg]:shrink-0';

export function PropertyRow({ icon, label, align = 'center', children }: { icon?: ReactNode; label: string; align?: 'center' | 'start'; children: ReactNode }) {
  return (
    <div className={cn(ROW_CLASS, 'hover:bg-muted/40', align === 'start' ? 'items-start py-2' : 'items-center')}>
      <span className={cn(LABEL_CLASS, align === 'start' && 'pt-px')}>{icon}{label}</span>
      <div className="min-w-0 text-sm">{children}</div>
    </div>
  );
}

export function EmptyValue({ children = 'Vacío' }: { children?: ReactNode }) {
  return <span className="text-muted-foreground/60">{children}</span>;
}

/** Propiedad editable en sitio: clic para editar, Enter o salir para guardar, Escape para cancelar. */
export function InlineTextProperty({
  icon,
  label,
  value,
  display,
  placeholder = 'Vacío',
  type = 'text',
  inputMode,
  saving,
  readOnly,
  initialEditing,
  hint,
  onSave,
  onCancel,
}: {
  icon?: ReactNode;
  label: string;
  value: string;
  display?: ReactNode;
  placeholder?: string;
  type?: 'text' | 'tel' | 'date' | 'number';
  inputMode?: 'text' | 'tel' | 'numeric' | 'decimal';
  saving?: boolean;
  readOnly?: boolean;
  /** Abre la propiedad ya en edición (por ejemplo, tras cambiar DNI por RUC). */
  initialEditing?: boolean;
  hint?: string;
  onSave: (value: string) => void;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(initialEditing ? value : null);
  const cancelled = useRef(false);
  const editing = draft !== null;
  if (readOnly) {
    return <PropertyRow icon={icon} label={label}>{value ? (display ?? value) : <EmptyValue>{placeholder}</EmptyValue>}</PropertyRow>;
  }
  return (
    <div
      role={editing ? undefined : 'button'}
      tabIndex={editing ? undefined : 0}
      aria-label={editing ? undefined : `Editar ${label.toLowerCase()}`}
      className={cn(ROW_CLASS, 'cursor-text outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50', editing && 'bg-muted/60')}
      onClick={() => { if (!editing) setDraft(value); }}
      onKeyDown={(event) => {
        if (!editing && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          setDraft(value);
        }
      }}
    >
      <span className={LABEL_CLASS}>{icon}{label}</span>
      <div className="flex min-w-0 items-center gap-1.5 text-sm">
        {editing ? (
          <input
            className={cn(
              'h-9 w-full min-w-0 appearance-none border-0 bg-transparent p-0 text-sm text-foreground shadow-none outline-none ring-0 placeholder:text-muted-foreground/50 focus:ring-0',
              type === 'number' && 'tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
            )}
            type={type}
            inputMode={inputMode}
            value={draft}
            placeholder={placeholder}
            aria-label={label}
            autoComplete="off"
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              if (!cancelled.current && draft !== null && draft.trim() !== value.trim()) onSave(draft.trim());
              else onCancel?.();
              cancelled.current = false;
              setDraft(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                cancelled.current = true;
                event.currentTarget.blur();
              }
            }}
          />
        ) : (
          <span className="min-w-0 truncate">{value ? (display ?? value) : <EmptyValue>{placeholder}</EmptyValue>}</span>
        )}
        {editing && hint && <span className="shrink-0 text-xs text-muted-foreground">{hint}</span>}
        {saving && <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label="Guardando" />}
      </div>
    </div>
  );
}

export function InlineSelectProperty({
  icon,
  label,
  value,
  options,
  placeholder = 'Vacío',
  saving,
  readOnly,
  onSave,
}: {
  icon?: ReactNode;
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  placeholder?: string;
  saving?: boolean;
  readOnly?: boolean;
  onSave: (value: string) => void;
}) {
  const current = options.find((option) => option.value === value);
  if (readOnly) {
    return <PropertyRow icon={icon} label={label}>{current ? current.label : <EmptyValue>{placeholder}</EmptyValue>}</PropertyRow>;
  }
  return (
    <div className={cn(ROW_CLASS, 'hover:bg-muted/60')}>
      <span className={LABEL_CLASS}>{icon}{label}</span>
      <div className="flex min-w-0 items-center gap-1.5">
        <Select value={value || undefined} onValueChange={(next) => { if (next !== value) onSave(next); }}>
          <SelectTrigger
            aria-label={label}
            className="-ml-px h-9! w-full cursor-pointer justify-start gap-1 rounded-none border-0 bg-transparent px-0 shadow-none hover:bg-transparent focus-visible:ring-0 [&>svg:last-child]:ml-auto [&>svg:last-child]:opacity-0 hover:[&>svg:last-child]:opacity-60"
          >
            <SelectValue placeholder={<EmptyValue>{placeholder}</EmptyValue>} />
          </SelectTrigger>
          <SelectContent align="start">
            {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {saving && <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label="Guardando" />}
      </div>
    </div>
  );
}

/** Número editable en sitio para filas de producto (cantidad, precio, comisión). */
export function InlineNumber({
  value,
  display,
  label,
  prefix,
  className,
  readOnly,
  min = 0,
  integer,
  onSave,
}: {
  value: number | null | undefined;
  display: ReactNode;
  label: string;
  prefix?: string;
  className?: string;
  readOnly?: boolean;
  min?: number;
  integer?: boolean;
  onSave: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const cancelled = useRef(false);
  if (readOnly) return <span className={className}>{display}</span>;
  if (draft === null) {
    return (
      <button
        type="button"
        title={`Editar ${label.toLowerCase()}`}
        onClick={() => setDraft(value == null ? '' : String(value))}
        className={cn('-mx-1 cursor-text rounded-md px-1 tabular-nums transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none', className)}
      >
        {display}
      </button>
    );
  }
  const commit = (input: HTMLInputElement) => {
    const parsed = Number(String(draft).replace(',', '.'));
    const valid = String(draft).trim() !== '' && Number.isFinite(parsed) && parsed >= min;
    if (!cancelled.current && !valid) {
      // No se descarta en silencio: se queda en edición marcado como inválido.
      setInvalid(true);
      window.requestAnimationFrame(() => input.focus());
      return;
    }
    if (!cancelled.current && parsed !== Number(value)) {
      onSave(integer ? parsed : Math.round(parsed * 100) / 100);
    }
    cancelled.current = false;
    setInvalid(false);
    setDraft(null);
  };
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md bg-muted px-1 tabular-nums', invalid && 'ring-1 ring-destructive', className)}>
      {prefix && <span className="text-muted-foreground">{prefix}</span>}
      <input
        aria-label={label}
        aria-invalid={invalid || undefined}
        inputMode={integer ? 'numeric' : 'decimal'}
        autoFocus
        value={draft}
        size={Math.max(2, draft.length + 1)}
        className="w-auto min-w-0 border-0 bg-transparent p-0 text-right tabular-nums outline-none focus:ring-0"
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => { setInvalid(false); setDraft(event.target.value.replace(integer ? /[^0-9]/g : /[^0-9.,]/g, '')); }}
        onBlur={(event) => commit(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            cancelled.current = true;
            event.currentTarget.blur();
          }
        }}
      />
    </span>
  );
}

export type AmountLine = { label: string; value: string };

/** Pie tipo recibo: importes alineados a la derecha y total separado por una línea. */
export function AmountSummary({ lines, total }: { lines: AmountLine[]; total: string }) {
  return (
    <dl className="ml-auto w-full max-w-64 space-y-1.5 text-sm">
      {lines.map((line) => (
        <div key={line.label} className="flex items-baseline justify-between gap-4">
          <dt className="text-muted-foreground">{line.label}</dt>
          <dd className="tabular-nums">{line.value}</dd>
        </div>
      ))}
      <div className="flex items-baseline justify-between gap-4 border-t border-border/70 pt-2.5">
        <dt className="font-medium">Total</dt>
        <dd className="text-base font-semibold tabular-nums">{total}</dd>
      </div>
    </dl>
  );
}

export type TimelineEntry = {
  id: string | number;
  title: string;
  detail?: ReactNode;
  meta: string;
  time: string;
  tone: StatusTone;
};

export type TimelineGroup = { label: string; entries: TimelineEntry[] };

export function ActivityTimeline({ groups }: { groups: TimelineGroup[] }) {
  return (
    <div className="space-y-7">
      {groups.map((group) => (
        <section key={group.label} aria-label={group.label}>
          <h4 className="mb-3 text-xs font-medium text-muted-foreground">{group.label}</h4>
          <ol>
            {group.entries.map((entry, index) => (
              <li key={entry.id} className="relative grid grid-cols-[1rem_minmax(0,1fr)_auto] gap-x-3.5 pb-5 last:pb-0">
                {index < group.entries.length - 1 && (
                  <span aria-hidden="true" className="absolute top-5 bottom-1 left-[7.5px] w-px bg-border" />
                )}
                <span className="mt-1.5 grid size-4 place-items-center">
                  <StatusDot tone={entry.tone} className="size-2 ring-4 ring-background" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-7">{entry.title}</p>
                  {entry.detail && <div className="text-[13px] text-foreground/80">{entry.detail}</div>}
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{entry.meta}</p>
                </div>
                <time className="text-xs leading-7 tabular-nums text-muted-foreground">{entry.time}</time>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div role="status" aria-label="Cargando pedido" className="flex flex-1 flex-col motion-safe:animate-pulse">
      <div className="h-12 border-b border-border/60" />
      <div className="space-y-4 px-6 pt-7 pb-6 sm:px-10">
        <div className="flex items-center gap-2">
          <div className="size-5 rounded-md bg-muted" />
          <div className="h-3 w-40 rounded bg-muted" />
        </div>
        <div className="h-8 w-56 rounded-md bg-muted" />
        <div className="grid grid-cols-2 gap-8 pt-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((cell) => (
            <div key={cell} className="space-y-2">
              <div className="h-3 w-12 rounded bg-muted" />
              <div className="h-5 w-20 rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
      <div className="flex gap-2 border-b border-border/70 px-4 pb-2 sm:px-8">
        {[0, 1, 2].map((tab) => <div key={tab} className="h-8 w-24 rounded-lg bg-muted" />)}
      </div>
      <div className="space-y-3 px-6 py-6 sm:px-10">
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <div key={row} className="grid grid-cols-[10rem_1fr] gap-3">
            <div className="h-4 w-24 rounded bg-muted" />
            <div className="h-4 w-44 rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}
