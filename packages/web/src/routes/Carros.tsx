import { useDeferredValue, useState, type ReactNode } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import {
  Car as CarIcon,
  CircleDot,
  Disc,
  Droplet,
  Flame,
  Fuel,
  Gauge,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Receipt,
  Search,
  Thermometer,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import api from '../lib/api';
import suzukiGrandVitaraPhoto from '../assets/cars/suzuki-grand-vitara.png';
import { cn } from '../lib/utils';
import { limaTodayKey } from '../lib/registrar-venta';
import {
  applyExpenseFormChange,
  CAR_EXPENSE_CATEGORIES,
  CAR_EXPENSES_PAGE_SIZE,
  carCategoryLabel,
  carCategoryTone,
  carFormFromCar,
  carPayloadFromForm,
  carPlate,
  carSpecs,
  carSubtitle,
  carTitle,
  categoryChipTotals,
  categoryHasNextService,
  categoryIsMileageReading,
  defaultCarId,
  EMPTY_CAR_FORM,
  emptyExpenseForm,
  expenseFormFromExpense,
  expensePayloadFromForm,
  formatCarDate,
  formatCarMileage,
  formatCarMoney,
  formatExpenseAmount,
  oilChangeHint,
  oilChangeProgress,
  oilChangeStatus,
  type Car,
  type CarExpense,
  type CarExpenseCategory,
  type CarExpenseForm,
  type CarForm,
  type CarsResponse,
} from '../lib/carros-presentation';
import { ToolbarSelect } from '../components/ToolbarSelect';
import { Button } from '../components/ui/button';
import { DataTablePagination, DataTableSkeleton } from '../components/ui/data-table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
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

type ExpenseDialogState = { mode: 'create' } | { mode: 'edit'; expense: CarExpense } | null;
type CarDialogState = { mode: 'create' } | { mode: 'edit'; car: Car } | null;

const EMPTY_CARS: Car[] = [];

const CATEGORY_OPTIONS = [
  { value: 'all', label: 'Todas las categorías' },
  ...CAR_EXPENSE_CATEGORIES.map(({ value, label }) => ({ value, label })),
];

const CATEGORY_ICON: Record<CarExpenseCategory, LucideIcon> = {
  mileage: Gauge,
  fuel: Fuel,
  natural_gas: Flame,
  tires: CircleDot,
  coolant: Thermometer,
  oil_change: Droplet,
  brakes: Disc,
  other: Receipt,
};

function categoryIcon(category: string) {
  return CATEGORY_ICON[category as CarExpenseCategory] ?? Receipt;
}

// Columnas secundarias se ocultan en móvil para no forzar scroll horizontal.
const COLUMN_CLASS: Record<string, string> = {
  occurredOn: 'w-16 pr-1 whitespace-nowrap md:w-28 md:pr-4',
  category: 'hidden md:table-cell md:w-40',
  title: '',
  mileage: 'hidden sm:table-cell sm:w-28 text-right',
  amount: 'w-20 px-1 text-right whitespace-nowrap md:w-28 md:px-4',
  actions: 'w-10 px-1 text-right md:w-12 md:px-2',
};

const TEXTAREA_CLASS = 'min-h-[56px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20';

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  return error ? fallback : '';
}

