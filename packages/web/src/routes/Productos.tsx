import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
} from '@tanstack/react-table';
import {
  AlertTriangle,
  Box,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  PackagePlus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import api from '../lib/api';
import { cn } from '../lib/cn';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';

type Company = {
  id: number;
  nombre?: string | null;
  razonSocial?: string | null;
  ruc?: string | null;
  falabellaApiUserId?: string | null;
  falabellaApiKey?: string | null;
};

type Product = {
  sellerSku?: string;
  shopSku?: string;
  name?: string;
  brand?: string;
  primaryCategory?: string;
  price?: string | number | null;
  salePrice?: string | number | null;
  quantity?: string | number | null;
  status?: string;
  images?: string[];
  productId?: string;
  url?: string;
  contentScore?: string | number | null;
  qcStatus?: string;
  createdAt?: string;
  updatedAt?: string;
  variationsCount?: number;
  businessUnits?: Array<{
    name?: string;
    operatorCode?: string;
    price?: string | number | null;
    specialPrice?: string | number | null;
    stock?: string | number | null;
    status?: string;
    isPublished?: string;
  }>;
  raw?: any;
};

const PRODUCT_FILTERS = [
  { value: 'all', label: 'Todos' },
  { value: 'sold-out', label: 'Sin stock' },
  { value: 'image-missing', label: 'Sin imagen' },
];

const PAGE_SIZE = 50;

function sellerName(company: Company) {
  return String(company.nombre || company.razonSocial || `Empresa ${company.id}`).trim();
}

function money(value: string | number | null | undefined) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return `S/ ${n.toFixed(2)}`;
}

function productBusinessUnit(product: Product) {
  return product.businessUnits?.[0] || null;
}

function statusView(status: string | undefined, quantity: string | number | null | undefined, published?: string) {
  const normalized = String(status || '').toLowerCase();
  const qty = Number(quantity);
  if (normalized.includes('rejected')) return { label: 'Rechazado', cls: 'border-red-200 bg-red-50 text-red-700' };
  if (normalized.includes('pending')) return { label: 'Pendiente', cls: 'border-amber-200 bg-amber-50 text-amber-700' };
  if (normalized.includes('inactive') || normalized.includes('deleted')) return { label: 'Inactivo', cls: 'border-slate-200 bg-slate-100 text-slate-600' };
  if (normalized.includes('sold') || (Number.isFinite(qty) && qty <= 0)) return { label: 'Sin stock', cls: 'border-orange-200 bg-orange-50 text-orange-700' };
  if (String(published) === '1') return { label: 'En vivo', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' };
  if (normalized.includes('live') || normalized.includes('active')) return { label: 'Activo', cls: 'border-sky-200 bg-sky-50 text-sky-700' };
  return { label: status || 'Sin estado', cls: 'border-slate-200 bg-slate-50 text-slate-600' };
}

function qcView(qcStatus: string | undefined) {
  const normalized = String(qcStatus || '').toLowerCase();
  if (['approved', 'authorized', 'passed'].includes(normalized)) return { label: 'Aprobado', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' };
  if (normalized.includes('reject')) return { label: 'Rechazado', cls: 'border-red-200 bg-red-50 text-red-700' };
  if (normalized.includes('pending')) return { label: 'Pendiente', cls: 'border-amber-200 bg-amber-50 text-amber-700' };
  return { label: qcStatus || '-', cls: 'border-slate-200 bg-slate-50 text-slate-600' };
}

function productKey(product: Product, index: number) {
  return product.sellerSku || product.shopSku || product.productId || `${product.name}-${index}`;
}

function ProductImage({ product }: { product: Product }) {
  const src = product.images?.[0];
  if (!src) {
    return (
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
        <Box className="h-4 w-4" />
      </div>
    );
  }
  return <img src={src} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover ring-1 ring-border" />;
}

function SkeletonRows() {
  return (
    <div className="divide-y divide-border border-y border-border">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="grid grid-cols-[1.5fr_0.7fr_0.55fr_0.6fr_0.65fr_0.65fr] items-center gap-5 px-3 py-4">
          <div className="flex items-center gap-4">
            <div className="h-10 w-10 animate-pulse rounded-lg bg-muted" />
            <div className="space-y-2">
              <div className="h-4 w-56 animate-pulse rounded bg-muted" />
              <div className="h-3 w-32 animate-pulse rounded bg-muted" />
            </div>
          </div>
          <div className="h-4 w-28 animate-pulse rounded bg-muted" />
          <div className="h-4 w-24 animate-pulse rounded bg-muted" />
          <div className="h-4 w-28 animate-pulse rounded bg-muted" />
          <div className="h-8 w-24 animate-pulse rounded-full bg-muted" />
        </div>
      ))}
    </div>
  );
}

