-- Backfill acotado a tres manifiestos creados el 2026-08-07.
-- Ejecutar únicamente después de la migración que crea falabella_manifests y
-- falabella_manifest_orders. Resuelve compañías por RUC, nunca por ID local.

BEGIN ISOLATION LEVEL SERIALIZABLE;

CREATE TEMP TABLE _falabella_manifest_backfill (
  ruc TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  manifest_id TEXT NOT NULL,
  manifest_code TEXT NOT NULL,
  shipment_provider TEXT NOT NULL,
  status TEXT NOT NULL,
  item_count INTEGER NOT NULL,
  provider_created_at TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL,
  manifest_first_seen_at TIMESTAMPTZ NOT NULL,
  manifest_last_seen_at TIMESTAMPTZ NOT NULL,
  local_order_id TEXT NOT NULL,
  order_number TEXT NOT NULL,
  delivery_order_number TEXT NOT NULL,
  order_first_seen_at TIMESTAMPTZ NOT NULL,
  order_last_seen_at TIMESTAMPTZ NOT NULL
) ON COMMIT DROP;

INSERT INTO _falabella_manifest_backfill VALUES
  (
    '20612400866', 'INVERSIONES YAKURUNA E.I.R.L.',
    'b42776e8-d94d-4d43-89b4-9c7edda502b3', 'MFJB/SC8CD8E/20260807134925267',
    'falabella', 'Pending', 1,
    '2026-08-07T18:49:00.000Z', '2026-08-07T18:49:27.700Z',
    '2026-08-07T18:49:27.700Z', '2026-08-07T20:41:55.412Z',
    '5004335471', '3247726465', '3247726465',
    '2026-08-07T18:49:27.700Z', '2026-08-07T18:49:27.700Z'
  ),
  (
    '20612400882', 'RUNAPUMA E.I.R.L',
    '36cc3d52-53d4-4958-8ad1-1e8c6094b91f', 'MFJB/SCAEB60/20260807134948299',
    'falabella', 'Pending', 1,
    '2026-08-07T18:49:00.000Z', '2026-08-07T18:49:52.562Z',
    '2026-08-07T18:49:52.562Z', '2026-08-07T20:42:13.768Z',
    '5004335483', '3247726522', '3247726522',
    '2026-08-07T18:49:52.562Z', '2026-08-07T18:49:52.562Z'
  ),
  (
    '20612795305', 'IMPORTACIONES STARFISH E.I.R.L.',
    'e6e7c162-780c-4e6b-b9db-08861b95d4de', 'MFJB/SC8F004/20260807135011869',
    'falabella', 'Pending', 1,
    '2026-08-07T18:50:00.000Z', '2026-08-07T18:50:13.087Z',
    '2026-08-07T18:50:13.087Z', '2026-08-07T20:42:34.072Z',
    '5004336196', '3247729644', '3247729644',
    '2026-08-07T18:50:13.087Z', '2026-08-07T18:50:13.087Z'
  );

DO $backfill_checks$
DECLARE
  problem TEXT;
