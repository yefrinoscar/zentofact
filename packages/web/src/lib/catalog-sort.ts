export type CatalogSortColumn = 'price' | 'stock' | 'pace';

const COLUMN_SORT = {
  price: { asc: 'price_asc', desc: 'price_desc' },
  stock: { asc: 'inventory_asc', desc: 'inventory_desc' },
  pace: { asc: 'pace_asc', desc: 'pace_desc' },
} as const;

const SORT_STATE = {
  price_asc: { column: 'price', dir: 'asc' },
  price_desc: { column: 'price', dir: 'desc' },
  inventory_asc: { column: 'stock', dir: 'asc' },
  inventory_desc: { column: 'stock', dir: 'desc' },
  pace_asc: { column: 'pace', dir: 'asc' },
  pace_desc: { column: 'pace', dir: 'desc' },
} as const;

export type CatalogColumnSort = typeof COLUMN_SORT[CatalogSortColumn]['asc'] | typeof COLUMN_SORT[CatalogSortColumn]['desc'];

export function catalogColumnSortState(sort: string): { column: CatalogSortColumn; dir: 'asc' | 'desc' } | null {
  return Object.prototype.hasOwnProperty.call(SORT_STATE, sort)
    ? SORT_STATE[sort as CatalogColumnSort]
    : null;
}

export function nextCatalogColumnSort(sort: string, column: CatalogSortColumn): CatalogColumnSort {
  const current = catalogColumnSortState(sort);
  if (current?.column === column) {
    return current.dir === 'desc' ? COLUMN_SORT[column].asc : COLUMN_SORT[column].desc;
  }
  return COLUMN_SORT[column].desc;
}

export function catalogColumnSortLabel(column: CatalogSortColumn, dir: 'asc' | 'desc') {
  if (column === 'price') return dir === 'desc' ? 'mayor primero' : 'menor primero';
  if (column === 'stock') return dir === 'desc' ? 'más unidades primero' : 'menos unidades primero';
  return dir === 'desc' ? 'más venta primero' : 'menos venta primero';
}

export function catalogColumnSortAria(column: CatalogSortColumn, sort: string) {
  const names = { price: 'Precio', stock: 'Stock', pace: 'Ritmo' };
  const current = catalogColumnSortState(sort);
  const active = current?.column === column;
  const next = nextCatalogColumnSort(sort, column);
  const nextState = catalogColumnSortState(next);
  const nextLabel = nextState ? catalogColumnSortLabel(nextState.column, nextState.dir) : '';
  if (!active) return `Ordenar por ${names[column]}, ${catalogColumnSortLabel(column, 'desc')}`;
  return `${names[column]}, ${catalogColumnSortLabel(column, current.dir)}. Clic para ${nextLabel}`;
}
