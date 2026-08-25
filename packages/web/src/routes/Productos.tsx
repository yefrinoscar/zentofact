import { FormEvent, Fragment, memo, ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ColumnDef, ExpandedState, flexRender, getCoreRowModel, getExpandedRowModel, useReactTable } from '@tanstack/react-table';
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Check,
  Copy,
  ExternalLink,
  ImagePlus,
  Loader2,
  Maximize2,
  MoreHorizontal,
  PackagePlus,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Store,
  X,
} from 'lucide-react';
import api from '../lib/api';
import { cn } from '../lib/cn';
import { sellerShortName } from '../lib/seller-name';
import { sellerPublicationRowBorderClass } from '../lib/seller-publication-row';
import {
  UNPUBLISH_CONFIRMATION_TEXT,
  publicationPreviewCopy,
  simulatePublicationPreview,
} from '../lib/publication-preview';
import { marketplaceProductUrl } from '../lib/marketplace-url';
import {
  CatalogFilters,
  CATALOG_SORT_REQUESTS,
  type CatalogSort,
  type CatalogStatusFilter,
  type InventoryStatusFilter,
  type PublicationStatusFilter,
  type SellerCoverageFilter,
} from '../components/CatalogFilters';
import { CatalogInventoryKpis, type CatalogInventorySummary } from '../components/CatalogInventoryKpis';
import { DataTablePagination } from '../components/ui/data-table';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Skeleton } from '../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TablePanel, TableRow } from '../components/ui/table';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../components/ui/sheet';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Switch } from '../components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu';
import falabellaIcon from '../assets/falabella.png';

type Company = {
  id: number;
  nombre?: string | null;
  nombreComercial?: string | null;
  razonSocial?: string | null;
  activo?: boolean;
  hasFalabellaCredentials?: boolean;
  hasRipleyCredentials?: boolean;
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
  candidateKey?: string;
  candidateSource?: 'catalog' | 'remote';
  imageUrl?: string | null;
};

type AssociationAvailability = 'recommended' | 'all';
type AssociationChannel = 'all' | 'falabella' | 'ripley';
type Product = {
  id: number;
  mainSku: string;
  name: string;
  description?: string | null;
  brand?: string | null;
  status: 'active' | 'inactive' | 'archived';
  imageUrl?: string | null;
  referencePrice?: number | null;
  commissionAmount?: number | null;
  profitOwner?: string | null;
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

type ProductImagePreview = {
  src: string;
  productName: string;
  sku: string;
};

type Movement = {
  id: number;
  movementType: string;
  quantityDelta: number;
  quantityAfter: number;
  reason?: string | null;
  source: string;
  effectiveAt?: string | null;
  createdAt: string;
  orderId?: number | null;
  orderNumber?: string | null;
  sku?: string | null;
  companyName?: string | null;
  channelCode?: string | null;
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
const ASSOCIATION_PAGE_SIZE = 20;
const SEARCH_DELAY_MS = 300;
const CATALOG_COLUMN_CLASS_NAMES = {
  product: 'w-full sm:w-[48%]',
  price: 'hidden sm:table-cell sm:w-[14%]',
  stock: 'hidden sm:table-cell sm:w-[18%]',
  status: 'hidden whitespace-normal sm:table-cell sm:w-[20%]',
} as const;

const initialCreate = {
  mainSku: '',
  name: '',
  brand: '',
  description: '',
  referencePrice: '',
  commissionAmount: '',
  profitOwner: '',
  imageUrl: '',
};
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
  const value = listing.metadata?.[key];
  return value === true || String(value ?? '').trim().toLowerCase() === 'true' || String(value ?? '').trim() === '1';
}

function metadataStatus(listing: Listing, key: string) {
  return String(listing.metadata?.[key] || '').trim().toLowerCase();
}

function isActivelyPublished(listing: Listing) {
  if (String(listing.status).toLowerCase() !== 'active' || !metadataBoolean(listing, 'isPublished')) return false;
  if (listing.metadata?.isSellable === false) return false;
  if (String(listing.channelCode).toLowerCase() !== 'falabella') return true;
  return metadataStatus(listing, 'status') === 'active'
    && metadataStatus(listing, 'marketplaceStatus') === 'active'
    && metadataStatus(listing, 'qcStatus') === 'approved';
}

function publicationPresentation(listing: Listing) {
  if (isActivelyPublished(listing)) {
    return { visible: true, label: 'Visible', className: 'text-emerald-700 dark:text-emerald-300' };
  }
  if (String(listing.status).toLowerCase() !== 'active') {
    return { visible: false, label: 'Listing inactivo', className: 'text-muted-foreground' };
  }
  if (listing.metadata?.isSellable === false) {
    return { visible: false, label: sellabilityLabel(listing), className: 'text-amber-700 dark:text-amber-300' };
  }
  if (!metadataBoolean(listing, 'isPublished')) {
    return { visible: false, label: 'No publicada', className: 'text-muted-foreground' };
  }
  if (String(listing.channelCode).toLowerCase() === 'falabella'
    && metadataStatus(listing, 'qcStatus') !== 'approved') {
    return { visible: false, label: 'Pendiente de aprobación', className: 'text-amber-700 dark:text-amber-300' };
  }
  return { visible: false, label: 'No visible', className: 'text-muted-foreground' };
}

function sellabilityLabel(listing: Listing) {
  const reason = String(listing.metadata?.sellabilityReason || '').trim();
  if (reason === 'qc_not_approved') return 'No autorizada';
  if (reason === 'not_published') return 'No publicada';
  if (reason === 'business_unit_not_active') return 'Unidad inactiva';
  if (reason === 'product_not_active') return 'Producto inactivo';
  return 'No vendible';
}

function usableBrand(value?: string | null) {
  const brand = String(value || '').trim();
  return /^(?:generic|gen[eé]rico)$/i.test(brand) ? '' : brand;
}

type ProductEditableField = 'commissionAmount' | 'profitOwner';

type UpdateProductFieldVariables = {
  id: number;
  patch: Record<string, unknown>;
  optimistic: {
    field: ProductEditableField;
    patch: Partial<Pick<Product, 'commissionAmount' | 'profitOwner'>>;
  };
};

type CatalogProductsPage = {
  products: Product[];
  totalCount: number;
  summary?: CatalogInventorySummary;
};

function patchProductCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  productId: number,
  patch: Partial<Pick<Product, 'commissionAmount' | 'profitOwner'>>,
) {
  queryClient.setQueryData(['catalog-product-detail', productId], (current: Product | undefined) => (
    current?.id === productId ? { ...current, ...patch } : current
  ));
  queryClient.setQueriesData({ queryKey: ['catalog-products'] }, (current: CatalogProductsPage | undefined) => {
    if (!current?.products?.length) return current;
    return {
      ...current,
      products: current.products.map((product) => (
        product.id === productId ? { ...product, ...patch } : product
      )),
    };
  });
}

function listingImageUrl(listing: Listing) {
  if (listing.imageUrl) return listing.imageUrl;
  const images = listing.metadata?.images;
  if (Array.isArray(images)) {
    const first = images.find((image): image is string => typeof image === 'string' && image.startsWith('https://'));
    if (first) return first;
  }
  const candidate = listing.metadata?.imageUrl ?? listing.metadata?.primaryImageUrl;
  return typeof candidate === 'string' && candidate.startsWith('https://') ? candidate : null;
}

