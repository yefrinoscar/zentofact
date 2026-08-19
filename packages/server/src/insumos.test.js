import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adjustInsumo,
  createInsumo,
  DEFAULT_INSUMOS,
  listInsumoMovements,
  listInsumos,
  mapInsumo,
  quantityCapFor,
  slugifyInsumoName,
  updateInsumo,
} from './insumos.js';

function seedRow(overrides = {}) {
  return {
    id: 1,
    code: 'cinta-fill',
    name: 'Fill grande',
    unit: 'rollos',
    icon_key: 'cinta-fill',
    quantity_on_hand: 4,
    reorder_point: 2,
    status: 'active',
    created_at: '2026-08-19T10:00:00.000Z',
    updated_at: '2026-08-19T10:00:00.000Z',
    created_by: null,
    updated_by: null,
    ...overrides,
  };
}

const CHANGE_PIN = '2324';

class InsumosDb {
  constructor(rows = []) {
    this.rows = rows.map((row) => ({ ...row }));
    this.movements = [];
    this.users = [];
    this.nextId = this.rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1;
    this.nextMovementId = 1;
  }

  async query(sql, params = []) {
    const compact = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (compact.includes('from insumos i') && compact.includes('total_count')) {
      const status = params[0];
      const search = String(params[1] || '').toLowerCase();
      const lowStockOnly = params[2] === true;
      const limit = Number(params[3]);
      const offset = Number(params[4]);
      let matches = this.rows.filter((row) => row.status === status);
      if (search) {
        matches = matches.filter((row) => (
          row.name.toLowerCase().includes(search) || row.code.toLowerCase().includes(search)
        ));
      }
      if (lowStockOnly) {
        matches = matches.filter((row) => (
          row.reorder_point != null && Number(row.quantity_on_hand) <= Number(row.reorder_point)
        ));
      }
      const desc = /order by [^ ]+ desc/.test(compact);
      if (compact.includes('order by i.quantity_on_hand')) {
        matches.sort((left, right) => Number(left.quantity_on_hand) - Number(right.quantity_on_hand));
      } else {
        matches.sort((left, right) => String(left.name).localeCompare(String(right.name), 'es'));
      }
      if (desc) matches.reverse();
      const lowStockCount = matches.filter((row) => (
        row.reorder_point != null && Number(row.quantity_on_hand) <= Number(row.reorder_point)
      )).length;
      const page = matches.slice(offset, offset + limit).map((row) => ({
        ...row,
        total_count: matches.length,
        low_stock_count: lowStockCount,
      }));
      return { rows: page };
    }

    if (compact.startsWith('select id from insumos where lower(name)')) {
      const name = String(params[0]).toLowerCase();
      const status = params[1];
      const excludeId = params[2] == null ? null : Number(params[2]);
      const match = this.rows.find((row) => (
        row.name.toLowerCase() === name
        && row.status === status
        && (excludeId == null || Number(row.id) !== excludeId)
      ));
      return { rows: match ? [{ id: match.id }] : [] };
    }

    if (compact.startsWith('select code from insumos where code')) {
      const exact = params[0];
      const prefix = String(params[1]).replace(/%/g, '');
      return {
        rows: this.rows
          .filter((row) => row.code === exact || row.code.startsWith(prefix))
          .map((row) => ({ code: row.code })),
      };
    }

    if (compact.startsWith('insert into insumos (code, name, unit, icon_key')) {
      const row = seedRow({
        id: this.nextId++,
        code: params[0],
        name: params[1],
        unit: params[2],
        icon_key: params[3],
        quantity_on_hand: params[4],
        reorder_point: params[5],
        created_by: params[6],
        updated_by: params[6],
      });
      this.rows.push(row);
      return { rows: [{ ...row }] };
    }

    if (compact.startsWith('select * from insumos where id=$1 for update')) {
      const row = this.rows.find((item) => Number(item.id) === Number(params[0]));
      return { rows: row ? [{ ...row }] : [] };
    }

    if (compact.startsWith('update insumos set quantity_on_hand')) {
      const row = this.rows.find((item) => Number(item.id) === Number(params[2]));
      if (!row) return { rows: [] };
      row.quantity_on_hand = Number(params[0]);
      row.updated_by = params[1];
      row.updated_at = '2026-08-19T12:00:00.000Z';
      return { rows: [{ ...row }] };
    }

    if (compact.startsWith('update insumos set name=$1')) {
      const row = this.rows.find((item) => Number(item.id) === Number(params[6]));
      if (!row) return { rows: [] };
      row.name = params[0];
      row.unit = params[1];
      row.icon_key = params[2];
      row.reorder_point = params[3];
      row.status = params[4];
      row.updated_by = params[5];
      row.updated_at = '2026-08-19T12:00:00.000Z';
      return { rows: [{ ...row }] };
    }

    if (compact.startsWith('insert into insumo_movements')) {
      this.movements.push({
        id: this.nextMovementId++,
        insumo_id: params[0],
        quantity_delta: params[1],
        quantity_after: params[2],
        note: params[3],
        actor_user_id: params[4],
        actor_name: params[5],
        created_at: '2026-08-19T12:00:00.000Z',
      });
      return { rows: [] };
    }

    if (compact.includes('from insumo_movements')) {
      const insumoId = params[0] == null ? null : Number(params[0]);
      const limit = Number(params[1]);
      const offset = Number(params[2]);
      let matches = this.movements.map((movement) => {
        const insumo = this.rows.find((row) => Number(row.id) === Number(movement.insumo_id));
        return {
          ...movement,
          insumo_name: insumo?.name,
          insumo_code: insumo?.code,
        };
      });
      if (insumoId != null) {
        matches = matches.filter((item) => Number(item.insumo_id) === insumoId);
      }
      matches.sort((left, right) => Number(right.id) - Number(left.id));
      return {
        rows: matches.slice(offset, offset + limit).map((item) => ({
          ...item,
          total_count: matches.length,
        })),
      };
    }

    if (compact.includes('from "user"')) {
      const user = this.users.find((item) => item.id === params[0]);
      return { rows: user ? [{ name: user.name }] : [] };
    }

    throw new Error(`Query no simulada: ${compact}`);
  }
}

