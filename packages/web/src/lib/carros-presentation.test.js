import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyExpenseFormChange,
  carCategoryLabel,
  carPayloadFromForm,
  carPlate,
  carSpecs,
  categoryChipTotals,
  EMPTY_CAR_FORM,
  formatExpenseAmount,
  oilChangeProgress,
  carSubtitle,
  carTitle,
  categoryHasNextService,
  defaultCarId,
  emptyExpenseForm,
  expenseFormFromExpense,
  expensePayloadFromForm,
  formatCarDate,
  formatCarMileage,
  formatCarMoney,
  oilChangeHint,
  oilChangeStatus,
  parseAmount,
  suggestNextOilChangeMileage,
} from './carros-presentation.ts';

const normalizeSpaces = (value) => value.replace(/\s/g, ' ');

test('las categorías se muestran en español y lo desconocido cae en Otro', () => {
  assert.equal(carCategoryLabel('oil_change'), 'Aceite');
  assert.equal(carCategoryLabel('mileage'), 'Kilometraje');
  assert.equal(carCategoryLabel('natural_gas'), 'Gas natural');
  assert.equal(carCategoryLabel('maintenance'), 'Otro');
  assert.equal(carCategoryLabel('desconocida'), 'Otro');
});

test('aceite, llantas, frenos y refrigerante piden próximo cambio', () => {
  for (const category of ['oil_change', 'tires', 'brakes', 'coolant']) assert.equal(categoryHasNextService(category), true);
  for (const category of ['fuel', 'natural_gas', 'mileage', 'other']) assert.equal(categoryHasNextService(category), false);
});

test('los chips de categoría solo muestran las que tienen gasto, en orden', () => {
  assert.deepEqual(
    categoryChipTotals({ other: 10, fuel: 120.5, mileage: 0, oil_change: 185 }).map(({ value, amount }) => [value, amount]),
    [['fuel', 120.5], ['oil_change', 185], ['other', 10]],
  );
  assert.deepEqual(categoryChipTotals(undefined), []);
});

test('formatea soles, kilómetros y fechas sin desfase de zona horaria', () => {
  assert.match(normalizeSpaces(formatCarMoney(185.5)), /^S\/ 185\.50$/);
  assert.equal(normalizeSpaces(formatCarMileage(123456)), '123,456 km');
  assert.equal(formatCarMileage(null), '—');
  assert.equal(formatCarDate('2026-11-01', '2026-11-20'), '1 nov');
  assert.equal(formatCarDate('2025-03-09', '2026-11-20'), '9 mar 2025');
  assert.equal(formatCarDate(null), '—');
});

test('nombre y detalle del vehículo', () => {
  const car = { name: 'Grand Vitara', brand: 'Suzuki', model: 'Grand Vitara', version: '3 puertas', year: 2012, plate: 'abc-123' };
  assert.equal(carTitle(car), 'Grand Vitara');
  assert.equal(carTitle({ name: '', brand: 'Suzuki', model: 'Jimny' }), 'Suzuki Jimny');
  assert.equal(carSubtitle({ ...car, color: 'Gris', drivetrain: '4x4', bodyType: 'SUV' }), '2012 · Gris · 3 puertas · 4x4 · SUV');
  assert.equal(carSubtitle({ year: null, color: ' ', version: null }), '');
  assert.equal(carPlate(' c1q-038 '), 'C1Q-038');
});

test('la ficha técnica omite los datos vacíos', () => {
  const specs = carSpecs({ vin: 'jsaj1234', engineNumber: '', fuelType: 'Gasolina', displacement: '2393', power: null, seats: 5, previousPlate: 'abc-123' });
  assert.deepEqual(specs.map((spec) => spec.label), ['VIN', 'Combustible', 'Cilindrada', 'Asientos', 'Placa anterior']);
  assert.equal(specs[0].value, 'JSAJ1234');
  assert.equal(normalizeSpaces(specs[2].value), '2,393 cc');
  assert.equal(specs[4].value, 'ABC-123');
});