export default function Carros() {
  const queryClient = useQueryClient();
  const [selectedCarId, setSelectedCarId] = useState<number | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [category, setCategory] = useState('all');
  const [pageIndex, setPageIndex] = useState(0);
  const [expenseDialog, setExpenseDialog] = useState<ExpenseDialogState>(null);
  const [expenseForm, setExpenseForm] = useState<CarExpenseForm>(() => emptyExpenseForm());
  const [expenseFormError, setExpenseFormError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<CarExpense | null>(null);
  const [carDialog, setCarDialog] = useState<CarDialogState>(null);
  const [carForm, setCarForm] = useState<CarForm>(EMPTY_CAR_FORM);
  const [carFormError, setCarFormError] = useState('');
  const search = useDeferredValue(searchInput.trim());

  const carsQuery = useQuery({
    queryKey: ['cars', 'all'],
    queryFn: () => api.listCars({ status: 'all' }),
    staleTime: 30_000,
  });
  const cars = (carsQuery.data as CarsResponse | undefined)?.cars ?? EMPTY_CARS;
  const carId = cars.some((car) => car.id === selectedCarId) ? selectedCarId : defaultCarId(cars);
  const car = cars.find((item) => item.id === carId) || null;

  const expenseFilter = {
    category: category === 'all' ? undefined : category,
    q: search || undefined,
    page: pageIndex + 1,
    pageSize: CAR_EXPENSES_PAGE_SIZE,
  };
  const expensesQuery = useQuery({
    queryKey: ['car-expenses', carId, expenseFilter],
    queryFn: () => api.listCarExpenses(carId as number, expenseFilter),
    enabled: carId != null,
    placeholderData: (previous, previousQuery) => (
      previousQuery?.queryKey[1] === carId ? keepPreviousData(previous) : undefined
    ),
    staleTime: 15_000,
  });
  const expensesPayload = expensesQuery.data;
  const expenses = expensesPayload?.rows ?? [];
  const expensesTotal = expensesPayload?.total ?? 0;
  const filteredAmount = expensesPayload?.totals?.amount ?? 0;
  const filtersActive = category !== 'all' || Boolean(search);

  // Los chips necesitan los totales sin el filtro de categoría. Con "Todos" y
  // la primera página es la misma clave que la tabla, así que no duplica pedidos.
  const chipFilter = { category: undefined, q: search || undefined, page: 1, pageSize: CAR_EXPENSES_PAGE_SIZE };
  const chipsQuery = useQuery({
    queryKey: ['car-expenses', carId, chipFilter],
    queryFn: () => api.listCarExpenses(carId as number, chipFilter),
    enabled: carId != null,
    placeholderData: (previous, previousQuery) => (
      previousQuery?.queryKey[1] === carId ? keepPreviousData(previous) : undefined
    ),
    staleTime: 15_000,
  });
  const chips = categoryChipTotals(chipsQuery.data?.totals?.byCategory);
  const chipsTotal = chipsQuery.data?.totals?.amount ?? 0;

  const selectCategory = (value: string) => {
    setCategory(value);
    setPageIndex(0);
  };

  const invalidateCar = (id: number | null) => {
    void queryClient.invalidateQueries({ queryKey: ['cars'] });
    if (id != null) void queryClient.invalidateQueries({ queryKey: ['car-expenses', id] });
  };

  const saveExpense = useMutation({
    mutationFn: async ({ dialog, form }: { dialog: NonNullable<ExpenseDialogState>; form: CarExpenseForm }) => {
      if (carId == null) throw new Error('Elige un vehículo.');
      const parsed = expensePayloadFromForm(form);
      if (!parsed.payload) throw new Error(parsed.error);
      return dialog.mode === 'edit'
        ? api.updateCarExpense(carId, dialog.expense.id, parsed.payload)
        : api.createCarExpense(carId, parsed.payload);
    },
    onSuccess: () => {
      setExpenseDialog(null);
      setExpenseFormError('');
      invalidateCar(carId);
    },
  });

  const removeExpense = useMutation({
    mutationFn: (expense: CarExpense) => api.deleteCarExpense(expense.carId, expense.id),
    onSuccess: (_data, expense) => {
      setDeleteTarget(null);
      invalidateCar(expense.carId);
    },
  });

  const saveCar = useMutation({
    mutationFn: async ({ dialog, form }: { dialog: NonNullable<CarDialogState>; form: CarForm }) => {
      const parsed = carPayloadFromForm(form);
      if (!parsed.payload) throw new Error(parsed.error);
      return dialog.mode === 'edit'
        ? api.updateCar(dialog.car.id, parsed.payload)
        : api.createCar(parsed.payload);
    },
    onSuccess: (saved) => {
      setCarDialog(null);
      setCarFormError('');
      if (saved?.id) setSelectedCarId(saved.id);
      invalidateCar(saved?.id ?? carId);
    },
  });

  const openCreateExpense = () => {
    saveExpense.reset();
    setExpenseFormError('');
    setExpenseForm(emptyExpenseForm(limaTodayKey()));
    setExpenseDialog({ mode: 'create' });
  };

  const openEditExpense = (expense: CarExpense) => {
    saveExpense.reset();
    setExpenseFormError('');
    setExpenseForm(expenseFormFromExpense(expense));
    setExpenseDialog({ mode: 'edit', expense });
  };

  const openCarDialog = (state: NonNullable<CarDialogState>) => {
    saveCar.reset();
    setCarFormError('');
    setCarForm(state.mode === 'edit' ? carFormFromCar(state.car) : EMPTY_CAR_FORM);
    setCarDialog(state);
  };

  const setCarField = (patch: Partial<CarForm>) => setCarForm((form) => ({ ...form, ...patch }));
  const mileageReading = categoryIsMileageReading(expenseForm.category);

  const updateExpenseForm = (patch: Partial<CarExpenseForm>) => {
    setExpenseFormError('');
    setExpenseForm((current) => applyExpenseFormChange(current, patch, car?.oilChangeIntervalKm));
  };

  const columns: ColumnDef<CarExpense>[] = [
    {
      id: 'occurredOn',
      header: 'Fecha',
      cell: ({ row }) => (
        <span className="tabular-nums whitespace-nowrap text-muted-foreground">{formatCarDate(row.original.occurredOn)}</span>
      ),
    },
    {
      id: 'category',
      header: 'Categoría',
      cell: ({ row }) => <CategoryTag category={row.original.category} />,
    },
    {
      id: 'title',
      header: 'Concepto',
      cell: ({ row }) => {
        const expense = row.original;
        const detail = [expense.vendor, expense.nextServiceMileage != null ? `Próximo ${formatCarMileage(expense.nextServiceMileage)}` : null];
        const line = (parts: Array<string | null>) => parts.filter(Boolean).join(' · ');
        const mobile = line([carCategoryLabel(expense.category), expense.mileage != null ? formatCarMileage(expense.mileage) : null, ...detail]);
        const tablet = line([carCategoryLabel(expense.category), ...detail]);
        const desktop = line(detail);
        return (
          <div className="min-w-0">
            <p className="line-clamp-2 font-medium whitespace-normal">{expense.title}</p>
            <p className="mt-0.5 line-clamp-2 text-xs whitespace-normal text-muted-foreground sm:hidden">{mobile}</p>
            <p className="mt-0.5 line-clamp-2 hidden text-xs whitespace-normal text-muted-foreground sm:block md:hidden">{tablet}</p>
            {desktop ? <p className="mt-0.5 line-clamp-2 hidden text-xs whitespace-normal text-muted-foreground md:block">{desktop}</p> : null}
          </div>
        );
      },
    },
    {
      id: 'mileage',
      header: () => <span className="block text-right">Kilometraje</span>,
      cell: ({ row }) => (
        <span className="tabular-nums whitespace-nowrap text-muted-foreground">{formatCarMileage(row.original.mileage)}</span>
      ),
    },
    {
      id: 'amount',
      header: () => <span className="block text-right">Monto</span>,
      cell: ({ row }) => {
        const amount = formatExpenseAmount(row.original);
        return (
          <span className={cn('font-medium tabular-nums whitespace-nowrap', amount === '—' && 'font-normal text-muted-foreground')}>{amount}</span>
        );
      },
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Acciones</span>,
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Acciones de ${row.original.title}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-36">
            <DropdownMenuItem onClick={() => openEditExpense(row.original)}>
              <Pencil /> Editar
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => {
                removeExpense.reset();
                setDeleteTarget(row.original);
              }}
            >
              <Trash2 /> Eliminar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const table = useReactTable({
    data: expenses,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    rowCount: expensesTotal,
    state: { pagination: { pageIndex, pageSize: CAR_EXPENSES_PAGE_SIZE } },
    getRowId: (row) => String(row.id),
  });

  const carsError = errorMessage(carsQuery.error, 'No se pudieron cargar los vehículos.');
  const expensesError = errorMessage(expensesQuery.error, 'No se pudieron cargar los gastos.');
  const firstExpensesLoad = carId != null && expensesQuery.isPending;
  const expenseError = expenseFormError || errorMessage(saveExpense.error, 'No se pudo guardar el gasto.');
  const carError = carFormError || errorMessage(saveCar.error, 'No se pudo guardar el vehículo.');

  if (carsQuery.isPending) {
    return (
      <div className="@container space-y-4" aria-label="Cargando vehículos">
        <div className="rounded-md border border-border bg-card">
          <div className="flex flex-col items-center gap-5 p-5 @2xl:flex-row @2xl:items-start @2xl:gap-6">
            <Skeleton className="h-36 w-52 shrink-0 @4xl:w-60" />
            <div className="w-full space-y-3">
              <Skeleton className="h-7 w-64" />
              <Skeleton className="h-4 w-56" />
              <div className="grid grid-cols-2 gap-3 pt-2 @xl:grid-cols-4">
                {Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-9" />)}
              </div>
            </div>
          </div>
          <Skeleton className="h-16 rounded-none border-t border-border" />
        </div>
        <Skeleton className="h-9 w-full" />
        <TablePanel>
          <DataTableSkeleton columnCount={5} variant="plain" />
        </TablePanel>
      </div>
    );
  }

  return (
    <div className="@container space-y-4">
      {carsError || expensesError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {carsError || expensesError}
        </div>
      ) : null}

      {cars.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-14 text-center">
          <CarIcon className="size-8 text-muted-foreground/50" />
          <p className="text-sm font-medium">Sin vehículos</p>
          <p className="text-sm text-muted-foreground">Registra el vehículo para empezar a anotar sus gastos.</p>
          <Button type="button" size="sm" className="mt-2" onClick={() => openCarDialog({ mode: 'create' })}>
            <Plus />
            Registrar vehículo
          </Button>
        </div>
      ) : (
        <>
          {car ? (
            <section aria-label="Vehículo" className="rounded-md border border-border bg-card text-card-foreground">
              <CarHeader
                car={car}
                selector={cars.length > 1 ? (
                  <ToolbarSelect
                    className="w-full @md:w-52"
                    aria-label="Vehículo"
                    value={String(car.id)}
                    options={cars.map((item) => ({
                      value: String(item.id),
                      label: item.status === 'archived' ? `${carTitle(item)} (archivado)` : carTitle(item),
                    }))}
                    onValueChange={(value) => {
                      setSelectedCarId(Number(value));
                      setCategory('all');
                      setPageIndex(0);
                    }}
                  />
                ) : null}
                onEdit={() => openCarDialog({ mode: 'edit', car })}
              />
              <CarStatStrip car={car} />
            </section>
          ) : null}

          <div className="flex flex-col gap-2 @2xl:flex-row @2xl:items-center">
            <div className="relative w-full @2xl:flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(event) => {
                  setSearchInput(event.target.value);
                  setPageIndex(0);
                }}
                placeholder="Buscar concepto, taller o nota"
                aria-label="Buscar gasto"
                className="pl-8"
                disabled={carId == null}
              />
            </div>
            <div className="flex gap-2">
              <ToolbarSelect
                className="min-w-0 flex-1 @2xl:w-48 @2xl:flex-none"
                aria-label="Categoría"
                value={category}
                options={CATEGORY_OPTIONS}
                onValueChange={selectCategory}
              />
              <Button type="button" className="shrink-0" disabled={carId == null} onClick={openCreateExpense}>
                <Plus />
                Registrar gasto
              </Button>
            </div>
          </div>

          {chips.length > 0 ? (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por categoría">
              <CategoryChip
                label="Todos"
                amount={chipsTotal}
                active={category === 'all'}
                onClick={() => selectCategory('all')}
              />
              {chips.map((chip) => (
                <CategoryChip
                  key={chip.value}
                  category={chip.value}
                  label={chip.label}
                  amount={chip.amount}
                  active={category === chip.value}
                  onClick={() => selectCategory(category === chip.value ? 'all' : chip.value)}
                />
              ))}
            </div>
          ) : null}

          <TablePanel aria-label="Gastos del vehículo" aria-busy={expensesQuery.isFetching}>
            <TablePanelHeader className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
              <p className="text-sm text-muted-foreground">
                {expensesTotal === 1 ? '1 gasto' : `${expensesTotal} gastos`}
                {filtersActive ? ' con estos filtros' : ''}
              </p>
              <p className="inline-flex items-center gap-2 text-sm">
                {expensesQuery.isFetching && !firstExpensesLoad ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : null}
                <span className="text-muted-foreground">Total</span>
                <span className="font-semibold tabular-nums">{formatCarMoney(filteredAmount)}</span>
              </p>
            </TablePanelHeader>
            {firstExpensesLoad ? (
              <DataTableSkeleton columnCount={5} variant="plain" rowCount={5} />
            ) : expenses.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-14 text-center">
                <Receipt className="size-8 text-muted-foreground/50" />
                <p className="text-sm font-medium">{filtersActive ? 'Sin resultados' : 'Sin gastos registrados'}</p>
                <p className="text-sm text-muted-foreground">
                  {filtersActive ? 'Prueba con otra búsqueda o categoría.' : 'Anota el primer cambio de aceite, mantenimiento o gasto.'}
                </p>
                {!filtersActive ? (
                  <Button type="button" size="sm" className="mt-2" onClick={openCreateExpense}>
                    <Plus />
                    Registrar gasto
                  </Button>
                ) : null}
              </div>
            ) : (
              <Table className="table-fixed">
                <TableHeader>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <TableRow key={headerGroup.id} className="hover:bg-transparent">
                      {headerGroup.headers.map((header) => (
                        <TableHead key={header.id} className={cn('px-3 md:px-4', COLUMN_CLASS[header.column.id])}>
                          {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {table.getRowModel().rows.map((row) => (
                    <TableRow key={row.id}>
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id} className={cn('px-3 md:px-4', COLUMN_CLASS[cell.column.id])}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {expensesTotal > CAR_EXPENSES_PAGE_SIZE ? (
              <DataTablePagination
                pageIndex={pageIndex}
                pageSize={CAR_EXPENSES_PAGE_SIZE}
                totalCount={expensesTotal}
                fetching={expensesQuery.isFetching}
                onPageChange={setPageIndex}
              />
            ) : null}
          </TablePanel>
        </>
      )}

      <Dialog
        open={expenseDialog != null}
        onOpenChange={(open) => {
          if (!open && !saveExpense.isPending) setExpenseDialog(null);
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{expenseDialog?.mode === 'edit' ? 'Editar registro' : 'Registrar gasto'}</DialogTitle>
            <DialogDescription>{car ? [carTitle(car), carPlate(car.plate)].filter(Boolean).join(' · ') : ''}</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!expenseDialog || saveExpense.isPending) return;
              const parsed = expensePayloadFromForm(expenseForm);
              if (parsed.error) {
                setExpenseFormError(parsed.error);
                return;
              }
              saveExpense.mutate({ dialog: expenseDialog, form: expenseForm });
            }}
          >
            {expenseError ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{expenseError}</p>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="car-expense-category">Categoría</Label>
                <Select
                  value={expenseForm.category}
                  onValueChange={(value) => updateExpenseForm({ category: value as CarExpenseCategory })}
                >
                  <SelectTrigger id="car-expense-category" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CAR_EXPENSE_CATEGORIES.map((item) => {
                      const Icon = categoryIcon(item.value);
                      return (
                        <SelectItem key={item.value} value={item.value}>
                          <Icon className="text-muted-foreground" />
                          {item.label}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="car-expense-date">Fecha</Label>
                <Input
                  id="car-expense-date"
                  type="date"
                  value={expenseForm.occurredOn}
                  max={limaTodayKey()}
                  onChange={(event) => updateExpenseForm({ occurredOn: event.target.value })}
                  required
                />
              </div>
              {mileageReading ? (
                <div className="grid gap-2 sm:col-span-2">
                  <Label htmlFor="car-expense-mileage">Kilometraje del tablero</Label>
                  <Input
                    id="car-expense-mileage"
                    inputMode="numeric"
                    value={expenseForm.mileage}
                    placeholder={car?.currentMileage != null ? String(car.currentMileage) : 'km'}
                    autoFocus
                    onChange={(event) => updateExpenseForm({ mileage: event.target.value })}
                    required
                  />
                  {car?.currentMileage != null ? (
                    <p className="text-xs text-muted-foreground">Última lectura: {formatCarMileage(car.currentMileage)}.</p>
                  ) : null}
                </div>
              ) : null}
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="car-expense-title">Concepto</Label>
                <Input
                  id="car-expense-title"
                  value={expenseForm.title}
                  placeholder={mileageReading ? 'Lectura de kilometraje' : 'Aceite 5W-30 y filtro'}
                  maxLength={160}
                  onChange={(event) => updateExpenseForm({ title: event.target.value })}
                />
              </div>
              {mileageReading ? null : (
                <>
                  <div className="grid gap-2">
                    <Label htmlFor="car-expense-amount">Monto (S/)</Label>
                    <Input
                      id="car-expense-amount"
                      inputMode="decimal"
                      value={expenseForm.amount}
                      placeholder="0.00"
                      autoFocus
                      onChange={(event) => updateExpenseForm({ amount: event.target.value })}
                      required
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="car-expense-mileage">Kilometraje</Label>
                    <Input
                      id="car-expense-mileage"
                      inputMode="numeric"
                      value={expenseForm.mileage}
                      placeholder={car?.currentMileage != null ? String(car.currentMileage) : 'km'}
                      onChange={(event) => updateExpenseForm({ mileage: event.target.value })}
                    />
                  </div>
                  <div className="grid gap-2 sm:col-span-2">
                    <Label htmlFor="car-expense-vendor">Proveedor o taller</Label>
                    <Input
                      id="car-expense-vendor"
                      value={expenseForm.vendor}
                      maxLength={120}
                      onChange={(event) => updateExpenseForm({ vendor: event.target.value })}
                    />
                  </div>
                </>
              )}
              {categoryHasNextService(expenseForm.category) ? (
                <>
                  <div className="grid gap-2">
                    <Label htmlFor="car-expense-next-km">Próximo cambio (km)</Label>
                    <Input
                      id="car-expense-next-km"
                      inputMode="numeric"
                      value={expenseForm.nextServiceMileage}
                      onChange={(event) => updateExpenseForm({ nextServiceMileage: event.target.value })}
                    />
                    {expenseForm.category === 'oil_change' && car?.oilChangeIntervalKm ? (
                      <p className="text-xs text-muted-foreground">Se propone cada {formatCarMileage(car.oilChangeIntervalKm)}.</p>
                    ) : null}
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="car-expense-next-date">Próximo cambio (fecha)</Label>
                    <Input
                      id="car-expense-next-date"
                      type="date"
                      value={expenseForm.nextServiceDate}
                      min={expenseForm.occurredOn || undefined}
                      onChange={(event) => updateExpenseForm({ nextServiceDate: event.target.value })}
                    />
                  </div>
                </>
              ) : null}
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="car-expense-notes">Notas</Label>
                <textarea
                  id="car-expense-notes"
                  value={expenseForm.notes}
                  rows={mileageReading ? 2 : 3}
                  maxLength={1000}
                  onChange={(event) => updateExpenseForm({ notes: event.target.value })}
                  className={TEXTAREA_CLASS}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={saveExpense.isPending} onClick={() => setExpenseDialog(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saveExpense.isPending}>
                {saveExpense.isPending ? <Loader2 className="animate-spin" /> : null}
                Guardar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open && !removeExpense.isPending) setDeleteTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Eliminar gasto</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? `${deleteTarget.title} · ${formatCarMoney(deleteTarget.amount)} · ${formatCarDate(deleteTarget.occurredOn)}. No se puede deshacer.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {removeExpense.error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {errorMessage(removeExpense.error, 'No se pudo eliminar el gasto.')}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={removeExpense.isPending} onClick={() => setDeleteTarget(null)}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={removeExpense.isPending}
              onClick={() => {
                if (deleteTarget) removeExpense.mutate(deleteTarget);
              }}
            >
              {removeExpense.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={carDialog != null}
        onOpenChange={(open) => {
          if (!open && !saveCar.isPending) setCarDialog(null);
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{carDialog?.mode === 'edit' ? 'Editar vehículo' : 'Registrar vehículo'}</DialogTitle>
            <DialogDescription>Datos de la tarjeta de propiedad (SUNARP) y cada cuántos km toca el cambio de aceite.</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!carDialog || saveCar.isPending) return;
              const parsed = carPayloadFromForm(carForm);
              if (parsed.error) {
                setCarFormError(parsed.error);
                return;
              }
              saveCar.mutate({ dialog: carDialog, form: carForm });
            }}
          >
            {carError ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{carError}</p>
            ) : null}
            <div className="grid gap-5">
              <div className="grid gap-4 sm:grid-cols-3">
                <CarField id="car-name" label="Nombre" value={carForm.name} placeholder="Suzuki Grand Vitara" onChange={(name) => setCarField({ name })} />
                <CarField id="car-brand" label="Marca" value={carForm.brand} placeholder="Suzuki" onChange={(brand) => setCarField({ brand })} />
                <CarField id="car-model" label="Modelo" value={carForm.model} placeholder="Grand Vitara" onChange={(model) => setCarField({ model })} />
              </div>
              <CarFieldGroup title="Identificación">
                <CarField id="car-plate" label="Placa" value={carForm.plate} placeholder="C1Q-038" onChange={(plate) => setCarField({ plate })} />
                <CarField id="car-previous-plate" label="Placa anterior" value={carForm.previousPlate} onChange={(previousPlate) => setCarField({ previousPlate })} />
                <CarField id="car-vin" label="VIN" value={carForm.vin} onChange={(vin) => setCarField({ vin })} />
                <CarField id="car-engine" label="N° de motor" value={carForm.engineNumber} onChange={(engineNumber) => setCarField({ engineNumber })} />
              </CarFieldGroup>
              <CarFieldGroup title="Ficha técnica" columns={3}>
                <CarField id="car-year" label="Año" inputMode="numeric" value={carForm.year} placeholder="2009" onChange={(year) => setCarField({ year })} />
                <CarField id="car-color" label="Color" value={carForm.color} placeholder="Gris" onChange={(color) => setCarField({ color })} />
                <CarField id="car-version" label="Versión" value={carForm.version} placeholder="3 puertas" onChange={(version) => setCarField({ version })} />
                <CarField id="car-fuel" label="Combustible" value={carForm.fuelType} placeholder="Gasolina" onChange={(fuelType) => setCarField({ fuelType })} />
                <CarField id="car-displacement" label="Cilindrada (cc)" value={carForm.displacement} placeholder="2393" onChange={(displacement) => setCarField({ displacement })} />
                <CarField id="car-power" label="Potencia" value={carForm.power} placeholder="122 kW" onChange={(power) => setCarField({ power })} />
                <CarField id="car-drivetrain" label="Tracción" value={carForm.drivetrain} placeholder="4x4" onChange={(drivetrain) => setCarField({ drivetrain })} />
                <CarField id="car-body" label="Carrocería" value={carForm.bodyType} placeholder="SUV" onChange={(bodyType) => setCarField({ bodyType })} />
                <CarField id="car-seats" label="Asientos" inputMode="numeric" value={carForm.seats} placeholder="5" onChange={(seats) => setCarField({ seats })} />
                <CarField id="car-category" label="Categoría" value={carForm.vehicleCategory} placeholder="M1" onChange={(vehicleCategory) => setCarField({ vehicleCategory })} />
              </CarFieldGroup>
              <CarFieldGroup title="Mantenimiento">
                <CarField id="car-mileage" label="Kilometraje actual" inputMode="numeric" value={carForm.currentMileage} onChange={(currentMileage) => setCarField({ currentMileage })} />
                <CarField id="car-oil-interval" label="Cambio de aceite cada (km)" inputMode="numeric" value={carForm.oilChangeIntervalKm} onChange={(oilChangeIntervalKm) => setCarField({ oilChangeIntervalKm })} />
              </CarFieldGroup>
              <div className="grid gap-2">
                <Label htmlFor="car-notes">Notas</Label>
                <textarea
                  id="car-notes"
                  value={carForm.notes}
                  rows={2}
                  maxLength={1000}
                  onChange={(event) => setCarField({ notes: event.target.value })}
                  className={TEXTAREA_CLASS}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={saveCar.isPending} onClick={() => setCarDialog(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saveCar.isPending}>
                {saveCar.isPending ? <Loader2 className="animate-spin" /> : null}
                Guardar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CategoryTag({ category }: { category: string }) {
  const Icon = categoryIcon(category);
  return (
    <span className={cn('inline-flex h-6 items-center gap-1 rounded-md border px-2 text-xs font-medium whitespace-nowrap', carCategoryTone(category))}>
      <Icon className="size-3" aria-hidden />
      {carCategoryLabel(category)}
    </span>
  );
}

function CategoryChip({
  category,
  label,
  amount,
  active,
  onClick,
}: {
  category?: string;
  label: string;
  amount: number;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = category ? categoryIcon(category) : null;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30',
        active
          ? category ? carCategoryTone(category) : 'border-foreground/20 bg-secondary text-secondary-foreground'
          : 'border-border bg-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground',
      )}
    >
      {Icon ? <Icon className="size-3.5" aria-hidden /> : null}
      {label}
      <span className={cn('tabular-nums', active ? 'opacity-80' : 'text-muted-foreground')}>{formatCarMoney(amount)}</span>
    </button>
  );
}

function PlateBadge({ plate }: { plate: string }) {
  return (
    <span
      className="inline-flex shrink-0 flex-col items-center rounded-[5px] border-2 border-neutral-800 bg-white px-2 pt-px pb-0.5 leading-none text-neutral-900 shadow-xs"
      aria-label={`Placa ${plate}`}
    >
      <span className="text-[7px] font-semibold tracking-[0.25em]" aria-hidden>PERÚ</span>
      <span className="font-mono text-sm font-bold tracking-wider" aria-hidden>{plate}</span>
    </span>
  );
}

function CarHeader({ car, selector, onEdit }: { car: Car; selector: ReactNode; onEdit: () => void }) {
  const photo = carPhotoFor(car);
  const plate = carPlate(car.plate);
  const subtitle = carSubtitle(car);
  const specs = carSpecs(car);
  return (
    <div className="flex flex-col items-center gap-4 p-4 @2xl:flex-row @2xl:items-center @2xl:gap-6 @2xl:p-5">
      {photo ? (
        <img src={photo} alt={carTitle(car)} className="h-auto w-52 shrink-0 object-contain @4xl:w-60" width={351} height={249} />
      ) : (
        <span className="grid size-24 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
          <CarIcon className="size-10" />
        </span>
      )}
      <div className="@container/car w-full min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h2 className="text-xl font-semibold tracking-tight">{carTitle(car)}</h2>
              {plate ? <PlateBadge plate={plate} /> : null}
              {car.status === 'archived' ? (
                <span className="inline-flex h-6 items-center rounded-md border border-border bg-muted px-2 text-xs font-medium text-muted-foreground">Archivado</span>
              ) : null}
            </div>
            {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
          </div>
          <div className="flex w-full items-center gap-2 @md/car:w-auto">
            {selector}
            <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={onEdit}>
              <Pencil />
              Editar vehículo
            </Button>
          </div>
        </div>
        {specs.length > 0 ? (
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 @lg/car:grid-cols-3 @2xl/car:grid-cols-4">
            {specs.map((spec) => (
              <div key={spec.key} className="min-w-0">
                <dt className="text-xs whitespace-nowrap text-muted-foreground">{spec.label}</dt>
                <dd className={cn('mt-0.5 text-sm font-medium break-all', spec.mono && 'font-mono tabular-nums tracking-tight')}>{spec.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </div>
  );
}

type Stat = {
  key: string;
  label: string;
  value: string;
  hint?: string;
  tone?: 'soon' | 'overdue';
  progress?: number | null;
  className?: string;
};

function CarStatStrip({ car }: { car: Car }) {
  const summary = car.summary;
  const oil = oilChangeStatus(car.currentMileage, summary?.nextOilChangeMileage);
  const oilTone = oil.tone === 'soon' || oil.tone === 'overdue' ? oil.tone : undefined;
  const lastOil = summary?.lastOilChange;
  const count = summary?.expenseCount ?? 0;
  const stats: Stat[] = [
    { key: 'mileage', label: 'Kilometraje actual', value: formatCarMileage(car.currentMileage) },
    {
      key: 'total',
      label: 'Total gastado',
      value: formatCarMoney(summary?.totalSpent),
      hint: count === 1 ? '1 gasto' : `${count} gastos`,
    },
    { key: 'month', label: 'Gasto del mes', value: formatCarMoney(summary?.monthSpent) },
    {
      key: 'nextOil',
      label: 'Próximo cambio de aceite',
      value: formatCarMileage(summary?.nextOilChangeMileage),
      hint: oilChangeHint(oil) || undefined,
      tone: oilTone,
      progress: oilChangeProgress(car.currentMileage, lastOil?.mileage, summary?.nextOilChangeMileage, car.oilChangeIntervalKm),
      // En móvil ocupa la fila completa para que la barra se lea.
      className: '@max-xl:order-last @max-xl:col-span-2',
    },
    {
      key: 'lastOil',
      label: 'Último cambio de aceite',
      value: lastOil ? formatCarDate(lastOil.occurredOn) : '—',
      hint: lastOil?.mileage != null ? formatCarMileage(lastOil.mileage) : undefined,
    },
  ];
  if (summary?.nextServiceDate) {
    stats.push({ key: 'nextService', label: 'Próximo servicio', value: formatCarDate(summary.nextServiceDate) });
  }

  return (
    <dl
      aria-label="Resumen del vehículo"
      className={cn(
        // Cada celda dibuja su divisor izquierdo; el de la primera columna queda fuera del recorte.
        'grid grid-cols-2 overflow-hidden border-t border-border @xl:grid-cols-3',
        // Una sola fila: columnas al ancho de su contenido y el sobrante se reparte.
        stats.length > 5 ? '@5xl:grid-cols-[repeat(6,auto)]' : '@4xl:grid-cols-[repeat(5,auto)]',
      )}
    >
      {stats.map((stat) => (
        <div key={stat.key} className={cn('-ml-px min-w-0 border-l border-border/70 px-4 py-3 @2xl:px-5', stat.className)}>
          <dt className="text-xs whitespace-nowrap text-muted-foreground">{stat.label}</dt>
          <dd
            className={cn(
              'mt-1 text-base font-semibold tabular-nums whitespace-nowrap',
              stat.tone === 'soon' && 'text-amber-700 dark:text-amber-400',
              stat.tone === 'overdue' && 'text-red-700 dark:text-red-400',
            )}
          >
            {stat.value}
          </dd>
          {stat.progress != null ? (
            <dd className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div
                className={cn(
                  'h-full rounded-full',
                  stat.tone === 'overdue' ? 'bg-red-500' : stat.tone === 'soon' ? 'bg-amber-500' : 'bg-emerald-500',
                )}
                style={{ width: `${Math.round(stat.progress * 100)}%` }}
              />
            </dd>
          ) : null}
          {stat.hint ? (
            <dd
              className={cn(
                'mt-1 text-xs tabular-nums whitespace-nowrap text-muted-foreground',
                stat.tone === 'soon' && 'font-medium text-amber-700 dark:text-amber-400',
                stat.tone === 'overdue' && 'font-medium text-red-700 dark:text-red-400',
              )}
            >
              {stat.hint}
            </dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

function CarFieldGroup({ title, columns = 2, children }: { title: string; columns?: 2 | 3; children: ReactNode }) {
  return (
    <fieldset className="grid gap-3">
      <legend className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</legend>
      <div className={cn('grid gap-4 sm:grid-cols-2', columns === 3 && 'md:grid-cols-3')}>{children}</div>
    </fieldset>
  );
}

// Foto recortada del vehículo real; los demás carros usan el ícono genérico.
function carPhotoFor(car: Pick<Car, 'brand' | 'model'>) {
  const key = `${car.brand || ''} ${car.model || ''}`.toLowerCase();
  if (key.includes('suzuki') && key.includes('grand vitara')) return suzukiGrandVitaraPhoto;
  return null;
}

function CarField({
  id,
  label,
  value,
  onChange,
  placeholder,
  inputMode,
  className,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputMode?: 'numeric' | 'decimal' | 'text';
  className?: string;
}) {
  return (
    <div className={cn('grid gap-2', className)}>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} placeholder={placeholder} inputMode={inputMode} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}
