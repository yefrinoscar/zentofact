import { randomBytes } from 'node:crypto';

const MAX_MESSAGE = 2000;
const RESERVED_PAYLOAD_KEYS = new Set(['event', 'logId', 'operation', 'message', 'stack']);

export function createLogId() {
  return `log_${randomBytes(6).toString('hex')}`;
}

export function existingLogId(value) {
  return typeof value === 'string' && /^log_[0-9a-f]{12}$/.test(value) ? value : '';
}

function collectCause(error) {
  const parts = [];
  let current = error?.cause;
  for (let i = 0; i < 3 && current; i += 1) {
    parts.push(String(current?.message || current));
    current = current?.cause;
  }
  return parts.join(' | ').slice(0, MAX_MESSAGE);
}

function rootCauseMessage(error) {
  let current = error?.cause;
  let message = '';
  for (let i = 0; i < 5 && current; i += 1) {
    message = String(current?.message || current);
    current = current?.cause;
  }
  return message.trim();
}

// Postgres/pool failures that mean "the database did not answer", not a bad query.
const DATABASE_UNAVAILABLE = /timeout exceeded when trying to connect|connection terminated|ECONNREFUSED|ECONNRESET|ETIMEDOUT|too many clients|remaining connection slots|Connection terminated unexpectedly|the database system is (starting up|shutting down)/i;

/**
 * Drizzle reports DB failures as "Failed query: <full SQL>\nparams: …" with the
 * real reason in `cause`. Turns that into "what failed + why", without SQL or
 * params (which may carry credentials).
 */
function parseFailedQuery(raw) {
  if (!raw.startsWith('Failed query:')) return null;
  const sql = raw.slice('Failed query:'.length).split(/\nparams:/)[0].trim();
  const verb = sql.match(/^\s*(select|insert|update|delete|with)\b/i)?.[1]?.toLowerCase() || 'query';
  const table = sql.match(/\b(?:from|into|update)\s+"?([\w.]+)"?/i)?.[1] || null;
  return { verb, table };
}

/** Short human description of an error, plus a type tag for database failures. */
export function describeError(error) {
  const raw = String(error?.message || error || 'Error no informado.');
  const failed = parseFailedQuery(raw);
  if (!failed) return { message: raw.slice(0, MAX_MESSAGE) };
  const cause = rootCauseMessage(error);
  const target = failed.table ? ` (${failed.verb} ${failed.table})` : '';
  if (DATABASE_UNAVAILABLE.test(cause)) {
    return {
      message: `La base de datos no respondió${target}: ${cause}.`,
      type: 'database_unavailable',
      query: failed.table ? `${failed.verb} ${failed.table}` : failed.verb,
    };
  }
  return {
    message: `Falló una consulta a la base de datos${target}: ${cause || 'sin detalle'}.`,
    type: 'database_query',
    query: failed.table ? `${failed.verb} ${failed.table}` : failed.verb,
  };
}

/**
 * Only our own frames, without node_modules/node internals, with short paths:
 * ["getCompany (packages/core/dist/services/company.service.js:125:18)", …].
 */
export function compactStack(error, limit = 8) {
  const frames = String(error?.stack || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('at '))
    .map((line) => line
      .replace(/^at (async )?/, '')
      .replace(/(?:file:\/\/)?\/[^\s()]*?\/(packages\/|node_modules\/)/g, '$1'));
  const own = frames.filter((frame) => !frame.includes('node_modules/') && !frame.includes('node:internal') && !frame.startsWith('<anonymous>') && !frame.startsWith('Promise.all'));
  return (own.length ? own : frames).slice(0, limit);
}

export function clientErrorMessage(error) {
  const raw = String(error?.message || error || 'Error no informado.');
  if (raw.startsWith('Failed query:')) {
    return describeError(error).type === 'database_unavailable'
      ? 'La base de datos no respondió a tiempo. Intenta de nuevo en unos minutos.'
      : 'No se pudo completar la operación.';
  }
  return raw.slice(0, MAX_MESSAGE);
}

export function operationalErrorBody(error, details = {}, dependencies = {}) {
  const makeId = dependencies.createLogId || createLogId;
  const writeLog = dependencies.log || ((line) => console.error(line));
  const logId = existingLogId(details.logId) || existingLogId(error?.logId) || makeId();
  const described = describeError(error);
  const message = clientErrorMessage(error);
  const payload = {
    event: 'zf_log',
    logId,
    operation: details.operation || 'api',
    message: described.message,
  };
  if (described.type) payload.type = described.type;
  if (described.query) payload.query = described.query;
  // The database description already contains the root cause.
  const cause = described.type ? '' : collectCause(error);
  if (cause) payload.cause = cause;
  const extras = {
    ...(error?.details && typeof error.details === 'object' && !Array.isArray(error.details) ? error.details : {}),
    ...(details.context && typeof details.context === 'object' ? details.context : {}),
  };
  for (const [key, value] of Object.entries(extras)) {
    if (value === undefined || value === null || value === '' || RESERVED_PAYLOAD_KEYS.has(key)) continue;
    payload[key] = value;
  }
  const stack = compactStack(error);
  if (stack.length) payload.stack = stack;
  writeLog(`[ZF_LOG] ${logId} ${JSON.stringify(payload)}`);
  return { error: message, logId };
}
