// Vehículos propios del negocio y sus registros (kilometraje, combustible, aceite…).
// No forma parte del catálogo ni de los pedidos: es control interno de flota.
import { Pool } from 'pg';

export const CAR_STATUSES = ['active', 'archived'];
export const CAR_EXPENSE_CATEGORIES = [
  'mileage', 'fuel', 'natural_gas', 'tires', 'coolant', 'oil_change', 'brakes', 'other',
];
export const CAR_EXPENSE_CATEGORY_LABELS = Object.freeze({
  mileage: 'Kilometraje',
  fuel: 'Combustible',
  natural_gas: 'Gas natural',
  tires: 'Llantas',
  coolant: 'Refrigerante',
  oil_change: 'Aceite',
  brakes: 'Frenos',
  other: 'Otro',
});
// Título por defecto cuando el registro llega sin título.
export const CAR_EXPENSE_DEFAULT_TITLES = Object.freeze({
  mileage: 'Registro de kilometraje',
  fuel: 'Combustible',
  natural_gas: 'Gas natural',
  tires: 'Llantas',
  coolant: 'Refrigerante',
  oil_change: 'Cambio de aceite',
  brakes: 'Frenos',
  other: 'Otro gasto',
});
export const DEFAULT_OIL_CHANGE_INTERVAL_KM = 5000;
// Ficha técnica de la TIVE (SUNARP): columnas en BD y claves camelCase del Car.
const CAR_SPEC_FIELDS = [
  { key: 'engineNumber', column: 'engine_number', upper: true },
  { key: 'fuelType', column: 'fuel_type' },
  { key: 'displacement', column: 'displacement' },
  { key: 'power', column: 'power' },
  { key: 'drivetrain', column: 'drivetrain' },
  { key: 'bodyType', column: 'body_type' },
  { key: 'seats', column: 'seats', int: true },
  { key: 'previousPlate', column: 'previous_plate', upper: true },
  { key: 'vehicleCategory', column: 'vehicle_category' },
];
const SPEC_TEXT_MAX = 40;
// Datos de la TIVE (SUNARP) del vehículo de la empresa.
export const DEFAULT_CAR = Object.freeze({
  name: 'Suzuki Grand Vitara',
  brand: 'Suzuki',
  model: 'Grand Vitara',
  version: '3 puertas',
  year: 2009,
  plate: 'C1Q-038',
  color: 'Gris',
  vin: 'JS3TA74V594501515',
  engineNumber: 'M16A1444779',
  fuelType: 'Gasolina',
  displacement: '1.6 L',
  power: '73 HP @ 5900 RPM',
  drivetrain: '4x4',
  bodyType: 'SUV',
  seats: 5,
  previousPlate: 'LGW-763',
  vehicleCategory: 'M1',
  notes: null,
});
export const CARS_TZ = 'America/Lima';
export const MAX_EXPENSE_PAGE_SIZE = 100;
const DEFAULT_EXPENSE_PAGE_SIZE = 20;

let defaultPool;

function getPool() {
  if (!defaultPool) {
    defaultPool = new Pool({ connectionString: process.env.DATABASE_URL_POSTGRES });
  }
  return defaultPool;
}

function target(db) {
  return db || getPool();
}