const productColumns: ColumnDef<Product>[] = [
  {
    accessorKey: 'name',
    header: 'Producto',
    cell: ({ row }) => {
      const product = row.original;
      return (
        <span className="flex min-w-0 items-center gap-3">
          <ProductImage product={product} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-foreground">{product.name || product.sellerSku || '-'}</span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">
              {[product.brand, product.primaryCategory].filter(Boolean).join(' · ') || product.productId || 'Sin categoria'}
            </span>
          </span>
        </span>
      );
    },
  },
  {
    accessorKey: 'price',
    header: 'Precio',
    cell: ({ row }) => {
      const product = row.original;
      return (
        <span className="text-sm font-medium text-foreground">
          {money(product.salePrice || product.price)}
          {product.salePrice && product.price && String(product.salePrice) !== String(product.price) && (
            <span className="ml-2 text-xs font-normal text-muted-foreground line-through">{money(product.price)}</span>
          )}
        </span>
      );
    },
  },
  {
    accessorKey: 'quantity',
    header: 'Stock',
    cell: ({ row }) => (
      <span className="text-sm text-foreground">
        {row.original.quantity ?? '-'} <span className="text-xs font-normal text-muted-foreground">u</span>
      </span>
    ),
  },
  {
    accessorKey: 'status',
    header: 'Estado',
    cell: ({ row }) => {
      const product = row.original;
      const unit = productBusinessUnit(product);
      const status = statusView(unit?.status || product.status, unit?.stock ?? product.quantity, unit?.isPublished);
      return (
        <span className={cn('inline-flex w-fit items-center rounded-md border px-2 py-0.5 text-xs font-medium', status.cls)}>
          {status.label}
        </span>
      );
    },
  },
  {
    id: 'quality',
    header: 'Calidad',
    cell: ({ row }) => {
      const product = row.original;
      const qc = qcView(product.qcStatus);
      return (
        <span className="inline-flex min-w-[110px] flex-col items-start gap-1">
          <span className={cn('inline-flex w-fit items-center rounded-md border px-2 py-0.5 text-xs font-medium', qc.cls)}>{qc.label}</span>
          <span className="pl-0.5 text-xs text-muted-foreground">{product.contentScore ?? '-'} score</span>
        </span>
      );
    },
  },
];

