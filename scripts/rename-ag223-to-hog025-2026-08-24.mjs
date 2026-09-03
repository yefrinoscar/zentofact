import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { config } from 'dotenv';

const { values } = parseArgs({
  options: { apply: { type: 'boolean', default: false } },
});

config({ path: resolve('.env') });

const OLD_SKU = 'AG223';
const NEW_SKU = 'HOG025';
const { pool } = await import('@zentofact/core');

try {
  const products = await pool.query(
    'select id, main_sku, name from products where main_sku = any($1) order by main_sku',
    [[OLD_SKU, NEW_SKU]],
  );
  const oldProduct = products.rows.find((product) => product.main_sku === OLD_SKU);
  const newProduct = products.rows.find((product) => product.main_sku === NEW_SKU);

  if (oldProduct && newProduct) {
    throw new Error(`${OLD_SKU} y ${NEW_SKU} existen como maestros diferentes; no se modificó nada.`);
  }
  if (!oldProduct && newProduct) {
    console.log(`${NEW_SKU} ya es el código del maestro. No hay cambios pendientes.`);
    process.exitCode = 0;
  } else if (!oldProduct) {
    throw new Error(`No existe el maestro ${OLD_SKU}.`);
  } else {
    const productId = Number(oldProduct.id);
    const orderItems = await pool.query(
      'select count(*)::int as count from order_items where product_id=$1 and main_sku=$2',
      [productId, OLD_SKU],
    );
    const inventoryKeys = await pool.query(
      `select id, idempotency_key,
         regexp_replace(idempotency_key, ':ag223$', ':hog025') as next_key
       from inventory_movements
       where product_id=$1 and idempotency_key ~ ':ag223$'`,
      [productId],
    );

    console.table([{
      productId,
      product: oldProduct.name,
      previousSku: OLD_SKU,
      newSku: NEW_SKU,
      historicalOrderItems: orderItems.rows[0].count,
      inventoryKeys: inventoryKeys.rowCount,
    }]);

    if (!values.apply) {
      console.log('DRY RUN: no se modificó la base. Usa --apply para ejecutar el cambio.');
    } else {
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query(
          'update products set main_sku=$1, updated_at=now() where id=$2 and main_sku=$3',
          [NEW_SKU, productId, OLD_SKU],
        );
        await client.query(
          'update order_items set main_sku=$1, updated_at=now() where product_id=$2 and main_sku=$3',
          [NEW_SKU, productId, OLD_SKU],
        );
        for (const movement of inventoryKeys.rows) {
          await client.query(
            'update inventory_movements set idempotency_key=$1 where id=$2 and idempotency_key=$3',
            [movement.next_key, movement.id, movement.idempotency_key],
          );
        }
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
      console.log(`APLICADO: ${OLD_SKU} ahora es ${NEW_SKU}.`);
    }
  }
} finally {
  await pool.end();
}
