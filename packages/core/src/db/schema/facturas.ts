import { pgTable, serial, integer, bigint, text, jsonb, index } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { branches } from './branches';

export const facturas = pgTable('facturas', {
  id: serial('id').primaryKey(),
  companyId: integer('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  branchId: integer('branch_id').references(() => branches.id, { onDelete: 'set null' }),
  tipoDocumento: text('tipo_documento').default('01'),
  numeroCompleto: text('numero_completo').notNull(),
  orderNumber: text('order_number').notNull(),
  fechaEmision: text('fecha_emision').notNull(),
  pdfPath: text('pdf_path'),
  fuente: text('fuente').default('manual'),
  estado: text('estado').default('REGISTRADO'),
  orderItemIds: jsonb('order_item_ids'),
  respuestaFalabella: text('respuesta_falabella'),
  createdAt: bigint('created_at', { mode: 'number' }),
  updatedAt: bigint('updated_at', { mode: 'number' }),
}, (table) => ({
  companyIdx: index('idx_facturas_company').on(table.companyId),
  orderIdx: index('idx_facturas_order_number').on(table.orderNumber),
  fechaIdx: index('idx_facturas_fecha_emision').on(table.fechaEmision),
  estadoIdx: index('idx_facturas_estado').on(table.estado),
}));
