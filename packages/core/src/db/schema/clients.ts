import { pgTable, serial, integer, bigint, text, boolean } from 'drizzle-orm/pg-core';
import { companies } from './companies';

export const clients = pgTable('clients', {
  id: serial('id').primaryKey(),
  companyId: integer('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  tipoDocumento: text('tipo_documento').notNull(),
  numeroDocumento: text('numero_documento').notNull(),
  razonSocial: text('razon_social').notNull(),
  nombreComercial: text('nombre_comercial'),
  direccion: text('direccion'),
  ubigeo: text('ubigeo'),
  distrito: text('distrito'),
  provincia: text('provincia'),
  departamento: text('departamento'),
  telefono: text('telefono'),
  email: text('email'),
  activo: boolean('activo').default(true),
  createdAt: bigint('created_at', { mode: 'number' }),
  updatedAt: bigint('updated_at', { mode: 'number' }),
});
