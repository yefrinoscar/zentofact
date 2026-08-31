import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { AlertCircle, Check, CheckCircle2, Copy, Info, Search, Upload, X } from 'lucide-react';
import api from '../lib/api';
import {
  PAGOS_COLUMN_COPY,
  PAGOS_SALES_PAGE,
  chargeKindLabel,
  csvReadError,
  documentLabel,
  holdAtLeast,
  CSV_UPLOAD_MIN_MS,
  SUCCESS_NOTICE_MS,
  importSummary,
  money,
  paymentStatusLabel,
  paymentStatusTone,
  percentLabel,
  productPhotoSrc,
  readSettlementUpload,
  reusedImportNotice,
  saleDateLabel,
  salesPageNote,
  shortProductName,
  skuLabel,
  teLlegaHint,
  unitsLabel,
} from '../lib/pagos-presentation';
import { cn } from '@/lib/utils';
import { OrdersVirtualTable } from '@/components/OrdersVirtualTable';
import { WorkLoaderMark } from '@/components/WorkLoader';
import { SettlementKpiStrip } from '@/components/SettlementCharts';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';

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
  returned?: boolean;
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

const cobroCol = 'bg-muted/40';
const cobroColStart = `${cobroCol} border-l border-border`;
const cobroColEnd = `${cobroCol} border-r border-border`;
const llegaCol = 'border-l border-emerald-600/15 bg-emerald-500/[0.08]';
const llegaText = 'text-emerald-700 dark:text-emerald-400';
const takeText = 'text-red-600 dark:text-red-400';
const cobroHead = `${cobroCol} text-muted-foreground`;
const cobroCell = `${cobroCol} group-hover:bg-muted/55`;
const cobroHeadStart = `${cobroColStart} text-muted-foreground`;
const cobroCellStart = `${cobroColStart} group-hover:bg-muted/55`;
const cobroHeadEnd = `${cobroColEnd} text-muted-foreground`;
const cobroCellEnd = `${cobroColEnd} group-hover:bg-muted/55`;
const llegaHead = `${llegaCol} ${llegaText}`;
const llegaCell = `${llegaCol} group-hover:bg-emerald-500/[0.12]`;

function SettlementAlert({
  tone,
  title,
  detail,
  action,
  onDismiss,
}: {
  tone: 'ok' | 'warn' | 'error';
  title: string;
  detail?: string;
  action?: { label: string; onClick: () => void; busy?: boolean };
  onDismiss?: () => void;
}) {
  const Icon = tone === 'error' ? AlertCircle : tone === 'ok' ? CheckCircle2 : Info;
  return (
    <Alert
      variant={tone === 'error' ? 'destructive' : 'default'}
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        tone === 'warn' && 'bg-amber-50 dark:bg-amber-950',
        tone === 'ok' && 'bg-emerald-50 dark:bg-emerald-950',
        action ? 'pr-36' : 'pr-14',
      )}
    >
      <Icon />
      <AlertTitle>{title}</AlertTitle>
      {detail ? <AlertDescription>{detail}</AlertDescription> : null}
      {onDismiss || action ? (
        <AlertAction className="flex items-center gap-1">
          {action ? (
            <Button type="button" size="sm" variant="outline" disabled={action.busy} onClick={action.onClick}>
              {action.busy ? <WorkLoaderMark data-icon="inline-start" /> : null}
              {action.busy ? 'Cruzando' : action.label}
            </Button>
          ) : null}
          {onDismiss ? (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="size-8 text-muted-foreground hover:text-foreground"
              aria-label="Cerrar aviso"
              onClick={onDismiss}
            >
              <X />
            </Button>
          ) : null}
        </AlertAction>
      ) : null}
    </Alert>
  );
}

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

function salePhotoInput(sale: SettlementSale) {
  const product = sale.products?.[0];
  return {
    shopSku: product?.shopSku,
    sku: product?.sku || sale.skus?.[0],
  };
}

function SaleProductPhoto({
  sale,
  className,
}: {
  sale: SettlementSale;
  className?: string;
}) {
  const [status, setStatus] = useState<'loading' | 'ok' | 'fail'>('loading');
  const src = productPhotoSrc(salePhotoInput(sale));
  if (!src || status === 'fail') return null;
  return (
    <div className={cn('relative overflow-hidden rounded-md bg-muted', className)}>
      {status === 'loading' ? (
        <span className="absolute inset-0 grid place-items-center text-muted-foreground">
          <WorkLoaderMark />
        </span>
      ) : null}
      <img
        src={src}
        alt=""
        className={cn('h-full w-full object-cover', status === 'loading' && 'opacity-0')}
        onLoad={() => setStatus('ok')}
        onError={() => setStatus('fail')}
      />
    </div>
  );
}

