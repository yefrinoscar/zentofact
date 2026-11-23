import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAR_EXPENSE_CATEGORIES,
  CAR_EXPENSE_CATEGORY_LABELS,
  CAR_EXPENSE_DEFAULT_TITLES,
  DEFAULT_CAR,
  createCarExpense,
  deleteCarExpense,
  ensureTables,
  isValidDateKey,
  mapCar,
  mapExpense,
  nextOilChangeMileage,
  normalizeCarInput,
  normalizeExpenseFilters,
  normalizeExpenseInput,
  updateCar,
  updateCarExpense,
} from './cars.js';

function rejectsWithStatus(fn, status, pattern) {
  try {
    fn();
  } catch (error) {
    assert.equal(error.status, status);
    if (pattern) assert.match(error.message, pattern);
    return;
  }
  assert.fail('se esperaba un error');
}

test('las categorías de gasto tienen etiqueta en español', () => {
  assert.deepEqual(CAR_EXPENSE_CATEGORIES, [
    'mileage', 'fuel', 'natural_gas', 'tires', 'coolant', 'oil_change', 'brakes', 'other',
  ]);
  for (const category of CAR_EXPENSE_CATEGORIES) {
    assert.ok(CAR_EXPENSE_CATEGORY_LABELS[category]);
    assert.ok(CAR_EXPENSE_DEFAULT_TITLES[category]);
  }
  assert.equal(CAR_EXPENSE_CATEGORY_LABELS.oil_change, 'Aceite');
  assert.equal(CAR_EXPENSE_CATEGORY_LABELS.mileage, 'Kilometraje');
  assert.deepEqual(
    CAR_EXPENSE_CATEGORIES.map((category) => normalizeExpenseInput({
      category, amount: 1, mileage: 1000, occurredOn: '2026-11-01',
    }).title),
    ['Registro de kilometraje', 'Combustible', 'Gas natural', 'Llantas', 'Refrigerante', 'Cambio de aceite', 'Frenos', 'Otro gasto'],
  );
  for (const removed of ['maintenance', 'repair', 'insurance', 'taxes', 'parking', 'cleaning']) {
    rejectsWithStatus(() => normalizeExpenseInput({ category: removed, amount: 1, occurredOn: '2026-11-01' }), 400, /Categoría/);
  }
});

test('normalizeCarInput exige nombre y aplica valores por defecto', () => {
  rejectsWithStatus(() => normalizeCarInput({}), 400, /nombre/);
  const car = normalizeCarInput({ name: '  Vitara ', plate: 'abc-123', vin: ' jsa123 ', year: '2008', brand: '' });
  assert.equal(car.name, 'Vitara');
  assert.equal(car.plate, 'ABC-123');
  assert.equal(car.vin, 'JSA123');
  assert.equal(car.year, 2008);
  assert.equal(car.brand, null);
  assert.equal(car.currentMileage, 0);
  assert.equal(car.oilChangeIntervalKm, 5000);
  assert.equal(car.status, 'active');
  assert.equal(car.engineNumber, null);
  assert.equal(car.seats, null);
});

test('normalizeCarInput acepta la ficha técnica de la TIVE', () => {
  const car = normalizeCarInput({
    name: 'X', engineNumber: ' m16a1444779 ', fuelType: 'Gasolina', displacement: '1.6 L',
    power: '73 HP @ 5900 RPM', drivetrain: '4x4', bodyType: 'SUV', seats: '5',
    previousPlate: 'lgw-763', vehicleCategory: 'M1',
  });
  assert.equal(car.engineNumber, 'M16A1444779');
  assert.equal(car.previousPlate, 'LGW-763');
  assert.equal(car.fuelType, 'Gasolina');
  assert.equal(car.seats, 5);
  assert.equal(car.vehicleCategory, 'M1');
  assert.equal(normalizeCarInput({ name: 'X', power: 'x'.repeat(60) }).power.length, 40);
  rejectsWithStatus(() => normalizeCarInput({ name: 'X', seats: 0 }), 400, /asientos/);
  rejectsWithStatus(() => normalizeCarInput({ name: 'X', seats: 21 }), 400, /asientos/);
  rejectsWithStatus(() => normalizeCarInput({ name: 'X', seats: 2.5 }), 400, /entero/);
});

