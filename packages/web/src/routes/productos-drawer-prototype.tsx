// Five chrome options for the product drawer Resumen, switchable via ?variant=, on /#/productos.
// Question: what should the drawer chrome look like (header, tabs, metrics, actions)?
import type { ReactNode } from 'react';
import { ChevronDown, MoreHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../components/ui/sheet';
import { Button } from '../components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu';
import { cn } from '../lib/cn';
import type { PrototypeVariant } from '../components/PrototypeSwitcher';

export const DRAWER_PROTOTYPE_VARIANTS: PrototypeVariant[] = [
  { key: 'A', name: 'Propiedades' },
  { key: 'B', name: 'Cifras' },
  { key: 'C', name: 'Sección' },
  { key: 'D', name: 'Dos columnas' },
  { key: 'E', name: 'Ficha alta' },
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

const TABS: Array<{ value: DrawerTab; label: string }> = [
  { value: 'overview', label: 'Resumen' },
  { value: 'listings', label: 'Publicaciones' },
  { value: 'inventory', label: 'Inventario' },
  { value: 'sales', label: 'Ventas' },
  { value: 'returns', label: 'Devoluciones' },
];

const SHEET_CLASS: Record<string, string> = {
  A: 'overflow-hidden border-l border-zinc-200/80 bg-white sm:max-w-[400px]',
  B: 'overflow-hidden border-l border-zinc-200/80 bg-white sm:max-w-[440px]',
  C: 'overflow-hidden border-l border-zinc-200/80 bg-white sm:max-w-[420px]',
  D: 'overflow-hidden border-l border-zinc-200/80 bg-white p-0 sm:max-w-[560px]',
  E: 'overflow-hidden border-l border-zinc-200/80 bg-white sm:max-w-[420px]',
};

function money(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('es-PE', { maximumFractionDigits: 2 }) : null;
}

function count(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('es-PE') : '—';
}

function day(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('es-PE', { day: 'numeric', month: 'short', year: 'numeric' });
}

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
        {variant === 'B' ? <Cifras {...props} />
          : variant === 'C' ? <Seccion {...props} />
            : variant === 'D' ? <DosColumnas {...props} />
              : variant === 'E' ? <FichaAlta {...props} />
                : <Propiedades {...props} />}
      </SheetContent>
    </Sheet>
  );
}

function Actions({ onAdjust, onAssociate, onPublish }: Pick<PrototypeProductDrawerProps, 'onAdjust' | 'onAssociate' | 'onPublish'>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" className="absolute right-14 top-4 size-8 text-zinc-500" aria-label="Más acciones">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-44">
        <DropdownMenuItem onClick={onAdjust}>Ajustar stock</DropdownMenuItem>
        <DropdownMenuItem onClick={onAssociate}>Asociar producto</DropdownMenuItem>
        <DropdownMenuItem onClick={onPublish}>Nueva publicación</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Sku({ sku }: { sku?: string }) {
  if (!sku) return null;
  return (
    <button
      type="button"
      title="Copiar SKU"
      className="font-mono text-[13px] font-medium tracking-wide text-zinc-500 hover:text-zinc-950"
      onClick={() => void navigator.clipboard.writeText(sku)}
    >
      {sku}
    </button>
  );
}

function Status({ value }: { value?: string | null }) {
  if (!value) return null;
  const label = value === 'active' ? 'Activo' : value === 'inactive' ? 'Inactivo' : 'Archivado';
  return <span className="text-[13px] text-zinc-400">{label}</span>;
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="pt-8 text-[14px] leading-6 text-zinc-500">{children}</p>;
}

function UnderlineTabs({
  tab,
  onTabChange,
}: {
  tab: DrawerTab;
  onTabChange: (tab: DrawerTab) => void;
}) {
  return (
    <div className="relative">
      <div className="flex gap-5 overflow-x-auto [mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => onTabChange(item.value)}
            className={cn(
              'relative shrink-0 pb-2.5 text-[13px] tracking-[-0.01em]',
              tab === item.value ? 'font-medium text-zinc-950' : 'text-zinc-400 hover:text-zinc-700',
            )}
          >
            {item.label}
            {tab === item.value ? <span className="absolute inset-x-0 -bottom-px h-px bg-zinc-950" /> : null}
          </button>
        ))}
      </div>
      <div className="absolute inset-x-0 bottom-0 h-px bg-zinc-200/90" />
    </div>
  );
}

