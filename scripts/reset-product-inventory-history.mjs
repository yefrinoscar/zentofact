import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import pg from 'pg';

config({ path: resolve('.env') });

const { values } = parseArgs({
  options: {
    sku: { type: 'string' },
    target: { type: 'string' },
    key: { type: 'string' },
    reason: { type: 'string' },
    apply: { type: 'boolean', default: false },
  },
});

const sku = String(values.sku || '').trim().toUpperCase();
const target = Number(values.target);
const reason = String(values.reason || '').trim();
const runKey = String(values.key || `manual-history-reset:${sku.toLowerCase()}:${target}`).trim();
if (!sku) throw new Error('Indica el producto con --sku.');
if (!Number.isFinite(target) || target < 0) throw new Error('Indica un saldo no negativo con --target.');
if (!reason) throw new Error('Indica el motivo con --reason.');

const connectionString = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL_POSTGRES;
if (!connectionString) throw new Error('Falta DATABASE_PUBLIC_URL o DATABASE_URL_POSTGRES.');

const sourceHash = createHash('sha256').update(`source:${runKey}`).digest('hex');
const planHash = createHash('sha256').update(`plan:${runKey}:${sku}:${target}`).digest('hex');
const pool = new pg.Pool({ connectionString });
const client = await pool.connect();

async function readState({ lock = false } = {}) {
  const result = await client.query(
    `select p.id,p.main_sku,p.name,i.quantity_on_hand,i.quantity_reserved,
       (select count(*)::int from inventory_movements m where m.product_id=p.id) as movement_count,
       anchor.run_id as reset_run_id,
       anchor.target_quantity as reset_target_quantity
     from products p
     join product_inventory i on i.product_id=p.id
     left join lateral (
       select a.run_id,a.target_quantity
       from inventory_reconciliation_anchors a
       join inventory_reconciliation_runs r on r.id=a.run_id
       where a.product_id=p.id and r.run_key=$2
       limit 1
     ) anchor on true
     where upper(p.main_sku)=$1
     ${lock ? 'for update of i' : ''}`,
    [sku, runKey],
  );
  if (result.rowCount !== 1) throw new Error(`Se esperaba un producto ${sku}; se encontraron ${result.rowCount}.`);
  return result.rows[0];
}

try {
  let before = await readState();
  let deletedMovements = 0;
  let action = before.reset_run_id ? 'already_reset' : values.apply ? 'reset' : 'would_reset';

  if (values.apply && !before.reset_run_id) {
    await client.query('begin');
    try {
      await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`inventory-history-reset:${sku}`]);
      before = await readState({ lock: true });
      if (Number(before.quantity_reserved) > target) {
        throw new Error(`${sku} tiene ${before.quantity_reserved} unidades reservadas y no puede quedar en ${target}.`);
      }

      const existingRun = await client.query(
        'select id from inventory_reconciliation_runs where run_key=$1 for update',
        [runKey],
      );
      if (existingRun.rowCount) {
        action = 'already_reset';
      } else {
        const deleted = await client.query(
          'delete from inventory_movements where product_id=$1',
          [before.id],
        );
        deletedMovements = deleted.rowCount;
        await client.query(
          'update product_inventory set quantity_on_hand=$1,updated_at=now() where product_id=$2',
          [target, before.id],
        );
        const run = await client.query(
          `insert into inventory_reconciliation_runs
           (run_key,plan_hash,reconciliation_kind,source_hash,cutoff_at,as_of,summary)
           values ($1,$2,'manual_inventory_history_reset',$3,now(),now(),$4::jsonb)
           returning id`,
          [runKey, planHash, sourceHash, JSON.stringify({
            sku,
            reason,
            previousStock: Number(before.quantity_on_hand),
            targetStock: target,
            deletedMovements,
          })],
        );
        await client.query(
          `insert into inventory_reconciliation_anchors
           (run_id,product_id,cutoff_quantity,target_quantity)
           values ($1,$2,$3,$3)`,
          [run.rows[0].id, before.id, target],
        );
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  }

  const after = await readState();
  const shouldBeReset = values.apply || Boolean(before.reset_run_id);
  const verified = Number(after.quantity_on_hand) === (shouldBeReset ? target : Number(before.quantity_on_hand))
    && Number(after.quantity_reserved) === Number(before.quantity_reserved)
    && (!shouldBeReset || (Number(after.movement_count) === 0 && Number(after.reset_target_quantity) === target));
  if (!verified) throw new Error(`La verificación final de ${sku} falló.`);

  console.log(JSON.stringify({
    applied: values.apply && action === 'reset',
    action,
    productId: Number(after.id),
    sku: after.main_sku,
    previousStock: Number(before.quantity_on_hand),
    targetStock: target,
    currentStock: Number(after.quantity_on_hand),
    reserved: Number(after.quantity_reserved),
    movementsBefore: Number(before.movement_count),
    deletedMovements,
    movementsAfter: Number(after.movement_count),
    resetRunId: after.reset_run_id == null ? null : Number(after.reset_run_id),
    verified,
  }));
} finally {
  client.release();
  await pool.end();
}
