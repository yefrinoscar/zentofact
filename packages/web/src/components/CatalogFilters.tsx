import { useState, type ReactNode } from 'react';
import { Boxes, Layers3, ListFilter, PackageCheck, Search, Store, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export type CatalogStatusFilter = 'active' | 'inactive' | 'archived' | 'all';
export type InventoryStatusFilter = 'all' | 'inStock' | 'lowStock' | 'outOfStock';
export type PublicationStatusFilter = 'all' | 'published' | 'unpublished';
export type SellerCoverageFilter = 'all' | 'none' | 'single' | 'multiple';
export type CatalogSort =
  | 'updated_desc'
  | 'name_asc'
  | 'name_desc'
  | 'inventory_asc'
  | 'inventory_desc'
  | 'sellers_asc'
  | 'sellers_desc';

export const CATALOG_SORT_REQUESTS: Record<CatalogSort, { sortBy: string; sortDir: 'asc' | 'desc' }> = {
  updated_desc: { sortBy: 'updatedAt', sortDir: 'desc' },
  name_asc: { sortBy: 'name', sortDir: 'asc' },
  name_desc: { sortBy: 'name', sortDir: 'desc' },
  inventory_asc: { sortBy: 'available', sortDir: 'asc' },
  inventory_desc: { sortBy: 'available', sortDir: 'desc' },
  sellers_asc: { sortBy: 'sellers', sortDir: 'asc' },
  sellers_desc: { sortBy: 'sellers', sortDir: 'desc' },
};

type CompanyOption = { id: number; name: string };

const STATUS_LABELS: Record<CatalogStatusFilter, string> = {
  active: 'Activo',
  inactive: 'Inactivo',
  archived: 'Archivado',
  all: 'Todos',
};

const INVENTORY_LABELS: Record<InventoryStatusFilter, string> = {
  all: 'Todos',
  inStock: 'En stock',
  lowStock: 'Stock bajo',
  outOfStock: 'Sin stock',
};

const PUBLICATION_LABELS: Record<PublicationStatusFilter, string> = {
  all: 'Todos',
  published: 'Visible',
  unpublished: 'No visible',
};

const SELLER_COUNT_LABELS: Record<SellerCoverageFilter, string> = {
  all: 'Todos',
  none: '0',
  single: '1',
  multiple: '2 o más',
};

const SORT_OPTIONS: Array<{ value: CatalogSort; label: string }> = [
  { value: 'updated_desc', label: 'Actualización reciente' },
  { value: 'name_asc', label: 'Nombre: A–Z' },
  { value: 'name_desc', label: 'Nombre: Z–A' },
  { value: 'inventory_asc', label: 'Stock interno: menor primero' },
  { value: 'inventory_desc', label: 'Stock interno: mayor primero' },
  { value: 'sellers_desc', label: 'Más sellers primero' },
  { value: 'sellers_asc', label: 'Menos sellers primero' },
];

const MOBILE_FACET_POSITION = 'max-sm:data-[side=right]:-translate-x-[17.75rem]';

export function catalogSortLabel(sort: CatalogSort) {
  return SORT_OPTIONS.find((option) => option.value === sort)?.label || SORT_OPTIONS[0].label;
}

function normalizedSearch(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();
}

export function CatalogFilters({
  searchControl,
  actions,
  status,
  inventoryStatus,
  publicationStatus,
  sellerCoverage,
  companyIds,
  companies,
  sort,
  onStatusChange,
  onInventoryStatusChange,
  onPublicationStatusChange,
  onSellerCoverageChange,
  onCompanyIdsChange,
  onSortChange,
  onClearFilters,
}: {
  searchControl: ReactNode;
  actions: ReactNode;
  status: CatalogStatusFilter;
  inventoryStatus: InventoryStatusFilter;
  publicationStatus: PublicationStatusFilter;
  sellerCoverage: SellerCoverageFilter;
  companyIds: number[];
  companies: CompanyOption[];
  sort: CatalogSort;
  onStatusChange: (value: CatalogStatusFilter) => void;
  onInventoryStatusChange: (value: InventoryStatusFilter) => void;
  onPublicationStatusChange: (value: PublicationStatusFilter) => void;
  onSellerCoverageChange: (value: SellerCoverageFilter) => void;
  onCompanyIdsChange: (value: number[]) => void;
  onSortChange: (value: CatalogSort) => void;
  onClearFilters: () => void;
}) {
  const [sellerSearch, setSellerSearch] = useState('');
  const selectedCompanies = companies.filter((company) => companyIds.includes(company.id));
  const sellerNeedle = normalizedSearch(sellerSearch);
  const filteredCompanies = sellerNeedle
    ? companies.filter((company) => normalizedSearch(company.name).includes(sellerNeedle))
    : companies;
  const activeFilterCount = Number(status !== 'all')
    + Number(inventoryStatus !== 'all')
    + Number(publicationStatus !== 'all')
    + Number(sellerCoverage !== 'all')
    + Number(companyIds.length > 0);
  const sellerSummary = selectedCompanies.length === 0
    ? 'Todos'
    : selectedCompanies.length <= 2
      ? selectedCompanies.map((company) => company.name).join(', ')
      : `${selectedCompanies.length} seleccionados`;
  const publicationScope = selectedCompanies.length > 0
    ? `en ${selectedCompanies.length === 1 ? selectedCompanies[0].name : 'los sellers elegidos'}`
    : 'en cualquier seller y canal';

  return (
    <div className="space-y-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="w-full min-w-0 sm:w-[20rem] lg:w-[22rem]">{searchControl}</div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" className="h-11 flex-1 sm:h-9 sm:flex-none" aria-label="Filtrar catálogo">
                <ListFilter data-icon="inline-start" />
                Filtros
                {activeFilterCount > 0 && (
                  <span className="ml-0.5 grid min-w-5 place-items-center rounded-md bg-muted px-1 text-xs tabular-nums text-foreground">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[calc(100vw-2rem)] rounded-xl sm:w-[22rem]">
              <DropdownMenuLabel className="px-2 py-2 font-medium text-foreground">Filtrar catálogo</DropdownMenuLabel>
              <DropdownMenuSeparator />

              <DropdownMenuSub>
                <FacetTrigger icon={<PackageCheck />} label="Estado del producto" value={STATUS_LABELS[status]} />
                <DropdownMenuSubContent className={`w-72 rounded-xl ${MOBILE_FACET_POSITION}`}>
                  <DropdownMenuLabel className="px-2 py-2 leading-4">Ciclo de vida del producto dentro de ZentoFact.</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={status} onValueChange={(value) => onStatusChange(value as CatalogStatusFilter)}>
                    <RadioOption value="all" label="Todos los estados" />
                    <RadioOption value="active" label="Activo" description="Disponible para la operación del catálogo." />
                    <RadioOption value="inactive" label="Inactivo" description="Conservado, pero fuera de la operación." />
                    <RadioOption value="archived" label="Archivado" description="Retirado del catálogo." />
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuSub>
                <FacetTrigger icon={<Boxes />} label="Inventario" value={INVENTORY_LABELS[inventoryStatus]} />
                <DropdownMenuSubContent className={`w-72 rounded-xl ${MOBILE_FACET_POSITION}`}>
                  <DropdownMenuLabel className="px-2 py-2 leading-4">Usa el stock disponible en almacén y el punto de reposición.</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={inventoryStatus} onValueChange={(value) => onInventoryStatusChange(value as InventoryStatusFilter)}>
                    <RadioOption value="all" label="Todo el inventario" />
                    <RadioOption value="inStock" label="En stock" description="Disponible por encima del punto de reposición." />
                    <RadioOption value="lowStock" label="Stock bajo" description="Disponible, pero en o debajo del punto de reposición." />
                    <RadioOption value="outOfStock" label="Sin stock" description="Sin unidades disponibles en almacén." />
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuSub>
                <FacetTrigger icon={<Store />} label="Publicación" value={PUBLICATION_LABELS[publicationStatus]} />
                <DropdownMenuSubContent className={`w-72 rounded-xl ${MOBILE_FACET_POSITION}`}>
                  <DropdownMenuLabel className="px-2 py-2 leading-4">No es el estado del producto: mide la visibilidad {publicationScope}.</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={publicationStatus} onValueChange={(value) => onPublicationStatusChange(value as PublicationStatusFilter)}>
                    <RadioOption value="all" label="Todas" />
                    <RadioOption value="published" label="Al menos una visible" description={`Tiene una publicación visible ${publicationScope}.`} />
                    <RadioOption value="unpublished" label="Ninguna visible" description={`No tiene publicaciones visibles ${publicationScope}.`} />
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuSub>
                <FacetTrigger icon={<Store />} label="Seller" value={sellerSummary} />
                <DropdownMenuSubContent className={`max-h-[var(--radix-dropdown-menu-content-available-height)] w-72 overflow-hidden rounded-xl ${MOBILE_FACET_POSITION}`}>
                  <DropdownMenuLabel className="px-2 py-2 leading-4">Muestra productos asociados a cualquiera de los sellers elegidos.</DropdownMenuLabel>
                  <div className="px-2 pb-2" onKeyDown={(event) => event.stopPropagation()}>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={sellerSearch}
                        onChange={(event) => setSellerSearch(event.target.value)}
                        placeholder="Buscar seller"
                        aria-label="Buscar seller"
                        className="h-10 pl-8 sm:h-9"
                      />
                    </div>
                  </div>
                  <DropdownMenuSeparator />
                  <div className="max-h-64 overflow-y-auto p-1">
                    {companies.length === 0 ? (
                      <DropdownMenuItem disabled>No hay sellers disponibles</DropdownMenuItem>
                    ) : filteredCompanies.length === 0 ? (
                      <DropdownMenuItem disabled>No hay coincidencias</DropdownMenuItem>
                    ) : filteredCompanies.map((company) => (
                      <DropdownMenuCheckboxItem
                        key={company.id}
                        checked={companyIds.includes(company.id)}
                        className="min-h-11 sm:min-h-9"
                        onSelect={(event) => event.preventDefault()}
                        onCheckedChange={(checked) => {
                          onCompanyIdsChange(checked
                            ? [...companyIds, company.id]
                            : companyIds.filter((id) => id !== company.id));
                        }}
                      >
                        {company.name}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </div>
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuSub>
                <FacetTrigger icon={<Layers3 />} label="Cantidad de sellers" value={SELLER_COUNT_LABELS[sellerCoverage]} />
                <DropdownMenuSubContent className={`w-64 rounded-xl ${MOBILE_FACET_POSITION}`}>
                  <DropdownMenuLabel className="px-2 py-2 leading-4">Filtra por cuántos sellers tienen asociado el producto.</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={sellerCoverage} onValueChange={(value) => onSellerCoverageChange(value as SellerCoverageFilter)}>
                    <RadioOption value="all" label="Cualquier cantidad" />
                    <RadioOption value="none" label="0 sellers" />
                    <RadioOption value="single" label="1 seller" />
                    <RadioOption value="multiple" label="2 o más sellers" />
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              {activeFilterCount > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onClearFilters}>
                    <X /> Limpiar filtros
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <Select value={sort} onValueChange={(value) => onSortChange(value as CatalogSort)}>
            <SelectTrigger className="h-11 min-w-0 flex-1 sm:h-9 sm:w-[14.5rem] sm:flex-none" aria-label="Ordenar catálogo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
            </SelectContent>
          </Select>

          <div className="flex w-full min-w-0 items-center justify-end gap-2 sm:ml-auto sm:w-auto sm:flex-none">{actions}</div>
        </div>

      {activeFilterCount > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Filtros aplicados">
          {status !== 'all' && <AppliedFilter label="Estado del producto" value={STATUS_LABELS[status]} onRemove={() => onStatusChange('all')} />}
          {inventoryStatus !== 'all' && <AppliedFilter label="Inventario" value={INVENTORY_LABELS[inventoryStatus]} onRemove={() => onInventoryStatusChange('all')} />}
          {publicationStatus !== 'all' && <AppliedFilter label="Publicación" value={PUBLICATION_LABELS[publicationStatus]} onRemove={() => onPublicationStatusChange('all')} />}
          {companyIds.length > 0 && <AppliedFilter label="Seller" operator="es cualquiera de" value={sellerSummary} onRemove={() => onCompanyIdsChange([])} />}
          {sellerCoverage !== 'all' && <AppliedFilter label="Cantidad de sellers" value={SELLER_COUNT_LABELS[sellerCoverage]} onRemove={() => onSellerCoverageChange('all')} />}
          <Button type="button" variant="ghost" size="sm" onClick={onClearFilters} className="h-9 self-center px-3 text-sm text-muted-foreground">
            Limpiar todo
          </Button>
        </div>
      )}
    </div>
  );
}

function FacetTrigger({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <DropdownMenuSubTrigger className="grid min-h-11 grid-cols-[1.25rem_minmax(0,1fr)_5rem_1rem] gap-x-2 text-sm sm:min-h-10 sm:grid-cols-[1.25rem_minmax(0,1fr)_7rem_1rem] [&>svg:last-child]:ml-0">
      <span className="grid place-items-center [&>svg]:size-4">{icon}</span>
      <span className="min-w-0 truncate">{label}</span>
      <span className="min-w-0 truncate text-right text-sm text-muted-foreground">{value}</span>
    </DropdownMenuSubTrigger>
  );
}

function RadioOption({ value, label, description }: { value: string; label: string; description?: string }) {
  return (
    <DropdownMenuRadioItem value={value} className="min-h-11 items-start py-2 sm:min-h-10">
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        {description && <span className="mt-0.5 block whitespace-normal text-xs leading-4 text-muted-foreground">{description}</span>}
      </span>
    </DropdownMenuRadioItem>
  );
}

function AppliedFilter({
  label,
  operator = 'es',
  value,
  onRemove,
}: {
  label: string;
  operator?: string;
  value: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex h-9 max-w-full items-stretch overflow-hidden rounded-md border border-border bg-background text-sm leading-none">
      <span className="flex min-w-0 items-center px-2.5 font-medium text-foreground">{label}</span>
      <span className="flex items-center border-l border-border px-2 text-muted-foreground">{operator}</span>
      <span className="flex max-w-52 items-center truncate border-l border-border px-2.5 font-medium text-foreground">{value}</span>
      <button
        type="button"
        onClick={onRemove}
        className="relative grid h-full w-9 shrink-0 place-items-center border-l border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        aria-label={`Quitar filtro ${label}: ${value}`}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}
