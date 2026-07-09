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
    modo_produccion BOOLEAN DEFAULT FALSE,
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

  CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_notes_company_serie_corr ON credit_notes(company_id, serie, correlativo);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_notes_affected_boleta ON credit_notes(affected_boleta_id);
  CREATE INDEX IF NOT EXISTS idx_credit_notes_company_branch ON credit_notes(company_id, branch_id);
  CREATE INDEX IF NOT EXISTS idx_credit_notes_fecha_emision ON credit_notes(fecha_emision);
  CREATE INDEX IF NOT EXISTS idx_credit_notes_estado_sunat ON credit_notes(estado_sunat);

  ALTER TABLE credit_notes ALTER COLUMN affected_boleta_id DROP NOT NULL;
`;

export async function runMigrations(pool: Pool): Promise<void> {
  await pool.query(DDL);
}