export default function Productos() {
  const queryClient = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [status, setStatus] = useState<CatalogStatusFilter>('all');
  const [inventoryStatus, setInventoryStatus] = useState<InventoryStatusFilter>('all');
  const [publicationStatus, setPublicationStatus] = useState<PublicationStatusFilter>('all');
  const [sellerCoverage, setSellerCoverage] = useState<SellerCoverageFilter>('all');
  const [companyIds, setCompanyIds] = useState<number[]>([]);
  const [profitOwner, setProfitOwner] = useState('all');
  const [sort] = useState<CatalogSort>('updated_desc');
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [imagePreview, setImagePreview] = useState<ProductImagePreview | null>(null);
  const [productNavigationBusy, setProductNavigationBusy] = useState(false);
  const [detailTab, setDetailTab] = useState<'overview' | 'listings' | 'inventory' | 'sales' | 'returns'>('overview');
  const [salesRange, setSalesRange] = useState<'30' | '90' | '365' | 'all'>('30');
  const [modal, setModal] = useState<'create' | 'adjust' | 'image' | 'associate_listing' | 'publish_visual' | 'unpublish_visual' | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [savingField, setSavingField] = useState<ProductEditableField | null>(null);
  const [createForm, setCreateForm] = useState(initialCreate);
  const [adjustForm, setAdjustForm] = useState(initialAdjust);
  const [imageUrl, setImageUrl] = useState('');
  const [publishVisual, setPublishVisual] = useState(initialPublishVisual);
  const [unpublishListing, setUnpublishListing] = useState<Listing | null>(null);
  const [unpublishConfirmation, setUnpublishConfirmation] = useState('');
  const [associationProduct, setAssociationProduct] = useState<Product | null>(null);
  const [associationSearch, setAssociationSearch] = useState('');
  const [associationSubmittedSearch, setAssociationSubmittedSearch] = useState('');
  const [associationListingIds, setAssociationListingIds] = useState<string[]>([]);
  const [associationChannel, setAssociationChannel] = useState<AssociationChannel>('all');
  const [associationAvailability, setAssociationAvailability] = useState<AssociationAvailability>('recommended');
  const [associationPage, setAssociationPage] = useState(0);
  const [unlinkListing, setUnlinkListing] = useState<Listing | null>(null);
  const searchTimer = useRef(0);
  const associationSearchTimer = useRef(0);

  const applySearch = (value: string, immediate = false) => {
    setSearch(value);
    window.clearTimeout(searchTimer.current);
    const commit = () => {
      setSelectedId(null);
      setSubmittedSearch(value.trim());
      setOffset(0);
    };
    if (immediate) commit();
    else searchTimer.current = window.setTimeout(commit, SEARCH_DELAY_MS);
  };

  const resetListView = () => {
    setSelectedId(null);
    setOffset(0);
  };

  const applyAssociationSearch = (value: string, immediate = false) => {
    setAssociationSearch(value);
    window.clearTimeout(associationSearchTimer.current);
    const commit = () => {
      const normalized = value.trim();
      setAssociationSubmittedSearch(normalized);
      if (normalized && associationAvailability === 'recommended') setAssociationAvailability('all');
      setAssociationListingIds([]);
      setAssociationPage(0);
    };
    if (immediate) commit();
    else associationSearchTimer.current = window.setTimeout(commit, SEARCH_DELAY_MS);
  };

  const productFilters = useMemo(() => ({
    submittedSearch,
    status,
    inventoryStatus,
    publicationStatus,
    sellerCoverage,
    companyIds,
    profitOwner,
    sort,
    offset,
  }), [submittedSearch, status, inventoryStatus, publicationStatus, sellerCoverage, companyIds, profitOwner, sort, offset]);
  const tableResetKey = JSON.stringify({
    submittedSearch,
    status,
    inventoryStatus,
    publicationStatus,
    sellerCoverage,
    companyIds,
    profitOwner,
    sort,
  });
  const listRequest = useMemo(() => ({
    search: submittedSearch,
    status,
    inventoryStatus,
    publicationStatus,
    sellerCoverage,
    companyIds: companyIds.length ? companyIds : undefined,
    profitOwner: profitOwner === 'all' ? undefined : profitOwner,
    ...CATALOG_SORT_REQUESTS[sort],
    limit: PAGE_SIZE,
  }), [submittedSearch, status, inventoryStatus, publicationStatus, sellerCoverage, companyIds, profitOwner, sort]);
  const productsQuery = useQuery({
    queryKey: ['catalog-products', productFilters],
    queryFn: () => api.listCatalogProducts({
        ...listRequest,
        offset,
      }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: 1,
  });
  const summaryFilters = {
    search: submittedSearch,
    status,
    inventoryStatus,
    publicationStatus,
    sellerCoverage,
    companyIds: companyIds.length ? companyIds : undefined,
    profitOwner: profitOwner === 'all' ? undefined : profitOwner,
  };
  const summaryQuery = useQuery({
    queryKey: ['catalog-summary', summaryFilters],
    queryFn: () => api.getCatalogSummary(summaryFilters),
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
  const profitOwnersQuery = useQuery({
    queryKey: ['catalog-profit-owners'],
    queryFn: () => api.listCatalogProfitOwners(),
    staleTime: 60_000,
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
  const companies = useMemo(() => ((companiesQuery.data || []) as Company[])
    .filter((company) => company.activo !== false)
    .sort((left, right) => companyName(left).localeCompare(companyName(right), 'es')), [companiesQuery.data]);
  const unlinkedListingsQuery = useQuery({
    queryKey: ['catalog-association-candidates', associationProduct?.id, associationSubmittedSearch, associationChannel, associationAvailability, associationPage],
    queryFn: async () => {
      if (!associationProduct) throw new Error('Selecciona un producto master antes de buscar publicaciones.');
      return api.listProductAssociationCandidates({
        productId: associationProduct.id,
        search: associationSubmittedSearch,
        channelCode: associationChannel === 'all' ? undefined : associationChannel,
        channelCodes: associationChannel === 'all' ? 'falabella,ripley' : undefined,
        availability: associationAvailability,
        limit: ASSOCIATION_PAGE_SIZE,
        offset: associationPage * ASSOCIATION_PAGE_SIZE,
      });
    },
    enabled: modal === 'associate_listing',
    staleTime: 15_000,
    retry: 1,
  });
  const companyOptions = useMemo(() => companies.map((company) => ({ id: company.id, name: companyName(company) })), [companies]);
  const products = useMemo(() => (productsQuery.data?.products || []) as Product[], [productsQuery.data?.products]);
  const productsByIdRef = useRef(new Map<number, Product>());
  productsByIdRef.current = new Map(products.map((product) => [product.id, product]));
  const totalCount = Number(productsQuery.data?.totalCount || 0);
  const inventorySummary = (summaryQuery.data || productsQuery.data?.summary || null) as CatalogInventorySummary | null;
  const detail = detailQuery.data as Product | undefined;
  const movements = (movementsQuery.data?.movements || []) as Movement[];
  const sales = salesQuery.data as SalesSummary | undefined;
  const returns = returnsQuery.data as ReturnsSummary | undefined;
  const unlinkedListings: Listing[] = (unlinkedListingsQuery.data?.candidates || []).map((listing) => ({
    ...listing,
    candidateKey: listing.candidateSource === 'catalog'
      ? `listing:${listing.id}`
      : `remote:${listing.channelCode}:${listing.companyId}:${listing.sellerSku}`,
  }));
  const associationCandidateTotal = Number(unlinkedListingsQuery.data?.totalCount || 0);
  const hiddenAssociationCandidateTotal = Number(unlinkedListingsQuery.data?.hiddenByAvailabilityCount || 0);
  const hasNextAssociationPage = (associationPage + 1) * ASSOCIATION_PAGE_SIZE < associationCandidateTotal;
  const selectedProduct = detail?.id === selectedId ? detail : products.find((product) => product.id === selectedId) || null;
  const selectedProductRef = useRef<Product | null>(null);
  selectedProductRef.current = selectedProduct;
  const selectedProductIndex = selectedId == null ? -1 : products.findIndex((product) => product.id === selectedId);
  const hasPreviousProduct = selectedProductIndex > 0 || (selectedProductIndex === 0 && offset > 0);
  const hasNextProduct = selectedProductIndex >= 0
    && (selectedProductIndex < products.length - 1 || offset + products.length < totalCount);
  const selectedProductPosition = selectedProductIndex >= 0 ? offset + selectedProductIndex + 1 : null;
  const loading = productsQuery.isPending;
  const detailLoading = detailQuery.isPending && !selectedProduct;
  const queryError = productsQuery.error || companiesQuery.error || detailQuery.error || movementsQuery.error || salesQuery.error || returnsQuery.error;

  const prefetchProductsPage = useCallback((nextOffset: number) => {
    if (nextOffset < 0 || nextOffset >= totalCount) return;
    const nextFilters = { ...productFilters, offset: nextOffset };
    void queryClient.prefetchQuery({
      queryKey: ['catalog-products', nextFilters],
      queryFn: () => api.listCatalogProducts({
        ...listRequest,
        offset: nextOffset,
      }),
      staleTime: 30_000,
    });
  }, [listRequest, productFilters, queryClient, totalCount]);

  const handleCatalogPageChange = useCallback((nextPage: number) => {
    setSelectedId(null);
    setOffset(nextPage * PAGE_SIZE);
  }, []);

  const handleCatalogPrefetch = useCallback((nextPage: number) => {
    prefetchProductsPage(nextPage * PAGE_SIZE);
  }, [prefetchProductsPage]);

  const updateProductField = useMutation({
    mutationFn: ({ id, patch }: UpdateProductFieldVariables) => api.updateCatalogProduct(id, patch),
    onMutate: async ({ id, optimistic }) => {
      setFieldError('');
      setSavingField(optimistic.field);
      await queryClient.cancelQueries({ queryKey: ['catalog-product-detail', id] });
      const previousDetail = queryClient.getQueryData<Product>(['catalog-product-detail', id]);
      const previousLists = queryClient.getQueriesData<CatalogProductsPage>({ queryKey: ['catalog-products'] });
      patchProductCaches(queryClient, id, optimistic.patch);
      return { previousDetail, previousLists, id };
    },
    onError: (error, _variables, context) => {
      if (context) {
        if (context.previousDetail) queryClient.setQueryData(['catalog-product-detail', context.id], context.previousDetail);
        context.previousLists.forEach(([key, data]) => queryClient.setQueryData(key, data));
      }
      setFieldError(error instanceof Error ? error.message : 'No se pudo guardar.');
    },
    onSettled: (_data, _error, variables) => {
      setSavingField(null);
      void queryClient.invalidateQueries({ queryKey: ['catalog-product-detail', variables.id] });
      void queryClient.invalidateQueries({ queryKey: ['catalog-products'] });
      void queryClient.invalidateQueries({ queryKey: ['catalog-profit-owners'] });
    },
  });

  const reloadAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['catalog-products'] }),
      queryClient.invalidateQueries({ queryKey: ['catalog-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['catalog-profit-owners'] }),
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
      // Refresca Falabella y Ripley sin crear maestros ni cambiar asociaciones.
      const result = await api.refreshCatalogListingSnapshots();
      if (result.errors?.length) {
        setError(`Se actualizaron ${result.refreshed} publicaciones; ${result.errors.length} seller(s) no respondieron.`);
      }
      await reloadAll();
    } catch (caught: unknown) {
      const message = caught instanceof Error ? caught.message : 'No se pudieron actualizar las publicaciones.';
      setError(message || 'No se pudieron actualizar las publicaciones.');
    } finally {
      setRefreshing(false);
    }
  };

  const openModal = (next: typeof modal) => {
    setActionError('');
    setActionMessage('');
    setModal(next);
  };

  const openListingAssociation = (product: Product) => {
    setAssociationProduct(product);
    setAssociationSearch('');
    setAssociationSubmittedSearch('');
    window.clearTimeout(associationSearchTimer.current);
    setAssociationListingIds([]);
    setAssociationChannel('all');
    setAssociationAvailability('recommended');
    setAssociationPage(0);
    openModal('associate_listing');
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
      commissionAmount: createForm.commissionAmount || null,
      profitOwner: createForm.profitOwner || null,
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

  const associateListing = async (event: FormEvent) => {
    event.preventDefault();
    if (!associationProduct || associationListingIds.length === 0) return;
    const selectedListings = unlinkedListings.filter((listing) => listing.candidateKey && associationListingIds.includes(listing.candidateKey));
    const linked = await runAction(
      () => api.associateProductListings({
        productId: associationProduct.id,
        listings: selectedListings.map((listing) => listing.candidateSource === 'remote'
          ? {
              channelCode: listing.channelCode,
              companyId: listing.companyId,
              sellerSku: listing.sellerSku,
              shopSku: listing.shopSku,
              title: listing.title,
              marketplaceQuantity: listing.marketplaceQuantity,
              metadata: { ...listing.metadata, imageUrl: listing.imageUrl },
            }
          : { listingId: listing.id }),
      }),
      () => `${selectedListings.length} ${selectedListings.length === 1 ? 'producto asociado' : 'productos asociados'} a ${associationProduct.mainSku}.`,
    );
    if (linked) {
      setAssociationListingIds([]);
      await queryClient.invalidateQueries({ queryKey: ['catalog-association-candidates'] });
      setModal(null);
      setAssociationProduct(null);
    }
  };

  const disassociateListing = async () => {
    if (!unlinkListing) return;
    const listing = unlinkListing;
    const unlinked = await runAction(
      () => api.unlinkProductListing(listing.id),
      () => `${listing.sellerSku} quedó sin asociación.`,
    );
    if (unlinked) {
      setUnlinkListing(null);
      await queryClient.invalidateQueries({ queryKey: ['catalog-association-candidates'] });
    }
  };

  const openProduct = useCallback((productId: number) => {
    setSelectedId(productId);
    setDetailTab('overview');
    setSalesRange('30');
  }, []);

  const openProductImage = useCallback((product: Product) => {
    const src = product.imageUrl?.trim();
    if (!src) return;
    setImagePreview({ src, productName: product.name, sku: product.mainSku });
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
          ...listRequest,
          offset: nextOffset,
        }),
        staleTime: 30_000,
      });
      const pageProducts = (page?.products || []) as Product[];
      const target = direction === 'next' ? pageProducts[0] : pageProducts.at(-1);
      if (!target) return;
      setOffset(nextOffset);
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
  const openPublishVisualRef = useRef(openPublishVisual);
  openPublishVisualRef.current = openPublishVisual;

  const togglePublication = useCallback((listing: Listing) => {
    if (isActivelyPublished(listing)) {
      setUnpublishListing(listing);
      setUnpublishConfirmation('');
      setActionError('');
      setActionMessage('');
      setModal('unpublish_visual');
      return;
    }
    const product = productsByIdRef.current.get(listing.productId)
      || (selectedProductRef.current?.id === listing.productId ? selectedProductRef.current : null);
    if (product) openPublishVisualRef.current(product, listing);
  }, []);

  const simulatePublish = (event: FormEvent) => {
    event.preventDefault();
    const seller = companies.find((company) => String(company.id) === publishVisual.companyId);
    const preview = simulatePublicationPreview({
      kind: 'publish',
      sellerName: seller ? companyName(seller) : '',
    });
    setActionError(preview.error || '');
    setActionMessage(preview.message || '');
  };

  const simulateUnpublish = (event: FormEvent) => {
    event.preventDefault();
    const preview = simulatePublicationPreview({
      kind: 'unpublish',
      confirmation: unpublishConfirmation,
    });
    setActionError(preview.error || '');
    setActionMessage(preview.message || '');
  };

  const publishCopy = publicationPreviewCopy('publish');
  const unpublishCopy = publicationPreviewCopy('unpublish');
  const visibleError = error || (queryError instanceof Error ? queryError.message : queryError ? 'No se pudo cargar el catálogo.' : '');
  const visualListingExists = Boolean(selectedProduct?.listings?.some((listing) => (
    listing.id !== publishVisual.listingId
      && listing.channelCode === publishVisual.channelCode
      && String(listing.companyId) === publishVisual.companyId
  )));

  const applyStatus = (next: CatalogStatusFilter) => {
    resetListView();
    setStatus(next);
  };

  const applyInventoryStatus = (next: InventoryStatusFilter) => {
    resetListView();
    setInventoryStatus(next);
  };

  const applyPublicationStatus = (next: PublicationStatusFilter) => {
    resetListView();
    setPublicationStatus(next);
    if (next === 'published' && sellerCoverage === 'none') setSellerCoverage('all');
  };

  const applyCoverage = (next: SellerCoverageFilter) => {
    resetListView();
    setSellerCoverage(next);
    if (next === 'none') {
      setCompanyIds([]);
      if (publicationStatus === 'published') setPublicationStatus('all');
    }
  };

  const applyCompanyIds = (next: number[]) => {
    resetListView();
    setCompanyIds([...next].sort((left, right) => left - right));
    if (next.length && sellerCoverage === 'none') setSellerCoverage('all');
  };

  const clearFilters = () => {
    setStatus('all');
    setInventoryStatus('all');
    setPublicationStatus('all');
    setSellerCoverage('all');
    setCompanyIds([]);
    setProfitOwner('all');
    resetListView();
  };

  const applyProfitOwner = (next: string) => {
    resetListView();
    setProfitOwner(next);
  };

  const saveCommission = useCallback((raw: string) => {
    if (!selectedId || !selectedProduct) return;
    const trimmed = raw.trim();
    const current = selectedProduct.commissionAmount == null ? '' : String(selectedProduct.commissionAmount);
    if (trimmed === current) return;
    const parsed = trimmed === '' ? null : Number(trimmed);
    if (trimmed !== '' && (parsed == null || !Number.isFinite(parsed) || parsed < 0)) {
      setFieldError('La comisión debe ser un número válido.');
      return;
    }
    updateProductField.mutate({
      id: selectedId,
      patch: { commissionAmount: parsed },
      optimistic: { field: 'commissionAmount', patch: { commissionAmount: parsed } },
    });
  }, [selectedId, selectedProduct, updateProductField]);

  const saveProfitOwner = useCallback((raw: string) => {
    if (!selectedId || !selectedProduct) return;
    const normalized = raw.trim() || null;
    const current = selectedProduct.profitOwner || '';
    if ((normalized || '') === current) return;
    updateProductField.mutate({
      id: selectedId,
      patch: { profitOwner: normalized },
      optimistic: { field: 'profitOwner', patch: { profitOwner: normalized } },
    });
  }, [selectedId, selectedProduct, updateProductField]);

  return (
    <div className="space-y-4">
      <CatalogInventoryKpis
        summary={inventorySummary}
        productCount={summaryQuery.data?.scopedTotal ?? (productsQuery.data ? totalCount : null)}
        loading={summaryQuery.isPending}
      />
      <CatalogFilters
        searchControl={<div className="relative min-w-0">
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
            placeholder="Buscar por producto, SKU o marca"
            className="h-11 px-9 sm:h-9"
            aria-label="Buscar por producto, SKU o marca"
          />
          {search && (
            <button
              type="button"
              onClick={() => applySearch('', true)}
              className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8 sm:w-8"
              aria-label="Limpiar búsqueda"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>}
        actions={<>
          <Button type="button" variant="outline" size="icon" className="size-11 sm:size-9" onClick={refreshMarketplaceSnapshots} disabled={refreshing} aria-label="Actualizar stock y precios" title="Actualiza stock y precios de las publicaciones. No crea productos ni cambia vínculos.">
            <RefreshCw className={cn(refreshing && 'animate-spin')} />
          </Button>
          <Button type="button" onClick={() => openModal('create')} className="h-11 flex-1 sm:h-9 sm:flex-none">
            <PackagePlus data-icon="inline-start" /> Nuevo producto
          </Button>
        </>}
        status={status}
        inventoryStatus={inventoryStatus}
        publicationStatus={publicationStatus}
        sellerCoverage={sellerCoverage}
        companyIds={companyIds}
        companies={companyOptions}
        profitOwner={profitOwner}
        profitOwners={profitOwnersQuery.data?.items || []}
        onStatusChange={applyStatus}
        onInventoryStatusChange={applyInventoryStatus}
        onPublicationStatusChange={applyPublicationStatus}
        onSellerCoverageChange={applyCoverage}
        onCompanyIdsChange={applyCompanyIds}
        onProfitOwnerChange={applyProfitOwner}
        onClearFilters={clearFilters}
      />

      {visibleError && <Notice tone="error">{visibleError}</Notice>}

      <CatalogTable
        key={tableResetKey}
        products={products}
        totalCount={totalCount}
        loading={loading}
        fetching={productsQuery.isFetching}
        pageIndex={Math.floor(offset / PAGE_SIZE)}
        pageSize={PAGE_SIZE}
        onPageChange={handleCatalogPageChange}
        onPrefetch={handleCatalogPrefetch}
        onOpenProduct={openProduct}
        onOpenImage={openProductImage}
        onAssociateProduct={openListingAssociation}
        onTogglePublication={togglePublication}
      />

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
        onOpenImage={openProductImage}
        onAdjust={() => openModal('adjust')}
        onEditImage={() => {
          setImageUrl(selectedProduct?.imageUrl || '');
          openModal('image');
        }}
        profitOwners={profitOwnersQuery.data?.items || []}
        savingField={savingField}
        fieldError={fieldError}
        onSaveCommission={saveCommission}
        onSaveProfitOwner={saveProfitOwner}
        onPublish={() => selectedProduct && openPublishVisual(selectedProduct)}
        onAssociate={() => selectedProduct && openListingAssociation(selectedProduct)}
        onDisassociate={setUnlinkListing}
        onTogglePublication={togglePublication}
      />

      <ProductImageDialog preview={imagePreview} onClose={() => setImagePreview(null)} />

      {modal === 'create' && <Modal title="Nuevo producto" subtitle="Crea el producto; el stock empieza en cero." onClose={() => setModal(null)}><form onSubmit={createProduct} className="space-y-4"><div className="grid gap-3 md:grid-cols-2"><Field label="SKU interno (ej. AG3)" value={createForm.mainSku} onChange={(value) => setCreateForm({ ...createForm, mainSku: value })} required /><Field label="Nombre" value={createForm.name} onChange={(value) => setCreateForm({ ...createForm, name: value })} required /><Field label="Marca" value={createForm.brand} onChange={(value) => setCreateForm({ ...createForm, brand: value })} /><Field label="Precio" type="number" value={createForm.referencePrice} onChange={(value) => setCreateForm({ ...createForm, referencePrice: value })} /><Field label="Comisión" type="number" value={createForm.commissionAmount} onChange={(value) => setCreateForm({ ...createForm, commissionAmount: value })} /><Field label="Beneficiario" value={createForm.profitOwner} onChange={(value) => setCreateForm({ ...createForm, profitOwner: value })} list="profit-owner-options" /><Field label="Imagen URL" value={createForm.imageUrl} onChange={(value) => setCreateForm({ ...createForm, imageUrl: value })} className="md:col-span-2" /></div><ProfitOwnerOptions owners={profitOwnersQuery.data?.items || []} /><TextArea label="Descripción" value={createForm.description} onChange={(value) => setCreateForm({ ...createForm, description: value })} /><ActionFeedback error={actionError} message={actionMessage} /><Submit busy={busy}>Crear producto</Submit></form></Modal>}

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

      <Sheet open={modal === 'associate_listing' && associationProduct != null} onOpenChange={(open) => { if (!open) { window.clearTimeout(associationSearchTimer.current); setModal(null); setAssociationProduct(null); setAssociationListingIds([]); } }}>
        <SheetContent className="sm:max-w-2xl">
          <SheetHeader className="border-b border-border px-5 py-4 pr-16">
            <SheetTitle>Asociar productos</SheetTitle>
            <SheetDescription className="truncate">{associationProduct ? `${associationProduct.name} · SKU ${associationProduct.mainSku}` : ''}</SheetDescription>
          </SheetHeader>
          <form onSubmit={associateListing} className="flex min-h-0 flex-1 flex-col">
            <div className="grid grid-cols-2 gap-2 border-b border-border px-5 py-3 sm:grid-cols-[minmax(0,1fr)_10.5rem_11rem]">
              <div className="relative col-span-2 min-w-0 sm:col-span-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={associationSearch}
                  onChange={(event) => applyAssociationSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      applyAssociationSearch(associationSearch, true);
                    }
                  }}
                  placeholder="Buscar nombre o SKU"
                  className="h-10 pl-9"
                  aria-label="Buscar por nombre, SKU o seller"
                  autoFocus
                />
              </div>
              <Select value={associationChannel} onValueChange={(value: AssociationChannel) => { setAssociationChannel(value); setAssociationListingIds([]); setAssociationPage(0); }}><SelectTrigger className="h-10" aria-label="Filtrar por canal"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos los canales</SelectItem><SelectItem value="falabella">Falabella</SelectItem><SelectItem value="ripley">Ripley</SelectItem></SelectContent></Select>
              <Select value={associationAvailability} onValueChange={(value: AssociationAvailability) => { setAssociationAvailability(value); setAssociationListingIds([]); setAssociationPage(0); }}><SelectTrigger className="h-10" aria-label="Filtrar por disponibilidad"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="recommended">Activos con stock</SelectItem><SelectItem value="all">Cualquier estado</SelectItem></SelectContent></Select>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto" aria-label="Productos disponibles para asociar">
              {unlinkedListingsQuery.isPending ? <AssociationCandidatesSkeleton />
                : unlinkedListingsQuery.isError ? <div className="px-5 py-10 text-sm text-red-700">No se pudieron cargar los productos de los canales.</div>
                  : unlinkedListings.length === 0 ? <div className="px-5 py-10 text-center"><Store className="mx-auto h-7 w-7 text-muted-foreground" />
                    {hiddenAssociationCandidateTotal > 0
                      ? <><p className="mt-3 text-sm font-medium">Hay {formatNumber(hiddenAssociationCandidateTotal)} productos fuera del filtro</p><p className="mt-1 text-xs text-muted-foreground">Están inactivos o sin stock.</p><Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => { setAssociationAvailability('all'); setAssociationPage(0); }}>Mostrar cualquier estado</Button></>
                      : <><p className="mt-3 text-sm font-medium">No hay productos para estos filtros</p><p className="mt-1 text-xs text-muted-foreground">Prueba otro canal o quita los filtros.</p></>}
                  </div>
                    : unlinkedListings.map((listing) => {
                      const candidateKey = listing.candidateKey || `listing:${listing.id}`;
                      const selected = associationListingIds.includes(candidateKey);
                      const toggle = () => setAssociationListingIds((current) => selected ? current.filter((id) => id !== candidateKey) : [...current, candidateKey]);
                      const candidateImage = listingImageUrl(listing);
                      return <label key={candidateKey} className={cn('flex cursor-pointer items-start gap-3 border-b border-border px-5 py-3 hover:bg-muted/50', selected && 'bg-primary/5')}>
                        <Checkbox checked={selected} onCheckedChange={toggle} aria-label={`Seleccionar ${listing.title || listing.sellerSku}`} className="mt-1" />
                        {candidateImage ? <img src={candidateImage} alt="" className="h-14 w-14 shrink-0 rounded-md bg-muted object-contain" /> : <span className="grid h-14 w-14 shrink-0 place-items-center rounded-md bg-muted"><Boxes className="h-5 w-5 text-muted-foreground" /></span>}
                        <span className="min-w-0 flex-1"><strong className="block line-clamp-2 text-sm leading-5">{listing.title || listing.sellerSku}</strong><span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"><span className="font-mono">{listing.sellerSku}</span><span>{sellerShortName(listing.companyName || `Empresa ${listing.companyId}`)}</span><ChannelBadge value={listing.channelCode} listing={listing} /><span>{formatNumber(listing.marketplaceQuantity)} u</span></span></span>
                      </label>;
                    })}
            </div>
            <div className="border-t border-border bg-background px-5 py-3">
              <ActionFeedback error={actionError} message={actionMessage} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center"><Button type="button" variant="ghost" size="sm" disabled={associationPage === 0 || busy} onClick={() => { setAssociationPage((page) => Math.max(0, page - 1)); setAssociationListingIds([]); }} aria-label="Página anterior"><ChevronLeft /></Button><span className="min-w-20 text-center text-xs text-muted-foreground">Página {associationPage + 1}</span><Button type="button" variant="ghost" size="sm" disabled={!hasNextAssociationPage || busy} onClick={() => { setAssociationPage((page) => page + 1); setAssociationListingIds([]); }} aria-label="Página siguiente"><ChevronRight /></Button></div>
                <div className="flex items-center gap-3"><span className="text-sm text-muted-foreground">{associationListingIds.length} seleccionados</span><button type="submit" className="primary-button" disabled={associationListingIds.length === 0 || busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Asociar</button></div>
              </div>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      <Dialog open={unlinkListing != null} onOpenChange={(open) => { if (!open) setUnlinkListing(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Desasociar producto</DialogTitle><DialogDescription>{unlinkListing ? `${unlinkListing.title || unlinkListing.sellerSku} dejará de pertenecer al producto master. La publicación no se elimina del canal.` : ''}</DialogDescription></DialogHeader>
          <ActionFeedback error={actionError} message="" />
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setUnlinkListing(null)} disabled={busy}>Cancelar</Button><Button variant="destructive" onClick={() => void disassociateListing()} disabled={busy}>{busy && <Loader2 className="animate-spin" />} Desasociar</Button></div>
        </DialogContent>
      </Dialog>

      {modal === 'publish_visual' && selectedProduct && <Modal title={publishVisual.listingId ? 'Editar publicación' : 'Nueva publicación'} subtitle={`${selectedProduct.name} · ${publishCopy.subtitle}`} onClose={() => setModal(null)}><form onSubmit={simulatePublish} className="space-y-5">
        <Notice tone="info">{publishCopy.notice}</Notice>
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
        <div className="flex justify-end border-t border-border pt-4"><button disabled={!publishVisual.companyId || !publishVisual.sellerSku.trim() || !(Number(publishVisual.price) > 0) || visualListingExists} className="primary-button" type="submit">{publishCopy.submit}</button></div>
      </form></Modal>}

      {modal === 'unpublish_visual' && unpublishListing && <Modal title={unpublishCopy.title} subtitle={unpublishCopy.subtitle} onClose={() => { setModal(null); setUnpublishListing(null); setUnpublishConfirmation(''); }}><form onSubmit={simulateUnpublish} className="space-y-4">
        <div className="rounded-lg bg-red-50 px-3 py-3 text-sm text-red-800"><ShieldAlert className="mr-2 inline h-4 w-4" />Despublicar puede detener ventas en <strong>{sellerShortName(unpublishListing.companyName)}</strong>. Requiere confirmación explícita.</div>
        <div className="grid grid-cols-2 gap-3 text-sm"><InfoValue label="Canal" value={channelLabel(unpublishListing.channelCode)} /><InfoValue label="SKU seller" value={unpublishListing.sellerSku} /></div>
        <Field label={`Escribe ${UNPUBLISH_CONFIRMATION_TEXT} para confirmar`} value={unpublishConfirmation} onChange={setUnpublishConfirmation} required />
        <ActionFeedback error={actionError} message={actionMessage} />
        <div className="flex justify-end border-t border-border pt-4"><button disabled={unpublishConfirmation !== UNPUBLISH_CONFIRMATION_TEXT} className="inline-flex h-9 items-center justify-center rounded-md bg-red-600 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40" type="submit">{unpublishCopy.submit}</button></div>
      </form></Modal>}
    </div>
  );
}

function CopyableSku({
  sku,
  title = 'Copiar SKU interno',
  copiedTitle,
  className = 'mt-1 inline-flex items-center gap-1.5 font-mono text-xs font-semibold tracking-wide text-muted-foreground hover:text-foreground',
}: {
  sku: string;
  title?: string;
  copiedTitle?: string;
  className?: string;
}) {
  const [copiedSku, setCopiedSku] = useState<string | null>(null);
  const copied = copiedSku === sku;
  return (
    <button
      type="button"
      title={copied ? copiedTitle || title : title}
      aria-label={`Copiar SKU ${sku}`}
      onClick={async (event) => {
        event.stopPropagation();
        await navigator.clipboard.writeText(sku);
        setCopiedSku(sku);
        window.setTimeout(() => setCopiedSku((current) => current === sku ? null : current), 1400);
      }}
      className={className}
    >
      {sku}
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

const CatalogProductIdentity = memo(function CatalogProductIdentity({
  product,
  expanded,
  onToggleExpand,
  onOpenProduct,
  onOpenImage,
}: {
  product: Product;
  expanded: boolean;
  onToggleExpand: (productId: number) => void;
  onOpenProduct: (productId: number) => void;
  onOpenImage: (product: Product) => void;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[2.5rem_3rem_minmax(0,1fr)] items-center gap-x-3 gap-y-3">
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onToggleExpand(product.id);
        }}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`${expanded ? 'Contraer' : 'Expandir'} publicaciones de ${product.name}`}
        aria-expanded={expanded}
      >
        <ChevronRight className={cn('h-4 w-4 transition-transform', expanded && 'rotate-90')} />
      </button>
      {product.imageUrl
        ? <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onOpenImage(product);
            }}
            className="group relative h-12 w-12 shrink-0 cursor-zoom-in overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label={`Ampliar foto de ${product.name}`}
            title="Ampliar foto"
          >
            <img src={product.imageUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105" />
            <span className="absolute inset-0 grid place-items-center bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true"><Maximize2 className="h-4 w-4" /></span>
          </button>
        : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-muted"><Boxes className="h-4 w-4" /></span>}
      <span className="min-w-0 flex-1">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpenProduct(product.id);
          }}
          className="block w-full text-left hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <strong className="block whitespace-normal break-words text-sm leading-5">{product.name}</strong>
        </button>
        <CopyableSku sku={product.mainSku} />
      </span>
      <span className="col-span-3 grid grid-cols-2 gap-x-5 gap-y-2 border-t border-border/60 pt-3 sm:hidden">
        <span className="min-w-0">
          <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Precio</span>
          <span className="mt-1 block truncate text-xs font-semibold">{formatBasePrice(product)}</span>
        </span>
        <span className="min-w-0">
          <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Stock maestro</span>
          <span className="mt-1 block text-xs font-semibold tabular-nums">{formatNumber(product.available)} u</span>
          <span className="mt-0.5 block text-[11px] text-muted-foreground">disponible</span>
        </span>
        <span className="col-span-2 flex min-w-0 items-center justify-between gap-3">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Estado del producto</span>
          <ProductStatusBadge product={product} compact />
        </span>
      </span>
    </div>
  );
});

const CatalogTable = memo(function CatalogTable({
  products,
  totalCount,
  loading,
  fetching,
  pageIndex,
  pageSize,
  onPageChange,
  onPrefetch,
  onOpenProduct,
  onOpenImage,
  onAssociateProduct,
  onTogglePublication,
}: {
  products: Product[];
  totalCount: number;
  loading: boolean;
  fetching: boolean;
  pageIndex: number;
  pageSize: number;
  onPageChange: (nextPage: number) => void;
  onPrefetch: (nextPage: number) => void;
  onOpenProduct: (productId: number) => void;
  onOpenImage: (product: Product) => void;
  onAssociateProduct: (product: Product) => void;
  onTogglePublication: (listing: Listing) => void;
}) {
  const [expandedRows, setExpandedRows] = useState<ExpandedState>({});
  const toggleExpand = useCallback((productId: number) => {
    const rowId = String(productId);
    setExpandedRows((current) => {
      const next = typeof current === 'object' ? { ...current } : {};
      if (next[rowId]) delete next[rowId];
      else next[rowId] = true;
      return next;
    });
  }, []);

  const columns = useMemo<ColumnDef<Product>[]>(() => [
    {
      id: 'product',
      header: 'Producto',
      cell: ({ row }) => (
        <CatalogProductIdentity
          product={row.original}
          expanded={row.getIsExpanded()}
          onToggleExpand={toggleExpand}
          onOpenProduct={onOpenProduct}
          onOpenImage={onOpenImage}
        />
      ),
    },
    {
      id: 'price',
      header: 'Precio',
      cell: ({ row }) => <span className="text-sm font-medium">{formatBasePrice(row.original)}</span>,
    },
    {
      id: 'stock',
      header: 'Stock maestro',
      cell: ({ row }) => {
        const product = row.original;
        return <div>
          <p className="text-lg font-semibold leading-none">{formatNumber(product.available)} <span className="text-xs font-normal text-muted-foreground">u</span></p>
          <p className="mt-1 text-[11px] text-muted-foreground">disponible</p>
        </div>;
      },
    },
    {
      id: 'status',
      header: 'Estado del producto',
      cell: ({ row }) => <ProductStatusBadge product={row.original} />,
    },
  ], [onOpenImage, onOpenProduct, toggleExpand]);

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
        pageIndex,
        pageSize,
      },
    },
  });

  return (
    <TablePanel aria-label="Catálogo de productos">
      {loading ? <CatalogTableSkeleton /> : products.length === 0 ? <EmptyBlock /> : (
        <div className="min-w-0" aria-busy={fetching}>
          <Table className="table-fixed">
            <colgroup>
              <col className="w-full sm:w-[48%]" />
              <col className="hidden sm:table-column sm:w-[14%]" />
              <col className="hidden sm:table-column sm:w-[18%]" />
              <col className="hidden sm:table-column sm:w-[20%]" />
            </colgroup>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => <TableRow key={headerGroup.id} className="bg-muted/50 hover:bg-muted/50">
                {headerGroup.headers.map((header) => <TableHead
                  key={header.id}
                  className={cn('min-w-0', CATALOG_COLUMN_CLASS_NAMES[header.column.id as keyof typeof CATALOG_COLUMN_CLASS_NAMES])}
                >{header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}</TableHead>)}
              </TableRow>)}
            </TableHeader>
            <TableBody>{table.getRowModel().rows.map((row) => <Fragment key={row.id}>
              <TableRow
                className={cn('cursor-pointer align-middle focus-visible:bg-muted/30 focus-visible:outline-none', row.getIsExpanded() && 'border-b-0 bg-muted/20')}
                tabIndex={0}
                onClick={() => onOpenProduct(row.original.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onOpenProduct(row.original.id);
                  }
                }}
              >
                {row.getVisibleCells().map((cell) => <TableCell key={cell.id} className={cn(
                  'min-w-0',
                  CATALOG_COLUMN_CLASS_NAMES[cell.column.id as keyof typeof CATALOG_COLUMN_CLASS_NAMES],
                  cell.column.id === 'product' ? 'whitespace-normal' : 'hidden sm:table-cell',
                )}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}
              </TableRow>
              {row.getIsExpanded() && <ExpandedProductPublications
                product={row.original}
                listings={row.original.listings}
                onOpenDetail={onOpenProduct}
                onAssociateProduct={onAssociateProduct}
                onTogglePublication={onTogglePublication}
              />}
            </Fragment>)}</TableBody>
          </Table>
        </div>
      )}
      {totalCount > 0 ? <DataTablePagination
        pageIndex={pageIndex}
        pageSize={pageSize}
        totalCount={totalCount}
        fetching={fetching}
        onPageChange={onPageChange}
        onPrefetch={onPrefetch}
      /> : null}
    </TablePanel>
  );
});