test('normalizeCarInput rechaza enteros inválidos y estados desconocidos', () => {
  rejectsWithStatus(() => normalizeCarInput({ name: 'X', currentMileage: -1 }), 400, /kilometraje/);
  rejectsWithStatus(() => normalizeCarInput({ name: 'X', currentMileage: 10.5 }), 400, /entero/);
  rejectsWithStatus(() => normalizeCarInput({ name: 'X', oilChangeIntervalKm: 0 }), 400);
  rejectsWithStatus(() => normalizeCarInput({ name: 'X', year: 1800 }), 400, /año/);
  rejectsWithStatus(() => normalizeCarInput({ name: 'X', status: 'sold' }), 400, /Estado/);
  assert.equal(normalizeCarInput({ name: 'X', currentMileage: '120,500' }).currentMileage, 120500);
  assert.equal(normalizeCarInput({ name: 'X', status: 'archived' }).status, 'archived');
});

test('normalizeExpenseInput valida categoría, monto y fecha', () => {
  const base = { category: 'fuel', amount: 150, occurredOn: '2026-11-10' };
  rejectsWithStatus(() => normalizeExpenseInput({ ...base, category: '' }), 400, /categoría/);
  rejectsWithStatus(() => normalizeExpenseInput({ ...base, category: 'gift' }), 400, /Categoría/);
  rejectsWithStatus(() => normalizeExpenseInput({ ...base, amount: -1 }), 400, /negativo/);
  rejectsWithStatus(() => normalizeExpenseInput({ ...base, amount: 'abc' }), 400, /número/);
  rejectsWithStatus(() => normalizeExpenseInput({ ...base, amount: '' }), 400, /monto/);
  rejectsWithStatus(() => normalizeExpenseInput({ ...base, occurredOn: '' }), 400, /fecha/);
  rejectsWithStatus(() => normalizeExpenseInput({ ...base, occurredOn: '2026-02-30' }), 400, /AAAA-MM-DD/);
  rejectsWithStatus(() => normalizeExpenseInput({ ...base, mileage: -5 }), 400, /kilometraje/);
  rejectsWithStatus(() => normalizeExpenseInput({ ...base, nextServiceDate: 'mañana' }), 400, /próximo/);
  rejectsWithStatus(() => normalizeExpenseInput({ ...base, amount: undefined }), 400, /monto/);
});

test('un registro de kilometraje exige kilometraje y su monto es 0 por defecto', () => {
  const base = { category: 'mileage', occurredOn: '2026-11-10' };
  rejectsWithStatus(() => normalizeExpenseInput(base), 400, /^Ingresa el kilometraje\.$/);
  rejectsWithStatus(() => normalizeExpenseInput({ ...base, mileage: '' }), 400, /^Ingresa el kilometraje\.$/);
  const reading = normalizeExpenseInput({ ...base, mileage: '86,200' });
  assert.equal(reading.amount, 0);
  assert.equal(reading.mileage, 86200);
  assert.equal(reading.title, 'Registro de kilometraje');
  assert.equal(normalizeExpenseInput({ ...base, mileage: 86200, amount: '' }).amount, 0);
  assert.equal(normalizeExpenseInput({ ...base, mileage: 86200, amount: '15.5' }).amount, 15.5);
  rejectsWithStatus(() => normalizeExpenseInput({ ...base, mileage: 86200, amount: -1 }), 400, /negativo/);
  // Las demás categorías no exigen kilometraje.
  assert.equal(normalizeExpenseInput({ category: 'coolant', amount: 30, occurredOn: '2026-11-10' }).mileage, null);
});

test('normalizeExpenseInput completa el título con la etiqueta de la categoría', () => {
  const expense = normalizeExpenseInput({
    category: 'oil_change', title: '  ', amount: '120.456', occurredOn: '2026-11-01',
    mileage: '85000', nextServiceMileage: '', nextServiceDate: null, vendor: ' Lubricentro ',
  });
  assert.equal(expense.title, 'Cambio de aceite');
  assert.equal(expense.amount, 120.46);
  assert.equal(expense.mileage, 85000);
  assert.equal(expense.nextServiceMileage, null);
  assert.equal(expense.nextServiceDate, null);
  assert.equal(expense.vendor, 'Lubricentro');
  assert.equal(normalizeExpenseInput({ category: 'tires', title: 'Llantas nuevas', amount: 0, occurredOn: '2026-01-01' }).title, 'Llantas nuevas');
});

