import { useRef, type ReactNode } from 'react';
import { flexRender, type Table as TanstackTable } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '../lib/cn';
import { TablePanel, TablePanelFooter } from './ui/table';
import { Skeleton } from './ui/skeleton';

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    headerClassName?: string;
    cellClassName?: string;
    align?: 'start' | 'end' | 'center';
  }
}

const ROW_HEIGHT = 48;

type VirtualColumnMeta = {
  headerClassName?: string;
  cellClassName?: string;
  align?: 'start' | 'end' | 'center';
};

function columnMeta(column: { columnDef: { meta?: unknown } }): VirtualColumnMeta {
  return (column.columnDef.meta || {}) as VirtualColumnMeta;
}

export function OrdersVirtualTable<TData>({
  table,
  loading = false,
  fetching = false,
  empty,
  footer,
  onRowClick,
  stickyLeftId = 'order',
  stickyRightId = 'actions',
  rowHeight = ROW_HEIGHT,
  compact = false,
  scrollClassName = 'h-[min(70vh,36rem)]',
  'aria-label': ariaLabel,
}: {
  table: TanstackTable<TData>;
  loading?: boolean;
  fetching?: boolean;
  empty: ReactNode;
  footer?: ReactNode;
  onRowClick?: (row: TData) => void;
  stickyLeftId?: string;
  stickyRightId?: string;
  rowHeight?: number;
  compact?: boolean;
  scrollClassName?: string;
  'aria-label'?: string;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rows = table.getRowModel().rows;
  const headerGroup = table.getHeaderGroups()[0];
  const columns = table.getVisibleLeafColumns();
  const tableWidth = columns.reduce((sum, column) => sum + column.getSize(), 0);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 16,
  });
  const virtualRows = virtualizer.getVirtualItems();

  const edgeClass = (id: string, head: boolean) => {
    if (id === stickyLeftId) {
      return cn(
        'sticky left-0 border-r border-border',
        head ? 'z-30 bg-muted' : 'z-10 bg-card group-hover:bg-muted/80',
      );
    }
    if (id === stickyRightId) {
      return cn(
        'sticky right-0 border-l border-border',
        head ? 'z-30 bg-muted' : 'z-10 bg-card group-hover:bg-muted/80',
      );
    }
    return '';
  };

  const alignClass = (align?: VirtualColumnMeta['align'], id?: string) => {
    if (align === 'end' || id === 'total') return 'justify-end';
    if (align === 'center' || id === 'actions') return 'justify-center';
    return '';
  };

  return (
    <TablePanel aria-label={ariaLabel} aria-busy={loading || fetching}>
      {loading ? (
        <OrdersTableSkeleton columnCount={columns.length || 8} />
      ) : rows.length === 0 ? empty : (
        <div ref={parentRef} className={cn('overflow-auto', scrollClassName)} aria-busy={fetching}>
          <div style={{ width: tableWidth, minWidth: '100%' }}>
            <div className="sticky top-0 z-20 flex border-b border-border bg-muted" role="row">
              {headerGroup?.headers.map((header) => {
                const meta = columnMeta(header.column);
                return (
                <div
                  key={header.id}
                  role="columnheader"
                  style={{ width: header.getSize(), minWidth: header.getSize() }}
                  className={cn(
                    'flex shrink-0 font-medium text-muted-foreground',
                    compact
                      ? 'h-auto min-h-10 items-center px-2.5 py-1 text-[11px] leading-tight'
                      : 'h-10 items-center px-3 text-xs',
                    edgeClass(header.column.id, true),
                    alignClass(meta.align, header.column.id),
                    header.column.id === 'actions' && 'px-1',
                    meta.headerClassName,
                  )}
                >
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </div>
                );
              })}
            </div>
            <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
              {virtualRows.map((virtualRow) => {
                const row = rows[virtualRow.index];
                return (
                  <div
                    key={row.id}
                    role="row"
                    data-index={virtualRow.index}
                    className={cn(
                      'group absolute left-0 flex border-b border-border/70 hover:bg-muted/30',
                      onRowClick && 'cursor-pointer',
                    )}
                    style={{
                      top: 0,
                      width: tableWidth,
                      height: virtualRow.size,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    tabIndex={onRowClick ? 0 : undefined}
                    onClick={onRowClick ? (event) => {
                      if ((event.target as HTMLElement).closest('button, a, input, [role="menuitem"]')) return;
                      onRowClick(row.original);
                    } : undefined}
                    onKeyDown={onRowClick ? (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onRowClick(row.original);
                      }
                    } : undefined}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const meta = columnMeta(cell.column);
                      return (
                      <div
                        key={cell.id}
                        role="cell"
                        style={{ width: cell.column.getSize(), minWidth: cell.column.getSize() }}
                        className={cn(
                          'flex shrink-0 items-center text-sm',
                          compact ? 'px-2.5 py-0.5' : 'px-3 py-2',
                          edgeClass(cell.column.id, false),
                          alignClass(meta.align, cell.column.id),
                          cell.column.id === 'actions' && 'px-1',
                          meta.cellClassName,
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {!loading && footer ? <TablePanelFooter className={compact ? 'px-2.5 py-2' : undefined}>{footer}</TablePanelFooter> : null}
    </TablePanel>
  );
}

function OrdersTableSkeleton({ columnCount }: { columnCount: number }) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[720px]">
        <div className="flex border-b border-border bg-muted">
          {Array.from({ length: columnCount }, (_, index) => (
            <div key={index} className="flex h-10 items-center px-3">
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
        {Array.from({ length: 10 }, (_, row) => (
          <div key={row} className="flex border-b border-border/70">
            {Array.from({ length: columnCount }, (_, column) => (
              <div key={column} className="flex h-12 items-center px-3">
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
