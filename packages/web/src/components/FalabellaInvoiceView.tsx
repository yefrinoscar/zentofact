import { useState } from 'react';
import { money } from '../lib/pagos-presentation';
import {
  invoiceAmountInWords,
  invoiceChargeAmount,
  invoiceConceptAmounts,
  invoiceConceptLabel,
  invoiceCruceHint,
  invoiceCruceStatusLabel,
  invoiceCruceSummary,
  invoiceDocumentAmounts,
  invoiceElectronicTitle,
  invoiceKindLabel,
  invoiceLinesForItem,
  invoiceLongDate,
  invoicePeriodLabel,
} from '../lib/pagos-invoice-report';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';

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

export type FalabellaInvoiceCruceConcept = {
  key: string;
  billed: number;
  deducted: number;
  delta: number;
  status: string;
};

export type FalabellaInvoiceCruceOrder = {
  orderNumber: string;
  productName?: string;
  sellerSku?: string;
  statementNumber?: string;
  paid?: boolean;
  paymentStatus?: string;
  hasPago?: boolean;
  concepts: FalabellaInvoiceCruceConcept[];
  billed: number;
  deducted: number;
  delta: number;
  status: string;
};

export type FalabellaInvoiceReconciliation = {
  orders: FalabellaInvoiceCruceOrder[];
  summary: {
    orderCount: number;
    matchCount: number;
    mismatchCount: number;
    missingPagoCount: number;
    passThroughCount: number;
    billed: number;
    deducted: number;
    delta: number;
    passThrough: number;
  };
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
  reconciliation?: FalabellaInvoiceReconciliation | null;
};

function soles(signed: number, kind: string) {
  return money.format(invoiceChargeAmount(kind, signed).amount);
}

function FalabellaMark() {
  return (
    <div
      className="grid size-8 shrink-0 place-items-center rounded-md bg-zinc-900 text-white"
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="none">
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
      <p className="text-[10px] font-medium tracking-wide text-zinc-400">{label}</p>
      <p className="mt-0.5 text-[13px] font-medium text-zinc-900">{value || '—'}</p>
    </div>
  );
}

function cruceTone(status: string) {
  if (status === 'mismatch') return 'text-red-700';
  if (status === 'no_pago') return 'text-amber-800';
  if (status === 'match') return 'text-emerald-700';
  return 'text-zinc-500';
}

