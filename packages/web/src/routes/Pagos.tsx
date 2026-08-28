import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Search, Upload } from 'lucide-react';
import api from '../lib/api';
import {
  chargeKindLabel,
  decodeSettlementCsv,
  documentLabel,
  holdAtLeast,
  CSV_UPLOAD_MIN_MS,
  importSummary,
  money,
  paymentStatusLabel,
  percentLabel,
  saleDateLabel,
  saleOverview,
  shortImportFilename,
  shortProductName,
  skuLabel,
  unitsLabel,
} from '../lib/pagos-presentation';
import { cn } from '@/lib/utils';
import { WorkLoader, WorkLoaderMark } from '@/components/WorkLoader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TablePanel,
  TableRow,
} from '@/components/ui/table';

type SettlementProduct = {
  sku?: string;
  shopSku?: string;
  productName?: string;
  quantity: number;
  bruto: number;
  commission: number;
  shipping: number;
  neto: number;
  take: number;
  unitBruto: number;
  unitCommission: number;
  unitShipping: number;
  unitNeto: number;
  commissionRate: number | null;
  shippingRate: number | null;
  takeRate: number | null;
};

type SettlementChargeGroup = {
  type: string;
  kind: string;
  count: number;
  amount: number;
  unitAmount: number | null;
};

type SettlementSale = {
  orderId: string;
  date?: string | null;
  paid: boolean;
  paymentStatus?: string;
  matched?: boolean;
  productName?: string;
  skus?: string[];
  itemCount?: number;
  bruto: number;
  commission: number;
  shipping: number;
  buyerShipping?: number;
  buyerShippingPaid?: number;
  buyerShippingReversed?: number;
  neto: number;
  take: number;
  commissionRate: number | null;
  shippingRate: number | null;
  takeRate: number | null;
  products?: SettlementProduct[];
  chargeGroups?: SettlementChargeGroup[];
  document?: {
    kind?: string | null;
    number?: string | null;
    status?: string | null;
  } | null;
};

type SettlementImport = {
  id: number;
  filename: string;
  importedAt?: string;
  matchedCount: number;
  unmatchedCount: number;
  paidSalesCount: number;
};

const cobroCol = 'bg-muted/40';
const cobroColStart = `${cobroCol} border-l border-border`;
const cobroColEnd = `${cobroCol} border-r border-border`;
const llegaCol = 'border-l border-emerald-600/15 bg-emerald-500/[0.08]';
const llegaText = 'text-emerald-700 dark:text-emerald-400';
const takeText = 'text-red-600 dark:text-red-400';

function CopyableId({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <button
      type="button"
      title={copied ? 'Copiado' : label}
      aria-label={`${label} ${value}`}
      className="inline-flex size-6 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
      onClick={async (event) => {
        event.stopPropagation();
        await navigator.clipboard.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      }}
    >
      {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

function SalePreviewCard({ sale }: { sale: SettlementSale }) {
  return (
    <div className="w-64 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-xl">
      <p className="font-mono text-sm font-semibold text-foreground">{sale.orderId}</p>
      <p className="mt-2 text-lg font-semibold tabular-nums tracking-tight">{money.format(sale.bruto || 0)}</p>
      <p className="text-xs text-muted-foreground">Total de la venta</p>
      <p className="mt-3 text-xs text-foreground">{documentLabel(sale.document)}</p>
    </div>
  );
}

function SaleOrderHover({ sale }: { sale: SettlementSale }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const timerRef = useRef<number | null>(null);

  const show = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setPosition({
        top: Math.min(rect.bottom + 10, window.innerHeight - 180),
        left: Math.min(rect.left, window.innerWidth - 280),
      });
    }
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setOpen(true), 80);
  };

  const hide = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setOpen(false), 160);
  };

  return (
    <div className="flex items-center gap-0.5" onClick={(event) => event.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="rounded px-1 py-0.5 font-mono text-xs text-foreground underline decoration-border underline-offset-4 transition hover:bg-accent hover:decoration-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
      >
        {sale.orderId}
      </button>
      <CopyableId value={sale.orderId} label="Copiar pedido" />
      {open && createPortal(
        <div
          className="fixed z-[1000]"
          style={{ top: position.top, left: Math.max(12, position.left) }}
          onMouseEnter={show}
          onMouseLeave={hide}
        >
          <SalePreviewCard sale={sale} />
        </div>,
        document.body,
      )}
    </div>
  );
}

