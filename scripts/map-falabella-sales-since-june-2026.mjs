import { parseArgs } from 'node:util';
import { pool } from '@zentofact/core';

const { values } = parseArgs({ options: { apply: { type: 'boolean', default: false } } });

const SINCE = '2026-06-01T05:00:00.000Z';

const MAPPINGS = [
  {
    mainSku: 'FAL-144958533',
    name: 'Mochila de Montaña Trekking Camping 60 Litros Impermeable',
    referencePrice: 99.9,
    imageUrl: 'https://media.falabella.com/falabellaPE/144958533_01',
    evidence: [
      { companyId: 4, accountId: 5, sellerSku: '23123asdfef', shopSku: '144958533' },
      { companyId: 9, accountId: 9, sellerSku: '426745', shopSku: '144956424' },
    ],
  },
  {
    mainSku: 'FAL-140715461',
    name: 'Odómetro Velocímetro Digital Multifuncional para Bicicleta',
    referencePrice: 17,
    imageUrl: 'https://media.falabella.com/falabellaPE/140715461_01',
    evidence: [
      { companyId: 4, accountId: 5, sellerSku: 'OM21221112', shopSku: '140715461' },
    ],
  },
  {
    mainSku: 'FAL-123389143',
    name: 'Máquina para Cortar Cabello y Barba Kit de 10 Piezas',
    referencePrice: 49.9,
    imageUrl: 'https://media.falabella.com/falabellaPE/123389143_01',
    evidence: [
      { companyId: 1, accountId: 1, sellerSku: 'AFE781187', shopSku: '123389143' },
    ],
  },
  {
    mainSku: 'AG227',
    name: 'Triturador De Alimentos Verdudas Alimentos Electrico Usb Recargable',
    existing: true,
    evidence: [
      { companyId: 4, accountId: 5, sellerSku: 'TRI09812784', shopSku: '129752150' },
    ],
  },
];

function identity(companyId, sellerSku) {
  return `${companyId}/${sellerSku}`;
}

async function inspect(db, { lock = false } = {}) {
  const mainSkus = MAPPINGS.map(({ mainSku }) => mainSku);
  const products = await db.query(
    `select p.*, i.quantity_on_hand, i.quantity_reserved
     from products p
     left join product_inventory i on i.product_id=p.id
     where p.main_sku=any($1::text[])
     ${lock ? 'for update of p' : ''}`,
    [mainSkus],
  );
  const byMainSku = new Map(products.rows.map((row) => [row.main_sku, row]));

  for (const mapping of MAPPINGS) {
    const product = byMainSku.get(mapping.mainSku);
    if (mapping.existing && !product) throw new Error(`Falta el maestro existente ${mapping.mainSku}.`);
    if (product && product.name.trim().toLocaleLowerCase('es-PE') !== mapping.name.trim().toLocaleLowerCase('es-PE')) {
      throw new Error(`${mapping.mainSku} existe con otro nombre: ${product.name}`);
    }
  }

  const evidence = MAPPINGS.flatMap((mapping) => mapping.evidence);
  const evidenceRows = await db.query(
    `select
       o.company_id,
       o.channel_account_id,
       oi.sku as seller_sku,
       oi.provider_sku as shop_sku,
       min(oi.description) as description,
       count(*)::integer as item_rows,
       coalesce(sum(oi.quantity),0)::numeric as units,
       coalesce(sum(oi.stock_applied_quantity),0)::numeric as applied_units,
       min(o.ordered_at) as first_ordered_at,
       max(o.ordered_at) as last_ordered_at
     from order_items oi
     join orders o on o.id=oi.order_id
     join order_channel_accounts account on account.id=o.channel_account_id
     join order_channels channel on channel.id=account.channel_id
     where channel.code='falabella'
       and o.ordered_at >= $1
       and (o.company_id,oi.sku) in (${evidence.map((_, index) => `($${index * 2 + 2}::bigint,$${index * 2 + 3}::text)`).join(',')})
     group by o.company_id,o.channel_account_id,oi.sku,oi.provider_sku`,
    [SINCE, ...evidence.flatMap(({ companyId, sellerSku }) => [companyId, sellerSku])],
  );
  const byIdentity = new Map(evidenceRows.rows.map((row) => [identity(row.company_id, row.seller_sku), row]));
  for (const expected of evidence) {
    const row = byIdentity.get(identity(expected.companyId, expected.sellerSku));
    if (!row) throw new Error(`Falta evidencia para ${identity(expected.companyId, expected.sellerSku)}.`);
    if (Number(row.channel_account_id) !== expected.accountId || row.shop_sku !== expected.shopSku) {
      throw new Error(`La identidad de ${identity(expected.companyId, expected.sellerSku)} cambió.`);
    }
    if (Number(row.applied_units) !== 0) {
      throw new Error(`${identity(expected.companyId, expected.sellerSku)} ya movió ${row.applied_units} unidades de stock.`);
    }
  }

  const listings = await db.query(
    `select * from product_listings
     where channel_code='falabella'
       and (company_id,seller_sku) in (${evidence.map((_, index) => `($${index * 2 + 1}::bigint,$${index * 2 + 2}::text)`).join(',')})
     ${lock ? 'for update' : ''}`,
    evidence.flatMap(({ companyId, sellerSku }) => [companyId, sellerSku]),
  );

  return { byMainSku, evidenceRows: evidenceRows.rows, listings: listings.rows };
}