function SalePreviewCard({ sale }: { sale: SettlementSale }) {
  return (
    <div className="w-64 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-xl">
      <SaleProductPhoto sale={sale} className="mb-2 h-28 w-full" />
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
        top: Math.min(rect.bottom + 10, window.innerHeight - 280),
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
        className="rounded px-0.5 py-0 font-mono text-xs text-foreground underline decoration-border underline-offset-4 transition hover:bg-accent hover:decoration-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
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

function TwoLineHead({ label, hint }: { label: string; hint?: string }) {
  return (
    <span className="flex flex-col leading-tight">
      <span className="whitespace-nowrap">{label}</span>
      {hint ? <span className="whitespace-nowrap text-[10px] font-normal">{hint}</span> : null}
    </span>
  );
}

function amountToneClass(tone: 'take' | 'receive' | undefined, amount: number) {
  if (tone === 'take') return takeText;
  if (tone === 'receive') return amount < 0 ? takeText : llegaText;
  return undefined;
}

function PaymentStatusBadge({ status, returned }: { status?: string | null; returned?: boolean }) {
  const tone = paymentStatusTone(status, returned);
  const label = paymentStatusLabel(status, returned);
  const full = String(status || '').trim();
  const long = label.length > 12;
  return (
    <Badge
      variant="outline"
      title={tone === 'returned' ? 'Descontaron el producto y te devolvieron la comisión.' : full && full !== label ? full : undefined}
      className={cn(
        'h-5 min-w-0 px-1.5 text-[11px]',
        long ? 'max-w-full shrink truncate' : 'shrink-0',
        tone === 'paid' && 'border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
        tone === 'scheduled' && 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300',
        tone === 'returned' && 'border-zinc-300 bg-zinc-100 text-zinc-800 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200',
      )}
    >
      {label}
    </Badge>
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
      'text-right leading-tight',
      amountToneClass(tone, amount),
    )}
    >
      <p className={cn('tabular-nums text-[13px]', tone === 'receive' && 'font-medium')}>{money.format(amount)}</p>
      <p className={cn('text-[10px] tabular-nums', tone ? 'opacity-80' : 'text-muted-foreground')}>{percentLabel(rate)}</p>
    </div>
  );
}

