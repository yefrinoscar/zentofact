import { useRef, useState } from 'react';
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { PackageSearch, Search, X } from 'lucide-react';
import api from '../lib/api';
import {
  CATALOGO_VENDEDOR_PAGE_SIZE,
  DEFAULT_CATALOGO_VENDEDOR_STATE,
  SORT_OPTIONS,
  STOCK_FILTER_OPTIONS,
  catalogoVendedorKey,
  commissionDisplay,
  formatProductMoney,
  productCountLabel,
  salespersonProductsFilter,
  stockDisplay,
  type SalespersonProduct,
  type SalespersonProductStock,
  type SalespersonProductsFilter,
  type SalespersonProductsResponse,
  type StockTone,
  visibleBrand,
} from '../lib/catalogo-vendedor';
import { ProductPhoto } from './registrar-venta/widgets';
import { CopyableSku } from '../components/CopyableSku';
import { cn } from '../lib/cn';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { DataTablePagination } from '../components/ui/data-table';
import { Skeleton } from '../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TablePanel, TableRow } from '../components/ui/table';

const SEARCH_DELAY_MS = 300;
const STALE_MS = 30_000;

function fetchProducts(filter: SalespersonProductsFilter) {
  return api.listSalespersonProducts(filter);
}

const STOCK_TONE_CLASS: Record<StockTone, string> = {
  ok: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-400/20',
  low: 'bg-amber-50 text-amber-800 ring-amber-600/25 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20',
  out: 'bg-destructive/10 text-destructive ring-destructive/20',
};
const STOCK_DOT_CLASS: Record<StockTone, string> = {
  ok: 'bg-emerald-500',
  low: 'bg-amber-500',
  out: 'bg-destructive',
};
const STOCK_TITLE: Record<StockTone, string> = {
  ok: 'Disponible para vender',
  low: 'Quedan pocas unidades',
  out: 'Sin stock: no se puede vender ahora',
};

function StockPill({ available }: { available: number }) {
  const stock = stockDisplay(available);
  return (
    <span
      className={cn('relative inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 ring-1 ring-inset', STOCK_TONE_CLASS[stock.tone])}
      title={STOCK_TITLE[stock.tone]}
    >
      <span className={cn('size-2 shrink-0 rounded-full', STOCK_DOT_CLASS[stock.tone])} aria-hidden />
      {stock.out ? (
        <span className="text-sm font-semibold">Sin stock</span>
      ) : (
        <span className="text-sm">
          <span className="font-semibold tabular-nums">{stock.value}</span>
          <span className="ml-1 text-xs">{stock.value === 1 ? 'unid.' : 'unids.'}</span>
        </span>
      )}
      <span className="sr-only">{STOCK_TITLE[stock.tone]}</span>
    </span>
  );
}

function Earnings({ product, commissionPercent }: { product: SalespersonProduct; commissionPercent: number }) {
  const display = commissionDisplay(product, commissionPercent);
  if (display.empty) {
    return <span className="text-sm text-muted-foreground" title={display.title}>Sin comisión</span>;
  }
  return (
    <span className="inline-flex flex-col items-end leading-tight" title={display.title}>
      <span className="font-semibold tabular-nums text-primary">{display.amount}</span>
      {display.hint ? <span className="text-[11px] tabular-nums text-muted-foreground">{display.hint}</span> : null}
    </span>
  );
}

function ProductCell({ product }: { product: SalespersonProduct }) {
  const brand = visibleBrand(product.brand);
  return (
    <div className={cn('flex min-w-0 items-center gap-3', stockDisplay(product.available).out && 'opacity-60')}>
      <ProductPhoto url={product.imageUrl} sku={product.sku} name={product.name} size="md" />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 whitespace-normal text-sm font-medium leading-5" title={product.name}>{product.name}</p>
        <div className="mt-0.5 flex min-w-0 items-center gap-2">
          <CopyableSku sku={product.sku} />
          {brand ? <span className="hidden truncate text-xs text-muted-foreground sm:inline">· {brand}</span> : null}
        </div>
        <div className="mt-1.5 sm:hidden"><StockPill available={product.available} /></div>
      </div>
    </div>
  );
}

