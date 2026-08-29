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
import { SaleSteps, formatMoney } from './widgets';
import {
  Back,
  ClienteBody,
  EntregaBody,
  OrigenBody,
  PagoBody,
  ProductosBody,
  SaleToolbar,
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

function Shell({
  view,
  labels,
  nav,
  nextLabel,
  children,
}: {
  view: SaleFormView;
  labels: readonly string[];
  nav: ReturnType<typeof useStep>;
  nextLabel?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-4 pb-8">
      <SaleToolbar
        view={view}
        labels={labels}
        step={nav.step}
        onStep={nav.setStep}
        onNext={nav.next}
        isLast={nav.isLast}
        nextLabel={nextLabel}
      />
      {children}
    </div>
  );
}

/** 1 — Cinco tabs de Productos. */
export function Variant1({ view }: { view: SaleFormView }) {
  const nav = useStep(5);
  return (
    <Shell view={view} labels={FIVE} nav={nav}>
      <FiveBody view={view} step={nav.step} />
    </Shell>
  );
}

/** 2 — Tres tiempos. */
export function Variant2({ view }: { view: SaleFormView }) {
  const nav = useStep(3, 0);
  return (
    <Shell view={view} labels={THREE} nav={nav}>
      {nav.step === 0 && <VentaBody view={view} />}
      {nav.step === 1 && <EntregaBody view={view} />}
      {nav.step === 2 && <PagoBody view={view} />}
    </Shell>
  );
}

/** 3 — Dos tiempos. */
export function Variant3({ view }: { view: SaleFormView }) {
  const nav = useStep(2, 0);
  return (
    <Shell view={view} labels={TWO} nav={nav} nextLabel="Despacho">
      {nav.step === 0 && <VentaBody view={view} />}
      {nav.step === 1 && (
        <div className="grid gap-8 sm:grid-cols-2">
          <EntregaBody view={view} />
          <PagoBody view={view} />
        </div>
      )}
    </Shell>
  );
}

/** 4 — Riel vertical a la izquierda. */
export function Variant4({ view }: { view: SaleFormView }) {
  const nav = useStep(5);
  return (
    <div className="grid gap-8 pb-8 lg:grid-cols-[12rem_minmax(0,1fr)]">
      <aside className="space-y-3">
        <Back view={view} />
        <SaleSteps
          value={String(nav.step)}
          options={FIVE.map((label, index) => ({ value: String(index), label }))}
          onChange={(value) => nav.setStep(Number(value))}
          orientation="vertical"
        />
      </aside>
      <div className="min-w-0 space-y-4">
        <FiveBody view={view} step={nav.step} />
        <StepFooter view={view} {...nav} onBack={nav.back} onNext={nav.next} />
      </div>
    </div>
  );
}

/** 5 — Barra de progreso suave. */
export function Variant5({ view }: { view: SaleFormView }) {
  const nav = useStep(5);
  return (
    <div className="space-y-4 pb-8">
      <div className="flex flex-wrap items-center gap-3">
        <Back view={view} />
        <p className="text-sm text-muted-foreground">{FIVE[nav.step]}</p>
        <div className="ml-auto flex items-center gap-2">
          <p className="text-sm font-medium tabular-nums">{formatMoney(view.total)}</p>
          {nav.isLast ? (
            <Button type="submit" className="rounded-full" disabled={view.submitDisabled}>Registrar venta</Button>
          ) : (
            <Button type="button" className="rounded-full" onClick={nav.next}>Siguiente</Button>
          )}
        </div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted/70">
        <div className="h-full bg-foreground/25" style={{ width: `${((nav.step + 1) / 5) * 100}%` }} />
      </div>
      <FiveBody view={view} step={nav.step} />
    </div>
  );
}

/** 6 — Tabs + cuerpo, sin toolbar extra. */
export function Variant6({ view }: { view: SaleFormView }) {
  const nav = useStep(5);
  return (
    <div className="space-y-4 pb-8">
      <Back view={view} />
      <SaleSteps
        value={String(nav.step)}
        options={FIVE.map((label, index) => ({ value: String(index), label }))}
        onChange={(value) => nav.setStep(Number(value))}
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
    <div className="space-y-4 pb-8">
      <SaleToolbar view={view} labels={rest} step={nav.step} onStep={nav.setStep} onNext={nav.next} isLast={nav.isLast} />
      <ProductosBody view={view} />
      {nav.step === 0 && <OrigenBody view={view} />}
      {nav.step === 1 && <ClienteBody view={view} />}
      {nav.step === 2 && <EntregaBody view={view} />}
      {nav.step === 3 && <PagoBody view={view} />}
    </div>
  );
}

/** 8 — POS: productos a la izquierda, pasos a la derecha. */
export function Variant8({ view }: { view: SaleFormView }) {
  const nav = useStep(4, 0);
  const labels = ['Cliente', 'Origen', 'Entrega', 'Pago'] as const;
  return (
    <div className="grid gap-8 pb-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-3">
        <Back view={view} />
        <ProductosBody view={view} />
      </div>
      <aside className="space-y-4">
        <SaleSteps
          value={String(nav.step)}
          options={labels.map((label, index) => ({ value: String(index), label }))}
          onChange={(value) => nav.setStep(Number(value))}
        />
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
    <div className="space-y-6 pb-8 pt-2">
      <SaleToolbar view={view} labels={[...FIVE]} step={nav.step} onStep={nav.setStep} onNext={nav.next} isLast={nav.isLast} />
      <h2 className="text-2xl font-medium tracking-tight">{questions[nav.step]}</h2>
      <FiveBody view={view} step={nav.step} />
    </div>
  );
}

/** 10 — Paso actual + recap sticky. */
export function Variant10({ view }: { view: SaleFormView }) {
  const nav = useStep(5);
  return (
    <div className="grid gap-8 pb-8 lg:grid-cols-[minmax(0,1fr)_14rem]">
      <Shell view={view} labels={FIVE} nav={nav}>
        <FiveBody view={view} step={nav.step} />
      </Shell>
      <aside className="lg:sticky lg:top-4 lg:self-start">
        <Recap view={view} />
      </aside>
    </div>
  );
}

/** 11 — Checklist; el actual abre el formulario. */
export function Variant11({ view }: { view: SaleFormView }) {
  const nav = useStep(5);
  return (
    <div className="space-y-4 pb-8">
      <div className="flex flex-wrap items-center gap-3">
        <Back view={view} />
        <div className="ml-auto flex items-center gap-2">
          <p className="text-sm font-medium tabular-nums">{formatMoney(view.total)}</p>
          {nav.isLast ? (
            <Button type="submit" className="rounded-full" disabled={view.submitDisabled}>Registrar venta</Button>
          ) : (
            <Button type="button" className="rounded-full" onClick={nav.next}>Siguiente</Button>
          )}
        </div>
      </div>
      <ul>
        {FIVE.map((label, index) => {
          const current = index === nav.step;
          return (
            <li key={label} className={cn(index > 0 && 'border-t border-border/70')}>
              <button
                type="button"
                onClick={() => nav.setStep(index)}
                className="flex w-full cursor-pointer items-center gap-3 py-2.5 text-left text-sm"
              >
                {index < nav.step
                  ? <Check className="size-4 text-muted-foreground" />
                  : <span className="w-4 text-center text-xs tabular-nums text-muted-foreground">{index + 1}</span>}
                <span className={current ? 'font-medium' : 'text-muted-foreground'}>{label}</span>
              </button>
              {current && <div className="pb-4 pl-7"><FiveBody view={view} step={nav.step} /></div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** 12 — Lista vertical con el actual abierto. */
export function Variant12({ view }: { view: SaleFormView }) {
  const nav = useStep(5);
  return (
    <div className="space-y-2 pb-8">
      <SaleToolbar view={view} labels={FIVE} step={nav.step} onStep={nav.setStep} onNext={nav.next} isLast={nav.isLast} />
      {FIVE.map((label, index) => (
        <div key={label} className="pb-4">
          <button
            type="button"
            className={cn('cursor-pointer text-sm', index === nav.step ? 'font-medium' : 'text-muted-foreground')}
            onClick={() => nav.setStep(index)}
          >
            {label}
          </button>
          {index === nav.step && <div className="mt-3"><FiveBody view={view} step={nav.step} /></div>}
        </div>
      ))}
    </div>
  );
}

/** 13 — Tabs y acciones pegados abajo. */
export function Variant13({ view }: { view: SaleFormView }) {
  const nav = useStep(5);
  return (
    <div className="pb-28">
      <Back view={view} />
      <div className="mt-6">
        <FiveBody view={view} step={nav.step} />
      </div>
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background px-4 py-3 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:pb-3">
        <div className="flex flex-wrap items-center gap-3">
          <SaleSteps
            value={String(nav.step)}
            options={FIVE.map((label, index) => ({ value: String(index), label }))}
            onChange={(value) => nav.setStep(Number(value))}
          />
          <p className="ml-auto text-sm font-medium tabular-nums">{formatMoney(view.total)}</p>
          {nav.isLast ? (
            <Button type="submit" className="rounded-full" disabled={view.submitDisabled}>Registrar</Button>
          ) : (
            <Button type="button" className="rounded-full" onClick={nav.next}>Siguiente</Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** 14 — Columna estrecha. */
export function Variant14({ view }: { view: SaleFormView }) {
  const nav = useStep(5);
  return (
    <div className="mx-auto max-w-md space-y-4 pb-8">
      <SaleToolbar view={view} labels={FIVE} step={nav.step} onStep={nav.setStep} onNext={nav.next} isLast={nav.isLast} />
      <FiveBody view={view} step={nav.step} />
    </div>
  );
}

/** 15 — El primer paso es la tabla de productos. */
export function Variant15({ view }: { view: SaleFormView }) {
  const labels = ['Productos', 'Cliente', 'Entrega', 'Pago'] as const;
  const nav = useStep(4, 0);
  return (
    <Shell view={view} labels={labels} nav={nav}>
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
          <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => view.setPickerOpen(true)}>Agregar producto</Button>
        </>
      )}
      {nav.step === 1 && <ClienteBody view={view} />}
      {nav.step === 2 && <EntregaBody view={view} />}
      {nav.step === 3 && <PagoBody view={view} />}
    </Shell>
  );
}

/** 16 — Origen siempre arriba; cuatro pasos debajo. */
export function Variant16({ view }: { view: SaleFormView }) {
  const nav = useStep(4, 0);
  return (
    <div className="space-y-4 pb-8">
      <SaleToolbar view={view} labels={FOUR} step={nav.step} onStep={nav.setStep} onNext={nav.next} isLast={nav.isLast} />
      <OrigenBody view={view} />
      {nav.step === 0 && <ClienteBody view={view} />}
      {nav.step === 1 && <ProductosBody view={view} />}
      {nav.step === 2 && <EntregaBody view={view} />}
      {nav.step === 3 && <PagoBody view={view} />}
    </div>
  );
}

/** 17 — El último paso es confirmación. */
export function Variant17({ view }: { view: SaleFormView }) {
  const labels = ['Cliente', 'Productos', 'Entrega', 'Confirmar'] as const;
  const nav = useStep(4, 3);
  return (
    <Shell view={view} labels={labels} nav={nav} nextLabel={nav.step === 2 ? 'Confirmar' : 'Siguiente'}>
      {nav.step === 0 && <ClienteBody view={view} />}
      {nav.step === 1 && <ProductosBody view={view} />}
      {nav.step === 2 && <EntregaBody view={view} />}
      {nav.step === 3 && (
        <div className="space-y-4">
          <Recap view={view} />
          <PagoBody view={view} />
        </div>
      )}
    </Shell>
  );
}

/** 18 — Entrega y pago se pueden saltar. */
export function Variant18({ view }: { view: SaleFormView }) {
  const nav = useStep(5, 3);
  const skippable = nav.step === 3 || nav.step === 4;
  return (
    <div className="space-y-4 pb-8">
      <SaleToolbar view={view} labels={FIVE} step={nav.step} onStep={nav.setStep} onNext={nav.next} isLast={nav.isLast} />
      {skippable ? <p className="text-xs text-muted-foreground">Opcional</p> : null}
      <FiveBody view={view} step={nav.step} />
      {skippable && !nav.isLast ? (
        <Button type="button" variant="ghost" className="rounded-full" onClick={nav.next}>Saltar</Button>
      ) : null}
    </div>
  );
}

/** 19 — Muestra el nombre del paso siguiente. */
export function Variant19({ view }: { view: SaleFormView }) {
  const nav = useStep(5);
  const upcoming = FIVE[nav.step + 1];
  return (
    <Shell view={view} labels={FIVE} nav={nav}>
      <FiveBody view={view} step={nav.step} />
      {upcoming ? <p className="text-xs text-muted-foreground">Siguiente: {upcoming}</p> : null}
    </Shell>
  );
}

/** 20 — Tabs con check en los pasos hechos. */
export function Variant20({ view }: { view: SaleFormView }) {
  const nav = useStep(5);
  return (
    <div className="space-y-4 pb-8">
      <div className="flex flex-wrap items-center gap-3">
        <Back view={view} />
        <SaleSteps
          value={String(nav.step)}
          options={FIVE.map((label, index) => ({
            value: String(index),
            label: index < nav.step ? `✓ ${label}` : label,
          }))}
          onChange={(value) => nav.setStep(Number(value))}
        />
        <div className="ml-auto flex items-center gap-2">
          <p className="text-sm font-medium tabular-nums">{formatMoney(view.total)}</p>
          {nav.isLast ? (
            <Button type="submit" className="rounded-full" disabled={view.submitDisabled}>Registrar venta</Button>
          ) : (
            <Button type="button" className="rounded-full" onClick={nav.next}>Siguiente</Button>
          )}
        </div>
      </div>
      <FiveBody view={view} step={nav.step} />
    </div>
  );
}
