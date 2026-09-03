import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { config } from 'dotenv';

const { values } = parseArgs({
  options: { apply: { type: 'boolean', default: false } },
});

config({ path: resolve('.env') });

const SKU_MAPPINGS = [
  ['AG94', 'G38L'],
  ['AG65', 'G44'],
  ['AG134', 'Z77'],
  ['AG296', 'G43'],
  ['AG104', 'Z5'],
  ['AG142', 'Z9'],
  ['AG297', 'Z34'],
  ['AG76', 'Z20'],
  ['AG144', 'AD060R'],
  ['AG87', 'G36'],
  ['AG174', 'Z7'],
  ['AG180', 'H32'],
  ['AG192', 'H25'],
  ['AG89', 'G47'],
  ['AG85', 'H30'],
  ['AG81', 'H9MB'],
  ['AG83', 'H9MN'],
  ['AG82', 'H9LB'],
  ['AG84', 'H9LN'],
  ['AG167', 'H9XLB'],
  ['AG166', 'H9XLN'],
  ['AG165', 'H13L'],
  ['AG110', 'H14'],
  ['AG163', 'H16'],
  ['AG298', 'G40L'],
  ['AG193', 'Z25'],
  ['AG129', 'G42N'],
  ['AG139', 'G42B'],
  ['AG128', 'H36'],
  ['AG108', 'G1FLORES'],
  ['AG274', 'G1HOJAS'],
  ['AG107', 'G1RAMAS'],
  ['AG159', 'H39'],
  ['AG171', 'G18', ['G18', 'G-19']],
  ['AG157', 'H49'],
  ['AG115', 'G9'],
  ['AG168', 'G13'],
  ['AG121', 'G24N', ['G24N', 'G24CA']],
  ['AG189', 'G26C'],
  ['AG123', 'G-28N'],
  ['AG169', 'G34C'],
  ['AG125', 'G35N'],
  ['AG301', 'G35V'],
  ['AG170', 'G35R'],
  ['AG126', 'G37'],
  ['AG140', 'H24'],
  ['AG112', 'HOG001'],
  ['AG141', 'HOG013'],
  ['AG120', 'G-25'],
  ['AG127', 'G-48'],
  ['AG172', 'G-20'],
  ['AG124', 'G-32'],
  ['AG113', 'HOG-12-002'],
  ['AG109', 'HOG-12-003'],
  ['AG155', 'HOG-12-004'],
  ['AC34', 'HOG-12-005'],
  ['AG223', 'HOG025'],
  ['AG173', 'G-8'],
  ['AG75', 'G-36'],
  ['AG119', 'G-2'],
  ['AG197', 'HOG028'],
  ['AG198', 'HOG029'],
  ['AG224', 'A-2'],
  ['AG201', 'A-25'],
  ['AG202', 'A-22'],
  ['AG212', 'A-33'],
  ['AG277', 'A-29'],
  ['AG210', 'A-30'],
  ['AG164', 'H13M'],
  ['AG299', 'G40XL'],
].map(([oldSku, newSku, aliases]) => ({ oldSku, newSku, aliases: aliases || [newSku] }));

const duplicateTargets = SKU_MAPPINGS
  .map(({ newSku }) => newSku)
  .filter((sku, index, all) => all.indexOf(sku) !== index);
if (duplicateTargets.length) throw new Error(`Códigos destino duplicados: ${[...new Set(duplicateTargets)].join(', ')}.`);

const { pool } = await import('@zentofact/core');

try {
  const requestedSkus = [...new Set(SKU_MAPPINGS.flatMap(({ oldSku, newSku }) => [oldSku, newSku]))];
  const products = await pool.query(
    'select id, main_sku, name, attributes from products where main_sku=any($1)',
    [requestedSkus],
  );
  const productsBySku = new Map(products.rows.map((product) => [product.main_sku, product]));
  const plan = [];

  for (const mapping of SKU_MAPPINGS) {
    const oldProduct = productsBySku.get(mapping.oldSku);
    const newProduct = productsBySku.get(mapping.newSku);
    if (oldProduct && newProduct && oldProduct.id !== newProduct.id) {
      throw new Error(`${mapping.newSku} ya pertenece a otro maestro.`);
    }

    let product = oldProduct || newProduct;
    if (!product) throw new Error(`No existe el maestro ${mapping.oldSku}.`);
    if (!oldProduct && mapping.oldSku !== mapping.newSku) {
      const recordedLegacySku = product.attributes?.legacy_main_sku;
      const knownPreviousMigration = mapping.oldSku === 'AG223' && mapping.newSku === 'HOG025';
      if (recordedLegacySku !== mapping.oldSku && !knownPreviousMigration) {
        throw new Error(`${mapping.newSku} existe, pero no consta que provenga de ${mapping.oldSku}.`);
      }
    }

    plan.push({
      ...mapping,
      productId: Number(product.id),
      productName: product.name,
      currentSku: product.main_sku,
      needsRename: product.main_sku !== mapping.newSku,
    });
  }

  console.table(plan.map((item) => ({
    producto: item.productName,
    anterior: item.currentSku,
    nuevo: item.newSku,
    aliases: item.aliases.join(', '),
  })));
  console.log(`Maestros cubiertos: ${plan.length}. Cambios de SKU pendientes: ${plan.filter((item) => item.needsRename).length}.`);

  if (!values.apply) {
    console.log('DRY RUN: no se modificó la base. Usa --apply para ejecutar la migración.');
  } else {
    const client = await pool.connect();
    try {
      await client.query('begin');
      for (const item of plan) {
        await client.query(
          `update products
           set main_sku=$1,
               attributes=jsonb_set(
                 jsonb_set(coalesce(attributes, '{}'::jsonb), '{excel_codes}', to_jsonb($2::text[]), true),
                 '{legacy_main_sku}', to_jsonb($3::text), true
               ),
               updated_at=now()
           where id=$4`,
          [item.newSku, item.aliases, item.oldSku, item.productId],
        );
        await client.query(
          'update order_items set main_sku=$1, updated_at=now() where product_id=$2 and main_sku=$3',
          [item.newSku, item.productId, item.oldSku],
        );
        await client.query(
          `update inventory_movements
           set idempotency_key=regexp_replace(idempotency_key, $1, $2)
           where product_id=$3 and idempotency_key ~ $1`,
          [`:${item.oldSku.toLowerCase()}$`, `:${item.newSku.toLowerCase()}`, item.productId],
        );
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    console.log(`APLICADO: ${plan.filter((item) => item.needsRename).length} maestros usan ahora el código del Excel.`);
  }
} finally {
  await pool.end();
}
