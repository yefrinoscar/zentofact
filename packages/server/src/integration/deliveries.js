// Entrega de webhooks (Standard Webhooks v1) desde integration_deliveries.
// Reintentos: 5s, 5m, 30m, 2h, 5h, 10h, 14h, 20h, 24h. Un 410 desactiva el endpoint.

import { decryptSecret, signWebhook } from './crypto.js';

export const RETRY_SCHEDULE_SECONDS = [5, 300, 1800, 7200, 18000, 36000, 50400, 72000, 86400];
const LEASE_SECONDS = 60;
const REQUEST_TIMEOUT_MS = 10_000;

let corePromise;
function loadCore() {
  corePromise ||= import('@zentofact/core');
  return corePromise;
}

// Después del intento n (1-based) que falló: segundos hasta el siguiente o null si se agotó.
export function nextRetryDelaySeconds(attempts) {
  const index = Number(attempts) - 1;
  return index >= 0 && index < RETRY_SCHEDULE_SECONDS.length ? RETRY_SCHEDULE_SECONDS[index] : null;
}

export function webhookBody(event) {
  const data = {
    ...(event.external_id ? { externalId: event.external_id } : {}),
    ...(event.payload || {}),
    sequence: Number(event.sequence),
  };
  return JSON.stringify({
    type: event.type,
    timestamp: new Date(event.created_at).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    data,
  });
}

export function webhookHeaders({ secret, eventId, body, now = Date.now() }) {
  const timestamp = Math.floor(now / 1000);
  return {
    'content-type': 'application/json',
    'user-agent': 'Zentofact-Webhooks/1',
    'webhook-id': eventId,
    'webhook-timestamp': String(timestamp),
    'webhook-signature': signWebhook(secret, { id: eventId, timestamp, body }),
  };
}

async function claimDeliveries(pool, limit) {
  return (await pool.query(
    `update integration_deliveries d set locked_until=now() + ($2::int * interval '1 second'), updated_at=now()
     where d.id in (
       select id from integration_deliveries
       where status='pending' and next_attempt_at <= now()
         and (locked_until is null or locked_until < now())
       order by next_attempt_at, id
       limit $1
       for update skip locked
     )
     returning d.*`,
    [limit, LEASE_SECONDS],
  )).rows;
}

function errorText(error) {
  if (error?.name === 'AbortError') return 'timeout';
  return String(error?.cause?.code || error?.message || error).slice(0, 500);
}

export async function deliverOne(pool, delivery, { fetchImpl = fetch, now = Date.now() } = {}) {
  const event = (await pool.query('select * from integration_events where id=$1', [delivery.event_id])).rows[0];
  const endpoint = (await pool.query('select * from integration_endpoints where id=$1', [delivery.endpoint_id])).rows[0];
  if (!event || !endpoint || !endpoint.active) {
    await pool.query(
      `update integration_deliveries set status='disabled', locked_until=null, last_error=$2, updated_at=now() where id=$1`,
      [delivery.id, endpoint ? 'endpoint desactivado' : 'endpoint inexistente'],
    );
    return { status: 'disabled' };
  }
  const body = webhookBody(event);
  const attempts = Number(delivery.attempts) + 1;
  let statusCode = null;
  let error = null;
  try {
    const headers = webhookHeaders({ secret: decryptSecret(endpoint.secret_encrypted), eventId: event.event_id, body, now });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchImpl(endpoint.url, { method: 'POST', headers, body, signal: controller.signal, redirect: 'manual' });
      statusCode = response.status;
      if (statusCode < 200 || statusCode >= 300) error = `HTTP ${statusCode}`;
    } finally {
      clearTimeout(timer);
    }
  } catch (caught) {
    error = errorText(caught);
  }

  if (statusCode >= 200 && statusCode < 300) {
    await pool.query(
      `update integration_deliveries set status='delivered', attempts=$2, last_status_code=$3, last_error=null,
         delivered_at=now(), locked_until=null, updated_at=now() where id=$1`,
      [delivery.id, attempts, statusCode],
    );
    return { status: 'delivered', statusCode };
  }
  if (statusCode === 410) {
    await pool.query(
      `update integration_endpoints set active=false, disabled_reason='410 Gone', disabled_at=now(), updated_at=now()
       where id=$1`,
      [endpoint.id],
    );
    await pool.query(
      `update integration_deliveries set status='disabled', attempts=case when id=$2 then $3 else attempts end,
         last_status_code=case when id=$2 then 410 else last_status_code end,
         last_error='endpoint desactivado (410)', locked_until=null, updated_at=now()
       where endpoint_id=$1 and status='pending'`,
      [endpoint.id, delivery.id, attempts],
    );
    return { status: 'disabled', statusCode };
  }
  const delay = nextRetryDelaySeconds(attempts);
  await pool.query(
    `update integration_deliveries set status=$2, attempts=$3, last_status_code=$4, last_error=$5,
       next_attempt_at=now() + ($6::int * interval '1 second'), locked_until=null, updated_at=now()
     where id=$1`,
    [delivery.id, delay == null ? 'failed' : 'pending', attempts, statusCode, error, delay ?? 0],
  );
  return { status: delay == null ? 'failed' : 'pending', statusCode, error, retryInSeconds: delay };
}

export async function processDeliveries({ db, limit = 20, fetchImpl, now } = {}) {
  const pool = db || (await loadCore()).pool;
  const deliveries = await claimDeliveries(pool, limit);
  const results = [];
  for (const delivery of deliveries) {
    try {
      results.push(await deliverOne(pool, delivery, { fetchImpl, now }));
    } catch (error) {
      console.error('[integracion:webhooks]', delivery.id, error?.message || error);
    }
  }
  return results;
}
