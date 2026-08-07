import { createHash } from 'node:crypto';

const MAX_ORDERS = 500;
const MAX_IDENTITY_LENGTH = 500;
const MAX_STAGE_LENGTH = 240;
const MAX_ERROR_LENGTH = 4_000;
const FINGERPRINT_VERSION = 'falabella-manifest-job:v1';
const JOB_STATUSES = new Set(['pending', 'processing', 'completed', 'failed']);
let corePromise;

function loadCore() {
  corePromise ||= import('@zentofact/core');
  return corePromise;
}

async function queryTarget(db) {
  return db || (await loadCore()).pool;
}

function identity(value, field) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`${field} inválido.`);
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error(`${field} inválido.`);
  }
  const normalized = String(value).trim();
  if (normalized.length > MAX_IDENTITY_LENGTH) {
    throw new Error(`${field} excede ${MAX_IDENTITY_LENGTH} caracteres.`);
  }
  return normalized;
}

function positiveInteger(value, field) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error(`${field} inválido.`);
  }
  return normalized;
}

function boundedInteger(value, field, { min = 1, max = 50 } = {}) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < min || normalized > max) {
    throw new Error(`${field} debe estar entre ${min} y ${max}.`);
  }
  return normalized;
}

function boundedText(value, max) {
  const normalized = String(value ?? '').trim();
  return normalized.slice(0, max);
}

function compareText(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  return a < b ? -1 : a > b ? 1 : 0;
}

function omittedResultKey(key) {
  const normalized = String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
  return ['authorization', 'base64', 'cookie', 'password', 'secret', 'token']
    .some((fragment) => normalized.includes(fragment));
}

function timestamp(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function jsonValue(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/**
 * Normaliza la selección antes de persistirla. El orden del arreglo de entrada
 * no cambia la identidad lógica del job y duplicados exactos se eliminan.
 */
export function normalizeFalabellaManifestJobOrders(value) {
  if (!Array.isArray(value) || !value.length) {
    throw new Error('Selecciona al menos un pedido para crear manifiestos.');
  }
  if (value.length > MAX_ORDERS) {
    throw new Error(`Puedes encolar hasta ${MAX_ORDERS} pedidos por vez.`);
  }

  const normalized = new Map();
  for (const [index, candidate] of value.entries()) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error(`El pedido en la posición ${index + 1} no es válido.`);
    }
    const companyId = positiveInteger(candidate.companyId, `companyId de la posición ${index + 1}`);
    const orderId = identity(candidate.orderId, `orderId de la posición ${index + 1}`);
    const orderNumber = identity(candidate.orderNumber, `orderNumber de la posición ${index + 1}`);
    if (!orderId && !orderNumber) {
      throw new Error(`El pedido en la posición ${index + 1} no tiene identidad.`);
    }
    const order = {
      companyId,
      ...(orderId ? { orderId } : {}),
      ...(orderNumber ? { orderNumber } : {}),
    };
    normalized.set(`${companyId}\u0000${orderId}\u0000${orderNumber}`, order);
  }

  return [...normalized.values()].sort((left, right) => (
    left.companyId - right.companyId
    || compareText(left.orderId, right.orderId)
    || compareText(left.orderNumber, right.orderNumber)
  ));
}

export function falabellaManifestJobFingerprint(orders) {
  const canonical = normalizeFalabellaManifestJobOrders(orders);
  return createHash('sha256')
    .update(`${FINGERPRINT_VERSION}\n${JSON.stringify(canonical)}`)
    .digest('hex');
}

function sanitizeResultValue(value, seen) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (value === undefined || typeof value === 'bigint' || typeof value === 'function') return undefined;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return undefined;
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return undefined;
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => sanitizeResultValue(entry, seen)).filter((entry) => entry !== undefined);
    }
    const sanitized = {};
    for (const [key, entry] of Object.entries(value)) {
      if (omittedResultKey(key)) continue;
      const clean = sanitizeResultValue(entry, seen);
      if (clean !== undefined) sanitized[key] = clean;
    }
    return sanitized;
  } finally {
    seen.delete(value);
  }
}

/** Evita persistir PDFs, capturas, credenciales o buffers dentro del JSON del job. */
export function sanitizeFalabellaManifestJobResult(value) {
  if (value === undefined || value === null) return null;
  return sanitizeResultValue(value, new WeakSet()) ?? null;
}

export function mapFalabellaManifestJob(row) {
  if (!row) return null;
  const status = String(row.status || 'pending');
  return {
    id: String(row.id),
    fingerprint: String(row.fingerprint || ''),
    status: JOB_STATUSES.has(status) ? status : 'failed',
    orders: normalizeFalabellaManifestJobOrders(jsonValue(row.orders, [])),
    stage: String(row.stage || ''),
    attempts: Math.max(0, Number(row.attempts) || 0),
    result: sanitizeFalabellaManifestJobResult(jsonValue(row.result, null)),
    error: row.error == null ? null : boundedText(row.error, MAX_ERROR_LENGTH),
    createdAt: timestamp(row.created_at),
    startedAt: timestamp(row.started_at),
    completedAt: timestamp(row.completed_at),
    updatedAt: timestamp(row.updated_at),
  };
}