function InvoiceCruce({
  document,
  focusedOrder,
  onFocusOrder,
}: {
  document: FalabellaInvoiceDocument;
  focusedOrder: string;
  onFocusOrder: (orderNumber: string) => void;
}) {
  const reconciliation = document.reconciliation;
  const [filter, setFilter] = useState('');
  const summary = reconciliation?.summary;
  const orders = (reconciliation?.orders || []).filter((order) => {
    if (filter === 'mismatch') return order.status === 'mismatch';
    if (filter === 'no_pago') return order.status === 'no_pago';
    return true;
  });
  const hint = invoiceCruceHint(summary);
  const counts = invoiceCruceSummary(summary);

  return (
    <div className="mt-5 border-t border-zinc-100 pt-4">
      <p className="text-[10px] font-medium tracking-wide text-zinc-400">Cruce con el pago</p>
      <p className="mt-0.5 text-[13px] font-medium text-zinc-900">{hint}</p>
      {counts ? <p className="mt-0.5 text-[11px] text-zinc-500">{counts}</p> : null}
      {summary && (summary.billed || summary.passThrough) ? (
        <p className="mt-0.5 text-[11px] text-zinc-500">
          Facturado {money.format(summary.billed)}
          {' · '}
          Descontado {money.format(summary.deducted)}
          {summary.passThrough ? ` · ${money.format(summary.passThrough)} no se descuenta` : ''}
        </p>
      ) : null}
      {Number(summary?.mismatchCount || 0) || Number(summary?.missingPagoCount || 0) ? (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
          {[
            { key: '', label: 'Todos' },
            Number(summary?.mismatchCount || 0) ? { key: 'mismatch', label: 'No cuadran' } : null,
            Number(summary?.missingPagoCount || 0) ? { key: 'no_pago', label: 'Sin pago' } : null,
          ].filter(Boolean).map((item) => (
            <button
              key={item!.key || 'all'}
              type="button"
              onClick={() => setFilter(item!.key)}
              className={cn(
                'underline-offset-4',
                filter === item!.key ? 'font-medium text-zinc-900 underline' : 'text-zinc-500 hover:text-zinc-800',
              )}
            >
              {item!.label}
            </button>
          ))}
        </div>
      ) : null}
      {orders.length ? (
        <div className="mt-2 max-h-[min(40vh,22rem)] overflow-y-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-white text-[10px] font-medium tracking-wide text-zinc-400">
              <tr className="border-b border-zinc-100">
                <th className="py-1.5 pr-2 text-left">Pedido</th>
                <th className="py-1.5 pr-2 text-right">Facturado</th>
                <th className="py-1.5 pr-2 text-right">Descontado</th>
                <th className="py-1.5 text-right">Estado</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => {
                const selected = focusedOrder === order.orderNumber;
                return (
                  <tr
                    key={order.orderNumber}
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected}
                    onClick={() => onFocusOrder(selected ? '' : order.orderNumber)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      onFocusOrder(selected ? '' : order.orderNumber);
                    }}
                    className={cn(
                      'cursor-pointer border-b border-zinc-50 align-top hover:bg-zinc-50',
                      selected && 'bg-zinc-50',
                    )}
                  >
                    <td className="py-1.5 pr-2">
                      <p className="font-mono text-[11px] text-zinc-600">{order.orderNumber}</p>
                      <p className="line-clamp-1 text-[11px] leading-4 text-zinc-500">
                        {order.productName || invoiceConceptLabel(order.concepts[0]?.key)}
                      </p>
                      {order.concepts.map((row) => (
                        <p key={row.key} className="text-[11px] leading-4 text-zinc-500">
                          {invoiceConceptLabel(row.key)}
                          {' '}
                          {money.format(row.billed)}
                          {row.status === 'pass_through' || row.status === 'no_pago'
                            ? ''
                            : ` → ${money.format(row.deducted)}`}
                        </p>
                      ))}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {money.format(order.billed || order.concepts.reduce((sum, row) => sum + Number(row.billed || 0), 0))}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums text-zinc-600">
                      {order.status === 'pass_through' || order.status === 'no_pago'
                        ? '—'
                        : money.format(order.deducted)}
                    </td>
                    <td className={cn('py-1.5 text-right text-[12px]', cruceTone(order.status))}>
                      {invoiceCruceStatusLabel(order.status)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
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
  const [focusedOrder, setFocusedOrder] = useState(String(highlightOrder || '').trim());
  const orderId = focusedOrder;
  const concepts = document.concepts || [];
  const conceptKeys = new Set(concepts.map((row) => row.key));
  const [conceptKey, setConceptKey] = useState<string>('');
  const activeConcept = conceptKeys.has(conceptKey) ? conceptKey : '';
  const orderLines = orderId
    ? (document.lines || []).filter((line) => String(line.orderNumber || '').trim() === orderId)
    : [];
  const itemLines = invoiceLinesForItem(
    orderId
      ? (document.lines || []).filter((line) => String(line.orderNumber || '').trim() === orderId)
      : document.lines,
    activeConcept,
  );
  const lineCount = document.lineCount || document.lines?.length || 0;
  const itemCount = (activeConcept || orderId) ? itemLines.length : lineCount;
  const paper = invoiceDocumentAmounts(kind, concepts);
  const gross = paper.gross;

  return (
    <div className="bg-white px-5 py-5 text-zinc-900 sm:px-6">
      <div className="flex items-start gap-3">
        <FalabellaMark />
        <div>
          <p className="text-lg font-semibold tracking-tight">{invoiceKindLabel(kind)}</p>
          <p className="mt-0.5 text-[13px] text-zinc-500">Nº {document.number}</p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-4">
        <MetaCell label="Fecha de emisión" value={issued} />
        <MetaCell label="Periodo" value={period} />
        <MetaCell label="IGV" value="18%" />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-6">
        <div>
          <p className="text-[10px] font-medium tracking-wide text-zinc-400">Emitida por</p>
          <p className="mt-1 text-sm font-semibold">Falabella</p>
          <p className="mt-0.5 text-[13px] leading-5 text-zinc-500">
            Falabella Seller Center
            <br />
            Perú
          </p>
        </div>
        <div>
          <p className="text-[10px] font-medium tracking-wide text-zinc-400">Dirigida a</p>
          <p className="mt-1 text-sm font-semibold">Seller {document.sellerId || '—'}</p>
          <p className="mt-0.5 text-[13px] leading-5 text-zinc-500">
            {document.sellerId || '—'}
            <br />
            {document.currency || 'PEN'}
          </p>
        </div>
      </div>

      <table className="mt-5 w-full border-collapse text-[13px]">
        <thead>
          <tr className="bg-zinc-100 text-[10px] font-semibold tracking-wide text-zinc-700">
            <th className="rounded-l-md py-1.5 pl-3 pr-2 text-left">Ítem</th>
            <th className="px-2 py-1.5 text-right">Cant.</th>
            <th className="px-2 py-1.5 text-right">Valor</th>
            <th className="px-2 py-1.5 text-right">IGV</th>
            <th className="rounded-r-md py-1.5 pl-2 pr-3 text-right">Importe</th>
          </tr>
        </thead>
        <tbody>
          {concepts.map((row) => {
            const amounts = invoiceConceptAmounts(kind, row);
            const qty = Math.max(1, Number(row.count || 0));
            const selected = activeConcept === row.key;
            return (
              <tr
                key={row.key}
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                onClick={() => setConceptKey(selected ? '' : row.key)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  setConceptKey(selected ? '' : row.key);
                }}
                className={cn(
                  'cursor-pointer border-b border-zinc-100 last:border-0 hover:bg-zinc-50',
                  selected && 'bg-zinc-50',
                )}
              >
                <td className="py-2 pl-3 pr-2 font-medium">{invoiceConceptLabel(row.key)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-zinc-600">
                  {qty}
                  <span className="ml-1 text-zinc-400">líneas</span>
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-zinc-600">{money.format(amounts.net)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-zinc-600">{money.format(amounts.igv)}</td>
                <td className="py-2 pl-2 pr-3 text-right tabular-nums font-medium">{money.format(amounts.gross)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-[1fr_16rem] sm:items-start">
        <div className="space-y-3 text-[13px]">
          <div>
            <p className="text-[10px] font-medium tracking-wide text-zinc-400">Documento</p>
            <p className="mt-0.5 font-medium">{invoiceElectronicTitle(kind)}</p>
            <p className="text-zinc-500">{document.currency || 'PEN'} · {lineCount} {lineCount === 1 ? 'línea' : 'líneas'}</p>
          </div>
          <div>
            <p className="text-[10px] font-medium tracking-wide text-zinc-400">Notas</p>
            <p className="mt-0.5 text-[12px] leading-5 text-zinc-600">{invoiceAmountInWords(gross)}</p>
            <p className="mt-1 text-[11px] leading-4 text-zinc-400">
              Representación visual del InvoiceReport. No es el XML de SUNAT.
            </p>
          </div>
        </div>
        <div className="rounded-xl bg-zinc-100 px-4 py-3 text-[13px]">
          <div className="flex items-center justify-between gap-4 py-0.5 text-zinc-600">
            <span>Subtotal</span>
            <span className="tabular-nums">{money.format(paper.net)}</span>
          </div>
          <div className="flex items-center justify-between gap-4 py-0.5 text-zinc-600">
            <span>IGV (18%)</span>
            <span className="tabular-nums">{money.format(paper.igv)}</span>
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-4 border-t border-zinc-200 pt-2 font-semibold text-zinc-900">
            <span>Total</span>
            <span className="tabular-nums">{money.format(paper.gross)}</span>
          </div>
        </div>
      </div>

      {document.reconciliation ? (
        <InvoiceCruce
          document={document}
          focusedOrder={orderId}
          onFocusOrder={setFocusedOrder}
        />
      ) : null}

      {orderLines.length && !activeConcept ? (
        <div className="mt-5 border-t border-zinc-100 pt-4">
          <p className="text-[10px] font-medium tracking-wide text-zinc-400">Este pedido {orderId}</p>
          <table className="mt-1.5 w-full text-[13px]">
            <tbody>
              {orderLines.map((line, index) => (
                <tr key={line.id || `${line.concept}-${index}`} className="border-b border-zinc-100 last:border-0">
                  <td className="py-1.5 pr-3">
                    <p className="font-medium">{invoiceConceptLabel(line.concept)}</p>
                    <p className="text-[11px] text-zinc-500">{line.productName || line.description}</p>
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{soles(Number(line.gross || 0), kind)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="mt-5 border-t border-zinc-100 pt-4">
        <p className="text-[10px] font-medium tracking-wide text-zinc-400">
          {activeConcept ? invoiceConceptLabel(activeConcept) : 'Detalle de pedidos'}
        </p>
        <p className="mt-0.5 text-[11px] text-zinc-500">
          {itemCount} {itemCount === 1 ? 'línea' : 'líneas'}
          {orderId ? ` · pedido ${orderId}` : ''}
          {document.statements?.length ? ` · ${document.statements.length} estados de cuenta` : ''}
        </p>
        <div className="mt-2 max-h-[min(52vh,28rem)] overflow-y-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-white text-[10px] font-medium tracking-wide text-zinc-400">
              <tr className="border-b border-zinc-100">
                <th className="py-1.5 pr-2 text-left">Pedido</th>
                <th className="py-1.5 pr-2 text-left">Descripción</th>
                <th className="py-1.5 pr-2 text-left">Concepto</th>
                <th className="py-1.5 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {itemLines.map((line, index) => {
                const highlighted = orderId && String(line.orderNumber || '') === orderId;
                return (
                  <tr
                    key={line.id || `${line.orderNumber}-${index}`}
                    className={cn('border-b border-zinc-50', highlighted && 'bg-zinc-50')}
                  >
                    <td className="py-1.5 pr-2 font-mono text-[11px] text-zinc-600">{line.orderNumber || '—'}</td>
                    <td className="py-1.5 pr-2">
                      <p className="line-clamp-2 leading-4">{line.productName || line.description || '—'}</p>
                      {line.sellerSku ? <p className="font-mono text-[10px] text-zinc-400">{line.sellerSku}</p> : null}
                    </td>
                    <td className="py-1.5 pr-2 text-zinc-600">{invoiceConceptLabel(line.concept)}</td>
                    <td className="py-1.5 text-right tabular-nums">{soles(Number(line.gross || 0), kind)}</td>
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

export type FalabellaInvoiceListItem = {
  id: number;
  number: string;
  kind: string;
  issuedOn?: string | null;
  gross?: number | null;
};

export function FalabellaInvoiceSheet({
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
  documents?: FalabellaInvoiceListItem[];
  onSelect?: (id: number) => void;
}) {
  const siblings = documents || [];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="gap-0 overflow-hidden p-0 sm:max-w-4xl"
        aria-describedby={undefined}
      >
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <nav
            aria-label="Facturas"
            className="flex max-h-52 shrink-0 flex-col border-b border-border bg-muted/30 sm:max-h-none sm:w-60 sm:border-b-0 sm:border-r"
          >
            <SheetHeader className="h-12 justify-center px-4 pr-12 sm:pr-4">
              <SheetTitle>Facturas</SheetTitle>
              <SheetDescription className="sr-only">
                {document ? invoiceElectronicTitle(document.kind) : 'Facturas de Falabella'}
              </SheetDescription>
            </SheetHeader>
            {siblings.length ? (
              <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {siblings.map((item) => {
                  const selected = document?.id === item.id;
                  const issued = invoicePeriodLabel(item.issuedOn, item.issuedOn);
                  const charged = item.gross != null ? invoiceChargeAmount(item.kind, item.gross) : null;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => onSelect?.(item.id)}
                        aria-current={selected ? 'page' : undefined}
                        className={cn(
                          'w-full rounded-md px-2.5 py-2 text-left',
                          selected ? 'bg-background text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:bg-background/70 hover:text-foreground',
                        )}
                      >
                        <p className="font-mono text-[13px] font-medium text-foreground">{item.number}</p>
                        <p className="mt-0.5 text-[11px] leading-4">
                          {invoiceKindLabel(item.kind)}
                          {issued ? ` · ${issued}` : ''}
                        </p>
                        {charged ? (
                          <p className={cn('mt-0.5 text-[12px] tabular-nums', charged.credit && 'text-emerald-700')}>
                            {charged.credit ? '−' : ''}
                            {money.format(charged.amount)}
                          </p>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-4 py-3 text-sm text-muted-foreground">Sube el InvoiceReport.</p>
            )}
          </nav>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            {document ? (
              <FalabellaInvoiceView
                key={`${document.id}-${highlightOrder || ''}`}
                document={document}
                highlightOrder={highlightOrder}
              />
            ) : (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground">Cargando factura…</p>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function FalabellaInvoiceDialog(props: Parameters<typeof FalabellaInvoiceSheet>[0]) {
  return <FalabellaInvoiceSheet {...props} />;
}