async function inTransaction(db, work) {
  if (db) return work(db);
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function optionalText(value, max = 120) {
  if (isBlank(value)) return null;
  return String(value).trim().slice(0, max);
}

function requiredText(value, label, max = 120) {
  const normalized = optionalText(value, max);
  if (!normalized) throw httpError(`${label} es obligatorio.`);
  return normalized;
}

function parseInteger(value, label, { nullable = true, min = 0, max = 99_999_999, fallback = null } = {}) {
  if (isBlank(value)) {
    if (nullable) return fallback;
    if (fallback != null) return fallback;
    throw httpError(`${label} es obligatorio.`);
  }
  const parsed = Number(typeof value === 'string' ? value.trim().replace(/[\s,_]/g, '') : value);
  if (!Number.isInteger(parsed)) throw httpError(`${label} debe ser un número entero.`);
  if (parsed < min) throw httpError(`${label} no puede ser menor que ${min}.`);
  if (parsed > max) throw httpError(`${label} no puede ser mayor que ${max}.`);
  return parsed;
}

function parseId(value, label = 'id') {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw httpError(`${label} inválido.`);
  return parsed;
}

export function isValidDateKey(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function parseDateKey(value, label, { nullable = true } = {}) {
  if (isBlank(value)) {
    if (nullable) return null;
    throw httpError(`${label} es obligatoria.`);
  }
  const normalized = String(value).trim().slice(0, 10);
  if (!isValidDateKey(normalized)) throw httpError(`${label} debe tener el formato AAAA-MM-DD.`);
  return normalized;
}

function parseAmount(value, { fallback = null } = {}) {
  if (isBlank(value)) {
    if (fallback != null) return fallback;
    throw httpError('El monto es obligatorio.');
  }
  const parsed = Number(typeof value === 'string' ? value.trim().replace(/,/g, '') : value);
  if (!Number.isFinite(parsed)) throw httpError('El monto debe ser un número.');
  if (parsed < 0) throw httpError('El monto no puede ser negativo.');
  if (parsed >= 1e10) throw httpError('El monto es demasiado alto.');
  return Math.round(parsed * 100) / 100;
}

export function limaDateKey(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CARS_TZ }).format(value);
}

/** Normaliza el cuerpo de POST/PATCH de un carro. Para PATCH se pasa el carro actual fusionado. */
export function normalizeCarInput(input = {}) {
  const body = input && typeof input === 'object' ? input : {};
  const status = isBlank(body.status) ? 'active' : String(body.status).trim();
  if (!CAR_STATUSES.includes(status)) throw httpError('Estado del carro inválido.');
  return {
    name: requiredText(body.name, 'El nombre', 120),
    brand: optionalText(body.brand, 80),
    model: optionalText(body.model, 80),
    version: optionalText(body.version, 80),
    year: parseInteger(body.year, 'El año', { min: 1900, max: 2100 }),
    plate: optionalText(body.plate, 20)?.toUpperCase() ?? null,
    color: optionalText(body.color, 40),
    vin: optionalText(body.vin, 32)?.toUpperCase() ?? null,
    currentMileage: parseInteger(body.currentMileage, 'El kilometraje', { nullable: false, fallback: 0 }),
    oilChangeIntervalKm: parseInteger(body.oilChangeIntervalKm, 'El intervalo de cambio de aceite', {
      nullable: false, min: 1, max: 1_000_000, fallback: DEFAULT_OIL_CHANGE_INTERVAL_KM,
    }),
    status,
    notes: optionalText(body.notes, 2000),
    engineNumber: optionalText(body.engineNumber, SPEC_TEXT_MAX)?.toUpperCase() ?? null,
    fuelType: optionalText(body.fuelType, SPEC_TEXT_MAX),
    displacement: optionalText(body.displacement, SPEC_TEXT_MAX),
    power: optionalText(body.power, SPEC_TEXT_MAX),
    drivetrain: optionalText(body.drivetrain, SPEC_TEXT_MAX),
    bodyType: optionalText(body.bodyType, SPEC_TEXT_MAX),
    seats: parseInteger(body.seats, 'Los asientos', { min: 1, max: 20 }),
    previousPlate: optionalText(body.previousPlate, 20)?.toUpperCase() ?? null,
    vehicleCategory: optionalText(body.vehicleCategory, SPEC_TEXT_MAX),
  };
}

