/* PROTOTYPE — Cinco steppers de nueva venta, DESIGN.md, tres grises, `?variant=1`…`5`. */
import { useState } from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Button } from '../../components/ui/button';
import { GrayBar, SaleSteps, formatMoney } from './widgets';
import {
  Back,
  ClienteBody,
  EntregaBody,
  OrigenBody,
  PagoBody,
  ProductosBody,
  SaleToolbar,
  VentaBody,
} from './bodies';
import type { SaleFormView } from './view';

const FIVE = ['Origen', 'Cliente', 'Productos', 'Entrega', 'Pago'] as const;
const THREE = ['Venta', 'Entrega', 'Pago'] as const;
const FOUR = ['Cliente', 'Entrega', 'Pago', 'Confirmar'] as const;

function useStep(count: number, start = 1) {
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

function grayText(index: number, current: number) {
  if (index < current) return 'text-muted-foreground';
  if (index === current) return 'font-medium text-foreground';
  return 'text-muted-foreground/40';
}

/** 1 — Cinco pasos en toolbar. */
export function Variant1({ view }: { view: SaleFormView }) {
  const nav = useStep(5);
  return (
    <div className="space-y-4 pb-8">
      <SaleToolbar view={view} labels={FIVE} step={nav.step} onStep={nav.setStep} onNext={nav.next} isLast={nav.isLast} />
      <FiveBody view={view} step={nav.step} />
    </div>
  );
}

/** 2 — Tres tiempos. */
export function Variant2({ view }: { view: SaleFormView }) {
  const nav = useStep(3, 0);
  return (
    <div className="space-y-4 pb-8">
      <SaleToolbar view={view} labels={THREE} step={nav.step} onStep={nav.setStep} onNext={nav.next} isLast={nav.isLast} />
      {nav.step === 0 && <VentaBody view={view} />}
      {nav.step === 1 && <EntregaBody view={view} />}
      {nav.step === 2 && <PagoBody view={view} />}
    </div>
  );
}

/** 3 — Riel izquierdo. */
export function Variant3({ view }: { view: SaleFormView }) {
  const nav = useStep(5);
  return (
    <div className="grid gap-8 pb-8 lg:grid-cols-[11rem_minmax(0,1fr)]">
      <aside className="space-y-3">
        <Back view={view} />
        <SaleSteps
          value={String(nav.step)}
          options={FIVE.map((label, index) => ({ value: String(index), label }))}
          onChange={(value) => nav.setStep(Number(value))}
          orientation="vertical"
        />
        <GrayBar step={nav.step} total={5} />
      </aside>
      <div className="min-w-0 space-y-4">
        <FiveBody view={view} step={nav.step} />
        <div className="flex justify-end">
          {nav.isLast ? (
            <Button type="submit" disabled={view.submitDisabled}>Registrar venta</Button>
          ) : (
            <Button type="button" onClick={nav.next}>Siguiente</Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** 4 — Lista: el actual abre, los grises marcan el resto. */
export function Variant4({ view }: { view: SaleFormView }) {
  const nav = useStep(5);
  return (
    <div className="space-y-4 pb-8">
      <div className="flex flex-wrap items-center gap-3">
        <Back view={view} />
        <GrayBar step={nav.step} total={5} />
        <div className="ml-auto flex items-center gap-2">
          <p className="text-sm font-medium tabular-nums">{formatMoney(view.total)}</p>
          {nav.isLast ? (
            <Button type="submit" disabled={view.submitDisabled}>Registrar venta</Button>
          ) : (
            <Button type="button" onClick={nav.next}>Siguiente</Button>
          )}
        </div>
      </div>
      <ul>
        {FIVE.map((label, index) => (
          <li key={label} className={cn(index > 0 && 'border-t border-border')}>
            <button
              type="button"
              onClick={() => nav.setStep(index)}
              className="flex w-full cursor-pointer items-center gap-3 py-2.5 text-left text-sm"
            >
              {index < nav.step
                ? <Check className="size-3.5 text-muted-foreground" />
                : <span className={cn('w-3.5 text-center text-[11px] tabular-nums', grayText(index, nav.step))}>{index + 1}</span>}
              <span className={grayText(index, nav.step)}>{label}</span>
            </button>
            {index === nav.step && <div className="pb-4 pl-7"><FiveBody view={view} step={nav.step} /></div>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 5 — Productos fijos; el stepper es el resto. */
export function Variant5({ view }: { view: SaleFormView }) {
  const nav = useStep(4, 0);
  return (
    <div className="space-y-4 pb-8">
      <SaleToolbar
        view={view}
        labels={FOUR}
        step={nav.step}
        onStep={nav.setStep}
        onNext={nav.next}
        isLast={nav.isLast}
        nextLabel={nav.step === 2 ? 'Confirmar' : 'Siguiente'}
      />
      <ProductosBody view={view} />
      {nav.step === 0 && <ClienteBody view={view} />}
      {nav.step === 1 && <EntregaBody view={view} />}
      {nav.step === 2 && <PagoBody view={view} />}
      {nav.step === 3 && (
        <p className="text-sm text-muted-foreground">
          {view.customerName || 'Sin cliente'} · {view.delivery === 'envio' ? 'Envío' : 'Recojo'} · {formatMoney(view.total)}
        </p>
      )}
    </div>
  );
}