test('el catálogo inicial cubre los insumos de empaque y oficina', () => {
  assert.deepEqual(DEFAULT_INSUMOS.map((item) => item.code), [
    'cinta-fill', 'fill-pequeno', 'cinta-scotch',
  ]);
  assert.equal(slugifyInsumoName('Fill grande'), 'fill-grande');
  assert.equal(slugifyInsumoName('Fill pequeño'), 'fill-pequeno');
  assert.equal(slugifyInsumoName('Cinta scotch'), 'cinta-scotch');
});

test('lista cantidades y marca cuándo hay que reponer', async () => {
  const db = new InsumosDb([
    seedRow({ id: 1, quantity_on_hand: 1, reorder_point: 2 }),
    seedRow({
      id: 2, code: 'cinta-scotch', name: 'Cinta scotch', unit: 'rollos', icon_key: 'cinta-scotch',
      quantity_on_hand: 8, reorder_point: 3,
    }),
  ]);
  const result = await listInsumos({}, db);
  assert.equal(result.totalCount, 2);
  assert.equal(result.items[0].name, 'Cinta scotch');
  assert.equal(result.items[0].lowStock, false);
  assert.equal(result.items[1].name, 'Fill grande');
  assert.equal(result.items[1].lowStock, true);
  assert.equal(result.lowStockCount, 1);
});

test('filtra por búsqueda y por reposición', async () => {
  const db = new InsumosDb([
    seedRow({ id: 1, quantity_on_hand: 1, reorder_point: 2 }),
    seedRow({
      id: 2, code: 'cinta-scotch', name: 'Cinta scotch', icon_key: 'cinta-scotch',
      quantity_on_hand: 8, reorder_point: 3,
    }),
  ]);
  const search = await listInsumos({ search: 'scotch' }, db);
  assert.equal(search.totalCount, 1);
  assert.equal(search.items[0].name, 'Cinta scotch');
  const restock = await listInsumos({ stock: 'low' }, db);
  assert.equal(restock.totalCount, 1);
  assert.equal(restock.items[0].code, 'cinta-fill');
});

