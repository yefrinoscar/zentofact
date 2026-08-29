import { useState, type ReactNode } from 'react';
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

function stepStatus(index: number, current: number): 'done' | 'current' | 'todo' {
  if (index < current) return 'done';
  if (index === current) return 'current';
  return 'todo';
}

function StepMark({
  status,
  children,
}: {
  status: 'done' | 'current' | 'todo';
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'grid size-6 shrink-0 place-items-center rounded-md text-[11px] font-medium',
        status === 'current' && 'bg-background text-foreground shadow-sm',
        status === 'done' && 'bg-muted text-muted-foreground',
        status === 'todo' && 'text-muted-foreground/60',
      )}
    >
      {status === 'done' ? <Check className="size-3.5" /> : children}
    </span>
  );
}

function StepTrack({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('inline-flex min-h-9 flex-wrap items-center gap-0.5 rounded-xl bg-muted p-1', className)}>
      {children}
    </div>
  );
}

function StepTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors',
        active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function StepProgress({ current, total }: { current: number; total: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-md bg-muted">
      <div className="h-full bg-muted-foreground/35" style={{ width: `${((current + 1) / total) * 100}%` }} />
    </div>
  );
}

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

/** 1 — Cinco pasos numerados en segmented. */
export function Variant1({ view }: { view: SaleFormView }) {
  const nav = useStep(5);
  return (
    <div className="mx-auto max-w-xl space-y-6 pb-8">
      <Back view={view} />
      <StepTrack>
        {FIVE.map((label, index) => (
          <StepTab key={label} active={index === nav.step} onClick={() => nav.setStep(index)}>
            <span className="tabular-nums text-[11px]">{index + 1}</span>
            <span className="hidden sm:inline">{label}</span>
          </StepTab>
        ))}
      </StepTrack>
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
      <StepTrack className="w-full">
        {THREE.map((label, index) => (
          <StepTab key={label} active={index === nav.step} onClick={() => nav.setStep(index)}>
            {label}
          </StepTab>
        ))}
      </StepTrack>
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
      <StepTrack>
        {TWO.map((label, index) => (
          <StepTab key={label} active={index === nav.step} onClick={() => nav.setStep(index)}>
            {label}
          </StepTab>
        ))}
      </StepTrack>
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
        <div className="flex flex-col gap-0.5 rounded-xl bg-muted p-1">
          {FIVE.map((label, index) => (
            <button
              key={label}
              type="button"
              onClick={() => nav.setStep(index)}
              className={cn(
                'flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm',
                index === nav.step ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="tabular-nums text-xs">{index + 1}</span>
              {label}
            </button>
          ))}
        </div>
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
      <StepProgress current={nav.step} total={5} />
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
      <StepTrack>
        {rest.map((label, index) => (
          <StepTab key={label} active={index === nav.step} onClick={() => nav.setStep(index)}>
            {label}
          </StepTab>
        ))}
      </StepTrack>
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
        <StepTrack>
          {labels.map((label, index) => (
            <StepTab key={label} active={index === nav.step} onClick={() => nav.setStep(index)}>
              {label}
            </StepTab>
          ))}
        </StepTrack>
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
      <StepTrack>
        {questions.map((label, index) => (
          <StepTab key={label} active={index === nav.step} onClick={() => nav.setStep(index)}>
            {index + 1}
          </StepTab>
        ))}
      </StepTrack>
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
        <StepTrack>
          {FIVE.map((label, index) => (
            <StepTab key={label} active={index === nav.step} onClick={() => nav.setStep(index)}>
              {label}
            </StepTab>
          ))}
        </StepTrack>
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
              <StepMark status={stepStatus(index, nav.step)}>{index + 1}</StepMark>
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
        <div key={label} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-3">
          <div className="flex flex-col items-center">
            <StepMark status={stepStatus(index, nav.step)}>{index + 1}</StepMark>
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
          <StepTrack>
            {FIVE.map((label, index) => (
              <StepTab key={label} active={index === nav.step} onClick={() => nav.setStep(index)}>
                {index + 1}
              </StepTab>
            ))}
          </StepTrack>
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
      <div className="flex justify-center">
        <StepTrack>
          {FIVE.map((label, index) => (
            <StepTab key={label} active={index === nav.step} onClick={() => nav.setStep(index)}>
              {index + 1}
            </StepTab>
          ))}
        </StepTrack>
      </div>
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
        <StepTrack>
          {labels.map((label, index) => (
            <StepTab key={label} active={index === nav.step} onClick={() => nav.setStep(index)}>
              {label}
            </StepTab>
          ))}
        </StepTrack>
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
      <StepTrack>
        {FOUR.map((label, index) => (
          <StepTab key={label} active={index === nav.step} onClick={() => nav.setStep(index)}>
            {label}
          </StepTab>
        ))}
      </StepTrack>
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
      <StepTrack>
        {labels.map((label, index) => (
          <StepTab key={label} active={index === nav.step} onClick={() => nav.setStep(index)}>
            {label}
          </StepTab>
        ))}
      </StepTrack>
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
      <StepTrack>
        {FIVE.map((label, index) => (
          <StepTab key={label} active={index === nav.step} onClick={() => nav.setStep(index)}>
            {label}
          </StepTab>
        ))}
      </StepTrack>
      {skippable ? <p className="text-xs text-muted-foreground">Opcional</p> : null}
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
      <StepTrack>
        {FIVE.map((label, index) => (
          <StepTab key={label} active={index === nav.step} onClick={() => nav.setStep(index)}>
            {label}
          </StepTab>
        ))}
      </StepTrack>
      <FiveBody view={view} step={nav.step} />
      {upcoming ? <p className="text-xs text-muted-foreground">Siguiente: {upcoming}</p> : null}
      <StepFooter view={view} {...nav} onBack={nav.back} onNext={nav.next} />
    </div>
  );
}

/** 20 — Segmented con check en los pasos hechos. */
export function Variant20({ view }: { view: SaleFormView }) {
  const nav = useStep(5);
  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-8">
      <Back view={view} />
      <StepTrack>
        {FIVE.map((label, index) => (
          <StepTab key={label} active={index === nav.step} onClick={() => nav.setStep(index)}>
            {index < nav.step ? <Check className="size-3.5" /> : <span className="tabular-nums text-[11px]">{index + 1}</span>}
            <span className="hidden sm:inline">{label}</span>
          </StepTab>
        ))}
      </StepTrack>
      <FiveBody view={view} step={nav.step} />
      <StepFooter view={view} {...nav} onBack={nav.back} onNext={nav.next} />
    </div>
  );
}
