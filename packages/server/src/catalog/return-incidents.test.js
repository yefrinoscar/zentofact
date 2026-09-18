import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearReturnIncident,
  normalizeReturnCondition,
  setReturnIncident,
} from './return-incidents.js';

class IncidentDb {
  constructor({ quantity = 10, restocked = 2 } = {}) {
    this.quantity = quantity;
    this.reserved = 0;
    this.pendingReturn = 0;
    this.restocked = restocked;
    this.incidents = new Map();
    this.movements = new Map();
    this.nextMovementId = 1;
    this.nextIncidentId = 1;
    this.lastUpdate = null;
  }

  incidentKey(productId, orderId) {
    return `${productId}:${orderId}`;
  }

  async query(sql, params = []) {
    const compact = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (compact.includes('from orders o') && compact.includes('return_stock_approvals rsa')) {
      return {
        rows: [{
          external_order_number: '3249612124',
          restocked_quantity: this.restocked,
        }],
      };
    }
    if (compact.includes('from product_return_incidents') && compact.startsWith('select id,')) {
      const row = this.incidents.get(this.incidentKey(params[0], params[1]));
      return { rows: row ? [{ ...row }] : [] };
    }
    if (compact.startsWith('insert into product_inventory')) return { rows: [] };
    if (compact.startsWith('select quantity_on_hand, quantity_reserved')) {
      return {
        rows: [{
          quantity_on_hand: this.quantity,
          quantity_reserved: this.reserved,
          quantity_pending_return: this.pendingReturn,
        }],
      };
    }
    if (compact.startsWith('select * from inventory_movements where idempotency_key')) {
      const row = this.movements.get(params[0]);
      return { rows: row ? [row] : [] };
    }
    if (compact.startsWith('insert into inventory_movements')) {
      const key = params[10];
      if (this.movements.has(key)) return { rows: [] };
      const row = {
        id: this.nextMovementId++,
        product_id: params[0],
        movement_type: params[1],
        quantity_delta: params[2],
        quantity_after: params[3],
        reason: params[4],
        actor_user_id: params[5],
        source: params[6],
        order_id: params[7],
        order_item_id: params[8],
        listing_id: params[9],
        idempotency_key: key,
        metadata: JSON.parse(params[11]),
        created_at: new Date().toISOString(),
      };
      this.movements.set(key, row);
      return { rows: [row] };
    }
    if (compact.startsWith('update product_inventory set quantity_on_hand')) {
      this.quantity = Number(params[0]);
      return { rows: [] };
    }
    if (compact.startsWith('insert into product_return_incidents')) {
      const key = this.incidentKey(params[0], params[1]);
      if (this.incidents.has(key)) return { rows: [] };
      const row = {
        id: this.nextIncidentId++,
        product_id: params[0],
        order_id: params[1],
        condition: params[2],
        quantity: Number(params[3]),
        revision: 1,
        actor_user_id: params[4],
      };
      this.incidents.set(key, row);
      return { rows: [{ id: row.id }] };
    }
    if (compact.startsWith('update product_return_incidents')) {
      const row = [...this.incidents.values()].find((item) => item.id === Number(params[4]));
      if (row) {
        row.condition = params[0];
        row.quantity = Number(params[1]);
        row.revision = Number(params[2]);
        row.actor_user_id = params[3];
      }
      this.lastUpdate = { params, sql: compact };
      return { rows: [] };
    }
    if (compact.startsWith('delete from product_return_incidents')) {
      for (const [key, row] of this.incidents.entries()) {
        if (row.id === Number(params[0])) this.incidents.delete(key);
      }
      return { rows: [] };
    }
    throw new Error(`Query no simulada: ${compact}`);
  }
}

test('normalizeReturnCondition acepta solo los dos motivos', () => {
  assert.equal(normalizeReturnCondition('not_arrived'), 'not_arrived');
  assert.equal(normalizeReturnCondition('UNUSABLE'), 'unusable');
  assert.throws(() => normalizeReturnCondition('otro'), /condition inválida/);
});

test('marcar una devolución como no recibida da de baja las unidades reintegradas', async () => {
  const db = new IncidentDb({ quantity: 10, restocked: 2 });
  const result = await setReturnIncident(5, 20, 'not_arrived', 'user-1', db);

  assert.equal(result.condition, 'not_arrived');
  assert.equal(result.quantity, 2);
  assert.equal(db.quantity, 8);
  const movement = db.movements.get('return-incident:product:5:order:20:out:create');
  assert.equal(movement.quantity_delta, -2);
  assert.equal(movement.movement_type, 'adjustment_out');
  assert.equal(movement.reason, 'Devolución no recibida · pedido 3249612124');
  assert.equal(db.incidents.get('5:20').condition, 'not_arrived');
});

test('reintentar la misma marca no vuelve a descontar stock', async () => {
  const db = new IncidentDb({ quantity: 10, restocked: 2 });
  await setReturnIncident(5, 20, 'not_arrived', 'user-1', db);
  const again = await setReturnIncident(5, 20, 'not_arrived', 'user-1', db);
  assert.equal(again.applied, false);
  assert.equal(db.quantity, 8);
  assert.equal(db.movements.size, 1);
});

test('cambiar de no recibida a inusable conserva el descuento y el motivo', async () => {
  const db = new IncidentDb({ quantity: 10, restocked: 2 });
  await setReturnIncident(5, 20, 'not_arrived', 'user-1', db);
  const changed = await setReturnIncident(5, 20, 'unusable', 'user-1', db);
  assert.equal(changed.condition, 'unusable');
  assert.equal(changed.applied, false);
  assert.equal(db.quantity, 8);
  assert.equal(db.movements.size, 1);
  assert.equal(db.incidents.get('5:20').condition, 'unusable');
});

test('quitar la incidencia devuelve las unidades al stock vendible', async () => {
  const db = new IncidentDb({ quantity: 10, restocked: 2 });
  await setReturnIncident(5, 20, 'unusable', 'user-1', db);
  const cleared = await clearReturnIncident(5, 20, 'user-1', db);
  assert.equal(cleared.cleared, true);
  assert.equal(cleared.quantity, 2);
  assert.equal(db.quantity, 10);
  assert.equal(db.incidents.size, 0);
  const restore = [...db.movements.values()].find((row) => row.movement_type === 'adjustment_in');
  assert.equal(restore.quantity_delta, 2);
});

test('quitar una incidencia inexistente no hace nada', async () => {
  const db = new IncidentDb({ quantity: 10, restocked: 2 });
  const cleared = await clearReturnIncident(5, 20, 'user-1', db);
  assert.equal(cleared.cleared, false);
  assert.equal(db.movements.size, 0);
});

test('rechaza marcar una devolución sin stock reintegrado', async () => {
  const db = new IncidentDb({ quantity: 10, restocked: 0 });
  await assert.rejects(
    () => setReturnIncident(5, 20, 'not_arrived', 'user-1', db),
    /no tiene stock reintegrado/,
  );
  assert.equal(db.movements.size, 0);
});

test('rechaza un motivo inválido', async () => {
  const db = new IncidentDb({ quantity: 10, restocked: 2 });
  await assert.rejects(
    () => setReturnIncident(5, 20, 'roto', 'user-1', db),
    /condition inválida/,
  );
});
