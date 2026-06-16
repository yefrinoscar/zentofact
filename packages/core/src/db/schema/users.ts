import { pgTable, serial, integer, bigint, text, boolean } from 'drizzle-orm/pg-core';
import { companies } from './companies';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  password: text('password').notNull(),
  companyId: integer('company_id').references(() => companies.id, { onDelete: 'set null' }),
  role: text('role').default('company_user'),
  activo: boolean('activo').default(true),
  lastLoginAt: bigint('last_login_at', { mode: 'number' }),
  createdAt: bigint('created_at', { mode: 'number' }),
  updatedAt: bigint('updated_at', { mode: 'number' }),
});