test('el vehículo por defecto es el primero activo', () => {
  assert.equal(defaultCarId([{ id: 3, status: 'archived' }, { id: 5, status: 'active' }]), 5);
  assert.equal(defaultCarId([{ id: 3, status: 'archived' }]), 3);
  assert.equal(defaultCarId([]), null);
});

test('avisa el cambio de aceite 500 km antes y cuando ya pasó', () => {
  assert.deepEqual(oilChangeStatus(90_000, 95_000), { tone: 'ok', remainingKm: 5000 });
  assert.deepEqual(oilChangeStatus(94_500, 95_000), { tone: 'soon', remainingKm: 500 });
  assert.deepEqual(oilChangeStatus(95_200, 95_000), { tone: 'overdue', remainingKm: -200 });
  assert.deepEqual(oilChangeStatus(null, 95_000), { tone: 'unknown', remainingKm: null });
  assert.deepEqual(oilChangeStatus(90_000, null), { tone: 'unknown', remainingKm: null });
  assert.equal(normalizeSpaces(oilChangeHint({ tone: 'soon', remainingKm: 300 })), 'Faltan 300 km');
  assert.equal(normalizeSpaces(oilChangeHint({ tone: 'overdue', remainingKm: -200 })), 'Vencido por 200 km');
});

test('la barra de aceite avanza desde el último cambio hasta el próximo', () => {
  assert.equal(oilChangeProgress(92_500, 90_000, 95_000), 0.5);
  assert.equal(oilChangeProgress(96_000, 90_000, 95_000), 1);
  assert.equal(oilChangeProgress(91_000, null, 95_000, 5000), 0.2);
  assert.equal(oilChangeProgress(null, 90_000, 95_000), null);
  assert.equal(oilChangeProgress(91_000, null, 95_000, null), null);
});

test('sugiere el próximo cambio de aceite con el intervalo del vehículo', () => {
  assert.equal(suggestNextOilChangeMileage('120000', 5000), 125000);
  assert.equal(suggestNextOilChangeMileage('', 5000), null);
  assert.equal(suggestNextOilChangeMileage('120000', null), null);
  assert.equal(suggestNextOilChangeMileage('12a', 5000), null);
});

test('al escribir el kilometraje de un cambio de aceite se propone el próximo', () => {
  const start = emptyExpenseForm('2026-11-20', 'oil_change');
  assert.equal(start.title, 'Aceite');
  const typed = applyExpenseFormChange(start, { mileage: '120000' }, 5000);
  assert.equal(typed.nextServiceMileage, '125000');
  const corrected = applyExpenseFormChange(typed, { mileage: '120500' }, 5000);
  assert.equal(corrected.nextServiceMileage, '125500');
  const manual = applyExpenseFormChange(corrected, { nextServiceMileage: '126000' }, 5000);
  const kept = applyExpenseFormChange(manual, { mileage: '121000' }, 5000);
  assert.equal(kept.nextServiceMileage, '126000');
});

test('cambiar de categoría reemplaza el concepto por defecto, no el escrito', () => {
  const start = emptyExpenseForm('2026-11-20');
  assert.equal(start.category, 'fuel');
  assert.equal(start.title, 'Combustible');
  const oil = applyExpenseFormChange({ ...start, mileage: '120000' }, { category: 'oil_change' }, 5000);
  assert.equal(oil.title, 'Aceite');
  assert.equal(oil.nextServiceMileage, '125000');
  const custom = { ...start, title: 'Aceite Mobil 5W-30' };
  assert.equal(applyExpenseFormChange(custom, { category: 'brakes' }, 5000).title, 'Aceite Mobil 5W-30');
});

test('una lectura de kilometraje no pide monto pero sí km', () => {
  const form = { ...emptyExpenseForm('2026-11-20', 'mileage'), amount: '' };
  assert.match(expensePayloadFromForm(form).error, /kilometraje/);
  const { payload } = expensePayloadFromForm({ ...form, mileage: '121500', amount: '99' });
  assert.equal(payload.amount, 0);
  assert.equal(payload.mileage, 121500);
  assert.equal(payload.title, 'Kilometraje');
  assert.equal(formatExpenseAmount({ category: 'mileage', amount: 0 }), '—');
  assert.match(normalizeSpaces(formatExpenseAmount({ category: 'fuel', amount: 50 })), /^S\/ 50\.00$/);
});