const ExpandedProductPublications = memo(function ExpandedProductPublications({
  product,
  listings: providedListings,
  onOpenDetail,
  onAssociateProduct,
  onTogglePublication,
}: {
  product: Product;
  listings?: Listing[];
  onOpenDetail: (productId: number) => void;
  onAssociateProduct: (product: Product) => void;
  onTogglePublication: (listing: Listing) => void;
}) {
  const shouldFetch = providedListings === undefined;
  const detailQuery = useQuery({
    queryKey: ['catalog-product-detail', product.id],
    queryFn: () => api.getCatalogProduct(product.id),
    enabled: shouldFetch,
    staleTime: 30_000,
    retry: 1,
  });
  const sourceListings = providedListings ?? ((detailQuery.data as Product | undefined)?.listings || []);
  const listings = useMemo(() => sourceListings.filter((listing) => listing.status !== 'unlinked'), [sourceListings]);

  if (shouldFetch && detailQuery.isPending) return <TableRow className="bg-muted/15 hover:bg-muted/15" onClick={(event) => event.stopPropagation()}>
    <TableCell colSpan={4} className="h-14 py-2 pl-[6.5rem] text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando publicaciones…</span>
    </TableCell>
  </TableRow>;

  if (shouldFetch && detailQuery.isError) return <TableRow className="bg-red-50/60 hover:bg-red-50/60" onClick={(event) => event.stopPropagation()}>
    <TableCell colSpan={4} className="h-14 py-2 pl-[6.5rem] text-sm text-red-700">No se pudieron cargar las publicaciones.</TableCell>
  </TableRow>;

  return <>
    {listings.length ? listings.map((listing, index) => {
      const sellerName = sellerShortName(listing.companyName || `Empresa ${listing.companyId}`);
      const publication = publicationPresentation(listing);
      const isLast = index === listings.length - 1;
      return <TableRow
        key={listing.id}
        className={cn(
          'bg-muted/15 hover:bg-muted/30',
          sellerPublicationRowBorderClass(isLast),
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <TableCell className="whitespace-normal py-2.5 pr-3 align-middle">
          <div className="min-w-0 pl-[4.5rem]">
            <button
              type="button"
              onClick={() => onOpenDetail(product.id)}
              className="line-clamp-2 text-left text-sm font-medium leading-5 text-foreground hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >{listing.title || product.name}</button>
            <span className="mt-1 line-clamp-2 text-xs font-semibold text-foreground" title={listing.companyName || undefined}>{sellerName}</span>
            <div className="mt-1 flex flex-nowrap items-center gap-2 text-xs">
              <CopyableSku
                sku={listing.sellerSku}
                title="Copiar SKU del seller"
                copiedTitle="SKU copiado"
                className="relative inline-flex shrink-0 items-center gap-1 font-mono font-medium tabular-nums text-muted-foreground after:absolute after:-inset-2 hover:text-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <ChannelBadge value={listing.channelCode} listing={listing} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:hidden">
              <div><span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Precio</span><SellerPrice listing={listing} /></div>
              <div><span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Stock seller</span><SellerStock listing={listing} /></div>
              <div className="col-span-2 flex items-center justify-between border-t border-border/60 pt-2">
                <span className={cn('text-xs font-medium', publication.className)}>{publication.label}</span>
                <Switch
                  checked={publication.visible}
                  onCheckedChange={() => onTogglePublication(listing)}
                  aria-label={`${publication.visible ? 'Despublicar' : 'Preparar publicación'} ${listing.sellerSku} de ${sellerName}`}
                />
              </div>
            </div>
          </div>
        </TableCell>
        <TableCell className="hidden py-2.5 align-middle sm:table-cell"><SellerPrice listing={listing} /></TableCell>
        <TableCell className="hidden py-2.5 align-middle sm:table-cell"><SellerStock listing={listing} /></TableCell>
        <TableCell className="hidden py-2.5 align-middle sm:table-cell">
          <div className="flex items-center gap-2">
            <span className={cn('hidden text-xs font-medium xl:inline', publication.className)}>{publication.label}</span>
            <Switch
              checked={publication.visible}
              onCheckedChange={() => onTogglePublication(listing)}
              aria-label={`${publication.visible ? 'Despublicar' : 'Preparar publicación'} ${listing.sellerSku} de ${sellerName}`}
            />
          </div>
        </TableCell>
      </TableRow>;
    }) : <TableRow className={cn(sellerPublicationRowBorderClass(false), 'bg-muted/15 hover:bg-muted/15')} onClick={(event) => event.stopPropagation()}>
      <TableCell colSpan={4} className="h-14 py-2 pl-[6.5rem] text-sm text-muted-foreground">Sin publicaciones asociadas.</TableCell>
    </TableRow>}
    <TableRow className={cn(sellerPublicationRowBorderClass(true), 'bg-muted/15 hover:bg-muted/30')} onClick={(event) => event.stopPropagation()}>
      <TableCell colSpan={4} className="h-11 py-0 pl-[6.5rem]">
        <button
          type="button"
          onClick={() => onAssociateProduct(product)}
          className="-ml-2 inline-flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="h-4 w-4 text-muted-foreground" /> Asociar producto
        </button>
      </TableCell>
    </TableRow>
  </>;
});

function ProductDrawer({
  open, product, loading, tab, onTabChange, movements, movementsLoading, sales, salesLoading, returns, returnsLoading,
  salesRange, onSalesRangeChange, hasPreviousProduct, hasNextProduct, productPosition, totalProducts, productNavigationBusy,
  onPreviousProduct, onNextProduct, onClose, onOpenImage, onAdjust, onEditImage, onPublish, onAssociate, onTogglePublication,
  onDisassociate, profitOwners, savingField, fieldError, onSaveCommission, onSaveProfitOwner,
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
  onOpenImage: (product: Product) => void;
  onAdjust: () => void;
  onEditImage: () => void;
  onPublish: () => void;
  onAssociate: () => void;
  onDisassociate: (listing: Listing) => void;
  onTogglePublication: (listing: Listing) => void;
  profitOwners: string[];
  savingField: ProductEditableField | null;
  fieldError: string;
  onSaveCommission: (value: string) => void;
  onSaveProfitOwner: (value: string) => void;
}) {
  const associatedListings = product?.listings || [];
  const publishedListings = associatedListings.filter(isActivelyPublished);
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
          {product?.imageUrl ? <button
            type="button"
            onClick={() => onOpenImage(product)}
            className="group relative h-14 w-14 cursor-zoom-in overflow-hidden rounded-lg bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label={`Ampliar foto de ${product.name}`}
            title="Ampliar foto"
          >
            <img src={product.imageUrl} alt="" className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105" />
            <span className="absolute inset-0 grid place-items-center bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true"><Maximize2 className="h-4 w-4" /></span>
          </button> : <span className="grid h-14 w-14 place-items-center rounded-lg bg-muted"><Boxes className="h-5 w-5" /></span>}
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
            <TabsTrigger value="listings">Publicaciones <span className="text-xs text-muted-foreground">{associatedListings.length}</span></TabsTrigger>
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
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">Publicado en</h3><p className="mt-1 text-xs text-muted-foreground">Canales y sellers con una publicación activa.</p></div><button type="button" onClick={onPublish} className="primary-button h-8 px-3"><PackagePlus className="h-4 w-4" /> Nueva publicación</button></div>
            {publicationsByChannel.length ? <div className="mt-4 space-y-3">
              {publicationsByChannel.map(({ channelCode, sellers: channelSellers }) => <article key={channelCode} className="rounded-lg bg-muted/40 p-4">
                <header className="flex flex-wrap items-center gap-2">
                  <ChannelBadge value={channelCode} />
                  <span className="text-xs text-muted-foreground">{channelSellers.length} seller{channelSellers.length === 1 ? '' : 's'}</span>
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
            </div> : <p className="mt-4 text-sm text-muted-foreground">Ninguna publicación está visible en un seller y canal.</p>}
            <div className="mt-4 border-t border-border pt-3"><button type="button" onClick={onAssociate} className="-ml-2 inline-flex min-h-10 items-center gap-2 rounded-md px-2 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Plus className="h-4 w-4 text-muted-foreground" /> Asociar producto</button></div>
          </section>
          <section className="border-b border-border px-5 py-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Configuración</h3>
              <button type="button" onClick={onEditImage} className="secondary-button h-8 px-3"><ImagePlus className="h-4 w-4" /> Cambiar foto</button>
            </div>
            <ProductEditableConfig
              product={product}
              profitOwners={profitOwners}
              savingField={savingField}
              onSaveCommission={onSaveCommission}
              onSaveProfitOwner={onSaveProfitOwner}
            />
            {fieldError ? <p className="mt-2 text-xs text-red-600">{fieldError}</p> : null}
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
          <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><p className="text-sm font-semibold">
            {associatedListings.length} {associatedListings.length === 1 ? 'publicación asociada' : 'publicaciones asociadas'} · {publishedListings.length} {publishedListings.length === 1 ? 'visible' : 'visibles'}
          </p><p className="mt-0.5 text-xs text-muted-foreground">Cada publicación pertenece a un seller y canal.</p></div><button type="button" onClick={onPublish} className="primary-button h-8 px-3"><PackagePlus className="h-4 w-4" /> Nueva publicación</button></div>
          {!associatedListings.length ? <div className="px-5 py-12 text-center"><Store className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-3 text-sm font-medium">Sin publicaciones asociadas</p><p className="mt-1 text-xs text-muted-foreground">Asocia una publicación existente o prepara una nueva.</p></div> : associatedListings.map((listing) => {
            const publication = publicationPresentation(listing);
            return <article key={listing.id} className="border-b-[6px] border-muted px-5 py-5 last:border-b-0">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="text-base">{sellerShortName(listing.companyName || `Empresa ${listing.companyId}`)}</strong><ChannelBadge value={listing.channelCode} listing={listing} /></div><p className="mt-2 line-clamp-2 text-sm font-medium leading-5">{listing.title || product.name}</p></div>
                <div className="flex shrink-0 items-center gap-2"><span className={cn('text-xs font-medium', publication.className)}>{publication.label}</span><Switch checked={publication.visible} onCheckedChange={() => onTogglePublication(listing)} aria-label={`${publication.visible ? 'Despublicar' : 'Preparar publicación'} en ${sellerShortName(listing.companyName)}`} /><ListingActions listing={listing} onDisassociate={onDisassociate} /></div>
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
          <div className="border-t border-border px-5 py-3"><button type="button" onClick={onAssociate} className="-ml-2 inline-flex min-h-10 items-center gap-2 rounded-md px-2 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Plus className="h-4 w-4 text-muted-foreground" /> Asociar producto</button></div>
        </TabsContent>

        <TabsContent value="inventory" className="min-h-0 overflow-y-auto">
          <div className="grid grid-cols-3 border-b border-border"><Metric label="En almacén" value={`${formatNumber(product.quantityOnHand)} u`} /><Metric label="Reservado" value={`${formatNumber(product.quantityReserved)} u`} /><Metric label="Disponible" value={`${formatNumber(product.available)} u`} /></div>
          <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><p className="text-sm font-semibold">Movimientos</p><p className="mt-0.5 text-xs text-muted-foreground">La fecha indica cuándo ocurrió la salida, el reintegro o el ajuste.</p></div><button type="button" onClick={onAdjust} className="secondary-button h-8 px-3"><CircleDollarSign className="h-4 w-4" /> Ajustar stock</button></div>
          {movementsLoading ? <LoadingBlock /> : movements.length === 0 ? <p className="px-5 py-10 text-center text-sm text-muted-foreground">Todavía no hay movimientos registrados.</p> : movements.map((movement) => <div key={movement.id} className="flex items-start justify-between gap-3 border-b border-border px-5 py-3 last:border-b-0"><div><p className="text-sm font-medium">{movementLabel(movement.movementType, movement.reason)}</p><p className="mt-1 text-xs text-muted-foreground">{movementCaption(movement)} · {formatDate(movement.effectiveAt || movement.createdAt)}</p></div><div className="text-right"><p className={cn('font-mono text-sm font-semibold', movement.quantityDelta > 0 ? 'text-emerald-600' : 'text-red-600')}>{movement.quantityDelta > 0 ? '+' : ''}{formatNumber(movement.quantityDelta)}</p><small className="text-muted-foreground">saldo {formatNumber(movement.quantityAfter)}</small></div></div>)}
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

function ListingActions({ listing, onDisassociate }: { listing: Listing; onDisassociate: (listing: Listing) => void }) {
  return <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Acciones de ${listing.sellerSku}`}><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem variant="destructive" onClick={() => onDisassociate(listing)}>Desasociar producto</DropdownMenuItem></DropdownMenuContent></DropdownMenu>;
}

function CatalogTableSkeleton() {
  return <div className="min-w-0" aria-label="Cargando productos" aria-busy="true">
    <Table className="table-fixed">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className={CATALOG_COLUMN_CLASS_NAMES.product}><Skeleton className="h-4 w-20" /></TableHead>
          <TableHead className={CATALOG_COLUMN_CLASS_NAMES.price}><Skeleton className="h-4 w-14" /></TableHead>
          <TableHead className={CATALOG_COLUMN_CLASS_NAMES.stock}><Skeleton className="h-4 w-14" /></TableHead>
          <TableHead className={CATALOG_COLUMN_CLASS_NAMES.status}><Skeleton className="h-4 w-24" /></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: 8 }, (_, row) => <TableRow key={row} className="hover:bg-transparent">
          <TableCell className="whitespace-normal py-4">
            <div className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-x-3 gap-y-3">
              <Skeleton className="h-12 w-12 rounded-lg" />
              <div className="min-w-0 space-y-2"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-24" /></div>
              <div className="col-span-2 grid grid-cols-2 gap-5 border-t border-border/60 pt-3 sm:hidden">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="col-span-2 h-7 w-full" />
              </div>
            </div>
          </TableCell>
          <TableCell className="hidden sm:table-cell"><Skeleton className="h-5 w-16" /></TableCell>
          <TableCell className="hidden sm:table-cell"><Skeleton className="h-8 w-24" /></TableCell>
          <TableCell className="hidden sm:table-cell"><Skeleton className="h-7 w-20 rounded-full" /></TableCell>
        </TableRow>)}
      </TableBody>
    </Table>
  </div>;
}

function AssociationCandidatesSkeleton() {
  return <div aria-label="Cargando productos" aria-busy="true">
    {Array.from({ length: 6 }, (_, index) => <div key={index} className="flex items-start gap-3 border-b border-border px-5 py-3">
      <Skeleton className="mt-1 h-4 w-4 shrink-0 rounded" />
      <Skeleton className="h-14 w-14 shrink-0 rounded-md" />
      <div className="min-w-0 flex-1 space-y-2 pt-0.5">
        <Skeleton className={cn('h-4', index % 3 === 0 ? 'w-4/5' : index % 3 === 1 ? 'w-2/3' : 'w-3/4')} />
        <div className="flex items-center gap-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-6 w-20 rounded-md" />
          <Skeleton className="h-3 w-10" />
        </div>
      </div>
    </div>)}
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 border-r border-border px-4 py-4 last:border-r-0"><p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 truncate text-base font-semibold">{value}</p></div>;
}

function InfoValue({ label, value }: { label: string; value: ReactNode }) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><div className="mt-1 text-sm font-medium">{value}</div></div>;
}

function ProductEditableConfig({
  product,
  profitOwners,
  savingField,
  onSaveCommission,
  onSaveProfitOwner,
}: {
  product: Product;
  profitOwners: string[];
  savingField: ProductEditableField | null;
  onSaveCommission: (value: string) => void;
  onSaveProfitOwner: (value: string) => void;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-start gap-x-10 gap-y-4">
      <ProductInlineField
        label="Comisión"
        productId={product.id}
        field="commissionAmount"
        value={product.commissionAmount == null ? '' : String(product.commissionAmount)}
        type="number"
        placeholder="Sin comisión"
        saving={savingField === 'commissionAmount'}
        onSave={onSaveCommission}
      />
      <ProductInlineField
        label="Beneficiario"
        productId={product.id}
        field="profitOwner"
        value={product.profitOwner || ''}
        placeholder="Sin beneficiario"
        list="profit-owner-inline-options"
        saving={savingField === 'profitOwner'}
        onSave={onSaveProfitOwner}
      />
      <ProfitOwnerOptions owners={profitOwners} id="profit-owner-inline-options" />
    </div>
  );
}

function ProductInlineField({
  label,
  productId,
  field,
  value,
  onSave,
  type = 'text',
  placeholder,
  list,
  saving,
}: {
  label: string;
  productId: number;
  field: string;
  value: string;
  onSave: (value: string) => void;
  type?: string;
  placeholder?: string;
  list?: string;
  saving?: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const displayed = editing ?? value;

  return (
    <div className="min-w-[8rem]">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center gap-1.5">
        <input
          key={`${productId}-${field}`}
          className={cn(
            'w-full min-w-[6rem] border-0 bg-transparent p-0 text-sm font-medium text-foreground shadow-none outline-none placeholder:text-muted-foreground/60',
            'rounded-sm focus:bg-muted/50 focus:px-1.5 focus:py-0.5',
          )}
          type={type}
          step={type === 'number' ? 'any' : undefined}
          min={type === 'number' ? '0' : undefined}
          value={displayed}
          placeholder={placeholder}
          list={list}
          onFocus={() => setEditing(value)}
          onChange={(event) => setEditing(event.target.value)}
          onBlur={() => {
            if (editing !== null) onSave(editing);
            setEditing(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              setEditing(null);
              event.currentTarget.blur();
            }
          }}
        />
        {saving ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" /> : null}
      </div>
    </div>
  );
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
  const isSellable = listing.metadata?.isSellable;
  const publiclyUnavailable = listing.metadata?.publicAvailabilityStatus === 'unavailable';
  const contentScore = metadataNumber(listing, 'contentScore');
  return <div>
    <strong className="block text-sm">{formatNumber(listing.marketplaceQuantity)} u</strong>
    {publiclyUnavailable && <small className="block leading-4 text-amber-700" title="La tienda pública de Falabella no ofrece esta publicación, aunque Seller Center reporte unidades.">
      Sin stock en Falabella
    </small>}
    {isSellable === false && <small className="block leading-4 text-amber-700" title="El stock físico no se ofrece hasta que Falabella autorice la publicación.">
      {sellabilityLabel(listing)}{contentScore != null ? ` · score ${formatNumber(contentScore, 0)}` : ''}
    </small>}
    <small className="block leading-4 text-muted-foreground">
      {fromGetStock
        ? `${publiclyUnavailable ? 'Seller Center reporta' : 'Seller'} ${formatNumber(sellerStock ?? 0)} · FBF ${formatNumber(fulfillmentStock ?? 0)}`
        : 'stock publicado'}
    </small>
  </div>;
}

function ChannelBadge({ value, listing }: { value: string; listing?: Listing }) {
  const normalized = String(value || 'externo').toLowerCase();
  const compact = normalized.replace(/[\s_-]+/g, '');
  if (compact === 'falabella') {
    const href = listing ? marketplaceProductUrl(listing) : null;
    const badgeClassName = 'inline-flex min-h-11 shrink-0 items-center gap-1 overflow-hidden rounded-md bg-muted px-1.5 text-[11px] font-medium text-muted-foreground sm:min-h-6';
    if (!listing || !href) return <span className={badgeClassName} title="Falabella">
      <img src={falabellaIcon} alt="" className="h-3.5 w-3.5 rounded-[3px]" /> Falabella
    </span>;

    return <MarketplaceProductLink href={href} listing={listing} marketplace="Falabella" className={badgeClassName}>
      <img src={falabellaIcon} alt="" className="h-3.5 w-3.5 rounded-[3px]" /> Falabella
    </MarketplaceProductLink>;
  }
  if (compact === 'ripley') {
    const href = listing ? marketplaceProductUrl(listing) : null;
    const badgeClassName = 'inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full bg-fuchsia-50 px-2 py-0.5 text-[11px] font-medium text-fuchsia-700 sm:min-h-6';
    if (!listing || !href) return <span className={badgeClassName} title="Ripley">Ripley</span>;

    return <MarketplaceProductLink href={href} listing={listing} marketplace="Ripley" className={badgeClassName}>
      Ripley
    </MarketplaceProductLink>;
  }
  const classes = compact === 'mercadolibre'
      ? 'bg-amber-50 text-amber-800'
      : 'bg-slate-100 text-slate-700';
  return <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium', classes)}>{channelLabel(normalized)}</span>;
}

function MarketplaceProductLink({ href, listing, marketplace, className, children }: { href: string; listing: Listing; marketplace: 'Falabella' | 'Ripley'; className: string; children: ReactNode }) {
  return <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => event.stopPropagation()}
      aria-label={`Ver ${listing.title || listing.sellerSku} en ${marketplace}; abre en una pestaña nueva`}
      title={`Ver producto en ${marketplace}`}
      className={cn(
        className,
        'transition-colors duration-200 hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
      )}
    >
      {children}
      <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    </a>;
}

function channelLabel(value: string) {
  const normalized = String(value || '').toLowerCase();
  const compact = normalized.replace(/[\s_-]+/g, '');
  if (compact === 'falabella') return 'Falabella';
  if (compact === 'ripley') return 'Ripley';
  if (compact === 'mercadolibre') return 'Mercado Libre';
  const readable = normalized.replace(/[_-]+/g, ' ').trim();
  return readable ? readable.charAt(0).toUpperCase() + readable.slice(1) : 'Externo';
}

function ProductStatusBadge({ product, compact = false }: { product: Product; compact?: boolean }) {
  const storedStatus = String(product.status || 'inactive').toLowerCase();
  const status = storedStatus === 'active' || storedStatus === 'archived' ? storedStatus : 'inactive';
  const label = status === 'active' ? 'Activo' : status === 'archived' ? 'Archivado' : 'Inactivo';
  const classes = status === 'active'
    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
    : status === 'archived'
      ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
      : 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300';
  return <span title="Estado del producto en ZentoFact" className={cn('inline-flex items-center rounded-full text-xs font-medium', compact ? 'gap-1 px-2 py-0.5' : 'gap-1.5 px-2.5 py-1', classes)}><span className="h-2 w-2 rounded-full bg-current" />{label}</span>;
}

function movementLabel(type: string, reason?: string | null) {
  if (type === 'return') return 'Devolución';
  if (type === 'sale_reversal') {
    return String(reason || '').startsWith('Cancelación') ? 'Cancelación' : 'Reintegro';
  }
  return ({ sale: 'Venta', sale_adjust: 'Ajuste de venta', adjustment_in: 'Entrada manual', adjustment_out: 'Salida manual', initial: 'Stock inicial', import: 'Importación' } as Record<string, string>)[type] || type;
}

function movementCaption(movement: Movement) {
  const orderRef = movement.orderNumber || (movement.orderId ? String(movement.orderId) : '');
  const reason = String(movement.reason || '').trim();
  const parts = [
    reason || (orderRef ? `Pedido ${orderRef}` : null),
    movement.companyName ? sellerShortName(movement.companyName) : null,
  ].filter(Boolean);
  if (parts.length) return parts.join(' · ');
  return movement.source || 'sistema';
}

function ProductImageDialog({ preview, onClose }: { preview: ProductImagePreview | null; onClose: () => void }) {
  return <Dialog open={preview !== null} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
    <DialogContent
      overlayClassName="z-[90] bg-black/70"
      className="z-[90] max-h-[94vh] gap-0 overflow-hidden bg-zinc-950 p-0 text-white sm:max-w-5xl [&_[data-slot=dialog-close]]:bg-white/10 [&_[data-slot=dialog-close]]:text-white [&_[data-slot=dialog-close]]:hover:bg-white/20"
    >
      {preview ? <>
        <DialogHeader className="sr-only">
          <DialogTitle>Foto de {preview.productName}</DialogTitle>
          <DialogDescription>Vista ampliada del producto con SKU {preview.sku}.</DialogDescription>
        </DialogHeader>
        <figure className="min-h-0">
          <div className="flex min-h-64 items-center justify-center overflow-hidden p-4 sm:min-h-[32rem] sm:p-8">
            <img src={preview.src} alt={preview.productName} className="max-h-[calc(94vh-8rem)] max-w-full object-contain" />
          </div>
          <figcaption className="border-t border-white/10 bg-black/30 px-5 py-4 pr-16">
            <p className="line-clamp-2 text-sm font-medium text-white">{preview.productName}</p>
            <p className="mt-1 font-mono text-xs text-white/60">SKU {preview.sku}</p>
          </figcaption>
        </figure>
      </> : null}
    </DialogContent>
  </Dialog>;
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

function Field({
  label,
  value,
  onChange,
  required,
  type = 'text',
  className,
  list,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: string;
  className?: string;
  list?: string;
}) {
  return <label className={cn('label', className)}>{label}{required && ' *'}<input className="field" type={type} step={type === 'number' ? 'any' : undefined} value={value} onChange={(event) => onChange(event.target.value)} required={required} list={list} min={type === 'number' ? '0' : undefined} /></label>;
}

function ProfitOwnerOptions({ owners, id = 'profit-owner-options' }: { owners: string[]; id?: string }) {
  return <datalist id={id}>{owners.map((owner) => <option key={owner} value={owner} />)}</datalist>;
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