/** Normaliza el cuerpo de POST/PATCH de un gasto. Para PATCH se pasa el gasto actual fusionado. */
export function normalizeExpenseInput(input = {}) {
  const body = input && typeof input === 'object' ? input : {};
  const category = String(body.category ?? '').trim();
  if (!category) throw httpError('La categoría es obligatoria.');
  if (!CAR_EXPENSE_CATEGORIES.includes(category)) throw httpError('Categoría de gasto inválida.');
  // 'mileage' es una lectura del odómetro: exige kilometraje y el monto es opcional (0).
  const isReading = category === 'mileage';
  const mileage = parseInteger(body.mileage, 'El kilometraje');
  if (isReading && mileage == null) throw httpError('Ingresa el kilometraje.');
  return {
    category,
    title: optionalText(body.title, 120) || CAR_EXPENSE_DEFAULT_TITLES[category],
    amount: parseAmount(body.amount, { fallback: isReading ? 0 : null }),
    occurredOn: parseDateKey(body.occurredOn, 'La fecha', { nullable: false }),
    mileage,
    vendor: optionalText(body.vendor, 120),
    nextServiceMileage: parseInteger(body.nextServiceMileage, 'El kilometraje del próximo servicio'),
    nextServiceDate: parseDateKey(body.nextServiceDate, 'La fecha del próximo servicio'),
    notes: optionalText(body.notes, 2000),
  };
}

export function normalizeExpenseFilters(query = {}) {
  const q = query && typeof query === 'object' ? query : {};
  const category = isBlank(q.category) ? null : String(q.category).trim();
  if (category && !CAR_EXPENSE_CATEGORIES.includes(category)) throw httpError('Categoría de gasto inválida.');
  const from = parseDateKey(q.from, 'La fecha desde');
  const to = parseDateKey(q.to, 'La fecha hasta');
  if (from && to && from > to) throw httpError('La fecha desde no puede ser posterior a la fecha hasta.');
  const page = parseInteger(q.page, 'La página', { min: 1, max: 1_000_000, fallback: 1 });
  const pageSize = Math.min(
    MAX_EXPENSE_PAGE_SIZE,
    parseInteger(q.pageSize, 'El tamaño de página', { min: 1, max: 1_000_000, fallback: DEFAULT_EXPENSE_PAGE_SIZE }),
  );
  return { category, from, to, q: optionalText(q.q, 120), page, pageSize };
}

export function nextOilChangeMileage(lastOilChange, oilChangeIntervalKm) {
  if (!lastOilChange) return null;
  if (lastOilChange.nextServiceMileage != null) return Number(lastOilChange.nextServiceMileage);
  if (lastOilChange.mileage == null) return null;
  return Number(lastOilChange.mileage) + Number(oilChangeIntervalKm || DEFAULT_OIL_CHANGE_INTERVAL_KM);
}

function intOrNull(value) {
  return value == null ? null : Number(value);
}

function specFromRow(row) {
  const spec = {};
  for (const { key, column, int } of CAR_SPEC_FIELDS) {
    spec[key] = int ? intOrNull(row[column]) : (row[column] ?? null);
  }
  return spec;
}