export default function Productos() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [sellerTotal, setSellerTotal] = useState<number | null>(null);
  const [countingTotal, setCountingTotal] = useState(false);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createResult, setCreateResult] = useState<any>(null);
  const [createForm, setCreateForm] = useState({
    sellerSku: '',
    name: '',
    primaryCategory: '',
    description: '',
    brand: '',
    productId: '',
    operatorCode: 'fape',
    price: '',
    specialPrice: '',
    specialFromDate: '',
    specialToDate: '',
    stock: '0',
    status: 'active',
    conditionType: 'Nuevo',
    packageHeight: '10',
    packageWidth: '10',
    packageLength: '10',
    packageWeight: '1',
  });

  const sellers = useMemo(
    () => companies.filter((company) => company.falabellaApiUserId?.trim() && company.falabellaApiKey?.trim()),
    [companies],
  );
  const selectedCompany = sellers.find((company) => company.id === companyId) || sellers[0] || null;
  const canPrev = offset > 0;
  const canNext = totalCount == null ? products.length === PAGE_SIZE : offset + PAGE_SIZE < totalCount;
  const table = useReactTable({
    data: products,
    columns: productColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  useEffect(() => {
    let mounted = true;
    api.listCompanies().then((rows: Company[]) => {
      if (!mounted) return;
      setCompanies(rows || []);
      const first = (rows || []).find((company) => company.falabellaApiUserId?.trim() && company.falabellaApiKey?.trim());
      setCompanyId((current) => current || first?.id || null);
    }).catch((e: any) => {
      if (!mounted) return;
      setError(e?.message || 'No se pudieron cargar las empresas.');
    });
    return () => { mounted = false; };
  }, []);

  const loadProducts = async (spin = false) => {
    if (!selectedCompany) {
      setLoading(false);
      return;
    }
    if (spin) setRefreshing(true);
    setError('');
    try {
      const response = await api.falabellaApiGetProducts(selectedCompany.id, {
        search: submittedSearch,
        filter,
        limit: PAGE_SIZE,
        offset,
      });
      if (response?.error) throw new Error(response.error?.Head?.ErrorMessage || response.error?.message || 'Falabella devolvió error.');
      setProducts(response?.products || []);
      setTotalCount(response?.totalCount ?? null);
    } catch (e: any) {
      setProducts([]);
      setTotalCount(null);
      setError(e?.message || 'No se pudieron consultar productos.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const loadSellerTotal = async () => {
    if (!selectedCompany) {
      setSellerTotal(null);
      return;
    }
    setCountingTotal(true);
    try {
      const response = await api.falabellaApiGetProducts(selectedCompany.id, {
        filter: 'all',
        limit: 1,
        offset: 0,
        countOnly: true,
      });
      if (response?.error) throw new Error(response.error?.Head?.ErrorMessage || response.error?.message || 'Falabella devolvió error.');
      setSellerTotal(response?.totalCount ?? null);
    } catch {
      setSellerTotal(null);
    } finally {
      setCountingTotal(false);
    }
  };

  useEffect(() => {
    loadProducts(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompany?.id, filter, submittedSearch, offset]);

  useEffect(() => {
    setSellerTotal(null);
    loadSellerTotal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompany?.id]);

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    setOffset(0);
    setSubmittedSearch(search.trim());
  };

  const switchSeller = (id: number) => {
    setCompanyId(id);
    setOffset(0);
    setExpanded(null);
  };

  const updateCreateField = (key: keyof typeof createForm, value: string) => {
    setCreateForm((prev) => ({ ...prev, [key]: value }));
  };

  const createProduct = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedCompany) return;
    setCreating(true);
    setCreateError('');
    setCreateResult(null);
    try {
      const response = await api.falabellaApiCreateProduct(selectedCompany.id, createForm);
      if (response?.error) throw new Error(response.error?.Head?.ErrorMessage || response.error?.message || response.error || 'Falabella devolvio error.');
      let feedStatus: any = null;
      if (response?.requestId) {
        try {
          feedStatus = await api.falabellaApiGetFeedStatus(selectedCompany.id, response.requestId);
        } catch {
          feedStatus = null;
        }
      }
      setCreateResult({ ...response, feedStatus });
      setSubmittedSearch(createForm.sellerSku.trim());
      setSearch(createForm.sellerSku.trim());
      setOffset(0);
    } catch (e: any) {
      setCreateError(e?.message || 'No se pudo crear el producto.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Productos</h1>
          <p className="text-sm text-muted-foreground">Catálogo Falabella</p>
        </div>
        <button
          type="button"
          onClick={() => { setCreateOpen(true); setCreateError(''); setCreateResult(null); }}
          disabled={!selectedCompany}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
        >
          <PackagePlus className="h-4 w-4" /> Agregar producto
        </button>
      </div>

      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <Select value={selectedCompany?.id ? String(selectedCompany.id) : ''} onValueChange={(value) => switchSeller(Number(value))}>
          <SelectTrigger className="h-9 w-full rounded-md md:w-[320px]">
            <SelectValue placeholder="Selecciona seller" />
          </SelectTrigger>
          <SelectContent>
            {sellers.map((company) => (
              <SelectItem key={company.id} value={String(company.id)}>
                {sellerName(company)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <form onSubmit={submitSearch} className="relative flex-1 md:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar producto o SKU"
            className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-20 text-sm outline-none transition placeholder:text-muted-foreground focus:border-ring"
          />
          {search && (
            <button
              type="button"
              onClick={() => { setSearch(''); setSubmittedSearch(''); setOffset(0); }}
              className="absolute right-10 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
              aria-label="Limpiar busqueda"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <button
            type="submit"
            className="absolute right-1 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
            aria-label="Buscar"
          >
            <Search className="h-4 w-4" />
          </button>
        </form>

        <Select value={filter} onValueChange={(value) => { setFilter(value); setOffset(0); }}>
          <SelectTrigger className="h-9 w-full rounded-md md:w-[160px]">
            <SelectValue placeholder="Filtro" />
          </SelectTrigger>
          <SelectContent>
            {PRODUCT_FILTERS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <button
          onClick={() => loadProducts(true)}
          disabled={refreshing || !selectedCompany}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-60"
        >
          <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
          Actualizar
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!selectedCompany && !loading ? (
        <div className="border-y border-border p-10 text-center text-sm text-muted-foreground">
          No hay sellers con credenciales Falabella configuradas.
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-border">
          <div className="flex flex-col gap-2 border-b border-border px-3 py-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">
                {countingTotal ? 'Calculando...' : `${sellerTotal == null ? '-' : sellerTotal} productos`}
              </p>
              <p className="text-xs text-muted-foreground">
                {submittedSearch ? `Búsqueda: "${submittedSearch}" · ` : ''}
                Mostrando {products.length}
              </p>
            </div>
            <span className="text-xs font-medium text-muted-foreground">
              Página {Math.floor(offset / PAGE_SIZE) + 1} · máximo {PAGE_SIZE}
            </span>
          </div>
          {loading ? <SkeletonRows /> : products.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">No hay productos para este filtro.</div>
          ) : (
            <Table className="min-w-[860px]">
                <TableHeader className="bg-muted/40">
                  {table.getHeaderGroups().map((headerGroup) => (
                    <TableRow key={headerGroup.id} className="hover:bg-transparent">
                      {headerGroup.headers.map((header) => (
                        <TableHead key={header.id}>
                          {header.isPlaceholder ? null : (
                            <button
                              type="button"
                              onClick={header.column.getToggleSortingHandler()}
                              className="inline-flex items-center gap-1 text-left transition hover:text-foreground"
                            >
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              {header.column.getIsSorted() === 'asc' ? '↑' : header.column.getIsSorted() === 'desc' ? '↓' : ''}
                            </button>
                          )}
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {table.getRowModel().rows.map((row) => {
                    const product = row.original;
                    const key = productKey(product, row.index);
                    const open = expanded === key;
                    return (
                      <Fragment key={row.id}>
                        <TableRow onClick={() => setExpanded(open ? null : key)} className="cursor-pointer">
                          {row.getVisibleCells().map((cell) => (
                            <TableCell key={cell.id}>
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </TableCell>
                          ))}
                        </TableRow>
                        {open && (
                          <TableRow>
                            <TableCell colSpan={row.getVisibleCells().length} className="bg-muted/20 px-3 py-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Detalle de publicación</p>
                          <span className="text-xs font-medium text-foreground">
                            {(product.businessUnits?.length || 0)} unidad(es) · {product.variationsCount || 0} variacion(es)
                          </span>
                        </div>
                        <div className="grid gap-3 border-y border-border py-3 text-sm md:grid-cols-5">
                          <div>
                            <p className="text-xs text-muted-foreground">Seller</p>
                            <p className="mt-1 font-semibold text-foreground">{selectedCompany ? sellerName(selectedCompany) : '-'}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">QC</p>
                            <p className="mt-1 font-medium text-foreground">{qcView(product.qcStatus).label}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Creado</p>
                            <p className="mt-1 font-medium text-foreground">{product.createdAt || '-'}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Actualizado</p>
                            <p className="mt-1 font-medium text-foreground">{product.updatedAt || '-'}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Producto ID</p>
                            <p className="mt-1 truncate font-mono text-xs text-foreground">{product.productId || '-'}</p>
                          </div>
                        </div>
                        {product.businessUnits?.length ? (
                          <div className="mt-4 overflow-auto border border-border">
                            <div className="grid min-w-[720px] grid-cols-[1fr_0.7fr_0.7fr_0.55fr_0.7fr_0.65fr] gap-4 border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              <span>Marketplace</span>
                              <span>Precio</span>
                              <span>Especial</span>
                              <span>Stock</span>
                              <span>Estado</span>
                              <span>Publicado</span>
                            </div>
                            {product.businessUnits.map((unit, unitIndex) => {
                              const unitStatus = statusView(unit.status, unit.stock, unit.isPublished);
                              return (
                                <div key={`${unit.name || unit.operatorCode || unitIndex}`} className="grid min-w-[720px] grid-cols-[1fr_0.7fr_0.7fr_0.55fr_0.7fr_0.65fr] gap-4 border-b border-border px-3 py-2 text-sm last:border-b-0">
                                  <span className="font-semibold text-foreground">{unit.name || unit.operatorCode || '-'}</span>
                                  <span>{money(unit.price)}</span>
                                  <span>{money(unit.specialPrice)}</span>
                                  <span className="font-semibold">{unit.stock ?? '-'} <span className="text-xs font-normal text-muted-foreground">u</span></span>
                                  <span className={cn('inline-flex w-fit items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold', unitStatus.cls)}>{unitStatus.label}</span>
                                  <span className={cn(
                                    'inline-flex w-fit items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold',
                                    String(unit.isPublished) === '1'
                                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                      : 'border-amber-200 bg-amber-50 text-amber-700',
                                  )}>
                                    {String(unit.isPublished) === '1' ? 'Sí' : 'No'}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
          )}
          <div className="flex flex-col gap-3 border-t border-border px-3 py-3 md:flex-row md:items-center md:justify-between">
            <p className="text-sm text-muted-foreground">
              Mostrando {products.length} producto(s). Total del seller: {sellerTotal == null ? '-' : sellerTotal}.
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                disabled={!canPrev}
                className="inline-flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" /> Anterior
              </button>
              <button
                onClick={() => setOffset(offset + PAGE_SIZE)}
                disabled={!canNext}
                className="inline-flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-40"
              >
                Siguiente <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">Agregar producto</h2>
                <p className="text-xs text-muted-foreground">ProductCreate crea un feed asincronico en Falabella.</p>
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={createProduct} className="max-h-[calc(90vh-74px)] overflow-auto p-5">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="SKU seller" value={createForm.sellerSku} onChange={(v) => updateCreateField('sellerSku', v)} required />
                <Field label="Nombre" value={createForm.name} onChange={(v) => updateCreateField('name', v)} required />
                <Field label="Categoria principal ID" value={createForm.primaryCategory} onChange={(v) => updateCreateField('primaryCategory', v)} required />
                <Field label="Marca" value={createForm.brand} onChange={(v) => updateCreateField('brand', v)} required />
                <Field label="Product ID / EAN" value={createForm.productId} onChange={(v) => updateCreateField('productId', v)} />
                <Field label="OperatorCode" value={createForm.operatorCode} onChange={(v) => updateCreateField('operatorCode', v)} required />
                <Field label="Precio" value={createForm.price} onChange={(v) => updateCreateField('price', v)} required />
                <Field label="Stock" value={createForm.stock} onChange={(v) => updateCreateField('stock', v)} required />
                <Field label="Precio especial" value={createForm.specialPrice} onChange={(v) => updateCreateField('specialPrice', v)} />
                <Field label="Inicio oferta" value={createForm.specialFromDate} onChange={(v) => updateCreateField('specialFromDate', v)} placeholder="YYYY-MM-DD HH:mm:ss" />
                <Field label="Fin oferta" value={createForm.specialToDate} onChange={(v) => updateCreateField('specialToDate', v)} placeholder="YYYY-MM-DD HH:mm:ss" />
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Estado</span>
                  <select
                    value={createForm.status}
                    onChange={(event) => updateCreateField('status', event.target.value)}
                    className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-ring"
                  >
                    <option value="active">active</option>
                    <option value="inactive">inactive</option>
                  </select>
                </label>
              </div>

              <div className="mt-4 space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Descripcion HTML</span>
                <textarea
                  value={createForm.description}
                  onChange={(event) => updateCreateField('description', event.target.value)}
                  required
                  rows={5}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
                />
              </div>

              <div className="mt-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">ProductData base</p>
                <div className="grid gap-4 md:grid-cols-5">
                  <Field label="Condicion" value={createForm.conditionType} onChange={(v) => updateCreateField('conditionType', v)} required />
                  <Field label="Alto cm" value={createForm.packageHeight} onChange={(v) => updateCreateField('packageHeight', v)} required />
                  <Field label="Ancho cm" value={createForm.packageWidth} onChange={(v) => updateCreateField('packageWidth', v)} required />
                  <Field label="Largo cm" value={createForm.packageLength} onChange={(v) => updateCreateField('packageLength', v)} required />
                  <Field label="Peso kg" value={createForm.packageWeight} onChange={(v) => updateCreateField('packageWeight', v)} required />
                </div>
              </div>

              {createError && (
                <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{createError}</span>
                </div>
              )}
              {createResult?.requestId && (
                <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Feed creado: <span className="font-mono">{createResult.requestId}</span>
                    {createResult.feedStatus?.feed?.status ? (
                      <span className="ml-2">Estado: {createResult.feedStatus.feed.status}</span>
                    ) : null}
                  </span>
                </div>
              )}

              <div className="mt-5 flex items-center justify-end gap-2 border-t border-border pt-4">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="h-10 rounded-lg border border-border px-4 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
                >
                  Cerrar
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
                >
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackagePlus className="h-4 w-4" />}
                  Crear feed
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}{required ? ' *' : ''}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        placeholder={placeholder}
        className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-ring"
      />
    </label>
  );
}
