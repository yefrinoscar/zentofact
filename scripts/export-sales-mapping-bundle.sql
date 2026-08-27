-- Sales mapping bundle: Friday cutoff_quantity + Falabella/Ripley lines since May.
-- No products, product_inventory, or inventory_movements.
-- Run on the operational DB (not Railway):
--   psql "$DATABASE_URL_POSTGRES" -v ON_ERROR_STOP=1 -t -A -f scripts/export-sales-mapping-bundle.sql > sales-mapping-bundle.json

WITH sku_map(legacy, master) AS (
  VALUES
    ('AG94', 'G38L'),
    ('AG65', 'G44'),
    ('AG134', 'Z77'),
    ('AG296', 'G43'),
    ('AG104', 'Z5'),
    ('AG142', 'Z9'),
    ('AG297', 'Z34'),
    ('AG76', 'Z20'),
    ('AG144', 'AD060R'),
    ('AG87', 'G36'),
    ('AG174', 'Z7'),
    ('AG180', 'H32'),
    ('AG192', 'H25'),
    ('AG89', 'G47'),
    ('AG85', 'H30'),
    ('AG81', 'H9MB'),
    ('AG83', 'H9MN'),
    ('AG82', 'H9LB'),
    ('AG84', 'H9LN'),
    ('AG167', 'H9XLB'),
    ('AG166', 'H9XLN'),
    ('AG165', 'H13L'),
    ('AG110', 'H14'),
    ('AG163', 'H16'),
    ('AG298', 'G40L'),
    ('AG193', 'Z25'),
    ('AG129', 'G42N'),
    ('AG139', 'G42B'),
    ('AG128', 'H36'),
    ('AG108', 'G1FLORES'),
    ('AG274', 'G1HOJAS'),
    ('AG107', 'G1RAMAS'),
    ('AG159', 'H39'),
    ('AG171', 'G18'),
    ('AG157', 'H49'),
    ('AG115', 'G9'),
    ('AG168', 'G13'),
    ('AG121', 'G24N'),
    ('AG189', 'G26C'),
    ('AG123', 'G-28N'),
    ('AG169', 'G34C'),
    ('AG125', 'G35N'),
    ('AG301', 'G35V'),
    ('AG170', 'G35R'),
    ('AG126', 'G37'),
    ('AG140', 'H24'),
    ('AG112', 'HOG001'),
    ('AG141', 'HOG013'),
    ('AG120', 'G-25'),
    ('AG127', 'G-48'),
    ('AG172', 'G-20'),
    ('AG124', 'G-32'),
    ('AG113', 'HOG-12-002'),
    ('AG109', 'HOG-12-003'),
    ('AG155', 'HOG-12-004'),
    ('AC34', 'HOG-12-005'),
    ('AG223', 'HOG025'),
    ('AG173', 'G-8'),
    ('AG75', 'G-36'),
    ('AG119', 'G-2'),
    ('AG197', 'HOG028'),
    ('AG198', 'HOG029'),
    ('AG224', 'A-2'),
    ('AG201', 'A-25'),
    ('AG202', 'A-22'),
    ('AG212', 'A-33'),
    ('AG277', 'A-29'),
    ('AG210', 'A-30'),
    ('AG164', 'H13M'),
    ('AG299', 'G40XL'),
    ('G-19', 'G18'),
    ('G24CA', 'G24N')
),
counted(master) AS (
  VALUES ('A-2'), ('A-22'), ('A-25'), ('A-29'), ('A-30'), ('A-33'), ('AD060R'), ('AG203'), ('AG217'), ('AG218'), ('AG220'), ('AG271'), ('AG272'), ('AG3'), ('AG300'), ('G-2'), ('G-20'), ('G-25'), ('G-28N'), ('G-32'), ('G-36'), ('G-48'), ('G-8'), ('G13'), ('G18'), ('G1FLORES'), ('G1HOJAS'), ('G1RAMAS'), ('G24N'), ('G26C'), ('G34C'), ('G34R'), ('G35N'), ('G35R'), ('G35V'), ('G36'), ('G37'), ('G38L'), ('G40L'), ('G42B'), ('G42N'), ('G43'), ('G44'), ('G47'), ('G9'), ('H13L'), ('H14'), ('H16'), ('H24'), ('H25'), ('H30'), ('H32'), ('H36'), ('H39'), ('H49'), ('H9LB'), ('H9LN'), ('H9MB'), ('H9MN'), ('H9XLB'), ('H9XLN'), ('HOG-12-002'), ('HOG-12-003'), ('HOG-12-004'), ('HOG-12-005'), ('HOG001'), ('HOG013'), ('HOG025'), ('HOG028'), ('HOG029'), ('Z20'), ('Z25'), ('Z34'), ('Z5'), ('Z7'), ('Z77'), ('Z9')
),
run AS (
  SELECT id, source_hash, cutoff_at
  FROM inventory_reconciliation_runs
  WHERE cutoff_at = '2026-08-21T19:50:00.000Z'::timestamptz
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
    AND master_sku NOT IN ('AG103', 'AG146', 'AG147', 'AG158', 'G40XL', 'H13M')
  ORDER BY master_sku,
    CASE WHEN source_sku = master_sku THEN 0 ELSE 1 END,
    source_sku
),
excel_json AS (
  SELECT jsonb_build_object(
    'sourceHash', (SELECT source_hash FROM run),
    'source', 'reconciliation_anchors',
    'presentWithoutQuantity', to_jsonb(ARRAY['AG103', 'AG146', 'AG147', 'AG158', 'G40XL', 'H13M']::text[]),
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
      AND o.ordered_at >= '2026-05-01T05:00:00.000Z'::timestamptz
  ) c
),
listing_json AS (
  SELECT jsonb_agg(jsonb_build_object(
    'channel', l.channel_code,
    'companyRuc', c.ruc,
    'sellerSku', l.seller_sku,
    'shopSku', l.shop_sku,
    'productSku', CASE
      WHEN p.main_sku IS NULL THEN NULL
      ELSE COALESCE(m.master, p.main_sku)
    END,
    'status', l.status,
    'title', l.title
  ) ORDER BY l.id) AS value
  FROM product_listings l
  JOIN companies c ON c.id = l.company_id
  LEFT JOIN products p ON p.id = l.product_id
  LEFT JOIN sku_map m ON m.legacy = p.main_sku
  WHERE l.channel_code IN ('falabella', 'ripley')
    AND c.id IN (
      SELECT DISTINCT o.company_id
      FROM orders o
      JOIN order_channel_accounts a ON a.id = o.channel_account_id
      JOIN order_channels ch ON ch.id = a.channel_id
      WHERE ch.code IN ('falabella', 'ripley')
        AND o.ordered_at >= '2026-05-01T05:00:00.000Z'::timestamptz
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
        'productSku', COALESCE(m.master, p.main_sku, oi.main_sku),
        'description', oi.description,
        'quantity', oi.quantity
      ) ORDER BY oi.id)
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      LEFT JOIN sku_map m ON m.legacy = COALESCE(p.main_sku, oi.main_sku)
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
    AND o.ordered_at >= '2026-05-01T05:00:00.000Z'::timestamptz
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
    'since', '2026-05-01T05:00:00.000Z',
    'cutoffAt', '2026-08-21T19:50:00.000Z',
    'excel', (SELECT value FROM excel_json),
    'companies', COALESCE((SELECT value FROM company_json), '[]'::jsonb),
    'listings', COALESCE((SELECT value FROM listing_json), '[]'::jsonb),
    'orders', COALESCE((SELECT jsonb_agg(value ORDER BY id) FROM order_rows), '[]'::jsonb)
  )
END;
