import { pgTable, serial, integer, bigint, text, boolean, jsonb } from 'drizzle-orm/pg-core';
import { companies } from './companies';

export const branches = pgTable('branches', {
  id: serial('id').primaryKey(),
  companyId: integer('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  codigo: text('codigo').notNull(),
  nombre: text('nombre').notNull(),
  direccion: text('direccion'),
  ubigeo: text('ubigeo'),
  distrito: text('distrito'),
  provincia: text('provincia'),
  departamento: text('departamento'),
  telefono: text('telefono'),
  email: text('email'),
  seriesFactura: jsonb('series_factura'),
  seriesBoleta: jsonb('series_boleta'),
  seriesNotaCredito: jsonb('series_nota_credito'),
  seriesNotaDebito: jsonb('series_nota_debito'),
  seriesGuiaRemision: jsonb('series_guia_remision'),
  activo: boolean('activo').default(true),
  createdAt: bigint('created_at', { mode: 'number' }),
  updatedAt: bigint('updated_at', { mode: 'number' }),
});
