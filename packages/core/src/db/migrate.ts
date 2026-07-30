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
`;

export async function runMigrations(pool: Pool): Promise<void> {
  await pool.query(DDL);
  // El modo SUNAT lo define el ambiente (SUNAT_FORCE_ENV), no la empresa.
  await pool.query(`ALTER TABLE companies DROP COLUMN IF EXISTS modo_produccion`);
}
