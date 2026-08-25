// Tablas que Better Auth administra, definidas aquí para consultas Drizzle del servidor.
import { bigserial, boolean, jsonb, numeric, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const authUsers = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  emailVerified: boolean('emailVerified').notNull().default(false),
  image: text('image'),
  role: text('role'),
  permissions: text('permissions'),
  active: boolean('active'),
  commissionPercent: numeric('commission_percent', { precision: 5, scale: 2 }),
  createdAt: timestamp('createdAt', { withTimezone: true }),
  updatedAt: timestamp('updatedAt', { withTimezone: true }),
});

export const authAccounts = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  userId: text('userId').notNull(),
  password: text('password'),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: timestamp('accessTokenExpiresAt', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt', { withTimezone: true }),
  scope: text('scope'),
  createdAt: timestamp('createdAt', { withTimezone: true }),
  updatedAt: timestamp('updatedAt', { withTimezone: true }),
});

export const authSessions = pgTable('session', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
});

export const userAuditLog = pgTable('user_audit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  actorId: text('actor_id'),
  targetId: text('target_id'),
  action: text('action').notNull(),
  details: jsonb('details').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
