import { randomBytes } from 'node:crypto';

const MAX_MESSAGE = 2000;
const RESERVED_PAYLOAD_KEYS = new Set(['event', 'logId', 'operation', 'message', 'stack']);

export function createLogId() {
  return `log_${randomBytes(6).toString('hex')}`;
}

export function operationalErrorBody(error, details = {}, dependencies = {}) {
  const makeId = dependencies.createLogId || createLogId;
  const writeLog = dependencies.log || ((line) => console.error(line));
  const logId = details.logId || makeId();
  const message = String(error?.message || error || 'Error no informado.').slice(0, MAX_MESSAGE);
  const payload = {
    event: 'zf_log',
    logId,
    operation: details.operation || 'api',
    message,
  };
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