function ColumnHead({
  label,
  hint,
  className,
  rowSpan,
}: {
  label: string;
  hint?: string;
  className?: string;
  rowSpan?: number;
}) {
  return (
    <TableHead rowSpan={rowSpan} className={cn('h-auto whitespace-normal py-2', className)} title={hint}>
      <span className="block">{label}</span>
      {hint ? <span className="mt-0.5 block text-[11px] font-normal leading-tight">{hint}</span> : null}
    </TableHead>
  );
}

function AmountRate({
  amount,
  rate,
  tone,
}: {
  amount: number;
  rate?: number | null;
  tone?: 'take' | 'receive';
}) {
  return (
    <div className={cn(
      'text-right',
      tone === 'take' && takeText,
      tone === 'receive' && llegaText,
    )}
    >
      <p className={cn('tabular-nums', tone === 'receive' && 'font-medium')}>{money.format(amount)}</p>
      <p className={cn('text-xs tabular-nums', tone ? 'opacity-80' : 'text-muted-foreground')}>{percentLabel(rate)}</p>
    </div>
  );
}

function ChargeRow({
  label,
  amount,
  hint,
  rate,
  strong = false,
  tone,
}: {
  label: string;
  amount: number;
  hint?: string;
  rate?: number | null;
  strong?: boolean;
  tone?: 'take' | 'receive';
}) {
  const details = [
    hint,
    rate != null ? `${percentLabel(rate)} del precio` : '',
  ].filter(Boolean);
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className={cn('text-sm', strong ? 'font-medium' : 'text-foreground')}>{label}</p>
        {details.map((line) => (
          <p key={line} className="text-xs text-muted-foreground">{line}</p>
        ))}
      </div>
      <p className={cn(
        'shrink-0 tabular-nums text-sm',
        strong && 'font-medium',
        tone === 'take' && takeText,
        tone === 'receive' && llegaText,
      )}
      >
        {money.format(amount)}
      </p>
    </div>
  );
}

function receiveRate(bruto: number | null | undefined, neto: number | null | undefined) {
  if (!bruto) return null;
  return Number(neto || 0) / Number(bruto);
}

function saleTitle(sale: SettlementSale) {
  return shortProductName(sale.productName) || skuLabel(sale.skus) || sale.orderId;
}

function saleSubtitle(sale: SettlementSale) {
  const products = sale.products || [];
  const parts = [`Pedido ${sale.orderId}`];
  if (products.length === 1 && products[0].quantity > 1) {
    parts.push(`${products[0].quantity} iguales`);
  } else if ((sale.itemCount || 0) > 1) {
    parts.push(`${sale.itemCount} u`);
  }
  const date = saleDateLabel(sale.date);
  if (date) parts.push(date);
  return parts.join(' · ');
}

function shippingHint(sale: SettlementSale) {
  const products = sale.products || [];
  if (products.length === 1 && products[0].quantity > 1 && products[0].unitShipping) {
    return `${money.format(products[0].unitShipping)} × ${products[0].quantity} unidades`;
  }
  return 'Cofinanciamiento. Lo cobra Falabella.';
}

function hasBuyerShipping(sale: SettlementSale) {
  return Boolean(
    Number(sale.buyerShippingPaid || 0)
    || Number(sale.buyerShippingReversed || 0)
    || Number(sale.buyerShipping || 0),
  );
}

function chargeTimes(group: SettlementChargeGroup) {
  if (group.count > 1 && group.unitAmount != null) {
    return `${group.count} × ${money.format(Math.abs(group.unitAmount))}`;
  }
  if (group.count > 1) return `${group.count} movimientos`;
  return '';
}