function Propiedades({
  product,
  tab,
  onTabChange,
  onAdjust,
  onAssociate,
  onPublish,
}: PrototypeProductDrawerProps) {
  return (
    <>
      <Actions onAdjust={onAdjust} onAssociate={onAssociate} onPublish={onPublish} />
      <SheetHeader className="space-y-3 px-6 pb-5 pt-11 pr-24">
        <p className="flex items-center gap-2">
          <Sku sku={product?.mainSku} />
          {product?.mainSku && product?.status ? <span className="text-zinc-300">·</span> : null}
          <Status value={product?.status} />
        </p>
        <SheetTitle className="text-[22px] font-semibold leading-7 tracking-[-0.03em] text-zinc-950">
          {product?.name || 'Producto'}
        </SheetTitle>
        <SheetDescription className="sr-only">Resumen del producto</SheetDescription>
      </SheetHeader>
      <div className="px-6">
        <UnderlineTabs tab={tab} onTabChange={onTabChange} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        {tab !== 'overview' ? (
          <Quiet>{TABS.find((item) => item.value === tab)?.label}.</Quiet>
        ) : product ? (
          <div className="space-y-5">
            <div>
              <p className="text-[11px] font-medium tracking-[0.08em] text-zinc-400 uppercase">Stock</p>
              <p className="mt-1 text-[15px] tabular-nums text-zinc-950">{count(product.quantityOnHand)} unidades</p>
              <p className="mt-0.5 text-[13px] tabular-nums text-zinc-500">{count(product.quantityReserved)} reservadas</p>
            </div>
            <div>
              <p className="text-[11px] font-medium tracking-[0.08em] text-zinc-400 uppercase">Precio</p>
              <p className="mt-1 text-[22px] font-semibold tabular-nums tracking-[-0.03em] text-zinc-950">
                {money(product.referencePrice) ? `${money(product.referencePrice)} soles` : 'Sin precio'}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-medium tracking-[0.08em] text-zinc-400 uppercase">Comisión</p>
              <p className="mt-1 text-[15px] text-zinc-950">
                {product.commissionAmount == null ? 'Sin comisión' : `${money(product.commissionAmount)} soles`}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-medium tracking-[0.08em] text-zinc-400 uppercase">Beneficiario</p>
              <p className="mt-1 text-[15px] text-zinc-950">{product.profitOwner || 'Sin beneficiario'}</p>
            </div>
            <div>
              <p className="text-[11px] font-medium tracking-[0.08em] text-zinc-400 uppercase">Actualizado</p>
              <p className="mt-1 text-[15px] text-zinc-950">{day(product.updatedAt)}</p>
            </div>
            <div>
              <p className="text-[11px] font-medium tracking-[0.08em] text-zinc-400 uppercase">Descripción</p>
              <p className="mt-1 text-[15px] leading-6 text-zinc-700">{product.description || 'Sin descripción'}</p>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

function Cifras({
  product,
  tab,
  onTabChange,
  onAdjust,
  onAssociate,
  onPublish,
  onSavePrice,
  onSaveStock,
}: PrototypeProductDrawerProps) {
  return (
    <>
      <Actions onAdjust={onAdjust} onAssociate={onAssociate} onPublish={onPublish} />
      <SheetHeader className="space-y-2 px-6 pb-5 pt-11 pr-24">
        <SheetTitle className="text-[22px] font-semibold leading-7 tracking-[-0.03em] text-zinc-950">
          {product?.name || 'Producto'}
        </SheetTitle>
        <SheetDescription className="sr-only">Resumen del producto</SheetDescription>
        <p className="flex items-center gap-2">
          <Sku sku={product?.mainSku} />
          <Status value={product?.status} />
        </p>
      </SheetHeader>
      {tab === 'overview' && product ? (
        <div className="grid grid-cols-3 px-6 pb-6">
          <button type="button" className="pr-4 text-left" onClick={() => onSavePrice(product.referencePrice == null ? '' : String(product.referencePrice))}>
            <p className="text-[22px] font-semibold tabular-nums tracking-[-0.03em] text-zinc-950">
              {money(product.referencePrice) ?? '—'}
            </p>
            <p className="mt-1 text-[12px] text-zinc-500">Precio, soles</p>
          </button>
          <button type="button" className="border-l border-zinc-200 px-4 text-left" onClick={() => onSaveStock(String(product.quantityOnHand))}>
            <p className="text-[22px] font-semibold tabular-nums tracking-[-0.03em] text-zinc-950">{count(product.quantityOnHand)}</p>
            <p className="mt-1 text-[12px] text-zinc-500">Stock</p>
          </button>
          <div className="border-l border-zinc-200 pl-4">
            <p className="text-[22px] font-semibold tabular-nums tracking-[-0.03em] text-zinc-950">{count(product.quantityReserved)}</p>
            <p className="mt-1 text-[12px] text-zinc-500">Reservado</p>
          </div>
        </div>
      ) : null}
      <div className="px-6">
        <UnderlineTabs tab={tab} onTabChange={onTabChange} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        {tab !== 'overview' ? (
          <Quiet>{TABS.find((item) => item.value === tab)?.label}.</Quiet>
        ) : product ? (
          <div className="space-y-6">
            <p className="text-[15px] leading-7 text-zinc-700">{product.description || 'Sin descripción'}</p>
            <p className="text-[13px] leading-6 text-zinc-500">
              {product.commissionAmount == null ? 'Sin comisión' : `Comisión ${money(product.commissionAmount)} soles`}
              {' · '}
              {product.profitOwner || 'Sin beneficiario'}
              {' · '}
              {day(product.updatedAt)}
            </p>
          </div>
        ) : null}
      </div>
    </>
  );
}

function Seccion({
  product,
  tab,
  onTabChange,
  onAdjust,
  onAssociate,
  onPublish,
}: PrototypeProductDrawerProps) {
  return (
    <>
      <Actions onAdjust={onAdjust} onAssociate={onAssociate} onPublish={onPublish} />
      <SheetHeader className="space-y-4 px-6 pb-2 pt-11 pr-24">
        <label className="block">
          <span className="sr-only">Sección</span>
          <span className="relative block">
            <select
              value={tab}
              onChange={(event) => onTabChange(event.target.value as DrawerTab)}
              className="h-9 w-full appearance-none border-0 bg-transparent pr-8 text-[13px] font-medium text-zinc-500 outline-none"
            >
              {TABS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 top-2.5 size-4 text-zinc-400" />
          </span>
        </label>
        <SheetTitle className="text-[22px] font-semibold leading-7 tracking-[-0.03em] text-zinc-950">
          {product?.name || 'Producto'}
        </SheetTitle>
        <SheetDescription className="sr-only">Resumen del producto</SheetDescription>
        <p><Sku sku={product?.mainSku} /></p>
      </SheetHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        {tab !== 'overview' ? (
          <Quiet>{TABS.find((item) => item.value === tab)?.label}.</Quiet>
        ) : product ? (
          <div>
            <p className="text-[16px] leading-7 text-zinc-800">{product.description || 'Sin descripción'}</p>
            <dl className="mt-8 space-y-4">
              <div>
                <dt className="text-[12px] text-zinc-400">Stock</dt>
                <dd className="mt-0.5 text-[15px] tabular-nums text-zinc-950">
                  {count(product.quantityOnHand)} unidades
                  <span className="text-zinc-500"> · {count(product.quantityReserved)} reservadas</span>
                </dd>
              </div>
              <div>
                <dt className="text-[12px] text-zinc-400">Precio</dt>
                <dd className="mt-0.5 text-[18px] font-semibold tabular-nums tracking-[-0.03em] text-zinc-950">
                  {money(product.referencePrice) ? `${money(product.referencePrice)} soles` : 'Sin precio'}
                </dd>
              </div>
              <div>
                <dt className="text-[12px] text-zinc-400">Comisión</dt>
                <dd className="mt-0.5 text-[15px] text-zinc-950">
                  {product.commissionAmount == null ? 'Sin comisión' : `${money(product.commissionAmount)} soles`}
                </dd>
              </div>
              <div>
                <dt className="text-[12px] text-zinc-400">Beneficiario</dt>
                <dd className="mt-0.5 text-[15px] text-zinc-950">{product.profitOwner || 'Sin beneficiario'}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-zinc-400">Actualizado</dt>
                <dd className="mt-0.5 text-[15px] text-zinc-950">{day(product.updatedAt)}</dd>
              </div>
            </dl>
          </div>
        ) : null}
      </div>
    </>
  );
}

function DosColumnas({
  product,
  tab,
  onTabChange,
  onAdjust,
  onAssociate,
  onPublish,
}: PrototypeProductDrawerProps) {
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <Actions onAdjust={onAdjust} onAssociate={onAssociate} onPublish={onPublish} />
      <nav className="flex w-[10.5rem] shrink-0 flex-col gap-0.5 border-r border-zinc-200/80 px-3 pt-11 pb-6">
        {TABS.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => onTabChange(item.value)}
            className={cn(
              'h-8 rounded-md px-2.5 text-left text-[13px]',
              tab === item.value ? 'bg-zinc-100 font-medium text-zinc-950' : 'text-zinc-500 hover:text-zinc-800',
            )}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto px-7 py-11 pr-24">
        <SheetHeader className="mb-8 space-y-2 p-0">
          <SheetTitle className="text-[22px] font-semibold leading-7 tracking-[-0.03em] text-zinc-950">
            {product?.name || 'Producto'}
          </SheetTitle>
          <SheetDescription className="sr-only">Resumen del producto</SheetDescription>
          <p className="flex items-center gap-2">
            <Sku sku={product?.mainSku} />
            <Status value={product?.status} />
          </p>
        </SheetHeader>
        {tab !== 'overview' ? (
          <Quiet>{TABS.find((item) => item.value === tab)?.label}.</Quiet>
        ) : product ? (
          <div className="max-w-sm space-y-6">
            <div>
              <p className="text-[12px] text-zinc-400">Stock</p>
              <p className="mt-1 text-[17px] font-medium tabular-nums text-zinc-950">{count(product.quantityOnHand)} unidades</p>
              <p className="mt-0.5 text-[13px] text-zinc-500">{count(product.quantityReserved)} reservadas</p>
            </div>
            <p className="text-[22px] font-semibold tabular-nums tracking-[-0.03em] text-zinc-950">
              {money(product.referencePrice) ? `${money(product.referencePrice)} soles` : 'Sin precio'}
            </p>
            <dl className="space-y-3 text-[14px]">
              <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3">
                <dt className="text-zinc-400">Comisión</dt>
                <dd>{product.commissionAmount == null ? 'Sin comisión' : `${money(product.commissionAmount)} soles`}</dd>
              </div>
              <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3">
                <dt className="text-zinc-400">Beneficiario</dt>
                <dd>{product.profitOwner || 'Sin beneficiario'}</dd>
              </div>
              <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3">
                <dt className="text-zinc-400">Actualizado</dt>
                <dd>{day(product.updatedAt)}</dd>
              </div>
            </dl>
            <p className="text-[15px] leading-7 text-zinc-700">{product.description || 'Sin descripción'}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function FichaAlta({
  product,
  tab,
  onTabChange,
  onAdjust,
  onAssociate,
  onPublish,
}: PrototypeProductDrawerProps) {
  return (
    <>
      <Actions onAdjust={onAdjust} onAssociate={onAssociate} onPublish={onPublish} />
      <div className="px-6 pt-11 pr-24">
        <UnderlineTabs tab={tab} onTabChange={onTabChange} />
      </div>
      <SheetHeader className="space-y-3 px-6 pb-5 pt-6">
        {product?.imageUrl ? (
          <img src={product.imageUrl} alt="" className="size-[52px] rounded-lg object-cover" />
        ) : null}
        <SheetTitle className="text-[22px] font-semibold leading-7 tracking-[-0.03em] text-zinc-950">
          {product?.name || 'Producto'}
        </SheetTitle>
        <SheetDescription className="sr-only">Resumen del producto</SheetDescription>
        <p><Sku sku={product?.mainSku} /></p>
        {tab === 'overview' && product ? (
          <div className="space-y-1 pt-1">
            <p className="text-[22px] font-semibold tabular-nums tracking-[-0.03em] text-zinc-950">
              {money(product.referencePrice) ? `${money(product.referencePrice)} soles` : 'Sin precio'}
            </p>
            <p className="text-[13px] tabular-nums text-zinc-500">
              {count(product.quantityOnHand)} en almacén · {count(product.quantityReserved)} reservadas
            </p>
          </div>
        ) : null}
      </SheetHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
        {tab !== 'overview' ? (
          <Quiet>{TABS.find((item) => item.value === tab)?.label}.</Quiet>
        ) : product ? (
          <div className="space-y-4 border-t border-zinc-200/90 pt-5">
            <p className="text-[15px] leading-7 text-zinc-700">{product.description || 'Sin descripción'}</p>
            <p className="text-[13px] leading-6 text-zinc-500">
              {product.commissionAmount == null ? 'Sin comisión' : `Comisión ${money(product.commissionAmount)} soles`}
              {' · '}
              {product.profitOwner || 'Sin beneficiario'}
              {' · '}
              {day(product.updatedAt)}
            </p>
          </div>
        ) : null}
      </div>
    </>
  );
}
