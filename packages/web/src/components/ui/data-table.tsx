import type { ReactNode } from 'react';
import { flexRender, type Column, type Table as TanstackTable } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TablePanel,
  TablePanelHeader,
  TablePanelFooter,
  TableRow,
} from '@/components/ui/table';

type PaginationEntry = number | 'start-ellipsis' | 'end-ellipsis';

export function DataTableColumnHeader<TData>({
  column,
  title,
  className,
}: {
  column: Column<TData, unknown>;
  title: string;
  className?: string;
}) {
  if (!column.getCanSort()) return <span className={className}>{title}</span>;
  const sorted = column.getIsSorted();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn('-ml-2 h-8 px-2 text-muted-foreground hover:text-foreground', className)}
      onClick={() => column.toggleSorting(sorted === 'asc')}
    >
      {title}
      {sorted === 'asc' ? <ArrowUp /> : sorted === 'desc' ? <ArrowDown /> : <ArrowUpDown className="opacity-50" />}
    </Button>
  );
}

export function paginationEntries(currentPage: number, totalPages: number): PaginationEntry[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  if (currentPage <= 4) return [1, 2, 3, 4, 5, 'end-ellipsis', totalPages];
  if (currentPage >= totalPages - 3) {
    return [1, 'start-ellipsis', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }
  return [1, 'start-ellipsis', currentPage - 1, currentPage, currentPage + 1, 'end-ellipsis', totalPages];
}

export function DataTable<TData>({
  table,
  empty,
  loading = false,
  fetching = false,
  header,
  footer,
  columnClassNames,
  cellClassNames,
  'aria-label': ariaLabel,
}: {
  table: TanstackTable<TData>;
  empty: ReactNode;
  loading?: boolean;
  fetching?: boolean;
  header?: ReactNode;
  footer?: ReactNode;
  columnClassNames?: Record<string, string>;
  cellClassNames?: Record<string, string>;
  'aria-label'?: string;
}) {
  const rows = table.getRowModel().rows;

  return (
    <TablePanel aria-label={ariaLabel} aria-busy={loading || fetching}>
      {header ? <TablePanelHeader>{header}</TablePanelHeader> : null}
      {loading ? (
        <DataTableSkeleton columnCount={table.getAllColumns().length || 4} />
      ) : rows.length === 0 ? empty : (
        <div className="min-w-0" aria-busy={fetching}>
          <Table className="min-w-[720px] table-fixed">
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="hover:bg-transparent">
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id} className={columnClassNames?.[header.column.id]}>
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} className="align-middle">
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className={cellClassNames?.[cell.column.id]}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {!loading && footer}
    </TablePanel>
  );
}

export function DataTableSkeleton({
  columnCount = 4,
  rowCount = 8,
}: {
  columnCount?: number;
  rowCount?: number;
}) {
  return (
    <div className="min-w-0">
      <Table className="min-w-[720px] table-fixed">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {Array.from({ length: columnCount }, (_, index) => (
              <TableHead key={index}>
                <Skeleton className="h-4 w-20" />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rowCount }, (_, row) => (
            <TableRow key={row} className="hover:bg-transparent">
              {Array.from({ length: columnCount }, (_, column) => (
                <TableCell key={column}>
                  {column === 0 ? (
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-14 w-14 shrink-0 rounded-lg" />
                      <div className="min-w-0 flex-1 space-y-2">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Skeleton className="h-5 w-12" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function DataTablePagination({
  pageIndex,
  pageSize,
  totalCount,
  fetching = false,
  onPageChange,
  onPrefetch,
}: {
  pageIndex: number;
  pageSize: number;
  totalCount: number;
  fetching?: boolean;
  onPageChange: (pageIndex: number) => void;
  onPrefetch?: (pageIndex: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentPage = Math.min(pageIndex + 1, totalPages);
  const from = totalCount === 0 ? 0 : pageIndex * pageSize + 1;
  const to = Math.min((pageIndex + 1) * pageSize, totalCount);
  const pages = paginationEntries(currentPage, totalPages);

  return (
    <TablePanelFooter className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <p className="inline-flex items-center gap-2">
        {fetching && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Mostrando {from} a {to} de {totalCount}
      </p>
      {totalPages > 1 && (
        <Pagination className="mx-0 w-auto justify-end">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href="#"
                aria-disabled={currentPage === 1}
                tabIndex={currentPage === 1 ? -1 : undefined}
                className={cn(currentPage === 1 && 'pointer-events-none opacity-50')}
                onMouseEnter={() => currentPage > 1 && onPrefetch?.(currentPage - 2)}
                onClick={(event) => {
                  event.preventDefault();
                  if (currentPage > 1) onPageChange(currentPage - 2);
                }}
              />
            </PaginationItem>
            {pages.map((entry) => (
              <PaginationItem key={entry}>
                {typeof entry === 'number' ? (
                  <PaginationLink
                    href="#"
                    isActive={entry === currentPage}
                    aria-label={`Ir a la página ${entry}`}
                    onMouseEnter={() => onPrefetch?.(entry - 1)}
                    onClick={(event) => {
                      event.preventDefault();
                      onPageChange(entry - 1);
                    }}
                  >
                    {entry}
                  </PaginationLink>
                ) : <PaginationEllipsis />}
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext
                href="#"
                aria-disabled={currentPage === totalPages}
                tabIndex={currentPage === totalPages ? -1 : undefined}
                className={cn(currentPage === totalPages && 'pointer-events-none opacity-50')}
                onMouseEnter={() => currentPage < totalPages && onPrefetch?.(currentPage)}
                onClick={(event) => {
                  event.preventDefault();
                  if (currentPage < totalPages) onPageChange(currentPage);
                }}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </TablePanelFooter>
  );
}