export function mapCar(row) {
  if (!row) return null;
  const oilChangeIntervalKm = Number(row.oil_change_interval_km ?? DEFAULT_OIL_CHANGE_INTERVAL_KM);
  const lastOil = row.last_oil_occurred_on
    ? {
        occurredOn: String(row.last_oil_occurred_on),
        mileage: intOrNull(row.last_oil_mileage),
        nextServiceMileage: intOrNull(row.last_oil_next_service_mileage),
      }
    : null;
  return {
    id: Number(row.id),
    name: row.name,
    brand: row.brand ?? null,
    model: row.model ?? null,
    version: row.version ?? null,
    year: intOrNull(row.year),
    plate: row.plate ?? null,
    color: row.color ?? null,
    vin: row.vin ?? null,
    currentMileage: Number(row.current_mileage || 0),
    oilChangeIntervalKm,
    status: row.status,
    notes: row.notes ?? null,
    ...specFromRow(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    summary: {
      totalSpent: Number(row.total_spent || 0),
      expenseCount: Number(row.expense_count || 0),
      monthSpent: Number(row.month_spent || 0),
      lastOilChange: lastOil ? { occurredOn: lastOil.occurredOn, mileage: lastOil.mileage } : null,
      nextOilChangeMileage: nextOilChangeMileage(lastOil, oilChangeIntervalKm),
      nextServiceDate: row.next_service_date ? String(row.next_service_date) : null,
    },
  };
}

export function mapExpense(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    carId: Number(row.car_id),
    category: row.category,
    title: row.title,
    amount: Number(row.amount || 0),
    occurredOn: row.occurred_on == null ? null : String(row.occurred_on),
    mileage: intOrNull(row.mileage),
    vendor: row.vendor ?? null,
    nextServiceMileage: intOrNull(row.next_service_mileage),
    nextServiceDate: row.next_service_date == null ? null : String(row.next_service_date),
    notes: row.notes ?? null,
    createdByName: row.created_by_name ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Campos del carro en camelCase para volver a normalizar al fusionar un PATCH.
function carRowToInput(row) {
  return {
    name: row.name,
    brand: row.brand,
    model: row.model,
    version: row.version,
    year: row.year,
    plate: row.plate,
    color: row.color,
    vin: row.vin,
    currentMileage: row.current_mileage,
    oilChangeIntervalKm: row.oil_change_interval_km,
    status: row.status,
    notes: row.notes,
    ...specFromRow(row),
  };
}

function expenseRowToInput(row) {
  return {
    category: row.category,
    title: row.title,
    amount: row.amount,
    occurredOn: row.occurred_on,
    mileage: row.mileage,
    vendor: row.vendor,
    nextServiceMileage: row.next_service_mileage,
    nextServiceDate: row.next_service_date,
    notes: row.notes,
  };
}

// Solo las claves que el cliente envió explícitamente sobrescriben al registro actual.
function mergePatch(current, patch, allowedKeys) {
  const body = patch && typeof patch === 'object' ? patch : {};
  const merged = { ...current };
  for (const key of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(body, key)) merged[key] = body[key];
  }
  return merged;
}

const CAR_INPUT_KEYS = [
  'name', 'brand', 'model', 'version', 'year', 'plate', 'color', 'vin',
  'currentMileage', 'oilChangeIntervalKm', 'status', 'notes',
  ...CAR_SPEC_FIELDS.map(({ key }) => key),
];
const SPEC_COLUMNS_SQL = CAR_SPEC_FIELDS.map(({ column }) => column).join(', ');
const specValues = (car) => CAR_SPEC_FIELDS.map(({ key }) => car[key] ?? null);
const EXPENSE_INPUT_KEYS = [
  'category', 'title', 'amount', 'occurredOn', 'mileage', 'vendor',
  'nextServiceMileage', 'nextServiceDate', 'notes',
];

function actorRef(actor) {
  if (!actor || typeof actor !== 'object') return { id: null, name: null };
  return {
    id: optionalText(actor.id, 120),
    name: optionalText(actor.name, 80) || optionalText(actor.email, 120),
  };
}

const CAR_SELECT = `
  select c.id, c.name, c.brand, c.model, c.version, c.year, c.plate, c.color, c.vin,
         c.current_mileage, c.oil_change_interval_km, c.status, c.notes,
         c.engine_number, c.fuel_type, c.displacement, c.power, c.drivetrain, c.body_type,
         c.seats, c.previous_plate, c.vehicle_category,
         c.created_at, c.updated_at,
         coalesce(s.total_spent, 0) as total_spent,
         coalesce(s.expense_count, 0) as expense_count,
         coalesce(s.month_spent, 0) as month_spent,
         lo.occurred_on::text as last_oil_occurred_on,
         lo.mileage as last_oil_mileage,
         lo.next_service_mileage as last_oil_next_service_mileage,
         ns.next_service_date::text as next_service_date
  from cars c
  left join lateral (
    select sum(e.amount) as total_spent,
           count(*) as expense_count,
           sum(e.amount) filter (
             where to_char(e.occurred_on, 'YYYY-MM') = to_char(now() at time zone '${CARS_TZ}', 'YYYY-MM')
           ) as month_spent
    from car_expenses e
    where e.car_id = c.id
  ) s on true
  left join lateral (
    select e.occurred_on, e.mileage, e.next_service_mileage
    from car_expenses e
    where e.car_id = c.id and e.category = 'oil_change'
    order by e.occurred_on desc, e.id desc
    limit 1
  ) lo on true
  left join lateral (
    select min(e.next_service_date) as next_service_date
    from car_expenses e
    where e.car_id = c.id
      and e.next_service_date >= (now() at time zone '${CARS_TZ}')::date
  ) ns on true
`;

const EXPENSE_COLUMNS = `
  id, car_id, category, title, amount, occurred_on::text as occurred_on, mileage, vendor,
  next_service_mileage, next_service_date::text as next_service_date, notes,
  created_by_name, created_at, updated_at
`;

export async function ensureTables(db) {
  const client = target(db);
  await client.query(`
    create table if not exists cars (
      id serial primary key,
      name text not null,
      brand text,
      model text,
      version text,
      year int,
      plate text,
      color text,
      vin text,
      current_mileage int not null default 0,
      oil_change_interval_km int not null default ${DEFAULT_OIL_CHANGE_INTERVAL_KM},
      status text not null default 'active',
      notes text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      check (status in ('active', 'archived')),
      check (current_mileage >= 0),
      check (oil_change_interval_km > 0)
    );
    create table if not exists car_expenses (
      id serial primary key,
      car_id int not null references cars(id) on delete cascade,
      category text not null,
      title text not null,
      amount numeric(12,2) not null check (amount >= 0),
      occurred_on date not null,
      mileage int,
      vendor text,
      next_service_mileage int,
      next_service_date date,
      notes text,
      created_by text,
      created_by_name text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create index if not exists idx_car_expenses_car_occurred
      on car_expenses(car_id, occurred_on desc);
  `);
  await client.query(`
    alter table cars add column if not exists engine_number text;
    alter table cars add column if not exists fuel_type text;
    alter table cars add column if not exists displacement text;
    alter table cars add column if not exists power text;
    alter table cars add column if not exists drivetrain text;
    alter table cars add column if not exists body_type text;
    alter table cars add column if not exists seats int;
    alter table cars add column if not exists previous_plate text;
    alter table cars add column if not exists vehicle_category text;
  `);
  await client.query(
    `insert into cars (name, brand, model, version, year, plate, color, vin, notes, ${SPEC_COLUMNS_SQL})
     select $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
     where not exists (select 1 from cars)`,
    [
      DEFAULT_CAR.name, DEFAULT_CAR.brand, DEFAULT_CAR.model, DEFAULT_CAR.version,
      DEFAULT_CAR.year, DEFAULT_CAR.plate, DEFAULT_CAR.color, DEFAULT_CAR.vin, DEFAULT_CAR.notes,
      ...specValues(DEFAULT_CAR),
    ],
  );
  // Completa la ficha TIVE del carro sembrado por la versión anterior (notas en texto libre).
  await client.query(
    `update cars set name = $2, version = $3, notes = null,
                     engine_number = $4, fuel_type = $5, displacement = $6, power = $7,
                     drivetrain = $8, body_type = $9, seats = $10, previous_plate = $11,
                     vehicle_category = $12, updated_at = now()
     where vin = $1 and engine_number is null`,
    [DEFAULT_CAR.vin, DEFAULT_CAR.name, DEFAULT_CAR.version, ...specValues(DEFAULT_CAR)],
  );
}

async function findCar(client, id) {
  const result = await client.query(`${CAR_SELECT} where c.id = $1`, [id]);
  return result.rows[0] || null;
}

async function requireCarRow(client, id, { lock = false } = {}) {
  const result = await client.query(
    `select * from cars where id = $1${lock ? ' for update' : ''}`,
    [id],
  );
  if (!result.rows[0]) throw httpError('Carro no encontrado.', 404);
  return result.rows[0];
}

export async function listCars({ status } = {}, db) {
  const filter = isBlank(status) ? 'active' : String(status).trim();
  if (filter !== 'all' && !CAR_STATUSES.includes(filter)) throw httpError('Estado del carro inválido.');
  const params = [];
  let where = '';
  if (filter !== 'all') {
    params.push(filter);
    where = 'where c.status = $1';
  }
  const result = await target(db).query(`${CAR_SELECT} ${where} order by c.name asc, c.id asc`, params);
  return { cars: result.rows.map(mapCar), categories: [...CAR_EXPENSE_CATEGORIES] };
}

export async function getCar(id, db) {
  const carId = parseId(id, 'Carro');
  const row = await findCar(target(db), carId);
  if (!row) throw httpError('Carro no encontrado.', 404);
  return mapCar(row);
}

export async function createCar(input, _actor, db) {
  const car = normalizeCarInput({ ...(input || {}), status: input?.status ?? 'active' });
  const client = target(db);
  const inserted = await client.query(
    `insert into cars (name, brand, model, version, year, plate, color, vin,
                       current_mileage, oil_change_interval_km, status, notes, ${SPEC_COLUMNS_SQL})
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     returning id`,
    [car.name, car.brand, car.model, car.version, car.year, car.plate, car.color, car.vin,
      car.currentMileage, car.oilChangeIntervalKm, car.status, car.notes, ...specValues(car)],
  );
  return mapCar(await findCar(client, inserted.rows[0].id));
}

export async function updateCar(id, input, _actor, db) {
  const carId = parseId(id, 'Carro');
  return inTransaction(db, async (client) => {
    const current = await requireCarRow(client, carId, { lock: true });
    const car = normalizeCarInput(mergePatch(carRowToInput(current), input, CAR_INPUT_KEYS));
    await client.query(
      `update cars set name = $2, brand = $3, model = $4, version = $5, year = $6, plate = $7,
                       color = $8, vin = $9, current_mileage = $10, oil_change_interval_km = $11,
                       status = $12, notes = $13, engine_number = $14, fuel_type = $15,
                       displacement = $16, power = $17, drivetrain = $18, body_type = $19,
                       seats = $20, previous_plate = $21, vehicle_category = $22, updated_at = now()
       where id = $1`,
      [carId, car.name, car.brand, car.model, car.version, car.year, car.plate, car.color, car.vin,
        car.currentMileage, car.oilChangeIntervalKm, car.status, car.notes, ...specValues(car)],
    );
    return mapCar(await findCar(client, carId));
  });
}

function expenseWhere(carId, filters) {
  const params = [carId];
  const clauses = ['car_id = $1'];
  if (filters.category) {
    params.push(filters.category);
    clauses.push(`category = $${params.length}`);
  }
  if (filters.from) {
    params.push(filters.from);
    clauses.push(`occurred_on >= $${params.length}::date`);
  }
  if (filters.to) {
    params.push(filters.to);
    clauses.push(`occurred_on <= $${params.length}::date`);
  }
  if (filters.q) {
    params.push(`%${filters.q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
    const p = `$${params.length}`;
    clauses.push(`(title ilike ${p} or coalesce(vendor, '') ilike ${p} or coalesce(notes, '') ilike ${p})`);
  }
  return { where: clauses.join(' and '), params };
}

export async function listCarExpenses(carId, query = {}, db) {
  const id = parseId(carId, 'Carro');
  const filters = normalizeExpenseFilters(query);
  const client = target(db);
  await requireCarRow(client, id);
  const { where, params } = expenseWhere(id, filters);
  const offset = (filters.page - 1) * filters.pageSize;
  const [rowsResult, totalsResult] = await Promise.all([
    client.query(
      `select ${EXPENSE_COLUMNS} from car_expenses where ${where}
       order by occurred_on desc, id desc
       limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, filters.pageSize, offset],
    ),
    client.query(
      `select category, count(*) as count, coalesce(sum(amount), 0) as amount
       from car_expenses where ${where} group by category`,
      params,
    ),
  ]);
  const byCategory = {};
  let total = 0;
  let amount = 0;
  for (const row of totalsResult.rows) {
    const value = Number(row.amount || 0);
    byCategory[row.category] = value;
    amount += value;
    total += Number(row.count || 0);
  }
  return {
    rows: rowsResult.rows.map(mapExpense),
    total,
    page: filters.page,
    pageSize: filters.pageSize,
    totals: { amount: Math.round(amount * 100) / 100, byCategory },
  };
}

