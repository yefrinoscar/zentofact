import { ArrowLeft, Search, Trash2 } from 'lucide-react';
import { SALE_SOURCES, type SaleLine } from '../../lib/registrar-venta';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Choice, FieldRow, NUMBER_INPUT, ProductPhoto, SaleSteps, formatMoney } from './widgets';
import { ComprobanteChoice, DocumentFields, DeliveryFields, DeliveryHow, PaymentFields } from './fields';
import type { SaleFormView } from './view';

export function Back({ view }: { view: SaleFormView }) {
  return (
    <Button type="button" variant="ghost" className="-ml-2 h-9 cursor-pointer px-2" onClick={() => view.navigate(view.afterSavePath)}>
      <ArrowLeft /> Volver
    </Button>
  );
}

export function QtyPrice({ view, line }: { view: SaleFormView; line: SaleLine }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Input
        type="number"
        min={1}
        value={line.quantity}
        onChange={(event) => view.updateLine(line.id, { quantity: Math.max(1, Math.floor(Number(event.target.value || 1))) })}
        className={NUMBER_INPUT}
        aria-label={`Cantidad ${line.name}`}
      />
      <Input
        type="number"
        min={0}
        step="0.01"
        value={line.unitPrice}
        onChange={(event) => view.updateLine(line.id, { unitPrice: Math.max(0, Number(event.target.value || 0)) })}
        className={NUMBER_INPUT}
        aria-label={`Precio ${line.name}`}
      />
    </div>
  );
}

export function ProductosBody({ view }: { view: SaleFormView }) {
  return (
    <div className="space-y-3">
      {view.lines.map((line) => (
        <div key={line.id} className="flex items-start gap-3">
          <ProductPhoto url={line.imageUrl} shopSku={line.shopSku} sku={line.sku} name={line.name} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{line.name}</p>
            <p className="font-mono text-[11px] text-muted-foreground">{line.sku}</p>
            <div className="mt-2 max-w-xs"><QtyPrice view={view} line={line} /></div>
          </div>
          <p className="text-sm tabular-nums">{formatMoney(line.unitPrice * line.quantity)}</p>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Quitar ${line.name}`}
            onClick={() => view.setLines((current) => current.filter((item) => item.id !== line.id))}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => view.setPickerOpen(true)}>
        <Search /> Agregar
      </Button>
    </div>
  );
}

export function OrigenBody({ view }: { view: SaleFormView }) {
  return (
    <FieldRow label="Canal">
      <Choice value={view.saleSource} options={SALE_SOURCES} onChange={view.setSaleSource} ariaLabel="Origen" />
    </FieldRow>
  );
}

export function ClienteBody({ view }: { view: SaleFormView }) {
  return (
    <div className="space-y-3">
      <FieldRow label="Nombre" htmlFor="customer-name">
        <Input id="customer-name" value={view.customerName} onChange={(event) => view.setCustomerName(event.target.value)} placeholder="Ana Pérez" />
      </FieldRow>
      <FieldRow label="Teléfono" htmlFor="customer-phone">
        <Input id="customer-phone" value={view.customerPhone} onChange={(event) => view.setCustomerPhone(event.target.value)} placeholder="999 111 222" />
      </FieldRow>
      <FieldRow label="Comprobante">
        <ComprobanteChoice view={view} />
      </FieldRow>
      <DocumentFields view={view} />
    </div>
  );
}

export function SaleToolbar({
  view,
  labels,
  step,
  onStep,
  onNext,
  isLast,
  nextLabel = 'Siguiente',
}: {
  view: SaleFormView;
  labels: readonly string[];
  step: number;
  onStep: (index: number) => void;
  onNext: () => void;
  isLast: boolean;
  nextLabel?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Back view={view} />
      <SaleSteps
        value={String(step)}
        options={labels.map((label, index) => ({ value: String(index), label }))}
        onChange={(value) => onStep(Number(value))}
      />
      <div className="ml-auto flex items-center gap-2">
        <p className="text-sm font-medium tabular-nums">{formatMoney(view.total)}</p>
        {isLast ? (
          <Button type="submit" className="rounded-full" disabled={view.submitDisabled}>
            {view.creating ? 'Listo…' : 'Registrar venta'}
          </Button>
        ) : (
          <Button type="button" className="rounded-full" onClick={onNext}>{nextLabel}</Button>
        )}
      </div>
    </div>
  );
}

export function EntregaBody({ view }: { view: SaleFormView }) {
  return (
    <div className="space-y-3">
      <FieldRow label="Cómo">
        <DeliveryHow view={view} />
      </FieldRow>
      <DeliveryFields view={view} />
    </div>
  );
}

export function PagoBody({ view }: { view: SaleFormView }) {
  return (
    <FieldRow label="Pago">
      <PaymentFields view={view} />
    </FieldRow>
  );
}

export function VentaBody({ view }: { view: SaleFormView }) {
  return (
    <div className="space-y-6">
      <OrigenBody view={view} />
      <ClienteBody view={view} />
      <ProductosBody view={view} />
    </div>
  );
}

export function StepFooter({
  view,
  isFirst,
  isLast,
  onBack,
  onNext,
  nextLabel = 'Siguiente',
  skip,
}: {
  view: SaleFormView;
  isFirst: boolean;
  isLast: boolean;
  onBack: () => void;
  onNext: () => void;
  nextLabel?: string;
  skip?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="ghost" className="rounded-full" disabled={isFirst} onClick={onBack}>Atrás</Button>
      {skip ? (
        <Button type="button" variant="ghost" className="rounded-full" onClick={skip.onClick}>{skip.label}</Button>
      ) : null}
      <p className="ml-auto text-sm font-medium tabular-nums">{formatMoney(view.total)}</p>
      {isLast ? (
        <Button type="submit" className="rounded-full" disabled={view.submitDisabled}>{view.creating ? 'Listo…' : 'Registrar venta'}</Button>
      ) : (
        <Button type="button" className="rounded-full" onClick={onNext}>{nextLabel}</Button>
      )}
    </div>
  );
}