test('fijar saldo actualiza la cantidad y deja movimiento', async () => {
  const db = new InsumosDb([seedRow({ quantity_on_hand: 4 })]);
  const result = await adjustInsumo(1, { absoluteTarget: 12, note: 'Conteo', pin: CHANGE_PIN }, 'user-1', db);
  assert.equal(result.applied, true);
  assert.equal(result.insumo.quantityOnHand, 12);
  assert.equal(db.movements.length, 1);
  assert.equal(db.movements[0].quantity_delta, 8);
  assert.equal(db.movements[0].note, 'Conteo');
});

test('sumar o restar cambia el saldo actual', async () => {
  const db = new InsumosDb([seedRow({ quantity_on_hand: 4 })]);
  const result = await adjustInsumo(1, { delta: -1, pin: CHANGE_PIN }, 'user-1', db);
  assert.equal(result.insumo.quantityOnHand, 3);
  assert.equal(db.movements[0].quantity_delta, -1);
});

test('no deja la cantidad en negativo', async () => {
  const db = new InsumosDb([seedRow({ quantity_on_hand: 2 })]);
  await assert.rejects(
    () => adjustInsumo(1, { delta: -5, pin: CHANGE_PIN }, 'user-1', db),
    /no puede quedar negativa/,
  );
  assert.equal(db.rows[0].quantity_on_hand, 2);
  assert.equal(db.movements.length, 0);
});

test('un ajuste sin cambio no escribe movimiento', async () => {
  const db = new InsumosDb([seedRow({ quantity_on_hand: 4 })]);
  const result = await adjustInsumo(1, { absoluteTarget: 4, pin: CHANGE_PIN }, 'user-1', db);
  assert.equal(result.applied, false);
  assert.equal(result.noChange, true);
  assert.equal(db.movements.length, 0);
});

test('crea un insumo nuevo con código a partir del nombre', async () => {
  const db = new InsumosDb([seedRow()]);
  const created = await createInsumo({
    name: 'Plástico burbuja',
    unit: 'rollos',
    iconKey: 'generic',
    quantityOnHand: 6,
    reorderPoint: 2,
    pin: CHANGE_PIN,
  }, 'user-1', db);
  assert.equal(created.code, 'plastico-burbuja');
  assert.equal(created.quantityOnHand, 6);
  assert.equal(created.lowStock, false);
});

test('rechaza un insumo duplicado', async () => {
  const db = new InsumosDb([seedRow()]);
  await assert.rejects(
    () => createInsumo({ name: 'fill grande', unit: 'rollos', pin: CHANGE_PIN }, 'user-1', db),
    /Ya existe un insumo/,
  );
});

test('actualiza unidad y punto de reposición', async () => {
  const db = new InsumosDb([seedRow()]);
  const updated = await updateInsumo(1, { unit: 'kg', reorderPoint: 5, pin: CHANGE_PIN }, 'user-1', db);
  assert.equal(updated.unit, 'kg');
  assert.equal(updated.reorderPoint, 5);
  assert.equal(updated.lowStock, true);
});

test('mapInsumo calcula reposición con el saldo actual', () => {
  assert.equal(mapInsumo(seedRow({ quantity_on_hand: 2, reorder_point: 2 })).lowStock, true);
  assert.equal(mapInsumo(seedRow({ quantity_on_hand: 3, reorder_point: 2 })).lowStock, false);
  assert.equal(mapInsumo(seedRow({ quantity_on_hand: 0, reorder_point: null })).lowStock, false);
});

