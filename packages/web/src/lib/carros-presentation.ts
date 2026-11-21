import { formatSaleMoney } from './sale-summary.ts';
import { limaTodayKey } from './registrar-venta.ts';

export type CarExpenseCategory =
  | 'mileage'
  | 'fuel'
  | 'natural_gas'
  | 'tires'
  | 'coolant'
  | 'oil_change'
  | 'brakes'
  | 'other';

export type CarStatus = 'active' | 'archived';

export type CarSummary = {
  totalSpent: number;
  expenseCount: number;
  monthSpent: number;
  lastOilChange: { occurredOn: string; mileage: number | null } | null;
  nextOilChangeMileage: number | null;
  nextServiceDate: string | null;
};

export type Car = {
  id: number;
  name: string;
  brand: string | null;
  model: string | null;
  version: string | null;
  year: number | null;
  plate: string | null;
  color: string | null;
  vin: string | null;
  currentMileage: number | null;
  oilChangeIntervalKm: number | null;
  status: CarStatus | string;
  notes: string | null;
  engineNumber?: string | null;
  fuelType?: string | null;
  displacement?: string | number | null;
  power?: string | number | null;
  drivetrain?: string | null;
  bodyType?: string | null;
  seats?: number | null;
  previousPlate?: string | null;
  vehicleCategory?: string | null;
  createdAt: string;
  updatedAt: string;
  summary: CarSummary;
};