type PagosNotice = {
  tone: 'ok' | 'warn' | 'error';
  title: string;
  detail?: string;
  canReplace?: boolean;
};

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
        amountToneClass(tone, amount),
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
  const [selected, setSelected] = useState<SettlementSale | null>(null);
  const [notice, setNotice] = useState<PagosNotice | null>(null);
  const [readingName, setReadingName] = useState('');
  const lastCsvRef = useRef<{ filename: string; csv: string } | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reading = Boolean(readingName);

  function clearNoticeTimer() {
    if (noticeTimer.current == null) return;
    clearTimeout(noticeTimer.current);
    noticeTimer.current = null;
  }

  function dismissNotice() {
    clearNoticeTimer();
    setNotice(null);
  }

  function showNotice(next: PagosNotice) {
    clearNoticeTimer();
    setNotice(next);
    if (next.tone !== 'ok') return;
    noticeTimer.current = setTimeout(() => {
      noticeTimer.current = null;
      setNotice(null);
    }, SUCCESS_NOTICE_MS);
  }

  const salesQuery = useQuery({
    queryKey: ['pagos-sales', search, paid],
    queryFn: () => api.listSettlementSales({
      search: search.trim() || undefined,
      paid: paid === 'all' ? undefined : paid,
      limit: PAGOS_SALES_PAGE,
    }),
    placeholderData: keepPreviousData,
  });

  const upload = useMutation({
    mutationFn: async ({ file, replace }: { file?: File; replace?: boolean }) => {
      const started = Date.now();
      try {
        let filename = file?.name || lastCsvRef.current?.filename || '';
        let csv = lastCsvRef.current?.csv || '';
        if (file) {
          csv = await readSettlementUpload(file);
          filename = file.name;
          lastCsvRef.current = { filename, csv };
        }
        if (!csv || !filename) throw new Error('No hay archivo para subir.');
        const result = await api.importSettlementCsv({
          filename,
          csv,
          replace: Boolean(replace),
        });
        if (!result.reused) {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['pagos-imports'] }),
            queryClient.invalidateQueries({ queryKey: ['pagos-sales'] }),
            queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
          ]);
        }
        return result;
      } finally {
        if (!replace) await holdAtLeast(started, CSV_UPLOAD_MIN_MS);
      }
    },
    onSuccess: (result) => {
      if (result.reused) {
        const copy = reusedImportNotice(result);
        showNotice({
          tone: 'warn',
          title: copy.title,
          detail: copy.detail,
          canReplace: true,
        });
        return;
      }
      showNotice({
        tone: 'ok',
        title: result.replaced ? 'Se volvió a cruzar' : 'Archivo cruzado',
        detail: importSummary({ ...result, reused: false, replaced: false }),
      });
    },
    onError: (nextError) => {
      const copy = csvReadError((nextError as Error).message);
      showNotice({ tone: 'error', title: copy.title, detail: copy.detail });
    },
    onSettled: () => {
      setReadingName('');
    },
  });

  const sales = (salesQuery.data?.items || []) as SettlementSale[];
  const summary = salesQuery.data?.summary;
  const totalCount = Number(salesQuery.data?.totalCount || sales.length);
  const loadError = salesQuery.error as Error | undefined;

  const columns = useMemo<ColumnDef<SettlementSale>[]>(() => [
    {
      id: 'order',
      accessorKey: 'orderId',
      header: 'Pedido',
      size: 128,
      cell: ({ row }) => <SaleOrderHover sale={row.original} />,
    },
    {
      id: 'product',
      accessorFn: (sale) => saleTitle(sale),
      header: 'Producto',
      size: 168,
      cell: ({ row }) => (
        <p className="line-clamp-1 text-[13px] font-medium leading-4" title={row.original.productName || undefined}>
          {saleTitle(row.original)}
        </p>
      ),
    },
    {
      id: 'sku',
      accessorFn: (sale) => skuLabel(sale.skus),
      header: 'SKU',
      size: 118,
      cell: ({ row }) => {
        const units = unitsLabel(row.original.itemCount);
        return (
          <p className="truncate font-mono text-[11px] leading-4">
            {skuLabel(row.original.skus) || '—'}
            {units ? <span className="text-muted-foreground"> · {units}</span> : null}
          </p>
        );
      },
    },
    {
      id: 'paid',
      accessorKey: 'paid',
      header: 'Pago',
      size: 120,
      meta: { cellClassName: 'min-w-0 overflow-hidden' },
      cell: ({ row }) => <PaymentStatusBadge status={row.original.paymentStatus} returned={row.original.returned} />,
    },
    {
      id: 'precio',
      accessorKey: 'bruto',
      header: () => <TwoLineHead {...PAGOS_COLUMN_COPY.precio} />,
      size: 108,
      meta: { align: 'end' },
      cell: ({ row }) => (
        <p className="text-right text-[13px] tabular-nums leading-4">{money.format(row.original.bruto || 0)}</p>
      ),
    },
    {
      id: 'commission',
      accessorKey: 'commission',
      header: () => <TwoLineHead {...PAGOS_COLUMN_COPY.commission} />,
      size: 96,
      meta: { align: 'end', headerClassName: cobroHeadStart, cellClassName: cobroCellStart },
      cell: ({ row }) => <AmountRate amount={row.original.commission || 0} rate={row.original.commissionRate} />,
    },
    {
      id: 'shipping',
      accessorKey: 'shipping',
      header: () => <TwoLineHead {...PAGOS_COLUMN_COPY.shipping} />,
      size: 124,
      meta: { align: 'end', headerClassName: cobroHead, cellClassName: cobroCell },
      cell: ({ row }) => <AmountRate amount={row.original.shipping || 0} rate={row.original.shippingRate} />,
    },
    {
      id: 'take',
      accessorKey: 'take',
      header: () => <TwoLineHead {...PAGOS_COLUMN_COPY.take} />,
      size: 124,
      meta: { align: 'end', headerClassName: cobroHeadEnd, cellClassName: cobroCellEnd },
      cell: ({ row }) => <AmountRate amount={row.original.take || 0} rate={row.original.takeRate} tone="take" />,
    },
    {
      id: 'neto',
      accessorKey: 'neto',
      header: () => <TwoLineHead {...PAGOS_COLUMN_COPY.neto} />,
      size: 108,
      meta: { align: 'end', headerClassName: llegaHead, cellClassName: llegaCell },
      cell: ({ row }) => (
        <AmountRate amount={row.original.neto || 0} rate={receiveRate(row.original.bruto, row.original.neto)} tone="receive" />
      ),
    },
  ], []);

  const table = useReactTable({
    data: sales,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (sale) => sale.orderId,
  });

  return (
    <div className="space-y-4 pb-8">
      <SettlementKpiStrip summary={summary} sales={sales} />
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
        <input
          ref={fileInput}
          type="file"
          accept=".csv,.xlsx,.xls,.xlsm,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            dismissNotice();
            setReadingName(file.name);
            upload.mutate({ file, replace: false });
          }}
        />
        <Button
          type="button"
          disabled={reading || upload.isPending}
          onClick={() => {
            const input = fileInput.current;
            if (!input || reading || upload.isPending) return;
            input.value = '';
            input.click();
          }}
        >
          {reading ? <WorkLoaderMark data-icon="inline-start" /> : <Upload data-icon="inline-start" />}
          {reading ? 'Leyendo archivo' : 'Subir archivo'}
        </Button>
      </div>
      {notice ? (
        <SettlementAlert
          tone={notice.tone}
          title={notice.title}
          detail={notice.detail}
          onDismiss={dismissNotice}
          action={notice.canReplace ? {
            label: 'Reemplazar',
            busy: upload.isPending,
            onClick: () => {
              if (!lastCsvRef.current || upload.isPending) return;
              upload.mutate({ replace: true });
            },
          } : undefined}
        />
      ) : null}
      {loadError ? (
        <SettlementAlert
          tone="error"
          title="No se pudieron cargar los pagos."
          detail="Recarga la página o vuelve a cruzar el archivo."
        />
      ) : null}

      <OrdersVirtualTable
        table={table}
        compact
        rowHeight={40}
        scrollClassName="h-[min(78dvh,52rem)]"
        stickyRightId=""
        loading={salesQuery.isLoading && !sales.length}
        fetching={salesQuery.isFetching}
        onRowClick={setSelected}
        aria-label="Cobros de Falabella por venta"
        empty={(
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            Sube un CSV o Excel de Falabella para ver comisión, logística y lo que te llega.
          </div>
        )}
        footer={summary?.saleCount ? (
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
            <p className="text-muted-foreground">
              {salesPageNote(sales.length, totalCount)}
              {summary.paidCount ? ` · ${summary.paidCount} pagadas` : ''}
            </p>
            <p className="tabular-nums">
              Precio {money.format(summary.bruto || 0)}
              <span className="text-muted-foreground"> · </span>
              Se queda <span className={takeText}>{money.format(summary.take || 0)}</span>
              <span className="text-muted-foreground"> · </span>
              Te llega <span className={cn('font-medium', amountToneClass('receive', summary.neto || 0))}>{money.format(summary.neto || 0)}</span>
            </p>
          </div>
        ) : undefined}
      />

      <Sheet open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <SheetContent className="gap-0 overflow-y-auto sm:max-w-lg">
          {selected ? (
            <>
              <SheetHeader className="border-b border-border px-5 py-4 pr-12">
                <div className="flex items-start gap-3">
                  <SaleProductPhoto sale={selected} className="size-14 shrink-0" />
                  <div className="min-w-0">
                    <SheetTitle className="text-[17px] leading-tight" title={selected.productName || undefined}>
                      {saleTitle(selected)}
                    </SheetTitle>
                    <SheetDescription className="text-[13px] leading-snug">
                      {saleSubtitle(selected)}
                    </SheetDescription>
                  </div>
                </div>
              </SheetHeader>
              <div className="px-5 py-4">
                <ChargeRow
                  label="Precio"
                  amount={selected.bruto || 0}
                  hint={selected.returned ? 'Se descuenta el producto.' : 'Lo que pagó el cliente.'}
                />
                {hasBuyerShipping(selected) ? (
                  <p className="pb-2 text-xs text-muted-foreground">El envío lo pagó el cliente.</p>
                ) : null}
                <div className="-mx-5 border-y border-border bg-muted/40 px-5 py-1">
                  <p className="pt-2 text-xs font-medium">{selected.returned ? 'Falabella ajusta' : 'Falabella cobra'}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {selected.returned ? 'Te devuelven la comisión. La logística suele quedarse.' : 'Comisión + logística'}
                  </p>
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
                  hint={teLlegaHint(selected)}
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
                          <span className={cn('tabular-nums font-medium', amountToneClass('receive', product.unitNeto))}>Te llega {money.format(product.unitNeto)} c/u</span>
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