async function apply() {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const before = await client.query(
      `select product_id,quantity_on_hand,quantity_reserved from product_inventory order by product_id`,
    );
    const ledgerBefore = await client.query(
      `select count(*)::integer as count, coalesce(max(id),0)::bigint as max_id from inventory_movements`,
    );
    const checked = await inspect(client, { lock: true });

    const productIds = new Map();
    const actions = [];
    for (const mapping of MAPPINGS) {
      let product = checked.byMainSku.get(mapping.mainSku);
      if (!product) {
        const inserted = await client.query(
          `insert into products (
             main_sku,name,status,attributes,image_url,reference_price
           ) values ($1,$2,'active',$3,$4,$5)
           returning *`,
          [
            mapping.mainSku,
            mapping.name,
            JSON.stringify({
              source: 'historical_falabella_order_items',
              salesHistorySince: '2026-06-01',
              absentFromPhysicalCount20260821: true,
            }),
            mapping.imageUrl,
            mapping.referencePrice,
          ],
        );
        product = inserted.rows[0];
        await client.query(
          `insert into product_inventory (product_id,quantity_on_hand,quantity_reserved)
           values ($1,0,0)`,
          [product.id],
        );
        actions.push({ mainSku: mapping.mainSku, action: 'maestro creado', stock: 0 });
      } else {
        actions.push({ mainSku: mapping.mainSku, action: 'maestro existente', stock: Number(product.quantity_on_hand || 0) });
      }
      productIds.set(mapping.mainSku, Number(product.id));
    }

    const existingListings = new Map(checked.listings.map((row) => [identity(row.company_id, row.seller_sku), row]));
    let mappedRows = 0;
    for (const mapping of MAPPINGS) {
      const productId = productIds.get(mapping.mainSku);
      for (const evidence of mapping.evidence) {
        const key = identity(evidence.companyId, evidence.sellerSku);
        const existing = existingListings.get(key);
        if (existing && Number(existing.product_id) !== productId) {
          throw new Error(`${key} ya está asociado al maestro ${existing.product_id}.`);
        }
        let listingId = existing ? Number(existing.id) : null;
        if (!listingId) {
          const inserted = await client.query(
            `insert into product_listings (
               product_id,channel_code,company_id,channel_account_id,seller_sku,shop_sku,
               external_product_id,title,status,marketplace_quantity,metadata
             ) values ($1,'falabella',$2,$3,$4,$5,$5,$6,'inactive',0,$7)
             returning id`,
            [
              productId,
              evidence.companyId,
              evidence.accountId,
              evidence.sellerSku,
              evidence.shopSku,
              mapping.name,
              JSON.stringify({ source: 'historical_falabella_order_items', salesHistorySince: '2026-06-01' }),
            ],
          );
          listingId = Number(inserted.rows[0].id);
        }
        const updated = await client.query(
          `update order_items oi set
             product_id=$1,
             listing_id=$2,
             main_sku=$3,
             stock_state='reversed',
             stock_applied_quantity=0,
             stock_revision=stock_revision+1,
             updated_at=now()
           from orders o
           join order_channel_accounts account on account.id=o.channel_account_id
           join order_channels channel on channel.id=account.channel_id
           where oi.order_id=o.id
             and channel.code='falabella'
             and o.ordered_at >= $4
             and o.company_id=$5
             and oi.sku=$6
             and oi.provider_sku=$7
             and coalesce(oi.stock_applied_quantity,0)=0`,
          [productId, listingId, mapping.mainSku, SINCE, evidence.companyId, evidence.sellerSku, evidence.shopSku],
        );
        mappedRows += updated.rowCount;
      }
    }

    const existingProductIds = before.rows.map((row) => row.product_id);
    const changedExisting = await client.query(
      `select before.product_id
       from jsonb_to_recordset($1::jsonb) as before(product_id bigint,quantity_on_hand numeric,quantity_reserved numeric)
       join product_inventory current on current.product_id=before.product_id
       where current.quantity_on_hand is distinct from before.quantity_on_hand
          or current.quantity_reserved is distinct from before.quantity_reserved`,
      [JSON.stringify(before.rows)],
    );
    if (changedExisting.rowCount) throw new Error(`Cambió el stock de ${changedExisting.rowCount} maestro(s) existente(s).`);
    const createdStock = await client.query(
      `select count(*)::integer as count
       from product_inventory
       where product_id<>all($1::bigint[])
         and (quantity_on_hand<>0 or quantity_reserved<>0)`,
      [existingProductIds],
    );
    if (createdStock.rows[0].count) throw new Error('Un maestro nuevo no quedó en stock 0.');
    const ledgerAfter = await client.query(
      `select count(*)::integer as count, coalesce(max(id),0)::bigint as max_id from inventory_movements`,
    );
    if (JSON.stringify(ledgerAfter.rows[0]) !== JSON.stringify(ledgerBefore.rows[0])) {
      throw new Error('La operación creó movimientos de inventario.');
    }

    await client.query('commit');
    return { actions, mappedRows, ledger: ledgerAfter.rows[0] };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

try {
  const inspection = await inspect(pool);
  console.table(MAPPINGS.flatMap((mapping) => mapping.evidence.map((evidence) => {
    const row = inspection.evidenceRows.find((candidate) => (
      Number(candidate.company_id) === evidence.companyId && candidate.seller_sku === evidence.sellerSku
    ));
    return {
      maestro: mapping.mainSku,
      sellerSku: evidence.sellerSku,
      shopSku: evidence.shopSku,
      unidadesDesdeJunio: Number(row?.units || 0),
      filas: Number(row?.item_rows || 0),
    };
  })));
  if (!values.apply) {
    console.log('DRY RUN: no se modificó la base. Usa --apply para aplicar.');
  } else {
    const result = await apply();
    console.table(result.actions);
    console.log(`APLICADO: ${result.mappedRows} líneas históricas asociadas; inventario sin movimientos.`);
  }
} finally {
  await pool.end();
}
