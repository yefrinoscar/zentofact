export class ApiError extends Error {
  readonly logId?: string;
  readonly status?: number;

  constructor(message: string, options: { logId?: string; status?: number } = {}) {
    super(message);
    this.name = 'ApiError';
    this.logId = optionalLogId(options.logId);
    this.status = options.status;
  }
}

export function apiErrorFromResponse(data: unknown, status: number, fallback: string) {
  const payload = data && typeof data === 'object' ? data as Record<string, unknown> : null;
  const message = typeof payload?.error === 'string' && payload.error.trim()
    ? payload.error
    : fallback;
  return new ApiError(message, {
    logId: optionalLogId(payload?.logId),
    status,
  });
}

export function logIdFromUnknown(error: unknown) {
  if (!error || typeof error !== 'object') return undefined;
  return optionalLogId((error as { logId?: unknown }).logId);
}

function optionalLogId(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
