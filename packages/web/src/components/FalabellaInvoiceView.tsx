import { money } from '../lib/pagos-presentation';
import {
  invoiceChargeAmount,
  invoiceConceptLabel,
  invoiceKindLabel,
  invoiceNumberLabel,
  invoicePeriodLabel,
} from '../lib/pagos-invoice-report';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export type FalabellaInvoiceLine = {
  id?: number;
  orderNumber?: string;
  productName?: string;
  sellerSku?: string;
  description?: string;
  concept?: string;
  net?: number;
  igv?: number;
  gross?: number;
};

export type FalabellaInvoiceDocument = {
  id: number;
  number: string;
  kind: string;
  currency?: string;
  sellerId?: string;
  periodFrom?: string | null;
  periodTo?: string | null;
  net?: number;
  igv?: number;
  gross?: number;
  lineCount?: number;
  filename?: string;
  statements?: string[];
  concepts?: Array<{ key: string; count: number; net: number; igv: number; gross: number }>;
  lines?: FalabellaInvoiceLine[];
};

function AmountCell({
  signed,
  kind,
  className,
}: {
  signed: number;
  kind: string;
  className?: string;
}) {
  const shown = invoiceChargeAmount(kind, signed);
  return (
    <span className={cn(
      'tabular-nums',
      (kind === 'nota_credito' || shown.credit) && 'text-emerald-700 dark:text-emerald-400',
      className,
    )}
    >
      {money.format(shown.amount)}
    </span>
  );
}