export type CarExpense = {
  id: number;
  carId: number;
  category: CarExpenseCategory | string;
  title: string;
  amount: number;
  occurredOn: string;
  mileage: number | null;
  vendor: string | null;
  nextServiceMileage: number | null;
  nextServiceDate: string | null;
  notes: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CarsResponse = { cars: Car[]; categories: string[] };

export type CarExpensesResponse = {
  rows: CarExpense[];
  total: number;
  page: number;
  pageSize: number;
  totals: { amount: number; byCategory: Record<string, number> };
};

export type CarInput = {
  name: string;
  brand: string | null;
  model: string | null;
  version: string | null;
  year: number | null;
  plate: string | null;
  color: string | null;
  vin: string | null;
  currentMileage: number | null;
  oilChangeIntervalKm: number | null;
  notes: string | null;
  engineNumber: string | null;
  fuelType: string | null;
  displacement: string | null;
  power: string | null;
  drivetrain: string | null;
  bodyType: string | null;
  seats: number | null;
  previousPlate: string | null;
  vehicleCategory: string | null;
  status?: CarStatus;
};

export type CarExpenseInput = {
  category: CarExpenseCategory;
  title: string;
  amount: number;
  occurredOn: string;
  mileage: number | null;
  vendor: string | null;
  nextServiceMileage: number | null;
  nextServiceDate: string | null;
  notes: string | null;
};

export type CarExpenseFilter = {
  category?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  pageSize?: number;
};

export const CAR_EXPENSE_CATEGORIES: Array<{ value: CarExpenseCategory; label: string; tone: string }> = [
  { value: 'mileage', label: 'Kilometraje', tone: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-500/30 dark:bg-slate-500/10 dark:text-slate-300' },
  { value: 'fuel', label: 'Combustible', tone: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300' },
  { value: 'natural_gas', label: 'Gas natural', tone: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300' },
  { value: 'tires', label: 'Llantas', tone: 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300' },
  { value: 'coolant', label: 'Refrigerante', tone: 'border-cyan-200 bg-cyan-50 text-cyan-800 dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:text-cyan-300' },
  { value: 'oil_change', label: 'Aceite', tone: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300' },
  { value: 'brakes', label: 'Frenos', tone: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300' },
  { value: 'other', label: 'Otro', tone: 'border-border bg-muted text-muted-foreground' },
];

/** Categorías que registran cuándo toca el próximo cambio o revisión. */
const SERVICE_CATEGORIES = new Set<string>(['oil_change', 'tires', 'brakes', 'coolant']);
/** Margen en km antes del próximo cambio de aceite para avisar. */
export const OIL_CHANGE_WARNING_KM = 500;
export const CAR_EXPENSES_PAGE_SIZE = 20;
const EMPTY = '—';
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

const integer = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 0 });

export function isCarExpenseCategory(value: unknown): value is CarExpenseCategory {
  return CAR_EXPENSE_CATEGORIES.some((category) => category.value === value);
}

export function carCategoryLabel(category: string | null | undefined) {
  return CAR_EXPENSE_CATEGORIES.find((item) => item.value === category)?.label || 'Otro';
}

export function carCategoryTone(category: string | null | undefined) {
  return CAR_EXPENSE_CATEGORIES.find((item) => item.value === category)?.tone
    || CAR_EXPENSE_CATEGORIES[CAR_EXPENSE_CATEGORIES.length - 1].tone;
}

export function categoryHasNextService(category: string | null | undefined) {
  return SERVICE_CATEGORIES.has(String(category || ''));
}

/** Una lectura de kilometraje no lleva monto; solo actualiza el km del vehículo. */
export function categoryIsMileageReading(category: string | null | undefined) {
  return category === 'mileage';
}

/** Monto de la fila; las lecturas de kilometraje sin monto muestran guion. */
export function formatExpenseAmount(expense: Pick<CarExpense, 'amount' | 'category'>) {
  if (categoryIsMileageReading(expense.category) && !Number(expense.amount)) return EMPTY;
  return formatCarMoney(expense.amount);
}

/** Chips de filtro: categorías con gasto, en el orden del catálogo. */
export function categoryChipTotals(byCategory: Record<string, number> | null | undefined) {
  if (!byCategory) return [];
  return CAR_EXPENSE_CATEGORIES
    .map(({ value, label }) => ({ value, label, amount: Number(byCategory[value] || 0) }))
    .filter((item) => item.amount > 0);
}

export function formatCarMoney(value: number | null | undefined) {
  return formatSaleMoney(Number(value || 0));
}

export function formatCarMileage(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return EMPTY;
  return `${integer.format(Math.round(Number(value)))} km`;
}

export function formatCarDate(dateKey: string | null | undefined, todayKey = limaTodayKey()) {
  const key = String(dateKey || '').slice(0, 10);
  if (!DATE_KEY.test(key)) return EMPTY;
  const [year, month, day] = key.split('-').map(Number);
  const sameYear = key.slice(0, 4) === todayKey.slice(0, 4);
  const label = new Intl.DateTimeFormat('es-PE', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' as const }),
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
  return label.replace(/\./g, '');
}

export function carTitle(car: Pick<Car, 'name' | 'brand' | 'model'> | null | undefined) {
  if (!car) return '';
  const name = String(car.name || '').trim();
  if (name) return name;
  return [car.brand, car.model].filter(Boolean).join(' ').trim() || 'Vehículo';
}

function cleanText(value: unknown) {
  return value == null ? '' : String(value).trim();
}

/** Línea corta bajo el nombre: año · color · versión · tracción · carrocería. */
export function carSubtitle(
  car: Pick<Car, 'version' | 'year' | 'color'> & Partial<Pick<Car, 'drivetrain' | 'bodyType'>> | null | undefined,
) {
  if (!car) return '';
  return [car.year ? String(car.year) : '', car.color, car.version, car.drivetrain, car.bodyType]
    .map(cleanText)
    .filter(Boolean)
    .join(' · ');
}

export function carPlate(plate: string | null | undefined) {
  return cleanText(plate).toUpperCase();
}

/** Ficha técnica de la tarjeta SUNARP; omite los datos vacíos. */
export function carSpecs(car: Partial<Car> | null | undefined): Array<{ key: string; label: string; value: string; mono?: boolean }> {
  if (!car) return [];
  const displacement = cleanText(car.displacement);
  const seats = car.seats == null ? '' : String(car.seats);
  const specs = [
    { key: 'vin', label: 'VIN', value: cleanText(car.vin).toUpperCase(), mono: true },
    { key: 'engineNumber', label: 'N° de motor', value: cleanText(car.engineNumber).toUpperCase(), mono: true },
    { key: 'fuelType', label: 'Combustible', value: cleanText(car.fuelType) },
    { key: 'displacement', label: 'Cilindrada', value: /^\d+$/.test(displacement) ? `${integer.format(Number(displacement))} cc` : displacement },
    { key: 'power', label: 'Potencia', value: cleanText(car.power) },
    { key: 'seats', label: 'Asientos', value: seats },
    { key: 'vehicleCategory', label: 'Categoría', value: cleanText(car.vehicleCategory).toUpperCase() },
    { key: 'previousPlate', label: 'Placa anterior', value: carPlate(car.previousPlate), mono: true },
  ];
  return specs.filter((spec) => spec.value);
}

export function defaultCarId(cars: ReadonlyArray<Pick<Car, 'id' | 'status'>>) {
  const active = cars.find((car) => car.status === 'active') || cars[0];
  return active ? active.id : null;
}

export type OilChangeTone = 'unknown' | 'ok' | 'soon' | 'overdue';

export function oilChangeStatus(
  currentMileage: number | null | undefined,
  nextOilChangeMileage: number | null | undefined,
): { tone: OilChangeTone; remainingKm: number | null } {
  if (nextOilChangeMileage == null || !Number.isFinite(Number(nextOilChangeMileage))) {
    return { tone: 'unknown', remainingKm: null };
  }
  if (currentMileage == null || !Number.isFinite(Number(currentMileage))) {
    return { tone: 'unknown', remainingKm: null };
  }
  const remainingKm = Number(nextOilChangeMileage) - Number(currentMileage);
  if (remainingKm <= 0) return { tone: 'overdue', remainingKm };
  if (remainingKm <= OIL_CHANGE_WARNING_KM) return { tone: 'soon', remainingKm };
  return { tone: 'ok', remainingKm };
}

export function oilChangeHint(status: { tone: OilChangeTone; remainingKm: number | null }) {
  if (status.remainingKm == null) return '';
  if (status.tone === 'overdue') {
    return status.remainingKm === 0 ? 'Toca hoy' : `Vencido por ${formatCarMileage(-status.remainingKm)}`;
  }
  return `Faltan ${formatCarMileage(status.remainingKm)}`;
}

/**
 * Avance (0–1) desde el último cambio de aceite hasta el próximo. Sin el km del
 * último cambio se usa el intervalo del vehículo como tramo.
 */
export function oilChangeProgress(
  currentMileage: number | null | undefined,
  lastOilChangeMileage: number | null | undefined,
  nextOilChangeMileage: number | null | undefined,
  oilChangeIntervalKm?: number | null,
) {
  const current = Number(currentMileage);
  const next = Number(nextOilChangeMileage);
  if (currentMileage == null || nextOilChangeMileage == null || !Number.isFinite(current) || !Number.isFinite(next)) return null;
  const start = lastOilChangeMileage != null && Number.isFinite(Number(lastOilChangeMileage))
    ? Number(lastOilChangeMileage)
    : oilChangeIntervalKm ? next - Number(oilChangeIntervalKm) : null;
  if (start == null || next <= start) return current >= next ? 1 : null;
  return Math.min(1, Math.max(0, (current - start) / (next - start)));
}

export function suggestNextOilChangeMileage(mileage: string | number | null | undefined, intervalKm: number | null | undefined) {
  const km = parseOptionalInteger(mileage);
  const interval = Number(intervalKm);
  if (km.error || km.value == null || !Number.isFinite(interval) || interval <= 0) return null;
  return km.value + Math.round(interval);
}

export function parseOptionalInteger(value: string | number | null | undefined): { value: number | null; error?: boolean } {
  const raw = String(value ?? '').replace(/[\s,]/g, '').trim();
  if (!raw) return { value: null };
  if (!/^\d+$/.test(raw)) return { value: null, error: true };
  return { value: Number(raw) };
}

export function parseAmount(value: string | number | null | undefined): number | null {
  const raw = String(value ?? '').replace(/s\//i, '').replace(/\s/g, '').replace(',', '.').trim();
  if (!raw || !/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const amount = Number(raw);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function optionalText(value: string | null | undefined) {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

export type CarExpenseForm = {
  category: CarExpenseCategory;
  title: string;
  amount: string;
  occurredOn: string;
  mileage: string;
  vendor: string;
  nextServiceMileage: string;
  nextServiceDate: string;
  notes: string;
};

export function emptyExpenseForm(todayKey = limaTodayKey(), category: CarExpenseCategory = 'fuel'): CarExpenseForm {
  return {
    category,
    title: category === 'other' ? '' : carCategoryLabel(category),
    amount: '',
    occurredOn: todayKey,
    mileage: '',
    vendor: '',
    nextServiceMileage: '',
    nextServiceDate: '',
    notes: '',
  };
}

export function expenseFormFromExpense(expense: CarExpense): CarExpenseForm {
  return {
    category: isCarExpenseCategory(expense.category) ? expense.category : 'other',
    title: expense.title || '',
    amount: expense.amount == null ? '' : String(expense.amount),
    occurredOn: String(expense.occurredOn || '').slice(0, 10),
    mileage: expense.mileage == null ? '' : String(expense.mileage),
    vendor: expense.vendor || '',
    nextServiceMileage: expense.nextServiceMileage == null ? '' : String(expense.nextServiceMileage),
    nextServiceDate: expense.nextServiceDate ? String(expense.nextServiceDate).slice(0, 10) : '',
    notes: expense.notes || '',
  };
}

export function expensePayloadFromForm(form: CarExpenseForm): { payload: CarExpenseInput; error?: undefined } | { payload?: undefined; error: string } {
  if (!isCarExpenseCategory(form.category)) return { error: 'Elige una categoría.' };
  const title = form.title.trim() || carCategoryLabel(form.category);
  const reading = categoryIsMileageReading(form.category);
  const amount = reading ? 0 : parseAmount(form.amount);
  if (amount == null) return { error: 'Ingresa un monto mayor a cero, con hasta 2 decimales.' };
  if (!DATE_KEY.test(form.occurredOn)) return { error: 'Elige la fecha del gasto.' };
  const mileage = parseOptionalInteger(form.mileage);
  if (mileage.error) return { error: 'El kilometraje debe ser un número entero.' };
  if (reading && mileage.value == null) return { error: 'Ingresa el kilometraje del tablero.' };
  const withService = categoryHasNextService(form.category);
  const nextMileage = withService ? parseOptionalInteger(form.nextServiceMileage) : { value: null };
  if (nextMileage.error) return { error: 'El próximo cambio debe ser un kilometraje entero.' };
  if (nextMileage.value != null && mileage.value != null && nextMileage.value <= mileage.value) {
    return { error: 'El próximo cambio debe ser mayor al kilometraje actual.' };
  }
  const nextDate = withService ? form.nextServiceDate.trim() : '';
  if (nextDate && !DATE_KEY.test(nextDate)) return { error: 'La fecha del próximo cambio no es válida.' };
  if (nextDate && nextDate < form.occurredOn) return { error: 'La fecha del próximo cambio no puede ser anterior al gasto.' };
  return {
    payload: {
      category: form.category,
      title,
      amount,
      occurredOn: form.occurredOn,
      mileage: mileage.value,
      vendor: optionalText(form.vendor),
      nextServiceMileage: nextMileage.value,
      nextServiceDate: nextDate || null,
      notes: optionalText(form.notes),
    },
  };
}

/**
 * Cambia la categoría o el kilometraje del formulario y, en un cambio de aceite,
 * propone el próximo kilometraje con el intervalo del vehículo.
 */
export function applyExpenseFormChange(
  form: CarExpenseForm,
  patch: Partial<CarExpenseForm>,
  oilChangeIntervalKm: number | null | undefined,
): CarExpenseForm {
  const next = { ...form, ...patch };
  if (patch.category && patch.category !== form.category) {
    const previousDefault = carCategoryLabel(form.category);
    if (!form.title.trim() || form.title.trim() === previousDefault) {
      next.title = patch.category === 'other' ? '' : carCategoryLabel(patch.category);
    }
  }
  const touchesMileage = patch.mileage !== undefined || patch.category !== undefined;
  if (touchesMileage && next.category === 'oil_change') {
    const suggested = suggestNextOilChangeMileage(next.mileage, oilChangeIntervalKm);
    const previousSuggestion = suggestNextOilChangeMileage(form.mileage, oilChangeIntervalKm);
    const untouched = !form.nextServiceMileage.trim()
      || (previousSuggestion != null && form.nextServiceMileage.trim() === String(previousSuggestion));
    if (suggested != null && untouched) next.nextServiceMileage = String(suggested);
  }
  return next;
}

export type CarForm = {
  name: string;
  brand: string;
  model: string;
  version: string;
  year: string;
  plate: string;
  color: string;
  vin: string;
  currentMileage: string;
  oilChangeIntervalKm: string;
  notes: string;
  engineNumber: string;
  fuelType: string;
  displacement: string;
  power: string;
  drivetrain: string;
  bodyType: string;
  seats: string;
  previousPlate: string;
  vehicleCategory: string;
};

export const EMPTY_CAR_FORM: CarForm = {
  name: '',
  brand: '',
  model: '',
  version: '',
  year: '',
  plate: '',
  color: '',
  vin: '',
  currentMileage: '',
  oilChangeIntervalKm: '5000',
  notes: '',
  engineNumber: '',
  fuelType: '',
  displacement: '',
  power: '',
  drivetrain: '',
  bodyType: '',
  seats: '',
  previousPlate: '',
  vehicleCategory: '',
};

export function carFormFromCar(car: Car): CarForm {
  const text = (value: unknown) => (value == null ? '' : String(value));
  return {
    name: text(car.name),
    brand: text(car.brand),
    model: text(car.model),
    version: text(car.version),
    year: text(car.year),
    plate: text(car.plate),
    color: text(car.color),
    vin: text(car.vin),
    currentMileage: text(car.currentMileage),
    oilChangeIntervalKm: text(car.oilChangeIntervalKm),
    notes: text(car.notes),
    engineNumber: text(car.engineNumber),
    fuelType: text(car.fuelType),
    displacement: text(car.displacement),
    power: text(car.power),
    drivetrain: text(car.drivetrain),
    bodyType: text(car.bodyType),
    seats: text(car.seats),
    previousPlate: text(car.previousPlate),
    vehicleCategory: text(car.vehicleCategory),
  };
}

export function carPayloadFromForm(form: CarForm, currentYear = Number(limaTodayKey().slice(0, 4))): { payload: CarInput; error?: undefined } | { payload?: undefined; error: string } {
  const name = form.name.trim();
  if (!name) return { error: 'Ponle un nombre al vehículo.' };
  const year = parseOptionalInteger(form.year);
  if (year.error || (year.value != null && (year.value < 1950 || year.value > currentYear + 1))) {
    return { error: 'El año no es válido.' };
  }
  const mileage = parseOptionalInteger(form.currentMileage);
  if (mileage.error) return { error: 'El kilometraje debe ser un número entero.' };
  const interval = parseOptionalInteger(form.oilChangeIntervalKm);
  if (interval.error || interval.value === 0) return { error: 'El intervalo de cambio de aceite debe ser un número mayor a cero.' };
  const seats = parseOptionalInteger(form.seats);
  if (seats.error || seats.value === 0 || (seats.value != null && seats.value > 99)) return { error: 'Los asientos deben ser un número entero.' };
  return {
    payload: {
      name,
      brand: optionalText(form.brand),
      model: optionalText(form.model),
      version: optionalText(form.version),
      year: year.value,
      plate: optionalText(form.plate)?.toUpperCase() ?? null,
      color: optionalText(form.color),
      vin: optionalText(form.vin)?.toUpperCase() ?? null,
      currentMileage: mileage.value,
      oilChangeIntervalKm: interval.value,
      notes: optionalText(form.notes),
      engineNumber: optionalText(form.engineNumber)?.toUpperCase() ?? null,
      fuelType: optionalText(form.fuelType),
      displacement: optionalText(form.displacement),
      power: optionalText(form.power),
      drivetrain: optionalText(form.drivetrain),
      bodyType: optionalText(form.bodyType),
      seats: seats.value,
      previousPlate: optionalText(form.previousPlate)?.toUpperCase() ?? null,
      vehicleCategory: optionalText(form.vehicleCategory)?.toUpperCase() ?? null,
    },
  };
}
