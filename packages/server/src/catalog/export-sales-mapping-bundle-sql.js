import {
  INVENTORY_COUNT_MASTER_SKUS,
  INVENTORY_COUNT_SKUS_WITHOUT_QUANTITY,
} from '../../../../scripts/lib/inventory-count-2026-08-21.mjs';
import {
  HISTORICAL_SKU_TO_MASTER,
  followHistoricalSku,
} from './historical-sku-map.js';
import { ORDER_SINCE_SQL, PHYSICAL_COUNT_CUTOFF, SALES_HISTORY_SINCE } from './historical-sales-mapping.js';

function sqlStr(value) {
  return `'${String(value).replaceAll('\'', '\'\'')}'`;
}

function sqlValues(entries) {
  return entries.map(([left, right]) => `(${sqlStr(left)}, ${sqlStr(right)})`).join(',\n    ');
}

export function renderExportSalesMappingBundleSql() {
  const skuMap = Object.entries(HISTORICAL_SKU_TO_MASTER)
    .map(([sku]) => [sku, followHistoricalSku(sku)])
    .filter(([sku, master]) => sku && master)
    .sort((left, right) => String(left[0]).localeCompare(String(right[0])));
  const counted = [...INVENTORY_COUNT_MASTER_SKUS].sort();
  const noQty = [...INVENTORY_COUNT_SKUS_WITHOUT_QUANTITY].sort();
  return `-- Sales mapping bundle: Friday cutoff_quantity + Falabella/Ripley lines since May.
-- No products, product_inventory, or inventory_movements.
-- Run on the operational DB (not Railway):
--   psql "$DATABASE_URL_POSTGRES" -v ON_ERROR_STOP=1 -t -A -f scripts/export-sales-mapping-bundle.sql > sales-mapping-bundle.json

WITH sku_map(legacy, master) AS (
  VALUES
    ${sqlValues(skuMap)}
),
counted(master) AS (
  VALUES ${counted.map((sku) => `(${sqlStr(sku)})`).join(', ')}
),
run AS (
  SELECT id, source_hash, cutoff_at
  FROM inventory_reconciliation_runs
  WHERE cutoff_at = ${sqlStr(PHYSICAL_COUNT_CUTOFF)}::timestamptz
  ORDER BY applied_at DESC, id DESC
  LIMIT 1
),
remapped AS (
  SELECT
    COALESCE(m.master, p.main_sku) AS master_sku,
    ROUND(a.cutoff_quantity)::integer AS qty,
    p.main_sku AS source_sku
  FROM inventory_reconciliation_anchors a
  JOIN run ON run.id = a.run_id
  JOIN products p ON p.id = a.product_id
  LEFT JOIN sku_map m ON m.legacy = p.main_sku
),
picked AS (
  SELECT DISTINCT ON (master_sku)
    master_sku,
    qty
  FROM remapped
  WHERE master_sku IN (SELECT master FROM counted)
    AND master_sku NOT IN (${noQty.map(sqlStr).join(', ')})
  ORDER BY master_sku,
    CASE WHEN source_sku = master_sku THEN 0 ELSE 1 END,
    source_sku
),
excel_json AS (
  SELECT jsonb_build_object(
    'sourceHash', (SELECT source_hash FROM run),
    'source', 'reconciliation_anchors',
    'presentWithoutQuantity', to_jsonb(ARRAY[${noQty.map(sqlStr).join(', ')}]::text[]),
    'targets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'masterSku', c.master,
        'sourceRows', '[]'::jsonb,
        'targetQuantity', p.qty
      ) ORDER BY c.master)
      FROM counted c
      LEFT JOIN picked p ON p.master_sku = c.master
    ), '[]'::jsonb)
  ) AS value
),
company_json AS (
  SELECT jsonb_agg(jsonb_build_object(
    'ruc', c.ruc,
    'nombre', c.nombre,
    'nombreComercial', c.nombre_comercial,
    'razonSocial', c.razon_social
  ) ORDER BY c.id) AS value
  FROM (
    SELECT DISTINCT c.id, c.ruc, c.nombre, c.nombre_comercial, c.razon_social
    FROM companies c
    JOIN orders o ON o.company_id = c.id
    JOIN order_channel_accounts a ON a.id = o.channel_account_id
    JOIN order_channels ch ON ch.id = a.channel_id
    WHERE ch.code IN ('falabella', 'ripley')
      AND ${ORDER_SINCE_SQL} >= ${sqlStr(SALES_HISTORY_SINCE)}::timestamptz
    UNION
    SELECT DISTINCT c.id, c.ruc, c.nombre, c.nombre_comercial, c.razon_social
    FROM companies c
    JOIN falabella_orders fo ON fo.company_id = c.id
    WHERE coalesce(fo.falabella_created_at, fo.first_seen_at) >= ${sqlStr(SALES_HISTORY_SINCE)}::timestamptz
  ) c
),
listing_json AS (
  SELECT jsonb_agg(jsonb_build_object(
    'channel', l.channel_code,
    'companyRuc', c.ruc,
    'sellerSku', l.seller_sku,
    'shopSku', l.shop_sku,
    'productSku', CASE
      WHEN COALESCE(ms.master, mh.master, m.master, p.main_sku) IS NULL THEN NULL
      ELSE COALESCE(ms.master, mh.master, m.master, p.main_sku)
    END,
    'status', l.status,
    'title', l.title
  ) ORDER BY l.id) AS value
  FROM product_listings l
  JOIN companies c ON c.id = l.company_id
  LEFT JOIN products p ON p.id = l.product_id
  LEFT JOIN sku_map m ON m.legacy = p.main_sku
  LEFT JOIN sku_map ms ON ms.legacy = l.seller_sku
  LEFT JOIN sku_map mh ON mh.legacy = l.shop_sku
  WHERE l.channel_code IN ('falabella', 'ripley')
    AND c.id IN (
      SELECT DISTINCT o.company_id
      FROM orders o
      JOIN order_channel_accounts a ON a.id = o.channel_account_id
      JOIN order_channels ch ON ch.id = a.channel_id
      WHERE ch.code IN ('falabella', 'ripley')
        AND ${ORDER_SINCE_SQL} >= ${sqlStr(SALES_HISTORY_SINCE)}::timestamptz
      UNION
      SELECT DISTINCT fo.company_id
      FROM falabella_orders fo
      WHERE coalesce(fo.falabella_created_at, fo.first_seen_at) >= ${sqlStr(SALES_HISTORY_SINCE)}::timestamptz
    )
),
order_rows AS (
  SELECT o.id, jsonb_build_object(
    'channel', ch.code,
    'companyRuc', c.ruc,
    'externalOrderId', o.external_order_id,
    'externalOrderNumber', o.external_order_number,
    'orderedAt', ${ORDER_SINCE_SQL},
    'orderStatus', o.order_status,
    'fulfillmentStatus', o.fulfillment_status,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'externalItemId', oi.external_item_id,
        'sku', oi.sku,
        'providerSku', oi.provider_sku,
        'productSku', COALESCE(m_sku.master, m_shop.master, m.master, p.main_sku, oi.main_sku),
        'description', oi.description,
        'quantity', oi.quantity,
        'rawData', CASE
          WHEN oi.raw_data ? 'Quantity' THEN jsonb_build_object('Quantity', oi.raw_data->'Quantity')
          ELSE '{}'::jsonb
        END
      ) ORDER BY oi.id)
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      LEFT JOIN sku_map m ON m.legacy = COALESCE(p.main_sku, oi.main_sku)
      LEFT JOIN sku_map m_sku ON m_sku.legacy = oi.sku
      LEFT JOIN sku_map m_shop ON m_shop.legacy = oi.provider_sku
      WHERE oi.order_id = o.id
    ), '[]'::jsonb),
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'eventType', e.event_type,
        'providerOccurredAt', e.provider_occurred_at,
        'newValues', e.new_values
      ) ORDER BY e.id)
      FROM order_events e
      WHERE e.order_id = o.id
        AND e.provider_occurred_at IS NOT NULL
    ), '[]'::jsonb)
  ) AS value
  FROM orders o
  JOIN companies c ON c.id = o.company_id
  JOIN order_channel_accounts a ON a.id = o.channel_account_id
  JOIN order_channels ch ON ch.id = a.channel_id
  WHERE ch.code IN ('falabella', 'ripley')
    AND ${ORDER_SINCE_SQL} >= ${sqlStr(SALES_HISTORY_SINCE)}::timestamptz
),
falabella_inbox_json AS (
  SELECT jsonb_agg(jsonb_build_object(
    'companyRuc', inbox.ruc,
    'orderId', inbox.order_id,
    'orderNumber', inbox.order_number,
    'orderedAt', inbox.falabella_created_at,
    'updatedAt', inbox.falabella_updated_at,
    'status', inbox.status,
    'rawData', jsonb_build_object(
      'OrderItems', COALESCE(
        inbox.raw_data->'OrderItems',
        inbox.raw_data->'orderItems',
        inbox.raw_data#>'{SuccessResponse,Body,OrderItems}',
        inbox.raw_data->'Items',
        inbox.raw_data#>'{data,OrderItems}',
        inbox.raw_data#>'{data,orderItems}'
      )
    )
  ) ORDER BY inbox.falabella_created_at, inbox.order_id) AS value
  FROM (
    SELECT c.ruc, fo.order_id, fo.order_number, fo.status,
      fo.falabella_created_at, fo.falabella_updated_at, fo.raw_data
    FROM falabella_orders fo
    JOIN companies c ON c.id = fo.company_id
    WHERE coalesce(fo.falabella_created_at, fo.first_seen_at) >= ${sqlStr(SALES_HISTORY_SINCE)}::timestamptz
  ) inbox
)
SELECT CASE
  WHEN NOT EXISTS (SELECT 1 FROM run) THEN
    jsonb_build_object('version', 1, 'error', 'missing_friday_anchor')
  WHEN EXISTS (SELECT 1 FROM counted c LEFT JOIN picked p ON p.master_sku = c.master WHERE p.qty IS NULL) THEN
    jsonb_build_object(
      'version', 1,
      'error', 'incomplete_friday_count',
      'missing', COALESCE((
        SELECT jsonb_agg(c.master ORDER BY c.master)
        FROM counted c
        LEFT JOIN picked p ON p.master_sku = c.master
        WHERE p.qty IS NULL
      ), '[]'::jsonb)
    )
  ELSE jsonb_build_object(
    'version', 1,
    'since', ${sqlStr(SALES_HISTORY_SINCE)},
    'cutoffAt', ${sqlStr(PHYSICAL_COUNT_CUTOFF)},
    'excel', (SELECT value FROM excel_json),
    'companies', COALESCE((SELECT value FROM company_json), '[]'::jsonb),
    'listings', COALESCE((SELECT value FROM listing_json), '[]'::jsonb),
    'orders', COALESCE((SELECT jsonb_agg(value ORDER BY id) FROM order_rows), '[]'::jsonb),
    'falabellaOrders', COALESCE((SELECT value FROM falabella_inbox_json), '[]'::jsonb)
  )
END;
`;
}
