import { ClipboardCheck, Package, Pencil, Truck, User, Wallet, type LucideIcon } from 'lucide-react';
import { type SaleStepId } from '../../lib/registrar-venta';
import { formatSaleMoney, saleSummaryGroups, saleTotalRows } from '../../lib/sale-summary';
import { cn } from '../../lib/cn';
import { Button } from '../../components/ui/button';
import { ProductPhoto, StepPanel } from './widgets';
import type { SaleFormView } from './view';

function Section({
  title,
  icon: Icon,
  step,
  view,
  children,
}: {
  title: string;
  icon: LucideIcon;
  step: SaleStepId;
  view: SaleFormView;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2.5">
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground ring-1 ring-border">
          <Icon className="size-3.5" />
        </span>
        <h3 className="flex-1 text-sm font-semibold">{title}</h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-mr-2 h-8 cursor-pointer text-muted-foreground hover:text-foreground"
          aria-label={`Editar ${title.toLocaleLowerCase('es-PE')}`}
          onClick={() => view.goToStep(step)}
        >
          <Pencil /> Editar
        </Button>
      </div>
      <div className="pl-0 sm:pl-9">{children}</div>
    </section>
  );
}

function Rows({ rows }: { rows: ReadonlyArray<{ label: string; value: string }> }) {
  return (
    <dl className="space-y-1.5">
      {rows.map((row) => (
        <div key={row.label} className="grid gap-0.5 text-sm sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-x-4">
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="min-w-0 break-words font-medium">{row.value}</dd>
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
  const totalRows = saleTotalRows(view.totals, view.shippingQuote?.priceZoneName, view.shippingQuote?.distanceKm);
  const [cliente, entrega, pago] = groups;

  return (
    <StepPanel title="Resumen" hint="Revisa antes de registrar." icon={ClipboardCheck}>
      <div className="space-y-6">
        {blockingMessage ? (
          <div className="flex flex-col gap-2 rounded-md bg-destructive/5 px-3 py-2.5 ring-1 ring-destructive/20 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-medium text-destructive">{blockingMessage}</p>
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

        <Section title={cliente.title} icon={User} step="cliente" view={view}>
          <Rows rows={cliente.rows} />
        </Section>

        <Section
          title={view.lines.length === 1 ? 'Productos · 1' : `Productos · ${view.lines.length}`}
          icon={Package}
          step="productos"
          view={view}
        >
          {view.lines.length ? (
            <ul className="divide-y divide-border/70">
              {view.lines.map((line, index) => (
                <li key={line.id} className={cn('flex items-start gap-3 py-2.5', index === 0 && 'pt-0')}>
                  <ProductPhoto url={line.imageUrl} shopSku={line.shopSku} sku={line.sku} name={line.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-medium leading-5">{line.name}</p>
                    <p className="text-xs tabular-nums text-muted-foreground">
                      <span className="font-mono">{line.sku}</span>
                      {' · '}
                      {line.quantity} × {formatSaleMoney(line.unitPrice)}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular-nums">
                    {formatSaleMoney(line.unitPrice * line.quantity)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Sin productos.</p>
          )}
        </Section>

        <Section title={entrega.title} icon={Truck} step="entrega" view={view}>
          <Rows rows={entrega.rows} />
        </Section>

        <Section title={pago.title} icon={Wallet} step="pago" view={view}>
          <Rows rows={pago.rows} />
        </Section>

        <div className="space-y-1.5 rounded-md bg-muted/50 px-4 py-3 ring-1 ring-border">
          {totalRows.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-muted-foreground">{row.label}</span>
              <span className="shrink-0 tabular-nums">{row.value}</span>
            </div>
          ))}
          <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2.5">
            <span className="text-sm font-medium">Total</span>
            <span className="text-2xl font-semibold tracking-tight tabular-nums">
              {formatSaleMoney(view.totals.total)}
            </span>
          </div>
        </div>
      </div>
    </StepPanel>
  );
}
