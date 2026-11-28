import { hashesEqual, parseApiKey, serverKeyEnv, sha256Hex } from './crypto.js';
import { ProblemError } from './problems.js';
import { normalizeIntegrationAccount } from './store-orders.js';

export const SCOPES = ['orders:write', 'orders:read', 'documents:read', 'inventory:read', 'policy:read'];
const DUMMY_HASH = sha256Hex('zentofact-integration-dummy');

/**
 * Resuelve la llave Bearer a su cuenta de tienda. Fail-closed: cualquier
 * duda (formato, entorno, revocada, cuenta inactiva) → 401 genérico.
 */
export async function authenticateApiKey(db, authorization, { env = process.env } = {}) {
  const match = /^Bearer\s+(\S+)$/i.exec(String(authorization || '').trim());
  const parsed = match ? parseApiKey(match[1]) : null;
  if (!parsed) throw new ProblemError('unauthorized', 'Falta una llave de API válida.');
  const row = (await db.query(
    `select k.id as key_row_id, k.key_id, k.env, k.secret_hash, k.scopes, k.revoked_at,
       a.*, ch.code as channel_code
     from integration_keys k
     join order_channel_accounts a on a.id=k.channel_account_id
     join order_channels ch on ch.id=a.channel_id
     where k.key_id=$1`,
    [parsed.keyId],
  )).rows[0];
  const secretMatches = hashesEqual(row?.secret_hash || DUMMY_HASH, sha256Hex(parsed.secret));
  if (!row || !secretMatches) throw new ProblemError('unauthorized', 'Llave de API inválida.');
  if (row.revoked_at) throw new ProblemError('unauthorized', 'La llave de API fue revocada.');
  const expectedEnv = serverKeyEnv(env);
  if (parsed.env !== row.env || row.env !== expectedEnv) {
    throw new ProblemError('unauthorized', `Esta API solo acepta llaves ${expectedEnv}.`);
  }
  const account = normalizeIntegrationAccount(row);
  if (!account.active || account.settings?.integration !== true) {
    throw new ProblemError('unauthorized', 'La cuenta de la tienda no tiene la integración activa.');
  }
  db.query('update integration_keys set last_used_at=now() where id=$1', [row.key_row_id]).catch(() => {});
  return { account, keyId: row.key_id, scopes: Array.isArray(row.scopes) ? row.scopes : [] };
}

export function assertScope(scopes, scope) {
  if (!scopes.includes(scope)) throw new ProblemError('forbidden_scope', `La llave no tiene el permiso ${scope}.`);
}
