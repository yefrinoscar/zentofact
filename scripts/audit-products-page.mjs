import 'dotenv/config';
import pg from 'pg';
import { getCatalogSummary } from '../packages/server/src/catalog/product-service.js';
import { readinessCatalogInventory } from '../packages/server/src/system-config.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_POSTGRES });
const client = await pool.connect();
const failures = [];

function check(condition, message, details) {
  if (!condition) failures.push({ message, details });
}

try {
  await client.query('begin isolation level repeatable read read only');
  const steps = [
    () => client.query(`select status,count(*)::int products from products group by status order by status`),
    () => client.query(`select
      count(*) filter(where quantity_on_hand<0)::int as negative,
      count(*) filter(where quantity_reserved<0 or quantity_reserved>quantity_on_hand)::int as bad_reserved,
      coalesce(sum(quantity_on_hand),0)::int as stock,
      coalesce(sum(quantity_reserved),0)::int as reserved,
      coalesce(sum(quantity_on_hand-quantity_reserved),0)::int as available
      from product_inventory`),
    () => client.query(`select channel_code,status,count(*)::int listings,
      coalesce(sum(marketplace_quantity),0)::int as seller_stock
      from product_listings where status<>'unlinked'
      group by channel_code,status order by channel_code,status`),
    () => client.query(`select count(*)::int as listings,
      count(*) filter(where coalesce(
        nullif(metadata->>'imageUrl',''), nullif(metadata->'images'->>0,'')
      ) is null)::int as missing_images
      from product_listings where channel_code='ripley' and status<>'unlinked'`),
    () => client.query(`select
      count(*) filter(where oi.product_id is null)::int as unmapped,
      count(*) filter(where oi.quantity<=0)::int as invalid_quantity
      from order_items oi join orders o on o.id=oi.order_id
      where o.ordered_at>='2026-06-01T05:00:00Z'`),
    () => client.query(`select oi.stock_state,count(*)::int as lines
      from order_items oi join orders o on o.id=oi.order_id
      left join falabella_orders fo
        on fo.company_id=o.company_id and fo.order_id=o.external_order_id
      where o.ordered_at>='2026-08-21T19:50:00Z'
        and o.order_status in('confirmed','completed')
        and o.fulfillment_status in('ready_to_ship','shipped','delivered')
        and lower(coalesce(fo.status,''))!~'(return|cancel|failed)'
        and lower(coalesce(oi.provider_status,''))!~'(return|cancel|failed)'
        and oi.stock_state in('none','skipped_policy','skipped_unmapped')
      group by oi.stock_state order by oi.stock_state`),
    () => client.query(`select count(*)::int as lines
      from order_items oi join product_inventory i on i.product_id=oi.product_id
      where oi.stock_state='skipped_insufficient' and i.quantity_on_hand>0`),
    () => client.query(`select count(*)::int as identities from (
      select channel_code,company_id,upper(trim(seller_sku))
      from product_listings where status<>'unlinked'
      group by channel_code,company_id,upper(trim(seller_sku)) having count(*)>1
    ) duplicate`),
    () => client.query(`select p.main_sku,i.quantity_on_hand,
      array_agg(l.shop_sku order by l.id) filter(where l.status<>'unlinked') as listings
      from products p join product_inventory i on i.product_id=p.id
      left join product_listings l on l.product_id=p.id
      where p.main_sku in('G34C','G34R','FAL-144962663')
      group by p.id,i.quantity_on_hand order by p.main_sku`),
    () => client.query(`select coalesce(sum(oi.quantity),0)::numeric as units,
      coalesce(sum(coalesce(oi.total,oi.unit_price*oi.quantity,0)),0)::numeric as revenue
      from order_items oi join orders o on o.id=oi.order_id
      left join falabella_orders fo
        on fo.company_id=o.company_id and fo.order_id=o.external_order_id
      where oi.product_id is not null
        and o.order_status in('confirmed','completed')
        and coalesce(o.fulfillment_status,'')<>'returned'
        and lower(coalesce(fo.status,''))!~'(return|cancel|failed)'
        and lower(coalesce(oi.provider_status,''))!~'(return|cancel|failed)'
        and o.ordered_at>=now()-interval '30 days'`),
  ];
  const results = [];
  for (const step of steps) results.push(await step());
  const [
    productState,
    inventoryState,
    sellerState,
    ripleyImages,
    salesIntegrity,
    pendingStock,
    impossibleShortages,
    duplicateListings,
    variants,
    directSales,
  ] = results;
  const summary = await getCatalogSummary({ status: 'all' }, client);
  const readiness = await readinessCatalogInventory(client);

  const inventory = inventoryState.rows[0];
  const imageCoverage = ripleyImages.rows[0];
  const sales = salesIntegrity.rows[0];
  const direct = directSales.rows[0];
  const inactiveStock = sellerState.rows
    .filter((row) => row.status === 'inactive')
    .reduce((total, row) => total + Number(row.seller_stock), 0);

  check(Number(inventory.negative) === 0, 'Hay stock maestro negativo.', inventory);
  check(Number(inventory.bad_reserved) === 0, 'Hay reservas fuera del saldo maestro.', inventory);
  check(inactiveStock === 0, 'Una publicación inactiva conserva stock seller.', sellerState.rows);
  check(Number(imageCoverage.missing_images) === 0, 'Faltan imágenes de Ripley.', imageCoverage);
  check(Number(sales.unmapped) === 0, 'Hay ventas sin producto maestro desde junio.', sales);
  check(Number(sales.invalid_quantity) === 0, 'Hay ventas con cantidad inválida desde junio.', sales);
  check(pendingStock.rows.length === 0, 'Hay ventas recientes elegibles sin resolver.', pendingStock.rows);
  check(Number(impossibleShortages.rows[0].lines) === 0, 'Hay faltantes marcados aunque el maestro tiene stock.', impossibleShortages.rows[0]);
  check(Number(duplicateListings.rows[0].identities) === 0, 'Hay identidades de publicación duplicadas.', duplicateListings.rows[0]);
  check(Number(summary.unitsSold30) === Number(direct.units), 'El KPI Vendidas no coincide con las líneas de pedido.', {
    kpi: summary.unitsSold30,
    direct: Number(direct.units),
  });
  check(Math.abs(Number(summary.revenue30) - Number(direct.revenue)) < 0.01, 'El ingreso de 30 días no coincide.', {
    kpi: summary.revenue30,
    direct: Number(direct.revenue),
  });
  check(Number(summary.total) === productState.rows.reduce((total, row) => total + Number(row.products), 0), 'El KPI Productos no coincide con los maestros.', {
    kpi: summary.total,
    products: productState.rows,
  });
  check(Number(summary.unitsAvailable) === Number(inventory.available), 'El stock disponible del KPI no coincide con inventario maestro.', {
    kpi: summary.unitsAvailable,
    inventory: inventory.available,
  });
  check(Number(summary.unitsReserved) === Number(inventory.reserved), 'Las reservas del KPI no coinciden con inventario maestro.', {
    kpi: summary.unitsReserved,
    inventory: inventory.reserved,
  });
  check(readiness.error == null, 'No se pudo calcular el checklist de inventario.', readiness.error);
  check(readiness.steps.every((step) => step.ok || step.informationalOnly), 'El checklist de inventario conserva advertencias.', readiness.steps);

  console.log(JSON.stringify({
    ok: failures.length === 0,
    products: productState.rows,
    masterInventory: inventory,
    sellerListings: sellerState.rows,
    ripleyImages: imageCoverage,
    salesSinceJune: sales,
    kpis: summary,
    readiness: readiness.steps,
    variants: variants.rows,
    failures,
  }, null, 2));
  await client.query('rollback');
  if (failures.length) process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