test('valida y arma el gasto para el API', () => {
  const form = { ...emptyExpenseForm('2026-11-20', 'oil_change'), amount: '185,50', mileage: '120000', nextServiceMileage: '125000', vendor: '  Taller Lima ' };
  assert.deepEqual(expensePayloadFromForm(form).payload, {
    category: 'oil_change',
    title: 'Aceite',
    amount: 185.5,
    occurredOn: '2026-11-20',
    mileage: 120000,
    vendor: 'Taller Lima',
    nextServiceMileage: 125000,
    nextServiceDate: null,
    notes: null,
  });
  assert.match(expensePayloadFromForm({ ...form, amount: '0' }).error, /monto/);
  assert.match(expensePayloadFromForm({ ...form, mileage: '12.5' }).error, /kilometraje/);
  assert.match(expensePayloadFromForm({ ...form, nextServiceMileage: '119000' }).error, /mayor/);
});

test('el combustible no envía próximo servicio aunque quede en el formulario', () => {
  const form = { ...emptyExpenseForm('2026-11-20', 'fuel'), amount: '120', nextServiceMileage: '9999', nextServiceDate: '2027-01-01' };
  const { payload } = expensePayloadFromForm(form);
  assert.equal(payload.title, 'Combustible');
  assert.equal(payload.nextServiceMileage, null);
  assert.equal(payload.nextServiceDate, null);
});

test('editar un gasto conserva sus datos', () => {
  const form = expenseFormFromExpense({
    id: 1, carId: 1, category: 'brakes', title: 'Frenos', amount: 320, occurredOn: '2026-10-02',
    mileage: 118000, vendor: null, nextServiceMileage: null, nextServiceDate: null, notes: 'Pastillas',
  });
  assert.equal(form.category, 'brakes');
  assert.equal(form.amount, '320');
  assert.equal(form.mileage, '118000');
  assert.equal(form.vendor, '');
  assert.equal(form.notes, 'Pastillas');
});

test('montos aceptan coma o punto y hasta dos decimales', () => {
  assert.equal(parseAmount('S/ 45.9'), 45.9);
  assert.equal(parseAmount('45,90'), 45.9);
  assert.equal(parseAmount('45.999'), null);
  assert.equal(parseAmount('-3'), null);
});

test('valida los datos del vehículo', () => {
  const base = {
    ...EMPTY_CAR_FORM,
    name: 'Grand Vitara', brand: 'Suzuki', model: 'Grand Vitara', version: '3 puertas', year: '2012',
    plate: 'abc-123', currentMileage: '120000', oilChangeIntervalKm: '5000',
    engineNumber: 'j24b-123', seats: '5', previousPlate: '', vehicleCategory: 'm1',
  };
  const { payload } = carPayloadFromForm(base, 2026);
  assert.equal(payload.plate, 'ABC-123');
  assert.equal(payload.year, 2012);
  assert.equal(payload.color, null);
  assert.equal(payload.oilChangeIntervalKm, 5000);
  assert.equal(payload.engineNumber, 'J24B-123');
  assert.equal(payload.seats, 5);
  assert.equal(payload.previousPlate, null);
  assert.equal(payload.vehicleCategory, 'M1');
  assert.match(carPayloadFromForm({ ...base, seats: 'cinco' }, 2026).error, /asientos/);
  assert.match(carPayloadFromForm({ ...base, name: ' ' }, 2026).error, /nombre/);
  assert.match(carPayloadFromForm({ ...base, year: '2030' }, 2026).error, /año/);
  assert.match(carPayloadFromForm({ ...base, oilChangeIntervalKm: '0' }, 2026).error, /intervalo/);
});
