import { pool } from '../db';

/**
 * Ejecuta `fn` con un advisory lock de sesión de PostgreSQL. Si otro proceso ya
 * tiene el mismo lock no espera: devuelve `onBusy()`. Se usa para que dos jobs
 * del mismo pedido no consulten SUNAT y quemen correlativos al mismo tiempo.
 */
export async function withDocumentLock<T>(key: string, fn: () => Promise<T>, onBusy: () => T): Promise<T> {
  const client = await pool.connect();
  try {
    const locked = await client.query<{ ok: boolean }>('select pg_try_advisory_lock(hashtext($1)) as ok', [key]);
    if (!locked.rows[0]?.ok) return onBusy();
    try {
      return await fn();
    } finally {
      await client.query('select pg_advisory_unlock(hashtext($1))', [key]).catch(() => undefined);
    }
  } finally {
    client.release();
  }
}

export function reemissionLockKey(doc: { companyId: number; tipoDocumento?: string | null; orderNumber?: string | null; id: number }): string {
  const scope = doc.orderNumber ? `order:${doc.orderNumber}` : `id:${doc.id}`;
  return `sunat-reemit:${doc.companyId}:${doc.tipoDocumento || ''}:${scope}`;
}
