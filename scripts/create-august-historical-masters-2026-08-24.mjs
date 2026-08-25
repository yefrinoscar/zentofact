import { parseArgs } from 'node:util';
import { pool } from '@zentofact/core';
import { createProduct } from '../packages/server/src/catalog/product-service.js';
import { inTransaction } from '../packages/server/src/catalog/utils.js';

const { values } = parseArgs({ options: { apply: { type: 'boolean', default: false } } });

const PRODUCTS = [
  {
    mainSku: 'FAL-146325783',
    name: 'Chaleco Reductor Térmico Entrenamiento Gimnasio Gym',
    referencePrice: 24.9,
    imageUrl: 'https://media.falabella.com/falabellaPE/146325783_01',
    evidence: [
      { sellerSku: '357258624678', shopSku: '146325783' },
      { sellerSku: '1512351', shopSku: '146325030' },
    ],
  },
  {
    mainSku: 'FAL-151159665',
    name: 'Mochila Ejecutiva Impermeable con Puerto USB Viajes Oficina Negocios',
    referencePrice: 69.9,
    imageUrl: 'https://media.falabella.com/falabellaPE/151159665_01',
    evidence: [
      { sellerSku: '6846846846465', shopSku: '151159665' },
    ],
  },
  {
    mainSku: 'FAL-115839107',
    name: 'Soplador Aspirador de Aire para Limpieza de Computadora',
    referencePrice: 99.99,
    imageUrl: 'https://media.falabella.com/falabellaPE/115839107_01',
    evidence: [
      { sellerSku: 'AS544145685', shopSku: '115839107' },
    ],
  },
];

function identity(sellerSku, shopSku) {
  return `${sellerSku}/${shopSku}`;
}

function normalized(value) {
  return String(value || '').trim().toLocaleLowerCase('es-PE');
}

async function loadEvidence(db) {
  const expected = PRODUCTS.flatMap((product) => product.evidence);
  const queryValues = expected.flatMap(({ sellerSku, shopSku }) => [sellerSku, shopSku]);
  const pairs = expected.map((_, index) => (
    `($${index * 2 + 1}::text,$${index * 2 + 2}::text)`
  )).join(',');
  const result = await db.query(
    `select
       oi.sku as seller_sku,
       oi.provider_sku as shop_sku,
       min(oi.description) as description,
       count(*)::integer as item_rows,
       count(distinct oi.order_id)::integer as orders,
       min(o.ordered_at) as first_ordered_at,
       max(o.ordered_at) as last_ordered_at,
       string_agg(distinct coalesce(nullif(c.nombre_comercial, ''), nullif(c.nombre, ''), c.razon_social), ', ')
         as sellers
     from order_items oi
     join orders o on o.id=oi.order_id
     join order_channel_accounts account on account.id=o.channel_account_id
     join order_channels channel on channel.id=account.channel_id
     left join companies c on c.id=o.company_id
     where channel.code='falabella'
       and (oi.sku,oi.provider_sku) in (${pairs})
     group by oi.sku,oi.provider_sku`,
    queryValues,
  );
  const byIdentity = new Map(result.rows.map((row) => [
    identity(row.seller_sku, row.shop_sku),
    row,
  ]));
  const missing = expected.filter(({ sellerSku, shopSku }) => (
    !byIdentity.has(identity(sellerSku, shopSku))
  ));
  if (missing.length) {
    throw new Error(`Falta evidencia histórica Falabella para: ${missing.map(({ sellerSku, shopSku }) => identity(sellerSku, shopSku)).join(', ')}`);
  }
  return byIdentity;
}

