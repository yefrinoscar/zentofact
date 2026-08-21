import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { flexRender, getCoreRowModel, type ColumnDef, useReactTable } from '@tanstack/react-table';
import { AlertCircle, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TablePanel,
  TablePanelFooter,
  TablePanelHeader,
  TableRow,
} from '@/components/ui/table';

const PAGE_SIZE = 50;

type CompanyOption = {
  id: number;
  name: string;
};

type RipleyOrder = {
  orderId: string;
  orderNumber: string;
  status: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  shippingDeadline: string | null;
  customerName: string | null;
  total: number | null;
  currency: string | null;
  itemsCount: number;
};

type RipleyOrdersPage = {
  apiUrl: string;
  totalCount: number | null;
  offset: number;
  max: number;
  orders: RipleyOrder[];
};

function objectRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) record[key] = entry;
  return record;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function numberOrNull(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCompanies(value: unknown): CompanyOption[] {
  if (!Array.isArray(value)) return [];
  const companies: CompanyOption[] = [];
  for (const candidate of value) {
    const company = objectRecord(candidate);
    const id = numberOrNull(company?.id);
    if (!company || id === null || !Number.isInteger(id) || id <= 0 || company.hasRipleyCredentials !== true) continue;
    companies.push({
      id,
      name: text(company.nombre) || text(company.nombreComercial) || text(company.razonSocial) || `Empresa ${id}`,
    });
  }
  return companies.sort((left, right) => left.name.localeCompare(right.name, 'es'));
}

function parseOrder(value: unknown): RipleyOrder | null {
  const order = objectRecord(value);
  const orderId = text(order?.orderId);
  const orderNumber = text(order?.orderNumber);
  const itemsCount = numberOrNull(order?.itemsCount);
  if (!order || !orderId || !orderNumber || itemsCount == null) return null;
  return {
    orderId,
    orderNumber,
    status: text(order.status),
    createdAt: text(order.createdAt),
    updatedAt: text(order.updatedAt),
    shippingDeadline: text(order.shippingDeadline),
    customerName: text(order.customerName),
    total: numberOrNull(order.total),
    currency: text(order.currency),
    itemsCount,
  };
}

function parseOrdersPage(value: unknown): RipleyOrdersPage {
  const page = objectRecord(value);
  if (!page || !Array.isArray(page.orders)) throw new Error('Ripley devolvió una respuesta de pedidos inválida.');
  const apiUrl = text(page.apiUrl);
  const offset = numberOrNull(page.offset);
  const max = numberOrNull(page.max);
  if (!apiUrl || offset == null || max == null) throw new Error('Ripley devolvió una respuesta de pedidos incompleta.');
  return {
    apiUrl,
    totalCount: numberOrNull(page.totalCount),
    offset,
    max,
    orders: page.orders.map(parseOrder).filter((order): order is RipleyOrder => order !== null),
  };
}

function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatMoney(value: number | null, currency: string | null) {
  if (value === null) return '—';
  try {
    return new Intl.NumberFormat('es-PE', { style: 'currency', currency: currency || 'PEN' }).format(value);
  } catch {
    return `${currency || 'PEN'} ${value.toFixed(2)}`;
  }
}

function apiUrlLabel() {
  return 'Tenant configurado';
}

function apiHostname(apiUrl: string) {
  try { return new URL(apiUrl).hostname; }
  catch { return apiUrl; }
}

const statusClasses: Record<string, string> = {
  STAGING: 'border-slate-200 bg-slate-50 text-slate-700',
  WAITING_ACCEPTANCE: 'border-amber-200 bg-amber-50 text-amber-800',
  WAITING_DEBIT: 'border-orange-200 bg-orange-50 text-orange-800',
  WAITING_DEBIT_PAYMENT: 'border-yellow-200 bg-yellow-50 text-yellow-800',
  SHIPPING: 'border-sky-200 bg-sky-50 text-sky-800',
  SHIPPED: 'border-indigo-200 bg-indigo-50 text-indigo-800',
  TO_COLLECT: 'border-violet-200 bg-violet-50 text-violet-800',
  RECEIVED: 'border-teal-200 bg-teal-50 text-teal-800',
  CLOSED: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  REFUSED: 'border-rose-200 bg-rose-50 text-rose-800',
  CANCELED: 'border-red-200 bg-red-50 text-red-800',
  CANCELLED: 'border-red-200 bg-red-50 text-red-800',
};

const fallbackStatusClasses = [
  'border-cyan-200 bg-cyan-50 text-cyan-800',
  'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800',
  'border-lime-200 bg-lime-50 text-lime-800',
  'border-purple-200 bg-purple-50 text-purple-800',
  'border-blue-200 bg-blue-50 text-blue-800',
];

function statusClass(status: string | null) {
  const normalized = status?.trim().toUpperCase() || '';
  const knownClass = statusClasses[normalized];
  if (knownClass) return knownClass;
  const colorIndex = [...normalized].reduce((hash, character) => hash + (character.codePointAt(0) ?? 0), 0)
    % fallbackStatusClasses.length;
  return fallbackStatusClasses[colorIndex] ?? statusClasses.STAGING;
}

export default function PedidosRipley() {
  const [companyId, setCompanyId] = useState('');
  const [orderStateCodes, setOrderStateCodes] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const selectedCompanyId = Number(companyId);
  const selectedCompany = Number.isInteger(selectedCompanyId) && selectedCompanyId > 0 ? selectedCompanyId : null;

  const companiesQuery = useQuery({
    queryKey: ['companies', 'ripley-orders'],
    queryFn: async () => parseCompanies(await api.listCompanies()),
  });
  const ordersQuery = useQuery({
    queryKey: ['ripley-orders', selectedCompany, orderStateCodes, pageIndex],
    enabled: selectedCompany !== null,
    queryFn: async () => {
      if (selectedCompany === null) throw new Error('Selecciona una empresa de Ripley.');
      return parseOrdersPage(await api.ripleyApiGetOrders(selectedCompany, {
        max: PAGE_SIZE,
        offset: pageIndex * PAGE_SIZE,
        ...(orderStateCodes.trim() ? { orderStateCodes: orderStateCodes.trim() } : {}),
      }));
    },
  });

  const columns = useMemo<ColumnDef<RipleyOrder>[]>(() => [
    {
      accessorKey: 'orderNumber',
      header: 'Pedido',
      cell: ({ row }) => (
        <div>
          <p className="font-mono text-xs font-medium text-foreground">{row.original.orderNumber}</p>
          <p className="font-mono text-[11px] text-muted-foreground">{row.original.orderId}</p>
        </div>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Estado Mirakl',
      cell: ({ row }) => (
        <Badge variant="outline" className={statusClass(row.original.status)}>
          {row.original.status || 'Sin estado'}
        </Badge>
      ),
    },
    {
      accessorKey: 'customerName',
      header: 'Cliente',
      cell: ({ row }) => row.original.customerName || '—',
    },
    {
      accessorKey: 'itemsCount',
      header: () => <span className="block text-right">Ítems</span>,
      cell: ({ row }) => <span className="block text-right tabular-nums">{row.original.itemsCount}</span>,
    },
    {
      id: 'total',
      header: () => <span className="block text-right">Total</span>,
      cell: ({ row }) => <span className="block text-right font-medium tabular-nums">{formatMoney(row.original.total, row.original.currency)}</span>,
    },
    {
      accessorKey: 'shippingDeadline',
      header: 'Fecha límite',
      cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatDate(row.original.shippingDeadline)}</span>,
    },
    {
      accessorKey: 'updatedAt',
      header: 'Actualizado',
      cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatDate(row.original.updatedAt || row.original.createdAt)}</span>,
    },
  ], []);
  const table = useReactTable({
    data: ordersQuery.data?.orders || [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  });
  const totalCount = ordersQuery.data?.totalCount;
  const hasNextPage = totalCount == null
    ? (ordersQuery.data?.orders.length || 0) === PAGE_SIZE
    : (pageIndex + 1) * PAGE_SIZE < totalCount;
  const hasRipleyCompanies = (companiesQuery.data?.length || 0) > 0;

  if (companiesQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Buscando empresas con Ripley configurado…</p>;
  }

  if (companiesQuery.isError) {
    return <p className="flex items-center gap-2 text-sm text-destructive"><AlertCircle className="size-4" />No se pudieron cargar las empresas.</p>;
  }

  if (!hasRipleyCompanies) {
    return (
      <section className="max-w-2xl border-l-2 border-sky-500 py-2 pl-5">
        <p className="text-sm font-medium text-foreground">Conecta una empresa a Ripley</p>
        <p className="mt-1 text-sm text-muted-foreground">Agrega la API key de Mirakl de Ripley Perú en Empresas.</p>
        <Button className="mt-4" asChild>
          <Link to="/companies">Abrir Empresas</Link>
        </Button>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
          <Select
            value={companyId}
            onValueChange={(nextCompanyId) => {
              setCompanyId(nextCompanyId);
              setPageIndex(0);
            }}
          >
            <SelectTrigger className="w-full sm:w-72" aria-label="Elegir empresa de Ripley">
              <SelectValue placeholder="Selecciona una empresa" />
            </SelectTrigger>
            <SelectContent>
              {companiesQuery.data?.map((company) => (
                <SelectItem key={company.id} value={String(company.id)}>{company.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedCompany !== null ? (
            <Input
              className="w-full sm:w-72"
              value={orderStateCodes}
              onChange={(event) => {
                setOrderStateCodes(event.target.value);
                setPageIndex(0);
              }}
              placeholder="Estados Mirakl (ej. SHIPPING)"
              aria-label="Filtrar por estados de Mirakl"
            />
          ) : null}
        </div>
        <Button variant="outline" disabled={ordersQuery.isFetching || selectedCompany === null} onClick={() => void ordersQuery.refetch()}>
          <RefreshCw className={ordersQuery.isFetching ? 'animate-spin' : ''} />
          Actualizar
        </Button>
      </div>

      {selectedCompany === null ? (
        <p className="text-sm text-muted-foreground">Elige una empresa para cargar su bandeja de pedidos.</p>
      ) : (
        <TablePanel aria-label="Bandeja de pedidos de Ripley">
          <TablePanelHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Pedidos de Ripley</p>
              <p className="text-xs text-muted-foreground">Consulta directa de Mirakl Perú. Esta bandeja no modifica pedidos ni publicaciones.</p>
            </div>
            {ordersQuery.data ? (
              <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
                {apiUrlLabel()} · {apiHostname(ordersQuery.data.apiUrl)}
              </Badge>
            ) : null}
          </TablePanelHeader>

          {ordersQuery.isLoading ? (
            <div className="py-14 text-center text-sm text-muted-foreground">Consultando pedidos en Ripley…</div>
          ) : ordersQuery.isError ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center text-sm text-destructive">
              <AlertCircle className="size-5" />
              <p>{ordersQuery.error instanceof Error ? ordersQuery.error.message : 'No se pudieron cargar los pedidos de Ripley.'}</p>
            </div>
          ) : table.getRowModel().rows.length === 0 ? (
            <div className="py-14 text-center text-sm text-muted-foreground">No hay pedidos para los filtros seleccionados.</div>
          ) : (
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id} className="hover:bg-transparent">
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id}>{header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}</TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {ordersQuery.data ? (
            <TablePanelFooter className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {totalCount === null ? `${ordersQuery.data.orders.length} pedidos cargados` : `${totalCount} pedido${totalCount === 1 ? '' : 's'}`}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={pageIndex === 0 || ordersQuery.isFetching} onClick={() => setPageIndex((current) => current - 1)}>
                  <ChevronLeft /> Anterior
                </Button>
                <span className="text-xs text-muted-foreground">Página {pageIndex + 1}</span>
                <Button variant="outline" size="sm" disabled={!hasNextPage || ordersQuery.isFetching} onClick={() => setPageIndex((current) => current + 1)}>
                  Siguiente <ChevronRight />
                </Button>
              </div>
            </TablePanelFooter>
          ) : null}
        </TablePanel>
      )}
    </div>
  );
}
