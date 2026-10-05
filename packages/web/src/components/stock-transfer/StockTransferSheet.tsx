import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowRightLeft, Check, CheckCircle2, Copy, Loader2, PackageMinus, Search,
} from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../ui/sheet';
import { useOperatorSnackbar } from '../OperatorSnackbar';
import api from '../../lib/api';
import { cn } from '../../lib/cn';
import { logisticsChannelClass, productImageSrc } from '../../lib/logistics-inbox';
import { sellerShortName } from '../../lib/seller-name';
import { stockJobChannelLabel } from '../../lib/stock-job-presentation';

type ShortageLine = {
  orderItemId: number;
  quantity: number;
  applied: number;
  missing: number;
  sellerSku: string | null;
  shopSku: string | null;
  listingId: number | null;
  product: { id: number; mainSku: string | null; title: string | null; imageUrl: string | null } | null;
  inventory: { onHand: number; reserved: number; pendingReturn: number; available: number } | null;
};

type WaitingJob = {
  jobId: number;
  orderId: number | null;
  orderNumber: string | null;
  companyName: string | null;
  channelCode: string | null;
  status: string;
  attempts: number;
  missing: number;
  orderedAt: string | null;
};

type Shortage = {
  job: { id: number; status: string; attempts: number; source: string | null; lastError: string | null };
  order: {
    id: number | null; orderNumber: string | null; companyName: string | null;
    channelCode: string | null; fulfillmentStatus: string | null; orderedAt: string | null;
  };
  lines: ShortageLine[];
  selectedOrderItemId: number | null;
  waiting: WaitingJob[];
  missingForProduct: number;
};

type Candidate = {
  productId: number;
  mainSku: string | null;
  title: string | null;
  imageUrl: string | null;
  inventory: { onHand: number; reserved: number; pendingReturn: number; available: number };
  committed: { units: number; jobs: number };
  reasons: Array<{ kind: string; label: string }>;
  selectable: boolean;
  disabledReason: string | null;
};

type Preview = {
  source: {
    productId: number; mainSku: string | null; availableBefore: number; availableAfter: number;
    committedUnits: number; committedJobs: Array<{ jobId: number; orderNumber: string | null; missing: number }>;
  };
  target: {
    productId: number; mainSku: string | null; availableBefore: number; availableAfter: number;
    missingBefore: number; missingAfter: number;
  };
  covered: Array<{ jobId: number; orderNumber: string | null; quantity: number; status: string }>;
  uncovered: Array<{ jobId: number; orderNumber: string | null; quantity: number; status: string; shortBy: number }>;
  currentJobCovered: boolean | null;
  requiresAcknowledgeCommitted: boolean;
  errors: Array<{ code: string; message: string }>;
};

type TransferResult = {
  transfer: {
    code: string; quantity: number; createdAt: string;
    source?: { mainSku: string | null; onHandBefore: number; onHandAfter: number };
    target?: { mainSku: string | null; onHandBefore: number; onHandAfter: number };
  };
  requeued: Array<{ jobId: number; orderNumber: string | null; status: string }>;
  skipped: Array<{ jobId: number; reason: string }>;
  replayed: boolean;
};

const REASONS = [
  { value: 'import_duplicate', label: 'Duplicado de importación' },
  { value: 'stock_on_other_product', label: 'Stock registrado en otro producto' },
  { value: 'count_correction', label: 'Corrección de conteo' },
  { value: 'other', label: 'Otro' },
];

const JOB_STATUS_LABELS: Record<string, string> = {
  failed: 'Requiere atención',
  skipped: 'Omitido',
  pending: 'En cola',
  processing: 'Procesando',
  done: 'Descontado',
  warning: 'Incidencia',
  cancelled: 'Cancelado',
};

function statusBadgeClass(status: string) {
  if (status === 'failed') return 'border-red-200 bg-red-50 text-red-700';
  if (status === 'pending' || status === 'processing') return 'border-blue-200 bg-blue-50 text-blue-700';
  if (status === 'done') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  return 'border-border bg-muted text-muted-foreground';
}

function fullDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).replace('T', ' ').slice(0, 19);
  return date.toLocaleString('es-PE', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function CopyableCode({ value, label }: { value: string; label: string }) {
  const { showSnackbar } = useOperatorSnackbar();
  return (
    <button
      type="button"
      title={`Copiar ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          showSnackbar({ message: `${label} copiado: ${value}` });
        } catch {
          showSnackbar({ message: 'No se pudo copiar el código.', tone: 'error' });
        }
      }}
      className="inline-flex items-center gap-1 rounded px-0.5 font-mono text-xs font-medium text-foreground underline decoration-border underline-offset-4 transition hover:bg-accent"
    >
      {value}
      <Copy className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}

function NumberCell({ label, value, tone }: { label: string; value: number; tone?: 'danger' }) {
  return (
    <div className={cn(
      'min-w-0 flex-1 px-3 py-2 text-center',
      tone === 'danger' && 'bg-red-50/70',
    )}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-lg font-semibold tabular-nums', tone === 'danger' ? 'text-red-600' : 'text-foreground')}>
        {value}
      </p>
    </div>
  );
}

export function StockTransferSheet({
  job,
  open,
  onOpenChange,
}: {
  job: { id: number; order_number?: string | null; company?: string | null; channel_code?: string | null; attempts?: number } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { showSnackbar } = useOperatorSnackbar();
  const queryClient = useQueryClient();
  const jobId = job?.id ?? null;

  const [lineItemId, setLineItemId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [sourceId, setSourceId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState('');
  const [reasonCode, setReasonCode] = useState('import_duplicate');
  const [note, setNote] = useState('');
  const [retry, setRetry] = useState(true);
  const [ack, setAck] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<TransferResult | null>(null);

  useEffect(() => {
    const debounce = window.setTimeout(() => setSubmittedSearch(search.trim()), 220);
    return () => window.clearTimeout(debounce);
  }, [search]);

  const reset = () => {
    setLineItemId(null);
    setSearch('');
    setSubmittedSearch('');
    setSourceId(null);
    setQuantity('');
    setReasonCode('import_duplicate');
    setNote('');
    setRetry(true);
    setAck(false);
    setConfirmOpen(false);
    setIdempotencyKey('');
    setSubmitting(false);
    setFormError(null);
    setResult(null);
  };

  const shortageQuery = useQuery<Shortage>({
    queryKey: ['stock-job-shortage', jobId, lineItemId],
    queryFn: () => api.stockJobShortage(jobId as number, lineItemId),
    enabled: open && jobId != null,
    staleTime: 10_000,
  });
  const shortage = shortageQuery.data ?? null;
  const selectedLine = useMemo(
    () => shortage?.lines.find((line) => line.orderItemId === shortage.selectedOrderItemId) ?? null,
    [shortage],
  );
  const targetProductId = selectedLine?.product?.id ?? null;

  const candidatesQuery = useQuery<{ candidates: Candidate[] }>({
    queryKey: ['transfer-candidates', targetProductId, submittedSearch],
    queryFn: () => api.stockTransferCandidates(targetProductId as number, submittedSearch ? { q: submittedSearch } : {}),
    enabled: open && targetProductId != null && result == null,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
  const candidates = candidatesQuery.data?.candidates ?? [];

  const quantityNumber = Number(quantity);
  const validQuantity = Number.isInteger(quantityNumber) && quantityNumber > 0;
  const previewQuery = useQuery<Preview>({
    queryKey: ['transfer-preview', sourceId, targetProductId, quantityNumber, ack],
    queryFn: () => api.stockTransferPreview({
      sourceProductId: sourceId as number,
      targetProductId: targetProductId as number,
      quantity: quantityNumber,
      stockJobId: jobId,
      acknowledgeCommitted: ack,
    }),
    enabled: open && sourceId != null && targetProductId != null && validQuantity && result == null,
    placeholderData: keepPreviousData,
    staleTime: 5_000,
  });
  const preview = previewQuery.data ?? null;

  const requeuedIds = result?.requeued.map((entry) => entry.jobId) ?? [];
  const liveJobsQuery = useQuery<{ rows: Array<{ id: number; status: string; order_number: string | null }> }>({
    queryKey: ['stock-jobs', 'list', 'all', 1],
    queryFn: () => api.stockJobsList({ status: 'all', page: 1, pageSize: 100 }),
    enabled: open && requeuedIds.length > 0,
    refetchInterval: 2500,
  });
  const liveStatus = useMemo(() => {
    const map = new Map<number, string>();
    for (const row of liveJobsQuery.data?.rows ?? []) map.set(Number(row.id), row.status);
    return map;
  }, [liveJobsQuery.data]);

  useEffect(() => {
    if (!open || !shortage) return;
    if (quantity === '') {
      const missing = shortage.lines.find((line) => line.orderItemId === shortage.selectedOrderItemId)?.missing ?? 1;
      setQuantity(String(Math.max(missing, 1)));
    }
  }, [open, shortage, quantity]);

  useEffect(() => {
    if (sourceId != null && !candidates.some((candidate) => candidate.productId === sourceId && candidate.selectable)) {
      setSourceId(null);
    }
  }, [candidates, sourceId]);

  const openConfirm = () => {
    setFormError(null);
    setIdempotencyKey(`transfer:${jobId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`);
    setConfirmOpen(true);
  };

  const submit = async () => {
    if (submitting || !sourceId || !targetProductId || !validQuantity) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const response = await api.stockTransferCreate({
        sourceProductId: sourceId,
        targetProductId,
        quantity: quantityNumber,
        reasonCode,
        note: note.trim() || undefined,
        stockJobId: jobId,
        retry,
        acknowledgeCommitted: ack,
      }, idempotencyKey);
      setResult(response as TransferResult);
      setConfirmOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['stock-jobs'] });
      await queryClient.invalidateQueries({ queryKey: ['product-inventory'] });
      await queryClient.invalidateQueries({ queryKey: ['product-movements'] });
      showSnackbar({
        message: `Stock movido · ${(response as TransferResult).transfer.code}${retry && (response as TransferResult).requeued.length ? ` · ${(response as TransferResult).requeued.length} pedido(s) reencolado(s)` : ''}`,
      });
    } catch (error: any) {
      setFormError(error?.message || 'No se pudo mover el stock.');
    } finally {
      setSubmitting(false);
    }
  };

  const requeueNow = async () => {
    if (!jobId) return;
    try {
      const response = await api.stockJobsRequeue([jobId]);
      setResult((current) => (current
        ? { ...current, requeued: response.requeued, skipped: response.skipped }
        : current));
      await queryClient.invalidateQueries({ queryKey: ['stock-jobs'] });
      showSnackbar({ message: 'Descuento reencolado.' });
    } catch (error: any) {
      showSnackbar({ message: error?.message || 'No se pudo reintentar.', tone: 'error' });
    }
  };

  const target = shortage?.lines.find((line) => line.orderItemId === shortage.selectedOrderItemId)?.product ?? null;
  const targetInventory = shortage?.lines.find((line) => line.orderItemId === shortage.selectedOrderItemId)?.inventory ?? null;
  const committedWarning = preview?.requiresAcknowledgeCommitted === true;
  const previewErrors = preview?.errors ?? [];
  const canSubmit = Boolean(sourceId && targetProductId && validQuantity && !previewErrors.length && (!committedWarning || ack) && !submitting);

  const headerCompany = shortage?.order.companyName || job?.company || null;
  const headerChannel = shortage?.order.channelCode || job?.channel_code || null;
  const headerOrderNumber = shortage?.order.orderNumber || job?.order_number || null;

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) reset(); onOpenChange(next); }}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-[680px]">
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="text-base">Mover stock · Orden {headerOrderNumber || jobId || ''}</SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {headerCompany ? <span className="font-medium text-foreground">{sellerShortName(headerCompany)}</span> : null}
            {headerChannel ? (
              <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium', logisticsChannelClass(headerChannel))}>
                {stockJobChannelLabel(headerChannel)}
              </span>
            ) : null}
            <span className="text-muted-foreground">Mueve unidades desde otro producto maestro y reintenta el descuento.</span>
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {shortageQuery.isLoading ? (
            <div className="space-y-3 p-5">
              <div className="h-4 w-40 animate-pulse rounded bg-muted" />
              <div className="h-24 animate-pulse rounded bg-muted" />
              <div className="h-40 animate-pulse rounded bg-muted" />
            </div>
          ) : shortageQuery.isError ? (
            <div className="m-5 flex gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{(shortageQuery.error as any)?.message || 'No se pudo cargar el diagnóstico.'}</span>
            </div>
          ) : result ? (
            <div className="space-y-4 p-5">
              <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-emerald-800">
                    Stock movido · <span className="font-mono">{result.transfer.code}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-emerald-800/90">
                    {result.transfer.quantity} u de {result.transfer.source?.mainSku || 'origen'} → {result.transfer.target?.mainSku || 'destino'}
                    {' · '}{fullDateTime(result.transfer.createdAt)}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pedidos reencolados</p>
                {result.requeued.length ? (
                  <div className="mt-2 divide-y divide-border rounded-md border border-border">
                    {result.requeued.map((entry) => {
                      const status = liveStatus.get(entry.jobId) || entry.status;
                      return (
                        <div key={entry.jobId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                          <span className="font-mono text-xs">{entry.orderNumber || entry.jobId}</span>
                          <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', statusBadgeClass(status))}>
                            {status === 'pending' || status === 'processing' ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                            {JOB_STATUS_LABELS[status] || status}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
                    <span className="text-muted-foreground">El stock se movió; el descuento sigue esperando.</span>
                    <Button size="sm" variant="outline" onClick={requeueNow}>
                      Reintentar ahora
                    </Button>
                  </div>
                )}
                {result.skipped.length ? (
                  <p className="mt-2 text-xs text-amber-700">
                    No se reintentó: {result.skipped.map((entry) => entry.jobId).join(', ')}.
                  </p>
                ) : null}
              </div>
            </div>
          ) : !shortage ? null : shortage.lines.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <CheckCircle2 className="size-8 text-muted-foreground/50" />
              <p className="text-sm font-medium">Esta orden ya no tiene líneas sin stock.</p>
              <p className="text-sm text-muted-foreground">Actualiza la cola para ver su estado actual.</p>
            </div>
          ) : (
            <div className="space-y-5 p-5">
              {/* Diagnóstico */}
              <section className="space-y-3">
                {shortage.lines.length > 1 ? (
                  <div className="max-w-sm">
                    <Label htmlFor="stock-transfer-line" className="text-xs">Línea a resolver</Label>
                    <Select value={String(shortage.selectedOrderItemId)} onValueChange={(value) => setLineItemId(Number(value))}>
                      <SelectTrigger id="stock-transfer-line" className="mt-1 h-9 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {shortage.lines.map((line, index) => (
                          <SelectItem key={line.orderItemId} value={String(line.orderItemId)}>
                            {(line.product?.mainSku || line.sellerSku || `Línea ${index + 1}`)} · faltan {line.missing} u
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                {selectedLine ? (
                  <div className="flex items-start gap-3">
                    <div className="h-11 w-11 shrink-0 overflow-hidden rounded-md bg-muted">
                      {productImageSrc(selectedLine.product?.imageUrl) ? (
                        <img
                          src={productImageSrc(selectedLine.product?.imageUrl) || undefined}
                          alt={`Foto de ${selectedLine.product?.title || 'producto'}`}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center">
                          <PackageMinus className="h-4 w-4 text-muted-foreground" />
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">{selectedLine.product?.title || 'Producto sin nombre'}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {selectedLine.product?.mainSku ? (
                          <span>SKU interno <CopyableCode value={selectedLine.product.mainSku} label="SKU interno" /></span>
                        ) : null}
                        {selectedLine.sellerSku ? <span>SKU del seller <span className="font-mono text-foreground">{selectedLine.sellerSku}</span></span> : null}
                        {selectedLine.shopSku ? <span>Shop SKU <span className="font-mono text-foreground">{selectedLine.shopSku}</span></span> : null}
                      </div>
                    </div>
                  </div>
                ) : null}
                <div className="flex divide-x divide-border overflow-hidden rounded-md border border-border">
                  <NumberCell label="Requerido" value={selectedLine?.missing ?? 0} />
                  <NumberCell label="Físico" value={selectedLine?.inventory?.onHand ?? 0} />
                  <NumberCell label="Reservado" value={selectedLine?.inventory?.reserved ?? 0} />
                  <NumberCell label="En devolución" value={selectedLine?.inventory?.pendingReturn ?? 0} />
                  <NumberCell label="Disponible" value={selectedLine?.inventory?.available ?? 0} tone={(selectedLine?.inventory?.available ?? 0) <= 0 ? 'danger' : undefined} />
                </div>
                <p className="text-sm text-foreground">
                  Faltan <span className="font-semibold tabular-nums">{selectedLine?.missing ?? 0} u</span> en{' '}
                  <span className="font-mono">{selectedLine?.product?.mainSku || 'el producto'}</span>
                  {shortage.missingForProduct > (selectedLine?.missing ?? 0)
                    ? <> · <span className="font-semibold tabular-nums">{shortage.missingForProduct} u</span> para todos los pedidos que esperan este producto.</>
                    : '.'}
                </p>
                {shortage.waiting.length ? (
                  <div className="overflow-hidden rounded-md border border-border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/40 text-left text-muted-foreground">
                        <tr>
                          <th className="px-3 py-1.5 font-medium">Orden</th>
                          <th className="px-3 py-1.5 font-medium">Seller</th>
                          <th className="px-3 py-1.5 font-medium">Cant.</th>
                          <th className="px-3 py-1.5 font-medium">Estado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/70">
                        {shortage.waiting.slice(0, 5).map((entry) => (
                          <tr key={entry.jobId} className={entry.jobId === jobId ? 'bg-accent/30' : undefined}>
                            <td className="px-3 py-1.5 font-mono">
                              {entry.orderNumber || entry.jobId}
                              {entry.jobId === jobId ? <span className="ml-1.5 rounded bg-muted px-1 text-[10px] text-muted-foreground">Este</span> : null}
                            </td>
                            <td className="px-3 py-1.5">{sellerShortName(entry.companyName) || '-'}</td>
                            <td className="px-3 py-1.5 tabular-nums">{entry.missing}</td>
                            <td className="px-3 py-1.5">
                              <span className={cn('inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-medium', statusBadgeClass(entry.status))}>
                                {JOB_STATUS_LABELS[entry.status] || entry.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {shortage.waiting.length > 5 ? (
                      <p className="border-t border-border/70 px-3 py-1.5 text-[11px] text-muted-foreground">
                        +{shortage.waiting.length - 5} pedido(s) más esperando este producto.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </section>

              {/* Origen */}
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">1 · Producto de origen</h3>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Buscar por SKU interno, SKU del seller o nombre"
                    className="pl-9"
                    aria-label="Buscar producto de origen"
                  />
                </div>
                {candidatesQuery.isLoading ? (
                  <div className="h-20 animate-pulse rounded-md bg-muted" />
                ) : candidates.length === 0 ? (
                  <div className="rounded-md border border-border px-3 py-6 text-center">
                    <p className="text-sm font-medium">No encontramos otro producto con stock para {selectedLine?.product?.mainSku || 'este producto'}.</p>
                    <p className="mt-1 text-xs text-muted-foreground">Busca por SKU o nombre del producto donde están las unidades.</p>
                  </div>
                ) : (
                  <div role="radiogroup" aria-label="Producto de origen" className="divide-y divide-border overflow-hidden rounded-md border border-border">
                    {candidates.map((candidate) => {
                      const selected = candidate.productId === sourceId;
                      return (
                        <button
                          key={candidate.productId}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          disabled={!candidate.selectable}
                          onClick={() => { setSourceId(candidate.productId); setAck(false); }}
                          className={cn(
                            'flex w-full items-center gap-3 px-3 py-2.5 text-left transition',
                            candidate.selectable ? 'hover:bg-accent/40' : 'cursor-not-allowed opacity-55',
                            selected && 'bg-accent/60',
                          )}
                        >
                          <span className={cn(
                            'grid h-4 w-4 shrink-0 place-items-center rounded-full border',
                            selected ? 'border-foreground bg-foreground' : 'border-border',
                          )}>
                            {selected ? <Check className="h-3 w-3 text-background" /> : null}
                          </span>
                          <span className="h-9 w-9 shrink-0 overflow-hidden rounded-md bg-muted">
                            {productImageSrc(candidate.imageUrl) ? (
                              <img src={productImageSrc(candidate.imageUrl) || undefined} alt="" className="h-full w-full object-cover" loading="lazy" />
                            ) : (
                              <span className="flex h-full w-full items-center justify-center"><PackageMinus className="h-3.5 w-3.5 text-muted-foreground" /></span>
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-foreground">{candidate.title || 'Producto sin nombre'}</span>
                            <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                              {candidate.mainSku ? <span className="font-mono text-foreground">{candidate.mainSku}</span> : null}
                              {candidate.reasons.map((reason) => (
                                <Badge key={reason.kind} variant="outline" className="border-border bg-muted text-[10px] font-medium text-muted-foreground">
                                  {reason.label}
                                </Badge>
                              ))}
                              {candidate.committed.units > 0 ? (
                                <span className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                                  <AlertTriangle className="h-3 w-3" />
                                  {candidate.committed.units} comprometidas
                                </span>
                              ) : null}
                            </span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className={cn('block text-sm font-semibold tabular-nums', candidate.inventory.available > 0 ? 'text-foreground' : 'text-muted-foreground')}>
                              {candidate.inventory.available}
                            </span>
                            <span className="block text-[10px] text-muted-foreground">disponibles</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Cantidad y motivo */}
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">2 · Cantidad y motivo</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="stock-transfer-quantity" className="text-xs">Unidades a mover</Label>
                    <div className="mt-1 flex items-center gap-2">
                      <Input
                        id="stock-transfer-quantity"
                        type="number"
                        min={1}
                        value={quantity}
                        onChange={(event) => setQuantity(event.target.value)}
                        className="w-24"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setQuantity(String(Math.max(selectedLine?.missing ?? 1, 1)))}
                      >
                        Cubrir este pedido ({selectedLine?.missing ?? 1})
                      </Button>
                      {preview && preview.source.availableBefore > 0 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setQuantity(String(Math.max(Math.min(shortage.missingForProduct, preview.source.availableBefore), 1)))}
                        >
                          Cubrir todos ({Math.min(shortage.missingForProduct, preview.source.availableBefore)})
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="stock-transfer-reason" className="text-xs">Motivo</Label>
                    <Select value={reasonCode} onValueChange={setReasonCode}>
                      <SelectTrigger id="stock-transfer-reason" className="mt-1 h-9 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {REASONS.map((reason) => (
                          <SelectItem key={reason.value} value={reason.value}>{reason.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label htmlFor="stock-transfer-note" className="text-xs">
                    Nota {reasonCode === 'other' ? '(obligatoria)' : '(opcional)'}
                  </Label>
                  <Input
                    id="stock-transfer-note"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Ej.: misma pieza importada por YAKURUNA"
                    maxLength={500}
                    className="mt-1"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={retry} onCheckedChange={(value) => setRetry(value === true)} />
                  Reintentar los pedidos cubiertos al confirmar
                </label>
              </section>

              {/* Efecto */}
              {sourceId && validQuantity ? (
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">3 · Efecto</h3>
                  {previewQuery.isFetching && !preview ? (
                    <div className="h-20 animate-pulse rounded-md bg-muted" />
                  ) : preview ? (
                    <>
                      <div className="overflow-hidden rounded-md border border-border">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                            <tr>
                              <th className="px-3 py-1.5 font-medium">Producto</th>
                              <th className="px-3 py-1.5 text-right font-medium">Disponible antes</th>
                              <th className="px-3 py-1.5 text-right font-medium">Movimiento</th>
                              <th className="px-3 py-1.5 text-right font-medium">Disponible después</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/70">
                            <tr>
                              <td className="px-3 py-1.5">
                                Origen <span className="font-mono text-xs">{preview.source.mainSku || '—'}</span>
                              </td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{preview.source.availableBefore}</td>
                              <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-red-600">−{quantityNumber}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{preview.source.availableAfter}</td>
                            </tr>
                            <tr>
                              <td className="px-3 py-1.5">
                                Destino <span className="font-mono text-xs">{preview.target.mainSku || '—'}</span>
                              </td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{preview.target.availableBefore}</td>
                              <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-emerald-600">+{quantityNumber}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{preview.target.availableAfter}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      <p className="text-sm text-foreground">
                        {preview.covered.length
                          ? <>Cubre <span className="font-semibold">{preview.covered.length}</span> de {preview.covered.length + preview.uncovered.length} pedidos que esperan {preview.target.mainSku}: {preview.covered.map((entry) => entry.orderNumber || entry.jobId).join(', ')}.</>
                          : <>No cubre ningún pedido todavía: faltan unidades en el destino.</>}
                        {preview.uncovered.length ? <span className="text-muted-foreground"> {preview.uncovered.length} seguirán en Requiere atención.</span> : null}
                      </p>
                      {previewErrors.length ? (
                        <div className="flex gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>{previewErrors.map((error) => error.message).join(' ')}</span>
                        </div>
                      ) : null}
                      {committedWarning ? (
                        <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
                          <p className="flex gap-2">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span>
                              {preview.source.mainSku || 'El origen'} tiene {preview.source.committedUnits} u comprometidas por otros pedidos
                              {preview.source.committedJobs.length ? ` (${preview.source.committedJobs.map((entry) => entry.orderNumber || entry.jobId).join(', ')})` : ''}.
                              Si mueves {quantityNumber} u, esos pedidos quedarán sin stock.
                            </span>
                          </p>
                          <label className="flex items-center gap-2 font-medium">
                            <Checkbox checked={ack} onCheckedChange={(value) => setAck(value === true)} />
                            Entiendo, mover de todas formas
                          </label>
                        </div>
                      ) : null}
                      {preview.target.availableBefore > 0 && preview.target.missingBefore === 0 ? (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                          <span>{(preview.target.mainSku || 'El producto')} ya tiene stock suficiente. Reintenta sin mover.</span>
                          <Button size="sm" variant="outline" onClick={requeueNow}>Reintentar ahora</Button>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </section>
              ) : null}
            </div>
          )}
        </div>

        {!result && shortage && shortage.lines.length > 0 ? (
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={openConfirm} disabled={!canSubmit}>
              <ArrowRightLeft className="h-4 w-4" />
              {retry ? `Mover ${validQuantity ? quantityNumber : 0} u y reintentar` : `Mover ${validQuantity ? quantityNumber : 0} u`}
            </Button>
          </div>
        ) : null}
        {result ? (
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            <Button onClick={() => onOpenChange(false)}>Cerrar</Button>
          </div>
        ) : null}
      </SheetContent>

      <Dialog open={confirmOpen} onOpenChange={(next) => { if (!submitting) setConfirmOpen(next); }}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>¿Mover {validQuantity ? quantityNumber : 0} u de {preview?.source.mainSku || 'origen'} a {preview?.target.mainSku || 'destino'}?</DialogTitle>
            <DialogDescription>
              {preview
                ? `${preview.source.mainSku} · ${preview.source.availableBefore} → ${preview.source.availableAfter} disponibles · ${preview.target.mainSku} · ${preview.target.availableBefore} → ${preview.target.availableAfter} disponibles`
                : 'Revisa el efecto antes de confirmar.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            {retry && preview?.covered.length ? (
              <p>Se reintentará: <span className="font-mono text-xs">{preview.covered.map((entry) => entry.orderNumber || entry.jobId).join(', ')}</span></p>
            ) : null}
            <p>Motivo: {REASONS.find((reason) => reason.value === reasonCode)?.label || reasonCode}{note.trim() ? ` · ${note.trim()}` : ''}</p>
            <p className="text-xs text-muted-foreground">
              Este movimiento queda registrado a tu nombre en ambos productos. No cambia publicaciones ni stock en Falabella, Ripley o Mercado Libre.
            </p>
            {formError ? (
              <div className="flex gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{formError}</span>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={submitting}>Volver</Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Confirmar movimiento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sheet>
  );
}
