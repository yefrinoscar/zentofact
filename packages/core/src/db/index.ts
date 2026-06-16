import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import * as schema from './schema/index';

dotenv.config();

const connectionString =
  process.env.DATABASE_URL_POSTGRES ||
  (process.env.DATABASE_URL && !process.env.DATABASE_URL.startsWith('sqlite:')
    ? process.env.DATABASE_URL
    : undefined);

if (!connectionString) {
  throw new Error(
    'Missing Postgres connection string. Set DATABASE_URL_POSTGRES (or a non-sqlite DATABASE_URL).'
  );
}

export const pool = new Pool({ connectionString });

export const db = drizzle(pool, { schema });
export type DB = typeof db;
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
