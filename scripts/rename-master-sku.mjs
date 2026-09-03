import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import pg from 'pg';

config({ path: resolve('.env') });

const { values } = parseArgs({
  options: {
    from: { type: 'string' },
    to: { type: 'string' },
    apply: { type: 'boolean', default: false },
  },
});

const sourceSku = String(values.from || '').trim().toUpperCase();
const targetSku = String(values.to || '').trim().toUpperCase();
if (!sourceSku || !targetSku || sourceSku === targetSku) {
  throw new Error('Indica dos SKU distintos con --from y --to.');
}

const connectionString = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL_POSTGRES;
if (!connectionString) throw new Error('Falta DATABASE_PUBLIC_URL o DATABASE_URL_POSTGRES.');

function mergedAttributes(attributes) {
  const current = attributes && typeof attributes === 'object' ? attributes : {};
  const existing = Array.isArray(current.excel_codes) ? current.excel_codes : [];
  const excelCodes = [targetSku, ...existing]
    .map((value) => String(value || '').trim().toUpperCase())
    .filter((value, index, all) => value && value !== sourceSku && all.indexOf(value) === index);
  return { ...current, excel_codes: excelCodes, legacy_main_sku: sourceSku };
}

const pool = new pg.Pool({ connectionString });
const client = await pool.connect();

try {
  await client.query('begin');
  const products = await client.query(
    `select p.id,p.main_sku,p.name,p.attributes,
       coalesce(i.quantity_on_hand,0) as quantity_on_hand,
       coalesce(i.quantity_reserved,0) as quantity_reserved,
       (select count(*)::int from product_listings l where l.product_id=p.id) as listing_count,
       (select count(*)::int from order_items oi where oi.product_id=p.id) as order_item_count
     from products p
     left join product_inventory i on i.product_id=p.id
     where upper(p.main_sku)=any($1::text[])
     order by p.id
     for update of p`,
    [[sourceSku, targetSku]],
  );
  const source = products.rows.find((row) => row.main_sku.toUpperCase() === sourceSku);
  const target = products.rows.find((row) => row.main_sku.toUpperCase() === targetSku);

  if (source && target && source.id !== target.id) {
    throw new Error(`${targetSku} ya pertenece al producto ${target.id}.`);
  }
  if (!source && !target) throw new Error(`No existe ${sourceSku} ni ${targetSku}.`);
  if (!source && target && target.attributes?.legacy_main_sku !== sourceSku) {
    throw new Error(`${targetSku} existe, pero no consta que provenga de ${sourceSku}.`);
  }

  let action = 'already_renamed';
  let product = target;
  let updatedOrderItems = 0;
  let updatedMovementKeys = 0;

  if (source) {
    action = values.apply ? 'renamed' : 'would_rename';
    product = source;
    if (values.apply) {
      const orderItems = await client.query(
        `update order_items
         set main_sku=$1,updated_at=now()
         where product_id=$2 and upper(coalesce(main_sku,''))=$3`,
        [targetSku, source.id, sourceSku],
      );
      updatedOrderItems = orderItems.rowCount;

      const movementKeys = await client.query(
        `update inventory_movements
         set idempotency_key=left(idempotency_key,length(idempotency_key)-length($1)) || lower($2)
         where product_id=$3
           and right(lower(idempotency_key),length($1)+1)=':' || lower($1)`,
        [sourceSku, targetSku, source.id],
      );
      updatedMovementKeys = movementKeys.rowCount;

      const renamed = await client.query(
        `update products
         set main_sku=$1,attributes=$2::jsonb,updated_at=now()
         where id=$3
         returning id,main_sku,name,attributes`,
        [targetSku, JSON.stringify(mergedAttributes(source.attributes)), source.id],
      );
      product = { ...source, ...renamed.rows[0] };
    }
  }

  if (values.apply) await client.query('commit');
  else await client.query('rollback');

  const verification = await client.query(
    `select
       count(*) filter (where upper(p.main_sku)=$1)::int as source_products,
       count(*) filter (where upper(p.main_sku)=$2)::int as target_products,
       coalesce(max(i.quantity_on_hand) filter (where upper(p.main_sku)=$2),0) as target_stock,
       (select count(*)::int
          from order_items oi
          join products owner on owner.id=oi.product_id
         where upper(owner.main_sku)=$2 and upper(coalesce(oi.main_sku,''))=$1) as legacy_order_items,
       (select count(*)::int
          from inventory_movements m
          join products owner on owner.id=m.product_id
         where upper(owner.main_sku)=$2
           and right(lower(m.idempotency_key),length($1)+1)=':' || lower($1)) as legacy_movement_keys
     from products p
     left join product_inventory i on i.product_id=p.id
     where upper(p.main_sku)=any($3::text[])`,
    [sourceSku, targetSku, [sourceSku, targetSku]],
  );

  console.log(JSON.stringify({
    applied: values.apply,
    action,
    productId: Number(product.id),
    previousSku: sourceSku,
    currentSku: values.apply || !source ? targetSku : sourceSku,
    name: product.name,
    quantityOnHand: Number(product.quantity_on_hand),
    quantityReserved: Number(product.quantity_reserved),
    listingCount: Number(product.listing_count),
    orderItemCount: Number(product.order_item_count),
    updatedOrderItems,
    updatedMovementKeys,
    excelCodes: values.apply
      ? mergedAttributes(source?.attributes || target?.attributes).excel_codes
      : mergedAttributes(product.attributes).excel_codes,
    verification: {
      sourceProducts: Number(verification.rows[0].source_products),
      targetProducts: Number(verification.rows[0].target_products),
      targetStock: Number(verification.rows[0].target_stock),
      legacyOrderItems: Number(verification.rows[0].legacy_order_items),
      legacyMovementKeys: Number(verification.rows[0].legacy_movement_keys),
    },
  }));
} catch (error) {
  await client.query('rollback');
  throw error;
} finally {
  client.release();
  await pool.end();
}