test('normalizeExpenseFilters limita la página y valida el rango', () => {
  assert.deepEqual(normalizeExpenseFilters({}), { category: null, from: null, to: null, q: null, page: 1, pageSize: 20 });
  assert.equal(normalizeExpenseFilters({ pageSize: '500' }).pageSize, 100);
  assert.equal(normalizeExpenseFilters({ page: '3', q: ' aceite ' }).q, 'aceite');
  rejectsWithStatus(() => normalizeExpenseFilters({ page: 0 }), 400);
  rejectsWithStatus(() => normalizeExpenseFilters({ category: 'gift' }), 400);
  rejectsWithStatus(() => normalizeExpenseFilters({ from: '2026-12-01', to: '2026-11-01' }), 400, /posterior/);
});

test('isValidDateKey solo acepta fechas reales', () => {
  assert.equal(isValidDateKey('2024-02-29'), true);
  assert.equal(isValidDateKey('2025-02-29'), false);
  assert.equal(isValidDateKey('2025-1-01'), false);
});

test('nextOilChangeMileage prioriza el próximo servicio registrado', () => {
  assert.equal(nextOilChangeMileage(null, 5000), null);
  assert.equal(nextOilChangeMileage({ mileage: 80000, nextServiceMileage: null }, 5000), 85000);
  assert.equal(nextOilChangeMileage({ mileage: 80000, nextServiceMileage: 84000 }, 5000), 84000);
  assert.equal(nextOilChangeMileage({ mileage: null, nextServiceMileage: null }, 5000), null);
});

test('mapCar expone el resumen en camelCase', () => {
  const car = mapCar({
    id: '1', name: 'Suzuki Grand Vitara 3P', brand: 'Suzuki', model: 'Grand Vitara', version: '3 puertas',
    year: null, plate: null, color: null, vin: null, current_mileage: 81000, oil_change_interval_km: 5000,
    status: 'active', notes: null, created_at: 'c', updated_at: 'u',
    engine_number: 'M16A1444779', fuel_type: 'Gasolina', displacement: '1.6 L', power: '73 HP @ 5900 RPM',
    drivetrain: '4x4', body_type: 'SUV', seats: '5', previous_plate: 'LGW-763', vehicle_category: 'M1',
    total_spent: '350.50', expense_count: '3', month_spent: '120.00',
    last_oil_occurred_on: '2026-11-01', last_oil_mileage: 80000, last_oil_next_service_mileage: null,
    next_service_date: '2026-12-15',
  });
  assert.equal(car.id, 1);
  assert.equal(car.currentMileage, 81000);
  assert.equal(car.engineNumber, 'M16A1444779');
  assert.equal(car.fuelType, 'Gasolina');
  assert.equal(car.displacement, '1.6 L');
  assert.equal(car.power, '73 HP @ 5900 RPM');
  assert.equal(car.drivetrain, '4x4');
  assert.equal(car.bodyType, 'SUV');
  assert.equal(car.seats, 5);
  assert.equal(car.previousPlate, 'LGW-763');
  assert.equal(car.vehicleCategory, 'M1');
  assert.deepEqual(car.summary, {
    totalSpent: 350.5,
    expenseCount: 3,
    monthSpent: 120,
    lastOilChange: { occurredOn: '2026-11-01', mileage: 80000 },
    nextOilChangeMileage: 85000,
    nextServiceDate: '2026-12-15',
  });
  const empty = mapCar({ id: 2, name: 'X', current_mileage: 0, oil_change_interval_km: 5000, status: 'active' });
  assert.deepEqual(empty.summary, {
    totalSpent: 0, expenseCount: 0, monthSpent: 0, lastOilChange: null, nextOilChangeMileage: null, nextServiceDate: null,
  });
  assert.equal(empty.engineNumber, null);
  assert.equal(empty.seats, null);
});

