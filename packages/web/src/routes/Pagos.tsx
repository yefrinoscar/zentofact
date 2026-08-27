import { useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Loader2, Search, Upload } from 'lucide-react';
import api from '../lib/api';
import {
  chargeKindLabel,
  decodeSettlementCsv,
  importSummary,
  money,
  paymentStatusLabel,
  percentLabel,
  saleDateLabel,
  saleOverview,
  shortProductName,
  skuLabel,
  unitsLabel,
} from '../lib/pagos-presentation';
import { cn } from '@/lib/utils';
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
  neto: number;
  take: number;
  commissionRate: number | null;
  shippingRate: number | null;
  takeRate: number | null;
  products?: SettlementProduct[];
  chargeGroups?: SettlementChargeGroup[];
};

type SettlementImport = {
  id: number;
  filename: string;
  importedAt?: string;
  matchedCount: number;
  unmatchedCount: number;
  paidSalesCount: number;
};

function CopyableId({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <button
      type="button"
      title={copied ? 'Copiado' : label}
      aria-label={`${label} ${value}`}
      className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
      onClick={async (event) => {
        event.stopPropagation();
        await navigator.clipboard.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      }}
    >
      {value}
      {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

function ColumnHead({
  label,
  hint,
  className,
}: {
  label: string;
  hint?: string;
  className?: string;
}) {
  return (
    <TableHead className={cn('h-auto whitespace-normal py-2', className)} title={hint}>
      <span className="block">{label}</span>
      {hint ? <span className="mt-0.5 block text-[11px] font-normal leading-tight">{hint}</span> : null}
    </TableHead>
  );
}

function AmountRate({
  amount,
  rate,
  warn = false,
}: {
  amount: number;
  rate?: number | null;
  warn?: boolean;
}) {
  return (
    <div className={cn('text-right', warn && 'text-red-600 dark:text-red-400')}>
      <p className="tabular-nums">{money.format(amount)}</p>
      <p className="text-xs tabular-nums text-muted-foreground">{percentLabel(rate)}</p>
    </div>
  );
}

function ChargeRow({
  label,
  amount,
  hint,
  rate,
  strong = false,
}: {
  label: string;
  amount: number;
  hint?: string;
  rate?: number | null;
  strong?: boolean;
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
      <p className={cn('shrink-0 tabular-nums text-sm', strong ? 'font-medium' : '')}>
        {money.format(amount)}
      </p>
    </div>
  );
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
  return 'Falabella te cobra por enviar.';
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
  const [error, setError] = useState('');

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
      const csv = decodeSettlementCsv(await file.arrayBuffer());
      return api.importSettlementCsv({ filename: file.name, csv });
    },
    onSuccess: async (result) => {
      setError('');
      setNotice(importSummary(result));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pagos-imports'] }),
        queryClient.invalidateQueries({ queryKey: ['pagos-sales'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
    },
    onError: (nextError) => {
      setNotice('');
      setError((nextError as Error).message || 'No se pudo leer el CSV.');
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
              <SelectItem key={item.id} value={String(item.id)}>{item.filename.replace(/^NewReportTransaction_/, '')}</SelectItem>
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
            if (file) upload.mutate(file);
          }}
        />
        <Button type="button" onClick={() => fileInput.current?.click()} disabled={upload.isPending}>
          {upload.isPending ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Upload data-icon="inline-start" />}
          Subir CSV
        </Button>
      </div>

      {overview ? <p className="text-sm text-muted-foreground">{overview}</p> : null}
      {notice ? <p className="text-sm text-emerald-700 dark:text-emerald-400">{notice}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <TablePanel aria-label="Cobros de Falabella por venta">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pedido</TableHead>
              <TableHead>Producto</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Pago</TableHead>
              <ColumnHead className="text-right" label="Precio" hint="Lo que pagó el cliente" />
              <ColumnHead className="text-right" label="Comisión" hint="% de Falabella" />
              <ColumnHead className="text-right" label="Cobro envío" hint="Te cobra Falabella" />
              <ColumnHead className="text-right" label="Te llega" hint="Lo que te depositan" />
              <ColumnHead className="text-right" label="Se queda" hint="Comisión más envío" />
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
                  <CopyableId value={sale.orderId} label="Copiar pedido" />
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
                <TableCell><AmountRate amount={sale.commission || 0} rate={sale.commissionRate} /></TableCell>
                <TableCell><AmountRate amount={sale.shipping || 0} rate={sale.shippingRate} /></TableCell>
                <TableCell className="text-right tabular-nums">{money.format(sale.neto || 0)}</TableCell>
                <TableCell>
                  <AmountRate amount={sale.take || 0} rate={sale.takeRate} warn={(sale.takeRate || 0) >= 0.4} />
                </TableCell>
              </TableRow>
            ))}
            {!sales.length && !salesQuery.isLoading ? (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                  Sube un CSV de Falabella para ver comisión, cobro de envío y lo que te llega.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
          {summary?.saleCount ? (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={4} className="font-medium">Total · {summary.paidCount} pagadas</TableCell>
                <TableCell className="text-right tabular-nums">{money.format(summary.bruto || 0)}</TableCell>
                <TableCell><AmountRate amount={summary.commission || 0} rate={summary.commissionRate} /></TableCell>
                <TableCell><AmountRate amount={summary.shipping || 0} rate={summary.shippingRate} /></TableCell>
                <TableCell className="text-right tabular-nums">{money.format(summary.neto || 0)}</TableCell>
                <TableCell><AmountRate amount={summary.take || 0} rate={summary.takeRate} /></TableCell>
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
                <ChargeRow label="Comisión" amount={-(selected.commission || 0)} rate={selected.commissionRate} />
                <ChargeRow label="Cobro envío" amount={-(selected.shipping || 0)} hint={shippingHint(selected)} rate={selected.shippingRate} />
                <ChargeRow label="Te llega" amount={selected.neto || 0} hint="Lo que te depositan." strong />
                <ChargeRow label="Se queda Falabella" amount={selected.take || 0} hint="Comisión más cobro de envío." rate={selected.takeRate} />
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
                          {money.format(product.unitBruto)} c/u · comisión {percentLabel(product.commissionRate)} · cobro envío {money.format(product.unitShipping)} c/u
                        </p>
                        <div className="mt-1 flex justify-between gap-3 text-sm">
                          <span>Te llega {money.format(product.unitNeto)} c/u</span>
                          <span className="tabular-nums">Se queda {percentLabel(product.takeRate)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {selected.chargeGroups?.length ? (
                <div className="border-t border-border px-5 py-4">
                  <p className="text-sm font-medium">Cobros Falabella</p>
                  <div className="mt-2 divide-y divide-border">
                    {selected.chargeGroups.map((group) => (
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
