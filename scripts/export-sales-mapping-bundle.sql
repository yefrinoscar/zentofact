-- Sales mapping bundle: Friday cutoff_quantity + Falabella/Ripley lines since May.
-- No products, product_inventory, or inventory_movements.
-- Run on the operational DB (not Railway):
--   psql "$DATABASE_URL_POSTGRES" -v ON_ERROR_STOP=1 -t -A -f scripts/export-sales-mapping-bundle.sql > sales-mapping-bundle.json

WITH sku_map(legacy, master) AS (
  VALUES
    ('115839107', 'FAL-115839107'),
    ('123389143', 'FAL-123389143'),
    ('123412asdfa', 'G35V'),
    ('129752150', 'AG227'),
    ('1354xssew', 'G35V'),
    ('140715461', 'FAL-140715461'),
    ('140746934', 'H9XLN'),
    ('143571425', 'G35V'),
    ('1441852874', 'A-25'),
    ('144956424', 'FAL-144958533'),
    ('144958533', 'FAL-144958533'),
    ('144962663', 'FAL-144962663'),
    ('146325030', 'FAL-146325783'),
    ('146325783', 'FAL-146325783'),
    ('148126523', 'AG218'),
    ('148145225', 'A-25'),
    ('151159665', 'FAL-151159665'),
    ('1512351', 'FAL-146325783'),
    ('156582201', 'G34R'),
    ('23123asdfef', 'FAL-144958533'),
    ('357258624678', 'FAL-146325783'),
    ('426745', 'FAL-144958533'),
    ('6846846846465', 'FAL-151159665'),
    ('9522514852', 'H36'),
    ('AC34', 'HOG-12-005'),
    ('AFE781187', 'FAL-123389143'),
    ('AG104', 'Z5'),
    ('AG107', 'G1RAMAS'),
    ('AG108', 'G1FLORES'),
    ('AG109', 'HOG-12-003'),
    ('AG110', 'H14'),
    ('AG112', 'HOG001'),
    ('AG113', 'HOG-12-002'),
    ('AG115', 'G9'),
    ('AG119', 'G-2'),
    ('AG120', 'G-25'),
    ('AG121', 'G24N'),
    ('AG123', 'G-28N'),
    ('AG124', 'G-32'),
    ('AG125', 'G35N'),
    ('AG126', 'G37'),
    ('AG127', 'G-48'),
    ('AG128', 'H36'),
    ('AG129', 'G42N'),
    ('AG134', 'Z77'),
    ('AG139', 'G42B'),
    ('AG140', 'H24'),
    ('AG141', 'HOG013'),
    ('AG142', 'Z9'),
    ('AG144', 'AD060R'),
    ('AG155', 'HOG-12-004'),
    ('AG157', 'H49'),
    ('AG159', 'H39'),
    ('AG163', 'H16'),
    ('AG164', 'H13M'),
    ('AG165', 'H13L'),
    ('AG166', 'H9XLN'),
    ('AG167', 'H9XLB'),
    ('AG168', 'G13'),
    ('AG169', 'G34C'),
    ('AG170', 'G35R'),
    ('AG171', 'G18'),
    ('AG172', 'G-20'),
    ('AG173', 'G-8'),
    ('AG174', 'Z7'),
    ('AG180', 'H32'),
    ('AG189', 'G26C'),
    ('AG192', 'H25'),
    ('AG193', 'Z25'),
    ('AG197', 'HOG028'),
    ('AG198', 'HOG029'),
    ('AG201', 'A-25'),
    ('AG202', 'A-22'),
    ('AG210', 'A-30'),
    ('AG212', 'A-33'),
    ('AG223', 'HOG025'),
    ('AG224', 'A-2'),
    ('AG274', 'G1HOJAS'),
    ('AG277', 'A-29'),
    ('AG296', 'G43'),
    ('AG297', 'Z34'),
    ('AG298', 'G40L'),
    ('AG299', 'G40XL'),
    ('AG301', 'G35V'),
    ('AG65', 'G44'),
    ('AG75', 'G-36'),
    ('AG76', 'Z20'),
    ('AG81', 'H9MB'),
    ('AG82', 'H9LB'),
    ('AG83', 'H9MN'),
    ('AG84', 'H9LN'),
    ('AG85', 'H30'),
    ('AG87', 'G36'),
    ('AG89', 'G47'),
    ('AG94', 'G38L'),
    ('AS544145685', 'FAL-115839107'),
    ('BIC-100235', 'G42N'),
    ('BIC-100236', 'G42B'),
    ('BIC-105528', 'G42B'),
    ('BOT-105522', 'AM7'),
    ('CAM-104497', 'AG295'),
    ('CHA1234', 'AG290'),
    ('CHA12345678', 'AG186'),
    ('CON09832134', 'Z7'),
    ('CTF44329989', 'Z7'),
    ('ESC-1058777', 'A-29'),
    ('EST-102235', 'H49'),
    ('FLO4400237', 'Z7'),
    ('G-19', 'G18'),
    ('G24CA', 'G24N'),
    ('GUA-104005', 'AG293'),
    ('GUA-104022', 'H13M'),
    ('GUA-104023', 'H13L'),
    ('GUA-107755', 'G38L'),
    ('hsfds', 'G35V'),
    ('LAM-203320', 'AG292'),
    ('MAQ1234', 'G47'),
    ('MES-1055777', 'HOG-12-004'),
    ('MUE-102257', 'AG138'),
    ('OM21221112', 'FAL-140715461'),
    ('PIL-103669', 'AG86'),
    ('PÑL12309854', 'AG79'),
    ('S118834', 'HOG-12-002'),
    ('S118837', 'AG291'),
    ('S118856', 'H9LB'),
    ('S119228', 'HOG-12-003'),
    ('S119231', 'H36'),
    ('S119266', 'G1RAMAS'),
    ('S119268', 'G1FLORES'),
    ('S119279', 'G18'),
    ('S126694', 'H9XLB'),
    ('S126695', 'H9MN'),
    ('S126696', 'H9LN'),
    ('S126697', 'H9XLN'),
    ('S126717', 'G1HOJAS'),
    ('S126718', 'G18'),
    ('S166229', 'G18'),
    ('S166230', 'G18'),
    ('S166238', 'G9'),
    ('S166285', 'G35V'),
    ('S166287', 'AG294'),
    ('S166292', 'G-48'),
    ('SCA-101055', 'HOG013'),
    ('SCA-103341', 'AG289'),
    ('SET-777810', 'Z7'),
    ('SIL-200358', 'H39'),
    ('TRI-100357', 'G36'),
    ('TRI-100358', 'AG227'),
    ('TRI09812784', 'AG227'),
    ('TRI65748392', 'AG227'),
    ('ZAP-1077739', 'G-8'),
    ('ZAP-108088', 'Z25')
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
      AND coalesce(o.ordered_at, o.created_at) >= '2026-05-01T05:00:00.000Z'::timestamptz
    UNION
    SELECT DISTINCT c.id, c.ruc, c.nombre, c.nombre_comercial, c.razon_social
    FROM companies c
    JOIN falabella_orders fo ON fo.company_id = c.id
    WHERE coalesce(fo.falabella_created_at, fo.first_seen_at) >= '2026-05-01T05:00:00.000Z'::timestamptz
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
        AND coalesce(o.ordered_at, o.created_at) >= '2026-05-01T05:00:00.000Z'::timestamptz
      UNION
      SELECT DISTINCT fo.company_id
      FROM falabella_orders fo
      WHERE coalesce(fo.falabella_created_at, fo.first_seen_at) >= '2026-05-01T05:00:00.000Z'::timestamptz
    )
),
order_rows AS (
  SELECT o.id, jsonb_build_object(
    'channel', ch.code,
    'companyRuc', c.ruc,
    'externalOrderId', o.external_order_id,
    'externalOrderNumber', o.external_order_number,
    'orderedAt', coalesce(o.ordered_at, o.created_at),
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
    ), '[]'::jsonb),
    'rawPayload', (
      SELECT s.raw_payload
      FROM order_snapshots s
      WHERE s.order_id = o.id
      ORDER BY s.observed_at DESC, s.id DESC
      LIMIT 1
    )
  ) AS value
  FROM orders o
  JOIN companies c ON c.id = o.company_id
  JOIN order_channel_accounts a ON a.id = o.channel_account_id
  JOIN order_channels ch ON ch.id = a.channel_id
  WHERE ch.code IN ('falabella', 'ripley')
    AND coalesce(o.ordered_at, o.created_at) >= '2026-05-01T05:00:00.000Z'::timestamptz
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
    WHERE coalesce(fo.falabella_created_at, fo.first_seen_at) >= '2026-05-01T05:00:00.000Z'::timestamptz
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
    'since', '2026-05-01T05:00:00.000Z',
    'cutoffAt', '2026-08-21T19:50:00.000Z',
    'excel', (SELECT value FROM excel_json),
    'companies', COALESCE((SELECT value FROM company_json), '[]'::jsonb),
    'listings', COALESCE((SELECT value FROM listing_json), '[]'::jsonb),
    'orders', COALESCE((SELECT jsonb_agg(value ORDER BY id) FROM order_rows), '[]'::jsonb),
    'falabellaOrders', COALESCE((SELECT value FROM falabella_inbox_json), '[]'::jsonb)
  )
END;
