import { useState } from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Button } from '../../components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TablePanel,
  TableRow,
} from '../../components/ui/table';
import { Segmented, formatMoney } from './widgets';
import {
  Back,
  ClienteBody,
  EntregaBody,
  OrigenBody,
  PagoBody,
  ProductosBody,
  StepFooter,
  VentaBody,
} from './bodies';
import type { SaleFormView } from './view';

const FIVE = ['Origen', 'Cliente', 'Productos', 'Entrega', 'Pago'] as const;
const THREE = ['Venta', 'Entrega', 'Pago'] as const;
const TWO = ['Pedido', 'Despacho'] as const;
const FOUR = ['Cliente', 'Productos', 'Entrega', 'Pago'] as const;

function useStep(count: number, start = 1) {
  const [step, setStep] = useState(Math.min(start, count - 1));
  return {
    step,
    setStep,
    isFirst: step === 0,
    isLast: step === count - 1,
    next: () => setStep((value) => Math.min(count - 1, value + 1)),
    back: () => setStep((value) => Math.max(0, value - 1)),
  };
}

function FiveBody({ view, step }: { view: SaleFormView; step: number }) {
  if (step === 0) return <OrigenBody view={view} />;
  if (step === 1) return <ClienteBody view={view} />;
  if (step === 2) return <ProductosBody view={view} />;
  if (step === 3) return <EntregaBody view={view} />;
  return <PagoBody view={view} />;
}

function Recap({ view }: { view: SaleFormView }) {
  return (
    <div className="space-y-1 text-sm text-muted-foreground">
      <p className="text-foreground">{view.customerName || 'Sin cliente'}</p>
      <p>{view.lines.length} producto{view.lines.length === 1 ? '' : 's'} · {formatMoney(view.totals.products)}</p>
      <p>{view.delivery === 'envio' ? 'Envío' : 'Recojo'} · {view.paymentMethod === 'despues' ? 'Paga después' : 'Pago ahora'}</p>
    </div>
  );
}

/** 1 — Cinco círculos unidos por una línea. */
export function Variant1({ view }: { view: SaleFormView }) {
  const nav = useStep(5);
  return (
    <div className="mx-auto max-w-xl space-y-6 pb-8">
      <Back view={view} />
      <ol className="flex items-start justify-between gap-1">
        {FIVE.map((label, index) => (
          <li key={label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <button
              type="button"
              onClick={() => nav.setStep(index)}
              className={cn(
                'grid size-8 cursor-pointer place-items-center rounded-full text-xs font-medium',
                index <= nav.step ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground',
              )}
            >
              {index < nav.step ? <Check className="size-3.5" /> : index + 1}
            </button>
            <span className={cn('truncate text-[11px]', index === nav.step ? 'text-foreground' : 'text-muted-foreground')}>{label}</span>
          </li>
        ))}
      </ol>
      <h2 className="text-base font-medium">{FIVE[nav.step]}</h2>
      <FiveBody view={view} step={nav.step} />
      <StepFooter view={view} {...nav} onBack={nav.back} onNext={nav.next} />
    </div>
  );
}

/** 2 — Tres tiempos. */
export function Variant2({ view }: { view: SaleFormView }) {
  const nav = useStep(3, 0);
  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-8">
      <Back view={view} />
      <div className="flex gap-2">
        {THREE.map((label, index) => (
          <button
            key={label}
            type="button"
            onClick={() => nav.setStep(index)}
            className={cn(
              'h-9 flex-1 cursor-pointer rounded-md text-sm font-medium',
              index === nav.step ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground',
            )}
          >
            {index + 1}. {label}
          </button>
        ))}
      </div>
      {nav.step === 0 && <VentaBody view={view} />}
      {nav.step === 1 && <EntregaBody view={view} />}
      {nav.step === 2 && <PagoBody view={view} />}
      <StepFooter view={view} {...nav} onBack={nav.back} onNext={nav.next} />
    </div>
  );
}

