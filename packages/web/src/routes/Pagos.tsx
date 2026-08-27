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
  saleOverview,
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
  charges?: Array<{ type: string; kind: string; amount: number; sku?: string }>;
  items?: Array<{
    itemId?: string;
    sku?: string;
    productName?: string;
    bruto: number;
    commission: number;
    shipping: number;
    neto: number;
    take: number;
    commissionRate: number | null;
    shippingRate: number | null;
    takeRate: number | null;
  }>;
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
      className="mt-0.5 inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
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
  rate,
  muted = false,
}: {
  label: string;
  amount: number;
  rate?: number | null;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className={cn('text-sm', muted ? 'text-muted-foreground' : 'font-medium')}>{label}</p>
        {rate != null ? <p className="text-xs text-muted-foreground">{percentLabel(rate)} del precio</p> : null}
      </div>
      <p className={cn('shrink-0 tabular-nums text-sm', muted ? 'text-muted-foreground' : 'font-medium')}>
        {money.format(amount)}
      </p>
    </div>
  );
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
              <TableHead>Venta</TableHead>
              <TableHead>Pago</TableHead>
              <TableHead className="text-right">Precio</TableHead>
              <TableHead className="text-right">Comisión</TableHead>
              <TableHead className="text-right">Envío</TableHead>
              <TableHead className="text-right">Neto</TableHead>
              <TableHead className="text-right">Falabella se queda</TableHead>
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
                <TableCell className="min-w-0">
                  <p className="line-clamp-2 font-medium leading-5">{sale.productName || sale.skus?.[0] || 'Venta Falabella'}</p>
                  <CopyableId value={sale.orderId} label="Copiar pedido" />
                  {sale.skus?.[0] ? (
                    <p className="font-mono text-xs text-muted-foreground">
                      {sale.skus.length > 1 ? `${sale.skus[0]} +${sale.skus.length - 1}` : sale.skus[0]}
                    </p>
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
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  Sube un CSV de Falabella para ver comisión, envío y lo que se queda por cada venta.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
          {summary?.saleCount ? (
            <TableFooter>
              <TableRow>
                <TableCell className="font-medium">Total</TableCell>
                <TableCell className="text-muted-foreground">{summary.paidCount} pagadas</TableCell>
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
                <SheetTitle className="text-[17px] leading-tight">{selected.productName || selected.orderId}</SheetTitle>
                <SheetDescription className="text-[13px] leading-snug">
                  Pedido {selected.orderId}
                  {selected.itemCount && selected.itemCount > 1 ? ` · ${selected.itemCount} ítems` : ''}
                  {selected.date ? ` · ${selected.date}` : ''}
                </SheetDescription>
              </SheetHeader>
              <div className="px-5 py-4">
                <ChargeRow label="Precio" amount={selected.bruto || 0} />
                <ChargeRow label="Comisión" amount={-(selected.commission || 0)} rate={selected.commissionRate} />
                <ChargeRow label="Envío" amount={-(selected.shipping || 0)} rate={selected.shippingRate} />
                {selected.buyerShipping ? <ChargeRow label="Envío comprador" amount={selected.buyerShipping} muted /> : null}
                <ChargeRow label="Neto a recibir" amount={selected.neto || 0} />
                <ChargeRow label="Falabella se queda" amount={selected.take || 0} rate={selected.takeRate} />
              </div>
              {selected.charges?.length ? (
                <div className="border-t border-border px-5 py-4">
                  <p className="text-sm font-medium">Movimientos</p>
                  <div className="mt-2 divide-y divide-border">
                    {selected.charges.map((charge, index) => (
                      <div key={`${charge.type}-${index}`} className="flex items-baseline justify-between gap-3 py-2">
                        <p className="min-w-0 text-sm leading-5">{charge.type || chargeKindLabel(charge.kind)}</p>
                        <p className="shrink-0 tabular-nums text-sm">{money.format(charge.amount || 0)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {selected.items && selected.items.length > 1 ? (
                <div className="border-t border-border px-5 py-4">
                  <p className="text-sm font-medium">Por ítem</p>
                  <div className="mt-2 divide-y divide-border">
                    {selected.items.map((item) => (
                      <div key={item.itemId || item.sku} className="py-2">
                        <p className="font-mono text-xs text-muted-foreground">{item.sku || item.itemId}</p>
                        <div className="mt-1 flex justify-between gap-3 text-sm">
                          <span>Comisión {percentLabel(item.commissionRate)} · envío {percentLabel(item.shippingRate)}</span>
                          <span className="tabular-nums">Se queda {percentLabel(item.takeRate)}</span>
                        </div>
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