BEGIN
  IF (SELECT count(*) FROM _falabella_manifest_backfill) <> 3 THEN
    RAISE EXCEPTION 'Backfill abortado: el payload no contiene exactamente 3 filas';
  END IF;

  SELECT string_agg(format('RUC %s tiene %s filas en companies', ruc, company_rows), '; ')
  INTO problem
  FROM (
    SELECT p.ruc, count(c.id) AS company_rows
    FROM _falabella_manifest_backfill p
    LEFT JOIN companies c ON c.ruc=p.ruc
    GROUP BY p.ruc
    HAVING count(c.id) <> 1
  ) invalid_companies;
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'Backfill abortado: %', problem;
  END IF;

  problem := NULL;
  SELECT string_agg(format(
    'RUC %s / pedido %s: %s coincidencias, %s listas para enviar',
    ruc, order_number, order_rows, ready_rows
  ), '; ')
  INTO problem
  FROM (
    SELECT
      p.ruc,
      p.order_number,
      count(o.id) AS order_rows,
      count(o.id) FILTER (WHERE
        lower(coalesce(o.status, '')) ~ '(^|[|])ready_to_ship([|]|$)'
        AND lower(coalesce(o.status, '')) !~ '(^|[|])(pending|shipped)([|]|$)'
      ) AS ready_rows
    FROM _falabella_manifest_backfill p
    JOIN companies c ON c.ruc=p.ruc
    LEFT JOIN falabella_orders o
      ON o.company_id=c.id
     AND o.order_id=p.local_order_id
     AND o.order_number=p.order_number
    GROUP BY p.ruc, p.order_number
    HAVING count(o.id) <> 1 OR count(o.id) FILTER (WHERE
      lower(coalesce(o.status, '')) ~ '(^|[|])ready_to_ship([|]|$)'
      AND lower(coalesce(o.status, '')) !~ '(^|[|])(pending|shipped)([|]|$)'
    ) <> 1
  ) invalid_orders;
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'Backfill abortado: %', problem;
  END IF;

  SELECT format(
    'RUC %s: UUID/código existente incompatible (%s / %s)',
    p.ruc, m.manifest_id, m.manifest_code
  )
  INTO problem
  FROM _falabella_manifest_backfill p
  JOIN companies c ON c.ruc=p.ruc
  JOIN falabella_manifests m ON m.company_id=c.id
  WHERE (m.manifest_id=p.manifest_id
      AND NULLIF(m.manifest_code, '') IS NOT NULL
      AND m.manifest_code <> p.manifest_code)
     OR (m.manifest_code=p.manifest_code AND m.manifest_id <> p.manifest_id)
  LIMIT 1;
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'Backfill abortado: %', problem;
  END IF;

  problem := NULL;
  SELECT format(
    'RUC %s: pedido existente incompatible (%s / %s / %s -> %s)',
    p.ruc, o.local_order_id, o.order_number, o.delivery_order_number, o.manifest_id
  )
  INTO problem
  FROM _falabella_manifest_backfill p
  JOIN companies c ON c.ruc=p.ruc
  JOIN falabella_manifest_orders o ON o.company_id=c.id
  WHERE (o.local_order_id=p.local_order_id AND (
           o.manifest_id <> p.manifest_id
        OR o.order_number <> p.order_number
        OR o.delivery_order_number <> p.delivery_order_number
        ))
     OR (o.order_number=p.order_number AND (
           o.local_order_id <> p.local_order_id
        OR o.manifest_id <> p.manifest_id
        ))
     OR (o.delivery_order_number=p.delivery_order_number AND (
           o.local_order_id <> p.local_order_id
        OR o.manifest_id <> p.manifest_id
        ))
  LIMIT 1;
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'Backfill abortado: %', problem;
  END IF;

  problem := NULL;
  SELECT format(
    'RUC %s: el manifiesto %s ya está asociado a otro pedido %s',
    p.ruc, p.manifest_id, o.order_number
  )
  INTO problem
  FROM _falabella_manifest_backfill p
  JOIN companies c ON c.ruc=p.ruc
  JOIN falabella_manifest_orders o
    ON o.company_id=c.id AND o.manifest_id=p.manifest_id
  WHERE o.local_order_id <> p.local_order_id
  LIMIT 1;
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'Backfill abortado: %', problem;
  END IF;
END
$backfill_checks$;

INSERT INTO falabella_manifests AS current_manifest (
  company_id, manifest_id, manifest_code, shipment_provider, tracking_code,
  status, item_count, provider_created_at, created_by_app, source, synced_at,
  first_seen_at, last_seen_at
)
SELECT
  c.id, p.manifest_id, p.manifest_code, p.shipment_provider, p.manifest_code,
  p.status, p.item_count, p.provider_created_at, TRUE, 'seller_center', p.synced_at,
  p.manifest_first_seen_at, p.manifest_last_seen_at
