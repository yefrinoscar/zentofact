import { memo, useEffect, useRef, useState } from 'react';
import { Loader2, Package, Search, X } from 'lucide-react';
import { cn } from '../lib/cn';
import {
  formatProductStock,
  productPrice,
  productStock,
  type CatalogProductForSale,
} from '../lib/registrar-venta';
import { useIsMobile } from '../hooks/useIsMobile';
import { useVisualViewportCssVar } from '../hooks/useVisualViewportLayout';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Input } from './ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from './ui/sheet';

function formatMoney(value: number) {
  try {
    return new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(Number(value || 0));
  } catch {
    return `S/ ${Number(value || 0).toFixed(2)}`;
  }
}

function falabellaMediaUrl(shopSku?: string | null) {
  const sku = String(shopSku || '').trim();
  if (!sku || !/^[A-Za-z0-9_-]+$/.test(sku)) return '';
  return `https://media.falabella.com/falabellaPE/${sku}_01`;
}

function productImageSrc(url?: string | null, shopSku?: string | null, sku?: string | null) {
  const value = String(url || '').trim() || falabellaMediaUrl(shopSku) || falabellaMediaUrl(sku);
  if (!value) return '';
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'https:' && /(^|\.)falabella\.com$/i.test(parsed.hostname)) {
      return `/catalog/image?url=${encodeURIComponent(value)}`;
    }
  } catch {
    return value;
  }
  return value;
}

const ProductPhoto = memo(function ProductPhoto({
  url,
  shopSku,
  sku,
  name,
}: {
  url?: string | null;
  shopSku?: string | null;
  sku?: string | null;
  name: string;
}) {
  const [failedCount, setFailedCount] = useState(0);
  const candidates = [
    productImageSrc(url),
    productImageSrc(null, shopSku),
    productImageSrc(null, null, sku),
  ].filter((src, index, list) => src && list.indexOf(src) === index);
  const src = candidates[failedCount] || '';

  if (!src) {
    return (
      <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-muted sm:size-12 sm:rounded-md" aria-hidden="true">
        <Package className="size-4 text-muted-foreground" />
      </span>
    );
  }

  return (
    <img
      src={src}
      alt=""
      title={name}
      loading="lazy"
      decoding="async"
      onError={() => setFailedCount((current) => current + 1)}
      className="size-11 shrink-0 rounded-lg bg-muted object-cover sm:size-12 sm:rounded-md"
    />
  );
});

function SearchField({
  value,
  onChange,
  onSubmit,
  inputRef,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        type="search"
        enterKeyHint="search"
        inputMode="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onSubmit();
          }
        }}
        placeholder="Buscar por nombre o SKU"
        aria-label="Buscar producto"
        className="h-11 rounded-xl border-0 bg-muted/70 pl-10 pr-10 text-base shadow-none focus-visible:bg-background focus-visible:ring-2 sm:h-10 sm:rounded-lg sm:text-sm"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-1 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground active:bg-muted/80"
          aria-label="Limpiar búsqueda"
        >
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

const ProductRow = memo(function ProductRow({
  product,
  disabled,
  onSelect,
}: {
  product: CatalogProductForSale;
  disabled: boolean;
  onSelect: (product: CatalogProductForSale) => void;
}) {
  const outOfStock = productStock(product) <= 0;
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        aria-disabled={disabled}
        aria-label={disabled
          ? (outOfStock ? `${product.name}, sin stock` : `${product.name}, ya está en el pedido`)
          : product.name}
        onClick={() => {
          if (disabled) return;
          onSelect(product);
        }}
        className={cn(
          'flex w-full items-center gap-3 px-4 py-3.5 text-left sm:px-5 sm:py-3',
          disabled
            ? 'cursor-not-allowed opacity-50'
            : 'cursor-pointer active:bg-muted/70 sm:hover:bg-muted/50',
        )}
      >
        <ProductPhoto
          url={product.imageUrl}
          shopSku={product.listings?.[0]?.shopSku}
          sku={product.mainSku}
          name={product.name}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium leading-5 sm:text-sm">{product.name}</span>
          <span className="mt-0.5 block truncate font-mono text-xs text-muted-foreground sm:text-[11px]">{product.mainSku}</span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-[15px] font-semibold tabular-nums sm:text-sm sm:font-medium">
            {formatMoney(productPrice(product))}
          </span>
          <span className={cn(
            'mt-0.5 block text-xs tabular-nums sm:text-[11px]',
            outOfStock ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground',
          )}
          >
            {outOfStock ? 'Sin stock' : formatProductStock(product)}
          </span>
        </span>
      </button>
    </li>
  );
});

