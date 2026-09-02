import { money } from '../lib/pagos-presentation';
import {
  invoiceAmountInWords,
  invoiceChargeAmount,
  invoiceConceptLabel,
  invoiceElectronicTitle,
  invoiceKindLabel,
  invoiceLongDate,
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
  issuedOn?: string | null;
  net?: number;
  igv?: number;
  gross?: number;
  lineCount?: number;
  filename?: string;
  statements?: string[];
  concepts?: Array<{ key: string; count: number; net: number; igv: number; gross: number }>;
  lines?: FalabellaInvoiceLine[];
};

function soles(signed: number, kind: string) {
  return money.format(invoiceChargeAmount(kind, signed).amount);
}

function FalabellaMark() {
  return (
    <div
      className="grid size-11 shrink-0 place-items-center rounded-lg bg-zinc-900 text-white"
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" className="size-6" fill="none">
        <path
          d="M5 16c3.2-1.2 5.4-4.4 7-8 1.6 3.6 3.8 6.8 7 8"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium tracking-wide text-zinc-400">{label}</p>
      <p className="mt-1 text-sm font-medium text-zinc-900">{value || '—'}</p>
    </div>
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
  const issued = invoiceLongDate(document.issuedOn || document.periodTo)
    || invoicePeriodLabel(document.issuedOn || document.periodTo, document.issuedOn || document.periodTo);
  const orderId = String(highlightOrder || '').trim();
  const concepts = document.concepts || [];
  const gross = invoiceChargeAmount(kind, Number(document.gross || 0)).amount;
  const orderLines = orderId
    ? (document.lines || []).filter((line) => String(line.orderNumber || '').trim() === orderId)
    : [];
  const lineCount = document.lineCount || document.lines?.length || 0;

  return (
    <div className="bg-white px-10 py-10 text-zinc-900 sm:px-12 sm:py-12">
      <div className="flex items-start justify-between gap-6">
        <FalabellaMark />
        <div className="text-right">
          <p className="text-2xl font-semibold tracking-tight">{invoiceKindLabel(kind)}</p>
          <p className="mt-1 text-sm text-zinc-500">Nº {document.number}</p>
        </div>
      </div>

      <div className="mt-10 grid grid-cols-3 gap-6">
        <MetaCell label="Fecha de emisión" value={issued} />
        <MetaCell label="Periodo" value={period} />
        <MetaCell label="IGV" value="18%" />
      </div>

      <div className="mt-10 grid grid-cols-2 gap-10">
        <div>
          <p className="text-[11px] font-medium tracking-wide text-zinc-400">Emitida por</p>
          <p className="mt-1.5 text-base font-semibold">Falabella</p>
          <p className="mt-1 text-sm leading-5 text-zinc-500">
            Falabella Seller Center
            <br />
            Perú
          </p>
        </div>
        <div>
          <p className="text-[11px] font-medium tracking-wide text-zinc-400">Dirigida a</p>
          <p className="mt-1.5 text-base font-semibold">Seller {document.sellerId || '—'}</p>
          <p className="mt-1 text-sm leading-5 text-zinc-500">
            {document.sellerId || '—'}
            <br />
            {document.currency || 'PEN'}
          </p>
        </div>
      </div>

      <table className="mt-10 w-full border-collapse text-sm">
        <thead>
          <tr className="bg-zinc-100 text-[11px] font-semibold tracking-wide text-zinc-700">
            <th className="rounded-l-lg py-2.5 pl-4 pr-3 text-left">Ítem</th>
            <th className="px-3 py-2.5 text-right">Cant.</th>
            <th className="px-3 py-2.5 text-right">Valor</th>
            <th className="rounded-r-lg py-2.5 pl-3 pr-4 text-right">Importe</th>
          </tr>
        </thead>
        <tbody>
          {concepts.map((row) => {
            const net = invoiceChargeAmount(kind, row.net).amount;
            const qty = Math.max(1, Number(row.count || 0));
            const unit = Math.round((net / qty) * 100) / 100;
            return (
              <tr key={row.key} className="border-b border-zinc-100 last:border-0">
                <td className="py-4 pl-4 pr-3 font-medium">{invoiceConceptLabel(row.key)}</td>
                <td className="px-3 py-4 text-right tabular-nums text-zinc-600">
                  {qty}
                  <span className="ml-1 text-zinc-400">líneas</span>
                </td>
                <td className="px-3 py-4 text-right tabular-nums text-zinc-600">{money.format(unit)}</td>
                <td className="py-4 pl-3 pr-4 text-right tabular-nums font-medium">{money.format(net)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mt-10 grid grid-cols-1 gap-8 sm:grid-cols-[1fr_20rem] sm:items-start">
        <div className="space-y-5 text-sm">
          <div>
            <p className="text-[11px] font-medium tracking-wide text-zinc-400">Documento</p>
            <p className="mt-1 font-medium">{invoiceElectronicTitle(kind)}</p>
            <p className="text-zinc-500">{document.currency || 'PEN'} · {lineCount} {lineCount === 1 ? 'línea' : 'líneas'}</p>
          </div>
          <div>
            <p className="text-[11px] font-medium tracking-wide text-zinc-400">Notas</p>
            <p className="mt-1 text-[13px] leading-5 text-zinc-600">{invoiceAmountInWords(gross)}</p>
            <p className="mt-2 text-[12px] leading-5 text-zinc-400">
              Representación visual del InvoiceReport. No es el XML de SUNAT.
            </p>
          </div>
        </div>
        <div className="rounded-2xl bg-zinc-100 px-5 py-4 text-sm">
          <div className="flex items-center justify-between gap-4 py-1.5 text-zinc-600">
            <span>Subtotal</span>
            <span className="tabular-nums">{soles(Number(document.net || 0), kind)}</span>
          </div>
          <div className="flex items-center justify-between gap-4 py-1.5 text-zinc-600">
            <span>IGV (18%)</span>
            <span className="tabular-nums">{soles(Number(document.igv || 0), kind)}</span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-4 border-t border-zinc-200 pt-3 font-semibold text-zinc-900">
            <span>Total</span>
            <span className="tabular-nums">{soles(Number(document.gross || 0), kind)}</span>
          </div>
        </div>
      </div>

      {orderLines.length ? (
        <div className="mt-10 border-t border-zinc-100 pt-6">
          <p className="text-[11px] font-medium tracking-wide text-zinc-400">Este pedido {orderId}</p>
          <table className="mt-2 w-full text-sm">
            <tbody>
              {orderLines.map((line, index) => (
                <tr key={line.id || `${line.concept}-${index}`} className="border-b border-zinc-100 last:border-0">
                  <td className="py-2.5 pr-3">
                    <p className="font-medium">{invoiceConceptLabel(line.concept)}</p>
                    <p className="text-xs text-zinc-500">{line.productName || line.description}</p>
                  </td>
                  <td className="py-2.5 text-right tabular-nums">{soles(Number(line.gross || 0), kind)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="mt-10 border-t border-zinc-100 pt-6">
        <p className="text-[11px] font-medium tracking-wide text-zinc-400">Detalle de pedidos</p>
        <p className="mt-1 text-xs text-zinc-500">
          {lineCount} {lineCount === 1 ? 'línea' : 'líneas'}
          {document.statements?.length ? ` · ${document.statements.length} estados de cuenta` : ''}
        </p>
        <div className="mt-3 max-h-64 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white text-[11px] font-medium tracking-wide text-zinc-400">
              <tr className="border-b border-zinc-100">
                <th className="py-2 pr-3 text-left">Pedido</th>
                <th className="py-2 pr-3 text-left">Descripción</th>
                <th className="py-2 pr-3 text-left">Concepto</th>
                <th className="py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {(document.lines || []).map((line, index) => {
                const highlighted = orderId && String(line.orderNumber || '') === orderId;
                return (
                  <tr
                    key={line.id || `${line.orderNumber}-${index}`}
                    className={cn('border-b border-zinc-50', highlighted && 'bg-zinc-50')}
                  >
                    <td className="py-2 pr-3 font-mono text-xs text-zinc-600">{line.orderNumber || '—'}</td>
                    <td className="py-2 pr-3">
                      <p className="line-clamp-2 leading-5">{line.productName || line.description || '—'}</p>
                      {line.sellerSku ? <p className="font-mono text-[11px] text-zinc-400">{line.sellerSku}</p> : null}
                    </td>
                    <td className="py-2 pr-3 text-zinc-600">{invoiceConceptLabel(line.concept)}</td>
                    <td className="py-2 text-right tabular-nums">{soles(Number(line.gross || 0), kind)}</td>
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
        className="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl"
        aria-describedby={undefined}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{document ? invoiceNumberLabel(document) : 'Factura Falabella'}</DialogTitle>
          <DialogDescription>
            {document ? invoiceElectronicTitle(document.kind) : 'Factura electrónica de Falabella'}
          </DialogDescription>
        </DialogHeader>
        {siblings.length > 1 ? (
          <div className="flex flex-wrap gap-1 border-b border-border bg-muted/40 px-4 py-2">
            {siblings.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect?.(item.id)}
                className={cn(
                  'rounded-md px-2 py-1 text-xs',
                  document?.id === item.id ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:bg-background/70',
                )}
              >
                {invoiceNumberLabel(item)}
              </button>
            ))}
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto bg-zinc-100 p-4 sm:p-6">
          {document ? (
            <div className="mx-auto overflow-hidden rounded-2xl bg-white shadow-[0_12px_40px_rgba(24,24,27,0.08)]">
              <FalabellaInvoiceView document={document} highlightOrder={highlightOrder} />
            </div>
          ) : (
            <p className="px-5 py-10 text-center text-sm text-muted-foreground">Cargando factura…</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
