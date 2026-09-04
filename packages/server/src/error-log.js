import { randomBytes } from 'node:crypto';

const MAX_MESSAGE = 2000;
const RESERVED_PAYLOAD_KEYS = new Set(['event', 'logId', 'operation', 'message', 'stack']);

export function createLogId() {
  return `log_${randomBytes(6).toString('hex')}`;
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

export function clientErrorMessage(error) {
  const raw = String(error?.message || error || 'Error no informado.');
  if (raw.startsWith('Failed query:')) return 'No se pudo completar la operación.';
  return raw.slice(0, MAX_MESSAGE);
}

export function operationalErrorBody(error, details = {}, dependencies = {}) {
  const makeId = dependencies.createLogId || createLogId;
  const writeLog = dependencies.log || ((line) => console.error(line));
  const logId = details.logId || makeId();
  const rawMessage = String(error?.message || error || 'Error no informado.').slice(0, MAX_MESSAGE);
  const message = clientErrorMessage(error);
  const payload = {
    event: 'zf_log',
    logId,
    operation: details.operation || 'api',
    message: rawMessage,
  };
  const cause = collectCause(error);
  if (cause) payload.cause = cause;
  if (details.context && typeof details.context === 'object') {
    for (const [key, value] of Object.entries(details.context)) {
      if (value === undefined || value === null || value === '' || RESERVED_PAYLOAD_KEYS.has(key)) continue;
      payload[key] = value;
    }
  }
  if (error?.stack) payload.stack = error.stack;
  writeLog(`[ZF_LOG] ${logId} ${JSON.stringify(payload)}`);
  return { error: message, logId };
}