export function FalabellaInvoiceView({
  document,
  highlightOrder,
}: {
  document: FalabellaInvoiceDocument;
  highlightOrder?: string | null;
}) {
  const kind = document.kind || 'factura';
  const period = invoicePeriodLabel(document.periodFrom, document.periodTo);
  const orderId = String(highlightOrder || '').trim();
  const orderLines = orderId
    ? (document.lines || []).filter((line) => String(line.orderNumber || '').trim() === orderId)
    : [];
  const orderGross = orderLines.reduce((sum, line) => sum + Number(line.gross || 0), 0);

  return (
    <div className="bg-background text-foreground">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Falabella</p>
          <h2 className="text-xl font-semibold leading-tight">{invoiceKindLabel(kind)} {document.number}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {kind === 'nota_credito'
              ? 'Te devuelven comisión u otro cobro.'
              : 'Comisión, logística y otros cobros de este período.'}
          </p>
        </div>
        <div className="text-right text-sm">
          <p className="font-mono text-xs text-muted-foreground">{document.sellerId || '—'}</p>
          <p className="text-muted-foreground">{document.currency || 'PEN'}{period ? ` · ${period}` : ''}</p>
        </div>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="px-5 py-2 text-left font-medium">Concepto</th>
            <th className="px-5 py-2 text-right font-medium">Gravado</th>
            <th className="w-24 px-5 py-2 text-right font-medium">IGV</th>
            <th className="px-5 py-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {(document.concepts || []).map((row) => (
            <tr key={row.key} className="border-b border-border">
              <td className="px-5 py-2">
                {invoiceConceptLabel(row.key)}
                <span className="ml-1 text-xs text-muted-foreground">{row.count}</span>
              </td>
              <td className="px-5 py-2 text-right"><AmountCell signed={row.net} kind={kind} /></td>
              <td className="px-5 py-2 text-right"><AmountCell signed={row.igv} kind={kind} /></td>
              <td className="px-5 py-2 text-right font-medium"><AmountCell signed={row.gross} kind={kind} /></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-b border-border">
            <td className="px-5 py-2 text-muted-foreground">Gravado</td>
            <td className="px-5 py-2 text-right" colSpan={3}><AmountCell signed={Number(document.net || 0)} kind={kind} /></td>
          </tr>
          <tr className="border-b border-border">
            <td className="px-5 py-2 text-muted-foreground">IGV 18%</td>
            <td className="px-5 py-2 text-right" colSpan={3}><AmountCell signed={Number(document.igv || 0)} kind={kind} /></td>
          </tr>
          <tr>
            <td className="px-5 py-3 font-medium">Total</td>
            <td className="px-5 py-3 text-right text-base font-semibold" colSpan={3}>
              <AmountCell signed={Number(document.gross || 0)} kind={kind} />
            </td>
          </tr>
        </tfoot>
      </table>

      {orderLines.length ? (
        <div className="border-t border-border px-5 py-4">
          <p className="text-sm font-medium">Este pedido {orderId}</p>
          <p className="text-xs text-muted-foreground">
            {kind === 'nota_credito' ? 'Te devuelven' : 'Falabella cobra'}{' '}
            <AmountCell signed={orderGross} kind={kind} />
          </p>
          <table className="mt-2 w-full text-sm">
            <tbody>
              {orderLines.map((line, index) => (
                <tr key={line.id || `${line.concept}-${index}`} className="border-b border-border last:border-0">
                  <td className="py-2 pr-3">
                    <p>{invoiceConceptLabel(line.concept)}</p>
                    <p className="text-xs text-muted-foreground">{line.productName || line.description}</p>
                  </td>
                  <td className="py-2 text-right"><AmountCell signed={Number(line.gross || 0)} kind={kind} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="border-t border-border px-5 py-4">
        <p className="text-sm font-medium">Detalle</p>
        <p className="text-xs text-muted-foreground">
          {document.lineCount || document.lines?.length || 0} líneas
          {document.statements?.length ? ` · ${document.statements.length} estados de cuenta` : ''}
        </p>
        <div className="mt-2 max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background text-muted-foreground">
              <tr className="border-b border-border">
                <th className="py-2 pr-3 text-left font-medium">Pedido</th>
                <th className="py-2 pr-3 text-left font-medium">Producto</th>
                <th className="py-2 pr-3 text-left font-medium">Concepto</th>
                <th className="py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {(document.lines || []).map((line, index) => {
                const highlighted = orderId && String(line.orderNumber || '') === orderId;
                return (
                  <tr
                    key={line.id || `${line.orderNumber}-${index}`}
                    className={cn('border-b border-border', highlighted && 'bg-muted/50')}
                  >
                    <td className="py-2 pr-3 font-mono text-xs">{line.orderNumber || '—'}</td>
                    <td className="py-2 pr-3">
                      <p className="line-clamp-2 leading-5">{line.productName || line.description || '—'}</p>
                      {line.sellerSku ? <p className="font-mono text-[11px] text-muted-foreground">{line.sellerSku}</p> : null}
                    </td>
                    <td className="py-2 pr-3">{invoiceConceptLabel(line.concept)}</td>
                    <td className="py-2 text-right"><AmountCell signed={Number(line.gross || 0)} kind={kind} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function FalabellaInvoiceDialog({
  document,
  highlightOrder,
  open,
  onOpenChange,
  documents,
  onSelect,
}: {
  document: FalabellaInvoiceDocument | null;
  highlightOrder?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documents?: Array<{ id: number; number: string; kind: string }>;
  onSelect?: (id: number) => void;
}) {
  const siblings = documents || [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
        aria-describedby={undefined}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{document ? invoiceNumberLabel(document) : 'Factura Falabella'}</DialogTitle>
          <DialogDescription>Detalle visual de lo que Falabella factura al seller.</DialogDescription>
        </DialogHeader>
        {siblings.length > 1 ? (
          <div className="flex flex-wrap gap-1 border-b border-border px-5 py-2">
            {siblings.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect?.(item.id)}
                className={cn(
                  'rounded-md px-2 py-1 text-xs',
                  document?.id === item.id ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/60',
                )}
              >
                {invoiceNumberLabel(item)}
              </button>
            ))}
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {document ? (
            <FalabellaInvoiceView document={document} highlightOrder={highlightOrder} />
          ) : (
            <p className="px-5 py-10 text-center text-sm text-muted-foreground">Cargando factura…</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