function ProductResults({
  products,
  isFetching,
  submittedSearch,
  onSelect,
  canSelect,
}: {
  products: CatalogProductForSale[];
  isFetching: boolean;
  submittedSearch: string;
  onSelect: (product: CatalogProductForSale) => void;
  canSelect: (product: CatalogProductForSale) => boolean;
}) {
  if (isFetching && !products.length) {
    return (
      <div className="flex items-center justify-center gap-2 px-5 py-12 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
        Buscando productos…
      </div>
    );
  }

  if (!products.length) {
    return (
      <p className="px-5 py-12 text-center text-sm text-muted-foreground">
        {submittedSearch ? 'No hay productos con esa búsqueda.' : 'Escribe para buscar en el catálogo.'}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {products.map((product) => (
        <ProductRow
          key={product.id}
          product={product}
          disabled={!canSelect(product)}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}

function MobilePickerChrome({
  onClose,
  search,
  onSearchChange,
  onSubmitSearch,
  searchInputRef,
}: {
  onClose: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  onSubmitSearch: () => void;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="sticky top-0 z-10 border-b border-border bg-background">
      <div className="px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div aria-hidden="true" className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/25" />
        <div className="flex items-start gap-3 pr-2">
          <div className="min-w-0 flex-1">
            <SheetHeader className="gap-1 text-left">
              <SheetTitle className="text-[17px] leading-tight">Elegir producto</SheetTitle>
              <SheetDescription className="text-[13px] leading-snug">
                Busca por nombre o SKU. Sin stock no se agrega.
              </SheetDescription>
            </SheetHeader>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 shrink-0 cursor-pointer px-3 text-[15px] font-medium"
            onClick={onClose}
          >
            Listo
          </Button>
        </div>
      </div>
      <div className="px-4 pb-3">
        <SearchField
          value={search}
          onChange={onSearchChange}
          onSubmit={onSubmitSearch}
          inputRef={searchInputRef}
        />
      </div>
    </div>
  );
}

function DesktopPickerBody({
  search,
  onSearchChange,
  onSubmitSearch,
  products,
  isFetching,
  submittedSearch,
  onSelect,
  canSelect,
  searchInputRef,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  onSubmitSearch: () => void;
  products: CatalogProductForSale[];
  isFetching: boolean;
  submittedSearch: string;
  onSelect: (product: CatalogProductForSale) => void;
  canSelect: (product: CatalogProductForSale) => boolean;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <>
      <div className="shrink-0 border-b border-border px-5 py-3">
        <SearchField
          value={search}
          onChange={onSearchChange}
          onSubmit={onSubmitSearch}
          inputRef={searchInputRef}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ProductResults
          products={products}
          isFetching={isFetching}
          submittedSearch={submittedSearch}
          onSelect={onSelect}
          canSelect={canSelect}
        />
      </div>
    </>
  );
}

export function ProductSearchPicker({
  open,
  onOpenChange,
  search,
  onSearchChange,
  onSubmitSearch,
  products,
  isFetching,
  submittedSearch,
  onSelect,
  canSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  search: string;
  onSearchChange: (value: string) => void;
  onSubmitSearch: () => void;
  products: CatalogProductForSale[];
  isFetching: boolean;
  submittedSearch: string;
  onSelect: (product: CatalogProductForSale) => void;
  canSelect?: (product: CatalogProductForSale) => boolean;
}) {
  const isMobile = useIsMobile();
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useVisualViewportCssVar(open && isMobile);
  const productSelectable = canSelect || ((product: CatalogProductForSale) => productStock(product) > 0);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      searchRef.current?.focus({ preventScroll: true });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open || !isMobile) return;
    scrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [open, isMobile, submittedSearch]);

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="h-[var(--picker-vvh,100dvh)] max-h-[var(--picker-vvh,100dvh)] gap-0 overflow-hidden border-border p-0"
        >
          <div
            ref={scrollRef}
            className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]"
          >
            <MobilePickerChrome
              onClose={() => onOpenChange(false)}
              search={search}
              onSearchChange={onSearchChange}
              onSubmitSearch={onSubmitSearch}
              searchInputRef={searchRef}
            />
            <ProductResults
              products={products}
              isFetching={isFetching}
              submittedSearch={submittedSearch}
              onSelect={onSelect}
              canSelect={productSelectable}
            />
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="border-b border-border px-5 py-4 pr-14">
          <DialogTitle>Elegir producto</DialogTitle>
          <DialogDescription>Busca por nombre o SKU. Sin stock no se agrega.</DialogDescription>
        </DialogHeader>
        <DesktopPickerBody
          search={search}
          onSearchChange={onSearchChange}
          onSubmitSearch={onSubmitSearch}
          products={products}
          isFetching={isFetching}
          submittedSearch={submittedSearch}
          onSelect={onSelect}
          canSelect={productSelectable}
          searchInputRef={searchRef}
        />
      </DialogContent>
    </Dialog>
  );
}
