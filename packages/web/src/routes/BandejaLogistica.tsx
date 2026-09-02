import { useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ColumnDef, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import {
  Loader2,
  PackageCheck,
  Printer,
  Search,
} from 'lucide-react';
import api from '../lib/api';
import { cn } from '../lib/cn';
import { sellerShortName } from '../lib/seller-name';
import {
  canMarkFalabellaReady,
  canPrintLogisticsLabel,
  logisticsChannelClass,
  logisticsChannelLabel,
  logisticsCountLabel,
  logisticsDeliveryLabel,
  logisticsEmptyCopy,
  logisticsSkippedNotice,
  openPdfFromBase64,
  LOGISTICS_CHANNELS,
  LOGISTICS_STAGES,
  type LogisticsChannel,
  type LogisticsStage,
} from '../lib/logistics-inbox';
import { noticeFromError, type InboxNotice } from '../lib/inbox-notice';
import { CopyableLogId } from '../components/CopyableLogId';
import { OrdersVirtualTable } from '../components/OrdersVirtualTable';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { Input } from '../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../components/ui/sheet';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';

type Company = {
  id: number;
  nombre?: string | null;
  nombreComercial?: string | null;
  razonSocial?: string | null;
};

type LogisticsItem = {
  id: number;
  sku?: string | null;
  description: string;
  quantity: number;
  imageUrl?: string | null;
};

type LogisticsOrder = {
  id: number;
  companyId: number | null;
  companyName: string;
  channelCode: string;
  channelName: string;
  externalOrderId: string;
  externalOrderNumber: string;
  fulfillmentStatus: string;
  stage: LogisticsStage;
  customer?: { name?: string; phone?: string };
  shipping?: { type?: string; carrier?: string; address?: string; district?: string; trackingCode?: string };
  promisedShippingAt?: string | null;
  orderedAt?: string | null;
  itemsCount: number;
  items: LogisticsItem[];
};

type InboxResponse = {
  orders: LogisticsOrder[];
  counts: { pending: number; ready: number; shipped: number };
  totalCount: number;
};

const LIMA = 'America/Lima';

function companyLabel(company: Company) {
  return sellerShortName(company.nombreComercial || company.nombre || company.razonSocial);
}

function formatWhen(value?: string | null) {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-PE', {
    timeZone: LIMA,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function productSummary(items: LogisticsItem[]) {
  if (!items.length) return 'Sin productos';
  const first = items[0];
  const extra = items.length - 1;
  const name = first.description || first.sku || 'Producto';
  return extra > 0 ? `${name} +${extra}` : name;
}

export default function BandejaLogistica() {
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<LogisticsStage>('pending');
  const [channelCode, setChannelCode] = useState<'all' | LogisticsChannel>('all');
  const [companyId, setCompanyId] = useState('all');
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [detail, setDetail] = useState<LogisticsOrder | null>(null);
  const [readyOrder, setReadyOrder] = useState<LogisticsOrder | null>(null);
  const [notice, setNotice] = useState<InboxNotice | null>(null);

  const filters = useMemo(() => ({
    stage,
    channelCode: channelCode === 'all' ? undefined : channelCode,
    companyId: companyId === 'all' ? undefined : Number(companyId),
    search: submittedSearch || undefined,
    limit: 80,
    offset: 0,
  }), [channelCode, companyId, stage, submittedSearch]);

  const companiesQuery = useQuery({
    queryKey: ['order-companies'],
    queryFn: () => api.listCompanies(),
    staleTime: 5 * 60_000,
  });
  const inboxQuery = useQuery({
    queryKey: ['logistics-inbox', filters],
    queryFn: () => api.listLogisticsInbox(filters) as Promise<InboxResponse>,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });

  const companies = (Array.isArray(companiesQuery.data) ? companiesQuery.data : []) as Company[];
  const orders = inboxQuery.data?.orders || [];
  const counts = inboxQuery.data?.counts || { pending: 0, ready: 0, shipped: 0 };
  const loading = inboxQuery.isPending && !inboxQuery.data;
  const visibleIds = orders.map((order) => order.id);
  const selectedVisible = visibleIds.filter((id) => selectedIds.has(id));
  const printableSelected = orders.filter((order) => selectedIds.has(order.id) && canPrintLogisticsLabel(order));

  const printMutation = useMutation({
    mutationFn: (orderIds: number[]) => api.printLogisticsPack({ orderIds, includePacking: true }),
    onSuccess: (result) => {
      if (result?.base64) openPdfFromBase64(result.base64, result.filename || 'bandeja.pdf');
      const skipped = Array.isArray(result?.skipped) ? result.skipped : [];
      setNotice({
        tone: skipped.length ? 'warning' : 'success',
        message: skipped.length
          ? logisticsSkippedNotice(skipped)
          : `Listo. ${result.labelCount || 0} etiqueta${Number(result.labelCount) === 1 ? '' : 's'}.`,
        refs: [],
      });
      setSelectedIds(new Set());
      void queryClient.invalidateQueries({ queryKey: ['logistics-inbox'] });
    },
    onError: (error) => setNotice(noticeFromError(error, 'No se pudo armar la impresión.')),
  });

  const readyMutation = useMutation({
    mutationFn: (order: LogisticsOrder) => api.falabellaApiSetReadyToShip(order.companyId as number, order.externalOrderId),
    onSuccess: () => {
      setReadyOrder(null);
      setNotice({ tone: 'success', message: 'Marcado listo para enviar.', refs: [] });
      void queryClient.invalidateQueries({ queryKey: ['logistics-inbox'] });
    },
    onError: (error) => setNotice(noticeFromError(error, 'No se pudo marcar listo.')),
  });

  const toggleSelected = (id: number) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    const printable = orders.filter(canPrintLogisticsLabel).map((order) => order.id);
    const allOn = printable.length > 0 && printable.every((id) => selectedIds.has(id));
    setSelectedIds(allOn ? new Set() : new Set(printable));
  };

  const columns = useMemo<ColumnDef<LogisticsOrder>[]>(() => [
    {
      id: 'select',
      header: () => (
        <Checkbox
          checked={printableSelected.length > 0 && printableSelected.length === orders.filter(canPrintLogisticsLabel).length}
          onCheckedChange={toggleAllVisible}
          aria-label="Seleccionar pedidos visibles"
        />
      ),
      cell: ({ row }) => canPrintLogisticsLabel(row.original) ? (
        <Checkbox
          checked={selectedIds.has(row.original.id)}
          onCheckedChange={() => toggleSelected(row.original.id)}
          aria-label={`Seleccionar ${row.original.externalOrderNumber}`}
        />
      ) : null,
      size: 44,
    },
    {
      id: 'order',
      header: 'Pedido',
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate font-mono text-xs font-semibold">{row.original.externalOrderNumber || row.original.externalOrderId}</p>
          <p className="truncate text-[11px] text-muted-foreground">{row.original.customer?.name || 'Sin cliente'}</p>
        </div>
      ),
      size: 180,
    },
    {
      id: 'channel',
      header: 'Canal',
      cell: ({ row }) => (
        <Badge variant="outline" className={cn('rounded-md', logisticsChannelClass(row.original.channelCode))}>
          {logisticsChannelLabel(row.original.channelCode)}
        </Badge>
      ),
      size: 110,
    },
    {
      id: 'products',
      header: 'Productos',
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate text-sm">{productSummary(row.original.items)}</p>
          <p className="text-[11px] text-muted-foreground">{row.original.itemsCount} unid.</p>
        </div>
      ),
      size: 240,
    },
    {
      id: 'delivery',
      header: 'Entrega',
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate text-sm">{logisticsDeliveryLabel(row.original)}</p>
          <p className="truncate text-[11px] text-muted-foreground">{sellerShortName(row.original.companyName)}</p>
        </div>
      ),
      size: 150,
    },
    {
      id: 'when',
      header: 'Prometido',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{formatWhen(row.original.promisedShippingAt || row.original.orderedAt)}</span>
      ),
      size: 130,
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const order = row.original;
        if (canPrintLogisticsLabel(order)) {
          return (
            <Button
              size="sm"
              variant="outline"
              onClick={() => printMutation.mutate([order.id])}
              disabled={printMutation.isPending}
            >
              {printMutation.isPending ? <Loader2 className="animate-spin" /> : <Printer />}
              Imprimir
            </Button>
          );
        }
        if (canMarkFalabellaReady(order)) {
          return (
            <Button size="sm" onClick={() => setReadyOrder(order)}>
              <PackageCheck />
              Listo
            </Button>
          );
        }
        return (
          <Button size="sm" variant="ghost" onClick={() => setDetail(order)}>Ver</Button>
        );
      },
      size: 120,
    },
  ], [orders, printableSelected.length, printMutation.isPending, selectedIds]);

  const table = useReactTable({
    data: orders,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => String(row.id),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <form
          className="flex min-w-0 flex-1 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmittedSearch(search.trim());
          }}
        >
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Pedido, cliente o SKU"
              aria-label="Buscar pedidos"
              className="pl-9"
            />
          </div>
          <Button type="submit" variant="outline">Buscar</Button>
        </form>
        <Select value={companyId} onValueChange={setCompanyId}>
          <SelectTrigger className="w-full lg:w-48" aria-label="Filtrar por tienda">
            <SelectValue placeholder="Tienda" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las tiendas</SelectItem>
            {companies.map((company) => (
              <SelectItem key={company.id} value={String(company.id)}>{companyLabel(company)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          onClick={() => printMutation.mutate(selectedVisible.length ? selectedVisible : orders.filter(canPrintLogisticsLabel).map((order) => order.id))}
          disabled={printMutation.isPending || (selectedVisible.length === 0 && !orders.some(canPrintLogisticsLabel))}
        >
          {printMutation.isPending ? <Loader2 className="animate-spin" /> : <Printer />}
          {selectedVisible.length ? `Imprimir ${selectedVisible.length}` : 'Imprimir visibles'}
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Canal">
        {LOGISTICS_CHANNELS.map((channel) => {
          const active = channelCode === channel.value;
          return (
            <button
              key={channel.value}
              type="button"
              aria-pressed={active}
              onClick={() => setChannelCode(channel.value)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition',
                active
                  ? channel.value === 'all'
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : logisticsChannelClass(channel.value)
                  : 'border-transparent bg-muted text-muted-foreground hover:text-foreground',
              )}
            >
              {channel.label}
            </button>
          );
        })}
      </div>

      <div
        role="tablist"
        aria-label="Flujo de pedidos"
        className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1"
      >
        {LOGISTICS_STAGES.map((tab) => {
          const active = stage === tab.value;
          const count = counts[tab.value];
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setStage(tab.value)}
              className={cn(
                'rounded-lg px-3 py-2 text-sm font-medium transition',
                active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
              <span className={cn(
                'ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                tab.value === 'pending' ? 'bg-amber-100 text-amber-900' : tab.value === 'ready' ? 'bg-emerald-100 text-emerald-900' : 'bg-slate-200 text-slate-700',
              )}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {notice && (
        <div className={cn(
          'flex flex-wrap items-start justify-between gap-2 rounded-lg px-3 py-2 text-sm',
          notice.tone === 'error' ? 'bg-destructive/10 text-destructive' : notice.tone === 'warning' ? 'bg-amber-50 text-amber-950' : 'bg-emerald-50 text-emerald-950',
        )}>
          <p>{notice.message}</p>
          {notice.refs.map((ref) => ref.logId ? <CopyableLogId key={ref.logId} logId={ref.logId} /> : null)}
        </div>
      )}

      <OrdersVirtualTable
        table={table}
        loading={loading}
        fetching={inboxQuery.isFetching}
        aria-label="Bandeja de pedidos"
        empty={<p className="px-4 py-16 text-center text-sm text-muted-foreground">{logisticsEmptyCopy(stage)}</p>}
        footer={<p className="text-xs text-muted-foreground">{logisticsCountLabel(stage, inboxQuery.data?.totalCount || 0)}</p>}
        onRowClick={(order) => setDetail(order)}
        stickyLeftId="order"
        stickyRightId="actions"
        rowHeight={64}
      />

      <Sheet open={Boolean(detail)} onOpenChange={(open) => { if (!open) setDetail(null); }}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="font-mono">{detail?.externalOrderNumber || 'Pedido'}</SheetTitle>
            <SheetDescription>
              {logisticsChannelLabel(detail?.channelCode)} · {sellerShortName(detail?.companyName)}
            </SheetDescription>
          </SheetHeader>
          {detail && (
            <div className="space-y-4 px-4 pb-6">
              <p className="text-sm">{detail.customer?.name || 'Sin cliente'}</p>
              <p className="text-xs text-muted-foreground">{logisticsDeliveryLabel(detail)}</p>
              <ul className="divide-y divide-border text-sm">
                {detail.items.map((item) => (
                  <li key={item.id} className="flex justify-between gap-3 py-2">
                    <span className="min-w-0 truncate">{item.description}</span>
                    <span className="shrink-0 font-mono text-xs">x{item.quantity}</span>
                  </li>
                ))}
              </ul>
              {canPrintLogisticsLabel(detail) && (
                <Button className="w-full" onClick={() => printMutation.mutate([detail.id])} disabled={printMutation.isPending}>
                  <Printer /> Imprimir etiqueta y guía
                </Button>
              )}
              {canMarkFalabellaReady(detail) && (
                <Button className="w-full" onClick={() => setReadyOrder(detail)}>
                  <PackageCheck /> Marcar listo para enviar
                </Button>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={Boolean(readyOrder)} onOpenChange={(open) => { if (!open) setReadyOrder(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Marcar listo para enviar</DialogTitle>
            <DialogDescription>
              {readyOrder?.externalOrderNumber} pasa a listo en Falabella y descuenta stock.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReadyOrder(null)}>Cancelar</Button>
            <Button
              onClick={() => readyOrder && readyMutation.mutate(readyOrder)}
              disabled={readyMutation.isPending}
            >
              {readyMutation.isPending ? <Loader2 className="animate-spin" /> : <PackageCheck />}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
