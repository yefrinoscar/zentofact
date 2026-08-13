import { FormEvent, Fragment, memo, ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ColumnDef, ExpandedState, flexRender, getCoreRowModel, getExpandedRowModel, getSortedRowModel, SortingState, useReactTable } from '@tanstack/react-table';
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Check,
  Copy,
  ImagePlus,
  Loader2,
  PackagePlus,
  RefreshCw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Store,
  X,
} from 'lucide-react';
import api from '../lib/api';
import { cn } from '../lib/cn';
import { DataTable, DataTableColumnHeader, DataTablePagination } from '../components/ui/data-table';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TablePanel, TablePanelHeader, TableRow } from '../components/ui/table';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../components/ui/sheet';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Switch } from '../components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Button } from '../components/ui/button';
import falabellaIcon from '../assets/falabella.png';

type Company = {
  id: number;
  nombre?: string | null;
  nombreComercial?: string | null;
  razonSocial?: string | null;
  activo?: boolean;
  hasFalabellaCredentials?: boolean;
};

type Listing = {
  id: number;
  productId: number;
  channelCode: string;
  companyId: number;
  companyName?: string;
  sellerSku: string;
  shopSku?: string | null;
  title?: string | null;
  status: string;
  marketplaceQuantity?: number | null;
  marketplaceSyncedAt?: string | null;
  metadata?: Record<string, unknown>;
};

type Product = {
  id: number;
  mainSku: string;
  name: string;
  description?: string | null;
  brand?: string | null;
  status: 'active' | 'inactive' | 'archived';
  imageUrl?: string | null;
  referencePrice?: number | null;
  sellerPriceMin?: number | null;
  sellerPriceMax?: number | null;
  sellerStockTotal?: number;
  quantityOnHand: number;
  quantityReserved: number;
  available: number;
  reorderPoint?: number | null;
  listingsCount?: number;
  sellersCount?: number;
  channels?: string[];
  listings?: Listing[];
  updatedAt?: string;
};

type Movement = {
  id: number;
  movementType: string;
  quantityDelta: number;
  quantityAfter: number;
  reason?: string | null;
  source: string;
  createdAt: string;
  orderId?: number | null;
};

type ActivityResponse = {
  durationMs: number;
  source: 'falabella_live' | 'local_fallback';
  hydration: {
    candidates: number;
    checked: number;
    hydrated: number;
    resolvedItems: number;
    repairedItems: number;
    failed: number;
    truncated: boolean;
    live: {
      sellersRequested: number;
      sellersSucceeded: number;
      pages: number;
      ordersReceived: number;
      failed: number;
      truncated: boolean;
      incrementalSellers: number;
      bootstrapSellers: number;
      windowDays?: number;
      queriedAt: string;
    };
    coverage: {
      sellers: number;
      orderHeaders: number;
      orderDetails: number;
      complete: boolean;
      liveVerified: boolean;
      liveQueriedAt?: string | null;
      dataUpdatedThrough?: string | null;
      lastSuccessfulSyncAt?: string | null;
    };
  };
};

