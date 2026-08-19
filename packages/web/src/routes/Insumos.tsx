import { useMemo, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ColumnDef, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { Minus, PackageOpen, Plus } from 'lucide-react';
import api from '../lib/api';
import { cn } from '../lib/cn';
import {
  capErrorMessage,
  formatInsumoActor,
  formatInsumoChange,
  formatInsumoQuantity,
  formatInsumoWhen,
  nextQuantity,
} from '../lib/insumos-log';
import { InsumoIcon, hasInsumoPhoto, type InsumoIconKey } from '../components/insumo-icons';
import { Button } from '../components/ui/button';
import { DataTable, DataTablePagination } from '../components/ui/data-table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Skeleton } from '../components/ui/skeleton';

type Insumo = {
  id: number;
  code: string;
  name: string;
  unit: string;
  iconKey: InsumoIconKey | string;
  quantityOnHand: number;
  quantityCap?: number | null;
  reorderPoint: number | null;
  status: string;
  lowStock: boolean;
  updatedAt?: string | null;
};

type InsumosResponse = {
  items: Insumo[];
  totalCount: number;
  lowStockCount: number;
};

type InsumoMovement = {
  id: number;
  insumoId: number;
  insumoName: string;
  insumoCode: string;
  quantityDelta: number;
  quantityAfter: number;
  actorName?: string | null;
  createdAt: string;
};

type InsumoMovementsResponse = {
  items: InsumoMovement[];
  totalCount: number;
};

type PendingChange = {
  id: number;
  name: string;
  next: number;
  delta?: number;
  absoluteTarget?: number;
};

const UNITS = [
  { value: 'unidades', label: 'Unidades' },
  { value: 'rollos', label: 'Rollos' },
  { value: 'resmas', label: 'Resmas' },
  { value: 'kg', label: 'Kg' },
  { value: 'cajas', label: 'Cajas' },
];

const STOCK_TONE = {
  ok: {
    label: 'Hay',
    bar: 'bg-green-500',
    text: 'text-green-600 dark:text-green-400',
    track: 'bg-green-500/20',
  },
  half: {
    label: 'A la mitad',
    bar: 'bg-orange-500',
    text: 'text-orange-600 dark:text-orange-400',
    track: 'bg-orange-500/20',
  },
  low: {
    label: 'Se acaba',
    bar: 'bg-red-500',
    text: 'text-red-600 dark:text-red-400',
    track: 'bg-red-500/20',
  },
} as const;

const METER_TICKS = 20;
const DISPLAY_ORDER = ['cinta-fill', 'fill-pequeno', 'cinta-scotch'];
const MOVEMENT_PAGE = 20;

function unitLabel(unit: string) {
  return UNITS.find((item) => item.value === unit)?.label.toLowerCase() || unit;
}

function stockBands(insumo: Insumo) {
  const quantity = Math.max(0, Number(insumo.quantityOnHand) || 0);
  const reorder = Number(insumo.reorderPoint);
  const min = Number.isFinite(reorder) && reorder > 0 ? reorder : 2;
  const cap = Number(insumo.quantityCap);
  const full = Number.isFinite(cap) && cap > 0 ? cap : min * 4;
  return { quantity, min, full, fill: Math.max(0, Math.min(1, quantity / full)) };
}

function stockLevel(insumo: Insumo): keyof typeof STOCK_TONE {
  const { quantity, min, full } = stockBands(insumo);
  if (quantity <= min) return 'low';
  if (quantity < full * 0.7) return 'half';
  return 'ok';
}

function patchQuantity(payload: InsumosResponse | undefined, id: number, quantityOnHand: number): InsumosResponse | undefined {
  if (!payload) return payload;
  return {
    ...payload,
    items: payload.items.map((item) => {
      if (item.id !== id) return item;
      const next = Math.max(0, quantityOnHand);
      const reorder = Number(item.reorderPoint);
      return {
        ...item,
        quantityOnHand: next,
        lowStock: reorder > 0 ? next <= reorder : next <= 0,
      };
    }),
  };
}

export default function Insumos() {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [pin, setPin] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [formError, setFormError] = useState('');

  const listQuery = useQuery({
    queryKey: ['insumos'],
    queryFn: () => api.listInsumos({ sortBy: 'name', sortDir: 'asc', limit: 100 }),
    staleTime: 15_000,
  });

  const movementsQuery = useQuery({
    queryKey: ['insumos', 'movements', pageIndex],
    queryFn: () => api.listInsumoMovements({
      limit: MOVEMENT_PAGE,
      offset: pageIndex * MOVEMENT_PAGE,
    }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });

  const bump = useMutation({
    mutationFn: ({ id, delta, absoluteTarget, pin: changePin }: PendingChange & { pin: string }) => (
      absoluteTarget == null
        ? api.adjustInsumo(id, { delta, pin: changePin })
        : api.adjustInsumo(id, { absoluteTarget, pin: changePin })
    ),
    onMutate: async ({ id, next }) => {
      await queryClient.cancelQueries({ queryKey: ['insumos'] });
      const previous = queryClient.getQueryData<InsumosResponse>(['insumos']);
      queryClient.setQueryData(['insumos'], patchQuantity(previous, id, next));
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(['insumos'], context.previous);
    },
    onSuccess: () => {
      setPending(null);
      setPin('');
      setFormError('');
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['insumos'] });
    },
  });

  const requestChange = (insumo: Insumo, change: { delta?: number; absoluteTarget?: number }) => {
    const next = nextQuantity(insumo.quantityOnHand, change);
    if (!Number.isFinite(next) || next < 0) return;
    if (next === Number(insumo.quantityOnHand)) return;
    const cap = Number(insumo.quantityCap);
    if (Number.isFinite(cap) && next > cap) {
      setFormError(capErrorMessage(insumo.name, cap));
      return;
    }
    setFormError('');
    setPin('');
    setPending({
      id: insumo.id,
      name: insumo.name,
      next,
      ...change,
    });
  };

  const payload = listQuery.data as InsumosResponse | undefined;
  const items = [...(payload?.items || [])].sort((left, right) => (
    DISPLAY_ORDER.indexOf(left.code) - DISPLAY_ORDER.indexOf(right.code)
  ));
  const movementsPayload = movementsQuery.data as InsumoMovementsResponse | undefined;
  const movements = movementsPayload?.items || [];
  const movementsTotal = movementsPayload?.totalCount || 0;
  const queryError = listQuery.error instanceof Error
    ? listQuery.error.message
    : listQuery.error
      ? 'No se pudieron cargar los insumos.'
      : '';
  const movementsError = movementsQuery.error instanceof Error
    ? movementsQuery.error.message
    : movementsQuery.error
      ? 'No se pudieron cargar los movimientos.'
      : '';
  const bumpError = bump.error instanceof Error ? bump.error.message : bump.error ? 'No se pudo actualizar.' : '';
  const visibleError = formError || queryError || movementsError || (!pending && bumpError ? bumpError : '');

  const columns = useMemo<ColumnDef<InsumoMovement>[]>(() => [
    {
      accessorKey: 'insumoName',
      header: 'Insumo',
      cell: ({ row }) => <span className="font-medium">{row.original.insumoName}</span>,
    },
    {
      accessorKey: 'quantityDelta',
      header: 'Cambio',
      cell: ({ row }) => formatInsumoChange(row.original.quantityDelta, row.original.quantityAfter),
    },
    {
      accessorKey: 'actorName',
      header: 'Quién',
      cell: ({ row }) => formatInsumoActor(row.original.actorName),
    },
    {
      accessorKey: 'createdAt',
      header: 'Hora',
      cell: ({ row }) => (
        <span className="text-muted-foreground">{formatInsumoWhen(row.original.createdAt)}</span>
      ),
    },
  ], []);

  const table = useReactTable({
    data: movements,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => String(row.id),
    manualPagination: true,
    pageCount: Math.max(1, Math.ceil(movementsTotal / MOVEMENT_PAGE)),
  });

  return (
    <div className="space-y-6">
      {visibleError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{visibleError}</div>
      ) : null}

      {listQuery.isPending && !payload ? (
        <section className="grid grid-cols-3 gap-6" aria-label="Cargando insumos">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="flex flex-col items-center">
              <Skeleton className="aspect-square w-full max-w-48 rounded-2xl" />
              <Skeleton className="mt-3 h-4 w-24" />
              <Skeleton className="mt-3 h-8 w-28" />
            </div>
          ))}
        </section>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-14 text-center">
          <PackageOpen className="size-8 text-muted-foreground/50" />
          <p className="text-sm font-medium">Sin insumos</p>
        </div>
      ) : (
        <section className="grid grid-cols-3 gap-6" aria-label="Inventario de insumos">
          {items.map((insumo) => (
            <InsumoMeter
              key={insumo.id}
              insumo={insumo}
              busy={bump.isPending && bump.variables?.id === insumo.id}
              onChange={(change) => requestChange(insumo, change)}
            />
          ))}
        </section>
      )}

      <DataTable
        table={table}
        aria-label="Movimientos de insumos"
        loading={movementsQuery.isPending && !movementsPayload}
        fetching={movementsQuery.isFetching}
        skeleton="plain"
        header={(
          <div>
            <p className="text-sm font-medium">Movimientos</p>
            <p className="mt-1 text-xs text-muted-foreground">Quién cambió cada cantidad y cuándo.</p>
          </div>
        )}
        empty={<p className="px-5 py-10 text-center text-sm text-muted-foreground">Todavía no hay cambios.</p>}
        footer={movementsTotal > MOVEMENT_PAGE ? (
          <DataTablePagination
            pageIndex={pageIndex}
            pageSize={MOVEMENT_PAGE}
            totalCount={movementsTotal}
            fetching={movementsQuery.isFetching}
            onPageChange={setPageIndex}
          />
        ) : null}
      />

      <Dialog
        open={pending != null}
        onOpenChange={(open) => {
          if (!open && !bump.isPending) {
            setPending(null);
            setPin('');
            bump.reset();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar cambio</DialogTitle>
            <DialogDescription>
              {pending ? `${pending.name} pasa a ${formatInsumoQuantity(pending.next)}.` : ''}
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!pending || bump.isPending) return;
              bump.mutate({ ...pending, pin });
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="insumo-change-pin">PIN</Label>
              <Input
                id="insumo-change-pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                value={pin}
                onChange={(event) => setPin(event.target.value)}
                aria-invalid={Boolean(bumpError)}
              />
              {bumpError ? <p className="text-sm text-red-600">{bumpError}</p> : null}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={bump.isPending}
                onClick={() => {
                  setPending(null);
                  setPin('');
                  bump.reset();
                }}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={bump.isPending || !pin.trim()}>
                Guardar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InsumoMeter({
  insumo,
  busy,
  onChange,
}: {
  insumo: Insumo;
  busy: boolean;
  onChange: (change: { delta?: number; absoluteTarget?: number }) => void;
}) {
  const level = stockLevel(insumo);
  const tone = STOCK_TONE[level];
  const filled = Math.round(stockBands(insumo).fill * METER_TICKS);
  const photo = hasInsumoPhoto(insumo.iconKey);
  const empty = insumo.quantityOnHand <= 0;
  const cap = Number(insumo.quantityCap);
  const atCap = Number.isFinite(cap) && insumo.quantityOnHand >= cap;
  const current = String(insumo.quantityOnHand);
  const [draft, setDraft] = useState(current);
  const [focused, setFocused] = useState(false);
  const skipCommit = useRef(false);
  const shown = focused ? draft : current;

  const commit = () => {
    setFocused(false);
    const next = Number(draft);
    if (!Number.isFinite(next) || next < 0) {
      setDraft(current);
      return;
    }
    if (next === Number(insumo.quantityOnHand)) return;
    onChange({ absoluteTarget: next });
    setDraft(current);
  };

  return (
    <div className="flex flex-col items-center text-center">
      <span className={cn(
        'aspect-square w-full max-w-48 overflow-hidden rounded-2xl',
        photo ? '' : 'bg-muted',
      )}>
        {photo ? (
          <InsumoIcon
            iconKey={insumo.iconKey}
            className="size-full object-cover"
          />
        ) : (
          <span className="grid size-full place-items-center">
            <InsumoIcon iconKey={insumo.iconKey} className="size-16" />
          </span>
        )}
      </span>
      <h2 className="mt-3 text-sm font-medium text-foreground">{insumo.name}</h2>
      <div className="mt-2 flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={`Restar 1 ${insumo.name}`}
          disabled={busy || empty}
          onClick={() => onChange({ delta: -1 })}
        >
          <Minus />
        </Button>
        <input
          aria-label={`Cantidad de ${insumo.name}`}
          inputMode="decimal"
          disabled={busy}
          value={shown}
          onFocus={() => {
            setDraft(current);
            setFocused(true);
          }}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (skipCommit.current) {
              skipCommit.current = false;
              setFocused(false);
              setDraft(current);
              return;
            }
            commit();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            }
            if (event.key === 'Escape') {
              skipCommit.current = true;
              setDraft(current);
              event.currentTarget.blur();
            }
          }}
          className={cn(
            'h-11 w-20 rounded-md border border-transparent bg-transparent text-center text-4xl font-semibold tabular-nums outline-none',
            'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30',
            tone.text,
          )}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={`Sumar 1 ${insumo.name}`}
          disabled={busy || atCap}
          onClick={() => onChange({ delta: 1 })}
        >
          <Plus />
        </Button>
      </div>
      <div className="mt-3 flex w-full max-w-48 gap-[3px]" aria-hidden="true">
        {Array.from({ length: METER_TICKS }, (_, tick) => (
          <span
            key={tick}
            className={cn('h-4 flex-1 rounded-sm', tick < filled ? tone.bar : tone.track)}
          />
        ))}
      </div>
      <p className={cn('mt-2 text-sm font-semibold', tone.text)}>
        {tone.label}
        <span className="ml-1 font-normal text-muted-foreground">{unitLabel(insumo.unit)}</span>
      </p>
      {Number.isFinite(cap) ? (
        <p className="mt-1 text-xs text-muted-foreground">máx. {cap}</p>
      ) : null}
    </div>
  );
}
