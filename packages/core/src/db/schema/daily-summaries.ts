import { pgTable, serial, integer, bigint, text } from 'drizzle-orm/pg-core';
import { jsonb } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { branches } from './branches';

export const dailySummaries = pgTable('daily_summaries', {
  id: serial('id').primaryKey(),
  companyId: integer('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  branchId: integer('branch_id').notNull().references(() => branches.id, { onDelete: 'cascade' }),
  fechaResumen: text('fecha_resumen').notNull(),
  correlativo: text('correlativo').notNull(),
  numeroCompleto: text('numero_completo'),
  ticket: text('ticket'),
  estado: text('estado').default('PENDIENTE'),
  responseCode: text('response_code'),
  responseDescription: text('response_description'),
  boletaCount: integer('boleta_count').default(0),
  orderNumbers: jsonb('order_numbers'),
  pdfFolder: text('pdf_folder'),
  xmlPath: text('xml_path'),
  cdrPath: text('cdr_path'),
  respuestaSunat: text('respuesta_sunat'),
  usuarioCreacion: text('usuario_creacion'),
  createdAt: bigint('created_at', { mode: 'number' }),
  updatedAt: bigint('updated_at', { mode: 'number' }),
});
