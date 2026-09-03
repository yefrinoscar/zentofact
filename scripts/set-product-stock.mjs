import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import pg from 'pg';
import { adjustInventory } from '../packages/server/src/catalog/inventory-service.js';

config({ path: resolve('.env') });

const { values } = parseArgs({
  options: {
    sku: { type: 'string' },
    target: { type: 'string' },
    reason: { type: 'string' },
    key: { type: 'string' },
    apply: { type: 'boolean', default: false },
  },
});

const sku = String(values.sku || '').trim().toUpperCase();
const target = Number(values.target);
const reason = String(values.reason || '').trim();
const idempotencyKey = String(values.key || `stock-alignment:${sku.toLowerCase()}:${target}`).trim();
if (!sku) throw new Error('Indica el producto con --sku.');
if (!Number.isFinite(target) || target < 0) throw new Error('Indica un saldo no negativo con --target.');
if (!reason) throw new Error('Indica el motivo con --reason.');

const connectionString = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL_POSTGRES;
if (!connectionString) throw new Error('Falta DATABASE_PUBLIC_URL o DATABASE_URL_POSTGRES.');

const pool = new pg.Pool({ connectionString });
const client = await pool.connect();

async function readState() {
  const result = await client.query(
    `select p.id,p.main_sku,p.name,i.quantity_on_hand,i.quantity_reserved,
       (select count(*)::int from inventory_movements m where m.product_id=p.id) as movement_count,
       latest.movement_type as latest_movement_type,
       latest.quantity_delta as latest_quantity_delta,
       latest.quantity_after as latest_quantity_after,
       latest.reason as latest_reason,
       latest.idempotency_key as latest_idempotency_key
     from products p
     join product_inventory i on i.product_id=p.id
     left join lateral (
       select m.movement_type,m.quantity_delta,m.quantity_after,m.reason,m.idempotency_key
       from inventory_movements m
       where m.product_id=p.id
       order by m.created_at desc,m.id desc
       limit 1
     ) latest on true
     where upper(p.main_sku)=$1`,
    [sku],
  );
  if (result.rowCount !== 1) throw new Error(`Se esperaba un producto ${sku}; se encontraron ${result.rowCount}.`);
  return result.rows[0];
}

try {
  const before = await readState();
  const delta = target - Number(before.quantity_on_hand);
  let result = { applied: false, noChange: delta === 0, quantityOnHand: Number(before.quantity_on_hand) };

  if (values.apply && delta !== 0) {
    await client.query('begin');
    try {
      result = await adjustInventory(before.id, {
        absoluteTarget: target,
        reason,
        idempotencyKey,
        allowNegative: false,
      }, null, client);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  }

  const after = await readState();
  const expectedMovementCount = Number(before.movement_count) + (values.apply && delta !== 0 ? 1 : 0);
  const verified = Number(after.quantity_on_hand) === (values.apply ? target : Number(before.quantity_on_hand))
    && Number(after.quantity_reserved) === Number(before.quantity_reserved)
    && Number(after.movement_count) === expectedMovementCount;
  if (!verified) throw new Error(`La verificación final de ${sku} falló.`);

  console.log(JSON.stringify({
    applied: values.apply && result.applied === true,
    noChange: delta === 0,
    productId: Number(before.id),
    sku: after.main_sku,
    previousStock: Number(before.quantity_on_hand),
    targetStock: target,
    currentStock: Number(after.quantity_on_hand),
    reserved: Number(after.quantity_reserved),
    delta,
    movementsBefore: Number(before.movement_count),
    movementsAfter: Number(after.movement_count),
    latestMovement: {
      type: after.latest_movement_type,
      quantityDelta: after.latest_quantity_delta == null ? null : Number(after.latest_quantity_delta),
      quantityAfter: after.latest_quantity_after == null ? null : Number(after.latest_quantity_after),
      reason: after.latest_reason,
      idempotencyKey: after.latest_idempotency_key,
    },
    verified,
  }));
} finally {
  client.release();
  await pool.end();
}
