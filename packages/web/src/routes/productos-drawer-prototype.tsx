// Five chrome options for the product drawer Resumen, switchable via ?variant=, on /#/productos.
// Question: what should the drawer chrome look like (header, tabs, metrics, actions)?
import type { ReactNode } from 'react';
import {
  BarChart3,
  Boxes,
  ChevronDown,
  LayoutDashboard,
  MoreHorizontal,
  Package,
  PackagePlus,
  Plus,
  RefreshCw,
  Store,
} from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Button } from '../components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu';
import { cn } from '../lib/cn';
import type { PrototypeVariant } from '../components/PrototypeSwitcher';

export const DRAWER_PROTOTYPE_VARIANTS: PrototypeVariant[] = [
  { key: 'A', name: 'Ficha · una fila' },
  { key: 'B', name: 'Cartel · foto + pie' },
  { key: 'C', name: 'Carril · iconos' },
  { key: 'D', name: 'Compacto · chips' },
  { key: 'E', name: 'Tres + Más' },
];

export type PrototypeDrawerProduct = {
  id: number;
  name: string;
  mainSku: string;
  imageUrl?: string | null;
  referencePrice?: number | null;
  commissionAmount?: number | null;
  profitOwner?: string | null;
  quantityOnHand: number;
  quantityReserved: number;
  description?: string | null;
  status?: string | null;
  updatedAt?: string | null;
};

type DrawerTab = 'overview' | 'listings' | 'inventory' | 'sales' | 'returns';

type PrototypeProductDrawerProps = {
  variant: string;
  open: boolean;
  product: PrototypeDrawerProduct | null;
  tab: DrawerTab;
  onTabChange: (tab: DrawerTab) => void;
  onClose: () => void;
  onAdjust: () => void;
  onAssociate: () => void;
  onPublish: () => void;
  onSaveName: (value: string) => void;
  onSavePrice: (value: string) => void;
  onSaveStock: (value: string) => void;
};

const TABS: Array<{ value: DrawerTab; label: string; short: string }> = [
  { value: 'overview', label: 'Resumen', short: 'Resumen' },
  { value: 'listings', label: 'Publicaciones', short: 'Pubs' },
  { value: 'inventory', label: 'Inventario', short: 'Stock' },
  { value: 'sales', label: 'Ventas', short: 'Ventas' },
  { value: 'returns', label: 'Devoluciones', short: 'Dev.' },
];

function soles(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number} soles` : 'Sin precio';
}

function units(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number} unidades` : '—';
}

function when(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('es-PE');
}

const SHEET_CLASS: Record<string, string> = {
  A: 'overflow-hidden border-l bg-background sm:max-w-md',
  B: 'overflow-hidden border-l-0 p-0 sm:max-w-sm',
  C: 'overflow-hidden border-l p-0 sm:max-w-2xl',
  D: 'overflow-hidden sm:max-w-lg',
  E: 'overflow-hidden sm:max-w-xl',
};

export function PrototypeProductDrawer(props: PrototypeProductDrawerProps) {
  const { open, onClose, variant } = props;
  const keepSwitcher = (event: Event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-prototype-switcher]')) event.preventDefault();
  };
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <SheetContent
        className={SHEET_CLASS[variant] || SHEET_CLASS.A}
        onPointerDownOutside={keepSwitcher}
        onInteractOutside={keepSwitcher}
        onFocusOutside={keepSwitcher}
      >
        {variant === 'B' ? <CartelDrawer {...props} />
          : variant === 'C' ? <RailDrawer {...props} />
            : variant === 'D' ? <CompactDrawer {...props} />
              : variant === 'E' ? <ThreeTabDrawer {...props} />
                : <FichaDrawer {...props} />}
      </SheetContent>
    </Sheet>
  );
}

