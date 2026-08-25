import { parseArgs } from 'node:util';
import { pool } from '@zentofact/core';

const { values } = parseArgs({
  options: { apply: { type: 'boolean', default: false } },
});

const variants = [
  {
    mainSku: 'G34R',
    listingId: 6926,
    expectedShopSku: '156582201',
    quantityOnHand: 11,
    excelRow: 46,
  },
  {
    mainSku: 'FAL-144962663',
    listingId: 530,
    expectedShopSku: '144962663',
    quantityOnHand: 0,
    excelRow: null,
  },
];

async function loadVariant(client, variant) {
  const listing = (await client.query(
    `select l.*, p.main_sku as current_main_sku
     from product_listings l join products p on p.id=l.product_id
     where l.id=$1 for update of l`,
    [variant.listingId],
  )).rows[0];
  if (!listing) throw new Error(`No existe la publicación ${variant.listingId}.`);
  if (listing.shop_sku !== variant.expectedShopSku) {
    throw new Error(`La publicación ${variant.listingId} cambió de Shop SKU.`);
  }
  const existing = (await client.query(
    'select id,main_sku,name from products where main_sku=$1 for update',
    [variant.mainSku],
  )).rows[0] || null;
  return { variant, listing, existing };
}

async function applyVariant(client, plan) {
  const { variant, listing } = plan;
  let productId = plan.existing?.id;
  if (!productId) {
    const imageUrl = listing.metadata?.images?.[0] || listing.metadata?.imageUrl || null;
    const inserted = await client.query(
      `insert into products (
         main_sku,name,description,status,attributes,image_url,reference_price
       ) values ($1,$2,$2,'active',$3::jsonb,$4,$5)
       returning id`,
      [
        variant.mainSku,
        listing.title,
        JSON.stringify({
          excel_codes: variant.excelRow ? [variant.mainSku] : [],
          excel_source_row: variant.excelRow,
          imported_from: 'catalog_correction',
          variant_split_from: listing.current_main_sku,
          primary_category: listing.metadata?.primaryCategory || null,
        }),
        imageUrl,
        listing.metadata?.effectivePrice ?? listing.metadata?.price ?? null,
      ],
    );
    productId = inserted.rows[0].id;
    await client.query(
      `insert into product_inventory (product_id,quantity_on_hand,quantity_reserved)
       values ($1,$2,0)`,
      [productId, variant.quantityOnHand],
    );
  }
  await client.query(
    `update product_listings set product_id=$1,updated_at=now() where id=$2`,
    [productId, variant.listingId],
  );
  await client.query(
    `update order_items set product_id=$1,main_sku=$2,updated_at=now()
     where listing_id=$3`,
    [productId, variant.mainSku, variant.listingId],
  );
  if (variant.excelRow) {
    await client.query(
      `insert into inventory_reconciliation_anchors (
         run_id,product_id,cutoff_quantity,target_quantity
       )
       select id,$1,$2,$2
         from inventory_reconciliation_runs
        where reconciliation_kind='falabella_august_2026'
        order by applied_at desc,id desc
        limit 1
       on conflict(run_id,product_id) do update set
         cutoff_quantity=excluded.cutoff_quantity,
         target_quantity=excluded.target_quantity`,
      [productId, variant.quantityOnHand],
    );
  }
  return { ...variant, productId: Number(productId), created: !plan.existing };
}

const client = await pool.connect();
try {
  await client.query('begin');
  const plans = [];
  for (const variant of variants) plans.push(await loadVariant(client, variant));
  const report = values.apply
    ? await Promise.all(plans.map((plan) => applyVariant(client, plan)))
    : plans.map(({ variant, listing, existing }) => ({
      ...variant,
      currentMasterSku: listing.current_main_sku,
      existingProductId: existing ? Number(existing.id) : null,
      action: existing ? 'reassign_listing' : 'create_master_and_reassign_listing',
    }));
  if (values.apply) {
    const beige = report.find((item) => item.mainSku === 'G34R');
    await client.query(
      `update order_items set product_id=$1,main_sku='G34R',listing_id=null,updated_at=now()
       where id=4627 and description ilike '%BEIGE%'`,
      [beige.productId],
    );
    await client.query('commit');
  } else {
    await client.query('rollback');
  }
  console.log(JSON.stringify({ dryRun: !values.apply, variants: report }, null, 2));
} catch (error) {
  await client.query('rollback');
  throw error;
} finally {
  client.release();
  await pool.end();
}
