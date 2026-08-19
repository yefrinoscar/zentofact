import { useRef, type ReactNode } from 'react';
import { flexRender, type Table as TanstackTable } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '../lib/cn';
import { TablePanel, TablePanelFooter } from './ui/table';
import { Skeleton } from './ui/skeleton';

const ROW_HEIGHT = 48;

export function OrdersVirtualTable<TData>({
  table,
  loading = false,
  fetching = false,
  empty,
  footer,
  onRowClick,
  stickyLeftId = 'order',
  stickyRightId = 'actions',
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
    estimateSize: () => ROW_HEIGHT,
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

  return (
    <TablePanel aria-label={ariaLabel} aria-busy={loading || fetching}>
      {loading ? (
        <OrdersTableSkeleton columnCount={columns.length || 8} />
      ) : rows.length === 0 ? empty : (
        <div ref={parentRef} className="h-[min(70vh,36rem)] overflow-auto" aria-busy={fetching}>
          <div style={{ width: tableWidth, minWidth: '100%' }}>
            <div className="sticky top-0 z-20 flex border-b border-border bg-muted" role="row">
              {headerGroup?.headers.map((header) => (
                <div
                  key={header.id}
                  role="columnheader"
                  style={{ width: header.getSize(), minWidth: header.getSize() }}
                  className={cn(
                    'flex h-10 shrink-0 items-center px-3 text-xs font-medium text-muted-foreground',
                    edgeClass(header.column.id, true),
                    header.column.id === 'total' && 'justify-end',
                    header.column.id === 'actions' && 'justify-center px-1',
                  )}
                >
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </div>
              ))}
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
                    {row.getVisibleCells().map((cell) => (
                      <div
                        key={cell.id}
                        role="cell"
                        style={{ width: cell.column.getSize(), minWidth: cell.column.getSize() }}
                        className={cn(
                          'flex shrink-0 items-center px-3 py-2 text-sm',
                          edgeClass(cell.column.id, false),
                          cell.column.id === 'total' && 'justify-end',
                          cell.column.id === 'actions' && 'justify-center px-1',
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {!loading && footer ? <TablePanelFooter>{footer}</TablePanelFooter> : null}
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
