import { db } from '../db';
import { correlatives } from '../db/schema';
import { eq, and } from 'drizzle-orm';

export function getCorrelatives(branchId: number) {
  return db.select().from(correlatives)
    .where(and(eq(correlatives.branchId, branchId), eq(correlatives.activo, true)));
}

export async function getCorrelativeBySerie(branchId: number, tipoDocumento: string, serie: string) {
  const rows = await db.select().from(correlatives)
    .where(and(
      eq(correlatives.branchId, branchId),
      eq(correlatives.tipoDocumento, tipoDocumento),
      eq(correlatives.serie, serie),
      eq(correlatives.activo, true),
    ))
    .limit(1);
  return rows[0];
}
