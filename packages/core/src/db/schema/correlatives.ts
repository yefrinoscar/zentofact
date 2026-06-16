import { pgTable, serial, integer, bigint, text, boolean } from 'drizzle-orm/pg-core';
import { branches } from './branches';

export const correlatives = pgTable('correlatives', {
  id: serial('id').primaryKey(),
  branchId: integer('branch_id').notNull().references(() => branches.id, { onDelete: 'cascade' }),
  tipoDocumento: text('tipo_documento').notNull(),
  serie: text('serie').notNull(),
  correlativoActual: integer('correlativo_actual').default(0),
  activo: boolean('activo').default(true),
  createdAt: bigint('created_at', { mode: 'number' }),
  updatedAt: bigint('updated_at', { mode: 'number' }),
});