test('mapExpense convierte números y conserva fechas como texto', () => {
  const expense = mapExpense({
    id: '9', car_id: '1', category: 'fuel', title: 'Combustible', amount: '150.00',
    occurred_on: '2026-11-10', mileage: null, vendor: null, next_service_mileage: '90000',
    next_service_date: null, notes: null, created_by_name: 'Ana', created_at: 'c', updated_at: 'u',
  });
  assert.equal(expense.id, 9);
  assert.equal(expense.carId, 1);
  assert.equal(expense.amount, 150);
  assert.equal(expense.occurredOn, '2026-11-10');
  assert.equal(expense.nextServiceMileage, 90000);
  assert.equal(expense.createdByName, 'Ana');
  assert.equal('createdBy' in expense, false);
});

// Base de datos mínima: registra las consultas y responde a las que usa cars.js.
class FakeDb {
  constructor({ car = { id: 1, current_mileage: 1000 }, expense = null, carCount = 0 } = {}) {
    this.car = car;
    this.expense = expense;
    this.carCount = carCount;
    this.queries = [];
  }

  async query(sql, params = []) {
    const compact = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    this.queries.push({ sql: compact, params });
    if (compact.startsWith('create table') || compact.startsWith('alter table')) return { rows: [] };
    if (compact.startsWith('update cars set name') && compact.includes('where vin = $1 and engine_number is null')) {
      return { rows: [] };
    }
    if (compact.startsWith('update cars set name')) {
      this.carUpdate = params;
      return { rows: [] };
    }
    if (compact.startsWith('select c.id') && compact.includes('where c.id = $1')) {
      return { rows: this.car && Number(params[0]) === this.car.id ? [{ ...this.car, status: this.car.status || 'active' }] : [] };
    }
    if (compact.startsWith('insert into cars')) {
      if (this.carCount === 0) this.carCount += 1;
      return { rows: [] };
    }
    if (compact.startsWith('select * from cars where id')) {
      return { rows: this.car && Number(params[0]) === this.car.id ? [this.car] : [] };
    }
    if (compact.startsWith('select name from "user"')) return { rows: [{ name: 'Usuario' }] };
    if (compact.startsWith('insert into car_expenses') || compact.startsWith('update car_expenses')) {
      const offset = compact.startsWith('insert') ? 1 : 2;
      return {
        rows: [{
          id: compact.startsWith('insert') ? 5 : params[0], car_id: this.car.id,
          category: params[offset], title: params[offset + 1], amount: String(params[offset + 2]),
          occurred_on: params[offset + 3], mileage: params[offset + 4], vendor: params[offset + 5],
          next_service_mileage: params[offset + 6], next_service_date: params[offset + 7], notes: params[offset + 8],
          created_by_name: compact.startsWith('insert') ? params[11] : null,
        }],
      };
    }
    if (compact.startsWith('update cars set current_mileage')) {
      if (this.car.current_mileage < params[1]) this.car.current_mileage = params[1];
      return { rows: [] };
    }
    if (compact.startsWith('select') && compact.includes('from car_expenses where id')) {
      return { rows: this.expense && Number(params[0]) === this.expense.id ? [this.expense] : [] };
    }
    if (compact.startsWith('delete from car_expenses')) {
      return { rows: this.expense && Number(params[0]) === this.expense.id ? [{ id: this.expense.id }] : [] };
    }
    throw new Error(`consulta no soportada: ${compact}`);
  }
}

test('ensureTables siembra el Grand Vitara solo si no hay carros', async () => {
  const db = new FakeDb();
  await ensureTables(db);
  await ensureTables(db);
  const seeds = db.queries.filter(({ sql }) => sql.startsWith('insert into cars'));
  assert.equal(seeds.length, 2);
  assert.match(seeds[0].sql, /where not exists \(select 1 from cars\)/);
  assert.deepEqual(seeds[0].params, [
    'Suzuki Grand Vitara', 'Suzuki', 'Grand Vitara', '3 puertas', 2009, 'C1Q-038', 'Gris', 'JS3TA74V594501515', null,
    'M16A1444779', 'Gasolina', '1.6 L', '73 HP @ 5900 RPM', '4x4', 'SUV', 5, 'LGW-763', 'M1',
  ]);
  assert.match(seeds[0].sql, /engine_number, fuel_type, displacement, power, drivetrain, body_type, seats, previous_plate, vehicle_category/);
  assert.equal(db.carCount, 1);
  const alters = db.queries.filter(({ sql }) => sql.startsWith('alter table cars'));
  assert.equal(alters.length, 2);
  for (const column of ['engine_number text', 'fuel_type text', 'displacement text', 'power text', 'drivetrain text',
    'body_type text', 'seats int', 'previous_plate text', 'vehicle_category text']) {
    assert.ok(alters[0].sql.includes(`add column if not exists ${column}`), column);
  }
});

