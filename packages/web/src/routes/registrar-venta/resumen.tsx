import { Pencil } from 'lucide-react';
import { type SaleStepId } from '../../lib/registrar-venta';
import { formatSaleMoney, saleSummaryGroups, saleTotalRows } from '../../lib/sale-summary';
import { Button } from '../../components/ui/button';
import { ProductPhoto } from './widgets';
import type { SaleFormView } from './view';

function SectionHeader({ title, onEdit, ariaLabel }: { title: string; onEdit: () => void; ariaLabel: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-mr-2 h-8 cursor-pointer text-muted-foreground"
        aria-label={ariaLabel}
        onClick={onEdit}
      >
        <Pencil /> Editar
      </Button>
    </div>
  );
}

function Rows({ rows }: { rows: ReadonlyArray<{ label: string; value: string }> }) {
  return (
    <dl className="space-y-1.5">
      {rows.map((row) => (
        <div key={row.label} className="grid gap-0.5 text-sm sm:grid-cols-[8.25rem_minmax(0,1fr)] sm:gap-x-4">
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="min-w-0 break-words">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ResumenStep({
  view,
  blockingMessage,
  blockingStep,
}: {
  view: SaleFormView;
  blockingMessage: string | null;
  blockingStep: SaleStepId | null;
}) {
  const groups = saleSummaryGroups({
    customerName: view.customerName,
    customerPhone: view.customerPhone,
    lines: view.lines,
    delivery: view.delivery,
    deliveryDate: view.deliveryDate,
    shippingCarrier: view.shippingCarrier,
    dropoffPlace: view.dropoffPlace,
    shippingNote: view.shippingNote,
    saleSource: view.saleSource,
    paymentMethod: view.paymentMethod,
    receivedBy: view.receivedBy,
    paymentProof: view.paymentProof,
    documentRequest: view.documentRequest,
    boletaIdentity: view.boletaIdentity,
    customerDocumentNumber: view.customerDocumentNumber,
    legalName: view.legalName,
    fiscalAddress: view.fiscalAddress,
  });
  const totalRows = saleTotalRows(view.totals, view.shippingQuote?.zoneLabel, view.shippingQuote?.distanceKm);
  const [cliente, entrega, pago] = groups;

  return (
    <div className="space-y-6">
      {blockingMessage ? (
        <div className="flex flex-col gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-destructive">{blockingMessage}</p>
          {blockingStep ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 cursor-pointer"
              onClick={() => view.goToStep(blockingStep)}
            >
              Corregir
            </Button>
          ) : null}
        </div>
      ) : null}

      <section className="space-y-3">
        <SectionHeader title={cliente.title} ariaLabel="Editar cliente" onEdit={() => view.goToStep('cliente')} />
        <Rows rows={cliente.rows} />
      </section>

      <section className="space-y-3 border-t border-border pt-5">
        <SectionHeader
          title={view.lines.length === 1 ? 'Productos · 1' : `Productos · ${view.lines.length}`}
          ariaLabel="Editar productos"
          onEdit={() => view.goToStep('productos')}
        />
        {view.lines.length ? (
          <ul className="space-y-3">
            {view.lines.map((line) => (
              <li key={line.id} className="flex items-start gap-3">
                <ProductPhoto url={line.imageUrl} shopSku={line.shopSku} sku={line.sku} name={line.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-medium leading-5">{line.name}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    <span className="font-mono">{line.sku}</span>
                    {' · '}
                    {line.quantity} × {formatSaleMoney(line.unitPrice)}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-medium tabular-nums">
                  {formatSaleMoney(line.unitPrice * line.quantity)}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Sin productos.</p>
        )}
      </section>

      <section className="space-y-3 border-t border-border pt-5">
        <SectionHeader title={entrega.title} ariaLabel="Editar entrega" onEdit={() => view.goToStep('entrega')} />
        <Rows rows={entrega.rows} />
      </section>

      <section className="space-y-3 border-t border-border pt-5">
        <SectionHeader title={pago.title} ariaLabel="Editar pago" onEdit={() => view.goToStep('pago')} />
        <Rows rows={pago.rows} />
      </section>

      <section className="space-y-1.5 border-t border-border pt-5">
        {totalRows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-muted-foreground">{row.label}</span>
            <span className="shrink-0 tabular-nums">{row.value}</span>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-3 pt-1.5">
          <span className="text-sm font-medium">Total</span>
          <span className="text-xl font-semibold tabular-nums">{formatSaleMoney(view.totals.total)}</span>
        </div>
      </section>
    </div>
  );
}