/** 3 — Dos tiempos. */
export function Variant3({ view }: { view: SaleFormView }) {
  const nav = useStep(2, 0);
  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-8">
      <Back view={view} />
      <p className="text-sm text-muted-foreground">{nav.step === 0 ? '1 · Pedido' : '2 · Despacho y cobro'}</p>
      {nav.step === 0 && <VentaBody view={view} />}
      {nav.step === 1 && (
        <div className="grid gap-8 sm:grid-cols-2">
          <EntregaBody view={view} />
          <PagoBody view={view} />
        </div>
      )}
      <StepFooter view={view} {...nav} onBack={nav.back} onNext={nav.next} nextLabel="Despacho" />
    </div>
  );
}

/** 4 — Riel vertical a la izquierda. */
export function Variant4({ view }: { view: SaleFormView }) {
  const nav = useStep(5);
  return (
    <div className="grid gap-8 pb-8 lg:grid-cols-[11rem_minmax(0,1fr)]">
      <aside className="space-y-1">
        <Back view={view} />
        {FIVE.map((label, index) => (
          <button
            key={label}
            type="button"
            onClick={() => nav.setStep(index)}
            className={cn(
              'flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
              index === nav.step ? 'bg-muted font-medium' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <span className="tabular-nums text-xs">{index + 1}</span>
            {label}
          </button>
        ))}
      </aside>
      <div className="min-w-0 space-y-4">
        <h2 className="text-base font-medium">{FIVE[nav.step]}</h2>
        <FiveBody view={view} step={nav.step} />
        <StepFooter view={view} {...nav} onBack={nav.back} onNext={nav.next} />
      </div>
    </div>
  );
}

/** 5 — Solo barra de progreso. */
export function Variant5({ view }: { view: SaleFormView }) {
  const nav = useStep(5);
  return (
    <div className="mx-auto max-w-xl space-y-6 pb-8">
      <Back view={view} />
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-foreground" style={{ width: `${((nav.step + 1) / 5) * 100}%` }} />
      </div>
      <p className="text-sm text-muted-foreground">Paso {nav.step + 1} de 5 · {FIVE[nav.step]}</p>
      <FiveBody view={view} step={nav.step} />
      <StepFooter view={view} {...nav} onBack={nav.back} onNext={nav.next} />
    </div>
  );
}

/** 6 — Steps como segmented h-9. */
export function Variant6({ view }: { view: SaleFormView }) {
  const nav = useStep(5);
  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-8">
      <Back view={view} />
      <Segmented
        value={String(nav.step)}
        options={FIVE.map((label, index) => ({ value: String(index), label }))}
        onChange={(value) => nav.setStep(Number(value))}
        ariaLabel="Paso"
      />
      <FiveBody view={view} step={nav.step} />
      <StepFooter view={view} {...nav} onBack={nav.back} onNext={nav.next} />
    </div>
  );
}

/** 7 — Productos fijos; el stepper es el resto. */
export function Variant7({ view }: { view: SaleFormView }) {
  const rest = ['Origen', 'Cliente', 'Entrega', 'Pago'] as const;
  const nav = useStep(4, 1);
  return (
    <div className="space-y-6 pb-8">
      <Back view={view} />
      <ProductosBody view={view} />
      <div className="flex gap-2 text-sm">
        {rest.map((label, index) => (
          <button
            key={label}
            type="button"
            onClick={() => nav.setStep(index)}
            className={cn('cursor-pointer', index === nav.step ? 'font-medium' : 'text-muted-foreground')}
          >
            {label}
          </button>
        ))}
      </div>
      {nav.step === 0 && <OrigenBody view={view} />}
      {nav.step === 1 && <ClienteBody view={view} />}
      {nav.step === 2 && <EntregaBody view={view} />}
      {nav.step === 3 && <PagoBody view={view} />}
      <StepFooter view={view} {...nav} onBack={nav.back} onNext={nav.next} />
    </div>
  );
}

/** 8 — POS: productos a la izquierda, pasos a la derecha. */
export function Variant8({ view }: { view: SaleFormView }) {
  const nav = useStep(4, 0);
  const labels = ['Cliente', 'Origen', 'Entrega', 'Pago'] as const;
  return (
    <div className="grid gap-8 pb-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-3">
        <Back view={view} />
        <ProductosBody view={view} />
      </div>
      <aside className="space-y-4">
        <p className="text-sm text-muted-foreground">{nav.step + 1} / 4 · {labels[nav.step]}</p>
        {nav.step === 0 && <ClienteBody view={view} />}
        {nav.step === 1 && <OrigenBody view={view} />}
        {nav.step === 2 && <EntregaBody view={view} />}
        {nav.step === 3 && <PagoBody view={view} />}
        <StepFooter view={view} {...nav} onBack={nav.back} onNext={nav.next} />
      </aside>
    </div>
  );
}

/** 9 — Una pregunta grande por pantalla. */
export function Variant9({ view }: { view: SaleFormView }) {
  const questions = ['¿De dónde sale?', '¿Quién compra?', '¿Qué lleva?', '¿Cómo se entrega?', '¿Cómo paga?'] as const;
  const nav = useStep(5, 1);
  return (
    <div className="mx-auto max-w-lg space-y-8 pb-8 pt-6">
      <Back view={view} />
      <h2 className="text-2xl font-medium tracking-tight">{questions[nav.step]}</h2>
      <FiveBody view={view} step={nav.step} />
      <StepFooter view={view} {...nav} onBack={nav.back} onNext={nav.next} />
    </div>
  );
}

/** 10 — Paso actual + recap sticky. */
export function Variant10({ view }: { view: SaleFormView }) {
  const nav = useStep(5);
  return (
    <div className="grid gap-8 pb-8 lg:grid-cols-[minmax(0,1fr)_14rem]">
      <div className="min-w-0 space-y-4">
        <Back view={view} />
        <p className="text-sm text-muted-foreground">{nav.step + 1} / 5 · {FIVE[nav.step]}</p>
        <FiveBody view={view} step={nav.step} />
        <StepFooter view={view} {...nav} onBack={nav.back} onNext={nav.next} />
      </div>
      <aside className="lg:sticky lg:top-4 lg:self-start">
        <Recap view={view} />
        <p className="mt-3 text-2xl font-semibold tabular-nums">{formatMoney(view.total)}</p>
      </aside>
    </div>
  );
}

/** 11 — Checklist; el actual abre el formulario. */
export function Variant11({ view }: { view: SaleFormView }) {
  const nav = useStep(5);
  return (
    <div className="mx-auto max-w-xl space-y-4 pb-8">
      <Back view={view} />
      <ul className="divide-y divide-border">
        {FIVE.map((label, index) => (
          <li key={label}>
            <button
              type="button"
              onClick={() => nav.setStep(index)}
              className="flex w-full cursor-pointer items-center gap-3 py-2.5 text-left text-sm"
            >
              <span className={cn('grid size-5 place-items-center rounded-full border text-[10px]', index < nav.step && 'border-foreground bg-foreground text-background', index === nav.step && 'border-foreground')}>
                {index < nav.step ? <Check className="size-3" /> : index + 1}
              </span>
              <span className={index === nav.step ? 'font-medium' : 'text-muted-foreground'}>{label}</span>
            </button>
            {index === nav.step && <div className="pb-4 pl-8"><FiveBody view={view} step={nav.step} /></div>}
          </li>
        ))}
      </ul>
      <StepFooter view={view} {...nav} onBack={nav.back} onNext={nav.next} />
    </div>
  );
}

/** 12 — Timeline vertical. */
export function Variant12({ view }: { view: SaleFormView }) {
  const nav = useStep(5);
  return (
    <div className="mx-auto max-w-xl space-y-2 pb-8">
      <Back view={view} />
      {FIVE.map((label, index) => (
        <div key={label} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-3">
          <div className="flex flex-col items-center">
            <span className={cn('size-2.5 rounded-full', index <= nav.step ? 'bg-foreground' : 'bg-muted-foreground/30')} />
            {index < 4 && <span className="w-px flex-1 bg-border" />}
          </div>
          <div className="pb-6">
            <button type="button" className="cursor-pointer text-sm font-medium" onClick={() => nav.setStep(index)}>{label}</button>
            {index === nav.step && <div className="mt-3"><FiveBody view={view} step={nav.step} /></div>}
          </div>
        </div>
      ))}
      <StepFooter view={view} {...nav} onBack={nav.back} onNext={nav.next} />
    </div>
  );
}

/** 13 — Dots y acciones pegados abajo. */
export function Variant13({ view }: { view: SaleFormView }) {
  const nav = useStep(5);
  return (
    <div className="mx-auto max-w-xl pb-28">
      <Back view={view} />
      <div className="mt-6 space-y-4">
        <h2 className="text-base font-medium">{FIVE[nav.step]}</h2>
        <FiveBody view={view} step={nav.step} />
      </div>
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background px-4 py-3 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:pb-3">
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <div className="flex gap-1">
            {FIVE.map((label, index) => (
              <button
                key={label}
                type="button"
                aria-label={label}
                onClick={() => nav.setStep(index)}
                className={cn('size-2 cursor-pointer rounded-full', index === nav.step ? 'bg-foreground' : 'bg-muted-foreground/30')}
              />
            ))}
          </div>
          <p className="ml-auto text-lg font-semibold tabular-nums">{formatMoney(view.total)}</p>
          <Button type="button" variant="ghost" disabled={nav.isFirst} onClick={nav.back}>Atrás</Button>
          {nav.isLast ? (
            <Button type="submit" disabled={view.submitDisabled}>Registrar</Button>
          ) : (
            <Button type="button" onClick={nav.next}>Siguiente</Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** 14 — Ticket estrecho. */
export function Variant14({ view }: { view: SaleFormView }) {
  const nav = useStep(5);
  return (
    <div className="mx-auto max-w-md space-y-5 pb-8">
      <Back view={view} />
      <p className="text-center text-xs tabular-nums text-muted-foreground">{nav.step + 1} / 5</p>
      <h2 className="text-center text-base font-medium">{FIVE[nav.step]}</h2>
      <FiveBody view={view} step={nav.step} />
      <StepFooter view={view} {...nav} onBack={nav.back} onNext={nav.next} />
    </div>
  );
}

/** 15 — El primer paso es la tabla de productos. */
export function Variant15({ view }: { view: SaleFormView }) {
  const labels = ['Productos', 'Cliente', 'Entrega', 'Pago'] as const;
  const nav = useStep(4, 0);
  return (
    <div className="space-y-4 pb-8">
      <div className="flex items-center gap-3">
        <Back view={view} />
        <p className="text-sm text-muted-foreground">{nav.step + 1} / 4 · {labels[nav.step]}</p>
      </div>
      {nav.step === 0 && (
        <>
          <TablePanel>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell>{line.name}<div className="font-mono text-[11px] text-muted-foreground">{line.sku}</div></TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(line.unitPrice * line.quantity)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TablePanel>
          <Button type="button" variant="outline" size="sm" onClick={() => view.setPickerOpen(true)}>Agregar producto</Button>
        </>
      )}
      {nav.step === 1 && <ClienteBody view={view} />}
      {nav.step === 2 && <EntregaBody view={view} />}
      {nav.step === 3 && <PagoBody view={view} />}
      <StepFooter view={view} {...nav} onBack={nav.back} onNext={nav.next} />
    </div>
  );
}

/** 16 — Origen siempre arriba; cuatro pasos debajo. */
export function Variant16({ view }: { view: SaleFormView }) {
  const nav = useStep(4, 0);
  return (
    <div className="mx-auto max-w-xl space-y-5 pb-8">
      <Back view={view} />
      <OrigenBody view={view} />
      <p className="text-sm text-muted-foreground">{nav.step + 1} / 4 · {FOUR[nav.step]}</p>
      {nav.step === 0 && <ClienteBody view={view} />}
      {nav.step === 1 && <ProductosBody view={view} />}
      {nav.step === 2 && <EntregaBody view={view} />}
      {nav.step === 3 && <PagoBody view={view} />}
      <StepFooter view={view} {...nav} onBack={nav.back} onNext={nav.next} />
    </div>
  );
}

/** 17 — El último paso es confirmación. */
export function Variant17({ view }: { view: SaleFormView }) {
  const labels = ['Cliente', 'Productos', 'Entrega', 'Confirmar'] as const;
  const nav = useStep(4, 3);
  return (
    <div className="mx-auto max-w-xl space-y-5 pb-8">
      <Back view={view} />
      <p className="text-sm text-muted-foreground">{nav.step + 1} / 4 · {labels[nav.step]}</p>
      {nav.step === 0 && <ClienteBody view={view} />}
      {nav.step === 1 && <ProductosBody view={view} />}
      {nav.step === 2 && <EntregaBody view={view} />}
      {nav.step === 3 && (
        <div className="space-y-4">
          <Recap view={view} />
          <PagoBody view={view} />
        </div>
      )}
      <StepFooter view={view} {...nav} onBack={nav.back} onNext={nav.next} nextLabel={nav.step === 2 ? 'Confirmar' : 'Siguiente'} />
    </div>
  );
}

/** 18 — Entrega y pago se pueden saltar. */
export function Variant18({ view }: { view: SaleFormView }) {
  const nav = useStep(5, 3);
  const skippable = nav.step === 3 || nav.step === 4;
  return (
    <div className="mx-auto max-w-xl space-y-5 pb-8">
      <Back view={view} />
      <p className="text-sm text-muted-foreground">{FIVE[nav.step]}{skippable ? ' · opcional' : ''}</p>
      <FiveBody view={view} step={nav.step} />
      <StepFooter
        view={view}
        {...nav}
        onBack={nav.back}
        onNext={nav.next}
        skip={skippable && !nav.isLast ? { label: 'Saltar', onClick: nav.next } : undefined}
      />
    </div>
  );
}

/** 19 — Muestra el nombre del paso siguiente. */
export function Variant19({ view }: { view: SaleFormView }) {
  const nav = useStep(5);
  const upcoming = FIVE[nav.step + 1];
  return (
    <div className="mx-auto max-w-xl space-y-5 pb-8">
      <Back view={view} />
      <h2 className="text-base font-medium">{FIVE[nav.step]}</h2>
      <FiveBody view={view} step={nav.step} />
      {upcoming ? <p className="text-xs text-muted-foreground">Siguiente: {upcoming}</p> : null}
      <StepFooter view={view} {...nav} onBack={nav.back} onNext={nav.next} />
    </div>
  );
}

/** 20 — Círculos clickeables con estado hecho / actual / pendiente. */
export function Variant20({ view }: { view: SaleFormView }) {
  const nav = useStep(5);
  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-8">
      <Back view={view} />
      <ol className="flex items-center gap-0">
        {FIVE.map((label, index) => (
          <li key={label} className="flex min-w-0 flex-1 items-center">
            <button
              type="button"
              onClick={() => nav.setStep(index)}
              className="flex min-w-0 cursor-pointer items-center gap-2"
            >
              <span className={cn(
                'grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-medium',
                index < nav.step && 'bg-foreground text-background',
                index === nav.step && 'border border-foreground',
                index > nav.step && 'bg-muted text-muted-foreground',
              )}>
                {index < nav.step ? <Check className="size-3.5" /> : index + 1}
              </span>
              <span className="hidden truncate text-xs sm:inline">{label}</span>
            </button>
            {index < 4 && <span className="mx-2 h-px flex-1 bg-border" />}
          </li>
        ))}
      </ol>
      <FiveBody view={view} step={nav.step} />
      <StepFooter view={view} {...nav} onBack={nav.back} onNext={nav.next} />
    </div>
  );
}