async function bumpCarMileage(client, carId, mileage) {
  if (mileage == null) return;
  await client.query(
    `update cars set current_mileage = $2, updated_at = now()
     where id = $1 and current_mileage < $2`,
    [carId, mileage],
  );
}

async function resolveActorName(client, actor) {
  if (actor.name) return actor.name;
  if (!actor.id) return null;
  const found = await client.query('select name from "user" where id = $1 limit 1', [actor.id]);
  return found.rows[0]?.name || null;
}

export async function createCarExpense(carId, input, actor, db) {
  const id = parseId(carId, 'Carro');
  const expense = normalizeExpenseInput(input);
  const ref = actorRef(actor);
  return inTransaction(db, async (client) => {
    await requireCarRow(client, id, { lock: true });
    const actorName = await resolveActorName(client, ref);
    const inserted = await client.query(
      `insert into car_expenses (car_id, category, title, amount, occurred_on, mileage, vendor,
                                 next_service_mileage, next_service_date, notes, created_by, created_by_name)
       values ($1,$2,$3,$4,$5::date,$6,$7,$8,$9::date,$10,$11,$12)
       returning ${EXPENSE_COLUMNS}`,
      [id, expense.category, expense.title, expense.amount, expense.occurredOn, expense.mileage,
        expense.vendor, expense.nextServiceMileage, expense.nextServiceDate, expense.notes, ref.id, actorName],
    );
    await bumpCarMileage(client, id, expense.mileage);
    return mapExpense(inserted.rows[0]);
  });
}

