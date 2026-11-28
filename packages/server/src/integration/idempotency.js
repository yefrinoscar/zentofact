import { stableHash } from './crypto.js';
import { ProblemError } from './problems.js';

const IN_PROGRESS_STALE_MS = 2 * 60 * 1000;

/**
 * Ejecuta `work` una sola vez por (cuenta, Idempotency-Key). Misma llave y
 * mismo cuerpo → se repite la respuesta guardada; otro cuerpo → 422; si la
 * primera sigue corriendo → 409 idempotency_in_progress.
 * `work` devuelve { status, body }. Los errores 5xx liberan la llave.
 */
export async function runIdempotent(db, { accountId, key, request }, work) {
  const idempotencyKey = String(key || '').trim();
  if (!idempotencyKey || idempotencyKey.length > 255) {
    throw new ProblemError('validation_failed', 'El header Idempotency-Key es obligatorio (máx. 255 caracteres).', {
      errors: [{ path: 'Idempotency-Key', message: 'Header obligatorio.' }],
    });
  }
  const requestHash = stableHash(request);
  const inserted = await db.query(
    `insert into integration_idempotency (channel_account_id, key, request_hash, status)
     values ($1, $2, $3, 'in_progress')
     on conflict (channel_account_id, key) do nothing
     returning id`,
    [accountId, idempotencyKey, requestHash],
  );
  if (!inserted.rows.length) {
    const existing = (await db.query(
      'select * from integration_idempotency where channel_account_id=$1 and key=$2',
      [accountId, idempotencyKey],
    )).rows[0];
    if (!existing) throw new ProblemError('idempotency_in_progress', 'Reintenta en unos segundos.');
    if (existing.request_hash !== requestHash) {
      throw new ProblemError('idempotency_key_reused', 'Esta Idempotency-Key ya se usó con otro cuerpo.');
    }
    if (existing.status === 'completed') {
      return { status: Number(existing.response_status), body: existing.response, replayed: true };
    }
    const stale = Date.now() - new Date(existing.updated_at).getTime() > IN_PROGRESS_STALE_MS;
    const retaken = stale ? await db.query(
      `update integration_idempotency set updated_at=now()
       where id=$1 and status='in_progress' and updated_at=$2 returning id`,
      [existing.id, existing.updated_at],
    ) : { rows: [] };
    if (!retaken.rows.length) throw new ProblemError('idempotency_in_progress', 'La misma solicitud sigue en proceso.');
  }
  let result;
  try {
    result = await work();
  } catch (error) {
    if (error instanceof ProblemError && error.code !== 'internal') {
      const { problemBody } = await import('./problems.js');
      const body = problemBody(error.code, error.detail, error.extra);
      await complete(db, accountId, idempotencyKey, body.status, body);
      throw error;
    }
    await db.query(
      `delete from integration_idempotency where channel_account_id=$1 and key=$2 and status='in_progress'`,
      [accountId, idempotencyKey],
    ).catch(() => {});
    throw error;
  }
  await complete(db, accountId, idempotencyKey, result.status, result.body);
  return { ...result, replayed: false };
}

async function complete(db, accountId, key, status, body) {
  await db.query(
    `update integration_idempotency set status='completed', response_status=$3, response=$4, updated_at=now()
     where channel_account_id=$1 and key=$2`,
    [accountId, key, status, JSON.stringify(body)],
  );
}