async function inspectProducts(db) {
  const skus = PRODUCTS.map(({ mainSku }) => mainSku);
  const names = PRODUCTS.map(({ name }) => normalized(name));
  const result = await db.query(
    `select
       p.id,
       p.main_sku,
       p.name,
       p.status,
       i.product_id is not null as has_inventory,
       i.quantity_on_hand,
       i.quantity_reserved
     from products p
     left join product_inventory i on i.product_id=p.id
     where upper(p.main_sku)=any($1::text[])
       or lower(trim(p.name))=any($2::text[])
     order by p.id`,
    [skus, names],
  );

  const inspections = PRODUCTS.map((product) => {
    const bySku = result.rows.filter((row) => row.main_sku.toUpperCase() === product.mainSku);
    const byName = result.rows.filter((row) => normalized(row.name) === normalized(product.name));
    const conflicts = [...new Map(
      [...bySku, ...byName]
        .filter((row) => row.main_sku.toUpperCase() !== product.mainSku || normalized(row.name) !== normalized(product.name))
        .map((row) => [row.id, row]),
    ).values()];
    if (conflicts.length) {
      throw new Error(`Conflicto para ${product.mainSku}: ${conflicts.map((row) => `${row.main_sku} · ${row.name}`).join('; ')}`);
    }
    const existing = bySku.find((row) => normalized(row.name) === normalized(product.name)) || null;
    if (existing?.status !== undefined && existing.status !== 'active') {
      throw new Error(`El maestro ${product.mainSku} ya existe con estado ${existing.status}; no se modificará automáticamente.`);
    }
    if (existing?.has_inventory && (
      Number(existing.quantity_on_hand) !== 0 || Number(existing.quantity_reserved) !== 0
    )) {
      throw new Error(`El maestro ${product.mainSku} ya existe con stock o reserva distinta de 0; no se modificará automáticamente.`);
    }
    return { product, existing };
  });
  return inspections;
}

try {
  const evidenceByIdentity = await loadEvidence(pool);
  const inspections = await inspectProducts(pool);

  console.log('Mapeos históricos encontrados:');
  console.table(PRODUCTS.flatMap((product) => product.evidence.map(({ sellerSku, shopSku }) => {
    const evidence = evidenceByIdentity.get(identity(sellerSku, shopSku));
    return {
      maestro: product.mainSku,
      sellerSku,
      shopSku,
      seller: evidence.sellers,
      productoPedido: evidence.description,
      pedidos: evidence.orders,
      primeraVenta: evidence.first_ordered_at?.toISOString() || null,
      ultimaVenta: evidence.last_ordered_at?.toISOString() || null,
    };
  })));

  console.log('Productos maestros:');
  console.table(inspections.map(({ product, existing }) => ({
    sku: product.mainSku,
    producto: product.name,
    precio: product.referencePrice.toFixed(2),
    stock: 0,
    accion: existing ? (existing.has_inventory ? 'ya existe' : 'crear inventario') : 'crear maestro',
  })));

  if (!values.apply) {
    console.log('DRY RUN: no se modificó la base. Usa --apply para aplicar.');
  } else {
    const applied = await inTransaction(null, async (client) => {
      const locked = await inspectProducts(client);
      const result = [];
      for (const { product, existing } of locked) {
        if (!existing) {
          const created = await createProduct({
            mainSku: product.mainSku,
            name: product.name,
            status: 'active',
            imageUrl: product.imageUrl,
            referencePrice: product.referencePrice,
            attributes: {
              source: 'historical_falabella_order_items',
              reconciliation: 'august_2026',
            },
          }, null, client);
          result.push({ mainSku: product.mainSku, action: 'maestro creado', productId: created.id });
          continue;
        }
        if (!existing.has_inventory) {
          await client.query(
            `insert into product_inventory (product_id, quantity_on_hand, quantity_reserved)
             values ($1,0,0) on conflict (product_id) do nothing`,
            [existing.id],
          );
          result.push({ mainSku: product.mainSku, action: 'inventario creado', productId: Number(existing.id) });
          continue;
        }
        result.push({ mainSku: product.mainSku, action: 'sin cambios', productId: Number(existing.id) });
      }
      return result;
    });
    console.table(applied);
    console.log(`APLICADO: ${applied.filter(({ action }) => action !== 'sin cambios').length} cambio(s).`);
  }
} finally {
  await pool.end();
}