type SalesSummary = ActivityResponse & {
  range: '30' | '90' | '365' | 'all';
  summary: {
    ordersCount: number;
    unitsSold: number;
    revenue: number;
    averageUnitPrice: number;
    firstSaleAt?: string | null;
    lastSaleAt?: string | null;
  };
  daily: Array<{ day: string; ordersCount: number; unitsSold: number; revenue: number }>;
  recent: Array<{
    orderId: number;
    orderNumber?: string | null;
    orderedAt?: string | null;
    companyId?: number | null;
    companyName?: string | null;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
};

type ReturnsSummary = ActivityResponse & {
  range: '30' | '90' | '365' | 'all';
  summary: {
    ordersCount: number;
    sellersCount: number;
    unitsReturned: number;
    amount: number;
  };
  recent: Array<{
    orderId: number;
    orderNumber?: string | null;
    orderedAt?: string | null;
    companyId?: number | null;
    companyName?: string | null;
    quantity: number;
    amount: number;
    reason?: string | null;
  }>;
};

const PAGE_SIZE = 20;
const SEARCH_DELAY_MS = 300;

const initialCreate = { mainSku: '', name: '', brand: '', description: '', referencePrice: '', imageUrl: '' };
const initialAdjust = { mode: 'delta', value: '', reason: '' };
const initialPublishVisual = {
  listingId: null as number | null,
  channelCode: 'falabella',
  companyId: '',
  sellerSku: '',
  price: '',
  images: [] as string[],
};

function companyName(company: Company) {
  return sellerShortName(company.nombreComercial || company.nombre || company.razonSocial || `Empresa ${company.id}`);
}

function sellerShortName(value?: string | null) {
  const fallback = String(value || '').trim();
  if (!fallback) return 'Seller';
  return fallback
    .replace(/\s+(?:E\.?\s*I\.?\s*R\.?\s*L\.?|S\.?\s*R\.?\s*L\.?|S\.?\s*A\.?\s*C\.?)\.?$/i, '')
    .replace(/\s+PER[ÚU]$/i, '')
    .replace(/^(?:INVERSIONES|IMPORTACIONES|TIENDAS)\s+/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function suggestedSellerSku(product: Product, company: Company) {
  const sellerCode = companyName(company)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/gi, '')
    .toUpperCase()
    .slice(0, 6) || 'SELLER';
  return `${sellerCode}-${company.id}-${product.mainSku}`.slice(0, 64);
}

function formatNumber(value: unknown, digits = 4) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toLocaleString('es-PE', { maximumFractionDigits: digits });
}

function formatMoney(value: unknown) {
  if (value == null || String(value).trim() === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(number);
}

function formatDuration(value: number) {
  return value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} s`;
}

function activityCaption(activity: ActivityResponse, ordersLabel: string) {
  const coverage = activity.hydration.coverage;
  const live = activity.hydration.live;
  const reviewed = coverage.complete
    ? `${coverage.orderDetails} ${ordersLabel} revisados`
    : `${coverage.orderDetails} de ${coverage.orderHeaders} ${ordersLabel} revisados`;
  const sourceText = coverage.liveVerified
    ? live.bootstrapSellers > 0
      ? `Falabella consultado ${live.windowDays || 2} días ${formatDate(coverage.liveQueriedAt)}`
      : `Cambios recientes verificados ${formatDate(coverage.liveQueriedAt)}`
    : `verificación en vivo incompleta${coverage.dataUpdatedThrough ? ` · datos locales hasta ${formatDate(coverage.dataUpdatedThrough)}` : ''}`;
  return `${sourceText} · ${reviewed} · ${formatDuration(activity.durationMs)}`;
}

function formatBasePrice(product: Product) {
  if (product.referencePrice != null) return formatMoney(product.referencePrice);
  if (product.sellerPriceMin == null) return '—';
  if (product.sellerPriceMax != null && product.sellerPriceMax !== product.sellerPriceMin) {
    return `${formatMoney(product.sellerPriceMin)} – ${formatMoney(product.sellerPriceMax)}`;
  }
  return formatMoney(product.sellerPriceMin);
}

function sellerStock(product: Product) {
  const stock = Number(product.sellerStockTotal);
  return Number.isFinite(stock) ? stock : 0;
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('es-PE');
}

function metadataNumber(listing: Listing, key: string) {
  const value = listing.metadata?.[key];
  if (value == null || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function metadataBoolean(listing: Listing, key: string) {
  return listing.metadata?.[key] === true;
}

function isActivelyPublished(listing: Listing) {
  if (listing.status !== 'active' || !metadataBoolean(listing, 'isPublished')) return false;
  return listing.channelCode !== 'falabella'
    || String(listing.metadata?.qcStatus || '').toLowerCase() === 'approved';
}

function usableBrand(value?: string | null) {
  const brand = String(value || '').trim();
  return /^(?:generic|gen[eé]rico)$/i.test(brand) ? '' : brand;
}

export default function Productos() {
  const queryClient = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [status, setStatus] = useState('active');
  const [sellerCoverage, setSellerCoverage] = useState<'all' | 'single' | 'multiple'>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [expandedRows, setExpandedRows] = useState<ExpandedState>({});
  const [copiedSku, setCopiedSku] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [productNavigationBusy, setProductNavigationBusy] = useState(false);
  const [detailTab, setDetailTab] = useState<'overview' | 'listings' | 'inventory' | 'sales' | 'returns'>('overview');
  const [salesRange, setSalesRange] = useState<'30' | '90' | '365' | 'all'>('30');
  const [modal, setModal] = useState<'create' | 'adjust' | 'image' | 'publish_visual' | 'unpublish_visual' | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [createForm, setCreateForm] = useState(initialCreate);
  const [adjustForm, setAdjustForm] = useState(initialAdjust);
  const [imageUrl, setImageUrl] = useState('');
  const [publishVisual, setPublishVisual] = useState(initialPublishVisual);
  const [unpublishListing, setUnpublishListing] = useState<Listing | null>(null);
  const [unpublishConfirmation, setUnpublishConfirmation] = useState('');
  const searchTimer = useRef(0);

  const applySearch = (value: string, immediate = false) => {
    setSearch(value);
    window.clearTimeout(searchTimer.current);
    const commit = () => {
      setSelectedId(null);
      setExpandedRows({});
      setSubmittedSearch(value.trim());
      setOffset(0);
    };
    if (immediate) commit();
    else searchTimer.current = window.setTimeout(commit, SEARCH_DELAY_MS);
  };

  const productFilters = useMemo(() => ({ submittedSearch, status, sellerCoverage, offset }), [submittedSearch, status, sellerCoverage, offset]);
  const productsQuery = useQuery({
    queryKey: ['catalog-products', productFilters],
    queryFn: () => api.listCatalogProducts({
        search: submittedSearch,
        status,
        sellerCoverage,
        limit: PAGE_SIZE,
        offset,
      }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: 1,
  });
  const companiesQuery = useQuery({
    queryKey: ['catalog-companies'],
    queryFn: () => api.listCompanies(),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const detailQuery = useQuery({
    queryKey: ['catalog-product-detail', selectedId],
    queryFn: () => api.getCatalogProduct(selectedId!),
    enabled: selectedId != null,
    staleTime: 30_000,
    retry: 1,
  });
  const movementsQuery = useQuery({
    queryKey: ['catalog-product-movements', selectedId],
    queryFn: () => api.listProductMovements(selectedId!, { limit: 100 }),
    enabled: selectedId != null && detailTab === 'inventory',
    staleTime: 30_000,
    retry: 1,
  });
  const salesQuery = useQuery({
    queryKey: ['catalog-product-sales', selectedId, salesRange],
    queryFn: () => api.getCatalogProductActivity(selectedId!, { range: salesRange, kind: 'sales' }),
    enabled: selectedId != null && detailTab === 'sales',
    staleTime: 30_000,
    retry: 1,
  });
  const returnsQuery = useQuery({
    queryKey: ['catalog-product-returns', selectedId, salesRange],
    queryFn: () => api.getCatalogProductActivity(selectedId!, { range: salesRange, kind: 'returns' }),
    enabled: selectedId != null && detailTab === 'returns',
    staleTime: 30_000,
    retry: 1,
  });

  const companies = useMemo(() => ((companiesQuery.data || []) as Company[]).filter((company) => company.activo !== false), [companiesQuery.data]);
  const products = (productsQuery.data?.products || []) as Product[];
  const totalCount = Number(productsQuery.data?.totalCount || 0);
  const detail = detailQuery.data as Product | undefined;
  const movements = (movementsQuery.data?.movements || []) as Movement[];
  const sales = salesQuery.data as SalesSummary | undefined;
  const returns = returnsQuery.data as ReturnsSummary | undefined;
  const sellers = useMemo(() => companies.filter((company) => company.hasFalabellaCredentials), [companies]);
  const selectedProduct = detail?.id === selectedId ? detail : products.find((product) => product.id === selectedId) || null;
  const selectedProductIndex = selectedId == null ? -1 : products.findIndex((product) => product.id === selectedId);
  const hasPreviousProduct = selectedProductIndex > 0 || (selectedProductIndex === 0 && offset > 0);
  const hasNextProduct = selectedProductIndex >= 0
    && (selectedProductIndex < products.length - 1 || offset + products.length < totalCount);
  const selectedProductPosition = selectedProductIndex >= 0 ? offset + selectedProductIndex + 1 : null;
  const loading = productsQuery.isPending;
  const detailLoading = detailQuery.isPending;
  const queryError = productsQuery.error || companiesQuery.error || detailQuery.error || movementsQuery.error || salesQuery.error || returnsQuery.error;

  const prefetchProductsPage = (nextOffset: number) => {
    if (nextOffset < 0 || nextOffset >= totalCount) return;
    const nextFilters = { ...productFilters, offset: nextOffset };
    void queryClient.prefetchQuery({
      queryKey: ['catalog-products', nextFilters],
      queryFn: () => api.listCatalogProducts({
        search: submittedSearch,
        status,
        sellerCoverage,
        limit: PAGE_SIZE,
        offset: nextOffset,
      }),
      staleTime: 30_000,
    });
  };

  const reloadAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['catalog-products'] }),
      selectedId ? queryClient.invalidateQueries({ queryKey: ['catalog-product-detail', selectedId] }) : Promise.resolve(),
      selectedId ? queryClient.invalidateQueries({ queryKey: ['catalog-product-movements', selectedId] }) : Promise.resolve(),
      selectedId ? queryClient.invalidateQueries({ queryKey: ['catalog-product-sales', selectedId] }) : Promise.resolve(),
      selectedId ? queryClient.invalidateQueries({ queryKey: ['catalog-product-returns', selectedId] }) : Promise.resolve(),
    ]);
  };

  const refreshMarketplaceSnapshots = async () => {
    setRefreshing(true);
    setError('');
    try {
      const result = await api.syncFalabellaCatalog();
      if (result.errors?.length) {
        setError(`Se sincronizaron ${result.listingsUpserted} publicaciones; ${result.errors.length} seller(s) no respondieron.`);
      }
      await reloadAll();
    } catch (caught: any) {
      setError(caught?.message || 'No se pudo sincronizar el catálogo publicado de Falabella.');
    } finally {
      setRefreshing(false);
    }
  };

  const openModal = (next: typeof modal) => {
    setActionError('');
    setActionMessage('');
    setModal(next);
  };

  const runAction = async (action: () => Promise<any>, success: (result: any) => string) => {
    setBusy(true);
    setActionError('');
    try {
      const result = await action();
      setActionMessage(success(result));
      await reloadAll();
      return result;
    } catch (caught: any) {
      setActionError(caught?.message || 'No se pudo completar la operación.');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const createProduct = async (event: FormEvent) => {
    event.preventDefault();
    const created = await runAction(() => api.createCatalogProduct({
      ...createForm,
      referencePrice: createForm.referencePrice || null,
    }), (result) => `Producto ${result.mainSku} creado con stock inicial 0.`);
    if (created) {
      setCreateForm(initialCreate);
      setSelectedId(created.id);
    }
  };

  const adjustInventory = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedId) return;
    const value = Number(adjustForm.value);
    const payload = adjustForm.mode === 'absolute'
      ? { absoluteTarget: value, reason: adjustForm.reason }
      : { delta: value, reason: adjustForm.reason };
    const result = await runAction(() => api.adjustProductInventory(selectedId, payload), (response) => (
      response.noChange ? 'El stock ya tenía ese valor.' : `Stock actualizado a ${formatNumber(response.quantityOnHand)}.`
    ));
    if (result) setAdjustForm(initialAdjust);
  };

  const updateProductImage = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedId) return;
    const result = await runAction(
      () => api.updateCatalogProduct(selectedId, { imageUrl: imageUrl.trim() || null }),
      () => imageUrl.trim() ? 'Foto principal actualizada.' : 'Foto principal eliminada.',
    );
    if (result) setModal(null);
  };

  const openProduct = useCallback((productId: number) => {
    setSelectedId(productId);
    setDetailTab('overview');
    setSalesRange('30');
  }, []);

  const navigateProduct = async (direction: 'previous' | 'next') => {
    if (selectedId == null || productNavigationBusy) return;
    const currentIndex = products.findIndex((product) => product.id === selectedId);
    if (currentIndex < 0) return;
    const adjacent = products[currentIndex + (direction === 'next' ? 1 : -1)];
    if (adjacent) {
      setSelectedId(adjacent.id);
      return;
    }

    const nextOffset = direction === 'next' ? offset + PAGE_SIZE : Math.max(0, offset - PAGE_SIZE);
    if (nextOffset === offset || nextOffset < 0 || nextOffset >= totalCount) return;
    setProductNavigationBusy(true);
    setError('');
    try {
      const nextFilters = { ...productFilters, offset: nextOffset };
      const page = await queryClient.fetchQuery({
        queryKey: ['catalog-products', nextFilters],
        queryFn: () => api.listCatalogProducts({
          search: submittedSearch,
          status,
          sellerCoverage,
          limit: PAGE_SIZE,
          offset: nextOffset,
        }),
        staleTime: 30_000,
      });
      const pageProducts = (page?.products || []) as Product[];
      const target = direction === 'next' ? pageProducts[0] : pageProducts.at(-1);
      if (!target) return;
      setOffset(nextOffset);
      setExpandedRows({});
      setSelectedId(target.id);
    } catch (caught: any) {
      setError(caught?.message || 'No se pudo cargar el producto siguiente.');
    } finally {
      setProductNavigationBusy(false);
    }
  };

  const openPublishVisual = (product: Product, listing?: Listing) => {
    setSelectedId(product.id);
    setPublishVisual({
      listingId: listing?.id || null,
      channelCode: listing?.channelCode || 'falabella',
      companyId: listing ? String(listing.companyId) : '',
      sellerSku: listing?.sellerSku || '',
      price: String(listing
        ? metadataNumber(listing, 'effectivePrice') ?? metadataNumber(listing, 'regularPrice') ?? metadataNumber(listing, 'price') ?? product.referencePrice ?? product.sellerPriceMin ?? ''
        : product.referencePrice ?? product.sellerPriceMin ?? ''),
      images: product.imageUrl ? [product.imageUrl] : [],
    });
    openModal('publish_visual');
  };

  const simulatePublish = (event: FormEvent) => {
    event.preventDefault();
    setActionError('');
    const seller = companies.find((company) => String(company.id) === publishVisual.companyId);
    setActionMessage(`Publicación preparada para ${seller ? companyName(seller) : 'el seller'}.`);
  };

  const columns = useMemo<ColumnDef<Product>[]>(() => [
    {
      id: 'product',
      header: 'Producto',
      cell: ({ row }) => {
        const product = row.original;
        return <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setExpandedRows((current) => {
                const next = typeof current === 'object' ? { ...current } : {};
                if (next[row.id]) delete next[row.id];
                else next[row.id] = true;
                return next;
              });
            }}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={`${row.getIsExpanded() ? 'Contraer' : 'Expandir'} ${product.name}`}
            aria-expanded={row.getIsExpanded()}
          ><ChevronRight className={cn('h-4 w-4 transition-transform', row.getIsExpanded() && 'rotate-90')} /></button>
          {product.imageUrl
            ? <img src={product.imageUrl} alt="" loading="lazy" decoding="async" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
            : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-muted"><Boxes className="h-4 w-4" /></span>}
          <span className="min-w-0 flex-1">
            <strong className="block whitespace-normal break-words text-sm leading-5">{product.name}</strong>
            <button
              type="button"
              title="Copiar SKU interno"
              aria-label={`Copiar SKU ${product.mainSku}`}
              onClick={async (event) => {
                event.stopPropagation();
                await navigator.clipboard.writeText(product.mainSku);
                setCopiedSku(product.mainSku);
                window.setTimeout(() => setCopiedSku((current) => current === product.mainSku ? null : current), 1400);
              }}
              className="mt-1 inline-flex items-center gap-1.5 font-mono text-xs font-semibold tracking-wide text-muted-foreground hover:text-foreground"
            >{product.mainSku}{copiedSku === product.mainSku ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}</button>
          </span>
        </div>;
      },
    },
    {
      id: 'price',
      header: 'Precio',
      cell: ({ row }) => <span className="text-sm font-medium">{formatBasePrice(row.original)}</span>,
    },
    {
      id: 'stock',
      header: 'Stock',
      cell: ({ row }) => {
        const product = row.original;
        const stock = sellerStock(product);
        return <div className="min-w-36">
          <p className="text-lg font-semibold leading-none">{formatNumber(stock)} <span className="text-xs font-normal text-muted-foreground">u · {product.sellersCount || 0} sellers</span></p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn('h-full rounded-full', stock > 0 ? 'bg-emerald-500' : 'bg-red-500')} style={{ width: `${Math.min(100, Math.max(4, stock))}%` }} /></div>
        </div>;
      },
    },
    {
      id: 'status',
      header: 'Estado',
      cell: ({ row }) => <StockBadge product={row.original} />,
    },
  ], [copiedSku]);

  const table = useReactTable({
    data: products,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getRowCanExpand: () => true,
    getRowId: (product) => String(product.id),
    onExpandedChange: setExpandedRows,
    manualPagination: true,
    rowCount: totalCount,
    state: {
      expanded: expandedRows,
      pagination: {
        pageIndex: Math.floor(offset / PAGE_SIZE),
        pageSize: PAGE_SIZE,
      },
    },
  });

  const visibleError = error || (queryError instanceof Error ? queryError.message : queryError ? 'No se pudo cargar el catálogo.' : '');
  const visualListingExists = Boolean(selectedProduct?.listings?.some((listing) => (
    listing.id !== publishVisual.listingId
      && listing.channelCode === publishVisual.channelCode
      && String(listing.companyId) === publishVisual.companyId
  )));

  const renderCatalogTable = () => <TablePanel aria-label="Catálogo de productos">
    <TablePanelHeader className="flex items-center justify-between py-3">
      <p className="text-sm font-semibold">{totalCount} productos</p>
      <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">{productsQuery.isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Página {Math.floor(offset / PAGE_SIZE) + 1}</span>
    </TablePanelHeader>
    {loading ? <LoadingBlock /> : products.length === 0 ? <EmptyBlock /> : (
      <div className="min-w-0" aria-busy={productsQuery.isFetching}>
        <Table className="min-w-[720px] table-fixed">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => <TableRow key={headerGroup.id} className="bg-muted/50 hover:bg-muted/50">
              {headerGroup.headers.map((header) => <TableHead key={header.id} className={cn(
                header.column.id === 'product' && 'w-[50%]',
                header.column.id === 'price' && 'w-[18%]',
                header.column.id === 'stock' && 'w-[19%]',
                header.column.id === 'status' && 'w-[13%]',
              )}>{header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}</TableHead>)}
            </TableRow>)}
          </TableHeader>
          <TableBody>{table.getRowModel().rows.map((row) => <Fragment key={row.id}>
            <TableRow
              onClick={() => openProduct(row.original.id)}
              className={cn('cursor-pointer align-middle', row.getIsExpanded() && 'bg-muted/20')}
              aria-label={`Abrir ${row.original.name}`}
            >
              {row.getVisibleCells().map((cell) => <TableCell key={cell.id} className={cell.column.id === 'product' ? 'whitespace-normal' : undefined}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}
            </TableRow>
            {row.getIsExpanded() && <TableRow className="hover:bg-transparent">
              <TableCell colSpan={row.getVisibleCells().length} className="border-b-4 border-muted bg-muted/20 p-0">
                <ExpandedProductPublications productId={row.original.id} productName={row.original.name} onOpenDetail={openProduct} />
              </TableCell>
            </TableRow>}
          </Fragment>)}</TableBody>
        </Table>
      </div>
    )}
    {totalCount > 0 ? <DataTablePagination
      pageIndex={Math.floor(offset / PAGE_SIZE)}
      pageSize={PAGE_SIZE}
      totalCount={totalCount}
      fetching={productsQuery.isFetching}
      onPageChange={(nextPage) => {
        setSelectedId(null);
        setExpandedRows({});
        setOffset(nextPage * PAGE_SIZE);
      }}
      onPrefetch={(nextPage) => prefetchProductsPage(nextPage * PAGE_SIZE)}
    /> : null}
  </TablePanel>;

  return (
    <div className="space-y-5">
      <div className="space-y-3 border-b border-border pb-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-1 gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => applySearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  applySearch(search, true);
                }
              }}
              placeholder="Buscar SKU, producto o seller"
              className="h-9 pl-9"
              aria-label="Buscar SKU, producto o seller"
            />
          </div>
          <Button type="button" variant="outline" size="icon" onClick={refreshMarketplaceSnapshots} disabled={refreshing} aria-label="Sincronizar productos publicados" title="Sincronizar productos, precios y stock publicados">
            <RefreshCw className={cn(refreshing && 'animate-spin')} />
          </Button>
          </div>
          <button onClick={() => openModal('create')} className="primary-button"><PackagePlus className="h-4 w-4" /> Nuevo producto</button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-9 items-center gap-2 pr-1 text-xs font-medium text-muted-foreground"><SlidersHorizontal className="h-4 w-4" /> Filtros</span>
          <Select value={status} onValueChange={(value) => { setSelectedId(null); setExpandedRows({}); setStatus(value); setOffset(0); }}>
            <SelectTrigger className="w-36 border-border bg-background"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Todos los estados</SelectItem><SelectItem value="active">Activos</SelectItem><SelectItem value="inactive">Inactivos</SelectItem><SelectItem value="archived">Archivados</SelectItem></SelectContent>
          </Select>
          <Select value={sellerCoverage} onValueChange={(value) => { setSelectedId(null); setExpandedRows({}); setSellerCoverage(value as typeof sellerCoverage); setOffset(0); }}>
            <SelectTrigger className="w-44 border-border bg-background"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Cualquier cobertura</SelectItem>
              <SelectItem value="single">Solo 1 seller</SelectItem>
              <SelectItem value="multiple">2 o más sellers</SelectItem>
            </SelectContent>
          </Select>
          {(status !== 'active' || sellerCoverage !== 'all' || submittedSearch) && <Button type="button" variant="outline" onClick={() => {
            window.clearTimeout(searchTimer.current);
            setSelectedId(null);
            setExpandedRows({});
            setSearch('');
            setSubmittedSearch('');
            setStatus('active');
            setSellerCoverage('all');
            setOffset(0);
          }}><X /> Limpiar</Button>}
        </div>
      </div>

      {visibleError && <Notice tone="error">{visibleError}</Notice>}

      {renderCatalogTable()}

      <ProductDrawer
        open={selectedId != null}
        product={selectedProduct}
        loading={detailLoading}
        tab={detailTab}
        onTabChange={setDetailTab}
        movements={movements}
        movementsLoading={movementsQuery.isFetching}
        sales={sales}
        salesLoading={salesQuery.isFetching}
        returns={returns}
        returnsLoading={returnsQuery.isFetching}
        salesRange={salesRange}
        onSalesRangeChange={setSalesRange}
        hasPreviousProduct={hasPreviousProduct}
        hasNextProduct={hasNextProduct}
        productPosition={selectedProductPosition}
        totalProducts={totalCount}
        productNavigationBusy={productNavigationBusy}
        onPreviousProduct={() => void navigateProduct('previous')}
        onNextProduct={() => void navigateProduct('next')}
        onClose={() => { setSelectedId(null); setDetailTab('overview'); }}
        onAdjust={() => openModal('adjust')}
        onEditImage={() => {
          setImageUrl(selectedProduct?.imageUrl || '');
          openModal('image');
        }}
        onPublish={() => selectedProduct && openPublishVisual(selectedProduct)}
        onTogglePublication={(listing) => {
          if (metadataBoolean(listing, 'isPublished')) {
            setUnpublishListing(listing);
            setUnpublishConfirmation('');
            openModal('unpublish_visual');
          } else if (selectedProduct) {
            openPublishVisual(selectedProduct, listing);
          }
        }}
      />

      {modal === 'create' && <Modal title="Nuevo producto" subtitle="Crea el producto; el stock empieza en cero." onClose={() => setModal(null)}><form onSubmit={createProduct} className="space-y-4"><div className="grid gap-3 md:grid-cols-2"><Field label="SKU interno (ej. AG3)" value={createForm.mainSku} onChange={(value) => setCreateForm({ ...createForm, mainSku: value })} required /><Field label="Nombre" value={createForm.name} onChange={(value) => setCreateForm({ ...createForm, name: value })} required /><Field label="Marca" value={createForm.brand} onChange={(value) => setCreateForm({ ...createForm, brand: value })} /><Field label="Precio" type="number" value={createForm.referencePrice} onChange={(value) => setCreateForm({ ...createForm, referencePrice: value })} /><Field label="Imagen URL" value={createForm.imageUrl} onChange={(value) => setCreateForm({ ...createForm, imageUrl: value })} className="md:col-span-2" /></div><TextArea label="Descripción" value={createForm.description} onChange={(value) => setCreateForm({ ...createForm, description: value })} /><ActionFeedback error={actionError} message={actionMessage} /><Submit busy={busy}>Crear producto</Submit></form></Modal>}

      {modal === 'adjust' && selectedProduct && <Modal title={`Ajustar stock · ${selectedProduct.mainSku}`} subtitle={`Saldo actual: ${formatNumber(selectedProduct.quantityOnHand)}. El movimiento queda auditado.`} onClose={() => setModal(null)}><form onSubmit={adjustInventory} className="space-y-4"><Select value={adjustForm.mode} onValueChange={(value) => setAdjustForm({ ...adjustForm, mode: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="delta">Sumar o restar (delta)</SelectItem><SelectItem value="absolute">Fijar saldo absoluto</SelectItem></SelectContent></Select><Field label={adjustForm.mode === 'absolute' ? 'Nuevo saldo' : 'Cantidad (+ entrada / − salida)'} type="number" value={adjustForm.value} onChange={(value) => setAdjustForm({ ...adjustForm, value })} required /><TextArea label="Motivo" value={adjustForm.reason} onChange={(value) => setAdjustForm({ ...adjustForm, reason: value })} required /><ActionFeedback error={actionError} message={actionMessage} /><Submit busy={busy}>Registrar ajuste</Submit></form></Modal>}

      {modal === 'image' && selectedProduct && <Modal title="Foto del producto" subtitle={`${selectedProduct.name} · SKU interno ${selectedProduct.mainSku}`} onClose={() => setModal(null)}><form onSubmit={updateProductImage} className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="grid h-28 w-28 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted">
            {imageUrl.trim() ? <img src={imageUrl.trim()} alt="Vista previa" className="h-full w-full object-contain" /> : <ImagePlus className="h-7 w-7 text-muted-foreground" />}
          </div>
          <div className="min-w-0 flex-1">
            <Field label="URL de la foto principal" value={imageUrl} onChange={setImageUrl} />
            <p className="mt-2 text-xs leading-5 text-muted-foreground">Se guarda en el producto interno. No modifica imágenes de publicaciones existentes.</p>
          </div>
        </div>
        <ActionFeedback error={actionError} message={actionMessage} />
        <div className="flex items-center justify-between border-t border-border pt-4">
          <button type="button" onClick={() => setImageUrl('')} className="secondary-button" disabled={!imageUrl}>Quitar foto</button>
          <button type="submit" className="primary-button" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Guardar foto</button>
        </div>
      </form></Modal>}

      {modal === 'publish_visual' && selectedProduct && <Modal title={publishVisual.listingId ? 'Editar publicación' : 'Nueva publicación'} subtitle={`${selectedProduct.name} · SKU interno ${selectedProduct.mainSku}`} onClose={() => setModal(null)}><form onSubmit={simulatePublish} className="space-y-5">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="label">Canal<Select value={publishVisual.channelCode} onValueChange={(value) => {
            setActionMessage('');
            setPublishVisual((current) => ({ ...current, listingId: null, channelCode: value }));
          }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="falabella">Falabella</SelectItem><SelectItem value="ripley">Ripley</SelectItem><SelectItem value="mercadolibre">Mercado Libre</SelectItem></SelectContent></Select></label>
          <label className="label">Seller<Select value={publishVisual.companyId} onValueChange={(value) => {
            const company = companies.find((candidate) => String(candidate.id) === value);
            setActionMessage('');
            setPublishVisual((current) => ({
              ...current,
              listingId: null,
              companyId: value,
              sellerSku: company ? suggestedSellerSku(selectedProduct, company) : '',
              price: current.price || String(selectedProduct.referencePrice ?? selectedProduct.sellerPriceMin ?? ''),
            }));
          }}><SelectTrigger><SelectValue placeholder="Selecciona seller" /></SelectTrigger><SelectContent>{companies.map((company) => <SelectItem key={company.id} value={String(company.id)}>{companyName(company)} · ID {company.id}</SelectItem>)}</SelectContent></Select></label>
          <div>
            <Field label="SKU del seller" value={publishVisual.sellerSku} onChange={(value) => setPublishVisual((current) => ({ ...current, sellerSku: value }))} required />
            <p className="mt-1.5 text-xs text-muted-foreground">Se sugiere usando el seller y su ID de empresa; puedes editarlo.</p>
          </div>
          <div>
            <Field label="Precio de publicación" type="number" value={publishVisual.price} onChange={(value) => setPublishVisual((current) => ({ ...current, price: value }))} required />
            <p className="mt-1.5 text-xs text-muted-foreground">Precio para este seller. No cambia el precio del producto maestro.</p>
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between gap-3">
            <div><p className="text-sm font-medium">Fotos de la publicación</p><p className="mt-0.5 text-xs text-muted-foreground">Puedes usar la foto principal y agregar hasta 6 imágenes para esta vista.</p></div>
            <label className="secondary-button cursor-pointer"><ImagePlus className="h-4 w-4" /> Agregar fotos<input type="file" accept="image/*" multiple className="sr-only" onChange={(event) => {
              const files = Array.from(event.target.files || []).slice(0, Math.max(0, 6 - publishVisual.images.length));
              Promise.all(files.map((file) => new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result || ''));
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(file);
              }))).then((images) => setPublishVisual((current) => ({ ...current, images: [...current.images, ...images].slice(0, 6) }))).catch(() => setActionError('No se pudieron leer las imágenes seleccionadas.'));
              event.target.value = '';
            }} /></label>
          </div>
          {publishVisual.images.length ? <ul className="mt-3 flex flex-wrap gap-2">
            {publishVisual.images.map((image, index) => <li key={`${image.slice(0, 32)}-${index}`} className="group relative h-20 w-20 overflow-hidden rounded-md border border-border bg-muted">
              <img src={image} alt={`Foto ${index + 1}`} className="h-full w-full object-cover" />
              <button type="button" onClick={() => setPublishVisual((current) => ({ ...current, images: current.images.filter((_, imageIndex) => imageIndex !== index) }))} className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-md bg-background/90 text-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" aria-label={`Quitar foto ${index + 1}`}><X className="h-3.5 w-3.5" /></button>
            </li>)}
          </ul> : <div className="mt-3 grid h-20 place-items-center rounded-md border border-dashed border-border text-xs text-muted-foreground">Sin fotos seleccionadas</div>}
        </div>
        {visualListingExists && <Notice tone="info">Este producto ya tiene una publicación asociada para esa empresa y canal.</Notice>}
        <ActionFeedback error={actionError} message={actionMessage} />
        <div className="flex justify-end border-t border-border pt-4"><button disabled={!publishVisual.companyId || !publishVisual.sellerSku.trim() || !(Number(publishVisual.price) > 0) || visualListingExists} className="primary-button" type="submit">{publishVisual.listingId ? 'Guardar cambios' : 'Agregar publicación'}</button></div>
      </form></Modal>}

      {modal === 'unpublish_visual' && unpublishListing && <Modal title="Confirmar despublicación" subtitle="Acción sensible protegida; esta versión solo simula el flujo." onClose={() => { setModal(null); setUnpublishListing(null); setUnpublishConfirmation(''); }}><form onSubmit={(event) => {
        event.preventDefault();
        setActionMessage('Simulación completada. La publicación continúa activa y no se envió ningún cambio.');
      }} className="space-y-4">
        <div className="rounded-lg bg-red-50 px-3 py-3 text-sm text-red-800"><ShieldAlert className="mr-2 inline h-4 w-4" />Despublicar puede detener ventas en <strong>{sellerShortName(unpublishListing.companyName)}</strong>. Requiere confirmación explícita.</div>
        <div className="grid grid-cols-2 gap-3 text-sm"><InfoValue label="Canal" value={channelLabel(unpublishListing.channelCode)} /><InfoValue label="SKU seller" value={unpublishListing.sellerSku} /></div>
        <Field label="Escribe DESPUBLICAR para confirmar" value={unpublishConfirmation} onChange={setUnpublishConfirmation} required />
        <ActionFeedback error={actionError} message={actionMessage} />
        <div className="flex justify-end border-t border-border pt-4"><button disabled={unpublishConfirmation !== 'DESPUBLICAR'} className="inline-flex h-9 items-center justify-center rounded-md bg-red-600 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40" type="submit">Simular despublicación</button></div>
      </form></Modal>}
    </div>
  );
}

function ProductDrawer({
  open, product, loading, tab, onTabChange, movements, movementsLoading, sales, salesLoading, returns, returnsLoading,
  salesRange, onSalesRangeChange, hasPreviousProduct, hasNextProduct, productPosition, totalProducts, productNavigationBusy,
  onPreviousProduct, onNextProduct, onClose, onAdjust, onEditImage, onPublish, onTogglePublication,
}: {
  open: boolean;
  product: Product | null;
  loading: boolean;
  tab: 'overview' | 'listings' | 'inventory' | 'sales' | 'returns';
  onTabChange: (tab: 'overview' | 'listings' | 'inventory' | 'sales' | 'returns') => void;
  movements: Movement[];
  movementsLoading: boolean;
  sales?: SalesSummary;
  salesLoading: boolean;
  returns?: ReturnsSummary;
  returnsLoading: boolean;
  salesRange: '30' | '90' | '365' | 'all';
  onSalesRangeChange: (range: '30' | '90' | '365' | 'all') => void;
  hasPreviousProduct: boolean;
  hasNextProduct: boolean;
  productPosition: number | null;
  totalProducts: number;
  productNavigationBusy: boolean;
  onPreviousProduct: () => void;
  onNextProduct: () => void;
  onClose: () => void;
  onAdjust: () => void;
  onEditImage: () => void;
  onPublish: () => void;
  onTogglePublication: (listing: Listing) => void;
}) {
  const listings = product?.listings || [];
  const publishedListings = listings.filter(isActivelyPublished);
  const publicationsByChannel = [...publishedListings.reduce((groups, listing) => {
    const current = groups.get(listing.channelCode) || [];
    current.push(listing);
    groups.set(listing.channelCode, current);
    return groups;
  }, new Map<string, Listing[]>())]
    .map(([channelCode, channelListings]) => {
      const sellers = [...channelListings.reduce((groups, listing) => {
        const current = groups.get(listing.companyId) || {
          companyId: listing.companyId,
          name: sellerShortName(listing.companyName || `Empresa ${listing.companyId}`),
          listings: [] as Listing[],
        };
        current.listings.push(listing);
        groups.set(listing.companyId, current);
        return groups;
      }, new Map<number, { companyId: number; name: string; listings: Listing[] }>()).values()]
        .sort((a, b) => a.name.localeCompare(b.name, 'es'));
      return { channelCode, sellers };
    })
    .sort((a, b) => channelLabel(a.channelCode).localeCompare(channelLabel(b.channelCode), 'es'));

  return <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
    <SheetContent className="sm:max-w-3xl">
      <SheetHeader className="border-b border-border px-5 py-4 pr-16">
        <div className="grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 sm:grid-cols-[3.5rem_minmax(0,1fr)_auto]">
          <button type="button" onClick={onEditImage} className="group relative h-14 w-14 overflow-hidden rounded-lg bg-muted" aria-label="Cambiar foto del producto" title="Cambiar foto">
            {product?.imageUrl
              ? <img src={product.imageUrl} alt="" className="h-full w-full object-cover" />
              : <span className="grid h-full w-full place-items-center"><Boxes className="h-5 w-5" /></span>}
            <span className="absolute inset-x-0 bottom-0 grid h-5 place-items-center bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"><ImagePlus className="h-3.5 w-3.5" /></span>
          </button>
          <div className="min-w-0">
            <SheetTitle className="pr-2 leading-6">{product?.name || 'Producto'}</SheetTitle>
            <SheetDescription className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">SKU interno</span>
              <span className="font-mono text-sm font-semibold text-foreground">{product?.mainSku || '—'}</span>
              {product && <StatusBadge value={product.status} />}
            </SheetDescription>
          </div>
          <nav aria-label="Navegación entre productos" className="col-start-2 flex items-center sm:col-start-3 sm:row-start-1 sm:justify-end">
            <div className="inline-flex h-11 items-center rounded-lg bg-muted/80 p-0.5 sm:h-9">
              <Button variant="ghost" size="icon-sm" className="size-10 sm:size-8" disabled={!hasPreviousProduct || productNavigationBusy} onClick={onPreviousProduct} aria-label="Producto anterior" title="Producto anterior"><ChevronLeft /></Button>
              <span className="min-w-16 px-2 text-center text-xs font-medium tabular-nums text-muted-foreground" aria-live="polite">{productPosition ? `${productPosition} / ${totalProducts}` : `— / ${totalProducts}`}</span>
              <Button variant="ghost" size="icon-sm" className="size-10 sm:size-8" disabled={!hasNextProduct || productNavigationBusy} onClick={onNextProduct} aria-label="Siguiente producto" title="Siguiente producto">{productNavigationBusy ? <Loader2 className="animate-spin" /> : <ChevronRight />}</Button>
            </div>
          </nav>
        </div>
      </SheetHeader>

      {!product || loading ? <LoadingBlock /> : <Tabs value={tab} onValueChange={(value) => onTabChange(value as typeof tab)} className="min-h-0 flex-1 gap-0 overflow-hidden">
        <div className="shrink-0 border-b border-border px-5 py-3">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="overview">Resumen</TabsTrigger>
            <TabsTrigger value="listings">Publicaciones <span className="text-xs text-muted-foreground">{publishedListings.length}</span></TabsTrigger>
            <TabsTrigger value="inventory">Inventario</TabsTrigger>
            <TabsTrigger value="sales">Ventas</TabsTrigger>
            <TabsTrigger value="returns">Devoluciones</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="min-h-0 overflow-y-auto">
          <div className="grid grid-cols-2 border-b border-border md:grid-cols-4">
            <Metric label="Stock sellers" value={`${formatNumber(sellerStock(product))} u`} />
            <Metric label="Precio" value={formatBasePrice(product)} />
            <Metric label="Sellers" value={String(product.sellersCount || 0)} />
            <Metric label="Publicadas" value={String(publishedListings.length)} />
          </div>
          <section className="border-b border-border px-5 py-5">
            <div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">Publicado en</h3><p className="mt-1 text-xs text-muted-foreground">Canales y sellers con una publicación activa.</p></div><button type="button" onClick={onPublish} className="primary-button h-8 px-3"><PackagePlus className="h-4 w-4" /> Nueva publicación</button></div>
            {publicationsByChannel.length ? <div className="mt-4 space-y-3">
              {publicationsByChannel.map(({ channelCode, sellers: channelSellers }) => <article key={channelCode} className="rounded-lg bg-muted/40 p-4">
                <header className="flex flex-wrap items-center gap-2">
                  <ChannelBadge value={channelCode} />
                  <span className="text-xs text-muted-foreground">{channelSellers.length} seller{channelSellers.length === 1 ? '' : 's'} activos</span>
                </header>
                <ul className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
                  {channelSellers.map((seller) => <li key={seller.companyId} className="flex min-w-0 items-start gap-2.5">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-sm font-semibold leading-5">{seller.name}</p>
                      <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                        {seller.listings.length === 1 ? `SKU ${seller.listings[0].sellerSku}` : `${seller.listings.length} publicaciones`}
                      </p>
                    </div>
                  </li>)}
                </ul>
              </article>)}
            </div> : <p className="mt-4 text-sm text-muted-foreground">Aún no está publicado en ningún seller.</p>}
          </section>
          <section className="border-b border-border px-5 py-5">
            <h3 className="text-sm font-semibold">Información</h3>
            <div className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2">
              <InfoValue label="SKU interno" value={product.mainSku} />
              <InfoValue label="Marca" value={usableBrand(product.brand) || '—'} />
              <InfoValue label="Unidad" value="Unidad" />
              <InfoValue label="Actualizado" value={formatDate(product.updatedAt)} />
              <InfoValue label="Stock disponible" value={`${formatNumber(product.available)} u`} />
              <InfoValue label="Stock reservado" value={`${formatNumber(product.quantityReserved)} u`} />
            </div>
          </section>
          <section className="px-5 py-5"><h3 className="text-sm font-semibold">Descripción</h3><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{product.description || 'Sin descripción.'}</p></section>
        </TabsContent>

        <TabsContent value="listings" className="min-h-0 overflow-y-auto">
          <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><p className="text-sm font-semibold">{publishedListings.length} publicaciones</p><p className="mt-0.5 text-xs text-muted-foreground">Una publicación activa por seller.</p></div><button type="button" onClick={onPublish} className="primary-button h-8 px-3"><PackagePlus className="h-4 w-4" /> Nueva publicación</button></div>
          {!publishedListings.length ? <div className="px-5 py-12 text-center"><Store className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-3 text-sm font-medium">Sin publicaciones</p><p className="mt-1 text-xs text-muted-foreground">Prepara una publicación para Falabella, Ripley o Mercado Libre.</p></div> : publishedListings.map((listing) => {
            const isPublished = metadataBoolean(listing, 'isPublished');
            return <article key={listing.id} className="border-b-[6px] border-muted px-5 py-5 last:border-b-0">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="text-base">{sellerShortName(listing.companyName || `Empresa ${listing.companyId}`)}</strong><ChannelBadge value={listing.channelCode} /></div><p className="mt-2 line-clamp-2 text-sm font-medium leading-5">{listing.title || product.name}</p></div>
                <div className="flex shrink-0 items-center gap-3"><span className={cn('text-xs font-medium', isPublished ? 'text-emerald-700' : 'text-muted-foreground')}>{isPublished ? 'Publicada' : 'No publicada'}</span><Switch checked={isPublished} onCheckedChange={() => onTogglePublication(listing)} aria-label={`${isPublished ? 'Despublicar' : 'Publicar'} en ${sellerShortName(listing.companyName)}`} /></div>
              </div>
              <div className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-[minmax(0,1fr)_110px_130px]">
                <dl className="grid min-w-0 grid-cols-2 gap-4">
                  <div><dt className="text-[11px] uppercase tracking-wide text-muted-foreground">SKU del seller</dt><dd className="mt-1 truncate font-mono text-sm font-medium text-foreground">{listing.sellerSku}</dd></div>
                  <div><dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Shop SKU</dt><dd className="mt-1 truncate font-mono text-sm text-muted-foreground">{listing.shopSku || '—'}</dd></div>
                </dl>
                <div><span className="text-[11px] uppercase tracking-wide text-muted-foreground">Precio</span><SellerPrice listing={listing} /></div>
                <div><span className="text-[11px] uppercase tracking-wide text-muted-foreground">Stock seller</span><SellerStock listing={listing} /></div>
              </div>
            </article>;
          })}
        </TabsContent>

        <TabsContent value="inventory" className="min-h-0 overflow-y-auto">
          <div className="grid grid-cols-3 border-b border-border"><Metric label="En almacén" value={`${formatNumber(product.quantityOnHand)} u`} /><Metric label="Reservado" value={`${formatNumber(product.quantityReserved)} u`} /><Metric label="Disponible" value={`${formatNumber(product.available)} u`} /></div>
          <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><p className="text-sm font-semibold">Movimientos</p><p className="mt-0.5 text-xs text-muted-foreground">Historial auditable del inventario.</p></div><button type="button" onClick={onAdjust} className="secondary-button h-8 px-3"><CircleDollarSign className="h-4 w-4" /> Ajustar stock</button></div>
          {movementsLoading ? <LoadingBlock /> : movements.length === 0 ? <p className="px-5 py-10 text-center text-sm text-muted-foreground">No hay movimientos registrados.</p> : movements.map((movement) => <div key={movement.id} className="flex items-start justify-between gap-3 border-b border-border px-5 py-3 last:border-b-0"><div><p className="text-sm font-medium">{movementLabel(movement.movementType)}</p><p className="mt-1 text-xs text-muted-foreground">{movement.reason || movement.source}{movement.orderId ? ` · pedido ${movement.orderId}` : ''} · {formatDate(movement.createdAt)}</p></div><div className="text-right"><p className={cn('font-mono text-sm font-semibold', movement.quantityDelta > 0 ? 'text-emerald-600' : 'text-red-600')}>{movement.quantityDelta > 0 ? '+' : ''}{formatNumber(movement.quantityDelta)}</p><small className="text-muted-foreground">saldo {formatNumber(movement.quantityAfter)}</small></div></div>)}
        </TabsContent>

        <TabsContent value="sales" className="min-h-0 overflow-y-auto">
          <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><p className="text-sm font-semibold">Ventas del producto</p><p className="mt-0.5 text-xs text-muted-foreground">{sales ? activityCaption(sales, 'pedidos del periodo') : 'Consulta bajo demanda.'}</p></div><Select value={salesRange} onValueChange={(value) => onSalesRangeChange(value as typeof salesRange)}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="30">30 días</SelectItem><SelectItem value="90">90 días</SelectItem><SelectItem value="365">12 meses</SelectItem><SelectItem value="all">Todo</SelectItem></SelectContent></Select></div>
          {salesLoading || !sales ? <LoadingBlock /> : <>
            <div className="grid grid-cols-2 border-b border-border md:grid-cols-4"><Metric label="Unidades" value={formatNumber(sales.summary.unitsSold)} /><Metric label="Pedidos" value={formatNumber(sales.summary.ordersCount)} /><Metric label="Ingresos" value={formatMoney(sales.summary.revenue)} /><Metric label="Precio promedio" value={formatMoney(sales.summary.averageUnitPrice)} /></div>
            {sales.summary.ordersCount === 0 ? <div className="px-5 py-12 text-center"><BarChart3 className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-3 text-sm font-medium">{sales.hydration.coverage.complete ? 'Sin ventas en este periodo' : 'Consulta todavía incompleta'}</p><p className="mt-1 text-xs text-muted-foreground">{sales.hydration.coverage.complete ? 'Se revisaron los pedidos disponibles de los sellers asociados.' : 'Faltan detalles de pedidos por revisar; vuelve a intentarlo.'}</p></div> : <ProductSalesTable sales={sales.recent} />}
            {sales.hydration?.failed ? <p className="px-5 py-3 text-xs text-amber-700">No se pudieron consultar {sales.hydration.failed} pedidos; vuelve a intentar para completar el periodo.</p> : null}
          </>}
        </TabsContent>

        <TabsContent value="returns" className="min-h-0 overflow-y-auto">
          <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><p className="text-sm font-semibold">Devoluciones del producto</p><p className="mt-0.5 text-xs text-muted-foreground">{returns ? activityCaption(returns, 'pedidos devueltos') : 'Consulta bajo demanda.'}</p></div><Select value={salesRange} onValueChange={(value) => onSalesRangeChange(value as typeof salesRange)}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="30">30 días</SelectItem><SelectItem value="90">90 días</SelectItem><SelectItem value="365">12 meses</SelectItem><SelectItem value="all">Todo</SelectItem></SelectContent></Select></div>
          {returnsLoading || !returns ? <LoadingBlock /> : <>
            <div className="grid grid-cols-2 border-b border-border md:grid-cols-4"><Metric label="Unidades devueltas" value={formatNumber(returns.summary.unitsReturned)} /><Metric label="Pedidos" value={formatNumber(returns.summary.ordersCount)} /><Metric label="Monto asociado" value={formatMoney(returns.summary.amount)} /><Metric label="Sellers" value={formatNumber(returns.summary.sellersCount)} /></div>
            {returns.summary.ordersCount === 0 ? <div className="px-5 py-12 text-center"><RefreshCw className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-3 text-sm font-medium">{returns.hydration.coverage.complete ? 'Sin devoluciones en este periodo' : 'Consulta todavía incompleta'}</p><p className="mt-1 text-xs text-muted-foreground">{returns.hydration.coverage.complete ? `Ninguno de los ${returns.hydration.coverage.orderDetails} pedidos devueltos revisados corresponde a este producto.` : 'Faltan detalles de devoluciones por revisar; vuelve a intentarlo.'}</p></div> : <section><div className="border-b border-border px-5 py-3"><h3 className="text-sm font-semibold">Devoluciones recientes</h3></div>{returns.recent.map((returned) => <div key={returned.orderId} className="flex items-start justify-between gap-4 border-b border-border px-5 py-3"><div className="min-w-0"><p className="truncate text-sm font-medium">Pedido {returned.orderNumber || returned.orderId}</p><p className="mt-1 text-xs text-muted-foreground">{sellerShortName(returned.companyName)} · {formatDate(returned.orderedAt)}</p>{returned.reason ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{returned.reason}</p> : null}</div><div className="shrink-0 text-right"><p className="text-sm font-semibold">{formatMoney(returned.amount)}</p><p className="text-xs text-muted-foreground">{formatNumber(returned.quantity)} u</p></div></div>)}</section>}
            {returns.hydration.failed ? <p className="px-5 py-3 text-xs text-amber-700">No se pudieron consultar {returns.hydration.failed} pedidos; vuelve a intentar para completar el periodo.</p> : null}
          </>}
        </TabsContent>
      </Tabs>}
    </SheetContent>
  </Sheet>;
}

function ProductSalesTable({ sales }: { sales: SalesSummary['recent'] }) {
  return <section aria-labelledby="recent-product-sales-title">
    <div className="border-b border-border px-5 py-3">
      <h3 id="recent-product-sales-title" className="text-sm font-semibold">Ventas recientes</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">Detalle por pedido, vendedor y fecha.</p>
    </div>

    <div className="hidden sm:block">
      <Table className="table-fixed">
        <colgroup>
          <col className="w-[24%]" />
          <col className="w-[22%]" />
          <col className="w-[26%]" />
          <col className="w-[12%]" />
          <col className="w-[16%]" />
        </colgroup>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-10 px-5 text-[11px] uppercase tracking-wide">Pedido</TableHead>
            <TableHead className="h-10 px-3 text-[11px] uppercase tracking-wide">Vendedor</TableHead>
            <TableHead className="h-10 px-3 text-[11px] uppercase tracking-wide">Fecha y hora</TableHead>
            <TableHead className="h-10 px-3 text-right text-[11px] uppercase tracking-wide">Unidades</TableHead>
            <TableHead className="h-10 px-5 text-right text-[11px] uppercase tracking-wide">Importe</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sales.map((sale) => <TableRow key={sale.orderId}>
            <TableCell className="px-5 py-3 font-medium tabular-nums">{sale.orderNumber || sale.orderId}</TableCell>
            <TableCell className="px-3 py-3 whitespace-normal font-medium leading-5">{sellerShortName(sale.companyName)}</TableCell>
            <TableCell className="px-3 py-3 whitespace-normal text-xs leading-5 text-muted-foreground">{formatDate(sale.orderedAt)}</TableCell>
            <TableCell className="px-3 py-3 text-right tabular-nums">{formatNumber(sale.quantity)}</TableCell>
            <TableCell className="px-5 py-3 text-right font-semibold tabular-nums">{formatMoney(sale.total)}</TableCell>
          </TableRow>)}
        </TableBody>
      </Table>
    </div>

    <div className="divide-y divide-border sm:hidden">
      {sales.map((sale) => <article key={sale.orderId} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 px-5 py-4">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Pedido</p>
          <p className="mt-1 truncate text-sm font-semibold tabular-nums">{sale.orderNumber || sale.orderId}</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Importe</p>
          <p className="mt-1 text-sm font-semibold tabular-nums">{formatMoney(sale.total)}</p>
        </div>
        <div className="min-w-0">
          <p className="line-clamp-2 text-sm font-medium leading-5">{sellerShortName(sale.companyName)}</p>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{formatDate(sale.orderedAt)}</p>
        </div>
        <div className="self-end text-right">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Unidades</p>
          <p className="mt-1 text-sm tabular-nums">{formatNumber(sale.quantity)}</p>
        </div>
      </article>)}
    </div>
  </section>;
}

const ExpandedProductPublications = memo(function ExpandedProductPublications({ productId, productName, onOpenDetail }: { productId: number; productName: string; onOpenDetail: (productId: number) => void }) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const detailQuery = useQuery({
    queryKey: ['catalog-product-detail', productId],
    queryFn: () => api.getCatalogProduct(productId),
    staleTime: 30_000,
    retry: 1,
  });
  const detailListings = (detailQuery.data as Product | undefined)?.listings;
  const listings = useMemo(
    () => ((detailListings || []) as Listing[]).filter(isActivelyPublished),
    [detailListings],
  );
  const columns = useMemo<ColumnDef<Listing>[]>(() => [
    {
      id: 'publishedName',
      accessorFn: (listing) => listing.title || productName,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Nombre publicado" />,
      cell: ({ row }) => <p className="whitespace-normal break-words font-medium leading-5">{row.original.title || productName}</p>,
    },
    {
      accessorKey: 'channelCode',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Canal" />,
      cell: ({ row }) => <ChannelBadge value={row.original.channelCode} />,
    },
    {
      id: 'seller',
      accessorFn: (listing) => sellerShortName(listing.companyName || `Empresa ${listing.companyId}`),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Seller" />,
      cell: ({ row }) => <span className="inline-flex rounded-md border border-border bg-muted/70 px-2 py-1 text-xs font-semibold leading-none" title={row.original.companyName || undefined}>
        {sellerShortName(row.original.companyName || `Empresa ${row.original.companyId}`)}
      </span>,
    },
    {
      accessorKey: 'sellerSku',
      header: ({ column }) => <DataTableColumnHeader column={column} title="SKU del seller" />,
      cell: ({ row }) => <span className="break-all font-mono text-sm tabular-nums">{row.original.sellerSku}</span>,
    },
    {
      id: 'price',
      accessorFn: (listing) => metadataNumber(listing, 'effectivePrice') ?? metadataNumber(listing, 'regularPrice') ?? 0,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Precio" className="ml-auto" />,
      cell: ({ row }) => <SellerPrice listing={row.original} />,
    },
    {
      id: 'stock',
      accessorFn: (listing) => listing.marketplaceQuantity ?? 0,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Stock seller" className="ml-auto" />,
      cell: ({ row }) => <SellerStock listing={row.original} />,
    },
  ], [productName]);
  const table = useReactTable({
    data: listings,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
  });

  return <div className="px-5 py-4 md:pl-[5.5rem]">
    <div className="flex items-center justify-between gap-3">
      <div><p className="text-sm font-semibold">Sellers</p><p className="mt-0.5 text-xs text-muted-foreground">{listings.length ? `${listings.length} publicaciones asociadas` : `Publicaciones de ${productName}`}</p></div>
      <Button type="button" variant="outline" size="sm" onClick={() => onOpenDetail(productId)}>Ver detalle</Button>
    </div>
    <div className="mt-3">
      {detailQuery.isError
        ? <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">No se pudieron cargar las publicaciones.</div>
        : <DataTable
          table={table}
          loading={detailQuery.isPending}
          fetching={detailQuery.isFetching && !detailQuery.isPending}
          aria-label={`Publicaciones de ${productName}`}
          header={<div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold">{listings.length} publicaciones</p><span className="text-xs text-muted-foreground">Página 1</span></div>}
          empty={<div className="py-10 text-center"><p className="text-sm font-medium">Sin publicaciones asociadas</p><p className="mt-1 text-sm text-muted-foreground">Este producto todavía no tiene publicaciones activas.</p></div>}
          columnClassNames={{ publishedName: 'w-[34%]', channelCode: 'w-[8%]', seller: 'w-[14%]', sellerSku: 'w-[16%]', price: 'w-[13%] text-right', stock: 'w-[15%] text-right' }}
          cellClassNames={{ publishedName: 'whitespace-normal align-top', channelCode: 'align-top', seller: 'align-top', sellerSku: 'align-top', price: 'text-right align-top', stock: 'text-right align-top' }}
        />}
    </div>
  </div>;
});

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 border-r border-border px-4 py-4 last:border-r-0"><p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 truncate text-base font-semibold">{value}</p></div>;
}

function InfoValue({ label, value }: { label: string; value: ReactNode }) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><div className="mt-1 text-sm font-medium">{value}</div></div>;
}

function SellerPrice({ listing }: { listing: Listing }) {
  const regularPrice = metadataNumber(listing, 'regularPrice');
  const offerPrice = metadataNumber(listing, 'offerPrice');
  const effectivePrice = metadataNumber(listing, 'effectivePrice') ?? metadataNumber(listing, 'price');
  const offerIsActive = metadataBoolean(listing, 'offerIsActive') && offerPrice != null;
  if (effectivePrice == null && regularPrice == null) return <span className="text-muted-foreground">—</span>;
  return <div>
    <strong className="block text-sm">{formatMoney(effectivePrice ?? regularPrice)}</strong>
    {offerIsActive && regularPrice != null && regularPrice !== offerPrice
      ? <small className="block text-muted-foreground"><span className="line-through">{formatMoney(regularPrice)}</span> · oferta</small>
      : <small className="block text-muted-foreground">precio vigente</small>}
  </div>;
}

function SellerStock({ listing }: { listing: Listing }) {
  const sellerStock = metadataNumber(listing, 'sellerWarehouseQuantity');
  const fulfillmentStock = metadataNumber(listing, 'fulfillmentQuantity');
  const fromGetStock = listing.metadata?.stockSource === 'falabella_get_stock';
  return <div>
    <strong className="block text-sm">{formatNumber(listing.marketplaceQuantity)} u</strong>
    <small className="block leading-4 text-muted-foreground">
      {fromGetStock
        ? `Seller ${formatNumber(sellerStock ?? 0)} · FBF ${formatNumber(fulfillmentStock ?? 0)}`
        : 'snapshot pendiente'}
    </small>
  </div>;
}

function ChannelBadge({ value }: { value: string }) {
  const normalized = String(value || 'externo').toLowerCase();
  if (normalized === 'falabella') {
    return <span className="inline-flex rounded-md bg-muted p-0.5" title="Falabella"><img src={falabellaIcon} alt="Falabella" className="h-5 w-5 rounded-[3px]" /></span>;
  }
  const classes = normalized === 'ripley'
    ? 'bg-fuchsia-50 text-fuchsia-700'
    : normalized === 'mercadolibre'
      ? 'bg-amber-50 text-amber-800'
      : 'bg-slate-100 text-slate-700';
  return <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium', classes)}>{channelLabel(normalized)}</span>;
}

function channelLabel(value: string) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'falabella') return 'Falabella';
  if (normalized === 'ripley') return 'Ripley';
  if (normalized === 'mercadolibre') return 'Mercado Libre';
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : 'Externo';
}

function StockBadge({ product }: { product: Product }) {
  const stock = sellerStock(product);
  const classes = stock <= 0 ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700';
  return <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', classes)}><span className="h-2 w-2 rounded-full bg-current" />{stock <= 0 ? 'Sin stock' : 'En stock'}</span>;
}

function movementLabel(type: string) {
  return ({ sale: 'Venta', sale_adjust: 'Ajuste de venta', sale_reversal: 'Reversa de venta', adjustment_in: 'Entrada manual', adjustment_out: 'Salida manual', return: 'Devolución', initial: 'Stock inicial', import: 'Importación' } as Record<string, string>)[type] || type;
}

function Modal({ title, subtitle, onClose, children, wide = false }: { title: string; subtitle: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return <Dialog open onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
    <DialogContent
      overlayClassName="z-[70]"
      className={cn('z-[70] max-h-[92vh] gap-0 overflow-hidden p-0', wide ? 'sm:max-w-4xl' : 'sm:max-w-xl')}
      onKeyDownCapture={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <DialogHeader className="border-b border-border px-5 py-4 pr-14">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{subtitle}</DialogDescription>
      </DialogHeader>
      <div className="max-h-[calc(92vh-78px)] overflow-y-auto p-5">{children}</div>
    </DialogContent>
  </Dialog>;
}

function Field({ label, value, onChange, required, type = 'text', className }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; type?: string; className?: string }) {
  return <label className={cn('label', className)}>{label}{required && ' *'}<input className="field" type={type} step={type === 'number' ? 'any' : undefined} value={value} onChange={(event) => onChange(event.target.value)} required={required} /></label>;
}

function TextArea({ label, value, onChange, required }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return <label className="label">{label}{required && ' *'}<textarea className="field min-h-24 py-2" value={value} onChange={(event) => onChange(event.target.value)} required={required} /></label>;
}

function Submit({ busy, children }: { busy: boolean; children: ReactNode }) {
  return <div className="flex justify-end border-t border-border pt-4"><button disabled={busy} className="primary-button" type="submit">{busy && <Loader2 className="h-4 w-4 animate-spin" />}{children}</button></div>;
}

function ActionFeedback({ error, message }: { error: string; message: string }) {
  return <>{error && <Notice tone="error">{error}</Notice>}{message && <Notice tone="success">{message}</Notice>}</>;
}

function Notice({ tone, children }: { tone: 'error' | 'success' | 'info'; children: ReactNode }) {
  const classes = tone === 'error' ? 'border-red-200 bg-red-50 text-red-700' : tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-sky-200 bg-sky-50 text-sky-700';
  return <div className={cn('flex items-start gap-2 rounded-lg border px-3 py-2 text-sm', classes)}>{tone === 'error' && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}{children}</div>;
}

function StatusBadge({ value }: { value: string }) {
  const normalized = String(value || '').toLowerCase();
  const classes = normalized === 'active' || normalized === 'published' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : normalized === 'archived' || normalized === 'unlinked' ? 'border-slate-200 bg-slate-100 text-slate-600' : 'border-amber-200 bg-amber-50 text-amber-700';
  return <span className={cn('inline-flex rounded-md border px-2 py-0.5 text-xs font-medium', classes)}>{normalized === 'published' ? 'Publicado' : normalized === 'active' ? 'Activo' : normalized === 'inactive' ? 'Inactivo' : normalized === 'archived' ? 'Archivado' : normalized === 'unlinked' ? 'Desvinculado' : value}</span>;
}

function LoadingBlock() { return <div className="grid min-h-48 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>; }
function EmptyBlock() { return <div className="grid min-h-64 place-items-center p-8 text-center"><div><Boxes className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-3 text-sm font-medium">No hay productos para estos filtros.</p><p className="mt-1 text-xs text-muted-foreground">Crea uno o importa listings desde Falabella.</p></div></div>; }