const COLUMN_CLASS: Record<string, string> = {
  product: 'w-auto',
  stock: 'hidden w-32 sm:table-cell',
  price: 'w-[5.5rem] text-right sm:w-28',
  earnings: 'w-[5.5rem] text-right sm:w-28',
};

function productColumns(commissionPercent: number): ColumnDef<SalespersonProduct>[] {
  return [
    { id: 'product', header: 'Producto', cell: ({ row }) => <ProductCell product={row.original} /> },
    { id: 'stock', header: 'Stock', cell: ({ row }) => <StockPill available={row.original.available} /> },
    {
      id: 'price',
      header: 'Precio',
      cell: ({ row }) => <span className="font-semibold tabular-nums">{formatProductMoney(row.original.price)}</span>,
    },
    {
      id: 'earnings',
      header: 'Ganas',
      cell: ({ row }) => <Earnings product={row.original} commissionPercent={commissionPercent} />,
    },
  ];
}

function TableSkeleton() {
  return (
    <TableBody aria-hidden>
      {Array.from({ length: 8 }, (_, index) => (
        <TableRow key={index} className="hover:bg-transparent">
          <TableCell>
            <div className="flex items-center gap-3">
              <Skeleton className="size-12 shrink-0 rounded-md" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
          </TableCell>
          <TableCell className={COLUMN_CLASS.stock}><Skeleton className="h-6 w-20 rounded-full" /></TableCell>
          <TableCell><Skeleton className="ml-auto h-4 w-14" /></TableCell>
          <TableCell><Skeleton className="ml-auto h-4 w-12" /></TableCell>
        </TableRow>
      ))}
    </TableBody>
  );
}

function EmptyProducts({ filtered, onClear }: { filtered: boolean; onClear: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 py-14 text-center">
      <PackageSearch className="size-8 text-muted-foreground/50" />
      <p className="text-sm font-medium">{filtered ? 'Ningún producto coincide' : 'Aún no hay productos activos'}</p>
      <p className="text-sm text-muted-foreground">
        {filtered ? 'Prueba con otro nombre, SKU o marca.' : 'Cuando se active un producto aparecerá aquí.'}
      </p>
      {filtered ? (
        <Button type="button" variant="outline" size="sm" className="mt-1 h-9" onClick={onClear}>
          Limpiar filtros
        </Button>
      ) : null}
    </div>
  );
}

