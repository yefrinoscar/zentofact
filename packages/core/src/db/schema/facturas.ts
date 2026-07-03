import { pgTable, serial, integer, bigint, text, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { branches } from './branches';
import { clients } from './clients';
import { dailySummaries } from './daily-summaries';

export const facturas = pgTable('facturas', {
  id: serial('id').primaryKey(),
  companyId: integer('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  branchId: integer('branch_id').notNull().references(() => branches.id, { onDelete: 'cascade' }),
  clientId: integer('client_id').notNull().references(() => clients.id, { onDelete: 'set null' }),
  dailySummaryId: integer('daily_summary_id').references(() => dailySummaries.id, { onDelete: 'set null' }),

  tipoDocumento: text('tipo_documento').default('01'),
  serie: text('serie').notNull(),
  correlativo: text('correlativo').notNull(),
  numeroCompleto: text('numero_completo').notNull(),
  orderNumber: text('order_number'),

  fechaEmision: text('fecha_emision').notNull(),
  ublVersion: text('ubl_version').default('2.1'),
  tipoOperacion: text('tipo_operacion').default('0101'),
  moneda: text('moneda').default('PEN'),
  metodoEnvio: text('metodo_envio').default('individual'),

  valorVenta: text('valor_venta').default('0'),
  mtoOperGravadas: text('mto_oper_gravadas').default('0'),
  mtoOperExoneradas: text('mto_oper_exoneradas').default('0'),
  mtoOperInafectas: text('mto_oper_inafectas').default('0'),
  mtoOperGratuitas: text('mto_oper_gratuitas').default('0'),
  mtoIgvGratuitas: text('mto_igv_gratuitas').default('0'),
  mtoIgv: text('mto_igv').default('0'),
  mtoBaseIvap: text('mto_base_ivap').default('0'),
  mtoIvap: text('mto_ivap').default('0'),
  mtoIsc: text('mto_isc').default('0'),
  mtoIcbper: text('mto_icbper').default('0'),
  totalImpuestos: text('total_impuestos').default('0'),
  subTotal: text('sub_total').default('0'),
  mtoImpVenta: text('mto_imp_venta').default('0'),

  detalles: jsonb('detalles').notNull(),
  leyendas: jsonb('leyendas'),
  datosAdicionales: jsonb('datos_adicionales'),

  xmlPath: text('xml_path'),
  cdrPath: text('cdr_path'),
  pdfPath: text('pdf_path'),

  estadoSunat: text('estado_sunat').default('PENDIENTE'),
  respuestaSunat: text('respuesta_sunat'),
  codigoHash: text('codigo_hash'),

  // Legacy fields (Falabella upload tracking)
  fuente: text('fuente').default('manual'),
  orderItemIds: jsonb('order_item_ids'),
  respuestaFalabella: text('respuesta_falabella'),

  usuarioCreacion: text('usuario_creacion'),
  createdAt: bigint('created_at', { mode: 'number' }),
  updatedAt: bigint('updated_at', { mode: 'number' }),
}, (table) => ({
  uniqueSerieCorr: uniqueIndex('idx_facturas_company_serie_corr').on(table.companyId, table.serie, table.correlativo),
  companyBranchIdx: index('idx_facturas_company_branch').on(table.companyId, table.branchId),
  fechaIdx: index('idx_facturas_fecha_emision').on(table.fechaEmision),
  estadoIdx: index('idx_facturas_estado_sunat').on(table.estadoSunat),
  orderIdx: index('idx_facturas_order_number').on(table.orderNumber),
  summaryIdx: index('idx_facturas_daily_summary').on(table.dailySummaryId),
}));
