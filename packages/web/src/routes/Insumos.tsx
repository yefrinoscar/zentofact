import { useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Minus, PackageOpen, Plus } from 'lucide-react';
import api from '../lib/api';
import { cn } from '../lib/cn';
import {
  capErrorMessage,
  formatInsumoActor,
  formatInsumoChange,
  formatInsumoPurchaseCopy,
  formatInsumoQuantity,
  formatInsumoWhen,
  nextQuantity,
  suggestInsumoPurchases,
  type InsumoPurchase,
} from '../lib/insumos-log';
import { InsumoIcon, hasInsumoPhoto, type InsumoIconKey } from '../components/insumo-icons';
import { Button } from '../components/ui/button';
import { DataTablePagination } from '../components/ui/data-table';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TablePanel,
  TablePanelHeader,
  TableRow,
} from '../components/ui/table';

type Insumo = {
  id: number;
  code: string;
  name: string;
  unit: string;
  iconKey: InsumoIconKey | string;
  quantityOnHand: number;
  quantityCap?: number | null;
  packSize?: number;
  supplierCode?: string | null;
  reorderPoint: number | null;
  status: string;
  lowStock: boolean;
  updatedAt?: string | null;
  purchase?: InsumoPurchase;
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

type InsumoAlertsResponse = {
  alertEmails?: string[];
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
        purchase: item.purchase
          ? suggestInsumoPurchases({
            consumedRecent: item.purchase.consumed,
            quantityOnHand: next,
            packSize: item.purchase.packSize || item.packSize,
            unit: item.unit,
          })
          : item.purchase,
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
  const [alertDraft, setAlertDraft] = useState<string | null>(null);
  const [alertSaved, setAlertSaved] = useState(false);

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

  const alertsQuery = useQuery({
    queryKey: ['insumos', 'alerts'],
    queryFn: () => api.getInsumoAlertEmails(),
    staleTime: 60_000,
  });
  const serverAlertEmails = ((alertsQuery.data as InsumoAlertsResponse | undefined)?.alertEmails || []).join('\n');
  const alertEmailsDraft = alertDraft ?? serverAlertEmails;

  const saveAlerts = useMutation({
    mutationFn: (emails: string) => api.setInsumoAlertEmails(emails),
    onSuccess: (data) => {
      const emails = (data as InsumoAlertsResponse)?.alertEmails || [];
      setAlertDraft(emails.join('\n'));
      setAlertSaved(true);
      queryClient.setQueryData(['insumos', 'alerts'], { alertEmails: emails });
    },
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

  return (
    <div className="space-y-6">
      {visibleError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{visibleError}</div>
      ) : null}

      {listQuery.isPending && !payload ? (
        <section className="divide-y divide-border md:grid md:grid-cols-3 md:gap-6 md:divide-y-0" aria-label="Cargando insumos">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="flex items-center gap-3 py-3 md:flex-col md:items-center md:py-0">
              <Skeleton className="size-16 shrink-0 rounded-xl md:aspect-square md:size-auto md:w-full md:max-w-48 md:rounded-2xl" />
              <div className="min-w-0 flex-1 md:w-full md:max-w-48">
                <Skeleton className="h-4 w-24 md:mx-auto" />
                <Skeleton className="mt-3 h-8 w-full" />
              </div>
            </div>
          ))}
        </section>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-14 text-center">
          <PackageOpen className="size-8 text-muted-foreground/50" />
          <p className="text-sm font-medium">Sin insumos</p>
        </div>
      ) : (
        <section className="divide-y divide-border md:grid md:grid-cols-3 md:gap-6 md:divide-y-0" aria-label="Inventario de insumos">
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

      <section className="border-t border-border pt-4" aria-label="Avisos de insumos">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium">Avisos</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Correo al llegar al mínimo.</p>
          </div>
          <form
            className="grid w-full gap-2 sm:max-w-80"
            onSubmit={(event) => {
              event.preventDefault();
              if (saveAlerts.isPending) return;
              setAlertSaved(false);
              saveAlerts.mutate(alertEmailsDraft);
            }}
          >
            <textarea
              id="insumo-alert-emails"
              aria-label="Correos de aviso"
              value={alertEmailsDraft}
              rows={3}
              placeholder="compras@empresa.pe"
              disabled={alertsQuery.isPending || saveAlerts.isPending}
              onChange={(event) => {
                setAlertDraft(event.target.value);
                setAlertSaved(false);
              }}
              className="min-h-[72px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
            />
            <p className="text-xs text-muted-foreground">Vacío: avisa a quien ve Insumos.</p>
            {saveAlerts.error ? (
              <p className="text-sm text-red-600">
                {saveAlerts.error instanceof Error ? saveAlerts.error.message : 'No se pudieron guardar los correos.'}
              </p>
            ) : null}
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" disabled={alertsQuery.isPending || saveAlerts.isPending}>
                Guardar correos
              </Button>
              {alertSaved ? <span className="text-xs font-medium text-emerald-700">Guardado</span> : null}
            </div>
          </form>
        </div>
      </section>

      <TablePanel aria-label="Movimientos de insumos" aria-busy={movementsQuery.isPending || movementsQuery.isFetching}>
        <TablePanelHeader>
          <p className="text-sm font-medium">Movimientos</p>
          <p className="mt-1 text-xs text-muted-foreground">Quién cambió cada cantidad y cuándo.</p>
        </TablePanelHeader>
        {movementsQuery.isPending && !movementsPayload ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="flex items-center justify-between gap-3 px-4 py-3">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        ) : movements.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">Todavía no hay cambios.</p>
        ) : (
          <>
            <ul className="divide-y divide-border md:hidden">
              {movements.map((movement) => (
                <li key={movement.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{movement.insumoName}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatInsumoActor(movement.actorName)} · {formatInsumoWhen(movement.createdAt)}
                    </p>
                  </div>
                  <p className="shrink-0 text-right text-sm tabular-nums">
                    {formatInsumoChange(movement.quantityDelta, movement.quantityAfter)}
                  </p>
                </li>
              ))}
            </ul>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Insumo</TableHead>
                    <TableHead>Cambio</TableHead>
                    <TableHead>Quién</TableHead>
                    <TableHead>Hora</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements.map((movement) => (
                    <TableRow key={movement.id}>
                      <TableCell className="font-medium whitespace-normal">{movement.insumoName}</TableCell>
                      <TableCell className="tabular-nums">{formatInsumoChange(movement.quantityDelta, movement.quantityAfter)}</TableCell>
                      <TableCell className="whitespace-normal">{formatInsumoActor(movement.actorName)}</TableCell>
                      <TableCell className="text-muted-foreground">{formatInsumoWhen(movement.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
        {movementsTotal > MOVEMENT_PAGE ? (
          <DataTablePagination
            pageIndex={pageIndex}
            pageSize={MOVEMENT_PAGE}
            totalCount={movementsTotal}
            fetching={movementsQuery.isFetching}
            onPageChange={setPageIndex}
          />
        ) : null}
      </TablePanel>

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

  const stepper = (
    <div className="flex shrink-0 items-center gap-1 md:gap-2">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-11 md:size-9"
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
          'h-11 w-14 rounded-md border border-transparent bg-transparent text-center text-3xl font-semibold tabular-nums outline-none md:w-20 md:text-4xl',
          'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30',
          tone.text,
        )}
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-11 md:size-9"
        aria-label={`Sumar 1 ${insumo.name}`}
        disabled={busy || atCap}
        onClick={() => onChange({ delta: 1 })}
      >
        <Plus />
      </Button>
    </div>
  );

  return (
    <article className="flex items-center gap-3 py-3 md:flex-col md:items-center md:py-0 md:text-center">
      <span className={cn(
        'size-16 shrink-0 overflow-hidden rounded-xl md:aspect-square md:size-auto md:w-full md:max-w-48 md:rounded-2xl',
        photo ? '' : 'bg-muted',
      )}>
        {photo ? (
          <InsumoIcon
            iconKey={insumo.iconKey}
            className="size-full object-cover"
          />
        ) : (
          <span className="grid size-full place-items-center">
            <InsumoIcon iconKey={insumo.iconKey} className="size-8 md:size-16" />
          </span>
        )}
      </span>
      <div className="min-w-0 flex-1 md:flex md:w-full md:flex-col md:items-center">
        <div className="flex items-center justify-between gap-2 md:flex-col md:justify-center">
          <div className="min-w-0 md:mt-3">
            <h2 className="truncate text-sm font-medium text-foreground">{insumo.name}</h2>
            {insumo.supplierCode ? (
              <p className="mt-0.5 text-[11px] text-muted-foreground">{insumo.supplierCode}</p>
            ) : null}
            <p className={cn('mt-0.5 text-xs font-semibold md:hidden', tone.text)}>
              {tone.label}
              <span className="ml-1 font-normal text-muted-foreground">{unitLabel(insumo.unit)}</span>
              {Number.isFinite(cap) ? (
                <span className="ml-1 font-normal text-muted-foreground">· máx. {cap}</span>
              ) : null}
            </p>
          </div>
          {stepper}
        </div>
        <div className="mt-2 flex w-full gap-[3px] md:mt-3 md:max-w-48" aria-hidden="true">
          {Array.from({ length: METER_TICKS }, (_, tick) => (
            <span
              key={tick}
              className={cn('h-2 flex-1 rounded-sm md:h-4', tick < filled ? tone.bar : tone.track)}
            />
          ))}
        </div>
        <p className={cn('mt-2 hidden text-sm font-semibold md:block', tone.text)}>
          {tone.label}
          <span className="ml-1 font-normal text-muted-foreground">{unitLabel(insumo.unit)}</span>
        </p>
        {Number.isFinite(cap) ? (
          <p className="mt-1 hidden text-xs text-muted-foreground md:block">máx. {cap}</p>
        ) : null}
        <InsumoPurchaseHint purchase={insumo.purchase} />
      </div>
    </article>
  );
}

function InsumoPurchaseHint({
  purchase,
}: {
  purchase?: InsumoPurchase;
}) {
  const copy = formatInsumoPurchaseCopy(purchase, purchase?.purchaseUnit || 'rollos');
  if (copy.empty) {
    return (
      <p className="mt-3 text-xs text-muted-foreground md:text-center">{copy.empty}</p>
    );
  }
  const items = [copy.week, copy.month].filter((item): item is NonNullable<typeof item> => item != null);
  const pack = Number(purchase?.packSize);
  return (
    <div className="mt-3 w-full md:max-w-56">
      <p className="text-[11px] font-medium text-muted-foreground md:text-center">
        Comprar
        {pack > 1 ? ` · caja x${pack}` : ''}
      </p>
      <dl className="mt-1 grid grid-cols-2 gap-3" aria-label="Cuánto comprar">
        {items.map((item) => (
          <div key={item.label} className="min-w-0 md:text-center">
            <dd className={cn(
              'text-base font-semibold tabular-nums',
              item.needed ? 'text-foreground' : 'text-muted-foreground',
            )}>
              {item.value}
            </dd>
            <dt className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{item.label}</dt>
          </div>
        ))}
      </dl>
    </div>
  );
}