test('el tope es 36 para cinta y 16 para cada fill', () => {
  assert.equal(quantityCapFor({ code: 'cinta-scotch', name: 'Cinta scotch', icon_key: 'cinta-scotch' }), 36);
  assert.equal(quantityCapFor({ code: 'cinta-fill', name: 'Fill grande', icon_key: 'cinta-fill' }), 16);
  assert.equal(quantityCapFor({ code: 'fill-pequeno', name: 'Fill pequeño', icon_key: 'fill-pequeno' }), 16);
  assert.equal(mapInsumo(seedRow()).quantityCap, 16);
  assert.equal(mapInsumo(seedRow({
    code: 'cinta-scotch', name: 'Cinta scotch', icon_key: 'cinta-scotch',
  })).quantityCap, 36);
});

test('un ajuste exige el PIN 2324', async () => {
  const db = new InsumosDb([seedRow({ quantity_on_hand: 4 })]);
  await assert.rejects(() => adjustInsumo(1, { delta: 1 }, 'user-1', db), /PIN incorrecto/);
  await assert.rejects(
    () => adjustInsumo(1, { delta: 1, pin: '0000' }, 'user-1', db),
    /PIN incorrecto/,
  );
  assert.equal(db.rows[0].quantity_on_hand, 4);
  assert.equal(db.movements.length, 0);
});

test('crear o actualizar un insumo también exige el PIN', async () => {
  const db = new InsumosDb([seedRow()]);
  await assert.rejects(
    () => createInsumo({ name: 'Plástico burbuja', unit: 'rollos' }, 'user-1', db),
    /PIN incorrecto/,
  );
  await assert.rejects(
    () => updateInsumo(1, { unit: 'kg' }, 'user-1', db),
    /PIN incorrecto/,
  );
});

test('la cinta no puede pasar de 36', async () => {
  const db = new InsumosDb([seedRow({
    code: 'cinta-scotch', name: 'Cinta scotch', icon_key: 'cinta-scotch', quantity_on_hand: 36,
  })]);
  await assert.rejects(
    () => adjustInsumo(1, { delta: 1, pin: CHANGE_PIN }, 'user-1', db),
    /Cinta scotch no puede pasar de 36/,
  );
  const atCap = await adjustInsumo(1, { absoluteTarget: 36, pin: CHANGE_PIN }, 'user-1', db);
  assert.equal(atCap.noChange, true);
});

test('cada fill no puede pasar de 16', async () => {
  const grande = new InsumosDb([seedRow({ quantity_on_hand: 16 })]);
  await assert.rejects(
    () => adjustInsumo(1, { delta: 1, pin: CHANGE_PIN }, 'user-1', grande),
    /Fill grande no puede pasar de 16/,
  );
  const pequeno = new InsumosDb([seedRow({
    id: 1, code: 'fill-pequeno', name: 'Fill pequeño', icon_key: 'fill-pequeno', quantity_on_hand: 15,
  })]);
  await assert.rejects(
    () => adjustInsumo(1, { absoluteTarget: 17, pin: CHANGE_PIN }, 'user-1', pequeno),
    /Fill pequeño no puede pasar de 16/,
  );
  const ok = await adjustInsumo(1, { absoluteTarget: 16, pin: CHANGE_PIN }, 'user-1', pequeno);
  assert.equal(ok.insumo.quantityOnHand, 16);
});

test('el movimiento guarda quién lo hizo y a qué hora', async () => {
  const db = new InsumosDb([seedRow({ quantity_on_hand: 4 })]);
  await adjustInsumo(1, { delta: 2, pin: CHANGE_PIN }, { id: 'user-1', name: 'Ana Rojas' }, db);
  assert.equal(db.movements[0].actor_user_id, 'user-1');
  assert.equal(db.movements[0].actor_name, 'Ana Rojas');
  assert.equal(db.movements[0].created_at, '2026-08-19T12:00:00.000Z');
  const listed = await listInsumoMovements({}, db);
  assert.equal(listed.totalCount, 1);
  assert.equal(listed.items[0].insumoName, 'Fill grande');
  assert.equal(listed.items[0].quantityDelta, 2);
  assert.equal(listed.items[0].quantityAfter, 6);
  assert.equal(listed.items[0].actorName, 'Ana Rojas');
  assert.equal(listed.items[0].createdAt, '2026-08-19T12:00:00.000Z');
});