async function requireExpenseRow(client, carId, expenseId) {
  const result = await client.query(
    `select ${EXPENSE_COLUMNS} from car_expenses where id = $1 and car_id = $2`,
    [expenseId, carId],
  );
  if (!result.rows[0]) throw httpError('Gasto no encontrado.', 404);
  return result.rows[0];
}

export async function updateCarExpense(carId, expenseId, input, _actor, db) {
  const id = parseId(carId, 'Carro');
  const eid = parseId(expenseId, 'Gasto');
  return inTransaction(db, async (client) => {
    await requireCarRow(client, id, { lock: true });
    const current = await requireExpenseRow(client, id, eid);
    const expense = normalizeExpenseInput(mergePatch(expenseRowToInput(current), input, EXPENSE_INPUT_KEYS));
    const updated = await client.query(
      `update car_expenses set category = $3, title = $4, amount = $5, occurred_on = $6::date,
                               mileage = $7, vendor = $8, next_service_mileage = $9,
                               next_service_date = $10::date, notes = $11, updated_at = now()
       where id = $1 and car_id = $2
       returning ${EXPENSE_COLUMNS}`,
      [eid, id, expense.category, expense.title, expense.amount, expense.occurredOn, expense.mileage,
        expense.vendor, expense.nextServiceMileage, expense.nextServiceDate, expense.notes],
    );
    await bumpCarMileage(client, id, expense.mileage);
    return mapExpense(updated.rows[0]);
  });
}

export async function deleteCarExpense(carId, expenseId, db) {
  const id = parseId(carId, 'Carro');
  const eid = parseId(expenseId, 'Gasto');
  const result = await target(db).query(
    'delete from car_expenses where id = $1 and car_id = $2 returning id',
    [eid, id],
  );
  if (!result.rows[0]) throw httpError('Gasto no encontrado.', 404);
  return { ok: true };
}
