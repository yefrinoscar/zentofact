// Errores RFC 9457 (application/problem+json) de la API de integración v1.
// Cada código tiene un status y un `retryable` fijos por contrato.

export const PROBLEM_BASE = 'https://zentofact.app/problems/';

const PROBLEMS = {
  unauthorized: { status: 401, title: 'No autorizado', retryable: false },
  forbidden_scope: { status: 403, title: 'La llave no tiene el permiso requerido', retryable: false },
  not_found: { status: 404, title: 'No encontrado', retryable: false },
  validation_failed: { status: 400, title: 'Datos inválidos', retryable: false },
  stale_update: { status: 409, title: 'Ya existe una versión más reciente', retryable: false },
  document_already_issued: { status: 409, title: 'El pedido ya tiene comprobante', retryable: false },
  order_already_shipped: { status: 409, title: 'El pedido ya salió del almacén', retryable: false },
  document_not_accepted: { status: 409, title: 'El comprobante todavía no está aceptado', retryable: true },
  idempotency_key_reused: { status: 422, title: 'Idempotency-Key usada con otro cuerpo', retryable: false },
  idempotency_in_progress: { status: 409, title: 'La misma solicitud sigue en proceso', retryable: true },
  payload_too_large: { status: 413, title: 'Cuerpo demasiado grande', retryable: false },
  internal: { status: 500, title: 'Error interno', retryable: true },
};

export class ProblemError extends Error {
  constructor(code, detail, extra = {}) {
    super(detail || PROBLEMS[code]?.title || code);
    this.name = 'ProblemError';
    this.code = code;
    this.detail = detail || null;
    this.extra = extra;
  }
}

export function problemBody(code, detail, extra = {}) {
  const meta = PROBLEMS[code] || PROBLEMS.internal;
  const resolvedCode = PROBLEMS[code] ? code : 'internal';
  return {
    type: `${PROBLEM_BASE}${resolvedCode}`,
    title: meta.title,
    status: meta.status,
    detail: detail || meta.title,
    code: resolvedCode,
    retryable: meta.retryable,
    ...extra,
  };
}

export function problemResponse(c, code, detail, extra = {}) {
  const body = problemBody(code, detail, extra);
  return new Response(JSON.stringify(body), {
    status: body.status,
    headers: { 'content-type': 'application/problem+json; charset=utf-8' },
  });
}

export function validationProblem(errors) {
  return new ProblemError('validation_failed', errors[0]?.message || 'Datos inválidos', { errors });
}

export function problemStatus(code) {
  return (PROBLEMS[code] || PROBLEMS.internal).status;
}