export default function Pagos() {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [paid, setPaid] = useState<'all' | 'pagado' | 'no-pagado'>('all');
  const [importId, setImportId] = useState<'all' | string>('all');
  const [selected, setSelected] = useState<SettlementSale | null>(null);
  const [notice, setNotice] = useState('');
  const [noticeReused, setNoticeReused] = useState(false);
  const [error, setError] = useState('');
  const [readingName, setReadingName] = useState('');
  const reading = Boolean(readingName);

  const importsQuery = useQuery({
    queryKey: ['pagos-imports'],
    queryFn: () => api.listSettlementImports({ limit: 20 }),
    placeholderData: keepPreviousData,
  });
  const salesQuery = useQuery({
    queryKey: ['pagos-sales', search, paid, importId],
    queryFn: () => api.listSettlementSales({
      search: search.trim() || undefined,
      paid: paid === 'all' ? undefined : paid,
      importId: importId === 'all' ? undefined : Number(importId),
      limit: 100,
    }),
    placeholderData: keepPreviousData,
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const started = Date.now();
      try {
        const csv = decodeSettlementCsv(await file.arrayBuffer());
        const result = await api.importSettlementCsv({ filename: file.name, csv });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['pagos-imports'] }),
          queryClient.invalidateQueries({ queryKey: ['pagos-sales'] }),
          queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        ]);
        return result;
      } finally {
        await holdAtLeast(started, CSV_UPLOAD_MIN_MS);
      }
    },
    onSuccess: (result) => {
      setError('');
      setNoticeReused(Boolean(result.reused));
      setNotice(importSummary(result));
    },
    onError: (nextError) => {
      setNotice('');
      setNoticeReused(false);
      setError((nextError as Error).message || 'No se pudo leer el CSV.');
    },
    onSettled: () => {
      setReadingName('');
    },
  });

  const imports = (importsQuery.data?.items || []) as SettlementImport[];
  const sales = (salesQuery.data?.items || []) as SettlementSale[];
  const summary = salesQuery.data?.summary;
  const overview = saleOverview(summary);

  return (
    <div className="space-y-4 pb-8">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Pedido, SKU o producto"
            aria-label="Buscar venta"
            className="pl-8"
          />
        </div>
        <Select value={paid} onValueChange={(value) => setPaid(value as 'all' | 'pagado' | 'no-pagado')}>
          <SelectTrigger className="w-36" aria-label="Estado de pago">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="pagado">Pagadas</SelectItem>
            <SelectItem value="no-pagado">No pagadas</SelectItem>
          </SelectContent>
        </Select>
        <Select value={importId} onValueChange={setImportId}>
          <SelectTrigger className="w-52" aria-label="Archivo de liquidación">
            <SelectValue placeholder="Todos los archivos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los archivos</SelectItem>
            {imports.map((item) => (
              <SelectItem key={item.id} value={String(item.id)}>{shortImportFilename(item.filename)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            setError('');
            setNotice('');
            setNoticeReused(false);
            setReadingName(file.name);
            upload.mutate(file);
          }}
        />
        <Button
          type="button"
          disabled={reading}
          onClick={() => {
            const input = fileInput.current;
            if (!input || reading) return;
            input.value = '';
            input.click();
          }}
        >
          {reading ? <WorkLoaderMark data-icon="inline-start" /> : <Upload data-icon="inline-start" />}
          {reading ? 'Leyendo CSV' : 'Subir CSV'}
        </Button>
      </div>

      {reading ? (
        <WorkLoader
          key={readingName}
          label="Leyendo CSV"
          detail={shortImportFilename(readingName)}
        />
      ) : (
        <>
          {notice ? (
            <p className={cn(
              'text-sm',
              noticeReused ? 'text-amber-800 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400',
            )}
            >
              {notice}
            </p>
          ) : null}
          {overview ? <p className="text-sm text-muted-foreground">{overview}</p> : null}
        </>
      )}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <TablePanel aria-busy={reading} aria-label="Cobros de Falabella por venta">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead rowSpan={2} className="align-bottom">Pedido</TableHead>
              <TableHead rowSpan={2} className="align-bottom">Producto</TableHead>
              <TableHead rowSpan={2} className="align-bottom">SKU</TableHead>
              <TableHead rowSpan={2} className="align-bottom">Pago</TableHead>
              <ColumnHead rowSpan={2} className="align-bottom text-right" label="Precio" hint="Lo que pagó el cliente" />
              <TableHead colSpan={3} className={cn('h-8 py-1.5 text-center', cobroColStart, cobroColEnd)}>
                <span className="block text-[13px] text-foreground">Falabella cobra</span>
                <span className="block text-[11px] font-normal leading-tight">Comisión + logística</span>
              </TableHead>
              <ColumnHead rowSpan={2} className={cn('align-bottom text-right', llegaCol, llegaText)} label="Te llega" hint="Lo que te depositan" />
            </TableRow>
            <TableRow>
              <ColumnHead className={cn('text-right', cobroColStart)} label="Comisión" hint="% del precio" />
              <ColumnHead className={cn('text-right', cobroCol)} label="Logística" hint="Cofinanciamiento" />
              <ColumnHead className={cn('text-right', cobroColEnd)} label="Se queda" hint="Suma de los dos" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sales.map((sale) => (
              <TableRow
                key={sale.orderId}
                className="cursor-pointer"
                tabIndex={0}
                onClick={() => setSelected(sale)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelected(sale);
                  }
                }}
              >
                <TableCell>
                  <SaleOrderHover sale={sale} />
                </TableCell>
                <TableCell className="max-w-[11rem] whitespace-normal">
                  <p className="line-clamp-1 font-medium leading-5" title={sale.productName || undefined}>
                    {saleTitle(sale)}
                  </p>
                </TableCell>
                <TableCell>
                  <p className="font-mono text-xs">{skuLabel(sale.skus) || '—'}</p>
                  {unitsLabel(sale.itemCount) ? (
                    <p className="text-xs text-muted-foreground">{unitsLabel(sale.itemCount)}</p>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Badge variant={sale.paid ? 'secondary' : 'outline'} className={sale.paid ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : ''}>
                    {paymentStatusLabel(sale.paymentStatus)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{money.format(sale.bruto || 0)}</TableCell>
                <TableCell className={cobroColStart}><AmountRate amount={sale.commission || 0} rate={sale.commissionRate} /></TableCell>
                <TableCell className={cobroCol}><AmountRate amount={sale.shipping || 0} rate={sale.shippingRate} /></TableCell>
                <TableCell className={cobroColEnd}><AmountRate amount={sale.take || 0} rate={sale.takeRate} tone="take" /></TableCell>
                <TableCell className={llegaCol}>
                  <AmountRate amount={sale.neto || 0} rate={receiveRate(sale.bruto, sale.neto)} tone="receive" />
                </TableCell>
              </TableRow>
            ))}
            {!sales.length && !salesQuery.isLoading ? (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                  Sube un CSV de Falabella para ver comisión, logística y lo que te llega.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
          {summary?.saleCount ? (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={4} className="font-medium">Total · {summary.paidCount} pagadas</TableCell>
                <TableCell className="text-right tabular-nums">{money.format(summary.bruto || 0)}</TableCell>
                <TableCell className={cobroColStart}><AmountRate amount={summary.commission || 0} rate={summary.commissionRate} /></TableCell>
                <TableCell className={cobroCol}><AmountRate amount={summary.shipping || 0} rate={summary.shippingRate} /></TableCell>
                <TableCell className={cobroColEnd}><AmountRate amount={summary.take || 0} rate={summary.takeRate} tone="take" /></TableCell>
                <TableCell className={llegaCol}>
                  <AmountRate amount={summary.neto || 0} rate={receiveRate(summary.bruto, summary.neto)} tone="receive" />
                </TableCell>
              </TableRow>
            </TableFooter>
          ) : null}
        </Table>
      </TablePanel>

      <Sheet open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <SheetContent className="gap-0 overflow-y-auto sm:max-w-lg">
          {selected ? (
            <>
              <SheetHeader className="border-b border-border px-5 py-4 pr-12">
                <SheetTitle className="text-[17px] leading-tight" title={selected.productName || undefined}>
                  {saleTitle(selected)}
                </SheetTitle>
                <SheetDescription className="text-[13px] leading-snug">
                  {saleSubtitle(selected)}
                </SheetDescription>
              </SheetHeader>
              <div className="px-5 py-4">
                <ChargeRow label="Precio" amount={selected.bruto || 0} hint="Lo que pagó el cliente." />
                {hasBuyerShipping(selected) ? (
                  <p className="pb-2 text-xs text-muted-foreground">El envío lo pagó el cliente.</p>
                ) : null}
                <div className="-mx-5 border-y border-border bg-muted/40 px-5 py-1">
                  <p className="pt-2 text-xs font-medium">Falabella cobra</p>
                  <p className="text-[11px] text-muted-foreground">Comisión + logística</p>
                  <ChargeRow label="Comisión" amount={-(selected.commission || 0)} rate={selected.commissionRate} />
                  <ChargeRow label="Logística" amount={-(selected.shipping || 0)} hint={shippingHint(selected)} rate={selected.shippingRate} />
                  <ChargeRow
                    label="Se queda"
                    amount={selected.take || 0}
                    hint="Suma de los dos."
                    rate={selected.takeRate}
                    tone="take"
                    strong
                  />
                </div>
                <ChargeRow
                  label="Te llega"
                  amount={selected.neto || 0}
                  hint="Lo que te depositan."
                  rate={receiveRate(selected.bruto, selected.neto)}
                  tone="receive"
                  strong
                />
              </div>
              {(selected.products?.length || 0) > 1 || (selected.products?.[0]?.quantity || 0) > 1 ? (
                <div className="border-t border-border px-5 py-4">
                  <p className="text-sm font-medium">Por producto</p>
                  <div className="mt-2 divide-y divide-border">
                    {selected.products?.map((product) => (
                      <div key={`${product.sku}-${product.unitBruto}`} className="py-3">
                        <p className="font-medium leading-5" title={product.productName || undefined}>
                          {shortProductName(product.productName) || product.sku}
                        </p>
                        <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                          {product.sku || '—'}
                          {product.quantity > 1 ? ` · ${product.quantity} u` : ''}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {money.format(product.unitBruto)} c/u · comisión {percentLabel(product.commissionRate)} · logística {money.format(product.unitShipping)} c/u
                        </p>
                        <div className="mt-1 flex justify-between gap-3 text-sm">
                          <span className="tabular-nums text-muted-foreground">Se queda {percentLabel(product.takeRate)}</span>
                          <span className={cn('tabular-nums font-medium', llegaText)}>Te llega {money.format(product.unitNeto)} c/u</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {selected.chargeGroups?.some((group) => group.kind !== 'sale' && group.kind !== 'buyer_shipping') ? (
                <div className="border-t border-border px-5 py-4">
                  <p className="text-sm font-medium">Cobros Falabella</p>
                  <div className="mt-2 divide-y divide-border">
                    {selected.chargeGroups.filter((group) => group.kind !== 'sale' && group.kind !== 'buyer_shipping').map((group) => (
                      <div key={`${group.kind}-${group.type}`} className="flex items-baseline justify-between gap-3 py-2">
                        <div className="min-w-0">
                          <p className="text-sm leading-5">{chargeKindLabel(group.kind)}</p>
                          {chargeTimes(group) ? (
                            <p className="text-xs text-muted-foreground">{chargeTimes(group)}</p>
                          ) : null}
                        </div>
                        <p className="shrink-0 tabular-nums text-sm">{money.format(group.amount || 0)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
