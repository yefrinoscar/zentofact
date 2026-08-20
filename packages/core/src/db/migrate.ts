import type { Pool } from 'pg';

// Idempotent Postgres schema bootstrap.
// Safe to call on every startup; uses CREATE TABLE / INDEX IF NOT EXISTS.
const DDL = `
  CREATE TABLE IF NOT EXISTS companies (
    id SERIAL PRIMARY KEY,
    nombre TEXT,
    ruc TEXT NOT NULL,
    razon_social TEXT NOT NULL,
    nombre_comercial TEXT,
    direccion TEXT,
    ubigeo TEXT,
    distrito TEXT,
    provincia TEXT,
    departamento TEXT,
    telefono TEXT,
    email TEXT,
    usuario_sol TEXT,
    clave_sol TEXT,
    certificado TEXT,
    certificado_password TEXT,
    seller_username TEXT,
    seller_password TEXT,
    falabella_api_user_id TEXT,
    falabella_api_key TEXT,
    ripley_api_key TEXT,
    ripley_shop_id TEXT,
    logo_path TEXT,
    activo BOOLEAN DEFAULT TRUE,
    created_at BIGINT,
    updated_at BIGINT
  );

  CREATE TABLE IF NOT EXISTS branches (
    id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    codigo TEXT NOT NULL,
    nombre TEXT NOT NULL,
    direccion TEXT,
    ubigeo TEXT,
    distrito TEXT,
    provincia TEXT,
    departamento TEXT,
    telefono TEXT,
    email TEXT,
    series_factura JSONB,
    series_boleta JSONB,
    series_nota_credito JSONB,
    series_nota_debito JSONB,
    series_guia_remision JSONB,
    activo BOOLEAN DEFAULT TRUE,
    created_at BIGINT,
    updated_at BIGINT
  );

  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    role TEXT DEFAULT 'company_user',
    activo BOOLEAN DEFAULT TRUE,
    last_login_at BIGINT,
    created_at BIGINT,
    updated_at BIGINT
  );

  CREATE TABLE IF NOT EXISTS clients (
    id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    tipo_documento TEXT NOT NULL,
    numero_documento TEXT NOT NULL,
    razon_social TEXT NOT NULL,
    nombre_comercial TEXT,
    direccion TEXT,
    ubigeo TEXT,
    distrito TEXT,
    provincia TEXT,
    departamento TEXT,
    telefono TEXT,
    email TEXT,
    activo BOOLEAN DEFAULT TRUE,
    created_at BIGINT,
    updated_at BIGINT
  );

  CREATE TABLE IF NOT EXISTS correlatives (
    id SERIAL PRIMARY KEY,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    tipo_documento TEXT NOT NULL,
    serie TEXT NOT NULL,
    correlativo_actual INTEGER DEFAULT 0,
    activo BOOLEAN DEFAULT TRUE,
    created_at BIGINT,
    updated_at BIGINT
  );

  CREATE TABLE IF NOT EXISTS daily_summaries (
    id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    fecha_resumen TEXT NOT NULL,
    correlativo TEXT NOT NULL,
    numero_completo TEXT,
    ticket TEXT,
    estado TEXT DEFAULT 'PENDIENTE',
    response_code TEXT,
    response_description TEXT,
    boleta_count INTEGER DEFAULT 0,
    order_numbers JSONB,
    pdf_folder TEXT,
    xml_path TEXT,
    cdr_path TEXT,
    respuesta_sunat TEXT,
    usuario_creacion TEXT,
    created_at BIGINT,
    updated_at BIGINT
  );

  CREATE TABLE IF NOT EXISTS boletas (
    id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    daily_summary_id INTEGER REFERENCES daily_summaries(id) ON DELETE SET NULL,
    tipo_documento TEXT DEFAULT '03',
    serie TEXT NOT NULL,
    correlativo TEXT NOT NULL,
    numero_completo TEXT NOT NULL,
    order_number TEXT,
    fecha_emision TEXT NOT NULL,
    ubl_version TEXT DEFAULT '2.1',
    tipo_operacion TEXT DEFAULT '0101',
    moneda TEXT DEFAULT 'PEN',
    metodo_envio TEXT DEFAULT 'individual',
    valor_venta TEXT DEFAULT '0',
    mto_oper_gravadas TEXT DEFAULT '0',
    mto_oper_exoneradas TEXT DEFAULT '0',
    mto_oper_inafectas TEXT DEFAULT '0',
    mto_oper_gratuitas TEXT DEFAULT '0',
    mto_igv_gratuitas TEXT DEFAULT '0',
    mto_igv TEXT DEFAULT '0',
    mto_base_ivap TEXT DEFAULT '0',
    mto_ivap TEXT DEFAULT '0',
    mto_isc TEXT DEFAULT '0',
    mto_icbper TEXT DEFAULT '0',
    total_impuestos TEXT DEFAULT '0',
    sub_total TEXT DEFAULT '0',
    mto_imp_venta TEXT DEFAULT '0',
    detalles JSONB NOT NULL,
    leyendas JSONB,
    datos_adicionales JSONB,
    xml_path TEXT,
    cdr_path TEXT,
    pdf_path TEXT,
    estado_sunat TEXT DEFAULT 'PENDIENTE',
    respuesta_sunat TEXT,
    codigo_hash TEXT,
    usuario_creacion TEXT,
    created_at BIGINT,
    updated_at BIGINT
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_company_serie_corr ON boletas(company_id, serie, correlativo);
  CREATE INDEX IF NOT EXISTS idx_company_branch ON boletas(company_id, branch_id);
  CREATE INDEX IF NOT EXISTS idx_fecha_emision ON boletas(fecha_emision);
  CREATE INDEX IF NOT EXISTS idx_estado_sunat ON boletas(estado_sunat);
  CREATE INDEX IF NOT EXISTS idx_daily_summary ON boletas(daily_summary_id);

  CREATE TABLE IF NOT EXISTS facturas (
    id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
    client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    daily_summary_id INTEGER REFERENCES daily_summaries(id) ON DELETE SET NULL,
    tipo_documento TEXT DEFAULT '01',
    serie TEXT DEFAULT '',
    correlativo TEXT DEFAULT '',
    numero_completo TEXT NOT NULL,
    order_number TEXT,
    fecha_emision TEXT NOT NULL,
    ubl_version TEXT DEFAULT '2.1',
    tipo_operacion TEXT DEFAULT '0101',
    moneda TEXT DEFAULT 'PEN',
    metodo_envio TEXT DEFAULT 'individual',
    valor_venta TEXT DEFAULT '0',
    mto_oper_gravadas TEXT DEFAULT '0',
    mto_oper_exoneradas TEXT DEFAULT '0',
    mto_oper_inafectas TEXT DEFAULT '0',
    mto_oper_gratuitas TEXT DEFAULT '0',
    mto_igv_gratuitas TEXT DEFAULT '0',
    mto_igv TEXT DEFAULT '0',
    mto_base_ivap TEXT DEFAULT '0',
    mto_ivap TEXT DEFAULT '0',
    mto_isc TEXT DEFAULT '0',
    mto_icbper TEXT DEFAULT '0',
    total_impuestos TEXT DEFAULT '0',
    sub_total TEXT DEFAULT '0',
    mto_imp_venta TEXT DEFAULT '0',
    detalles JSONB NOT NULL DEFAULT '[]',
    leyendas JSONB,
    datos_adicionales JSONB,
    xml_path TEXT,
    cdr_path TEXT,
    pdf_path TEXT,
    estado_sunat TEXT DEFAULT 'PENDIENTE',
    respuesta_sunat TEXT,
    codigo_hash TEXT,
    fuente TEXT DEFAULT 'manual',
    order_item_ids JSONB,
    respuesta_falabella TEXT,
    usuario_creacion TEXT,
    created_at BIGINT,
    updated_at BIGINT
  );

  ALTER TABLE facturas ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL;
  ALTER TABLE facturas ADD COLUMN IF NOT EXISTS daily_summary_id INTEGER REFERENCES daily_summaries(id) ON DELETE SET NULL;
  ALTER TABLE facturas ADD COLUMN IF NOT EXISTS serie TEXT DEFAULT '';
  ALTER TABLE facturas ADD COLUMN IF NOT EXISTS correlativo TEXT DEFAULT '';
  ALTER TABLE facturas ADD COLUMN IF NOT EXISTS ubl_version TEXT DEFAULT '2.1';
  ALTER TABLE facturas ADD COLUMN IF NOT EXISTS tipo_operacion TEXT DEFAULT '0101';
  ALTER TABLE facturas ADD COLUMN IF NOT EXISTS moneda TEXT DEFAULT 'PEN';
  ALTER TABLE facturas ADD COLUMN IF NOT EXISTS metodo_envio TEXT DEFAULT 'individual';
  ALTER TABLE facturas ADD COLUMN IF NOT EXISTS valor_venta TEXT DEFAULT '0';
  ALTER TABLE facturas ADD COLUMN IF NOT EXISTS mto_oper_gravadas TEXT DEFAULT '0';
  ALTER TABLE facturas ADD COLUMN IF NOT EXISTS mto_oper_exoneradas TEXT DEFAULT '0';
  ALTER TABLE facturas ADD COLUMN IF NOT EXISTS mto_oper_inafectas TEXT DEFAULT '0';
  ALTER TABLE facturas ADD COLUMN IF NOT EXISTS mto_oper_gratuitas TEXT DEFAULT '0';
  ALTER TABLE facturas ADD COLUMN IF NOT EXISTS mto_igv_gratuitas TEXT DEFAULT '0';
  ALTER TABLE facturas ADD COLUMN IF NOT EXISTS mto_igv TEXT DEFAULT '0';
  ALTER TABLE facturas ADD COLUMN IF NOT EXISTS mto_base_ivap TEXT DEFAULT '0';
  ALTER TABLE facturas ADD COLUMN IF NOT EXISTS mto_ivap TEXT DEFAULT '0';
  ALTER TABLE facturas ADD COLUMN IF NOT EXISTS mto_isc TEXT DEFAULT '0';
  ALTER TABLE facturas ADD COLUMN IF NOT EXISTS mto_icbper TEXT DEFAULT '0';
  ALTER TABLE facturas ADD COLUMN IF NOT EXISTS total_impuestos TEXT DEFAULT '0';
  ALTER TABLE facturas ADD COLUMN IF NOT EXISTS sub_total TEXT DEFAULT '0';
  ALTER TABLE facturas ADD COLUMN IF NOT EXISTS mto_imp_venta TEXT DEFAULT '0';
  ALTER TABLE facturas ADD COLUMN IF NOT EXISTS detalles JSONB NOT NULL DEFAULT '[]';
  ALTER TABLE facturas ADD COLUMN IF NOT EXISTS leyendas JSONB;
  ALTER TABLE facturas ADD COLUMN IF NOT EXISTS datos_adicionales JSONB;
  ALTER TABLE facturas ADD COLUMN IF NOT EXISTS xml_path TEXT;
  ALTER TABLE facturas ADD COLUMN IF NOT EXISTS cdr_path TEXT;
  ALTER TABLE facturas ADD COLUMN IF NOT EXISTS estado_sunat TEXT DEFAULT 'PENDIENTE';
  ALTER TABLE facturas ADD COLUMN IF NOT EXISTS respuesta_sunat TEXT;
  ALTER TABLE facturas ADD COLUMN IF NOT EXISTS codigo_hash TEXT;
  ALTER TABLE facturas ADD COLUMN IF NOT EXISTS usuario_creacion TEXT;
  ALTER TABLE facturas ALTER COLUMN order_number DROP NOT NULL;
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'facturas' AND column_name = 'estado'
    ) THEN
      UPDATE facturas
      SET estado_sunat = estado
      WHERE (estado_sunat IS NULL OR estado_sunat = 'PENDIENTE') AND estado IS NOT NULL;
    END IF;
  END $$;

  CREATE INDEX IF NOT EXISTS idx_facturas_company_serie_corr ON facturas(company_id, serie, correlativo);
  CREATE INDEX IF NOT EXISTS idx_facturas_company_branch ON facturas(company_id, branch_id);
  CREATE INDEX IF NOT EXISTS idx_facturas_fecha_emision ON facturas(fecha_emision);
  CREATE INDEX IF NOT EXISTS idx_facturas_estado_sunat ON facturas(estado_sunat);
  CREATE INDEX IF NOT EXISTS idx_facturas_order_number ON facturas(order_number);
  CREATE INDEX IF NOT EXISTS idx_facturas_daily_summary ON facturas(daily_summary_id);

  CREATE TABLE IF NOT EXISTS credit_notes (
    id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    affected_boleta_id INTEGER REFERENCES boletas(id) ON DELETE CASCADE,
    affected_factura_id INTEGER REFERENCES facturas(id) ON DELETE CASCADE,
    tipo_documento TEXT DEFAULT '07',
    serie TEXT NOT NULL,
    correlativo TEXT NOT NULL,
    numero_completo TEXT NOT NULL,
    tipo_doc_afectado TEXT NOT NULL,
    num_doc_afectado TEXT NOT NULL,
    cod_motivo TEXT NOT NULL,
    des_motivo TEXT NOT NULL,
    fecha_emision TEXT NOT NULL,
    ubl_version TEXT DEFAULT '2.1',
    moneda TEXT DEFAULT 'PEN',
    forma_pago_tipo TEXT DEFAULT 'Contado',
    forma_pago_cuotas JSONB,
    valor_venta TEXT DEFAULT '0',
    mto_oper_gravadas TEXT DEFAULT '0',
    mto_oper_exoneradas TEXT DEFAULT '0',
    mto_oper_inafectas TEXT DEFAULT '0',
    mto_oper_gratuitas TEXT DEFAULT '0',
    mto_igv_gratuitas TEXT DEFAULT '0',
    mto_igv TEXT DEFAULT '0',
    mto_base_ivap TEXT DEFAULT '0',
    mto_ivap TEXT DEFAULT '0',
    mto_isc TEXT DEFAULT '0',
    mto_icbper TEXT DEFAULT '0',
    total_impuestos TEXT DEFAULT '0',
    sub_total TEXT DEFAULT '0',
    mto_imp_venta TEXT DEFAULT '0',
    detalles JSONB NOT NULL,
    leyendas JSONB,
    datos_adicionales JSONB,
    xml_path TEXT,
    cdr_path TEXT,
    pdf_path TEXT,
    estado_sunat TEXT DEFAULT 'PENDIENTE',
    respuesta_sunat TEXT,
    codigo_hash TEXT,
    usuario_creacion TEXT,
    created_at BIGINT,
    updated_at BIGINT
  );

  ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS affected_factura_id INTEGER REFERENCES facturas(id) ON DELETE CASCADE;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_notes_company_serie_corr ON credit_notes(company_id, serie, correlativo);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_notes_affected_boleta ON credit_notes(affected_boleta_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_notes_affected_factura ON credit_notes(affected_factura_id);
  CREATE INDEX IF NOT EXISTS idx_credit_notes_company_branch ON credit_notes(company_id, branch_id);
  CREATE INDEX IF NOT EXISTS idx_credit_notes_fecha_emision ON credit_notes(fecha_emision);
  CREATE INDEX IF NOT EXISTS idx_credit_notes_estado_sunat ON credit_notes(estado_sunat);

  ALTER TABLE credit_notes ALTER COLUMN affected_boleta_id DROP NOT NULL;
  ALTER TABLE credit_notes ALTER COLUMN affected_factura_id DROP NOT NULL;

  -- Repara documentos históricos que quedaron enlazados a una sucursal de otra
  -- empresa. Se conserva el código de local cuando existe en la empresa correcta;
  -- de lo contrario se usa primero la sede 0000 y luego cualquier sede activa.
  WITH branch_repairs AS (
    SELECT
      document.id,
      (
        SELECT replacement.id
        FROM branches replacement
        WHERE replacement.company_id = document.company_id
        ORDER BY
          CASE
            WHEN replacement.activo AND replacement.codigo = current_branch.codigo THEN 0
            WHEN replacement.activo AND replacement.codigo = '0000' THEN 1
            WHEN replacement.activo THEN 2
            WHEN replacement.codigo = current_branch.codigo THEN 3
            WHEN replacement.codigo = '0000' THEN 4
            ELSE 5
          END,
          replacement.id
        LIMIT 1
      ) AS replacement_branch_id
    FROM boletas document
    JOIN branches current_branch ON current_branch.id = document.branch_id
    WHERE current_branch.company_id <> document.company_id
  )
  UPDATE boletas document
  SET
    branch_id = repair.replacement_branch_id,
    updated_at = FLOOR(EXTRACT(EPOCH FROM NOW()))::bigint
  FROM branch_repairs repair
  WHERE document.id = repair.id
    AND repair.replacement_branch_id IS NOT NULL;

  WITH branch_repairs AS (
    SELECT
      document.id,
      (
        SELECT replacement.id
        FROM branches replacement
        WHERE replacement.company_id = document.company_id
        ORDER BY
          CASE
            WHEN replacement.activo AND replacement.codigo = current_branch.codigo THEN 0
            WHEN replacement.activo AND replacement.codigo = '0000' THEN 1
            WHEN replacement.activo THEN 2
            WHEN replacement.codigo = current_branch.codigo THEN 3
            WHEN replacement.codigo = '0000' THEN 4
            ELSE 5
          END,
          replacement.id
        LIMIT 1
      ) AS replacement_branch_id
    FROM facturas document
    JOIN branches current_branch ON current_branch.id = document.branch_id
    WHERE current_branch.company_id <> document.company_id
  )
  UPDATE facturas document
  SET
    branch_id = repair.replacement_branch_id,
    updated_at = FLOOR(EXTRACT(EPOCH FROM NOW()))::bigint
  FROM branch_repairs repair
  WHERE document.id = repair.id
    AND repair.replacement_branch_id IS NOT NULL;

  WITH branch_repairs AS (
    SELECT
      document.id,
      (
        SELECT replacement.id
        FROM branches replacement
        WHERE replacement.company_id = document.company_id
        ORDER BY
          CASE
            WHEN replacement.activo AND replacement.codigo = current_branch.codigo THEN 0
            WHEN replacement.activo AND replacement.codigo = '0000' THEN 1
            WHEN replacement.activo THEN 2
            WHEN replacement.codigo = current_branch.codigo THEN 3
            WHEN replacement.codigo = '0000' THEN 4
            ELSE 5
          END,
          replacement.id
        LIMIT 1
      ) AS replacement_branch_id
    FROM credit_notes document
    JOIN branches current_branch ON current_branch.id = document.branch_id
    WHERE current_branch.company_id <> document.company_id
  )
  UPDATE credit_notes document
  SET
    branch_id = repair.replacement_branch_id,
    updated_at = FLOOR(EXTRACT(EPOCH FROM NOW()))::bigint
  FROM branch_repairs repair
  WHERE document.id = repair.id
    AND repair.replacement_branch_id IS NOT NULL;

  WITH branch_repairs AS (
    SELECT
      document.id,
      (
        SELECT replacement.id
        FROM branches replacement
        WHERE replacement.company_id = document.company_id
        ORDER BY
          CASE
            WHEN replacement.activo AND replacement.codigo = current_branch.codigo THEN 0
            WHEN replacement.activo AND replacement.codigo = '0000' THEN 1
            WHEN replacement.activo THEN 2
            WHEN replacement.codigo = current_branch.codigo THEN 3
            WHEN replacement.codigo = '0000' THEN 4
            ELSE 5
          END,
          replacement.id
        LIMIT 1
      ) AS replacement_branch_id
    FROM daily_summaries document
    JOIN branches current_branch ON current_branch.id = document.branch_id
    WHERE current_branch.company_id <> document.company_id
  )
  UPDATE daily_summaries document
  SET
    branch_id = repair.replacement_branch_id,
    updated_at = FLOOR(EXTRACT(EPOCH FROM NOW()))::bigint
  FROM branch_repairs repair
  WHERE document.id = repair.id
    AND repair.replacement_branch_id IS NOT NULL;

  -- Defensa en la base de datos: ninguna ruta de escritura puede volver a
  -- guardar un documento con una sucursal que pertenezca a otra empresa.
  CREATE OR REPLACE FUNCTION enforce_company_branch_ownership()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.branch_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM branches branch
      WHERE branch.id = NEW.branch_id
        AND branch.company_id = NEW.company_id
    ) THEN
      RAISE EXCEPTION 'La sucursal seleccionada no pertenece a la empresa';
    END IF;
    RETURN NEW;
  END;
  $$;

  DROP TRIGGER IF EXISTS trg_boletas_company_branch ON boletas;
  CREATE TRIGGER trg_boletas_company_branch
    BEFORE INSERT OR UPDATE OF company_id, branch_id ON boletas
    FOR EACH ROW EXECUTE FUNCTION enforce_company_branch_ownership();

  DROP TRIGGER IF EXISTS trg_facturas_company_branch ON facturas;
  CREATE TRIGGER trg_facturas_company_branch
    BEFORE INSERT OR UPDATE OF company_id, branch_id ON facturas
    FOR EACH ROW EXECUTE FUNCTION enforce_company_branch_ownership();

  DROP TRIGGER IF EXISTS trg_credit_notes_company_branch ON credit_notes;
  CREATE TRIGGER trg_credit_notes_company_branch
    BEFORE INSERT OR UPDATE OF company_id, branch_id ON credit_notes
    FOR EACH ROW EXECUTE FUNCTION enforce_company_branch_ownership();

  DROP TRIGGER IF EXISTS trg_daily_summaries_company_branch ON daily_summaries;
  CREATE TRIGGER trg_daily_summaries_company_branch
    BEFORE INSERT OR UPDATE OF company_id, branch_id ON daily_summaries
    FOR EACH ROW EXECUTE FUNCTION enforce_company_branch_ownership();

  -- Índices de lectura para analítica por empresa/sucursal y periodo.
  CREATE INDEX IF NOT EXISTS idx_boletas_company_fecha
    ON boletas(company_id, fecha_emision);
  CREATE INDEX IF NOT EXISTS idx_boletas_company_branch_fecha
    ON boletas(company_id, branch_id, fecha_emision);
  CREATE INDEX IF NOT EXISTS idx_facturas_company_fecha
    ON facturas(company_id, fecha_emision);
  CREATE INDEX IF NOT EXISTS idx_facturas_company_branch_fecha
    ON facturas(company_id, branch_id, fecha_emision);
  CREATE INDEX IF NOT EXISTS idx_credit_notes_company_fecha
    ON credit_notes(company_id, fecha_emision);
  CREATE INDEX IF NOT EXISTS idx_credit_notes_company_branch_fecha
    ON credit_notes(company_id, branch_id, fecha_emision);

  -- Caché analítica compartida por todas las instancias del API. La vista conserva
  -- solo agregados diarios; el dashboard nunca necesita leer miles de documentos.
  CREATE MATERIALIZED VIEW IF NOT EXISTS dashboard_daily_metrics AS
  SELECT
    source.fecha_emision::date AS day,
    source.company_id,
    COALESCE(source.branch_id, 0) AS branch_id,
    source.document_type,
    UPPER(COALESCE(source.estado_sunat, 'PENDIENTE')) AS status,
    COALESCE(source.moneda, 'PEN') AS currency,
    COUNT(*)::bigint AS document_count,
    SUM(
      CASE
        WHEN COALESCE(source.mto_imp_venta, '') ~ '^-?[0-9]+([.][0-9]+)?$'
          THEN source.mto_imp_venta::numeric
        ELSE 0
      END
    )::numeric(18, 2) AS total_amount
  FROM (
    SELECT fecha_emision, company_id, branch_id, 'BOLETA'::text AS document_type,
      estado_sunat, moneda, mto_imp_venta
    FROM boletas
    WHERE fecha_emision ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    UNION ALL
    SELECT fecha_emision, company_id, branch_id, 'FACTURA'::text AS document_type,
      estado_sunat, moneda, mto_imp_venta
    FROM facturas
    WHERE fecha_emision ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    UNION ALL
    SELECT fecha_emision, company_id, branch_id, 'NOTA_CREDITO'::text AS document_type,
      estado_sunat, moneda, mto_imp_venta
    FROM credit_notes
    WHERE fecha_emision ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  ) source
  GROUP BY 1, 2, 3, 4, 5, 6
  WITH DATA;

  CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_daily_metrics_unique
    ON dashboard_daily_metrics(day, company_id, branch_id, document_type, status, currency);
  CREATE INDEX IF NOT EXISTS idx_dashboard_daily_metrics_filters
    ON dashboard_daily_metrics(company_id, branch_id, day);

  CREATE TABLE IF NOT EXISTS dashboard_refresh_state (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  INSERT INTO dashboard_refresh_state(id) VALUES (1) ON CONFLICT (id) DO NOTHING;

  CREATE TABLE IF NOT EXISTS falabella_orders (
    id BIGSERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    order_id TEXT NOT NULL,
    order_number TEXT NOT NULL,
    falabella_created_at TIMESTAMPTZ,
    falabella_updated_at TIMESTAMPTZ,
    status TEXT,
    invoice_required BOOLEAN NOT NULL DEFAULT FALSE,
    grand_total NUMERIC(14, 2),
    currency TEXT,
    raw_data JSONB NOT NULL,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    synchronized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, order_id)
  );
  CREATE INDEX IF NOT EXISTS idx_falabella_orders_company_created
    ON falabella_orders(company_id, falabella_created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_falabella_orders_company_updated
    ON falabella_orders(company_id, falabella_updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_falabella_orders_company_status
    ON falabella_orders(company_id, status);
  CREATE INDEX IF NOT EXISTS idx_falabella_orders_company_number
    ON falabella_orders(company_id, order_number);

  CREATE TABLE IF NOT EXISTS falabella_order_lifecycle (
    id BIGSERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    order_id TEXT NOT NULL,
    order_number TEXT NOT NULL,
    current_status TEXT NOT NULL DEFAULT '',
    pending_at TIMESTAMPTZ,
    ready_to_ship_at TIMESTAMPTZ,
    shipped_at TIMESTAMPTZ,
    last_provider_update_at TIMESTAMPTZ,
    first_observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, order_id)
  );
  CREATE INDEX IF NOT EXISTS idx_falabella_lifecycle_company_shipped
    ON falabella_order_lifecycle(company_id, shipped_at DESC);
  CREATE INDEX IF NOT EXISTS idx_falabella_lifecycle_shipped
    ON falabella_order_lifecycle(shipped_at DESC);
  INSERT INTO falabella_order_lifecycle (
    company_id, order_id, order_number, current_status, pending_at,
    ready_to_ship_at, shipped_at, last_provider_update_at,
    first_observed_at, last_observed_at
  )
  SELECT company_id, order_id, order_number, coalesce(status, ''),
    coalesce(falabella_created_at, first_seen_at),
    NULL,
    NULL,
    falabella_updated_at, first_seen_at, synchronized_at
  FROM falabella_orders
  ON CONFLICT (company_id, order_id) DO NOTHING;

  CREATE TABLE IF NOT EXISTS falabella_ready_to_ship_operations (
    company_id INTEGER NOT NULL,
    order_id TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'processing',
    attempts INTEGER NOT NULL DEFAULT 1,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    last_error TEXT,
    result JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (company_id, order_id),
    FOREIGN KEY (company_id, order_id)
      REFERENCES falabella_orders(company_id, order_id) ON DELETE CASCADE,
    CHECK (state IN ('processing', 'reconciling', 'succeeded', 'failed', 'unknown'))
  );
  CREATE INDEX IF NOT EXISTS idx_falabella_ready_to_ship_operations_state
    ON falabella_ready_to_ship_operations(state, updated_at);

  CREATE TABLE IF NOT EXISTS falabella_label_prints (
    id BIGSERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    order_id TEXT NOT NULL,
    order_number TEXT NOT NULL,
    label_index INTEGER NOT NULL DEFAULT 1 CHECK (label_index > 0),
    print_count INTEGER NOT NULL DEFAULT 1 CHECK (print_count > 0),
    first_printed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_printed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ALTER TABLE falabella_label_prints
    ADD COLUMN IF NOT EXISTS label_index INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE falabella_label_prints
    DROP CONSTRAINT IF EXISTS falabella_label_prints_company_id_order_id_key;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_falabella_label_prints_order_label
    ON falabella_label_prints(company_id, order_id, label_index);
  CREATE INDEX IF NOT EXISTS idx_falabella_label_prints_company_last
    ON falabella_label_prints(company_id, last_printed_at DESC);

  CREATE TABLE IF NOT EXISTS falabella_manifests (
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    manifest_id TEXT NOT NULL,
    manifest_code TEXT NOT NULL DEFAULT '',
    shipment_provider TEXT NOT NULL DEFAULT '',
    tracking_code TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '',
    item_count INTEGER NOT NULL DEFAULT 0 CHECK (item_count >= 0),
    provider_created_at TIMESTAMPTZ,
    created_by_app BOOLEAN NOT NULL DEFAULT FALSE,
    source TEXT NOT NULL DEFAULT 'seller_center',
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    download_count INTEGER NOT NULL DEFAULT 0 CHECK (download_count >= 0),
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    first_downloaded_at TIMESTAMPTZ,
    last_downloaded_at TIMESTAMPTZ,
    PRIMARY KEY (company_id, manifest_id)
  );
  CREATE INDEX IF NOT EXISTS idx_falabella_manifests_company_created
    ON falabella_manifests(company_id, provider_created_at DESC NULLS LAST);
  ALTER TABLE falabella_manifests
    ADD COLUMN IF NOT EXISTS manifest_code TEXT NOT NULL DEFAULT '';
  ALTER TABLE falabella_manifests
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'seller_center';
  ALTER TABLE falabella_manifests
    ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  ALTER TABLE falabella_manifests
    ADD COLUMN IF NOT EXISTS created_by_app BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE falabella_manifests
    ADD COLUMN IF NOT EXISTS pdf_data BYTEA;
  ALTER TABLE falabella_manifests
    ADD COLUMN IF NOT EXISTS pdf_filename TEXT;
  ALTER TABLE falabella_manifests
    ADD COLUMN IF NOT EXISTS pdf_cached_at TIMESTAMPTZ;
  ALTER TABLE falabella_manifests
    ADD COLUMN IF NOT EXISTS pdf_byte_size INTEGER;
  UPDATE falabella_manifests
    SET manifest_code=tracking_code
    WHERE manifest_code='' AND tracking_code<>'';
  CREATE UNIQUE INDEX IF NOT EXISTS idx_falabella_manifests_company_code
    ON falabella_manifests(company_id, manifest_code)
    WHERE manifest_code <> '';

  CREATE TABLE IF NOT EXISTS falabella_manifest_items (
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    manifest_id TEXT NOT NULL,
    order_item_id TEXT NOT NULL,
    order_id TEXT,
    order_number TEXT,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (company_id, order_item_id),
    FOREIGN KEY (company_id, manifest_id)
      REFERENCES falabella_manifests(company_id, manifest_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_falabella_manifest_items_manifest
    ON falabella_manifest_items(company_id, manifest_id);

  CREATE TABLE IF NOT EXISTS falabella_manifest_orders (
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    manifest_id TEXT NOT NULL,
    local_order_id TEXT NOT NULL,
    order_number TEXT NOT NULL DEFAULT '',
    delivery_order_number TEXT NOT NULL DEFAULT '',
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (company_id, local_order_id),
    FOREIGN KEY (company_id, manifest_id)
      REFERENCES falabella_manifests(company_id, manifest_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_falabella_manifest_orders_manifest
    ON falabella_manifest_orders(company_id, manifest_id);
  CREATE INDEX IF NOT EXISTS idx_falabella_manifest_orders_number
    ON falabella_manifest_orders(company_id, order_number)
    WHERE order_number <> '';
  CREATE INDEX IF NOT EXISTS idx_falabella_manifest_orders_delivery
    ON falabella_manifest_orders(company_id, delivery_order_number)
    WHERE delivery_order_number <> '';

  CREATE TABLE IF NOT EXISTS falabella_manifest_runs (
    id BIGSERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    company_name TEXT NOT NULL DEFAULT '',
    operation TEXT NOT NULL DEFAULT 'create',
    status TEXT NOT NULL DEFAULT 'success',
    requested_orders INTEGER NOT NULL DEFAULT 0,
    provider_orders INTEGER NOT NULL DEFAULT 0,
    eligible_orders INTEGER NOT NULL DEFAULT 0,
    already_manifested_orders INTEGER NOT NULL DEFAULT 0,
    created_manifests INTEGER NOT NULL DEFAULT 0,
    created_orders INTEGER NOT NULL DEFAULT 0,
    stage TEXT NOT NULL DEFAULT '',
    error TEXT,
    events JSONB NOT NULL DEFAULT '[]'::jsonb,
    page_url TEXT,
    page_title TEXT,
    page_text TEXT,
    screenshot_mime_type TEXT,
    screenshot_base64 TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_falabella_manifest_runs_company_created
    ON falabella_manifest_runs(company_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_falabella_manifest_runs_created
    ON falabella_manifest_runs(created_at DESC);

  CREATE TABLE IF NOT EXISTS falabella_manifest_jobs (
    id BIGSERIAL PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    orders JSONB NOT NULL DEFAULT '[]'::jsonb,
    stage TEXT NOT NULL DEFAULT 'en cola',
    attempts INTEGER NOT NULL DEFAULT 0,
    result JSONB,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_falabella_manifest_jobs_status_created
    ON falabella_manifest_jobs(status, created_at);
  ALTER TABLE falabella_manifest_jobs
    DROP CONSTRAINT IF EXISTS falabella_manifest_jobs_fingerprint_key;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_falabella_manifest_jobs_active_fingerprint
    ON falabella_manifest_jobs(fingerprint)
    WHERE status IN ('pending', 'processing');

  CREATE TABLE IF NOT EXISTS falabella_ticket_items (
    id BIGSERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    order_id TEXT NOT NULL,
    order_number TEXT NOT NULL,
    order_item_id TEXT NOT NULL,
    tracking_code TEXT NOT NULL DEFAULT '',
    package_id TEXT NOT NULL DEFAULT '',
    item_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, order_id, order_item_id)
  );
  CREATE INDEX IF NOT EXISTS idx_falabella_ticket_items_tracking
    ON falabella_ticket_items(tracking_code)
    WHERE tracking_code <> '';
  CREATE INDEX IF NOT EXISTS idx_falabella_ticket_items_order_number
    ON falabella_ticket_items(order_number);
  CREATE INDEX IF NOT EXISTS idx_falabella_ticket_items_package
    ON falabella_ticket_items(package_id)
    WHERE package_id <> '';

  CREATE TABLE IF NOT EXISTS falabella_product_variants (
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    seller_sku TEXT NOT NULL DEFAULT '',
    shop_sku TEXT NOT NULL DEFAULT '',
    product_name TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '',
    size TEXT NOT NULL DEFAULT '',
    variant_label TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (company_id, seller_sku, shop_sku),
    CHECK (seller_sku <> '' OR shop_sku <> '')
  );
  CREATE INDEX IF NOT EXISTS idx_falabella_product_variants_seller_sku
    ON falabella_product_variants(company_id, seller_sku)
    WHERE seller_sku <> '';
  CREATE INDEX IF NOT EXISTS idx_falabella_product_variants_shop_sku
    ON falabella_product_variants(company_id, shop_sku)
    WHERE shop_sku <> '';

  CREATE TABLE IF NOT EXISTS falabella_sync_state (
    company_id INTEGER PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    status TEXT NOT NULL DEFAULT 'pending',
    full_sync_completed BOOLEAN NOT NULL DEFAULT FALSE,
    initial_sync_from DATE,
    backfill_cursor_date DATE,
    cursor_updated_at TIMESTAMPTZ,
    last_attempt_at TIMESTAMPTZ,
    last_started_at TIMESTAMPTZ,
    last_finished_at TIMESTAMPTZ,
    last_successful_sync_at TIMESTAMPTZ,
    last_error TEXT,
    last_pages_processed INTEGER NOT NULL DEFAULT 0,
    last_orders_received INTEGER NOT NULL DEFAULT 0,
    last_orders_upserted INTEGER NOT NULL DEFAULT 0,
    sync_interval_minutes INTEGER NOT NULL DEFAULT 15,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = 'falabella_orders'::regclass
        AND conname = 'falabella_orders_company_id_order_number_key'
    ) THEN
      ALTER TABLE falabella_orders
        DROP CONSTRAINT falabella_orders_company_id_order_number_key;
      UPDATE falabella_sync_state
      SET cursor_updated_at = LEAST(
        COALESCE(cursor_updated_at, NOW()),
        NOW() - INTERVAL '31 days'
      );
    END IF;
  END $$;
  DO $$
  DECLARE sync_interval_default TEXT;
  BEGIN
    SELECT column_default INTO sync_interval_default
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='falabella_sync_state'
      AND column_name='sync_interval_minutes';
    UPDATE falabella_sync_state SET sync_interval_minutes=15 WHERE sync_interval_minutes <> 15;
    ALTER TABLE falabella_sync_state ALTER COLUMN sync_interval_minutes SET DEFAULT 15;
  END $$;

  CREATE TABLE IF NOT EXISTS falabella_sync_runs (
    id BIGSERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    mode TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    window_from TIMESTAMPTZ,
    window_to TIMESTAMPTZ,
    pages_processed INTEGER NOT NULL DEFAULT 0,
    orders_received INTEGER NOT NULL DEFAULT 0,
    orders_upserted INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_falabella_sync_runs_company_started
    ON falabella_sync_runs(company_id, started_at DESC);

  CREATE TABLE IF NOT EXISTS falabella_sync_windows (
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    month TEXT NOT NULL,
    last_successful_sync_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    orders_received INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (company_id, month)
  );

  -- Módulo de pedidos multicanal. Estas tablas son independientes de las
  -- integraciones legacy para permitir una migración gradual por dual-write.
  CREATE TABLE IF NOT EXISTS order_channels (
    id SMALLSERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    default_auto_create_orders BOOLEAN NOT NULL DEFAULT FALSE,
    capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (code ~ '^[a-z][a-z0-9_-]{1,49}$')
  );

  INSERT INTO order_channels (code, name, default_auto_create_orders, capabilities)
  VALUES
    ('falabella', 'Falabella', TRUE, '{"ingestion":["polling","webhook"],"actions":["ready_to_ship","shipping_label"]}'::jsonb),
    ('mercado_libre', 'Mercado Libre', TRUE, '{"ingestion":["api","webhook"]}'::jsonb),
    ('ripley', 'Ripley', TRUE, '{"ingestion":["api","webhook"]}'::jsonb),
    ('manual', 'Venta manual', FALSE, '{"ingestion":["manual"]}'::jsonb),
    ('external', 'Pedido externo', FALSE, '{"ingestion":["api","manual","file"]}'::jsonb)
  ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    default_auto_create_orders = EXCLUDED.default_auto_create_orders,
    capabilities = EXCLUDED.capabilities,
    updated_at = NOW();

  CREATE TABLE IF NOT EXISTS order_channel_accounts (
    id BIGSERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    channel_id SMALLINT NOT NULL REFERENCES order_channels(id),
    external_account_id TEXT NOT NULL DEFAULT 'default',
    display_name TEXT NOT NULL,
    auto_create_orders BOOLEAN NOT NULL DEFAULT FALSE,
    document_requirement TEXT NOT NULL DEFAULT 'optional',
    document_type_policy TEXT NOT NULL DEFAULT 'automatic',
    credential_reference TEXT,
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, channel_id, external_account_id),
    UNIQUE (id, company_id),
    CHECK (document_requirement IN ('disabled', 'optional', 'required')),
    CHECK (document_type_policy IN ('automatic', 'boleta', 'factura', 'customer_choice'))
  );
  CREATE INDEX IF NOT EXISTS idx_order_channel_accounts_company
    ON order_channel_accounts(company_id, active);

  INSERT INTO order_channel_accounts (
    company_id, channel_id, external_account_id, display_name,
    auto_create_orders, document_requirement, document_type_policy, settings
  )
  SELECT
    c.id, ch.id, 'default',
    coalesce(nullif(c.nombre, ''), nullif(c.nombre_comercial, ''), c.razon_social, 'Falabella'),
    TRUE, 'optional', 'automatic', '{"origin":"legacy_falabella"}'::jsonb
  FROM companies c
  JOIN order_channels ch ON ch.code = 'falabella'
  WHERE (
    nullif(trim(c.falabella_api_user_id), '') IS NOT NULL
    AND nullif(trim(c.falabella_api_key), '') IS NOT NULL
  ) OR EXISTS (
    SELECT 1 FROM falabella_orders fo WHERE fo.company_id = c.id
  )
  ON CONFLICT (company_id, channel_id, external_account_id) DO NOTHING;

  -- Toda empresa puede registrar ventas desde la interfaz sin depender de
  -- credenciales de un marketplace ni de una integración externa.
  INSERT INTO order_channel_accounts (
    company_id, channel_id, external_account_id, display_name,
    auto_create_orders, document_requirement, document_type_policy, settings
  )
  SELECT
    c.id, ch.id, 'default',
    'Ventas manuales · ' || coalesce(nullif(c.nombre, ''), nullif(c.nombre_comercial, ''), c.razon_social, 'Empresa'),
    FALSE, 'optional', 'automatic', '{"origin":"manual_ui"}'::jsonb
  FROM companies c
  JOIN order_channels ch ON ch.code = 'manual'
  ON CONFLICT (company_id, channel_id, external_account_id) DO NOTHING;

  CREATE TABLE IF NOT EXISTS orders (
    id BIGSERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    channel_account_id BIGINT NOT NULL,
    external_order_id TEXT NOT NULL,
    external_order_number TEXT NOT NULL,
    order_status TEXT NOT NULL DEFAULT 'new',
    payment_status TEXT NOT NULL DEFAULT 'unknown',
    fulfillment_status TEXT NOT NULL DEFAULT 'pending',
    document_status TEXT NOT NULL DEFAULT 'not_requested',
    provider_status TEXT,
    document_requirement TEXT NOT NULL,
    document_type_policy TEXT NOT NULL,
    requested_document_type TEXT,
    currency TEXT NOT NULL DEFAULT 'PEN',
    subtotal NUMERIC(14,2),
    shipping_amount NUMERIC(14,2),
    discount_amount NUMERIC(14,2),
    total NUMERIC(14,2),
    customer JSONB NOT NULL DEFAULT '{}'::jsonb,
    shipping JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    ordered_at TIMESTAMPTZ,
    promised_shipping_at TIMESTAMPTZ,
    provider_updated_at TIMESTAMPTZ,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (channel_account_id, company_id)
      REFERENCES order_channel_accounts(id, company_id) ON DELETE CASCADE,
    UNIQUE (channel_account_id, external_order_id),
    CHECK (order_status IN ('new', 'confirmed', 'completed', 'cancelled', 'failed')),
    CHECK (payment_status IN ('unknown', 'pending', 'paid', 'partially_refunded', 'refunded', 'failed')),
    CHECK (fulfillment_status IN ('pending', 'preparing', 'ready_to_ship', 'shipped', 'delivered', 'cancelled', 'returned', 'failed')),
    CHECK (document_status IN ('not_requested', 'pending', 'issued', 'accepted', 'rejected', 'cancelled')),
    CHECK (document_requirement IN ('disabled', 'optional', 'required')),
    CHECK (document_type_policy IN ('automatic', 'boleta', 'factura', 'customer_choice')),
    CHECK (requested_document_type IS NULL OR requested_document_type IN ('boleta', 'factura'))
  );
  CREATE INDEX IF NOT EXISTS idx_orders_company_ordered
    ON orders(company_id, ordered_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_orders_account_status
    ON orders(channel_account_id, order_status, fulfillment_status);
  CREATE INDEX IF NOT EXISTS idx_orders_external_number
    ON orders(company_id, external_order_number);
  CREATE INDEX IF NOT EXISTS idx_orders_promised_shipping
    ON orders(promised_shipping_at)
    WHERE fulfillment_status NOT IN ('delivered', 'cancelled', 'returned');

  CREATE TABLE IF NOT EXISTS order_items (
    id BIGSERIAL PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    external_item_id TEXT NOT NULL,
    sku TEXT,
    provider_sku TEXT,
    description TEXT NOT NULL DEFAULT '',
    quantity NUMERIC(14,4) NOT NULL DEFAULT 1,
    unit_price NUMERIC(14,4),
    discount_amount NUMERIC(14,2),
    tax_amount NUMERIC(14,2),
    total NUMERIC(14,2),
    provider_status TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (order_id, external_item_id)
  );
  CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
  CREATE INDEX IF NOT EXISTS idx_order_items_sku ON order_items(sku);

  -- Catálogo canónico multi-seller. El producto representa la unidad física y
  -- su inventario es compartido por todos los listings de la instancia.
  CREATE TABLE IF NOT EXISTS products (
    id BIGSERIAL PRIMARY KEY,
    main_sku TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    brand TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    barcode TEXT,
    image_url TEXT,
    reference_price NUMERIC(14,2),
    unit TEXT NOT NULL DEFAULT 'each',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT,
    updated_by TEXT,
    CHECK (char_length(trim(main_sku)) BETWEEN 1 AND 64),
    CHECK (status IN ('active', 'inactive', 'archived')),
    CHECK (unit IN ('each'))
  );
  CREATE INDEX IF NOT EXISTS idx_products_status_updated
    ON products(status, updated_at DESC, id DESC);

  -- Búsqueda operacional del catálogo. Trigram mantiene rápidas las búsquedas
  -- parciales por SKU/nombre cuando la tabla crece.
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX IF NOT EXISTS idx_products_main_sku_trgm
    ON products USING GIN (main_sku gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS idx_products_name_trgm
    ON products USING GIN (name gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS idx_products_brand_trgm
    ON products USING GIN (brand gin_trgm_ops);

  CREATE TABLE IF NOT EXISTS product_listings (
    id BIGSERIAL PRIMARY KEY,
    product_id BIGINT NOT NULL REFERENCES products(id),
    channel_code TEXT NOT NULL,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    channel_account_id BIGINT REFERENCES order_channel_accounts(id) ON DELETE SET NULL,
    seller_sku TEXT NOT NULL,
    shop_sku TEXT,
    external_product_id TEXT,
    title TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    marketplace_quantity NUMERIC(14,4),
    marketplace_synced_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (channel_code, company_id, seller_sku),
    CHECK (channel_code ~ '^[a-z][a-z0-9_-]{1,49}$'),
    CHECK (status IN ('active', 'inactive', 'unlinked'))
  );
  CREATE INDEX IF NOT EXISTS idx_product_listings_product ON product_listings(product_id);
  CREATE INDEX IF NOT EXISTS idx_product_listings_company_channel
    ON product_listings(company_id, channel_code);
  CREATE INDEX IF NOT EXISTS idx_product_listings_active_shop_sku
    ON product_listings(channel_code, company_id, shop_sku)
    WHERE shop_sku IS NOT NULL AND shop_sku <> '' AND status = 'active';
  CREATE INDEX IF NOT EXISTS idx_product_listings_seller_sku_trgm
    ON product_listings USING GIN (seller_sku gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS idx_product_listings_shop_sku_trgm
    ON product_listings USING GIN (shop_sku gin_trgm_ops)
    WHERE shop_sku IS NOT NULL AND shop_sku <> '';

  CREATE TABLE IF NOT EXISTS product_inventory (
    product_id BIGINT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
    quantity_on_hand NUMERIC(14,4) NOT NULL DEFAULT 0,
    quantity_reserved NUMERIC(14,4) NOT NULL DEFAULT 0,
    reorder_point NUMERIC(14,4),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (quantity_reserved >= 0)
  );

  ALTER TABLE order_items
    ADD COLUMN IF NOT EXISTS product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS listing_id BIGINT REFERENCES product_listings(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS main_sku TEXT,
    ADD COLUMN IF NOT EXISTS stock_state TEXT NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS stock_applied_quantity NUMERIC(14,4) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS stock_revision INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);
  CREATE INDEX IF NOT EXISTS idx_order_items_stock_queue
    ON order_items(stock_state, updated_at DESC)
    WHERE stock_state IN ('skipped_unmapped', 'skipped_insufficient');

  DO $$ BEGIN
    ALTER TABLE order_items ADD CONSTRAINT order_items_stock_state_check
      CHECK (stock_state IN (
        'none', 'pending', 'applied', 'reversed', 'skipped_unmapped',
        'skipped_policy', 'skipped_insufficient'
      ));
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN
    ALTER TABLE order_items ADD CONSTRAINT order_items_stock_revision_check
      CHECK (stock_revision >= 0);
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN
    ALTER TABLE order_items ADD CONSTRAINT order_items_stock_applied_quantity_check
      CHECK (stock_applied_quantity >= 0);
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

  CREATE TABLE IF NOT EXISTS inventory_movements (
    id BIGSERIAL PRIMARY KEY,
    product_id BIGINT NOT NULL REFERENCES products(id),
    movement_type TEXT NOT NULL,
    quantity_delta NUMERIC(14,4) NOT NULL,
    quantity_after NUMERIC(14,4) NOT NULL,
    reason TEXT,
    actor_user_id TEXT,
    source TEXT NOT NULL,
    order_id BIGINT REFERENCES orders(id) ON DELETE SET NULL,
    order_item_id BIGINT REFERENCES order_items(id) ON DELETE SET NULL,
    listing_id BIGINT REFERENCES product_listings(id) ON DELETE SET NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (movement_type IN (
      'sale', 'sale_adjust', 'sale_reversal', 'adjustment_in', 'adjustment_out',
      'return', 'initial', 'import'
    )),
    CHECK (quantity_delta <> 0)
  );
  CREATE INDEX IF NOT EXISTS idx_inventory_movements_product_created
    ON inventory_movements(product_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_inventory_movements_order
    ON inventory_movements(order_id) WHERE order_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_inventory_movements_order_item
    ON inventory_movements(order_item_id) WHERE order_item_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS order_events (
    id BIGSERIAL PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    source TEXT NOT NULL,
    actor_user_id TEXT,
    idempotency_key TEXT,
    correlation_id TEXT,
    previous_values JSONB NOT NULL DEFAULT '{}'::jsonb,
    new_values JSONB NOT NULL DEFAULT '{}'::jsonb,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    provider_occurred_at TIMESTAMPTZ,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (order_id, idempotency_key),
    CHECK (source IN ('provider', 'webhook', 'sync', 'user', 'system', 'api', 'file', 'manual'))
  );
  CREATE INDEX IF NOT EXISTS idx_order_events_timeline
    ON order_events(order_id, created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_order_events_correlation
    ON order_events(correlation_id) WHERE correlation_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS order_snapshots (
    id BIGSERIAL PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    payload_hash TEXT NOT NULL,
    raw_payload JSONB NOT NULL,
    provider_updated_at TIMESTAMPTZ,
    correlation_id TEXT,
    observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (order_id, payload_hash)
  );
  CREATE INDEX IF NOT EXISTS idx_order_snapshots_order_observed
    ON order_snapshots(order_id, observed_at DESC);

  CREATE TABLE IF NOT EXISTS order_documents (
    id BIGSERIAL PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    document_kind TEXT NOT NULL,
    boleta_id INTEGER REFERENCES boletas(id) ON DELETE CASCADE,
    factura_id INTEGER REFERENCES facturas(id) ON DELETE CASCADE,
    credit_note_id INTEGER REFERENCES credit_notes(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
      (document_kind = 'boleta' AND boleta_id IS NOT NULL AND factura_id IS NULL AND credit_note_id IS NULL)
      OR (document_kind = 'factura' AND factura_id IS NOT NULL AND boleta_id IS NULL AND credit_note_id IS NULL)
      OR (document_kind = 'credit_note' AND credit_note_id IS NOT NULL AND boleta_id IS NULL AND factura_id IS NULL)
    ),
    UNIQUE (order_id, boleta_id),
    UNIQUE (order_id, factura_id),
    UNIQUE (order_id, credit_note_id)
  );
  CREATE INDEX IF NOT EXISTS idx_order_documents_order ON order_documents(order_id);

  CREATE TABLE IF NOT EXISTS order_commands (
    id BIGSERIAL PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    command_type TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    requested_by TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    response_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    UNIQUE (order_id, idempotency_key),
    CHECK (status IN ('pending', 'processing', 'succeeded', 'failed'))
  );
  CREATE INDEX IF NOT EXISTS idx_order_commands_pending
    ON order_commands(status, created_at) WHERE status IN ('pending', 'processing');

  CREATE TABLE IF NOT EXISTS order_sync_runs (
    id BIGSERIAL PRIMARY KEY,
    channel_account_id BIGINT NOT NULL REFERENCES order_channel_accounts(id) ON DELETE CASCADE,
    mode TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    cursor_from TEXT,
    cursor_to TEXT,
    received_count INTEGER NOT NULL DEFAULT 0,
    upserted_count INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    CHECK (status IN ('running', 'success', 'error', 'partial'))
  );
  CREATE INDEX IF NOT EXISTS idx_order_sync_runs_account_started
    ON order_sync_runs(channel_account_id, started_at DESC);

  -- Backfill idempotente. Los items se completarán cuando el adaptador reciba
  -- un payload que realmente los incluya.
  INSERT INTO orders (
    company_id, channel_account_id, external_order_id, external_order_number,
    order_status, payment_status, fulfillment_status, document_status, provider_status,
    document_requirement, document_type_policy, requested_document_type,
    currency, total, customer, shipping, metadata,
    ordered_at, provider_updated_at, first_seen_at, last_seen_at, created_at, updated_at
  )
  SELECT
    fo.company_id,
    account.id,
    fo.order_id,
    fo.order_number,
    CASE
      WHEN lower(coalesce(fo.status, '')) ~ '(canceled|cancelled)' THEN 'cancelled'
      WHEN lower(coalesce(fo.status, '')) ~ 'failed' THEN 'failed'
      WHEN lower(coalesce(fo.status, '')) ~ '(delivered|returned|return_)' THEN 'completed'
      ELSE 'confirmed'
    END,
    'unknown',
    CASE
      WHEN lower(coalesce(fo.status, '')) ~ '(canceled|cancelled)' THEN 'cancelled'
      WHEN lower(coalesce(fo.status, '')) ~ '(returned|return_)' THEN 'returned'
      WHEN lower(coalesce(fo.status, '')) ~ 'failed' THEN 'failed'
      WHEN lower(coalesce(fo.status, '')) ~ 'delivered' THEN 'delivered'
      WHEN lower(coalesce(fo.status, '')) ~ 'shipped' THEN 'shipped'
      WHEN lower(coalesce(fo.status, '')) ~ 'ready_to_ship' THEN 'ready_to_ship'
      ELSE 'pending'
    END,
    CASE
      WHEN account.document_requirement = 'disabled' THEN 'not_requested'
      WHEN fo.invoice_required THEN 'pending'
      WHEN account.document_requirement = 'required' THEN 'pending'
      ELSE 'not_requested'
    END,
    fo.status,
    account.document_requirement,
    account.document_type_policy,
    CASE
      WHEN account.document_requirement <> 'disabled' AND fo.invoice_required THEN 'factura'
      ELSE NULL
    END,
    coalesce(nullif(fo.currency, ''), 'PEN'),
    fo.grand_total,
    jsonb_build_object(
      'name', trim(concat_ws(' ', fo.raw_data->>'CustomerFirstName', fo.raw_data->>'CustomerLastName', fo.raw_data->>'CustomerLastName2')),
      'documentNumber', coalesce(
        fo.raw_data->>'NationalRegistrationNumber',
        fo.raw_data->>'CustomerNationalRegistrationNumber',
        fo.raw_data->>'CustomerDocumentNumber',
        ''
      ),
      'email', coalesce(fo.raw_data->>'CustomerEmail', fo.raw_data->>'Email', ''),
      'phone', coalesce(fo.raw_data->>'CustomerPhone', fo.raw_data->>'Phone', '')
    ),
    jsonb_build_object(
      'type', coalesce(fo.raw_data->>'ShippingType', ''),
      'trackingCode', coalesce(fo.raw_data->>'TrackingCode', fo.raw_data->>'TrackingNumber', '')
    ),
    jsonb_build_object(
      'origin', 'legacy_falabella',
      'invoiceRequired', fo.invoice_required
    ),
    fo.falabella_created_at,
    fo.falabella_updated_at,
    fo.first_seen_at,
    fo.last_seen_at,
    fo.first_seen_at,
    fo.synchronized_at
  FROM falabella_orders fo
  JOIN order_channels channel ON channel.code = 'falabella'
  JOIN order_channel_accounts account
    ON account.company_id = fo.company_id
    AND account.channel_id = channel.id
    AND account.external_account_id = 'default'
  ON CONFLICT (channel_account_id, external_order_id) DO NOTHING;

  INSERT INTO order_snapshots (
    order_id, payload_hash, raw_payload, provider_updated_at, correlation_id, observed_at
  )
  SELECT
    o.id,
    'legacy-md5:' || md5(fo.raw_data::text),
    fo.raw_data,
    fo.falabella_updated_at,
    'falabella-backfill',
    fo.synchronized_at
  FROM falabella_orders fo
  JOIN order_channels channel ON channel.code = 'falabella'
  JOIN order_channel_accounts account
    ON account.company_id = fo.company_id
    AND account.channel_id = channel.id
    AND account.external_account_id = 'default'
  JOIN orders o
    ON o.channel_account_id = account.id
    AND o.external_order_id = fo.order_id
  ON CONFLICT (order_id, payload_hash) DO NOTHING;

  INSERT INTO order_events (
    order_id, event_type, source, idempotency_key, correlation_id,
    previous_values, new_values, payload, provider_occurred_at, received_at, created_at
  )
  SELECT
    o.id,
    'order.created',
    'system',
    'legacy-backfill:' || fo.id,
    'falabella-backfill',
    '{}'::jsonb,
    jsonb_build_object(
      'orderStatus', o.order_status,
      'fulfillmentStatus', o.fulfillment_status,
      'providerStatus', o.provider_status
    ),
    '{"origin":"legacy_falabella"}'::jsonb,
    fo.falabella_updated_at,
    fo.first_seen_at,
    fo.first_seen_at
  FROM falabella_orders fo
  JOIN order_channels channel ON channel.code = 'falabella'
  JOIN order_channel_accounts account
    ON account.company_id = fo.company_id
    AND account.channel_id = channel.id
    AND account.external_account_id = 'default'
  JOIN orders o
    ON o.channel_account_id = account.id
    AND o.external_order_id = fo.order_id
  ON CONFLICT (order_id, idempotency_key) DO NOTHING;

  INSERT INTO order_documents (order_id, document_kind, boleta_id)
  SELECT o.id, 'boleta', b.id
  FROM boletas b
  JOIN order_channels channel ON channel.code = 'falabella'
  JOIN order_channel_accounts account
    ON account.company_id = b.company_id
    AND account.channel_id = channel.id
    AND account.external_account_id = 'default'
  JOIN orders o
    ON o.channel_account_id = account.id
    AND o.external_order_number = b.order_number
  WHERE nullif(b.order_number, '') IS NOT NULL
  ON CONFLICT (order_id, boleta_id) DO NOTHING;

  INSERT INTO order_documents (order_id, document_kind, factura_id)
  SELECT o.id, 'factura', f.id
  FROM facturas f
  JOIN order_channels channel ON channel.code = 'falabella'
  JOIN order_channel_accounts account
    ON account.company_id = f.company_id
    AND account.channel_id = channel.id
    AND account.external_account_id = 'default'
  JOIN orders o
    ON o.channel_account_id = account.id
    AND o.external_order_number = f.order_number
  WHERE nullif(f.order_number, '') IS NOT NULL
  ON CONFLICT (order_id, factura_id) DO NOTHING;

  INSERT INTO order_documents (order_id, document_kind, credit_note_id)
  SELECT DISTINCT o.id, 'credit_note', cn.id
  FROM credit_notes cn
  LEFT JOIN boletas b ON b.id = cn.affected_boleta_id
  LEFT JOIN facturas f ON f.id = cn.affected_factura_id
  JOIN order_channels channel ON channel.code = 'falabella'
  JOIN order_channel_accounts account
    ON account.company_id = cn.company_id
    AND account.channel_id = channel.id
    AND account.external_account_id = 'default'
  JOIN orders o
    ON o.channel_account_id = account.id
    AND o.external_order_number = coalesce(b.order_number, f.order_number)
  WHERE coalesce(nullif(b.order_number, ''), nullif(f.order_number, '')) IS NOT NULL
  ON CONFLICT (order_id, credit_note_id) DO NOTHING;

  UPDATE orders o
  SET document_status = CASE
      WHEN EXISTS (
        SELECT 1 FROM order_documents od
        LEFT JOIN boletas b ON b.id = od.boleta_id
        LEFT JOIN facturas f ON f.id = od.factura_id
        WHERE od.order_id = o.id
          AND upper(coalesce(b.estado_sunat, f.estado_sunat, '')) = 'ACEPTADO'
      ) THEN 'accepted'
      WHEN EXISTS (
        SELECT 1 FROM order_documents od
        LEFT JOIN boletas b ON b.id = od.boleta_id
        LEFT JOIN facturas f ON f.id = od.factura_id
        WHERE od.order_id = o.id
          AND upper(coalesce(b.estado_sunat, f.estado_sunat, '')) = 'RECHAZADO'
      ) THEN 'rejected'
      ELSE 'issued'
    END,
    updated_at = now()
  WHERE EXISTS (
    SELECT 1 FROM order_documents od
    WHERE od.order_id = o.id AND od.document_kind IN ('boleta', 'factura')
  );
`;

export async function runMigrations(pool: Pool): Promise<void> {
  await pool.query(DDL);
  await pool.query(`
    ALTER TABLE companies ADD COLUMN IF NOT EXISTS ripley_api_key TEXT;
    ALTER TABLE companies ADD COLUMN IF NOT EXISTS ripley_shop_id TEXT;
  `);
  // El modo SUNAT lo define el ambiente (SUNAT_FORCE_ENV), no la empresa.
  await pool.query(`ALTER TABLE companies DROP COLUMN IF EXISTS modo_produccion`);
}