export default function CatalogoVendedor() {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState(DEFAULT_CATALOGO_VENDEDOR_STATE.search);
  const [stock, setStock] = useState<SalespersonProductStock>(DEFAULT_CATALOGO_VENDEDOR_STATE.stock);
  const [sortValue, setSortValue] = useState(SORT_OPTIONS[0].value);
  const [pageIndex, setPageIndex] = useState(0);
  const searchTimer = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const sortOption = SORT_OPTIONS.find((item) => item.value === sortValue) ?? SORT_OPTIONS[0];
  const { sortBy, sortDir } = sortOption;
  const filter = salespersonProductsFilter({ search, stock, sortBy, sortDir, pageIndex });

  const productsQuery = useQuery({
    queryKey: catalogoVendedorKey(filter),
    queryFn: () => fetchProducts(filter),
    placeholderData: keepPreviousData,
    staleTime: STALE_MS,
  });
  const data: SalespersonProductsResponse | undefined = productsQuery.data;
  const products = data?.items ?? [];
  const totalCount = Number(data?.total ?? 0) || 0;
  const commissionPercent = Number(data?.commissionPercent) || 0;
  const firstLoad = productsQuery.isPending && !data;
  const loadError = productsQuery.error ? 'No se pudo cargar el catálogo. Inténtalo otra vez.' : '';
  const filtered = Boolean(search) || stock !== 'all';

  const applySearch = (value: string, immediate = false) => {
    setSearchInput(value);
    window.clearTimeout(searchTimer.current);
    const commit = () => {
      setSearch(value.trim());
      setPageIndex(0);
    };
    if (immediate) commit();
    else searchTimer.current = window.setTimeout(commit, SEARCH_DELAY_MS);
  };

  const applyStock = (value: string) => {
    setStock(value as SalespersonProductStock);
    setPageIndex(0);
  };

  const applySortOption = (value: string) => {
    setSortValue(value);
    setPageIndex(0);
  };

  const clearFilters = () => {
    applySearch('', true);
    setStock('all');
    setPageIndex(0);
  };

  const prefetchPage = (nextPageIndex: number) => {
    const nextFilter = salespersonProductsFilter({ search, stock, sortBy, sortDir, pageIndex: nextPageIndex });
    void queryClient.prefetchQuery({
      queryKey: catalogoVendedorKey(nextFilter),
      queryFn: () => fetchProducts(nextFilter),
      staleTime: STALE_MS,
    });
  };

  const changePage = (nextPageIndex: number) => {
    setPageIndex(nextPageIndex);
    rootRef.current?.closest('main')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const table = useReactTable({
    data: products,
    columns: productColumns(commissionPercent),
    getCoreRowModel: getCoreRowModel(),
    getRowId: (product) => String(product.id),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    rowCount: totalCount,
  });

  return (
    <div ref={rootRef} className="pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="sticky -top-4 z-20 -mx-4 -mt-4 mb-3 flex flex-col gap-2 border-b border-border/70 bg-background px-4 py-3 sm:flex-row sm:items-center md:-top-6 md:-mx-6 md:-mt-6 md:px-6 lg:-top-8 lg:-mx-8 lg:-mt-8 lg:px-8">
        <div className="relative min-w-0 sm:w-[22rem]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(event) => applySearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                applySearch(searchInput, true);
              }
            }}
            placeholder="Buscar por producto, SKU o marca"
            className="h-11 px-9 sm:h-9"
            aria-label="Buscar por producto, SKU o marca"
            enterKeyHint="search"
          />
          {searchInput ? (
            <button
              type="button"
              onClick={() => applySearch('', true)}
              className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-8"
              aria-label="Limpiar búsqueda"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Select value={stock} onValueChange={applyStock}>
            <SelectTrigger className="h-11 flex-1 sm:h-9 sm:flex-none" aria-label="Filtrar por stock">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STOCK_FILTER_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sortValue} onValueChange={applySortOption}>
            <SelectTrigger className="h-11 flex-1 sm:h-9 sm:flex-none" aria-label="Ordenar productos">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {!firstLoad && !loadError ? (
          <p className="text-xs text-muted-foreground sm:ml-auto" aria-live="polite">
            {productCountLabel(totalCount, stock, search)}
          </p>
        ) : null}
      </div>

      {loadError ? (
        <div className="mb-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-3 text-sm text-destructive">
          <p>{loadError}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2 h-9 cursor-pointer"
            onClick={() => void productsQuery.refetch()}
          >
            Reintentar
          </Button>
        </div>
      ) : null}

      {loadError && !data ? null : !firstLoad && products.length === 0 ? (
        <EmptyProducts filtered={filtered} onClear={clearFilters} />
      ) : (
        <TablePanel aria-label="Productos" aria-busy={productsQuery.isFetching}>
          <Table className="table-fixed">
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="hover:bg-transparent">
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id} className={cn('h-10 text-xs', COLUMN_CLASS[header.column.id])}>
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            {firstLoad ? <TableSkeleton /> : (
              <TableBody className={cn('transition-opacity', productsQuery.isFetching && 'opacity-60')}>
                {table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className={cn('py-3', COLUMN_CLASS[cell.column.id])}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            )}
          </Table>
          {totalCount > CATALOGO_VENDEDOR_PAGE_SIZE ? (
            <DataTablePagination
              pageIndex={pageIndex}
              pageSize={CATALOGO_VENDEDOR_PAGE_SIZE}
              totalCount={totalCount}
              fetching={productsQuery.isFetching}
              onPageChange={changePage}
              onPrefetch={prefetchPage}
            />
          ) : null}
        </TablePanel>
      )}
    </div>
  );
}
