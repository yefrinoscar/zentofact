import { loadCore } from './utils.js';

export const INVENTORY_LISTEN_RESET_KEY = 'inventory_listen_reset_v1';

const log = (...args) => console.log('[stock-listen-reset]', ...args);

async function target(db) {
  return db || (await loadCore()).pool;
}

function isPool(source) {
  return typeof source?.connect === 'function' && typeof source?.totalCount === 'number';
}

export async function resetInventoryListenHistory(db) {
  const source = await target(db);
  const ownsConnection = isPool(source);
  const client = ownsConnection ? await source.connect() : source;
  if (ownsConnection) await client.query('begin');
  try {
    await client.query("select pg_advisory_xact_lock(hashtextextended('inventory-listen-reset-v1', 0))");
    await client.query(`
      create table if not exists system_settings (
        key text primary key,
        value jsonb not null default '{}'::jsonb,
        updated_at timestamptz not null default now(),
        updated_by text
      )
    `);
    const existing = await client.query(
      'select value from system_settings where key=$1',
      [INVENTORY_LISTEN_RESET_KEY],
    );
    if (existing.rows[0]?.value?.done === true) {
      if (ownsConnection) await client.query('commit');
      return { skipped: true, reason: 'already_applied' };
    }

    const movementsTable = await client.query(
      `select to_regclass('public.inventory_movements') as name`,
    );
    if (!movementsTable.rows[0]?.name) {
      if (ownsConnection) await client.query('commit');
      return { skipped: true, reason: 'no_movements_table' };
    }

    const listenSales = await client.query(`
      select id, product_id, quantity_delta, order_item_id
        from inventory_movements
       where movement_type='sale'
         and coalesce((metadata->>'reserved')::boolean, false)=true
    `);

    const restored = await client.query(`
      update product_inventory inventory
         set quantity_on_hand = inventory.quantity_on_hand - sales.delta,
             updated_at = now()
        from (
          select product_id, sum(quantity_delta) as delta
            from inventory_movements
           where movement_type='sale'
             and coalesce((metadata->>'reserved')::boolean, false)=true
           group by product_id
        ) sales
       where inventory.product_id = sales.product_id
      returning inventory.product_id
    `);

    const items = await client.query(`
      update order_items
         set stock_state='none',
             stock_applied_quantity=0,
             updated_at=now()
       where stock_state='pending'
          or (
            stock_state='applied'
            and exists (
              select 1 from inventory_movements movement
               where movement.order_item_id=order_items.id
                 and movement.movement_type='sale'
                 and coalesce((movement.metadata->>'reserved')::boolean, false)=true
            )
          )
      returning id
    `);

    const deletedMovements = await client.query(`
      delete from inventory_movements
       where movement_type='sale'
         and coalesce((metadata->>'reserved')::boolean, false)=true
      returning id
    `);

    const released = await client.query(`
      update product_inventory
         set quantity_reserved=0,
             updated_at=now()
       where quantity_reserved <> 0
      returning product_id
    `);

    const deletedJobs = await client.query('delete from inventory_stock_jobs returning id');

    await client.query(
      `insert into system_settings (key, value, updated_at, updated_by)
       values ($1, $2::jsonb, now(), 'system.listen-reset')
       on conflict (key) do update
         set value=excluded.value, updated_at=now(), updated_by=excluded.updated_by`,
      [INVENTORY_LISTEN_RESET_KEY, JSON.stringify({ done: true, at: new Date().toISOString() })],
    );

    if (ownsConnection) await client.query('commit');
    const summary = {
      skipped: false,
      listenSales: listenSales.rows.length,
      productsRestored: restored.rows.length,
      itemsReset: items.rows.length,
      movementsDeleted: deletedMovements.rows.length,
      reservedCleared: released.rows.length,
      jobsDeleted: deletedJobs.rows.length,
    };
    log(JSON.stringify(summary));
    return summary;
  } catch (error) {
    if (ownsConnection) await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    if (ownsConnection) client.release();
  }
}