/**
 * Reutiliza únicamente un job activo con la misma selección. Los jobs
 * terminales quedan como historial y un clic posterior crea una fila nueva.
 */
export async function enqueueFalabellaManifestJob(orders, db) {
  const canonicalOrders = normalizeFalabellaManifestJobOrders(orders);
  const fingerprint = falabellaManifestJobFingerprint(canonicalOrders);
  const target = await queryTarget(db);
  const result = await target.query(
    `insert into falabella_manifest_jobs (fingerprint, status, orders, stage)
     values ($1, 'pending', $2::jsonb, 'en cola')
     on conflict (fingerprint) where status in ('pending', 'processing') do update set
       fingerprint=falabella_manifest_jobs.fingerprint
     returning *, (xmax = 0) as inserted`,
    [fingerprint, JSON.stringify(canonicalOrders)],
  );
  const row = result.rows[0];
  return {
    job: mapFalabellaManifestJob(row),
    reused: !Boolean(row?.inserted),
  };
}

export async function getFalabellaManifestJob(id, db) {
  const jobId = positiveInteger(id, 'id');
  const target = await queryTarget(db);
  const result = await target.query(
    `select *
     from falabella_manifest_jobs
     where id=$1
     limit 1`,
    [jobId],
  );
  return mapFalabellaManifestJob(result.rows[0]);
}

/** Reclama trabajos en una sola sentencia para que varias instancias no se pisen. */
export async function claimFalabellaManifestJobs(limit = 1, db) {
  const claimLimit = boundedInteger(limit, 'limit');
  const target = await queryTarget(db);
  const result = await target.query(
    `with candidates as (
       select id
       from falabella_manifest_jobs
       where status='pending'
       order by created_at asc, id asc
       limit $1
       for update skip locked
     )
     update falabella_manifest_jobs job
     set status='processing',
         stage='iniciando',
         attempts=job.attempts+1,
         result=null,
         error=null,
         started_at=now(),
         completed_at=null,
         updated_at=now()
     from candidates
     where job.id=candidates.id
     returning job.*`,
    [claimLimit],
  );
  return result.rows.map(mapFalabellaManifestJob);
}

/** Devuelve a la cola trabajos abandonados por un proceso interrumpido. */
export async function recoverStaleFalabellaManifestJobs(staleAfterMs, db) {
  const timeoutMs = boundedInteger(staleAfterMs, 'staleAfterMs', { min: 1, max: 86_400_000 });
  const target = await queryTarget(db);
  const result = await target.query(
    `update falabella_manifest_jobs
     set status='pending',
         stage='en cola (recuperado)',
         result=null,
         error=null,
         started_at=null,
         completed_at=null,
         updated_at=now()
     where status='processing'
       and updated_at < now() - ($1::int * interval '1 millisecond')
     returning *`,
    [timeoutMs],
  );
  return result.rows.map(mapFalabellaManifestJob);
}

function jobLease(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Se requiere el job reclamado para finalizarlo.');
  }
  return {
    id: positiveInteger(value.id, 'id'),
    attempts: positiveInteger(value.attempts, 'attempts'),
  };
}

/** Mantiene vigente el lease y, opcionalmente, actualiza la etapa visible. */
export async function heartbeatFalabellaManifestJob(job, stage, db) {
  const lease = jobLease(job);
  const nextStage = boundedText(stage, MAX_STAGE_LENGTH) || null;
  const target = await queryTarget(db);
  const result = await target.query(
    `update falabella_manifest_jobs
     set stage=coalesce($3, stage),
         updated_at=now()
     where id=$1 and status='processing' and attempts=$2
     returning *`,
    [lease.id, lease.attempts, nextStage],
  );
  return mapFalabellaManifestJob(result.rows[0]);
}

/** Completa sólo el intento que mantiene actualmente el lease lógico del job. */
export async function completeFalabellaManifestJob(job, value, db) {
  const lease = jobLease(job);
  const cleanResult = sanitizeFalabellaManifestJobResult(value);
  const target = await queryTarget(db);
  const result = await target.query(
    `update falabella_manifest_jobs
     set status='completed',
         stage='completado',
         result=$3::jsonb,
         error=null,
         completed_at=now(),
         updated_at=now()
     where id=$1 and status='processing' and attempts=$2
     returning *`,
    [lease.id, lease.attempts, JSON.stringify(cleanResult)],
  );
  return mapFalabellaManifestJob(result.rows[0]);
}

/** Marca como fallido sólo el intento que mantiene actualmente el lease lógico. */
export async function failFalabellaManifestJob(job, error, value = null, db) {
  const lease = jobLease(job);
  const message = boundedText(error instanceof Error ? error.message : error, MAX_ERROR_LENGTH)
    || 'No se pudo crear el manifiesto.';
  const cleanResult = sanitizeFalabellaManifestJobResult(value);
  const target = await queryTarget(db);
  const result = await target.query(
    `update falabella_manifest_jobs
     set status='failed',
         stage='error',
         result=$4::jsonb,
         error=$3,
         completed_at=now(),
         updated_at=now()
     where id=$1 and status='processing' and attempts=$2
     returning *`,
    [lease.id, lease.attempts, message, JSON.stringify(cleanResult)],
  );
  return mapFalabellaManifestJob(result.rows[0]);
}
