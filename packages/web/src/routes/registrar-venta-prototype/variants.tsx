/* PROTOTYPE — Doce bases de color y forma para nueva venta, `?variant=1`…`12`. */
import { useState, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { cn } from '../../lib/cn';
import { SALE_SOURCES } from '../../lib/registrar-venta';
import { Button } from '../../components/ui/button';
import { formatMoney } from './widgets';
import {
  ClienteBody,
  EntregaBody,
  OrigenBody,
  PagoBody,
  ProductosBody,
} from './bodies';
import type { SaleFormView } from './view';

const FIVE = ['Origen', 'Cliente', 'Productos', 'Entrega', 'Pago'] as const;

const TONE = [
  { bar: 'bg-sky-500', soft: 'bg-sky-100 text-sky-950', ring: 'ring-sky-400' },
  { bar: 'bg-violet-500', soft: 'bg-violet-100 text-violet-950', ring: 'ring-violet-400' },
  { bar: 'bg-amber-500', soft: 'bg-amber-100 text-amber-950', ring: 'ring-amber-400' },
  { bar: 'bg-teal-500', soft: 'bg-teal-100 text-teal-950', ring: 'ring-teal-400' },
  { bar: 'bg-rose-500', soft: 'bg-rose-100 text-rose-950', ring: 'ring-rose-400' },
] as const;

const SOURCE_TILE: Record<string, string> = {
  marketplace: 'bg-slate-800 text-white',
  whatsapp: 'bg-emerald-500 text-white',
  instagram: 'bg-fuchsia-500 text-white',
  telefono: 'bg-sky-500 text-white',
  otro: 'bg-amber-500 text-white',
};

function useStep(count = 5, start = 1) {
  const [step, setStep] = useState(Math.min(start, count - 1));
  return {
    step,
    setStep,
    isLast: step === count - 1,
    next: () => setStep((value) => Math.min(count - 1, value + 1)),
  };
}

function FiveBody({ view, step }: { view: SaleFormView; step: number }) {
  if (step === 0) return <OrigenBody view={view} />;
  if (step === 1) return <ClienteBody view={view} />;
  if (step === 2) return <ProductosBody view={view} />;
  if (step === 3) return <EntregaBody view={view} />;
  return <PagoBody view={view} />;
}

function Peek({ view }: { view: SaleFormView }) {
  return (
    <p className="text-xs text-muted-foreground">
      {view.customerName || 'Sin cliente'}
      {' · '}
      {view.lines.length} producto{view.lines.length === 1 ? '' : 's'}
      {' · '}
      {view.delivery === 'envio' ? 'Envío' : 'Recojo'}
      {' · '}
      {view.paymentMethod === 'despues' ? 'Después' : view.paymentMethod === 'yape_plin' ? 'Yape' : view.paymentMethod}
      {' · '}
      {formatMoney(view.total)}
    </p>
  );
}

function Volver({ view, className }: { view: SaleFormView; className?: string }) {
  return (
    <button
      type="button"
      className={cn('inline-flex cursor-pointer items-center gap-1 text-sm', className)}
      onClick={() => view.navigate(view.afterSavePath)}
    >
      <ArrowLeft className="size-4" /> Volver
    </button>
  );
}

function Cta({
  view,
  isLast,
  onNext,
  className,
}: {
  view: SaleFormView;
  isLast: boolean;
  onNext: () => void;
  className?: string;
}) {
  if (isLast) {
    return (
      <Button type="submit" disabled={view.submitDisabled} className={className}>
        {view.creating ? 'Listo…' : 'Registrar venta'}
      </Button>
    );
  }
  return (
    <Button type="button" onClick={onNext} className={className}>
      Siguiente
    </Button>
  );
}

function SourceTiles({ view }: { view: SaleFormView }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {SALE_SOURCES.map((option) => {
        const on = option.value === view.saleSource;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => view.setSaleSource(option.value)}
            className={cn(
              'h-20 cursor-pointer rounded-2xl text-sm font-medium transition',
              on ? SOURCE_TILE[option.value] : 'bg-muted text-muted-foreground hover:text-foreground',
              on && 'ring-2 ring-offset-2 ring-foreground/20',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** 1 — Tinta: papel crema, barras navy. */
export function Variant1({ view }: { view: SaleFormView }) {
  const nav = useStep();
  return (
    <div className="-mx-1 space-y-5 rounded-[2rem] bg-amber-50 px-5 py-6 text-slate-900 sm:px-8">
      <div className="flex items-center justify-between">
        <Volver view={view} className="text-slate-600" />
        <Peek view={view} />
      </div>
      <div className="flex flex-wrap gap-2">
        {FIVE.map((label, index) => (
          <button
            key={label}
            type="button"
            onClick={() => nav.setStep(index)}
            className={cn(
              'h-11 cursor-pointer rounded-md px-4 text-sm font-semibold',
              index === nav.step ? 'bg-slate-900 text-amber-50' : 'bg-amber-100 text-slate-600',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <FiveBody view={view} step={nav.step} />
      <div className="flex justify-end">
        <Cta view={view} isLast={nav.isLast} onNext={nav.next} className="h-11 rounded-md bg-slate-900 px-5 text-amber-50 hover:bg-slate-800" />
      </div>
    </div>
  );
}

/** 2 — Lima: lavado verde, pills gordas. */
export function Variant2({ view }: { view: SaleFormView }) {
  const nav = useStep();
  return (
    <div className="space-y-5 rounded-[2.5rem] bg-lime-100 p-6 text-lime-950">
      <div className="flex items-center justify-between">
        <Volver view={view} />
        <p className="text-3xl font-black tabular-nums tracking-tight">{formatMoney(view.total)}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {FIVE.map((label, index) => (
          <button
            key={label}
            type="button"
            onClick={() => nav.setStep(index)}
            className={cn(
              'h-12 cursor-pointer rounded-full px-5 text-sm font-bold',
              index === nav.step ? 'bg-lime-600 text-white shadow-lg shadow-lime-600/30' : 'bg-white/70 text-lime-800',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="rounded-[2rem] bg-white p-5">
        {nav.step === 0 ? <SourceTiles view={view} /> : <FiveBody view={view} step={nav.step} />}
      </div>
      <Cta view={view} isLast={nav.isLast} onNext={nav.next} className="h-12 w-full rounded-full bg-lime-600 text-base text-white hover:bg-lime-700" />
    </div>
  );
}

/** 3 — Canela: terracota y tarjetas. */
export function Variant3({ view }: { view: SaleFormView }) {
  const nav = useStep();
  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-3xl bg-orange-600 px-6 py-5 text-orange-50">
        <div className="flex items-center justify-between">
          <Volver view={view} className="text-orange-50" />
          <p className="text-2xl font-semibold tabular-nums">{formatMoney(view.total)}</p>
        </div>
        <p className="mt-4 text-4xl font-semibold tracking-tight">{FIVE[nav.step]}</p>
        <div className="mt-4 flex gap-2">
          {FIVE.map((label, index) => (
            <button
              key={label}
              type="button"
              aria-label={label}
              onClick={() => nav.setStep(index)}
              className={cn('h-2 flex-1 cursor-pointer rounded-full', index <= nav.step ? 'bg-orange-50' : 'bg-orange-400')}
            />
          ))}
        </div>
      </div>
      <div className="rounded-3xl border border-orange-200 bg-orange-50/60 p-5">
        <FiveBody view={view} step={nav.step} />
      </div>
      <div className="flex justify-end">
        <Cta view={view} isLast={nav.isLast} onNext={nav.next} className="h-11 rounded-2xl bg-orange-600 px-6 text-white hover:bg-orange-700" />
      </div>
    </div>
  );
}

/** 4 — Noche: isla oscura, acento cian. */
export function Variant4({ view }: { view: SaleFormView }) {
  const nav = useStep();
  return (
    <div className="rounded-[2rem] bg-zinc-950 p-6 text-zinc-50">
      <div className="flex items-center justify-between">
        <Volver view={view} className="text-zinc-400" />
        <Peek view={view} />
      </div>
      <ol className="mt-6 flex flex-wrap gap-3">
        {FIVE.map((label, index) => (
          <li key={label}>
            <button
              type="button"
              onClick={() => nav.setStep(index)}
              className={cn(
                'cursor-pointer rounded-xl px-3 py-2 text-left',
                index === nav.step ? 'bg-cyan-400 text-zinc-950' : 'bg-zinc-800 text-zinc-400',
              )}
            >
              <span className="block font-mono text-[10px] opacity-70">0{index + 1}</span>
              <span className="text-sm font-medium">{label}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="mt-6 rounded-2xl bg-zinc-900 p-5 [&_label]:text-zinc-400 [&_input]:border-zinc-700 [&_input]:bg-zinc-950 [&_input]:text-zinc-50">
        <FiveBody view={view} step={nav.step} />
      </div>
      <div className="mt-5 flex justify-end">
        <Cta view={view} isLast={nav.isLast} onNext={nav.next} className="rounded-xl bg-cyan-400 text-zinc-950 hover:bg-cyan-300" />
      </div>
    </div>
  );
}

/** 5 — Recibo: papel térmico. */
export function Variant5({ view }: { view: SaleFormView }) {
  const nav = useStep();
  return (
    <div className="mx-auto max-w-md space-y-4 bg-[repeating-linear-gradient(transparent,transparent_28px,#fde68a33_28px,#fde68a33_29px)] px-6 py-8 font-mono">
      <p className="text-center text-xs tracking-[0.4em] text-amber-800">ZENTOFACT</p>
      <p className="text-center text-2xl font-bold">NUEVA VENTA</p>
      <p className="border-y border-dashed border-amber-800/50 py-2 text-center text-xs">{FIVE[nav.step].toUpperCase()} · {nav.step + 1}/5</p>
      <div className="flex justify-center gap-1">
        {FIVE.map((label, index) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            onClick={() => nav.setStep(index)}
            className={cn('size-3 cursor-pointer', index === nav.step ? 'bg-amber-800' : 'bg-amber-300')}
          />
        ))}
      </div>
      <div className="rounded-sm border border-dashed border-amber-800/40 bg-amber-50 p-4">
        <FiveBody view={view} step={nav.step} />
      </div>
      <p className="text-center text-3xl font-bold tabular-nums">{formatMoney(view.total)}</p>
      <Cta view={view} isLast={nav.isLast} onNext={nav.next} className="w-full rounded-none bg-amber-800 text-amber-50 hover:bg-amber-900" />
      <Peek view={view} />
    </div>
  );
}

/** 6 — Baldosas: mosaico de color. */
export function Variant6({ view }: { view: SaleFormView }) {
  const nav = useStep();
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {FIVE.map((label, index) => (
          <button
            key={label}
            type="button"
            onClick={() => nav.setStep(index)}
            className={cn(
              'h-24 cursor-pointer rounded-3xl text-left text-sm font-semibold',
              TONE[index].soft,
              index === nav.step && `ring-4 ${TONE[index].ring}`,
            )}
          >
            <span className="block px-4 pt-3 text-xs opacity-60">0{index + 1}</span>
            <span className="block px-4">{label}</span>
          </button>
        ))}
      </div>
      {nav.step === 0 ? <SourceTiles view={view} /> : (
        <div className={cn('rounded-3xl p-5', TONE[nav.step].soft)}>
          <FiveBody view={view} step={nav.step} />
        </div>
      )}
      <div className="flex items-center justify-between">
        <Peek view={view} />
        <Cta view={view} isLast={nav.isLast} onNext={nav.next} className={cn('rounded-2xl text-white hover:opacity-90', TONE[nav.step].bar)} />
      </div>
    </div>
  );
}

/** 7 — Franja: banner a todo el ancho. */
export function Variant7({ view }: { view: SaleFormView }) {
  const nav = useStep();
  const tone = TONE[nav.step];
  return (
    <div className="-mx-4 space-y-5 sm:-mx-6">
      <div className={cn('px-6 py-8 text-white', tone.bar)}>
        <Volver view={view} className="text-white/80" />
        <p className="mt-4 text-sm font-medium uppercase tracking-widest text-white/70">Paso {nav.step + 1} de 5</p>
        <h2 className="mt-1 text-5xl font-semibold tracking-tight">{FIVE[nav.step]}</h2>
      </div>
      <div className="px-6">
        <div className="flex flex-wrap gap-2">
          {FIVE.map((label, index) => (
            <button
              key={label}
              type="button"
              onClick={() => nav.setStep(index)}
              className={cn('cursor-pointer rounded-full px-3 py-1 text-sm', index === nav.step ? `${TONE[index].bar} text-white` : TONE[index].soft)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-5">
          <FiveBody view={view} step={nav.step} />
        </div>
        <div className="mt-6 flex justify-end">
          <Cta view={view} isLast={nav.isLast} onNext={nav.next} className={cn('rounded-full text-white hover:opacity-90', tone.bar)} />
        </div>
      </div>
    </div>
  );
}

/** 8 — Columnas: el actual se abre. */
export function Variant8({ view }: { view: SaleFormView }) {
  const nav = useStep();
  return (
    <div className="grid min-h-[28rem] gap-2 lg:grid-cols-5">
      {FIVE.map((label, index) => {
        const open = index === nav.step;
        return (
          <section key={label} className={cn('flex min-h-48 flex-col overflow-hidden rounded-2xl', TONE[index].soft)}>
            <button
              type="button"
              onClick={() => nav.setStep(index)}
              className={cn('cursor-pointer px-4 py-3 text-left text-sm font-semibold', open && TONE[index].bar, open && 'text-white')}
            >
              {label}
            </button>
            {open && (
              <div className="flex-1 bg-white/80 p-4">
                <FiveBody view={view} step={nav.step} />
                <div className="mt-4 flex justify-end">
                  <Cta view={view} isLast={nav.isLast} onNext={nav.next} className={cn('rounded-xl text-white hover:opacity-90', TONE[index].bar)} />
                </div>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** 9 — Brutal: negro, amarillo, sin radio. */
export function Variant9({ view }: { view: SaleFormView }) {
  const nav = useStep();
  return (
    <div className="space-y-0 border-4 border-black bg-yellow-300 text-black">
      <div className="flex items-center justify-between border-b-4 border-black px-4 py-3">
        <Volver view={view} className="font-black uppercase" />
        <p className="font-black tabular-nums">{formatMoney(view.total)}</p>
      </div>
      <div className="grid grid-cols-5 border-b-4 border-black">
        {FIVE.map((label, index) => (
          <button
            key={label}
            type="button"
            onClick={() => nav.setStep(index)}
            className={cn(
              'cursor-pointer border-r-4 border-black py-3 text-xs font-black uppercase last:border-r-0',
              index === nav.step ? 'bg-black text-yellow-300' : 'bg-yellow-300',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="bg-white p-5">
        <FiveBody view={view} step={nav.step} />
      </div>
      <Cta view={view} isLast={nav.isLast} onNext={nav.next} className="h-14 w-full rounded-none bg-black text-lg font-black uppercase text-yellow-300 hover:bg-zinc-800" />
    </div>
  );
}

/** 10 — Globos: pasteles muy redondos. */
export function Variant10({ view }: { view: SaleFormView }) {
  const nav = useStep();
  const wash = ['bg-sky-100', 'bg-violet-100', 'bg-amber-100', 'bg-teal-100', 'bg-rose-100'][nav.step];
  return (
    <div className={cn('space-y-6 rounded-[3rem] p-8', wash)}>
      <div className="flex flex-wrap justify-center gap-3">
        {FIVE.map((label, index) => (
          <button
            key={label}
            type="button"
            onClick={() => nav.setStep(index)}
            className={cn(
              'size-20 cursor-pointer rounded-full text-[11px] font-semibold shadow-md',
              index === nav.step ? `${TONE[index].bar} text-white` : 'bg-white text-slate-600',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="rounded-[2.5rem] bg-white/80 p-6 shadow-sm">
        <FiveBody view={view} step={nav.step} />
      </div>
      <div className="flex justify-center">
        <Cta view={view} isLast={nav.isLast} onNext={nav.next} className={cn('h-14 rounded-full px-10 text-white shadow-lg hover:opacity-90', TONE[nav.step].bar)} />
      </div>
    </div>
  );
}

/** 11 — Lista: todas las secciones, la actual se pinta. */
export function Variant11({ view }: { view: SaleFormView }) {
  const nav = useStep();
  const bodies: ReactNode[] = [
    <OrigenBody key="o" view={view} />,
    <ClienteBody key="c" view={view} />,
    <ProductosBody key="p" view={view} />,
    <EntregaBody key="e" view={view} />,
    <PagoBody key="g" view={view} />,
  ];
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Volver view={view} />
        <Cta view={view} isLast={nav.isLast} onNext={nav.next} className={cn('rounded-xl text-white hover:opacity-90', TONE[nav.step].bar)} />
      </div>
      {FIVE.map((label, index) => (
        <section
          key={label}
          className={cn(
            'overflow-hidden rounded-2xl border-l-8',
            index === nav.step ? `${TONE[index].soft} ${TONE[index].bar.replace('bg-', 'border-')}` : 'border-transparent bg-muted/40',
          )}
        >
          <button
            type="button"
            onClick={() => nav.setStep(index)}
            className="flex w-full cursor-pointer items-center justify-between px-4 py-3 text-left"
          >
            <span className="font-semibold">{label}</span>
            <span className={cn('size-3 rounded-full', TONE[index].bar)} />
          </button>
          {index === nav.step && <div className="px-4 pb-4">{bodies[index]}</div>}
        </section>
      ))}
      <Peek view={view} />
    </div>
  );
}

/** 12 — Escaparate: vitrina de productos + riel magenta. */
export function Variant12({ view }: { view: SaleFormView }) {
  const nav = useStep(4, 0);
  const labels = ['Vitrina', 'Cliente', 'Entrega', 'Pago'] as const;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_20rem]">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {view.lines.map((line) => (
            <article key={line.id} className="min-w-44 flex-1 rounded-3xl bg-fuchsia-50 p-4">
              <p className="text-sm font-semibold">{line.name}</p>
              <p className="mt-1 font-mono text-[11px] text-fuchsia-700">{line.sku}</p>
              <p className="mt-4 text-2xl font-bold tabular-nums text-fuchsia-700">{formatMoney(line.unitPrice * line.quantity)}</p>
            </article>
          ))}
          <button
            type="button"
            onClick={() => view.setPickerOpen(true)}
            className="min-h-32 min-w-36 cursor-pointer rounded-3xl border-2 border-dashed border-fuchsia-300 text-sm font-medium text-fuchsia-700"
          >
            + Producto
          </button>
        </div>
        {nav.step > 0 && (
          <div className="rounded-3xl bg-white p-4 ring-1 ring-fuchsia-100">
            {nav.step === 1 && <ClienteBody view={view} />}
            {nav.step === 2 && <EntregaBody view={view} />}
            {nav.step === 3 && <PagoBody view={view} />}
          </div>
        )}
      </div>
      <aside className="rounded-[2rem] bg-fuchsia-600 p-5 text-fuchsia-50">
        <Volver view={view} className="text-fuchsia-100" />
        <p className="mt-6 text-4xl font-semibold tabular-nums">{formatMoney(view.total)}</p>
        <Peek view={view} />
        <nav className="mt-6 space-y-2">
          {labels.map((label, index) => (
            <button
              key={label}
              type="button"
              onClick={() => nav.setStep(index)}
              className={cn(
                'block w-full cursor-pointer rounded-2xl px-3 py-2 text-left text-sm font-medium',
                index === nav.step ? 'bg-white text-fuchsia-700' : 'bg-fuchsia-500/60',
              )}
            >
              {label}
            </button>
          ))}
        </nav>
        <Cta view={view} isLast={nav.isLast} onNext={nav.next} className="mt-6 w-full rounded-2xl bg-white text-fuchsia-700 hover:bg-fuchsia-50" />
      </aside>
    </div>
  );
}