FROM _falabella_manifest_backfill p
JOIN companies c ON c.ruc=p.ruc
ON CONFLICT (company_id, manifest_id) DO UPDATE SET
  manifest_code=EXCLUDED.manifest_code,
  shipment_provider=CASE
    WHEN current_manifest.shipment_provider='' THEN EXCLUDED.shipment_provider
    ELSE current_manifest.shipment_provider
  END,
  tracking_code=CASE
    WHEN current_manifest.tracking_code='' THEN EXCLUDED.tracking_code
    ELSE current_manifest.tracking_code
  END,
  status=CASE
    WHEN current_manifest.status='' THEN EXCLUDED.status
    ELSE current_manifest.status
  END,
  item_count=GREATEST(current_manifest.item_count, EXCLUDED.item_count),
  provider_created_at=COALESCE(current_manifest.provider_created_at, EXCLUDED.provider_created_at),
  created_by_app=current_manifest.created_by_app OR EXCLUDED.created_by_app,
  source=CASE WHEN current_manifest.source='' THEN EXCLUDED.source ELSE current_manifest.source END,
  synced_at=GREATEST(current_manifest.synced_at, EXCLUDED.synced_at),
  first_seen_at=LEAST(current_manifest.first_seen_at, EXCLUDED.first_seen_at),
  last_seen_at=GREATEST(current_manifest.last_seen_at, EXCLUDED.last_seen_at);

INSERT INTO falabella_manifest_orders AS current_order (
  company_id, manifest_id, local_order_id, order_number, delivery_order_number,
  first_seen_at, last_seen_at
)
SELECT
  c.id, p.manifest_id, p.local_order_id, p.order_number, p.delivery_order_number,
  p.order_first_seen_at, p.order_last_seen_at
FROM _falabella_manifest_backfill p
JOIN companies c ON c.ruc=p.ruc
ON CONFLICT (company_id, local_order_id) DO UPDATE SET
  manifest_id=EXCLUDED.manifest_id,
  order_number=EXCLUDED.order_number,
  delivery_order_number=EXCLUDED.delivery_order_number,
  first_seen_at=LEAST(current_order.first_seen_at, EXCLUDED.first_seen_at),
  last_seen_at=GREATEST(current_order.last_seen_at, EXCLUDED.last_seen_at);

DO $backfill_verify$
DECLARE
  matched_rows INTEGER;
BEGIN
  SELECT count(*)
  INTO matched_rows
  FROM _falabella_manifest_backfill p
  JOIN companies c ON c.ruc=p.ruc
  JOIN falabella_manifests m
    ON m.company_id=c.id
   AND m.manifest_id=p.manifest_id
   AND m.manifest_code=p.manifest_code
  JOIN falabella_manifest_orders o
    ON o.company_id=c.id
   AND o.manifest_id=p.manifest_id
   AND o.local_order_id=p.local_order_id
   AND o.order_number=p.order_number
   AND o.delivery_order_number=p.delivery_order_number;

  IF matched_rows <> 3 THEN
    RAISE EXCEPTION 'Backfill abortado: se verificaron % filas, se esperaban 3', matched_rows;
  END IF;
END
$backfill_verify$;

SELECT
  p.company_name,
  p.ruc,
  c.id AS resolved_company_id,
  m.manifest_id,
  m.manifest_code,
  o.local_order_id,
  o.order_number,
  o.delivery_order_number,
  m.created_by_app,
  m.status,
  m.pdf_byte_size
FROM _falabella_manifest_backfill p
JOIN companies c ON c.ruc=p.ruc
JOIN falabella_manifests m
  ON m.company_id=c.id AND m.manifest_id=p.manifest_id
JOIN falabella_manifest_orders o
  ON o.company_id=c.id AND o.manifest_id=p.manifest_id
ORDER BY p.ruc;

COMMIT;
