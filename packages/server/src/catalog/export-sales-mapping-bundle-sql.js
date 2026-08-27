import {
  INVENTORY_COUNT_MASTER_SKUS,
  INVENTORY_COUNT_SKUS_WITHOUT_QUANTITY,
} from '../../../../scripts/lib/inventory-count-2026-08-21.mjs';
import {
  EXCEL_ROW_ALIAS_TO_MASTER,
  LEGACY_AG_TO_EXCEL,
} from './historical-sku-map.js';
import { PHYSICAL_COUNT_CUTOFF, SALES_HISTORY_SINCE } from './historical-sales-mapping.js';

function sqlStr(value) {
  return `'${String(value).replaceAll('\'', '\'\'')}'`;
}

function sqlValues(entries) {
  return entries.map(([left, right]) => `(${sqlStr(left)}, ${sqlStr(right)})`).join(',\n    ');
}

export function renderExportSalesMappingBundleSql() {
  const skuMap = Object.entries({ ...LEGACY_AG_TO_EXCEL, ...EXCEL_ROW_ALIAS_TO_MASTER });
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
      AND o.ordered_at >= ${sqlStr(SALES_HISTORY_SINCE)}::timestamptz
  ) c
),
listing_json AS (
  SELECT jsonb_agg(jsonb_build_object(
    'channel', l.channel_code,
    'companyRuc', c.ruc,
    'sellerSku', l.seller_sku,
    'shopSku', l.shop_sku,
    'status', l.status,
    'title', l.title
  ) ORDER BY l.id) AS value
  FROM product_listings l
  JOIN companies c ON c.id = l.company_id
  WHERE l.channel_code IN ('falabella', 'ripley')
    AND c.id IN (
      SELECT DISTINCT o.company_id
      FROM orders o
      JOIN order_channel_accounts a ON a.id = o.channel_account_id
      JOIN order_channels ch ON ch.id = a.channel_id
      WHERE ch.code IN ('falabella', 'ripley')
        AND o.ordered_at >= ${sqlStr(SALES_HISTORY_SINCE)}::timestamptz
    )
),
order_rows AS (
  SELECT o.id, jsonb_build_object(
    'channel', ch.code,
    'companyRuc', c.ruc,
    'externalOrderId', o.external_order_id,
    'externalOrderNumber', o.external_order_number,
    'orderedAt', o.ordered_at,
    'orderStatus', o.order_status,
    'fulfillmentStatus', o.fulfillment_status,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'externalItemId', oi.external_item_id,
        'sku', oi.sku,
        'providerSku', oi.provider_sku,
        'description', oi.description,
        'quantity', oi.quantity
      ) ORDER BY oi.id)
      FROM order_items oi
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
    AND o.ordered_at >= ${sqlStr(SALES_HISTORY_SINCE)}::timestamptz
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
    'orders', COALESCE((SELECT jsonb_agg(value ORDER BY id) FROM order_rows), '[]'::jsonb)
  )
END;
`;
}