test('ensureTables completa la ficha TIVE del carro sembrado por la versión anterior', async () => {
  const db = new FakeDb();
  await ensureTables(db);
  const backfill = db.queries.find(({ sql }) => sql.includes('where vin = $1 and engine_number is null'));
  assert.ok(backfill);
  assert.match(backfill.sql, /notes = null/);
  assert.deepEqual(backfill.params, [
    'JS3TA74V594501515', 'Suzuki Grand Vitara', '3 puertas',
    'M16A1444779', 'Gasolina', '1.6 L', '73 HP @ 5900 RPM', '4x4', 'SUV', 5, 'LGW-763', 'M1',
  ]);
});

test('editar un carro conserva la ficha técnica no enviada', async () => {
  const db = new FakeDb({
    car: {
      id: 1, name: 'Vitara', current_mileage: 1000, oil_change_interval_km: 5000, status: 'active',
      engine_number: 'M16A1444779', fuel_type: 'Gasolina', seats: 5, previous_plate: 'LGW-763',
    },
  });
  await updateCar(1, { seats: 4, drivetrain: '4x2' }, null, db);
  const params = db.carUpdate;
  assert.equal(params[13], 'M16A1444779');
  assert.equal(params[14], 'Gasolina');
  assert.equal(params[17], '4x2');
  assert.equal(params[19], 4);
  assert.equal(params[20], 'LGW-763');
});

test('crear un gasto con más kilometraje actualiza el kilometraje del carro', async () => {
  const db = new FakeDb();
  const expense = await createCarExpense(1, {
    category: 'oil_change', amount: 120, occurredOn: '2026-11-12', mileage: 2500,
  }, { id: 'u1', name: 'Ana' }, db);
  assert.equal(expense.title, 'Cambio de aceite');
  assert.equal(expense.createdByName, 'Ana');
  assert.equal(db.car.current_mileage, 2500);
  assert.ok(db.queries.some(({ sql }) => sql.includes('for update')));
});

test('un gasto con menos kilometraje no reduce el del carro', async () => {
  const db = new FakeDb();
  await createCarExpense(1, { category: 'fuel', amount: 50, occurredOn: '2026-11-12', mileage: 900 }, null, db);
  assert.equal(db.car.current_mileage, 1000);
});

test('crear un gasto para un carro inexistente responde 404', async () => {
  const db = new FakeDb();
  await assert.rejects(
    createCarExpense(99, { category: 'fuel', amount: 50, occurredOn: '2026-11-12' }, null, db),
    (error) => error.status === 404,
  );
});

test('editar un gasto fusiona solo los campos enviados', async () => {
  const db = new FakeDb({
    expense: {
      id: 7, car_id: 1, category: 'brakes', title: 'Frenos', amount: '300.00', occurred_on: '2026-10-01',
      mileage: 950, vendor: 'Taller', next_service_mileage: null, next_service_date: null, notes: null,
    },
  });
  const expense = await updateCarExpense(1, 7, { amount: 320, mileage: 1500 }, null, db);
  assert.equal(expense.title, 'Frenos');
  assert.equal(expense.vendor, 'Taller');
  assert.equal(expense.amount, 320);
  assert.equal(expense.occurredOn, '2026-10-01');
  assert.equal(db.car.current_mileage, 1500);
  await assert.rejects(updateCarExpense(1, 8, { amount: 1 }, null, db), (error) => error.status === 404);
});

test('eliminar un gasto de otro carro responde 404', async () => {
  const db = new FakeDb({ expense: { id: 7, car_id: 1 } });
  assert.deepEqual(await deleteCarExpense(1, 7, db), { ok: true });
  await assert.rejects(deleteCarExpense(1, 8, db), (error) => error.status === 404);
});
