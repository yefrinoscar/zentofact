import 'dotenv/config';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const PERIOD_START = '2026-06-01T05:00:00.000Z';
const AUGUST_START = '2026-08-01T05:00:00.000Z';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_POSTGRES });

async function loadPlan(db) {
  const inactive = await db.query("select id, main_sku, name from products where status='inactive' order by id");
  const invalidQuantities = await db.query(
      `select oi.id, o.external_order_number
       from order_items oi join orders o on o.id=oi.order_id
       where o.ordered_at >= $1 and o.ordered_at < $2
         and oi.quantity=0 and not (oi.raw_data ? 'Quantity')
       order by oi.id`,
      [PERIOD_START, AUGUST_START],
    );
  const historicalLines = await db.query(
      `select count(*)::int as lines, coalesce(sum(greatest(1, oi.quantity)), 0)::int as units
       from order_items oi join orders o on o.id=oi.order_id
       left join falabella_orders fo
         on fo.company_id=o.company_id and fo.order_id=o.external_order_id
       where o.ordered_at >= $1 and o.ordered_at < $2
         and oi.product_id is not null
         and o.order_status in ('confirmed','completed')
         and o.fulfillment_status in ('ready_to_ship','shipped','delivered')
         and lower(coalesce(fo.status, '')) !~ '(return|cancel|failed)'
         and lower(coalesce(oi.provider_status, '')) !~ '(return|cancel|failed)'`,
      [PERIOD_START, AUGUST_START],
    );
  return {
    inactiveProducts: inactive.rows,
    invalidQuantities: invalidQuantities.rows,
    historicalLines: historicalLines.rows[0],
  };
}

async function applyPlan(client) {
  await client.query(
    `update order_items oi set
       quantity=1,
       total=coalesce(oi.total, oi.unit_price),
       metadata=oi.metadata || jsonb_build_object(
         'quantityRepair', jsonb_build_object(
           'from', 0, 'to', 1, 'reason', 'Falabella historical payload omitted Quantity'
         )
       ),
       updated_at=now()
     from orders o
     where o.id=oi.order_id
       and o.ordered_at >= $1 and o.ordered_at < $2
       and oi.quantity=0 and not (oi.raw_data ? 'Quantity')`,
    [PERIOD_START, AUGUST_START],
  );

  await client.query(
    `update order_items oi set
       stock_state='applied',
       stock_applied_quantity=oi.quantity,
       stock_revision=case
         when oi.stock_state='applied' and oi.stock_applied_quantity=oi.quantity then oi.stock_revision
         else oi.stock_revision+1
       end,
       metadata=oi.metadata || jsonb_build_object(
         'physicalBaseline', jsonb_build_object(
           'absorbed', true,
           'cutoffAt', '2026-08-21T19:50:00.000Z',
           'reason', 'La salida anterior al conteo ya está incluida en el stock físico'
         )
       ),
       updated_at=now()
     from orders o
     left join falabella_orders fo
       on fo.company_id=o.company_id and fo.order_id=o.external_order_id
     where o.id=oi.order_id
       and o.ordered_at >= $1 and o.ordered_at < $2
       and oi.product_id is not null
       and oi.quantity > 0
       and o.order_status in ('confirmed','completed')
       and o.fulfillment_status in ('ready_to_ship','shipped','delivered')
       and lower(coalesce(fo.status, '')) !~ '(return|cancel|failed)'
       and lower(coalesce(oi.provider_status, '')) !~ '(return|cancel|failed)'
       and not (
         oi.stock_state='applied'
         and oi.stock_applied_quantity=oi.quantity
         and oi.metadata->'physicalBaseline'->>'cutoffAt'='2026-08-21T19:50:00.000Z'
       )`,
    [PERIOD_START, AUGUST_START],
  );

  await client.query(
    `update products set status='active', updated_at=now()
     where status='inactive'`,
  );
}

const client = await pool.connect();
try {
  if (APPLY) {
    await client.query('begin');
    await client.query("select pg_advisory_xact_lock(hashtextextended('repair-products-page-data-2026-08-24', 0))");
  }
  const plan = await loadPlan(client);
  console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', ...plan }, null, 2));
  if (APPLY) {
    await applyPlan(client);
    await client.query('commit');
    console.log(JSON.stringify({ applied: true }));
  }
} catch (error) {
  if (APPLY) await client.query('rollback').catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