function Field({
  label,
  value,
  strong,
  onClick,
}: {
  label: string;
  value: ReactNode;
  strong?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={!onClick}
      onClick={onClick}
      className="grid w-full grid-cols-[7.5rem_minmax(0,1fr)] items-baseline gap-x-4 py-2 text-left disabled:cursor-default"
    >
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className={cn('text-[15px] text-foreground', strong && 'text-lg font-semibold tracking-tight text-zinc-950')}>
        {value}
      </span>
    </button>
  );
}

function OtherTab({ children }: { children: ReactNode }) {
  return <p className="px-1 py-8 text-sm text-muted-foreground">{children}</p>;
}

function PlaceholderTabs({ tab }: { tab: DrawerTab }) {
  const copy = {
    listings: 'Publicaciones se quedan en esta pestaña, fuera del Resumen.',
    inventory: 'Inventario y movimientos siguen aquí.',
    sales: 'Ventas del producto.',
    returns: 'Devoluciones del producto.',
    overview: '',
  } as const;
  return <TabsContent value={tab} className="px-5"><OtherTab>{copy[tab]}</OtherTab></TabsContent>;
}

function FichaDrawer({
  open,
  product,
  tab,
  onTabChange,
  onClose,
  onAdjust,
  onAssociate,
  onPublish,
  onSavePrice,
  onSaveStock,
}: PrototypeProductDrawerProps) {
  return (
    <>
        <SheetHeader className="space-y-2 px-5 pb-3 pt-9 pr-14">
          <p className="text-xs text-muted-foreground">
            {product?.mainSku} · {product?.status === 'active' ? 'Activo' : 'Inactivo'}
          </p>
          <SheetTitle className="text-xl leading-7">{product?.name || 'Producto'}</SheetTitle>
          <SheetDescription className="sr-only">Ficha del producto</SheetDescription>
        </SheetHeader>
        <Tabs value={tab} onValueChange={(value) => onTabChange(value as DrawerTab)} className="min-h-0 flex-1 overflow-hidden">
          <div className="overflow-x-auto px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <TabsList variant="line" className="h-11 w-max min-w-full justify-start gap-5 bg-transparent p-0">
              {TABS.map((item) => (
                <TabsTrigger key={item.value} value={item.value} className="h-11 flex-none rounded-none px-0 text-sm">
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <TabsContent value="overview" className="min-h-0 overflow-y-auto px-5 py-4">
            {product ? (
              <div>
                <Field label="Stock" value={units(product.quantityOnHand)} onClick={() => onSaveStock(String(product.quantityOnHand))} />
                <Field label="Reservado" value={units(product.quantityReserved)} />
                <Field
                  label="Precio"
                  value={soles(product.referencePrice)}
                  strong
                  onClick={() => onSavePrice(product.referencePrice == null ? '' : String(product.referencePrice))}
                />
                <Field label="Comisión" value={product.commissionAmount == null ? 'Sin comisión' : soles(product.commissionAmount)} />
                <Field label="Beneficiario" value={product.profitOwner || 'Sin beneficiario'} />
                <Field label="Actualizado" value={when(product.updatedAt)} />
                <div className="pt-3">
                  <p className="text-[13px] text-muted-foreground">Descripción</p>
                  <p className="mt-1 text-[15px] leading-6">{product.description || 'Sin descripción'}</p>
                </div>
                <div className="mt-6 flex gap-2">
                  <button type="button" className="secondary-button h-9" onClick={onAdjust}>Ajustar stock</button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label="Más acciones">
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-auto min-w-44">
                      <DropdownMenuItem onClick={onAssociate}>Asociar producto</DropdownMenuItem>
                      <DropdownMenuItem onClick={onPublish}>Nueva publicación</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ) : null}
          </TabsContent>
          <PlaceholderTabs tab="listings" />
          <PlaceholderTabs tab="inventory" />
          <PlaceholderTabs tab="sales" />
          <PlaceholderTabs tab="returns" />
        </Tabs>
    </>
  );
}

function CartelDrawer({
  open,
  product,
  tab,
  onTabChange,
  onClose,
  onAdjust,
  onAssociate,
  onPublish,
}: PrototypeProductDrawerProps) {
  return (
    <>
        <div className="h-44 bg-muted">
          {product?.imageUrl ? (
            <img src={product.imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full place-items-center">
              <Boxes className="size-8 text-muted-foreground" />
            </div>
          )}
        </div>
        <SheetHeader className="space-y-2 px-5 pb-3 pt-4 pr-14">
          <SheetTitle className="text-xl leading-7">{product?.name || 'Producto'}</SheetTitle>
          <SheetDescription className="font-mono text-sm text-foreground">{product?.mainSku}</SheetDescription>
          <p className="text-2xl font-semibold tracking-tight text-zinc-950">{product ? soles(product.referencePrice) : '—'}</p>
          <div className="flex gap-8 text-sm">
            <p>
              <span className="block text-muted-foreground">Stock</span>
              <strong>{product ? units(product.quantityOnHand) : '—'}</strong>
            </p>
            <p>
              <span className="block text-muted-foreground">Reservado</span>
              <strong>{product ? units(product.quantityReserved) : '—'}</strong>
            </p>
          </div>
        </SheetHeader>
        <Tabs value={tab} onValueChange={(value) => onTabChange(value as DrawerTab)} className="min-h-0 flex-1 overflow-hidden">
          <div className="overflow-x-auto px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <TabsList className="h-9 w-max justify-start gap-1">
              {TABS.map((item) => (
                <TabsTrigger key={item.value} value={item.value} className="flex-none px-2.5 text-xs">
                  {item.short}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <TabsContent value="overview" className="min-h-0 overflow-y-auto px-5 py-3">
            <Field label="Comisión" value={product?.commissionAmount == null ? 'Sin comisión' : soles(product.commissionAmount)} />
            <Field label="Beneficiario" value={product?.profitOwner || 'Sin beneficiario'} />
            <Field label="Actualizado" value={when(product?.updatedAt)} />
            <p className="pt-3 text-[15px] leading-6">{product?.description || 'Sin descripción'}</p>
          </TabsContent>
          <PlaceholderTabs tab="listings" />
          <PlaceholderTabs tab="inventory" />
          <PlaceholderTabs tab="sales" />
          <PlaceholderTabs tab="returns" />
        </Tabs>
        <div className="grid gap-2 border-t px-5 py-3">
          <button type="button" className="primary-button h-10" onClick={onAdjust}>Ajustar stock</button>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="secondary-button h-9 justify-center" onClick={onAssociate}>Asociar</button>
            <button type="button" className="secondary-button h-9 justify-center" onClick={onPublish}>Publicar</button>
          </div>
        </div>
    </>
  );
}

function RailDrawer({
  open,
  product,
  tab,
  onTabChange,
  onClose,
  onAdjust,
  onAssociate,
  onPublish,
}: PrototypeProductDrawerProps) {
  return (
    <>
        <Tabs
          value={tab}
          onValueChange={(value) => onTabChange(value as DrawerTab)}
          orientation="vertical"
          className="flex min-h-0 flex-1 flex-row overflow-hidden"
        >
          <TabsList className="h-auto w-16 shrink-0 flex-col gap-1 rounded-none bg-muted/50 p-2">
            <TabsTrigger value="overview" className="size-12 flex-none p-0" title="Resumen"><LayoutDashboard className="size-5" /></TabsTrigger>
            <TabsTrigger value="listings" className="size-12 flex-none p-0" title="Publicaciones"><Store className="size-5" /></TabsTrigger>
            <TabsTrigger value="inventory" className="size-12 flex-none p-0" title="Inventario"><Boxes className="size-5" /></TabsTrigger>
            <TabsTrigger value="sales" className="size-12 flex-none p-0" title="Ventas"><BarChart3 className="size-5" /></TabsTrigger>
            <TabsTrigger value="returns" className="size-12 flex-none p-0" title="Devoluciones"><RefreshCw className="size-5" /></TabsTrigger>
          </TabsList>
          <div className="min-w-0 flex-1 overflow-y-auto px-7 py-8 pr-14">
            <SheetHeader className="mb-6 space-y-2 p-0">
              <SheetTitle className="text-2xl leading-8">{product?.name || 'Producto'}</SheetTitle>
              <SheetDescription className="font-mono text-sm text-foreground">{product?.mainSku}</SheetDescription>
              <p className="flex gap-4 text-sm">
                <button type="button" className="text-primary underline-offset-4 hover:underline" onClick={onAdjust}>Ajustar stock</button>
                <button type="button" className="text-primary underline-offset-4 hover:underline" onClick={onAssociate}>Asociar</button>
                <button type="button" className="text-primary underline-offset-4 hover:underline" onClick={onPublish}>Publicar</button>
              </p>
            </SheetHeader>
            <TabsContent value="overview" className="mt-0">
              <div className="max-w-sm">
                <div className="mb-5 space-y-1">
                  <p className="text-[13px] text-muted-foreground">Stock</p>
                  <p className="text-lg font-medium">{product ? units(product.quantityOnHand) : '—'}</p>
                  <p className="text-sm text-muted-foreground">Reservado {product ? units(product.quantityReserved) : '—'}</p>
                </div>
                <p className="text-2xl font-semibold tracking-tight text-zinc-950">{product ? soles(product.referencePrice) : '—'}</p>
                <div className="mt-5">
                  <Field label="Comisión" value={product?.commissionAmount == null ? 'Sin comisión' : soles(product.commissionAmount)} />
                  <Field label="Beneficiario" value={product?.profitOwner || 'Sin beneficiario'} />
                  <Field label="Actualizado" value={when(product?.updatedAt)} />
                </div>
                <p className="mt-5 text-[15px] leading-6">{product?.description || 'Sin descripción'}</p>
              </div>
            </TabsContent>
            <TabsContent value="listings"><OtherTab>Publicaciones a la derecha del carril.</OtherTab></TabsContent>
            <TabsContent value="inventory"><OtherTab>Inventario.</OtherTab></TabsContent>
            <TabsContent value="sales"><OtherTab>Ventas.</OtherTab></TabsContent>
            <TabsContent value="returns"><OtherTab>Devoluciones.</OtherTab></TabsContent>
          </div>
        </Tabs>
    </>
  );
}

function CompactDrawer({
  open,
  product,
  tab,
  onTabChange,
  onClose,
  onAdjust,
  onAssociate,
  onPublish,
}: PrototypeProductDrawerProps) {
  return (
    <>
        <SheetHeader className="flex-row items-center gap-3 px-5 pb-3 pt-8 pr-14">
          <div className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted">
            {product?.imageUrl ? (
              <img src={product.imageUrl} alt="" className="size-11 object-cover" />
            ) : (
              <Package className="size-5 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0">
            <SheetTitle className="truncate text-base">{product?.name || 'Producto'}</SheetTitle>
            <SheetDescription className="font-mono text-xs">{product?.mainSku}</SheetDescription>
          </div>
        </SheetHeader>
        <Tabs value={tab} onValueChange={(value) => onTabChange(value as DrawerTab)} className="min-h-0 flex-1 overflow-hidden">
          <div className="px-5">
            <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1.5 bg-transparent p-0">
              {TABS.map((item) => (
                <TabsTrigger
                  key={item.value}
                  value={item.value}
                  className="h-7 flex-none rounded-full border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-600 shadow-none data-active:border-zinc-900 data-active:bg-zinc-900 data-active:text-white"
                >
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <p className="px-5 py-2 text-sm text-muted-foreground">
            <button type="button" className="hover:text-foreground" onClick={onAdjust}>Ajustar</button>
            {' · '}
            <button type="button" className="hover:text-foreground" onClick={onAssociate}>Asociar</button>
            {' · '}
            <button type="button" className="hover:text-foreground" onClick={onPublish}>Publicar</button>
          </p>
          <TabsContent value="overview" className="min-h-0 overflow-y-auto px-5 py-1">
            <Field label="Stock" value={product ? units(product.quantityOnHand) : '—'} />
            <Field label="Reservado" value={product ? units(product.quantityReserved) : '—'} />
            <Field label="Precio" value={product ? soles(product.referencePrice) : '—'} strong />
            <Field label="Comisión" value={product?.commissionAmount == null ? 'Sin comisión' : soles(product.commissionAmount)} />
            <Field label="Beneficiario" value={product?.profitOwner || 'Sin beneficiario'} />
            <Field label="Actualizado" value={when(product?.updatedAt)} />
            <p className="pt-3 text-sm leading-6">{product?.description || 'Sin descripción'}</p>
          </TabsContent>
          <PlaceholderTabs tab="listings" />
          <PlaceholderTabs tab="inventory" />
          <PlaceholderTabs tab="sales" />
          <PlaceholderTabs tab="returns" />
        </Tabs>
    </>
  );
}

function ThreeTabDrawer({
  open,
  product,
  tab,
  onTabChange,
  onClose,
  onAdjust,
  onAssociate,
  onPublish,
}: PrototypeProductDrawerProps) {
  const moreActive = tab === 'inventory' || tab === 'sales' || tab === 'returns';
  return (
    <>
        <SheetHeader className="space-y-2 px-5 pb-4 pt-8 pr-14">
          <div className="flex gap-4">
            <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-muted">
              {product?.imageUrl ? (
                <img src={product.imageUrl} alt="" className="size-16 object-cover" />
              ) : (
                <Boxes className="size-6 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0">
              <SheetTitle className="text-lg leading-6">{product?.name || 'Producto'}</SheetTitle>
              <SheetDescription className="mt-1 font-mono text-sm text-foreground">{product?.mainSku}</SheetDescription>
            </div>
          </div>
        </SheetHeader>
        <div className="px-5 pb-3">
          <div className="flex gap-1 rounded-xl bg-muted/70 p-1">
            <button
              type="button"
              className={cn('h-10 flex-1 rounded-lg text-sm', tab === 'overview' && 'bg-background shadow-sm')}
              onClick={() => onTabChange('overview')}
            >
              Resumen
            </button>
            <button
              type="button"
              className={cn('h-10 flex-1 rounded-lg text-sm', tab === 'listings' && 'bg-background shadow-sm')}
              onClick={() => onTabChange('listings')}
            >
              Publicaciones
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn('inline-flex h-10 flex-1 items-center justify-center gap-1 rounded-lg text-sm', moreActive && 'bg-background shadow-sm')}
                >
                  Más <ChevronDown className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-auto min-w-44">
                <DropdownMenuItem onClick={() => onTabChange('inventory')}>Inventario</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onTabChange('sales')}>Ventas</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onTabChange('returns')}>Devoluciones</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {tab === 'overview' && product ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">
            <Field label="Stock" value={units(product.quantityOnHand)} />
            <Field label="Reservado" value={units(product.quantityReserved)} />
            <Field label="Precio" value={soles(product.referencePrice)} strong />
            <Field label="Comisión" value={product.commissionAmount == null ? 'Sin comisión' : soles(product.commissionAmount)} />
            <Field label="Beneficiario" value={product.profitOwner || 'Sin beneficiario'} />
            <Field label="Actualizado" value={when(product.updatedAt)} />
            <p className="pt-3 text-[15px] leading-6">{product.description || 'Sin descripción'}</p>
            <div className="mt-6 flex flex-wrap gap-2">
              <button type="button" className="secondary-button h-9" onClick={onAdjust}><Plus className="size-4" /> Ajustar</button>
              <button type="button" className="secondary-button h-9" onClick={onAssociate}>Asociar</button>
              <button type="button" className="secondary-button h-9" onClick={onPublish}><PackagePlus className="size-4" /> Publicar</button>
            </div>
          </div>
        ) : (
          <div className="px-5">
            <OtherTab>
              {tab === 'listings' ? 'Publicaciones.' : tab === 'inventory' ? 'Inventario.' : tab === 'sales' ? 'Ventas.' : 'Devoluciones.'}
            </OtherTab>
          </div>
        )}
    </>
  );
}
