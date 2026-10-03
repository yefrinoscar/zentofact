import AdmZip from 'adm-zip';
import { readDatoAdicional, withDatoAdicional } from '../utils/datos-adicionales';

// Reglas puras para decidir qué hacer con un comprobante cuyo envío a SUNAT no
// quedó confirmado. No acceden a la base de datos ni a la red: reciben lo que
// SUNAT respondió y lo que tenemos guardado, y devuelven una decisión.
//
// Invariantes:
// - Nunca usar un nuevo correlativo mientras el anterior pueda existir en SUNAT.
// - Nunca reutilizar un correlativo.
// - Nunca generar dos XML distintos para el mismo correlativo.
// - Un "no existe" solo cuenta si SUNAT lo responde de forma explícita.

export const MAX_SAME_NUMBER_RESENDS = 3;
export const MAX_NEW_NUMBERS_PER_ORDER = 2;

/** Estado local que exige intervención humana; ningún proceso automático lo cambia. */
export const MANUAL_REVIEW_STATE = 'REVISION_MANUAL';
/** Estados que ya no admiten envío ni reemisión. */
export const CLOSED_STATES = ['ACEPTADO', 'ANULADO', 'REEMPLAZADO', MANUAL_REVIEW_STATE];

export type CdrVerdict = 'ACCEPTED' | 'REJECTED' | 'UNKNOWN';

/**
 * Interpreta el ResponseCode de un CDR. 0 es aceptado y 4000+ es aceptado con
 * observaciones. 2000-3999 es rechazo. Cualquier otro valor (por ejemplo una
 * excepción 0100-1999 dentro de un CDR) no es suficiente para decidir.
 */
export function cdrVerdict(code: unknown): CdrVerdict {
  const raw = String(code ?? '').trim();
  if (!/^\d+$/.test(raw)) return 'UNKNOWN';
  const value = Number(raw);
  if (value === 0 || value >= 4000) return 'ACCEPTED';
  if (value >= 2000 && value <= 3999) return 'REJECTED';
  return 'UNKNOWN';
}

export interface CdrIdentity {
  documentId?: string;
  issueDate?: string;
  recipientId?: string;
  recipientDocumentType?: string;
  documentHash?: string;
}

function firstMatch(xml: string, pattern: RegExp): string | undefined {
  const value = xml.match(pattern)?.[1]?.trim();
  return value || undefined;
}

/** Extrae del CDR los datos que identifican el comprobante que SUNAT registró. */
export function parseCdrIdentityXml(xml: string): CdrIdentity {
  const documentResponse = firstMatch(xml, /<cac:DocumentResponse\b[^>]*>([\s\S]*?)<\/cac:DocumentResponse>/) || '';
  const documentReference = firstMatch(documentResponse, /<cac:DocumentReference\b[^>]*>([\s\S]*?)<\/cac:DocumentReference>/) || '';
  const recipient = firstMatch(documentResponse, /<cac:RecipientParty\b[^>]*>([\s\S]*?)<\/cac:RecipientParty>/) || '';
  return {
    documentId: firstMatch(documentReference, /<cbc:ID\b[^>]*>([^<]+)<\/cbc:ID>/)
      || firstMatch(documentResponse, /<cbc:ReferenceID\b[^>]*>([^<]+)<\/cbc:ReferenceID>/),
    issueDate: firstMatch(documentReference, /<cbc:IssueDate\b[^>]*>([^<]+)<\/cbc:IssueDate>/),
    recipientId: firstMatch(recipient, /<cbc:ID\b[^>]*>([^<]+)<\/cbc:ID>/),
    recipientDocumentType: firstMatch(recipient, /<cbc:ID\b[^>]*\bschemeID=["']([^"']+)["']/),
    documentHash: firstMatch(documentReference, /<cbc:DocumentHash\b[^>]*>([^<]+)<\/cbc:DocumentHash>/),
  };
}

export function readCdrIdentity(cdrZip: Buffer | undefined | null): CdrIdentity | null {
  if (!cdrZip) return null;
  try {
    const entry = new AdmZip(cdrZip).getEntries().find(item => item.entryName.toLowerCase().endsWith('.xml'));
    return entry ? parseCdrIdentityXml(entry.getData().toString('utf-8')) : null;
  } catch {
    return null;
  }
}

export interface StatusCdrInput {
  success: boolean;
  cdrZip?: Buffer;
  cdrResponse?: { code?: string; description?: string } | null;
  statusCode?: string;
  statusMessage?: string;
  error?: { code: string; message: string };
}

export type StatusCdrOutcome =
  | { kind: 'QUERY_FAILED'; message: string }
  | { kind: 'ACCEPTED' | 'REJECTED'; code: string; message: string; identity: CdrIdentity | null }
  | { kind: 'NOT_FOUND' | 'VOIDED' | 'NOT_OWNED' | 'UNKNOWN'; statusCode: string; message: string };

/**
 * Clasifica la respuesta de getStatusCdr. Códigos del servicio de consulta:
 * 0001 aceptado, 0002 rechazado, 0003 de baja, 0011 no existe, 0012 no
 * pertenece al RUC. Un fallo de red o SOAP nunca es evidencia de inexistencia.
 */
export function classifyStatusCdr(result: StatusCdrInput): StatusCdrOutcome {
  if (!result.success) {
    return { kind: 'QUERY_FAILED', message: result.error?.message || 'SUNAT no respondió la consulta del comprobante.' };
  }

  const statusCode = String(result.statusCode || '').trim();
  const code = String(result.cdrResponse?.code ?? '').trim();
  const message = String(result.cdrResponse?.description || result.statusMessage || '').trim();

  if (code) {
    const verdict = cdrVerdict(code);
    if (verdict !== 'UNKNOWN') {
      return { kind: verdict, code, message, identity: readCdrIdentity(result.cdrZip) };
    }
  }
  if (statusCode === '0003') return { kind: 'VOIDED', statusCode, message };
  if (statusCode === '0012') return { kind: 'NOT_OWNED', statusCode, message };
  if (statusCode === '0011' || (!statusCode && /comprobante[^.]*no existe/i.test(message))) {
    return { kind: 'NOT_FOUND', statusCode, message };
  }
  return { kind: 'UNKNOWN', statusCode, message };
}

export interface LocalDocument {
  numeroCompleto: string;
  fechaEmision?: string | null;
  clientDocumento?: string | null;
  clientTipoDocumento?: string | null;
  codigoHash?: string | null;
}

/**
 * MATCH: es este comprobante. MISMATCH: está probado que es otro comprobante
 * (otro número u otro cliente), así que el número está ocupado por otro emisor.
 * UNVERIFIABLE: no se puede probar ninguna de las dos cosas.
 */
export type IdentityCheck = { result: 'MATCH' | 'MISMATCH' | 'UNVERIFIABLE'; reason: string };

function normalizeDocumentNumber(value: string | null | undefined): string | null {
  const match = String(value || '').trim().toUpperCase().match(/^([A-Z0-9]{4})-0*(\d+)$/);
  return match ? `${match[1]}-${Number(match[2])}` : null;
}

function normalizePartyId(value: string | null | undefined): string | null {
  const normalized = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  // Clientes varios / anónimos no identifican a nadie.
  if (!normalized || /^0+$/.test(normalized)) return null;
  return normalized;
}

function cdrPartyIdentity(identity: CdrIdentity): { number: string | null; type: string | null; valid: boolean } {
  const raw = String(identity.recipientId || '').trim().toUpperCase();
  const scheme = identity.recipientDocumentType?.trim().toUpperCase() || null;
  // SUNAT también devuelve tipo-número en RecipientParty (1 = DNI, 6 = RUC).
  // Solo separar el prefijo explícito; nunca quitar un dígito de un DNI plano.
  const typed = raw.match(/^([01467AB])-([A-Z0-9]+)$/);
  const type = typed?.[1] || scheme;
  const number = normalizePartyId(typed?.[2] || raw);
  const valid = !(typed && scheme && typed[1] !== scheme)
    && !(type === '1' && number && !/^\d{8}$/.test(number))
    && !(type === '6' && number && !/^\d{11}$/.test(number));
  return { number, type, valid };
}

function normalizeDate(value: string | null | undefined): string | null {
  return String(value || '').trim().match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || null;
}

/**
 * Decide si el comprobante que SUNAT tiene registrado con este número es el
 * nuestro. Un número igual no basta: otro sistema pudo usar la misma serie.
 */
export function compareCdrIdentity(identity: CdrIdentity | null, local: LocalDocument): IdentityCheck {
  if (!identity) return { result: 'UNVERIFIABLE', reason: 'SUNAT no devolvió un CDR legible.' };

  const cdrNumber = normalizeDocumentNumber(identity.documentId);
  const localNumber = normalizeDocumentNumber(local.numeroCompleto);
  if (cdrNumber && localNumber && cdrNumber !== localNumber) {
    return { result: 'MISMATCH', reason: `El CDR corresponde a ${identity.documentId}, no a ${local.numeroCompleto}.` };
  }

  const cdrHash = String(identity.documentHash || '').trim();
  const localHash = String(local.codigoHash || '').trim();
  if (cdrHash && localHash && cdrHash === localHash) {
    return { result: 'MATCH', reason: 'El hash del CDR coincide con el XML firmado guardado.' };
  }

  const cdrParty = cdrPartyIdentity(identity);
  const cdrRecipient = cdrParty.number;
  const localRecipient = normalizePartyId(local.clientDocumento);
  if (!cdrParty.valid) {
    return { result: 'UNVERIFIABLE', reason: 'El CDR contiene un tipo o número de documento del cliente inconsistente.' };
  }
  if (!cdrRecipient || !localRecipient) {
    return { result: 'UNVERIFIABLE', reason: 'No se puede comparar el documento del cliente con el CDR.' };
  }
  if (cdrRecipient !== localRecipient) {
    return { result: 'MISMATCH', reason: `El número está ocupado por un comprobante del cliente ${cdrRecipient}, no de ${localRecipient}.` };
  }
  const localType = local.clientTipoDocumento?.trim().toUpperCase();
  if (cdrParty.type && localType && cdrParty.type !== localType) {
    return { result: 'MISMATCH', reason: 'El tipo de documento del cliente en el CDR no coincide con el comprobante local.' };
  }

  const cdrDate = normalizeDate(identity.issueDate);
  const localDate = normalizeDate(local.fechaEmision);
  if (cdrDate && localDate && cdrDate !== localDate) {
    // La fecha distinta prueba que no podemos atribuir el CDR al XML local.
    // No se emite otro número automáticamente: queda como colisión para revisión.
    return { result: 'MISMATCH', reason: `Mismo cliente, pero el CDR tiene fecha ${cdrDate} y el comprobante local ${localDate}.` };
  }
  return { result: 'MATCH', reason: 'El cliente y la fecha del CDR coinciden con el comprobante local.' };
}

export interface ReconciliationTrace {
  resendCount: number;
  newNumberCount: number;
}

export type ReemissionAction =
  | 'MARK_ACCEPTED'
  | 'RESEND_SAME_NUMBER'
  | 'ISSUE_NEW_NUMBER'
  | 'BLOCK'
  | 'MANUAL_REVIEW';

export interface ReemissionDecision {
  action: ReemissionAction;
  /** Estado a guardar antes de actuar; null conserva el estado actual. */
  estadoSunat: string | null;
  reason: string;
  /** El número está ocupado por otro emisor: antes del número nuevo, saltar los ocupados. */
  collision?: boolean;
}

/** Decide el siguiente paso de un comprobante no aceptado a partir de la consulta a SUNAT. */
export function decideReemission(input: {
  outcome: StatusCdrOutcome;
  local: LocalDocument;
  trace: ReconciliationTrace;
  maxResends?: number;
  maxNewNumbers?: number;
}): ReemissionDecision {
  const { outcome, local, trace } = input;
  const maxResends = input.maxResends ?? MAX_SAME_NUMBER_RESENDS;
  const maxNewNumbers = input.maxNewNumbers ?? MAX_NEW_NUMBERS_PER_ORDER;

  switch (outcome.kind) {
    case 'QUERY_FAILED':
      return { action: 'BLOCK', estadoSunat: null, reason: `No se pudo consultar SUNAT: ${outcome.message}` };
    case 'UNKNOWN':
      return {
        action: 'BLOCK',
        estadoSunat: 'NO_CONFIRMADO',
        reason: `SUNAT no confirmó el estado${outcome.statusCode ? ` (${outcome.statusCode})` : ''}: ${outcome.message || 'sin detalle'}`,
      };
    case 'VOIDED':
      return { action: 'MANUAL_REVIEW', estadoSunat: MANUAL_REVIEW_STATE, reason: `SUNAT informa el número de baja: ${outcome.message || outcome.statusCode}` };
    case 'NOT_OWNED':
      return { action: 'MANUAL_REVIEW', estadoSunat: MANUAL_REVIEW_STATE, reason: `SUNAT indica que el comprobante no pertenece al RUC: ${outcome.message || outcome.statusCode}` };
    case 'ACCEPTED': {
      const identity = compareCdrIdentity(outcome.identity, local);
      if (identity.result === 'MATCH') return { action: 'MARK_ACCEPTED', estadoSunat: 'ACEPTADO', reason: identity.reason };
      if (identity.result === 'MISMATCH') {
        return {
          action: 'MANUAL_REVIEW',
          estadoSunat: MANUAL_REVIEW_STATE,
          reason: `Colisión de correlativo: ${identity.reason} No se emite otro número automáticamente.`,
        };
      }
      return {
        action: 'MANUAL_REVIEW',
        estadoSunat: MANUAL_REVIEW_STATE,
        reason: `SUNAT tiene aceptado ${local.numeroCompleto}, pero no se puede probar si es este comprobante. ${identity.reason}`,
      };
    }
    case 'REJECTED':
      return newNumberOrManual(trace, maxNewNumbers, `SUNAT rechazó el comprobante (${outcome.code}): ${outcome.message}`, false);
    case 'NOT_FOUND':
      if (trace.resendCount < maxResends) {
        return { action: 'RESEND_SAME_NUMBER', estadoSunat: 'NO_ENCONTRADO', reason: 'SUNAT no tiene registrado el número; se reenvía el mismo XML firmado.' };
      }
      return {
        action: 'MANUAL_REVIEW',
        estadoSunat: MANUAL_REVIEW_STATE,
        reason: `SUNAT confirmó ${trace.resendCount + 1} veces que el número no existe tras reenviar el mismo XML. Se detiene para revisión manual.`,
      };
  }
}

function newNumberOrManual(trace: ReconciliationTrace, maxNewNumbers: number, reason: string, collision: boolean): ReemissionDecision {
  if (trace.newNumberCount >= maxNewNumbers) {
    return {
      action: 'MANUAL_REVIEW',
      estadoSunat: MANUAL_REVIEW_STATE,
      reason: `${reason} Pero ya se usaron ${trace.newNumberCount} números nuevos para esta venta.`,
    };
  }
  return { action: 'ISSUE_NEW_NUMBER', estadoSunat: 'RECHAZADO', reason, collision };
}

const TRACE_KEY = 'sunat_reconciliation';

/** Lee los contadores de reconciliación guardados en datos_adicionales (objeto o arreglo). */
export function readReconciliationTrace(datosAdicionales: unknown): ReconciliationTrace {
  const trace = readDatoAdicional(datosAdicionales, TRACE_KEY);
  return {
    resendCount: Math.max(0, Number(trace?.resend_count) || 0),
    newNumberCount: Math.max(0, Number(trace?.new_number_count) || 0),
  };
}

/** Devuelve datos_adicionales con los contadores actualizados, conservando el resto. */
export function withReconciliationTrace(
  datosAdicionales: unknown,
  trace: ReconciliationTrace & { lastDecision?: string; lastReason?: string; checkedAt?: string },
): unknown {
  return withDatoAdicional(datosAdicionales, TRACE_KEY, {
    resend_count: trace.resendCount,
    new_number_count: trace.newNumberCount,
    last_decision: trace.lastDecision || null,
    last_reason: trace.lastReason || null,
    checked_at: trace.checkedAt || null,
  });
}

export type ReportClass =
  | 'ACEPTADO_PROPIO'
  | 'ACEPTADO_AJENO'
  | 'ACEPTADO_SIN_VERIFICAR'
  | 'RECHAZADO'
  | 'NO_EXISTE'
  | 'DE_BAJA'
  | 'NO_CONSULTABLE';

/** Clasificación de un comprobante para el reporte de reconciliación. */
export function classifyForReport(outcome: StatusCdrOutcome, local: LocalDocument): { clase: ReportClass; detalle: string } {
  switch (outcome.kind) {
    case 'ACCEPTED': {
      const identity = compareCdrIdentity(outcome.identity, local);
       const clase = identity.result === 'MATCH' ? 'ACEPTADO_PROPIO' : identity.result === 'MISMATCH' ? 'ACEPTADO_AJENO' : 'ACEPTADO_SIN_VERIFICAR';
      return { clase, detalle: identity.reason };
    }
    case 'REJECTED':
      return { clase: 'RECHAZADO', detalle: `${outcome.code}: ${outcome.message}` };
    case 'NOT_FOUND':
      return { clase: 'NO_EXISTE', detalle: outcome.message || 'SUNAT no tiene registrado el número.' };
    case 'VOIDED':
      return { clase: 'DE_BAJA', detalle: outcome.message || 'SUNAT informa el comprobante de baja.' };
    case 'QUERY_FAILED':
      return { clase: 'NO_CONSULTABLE', detalle: outcome.message };
    default:
      return { clase: 'NO_CONSULTABLE', detalle: `${outcome.statusCode || 'sin código'}: ${outcome.message || 'respuesta sin estado'}` };
  }
}

/**
 * Un RECHAZADO guardado por versiones anteriores solo es definitivo si lo
 * respaldó un CDR 2000-3999. Cualquier otro error (timeout, 0130, 1033…)
 * nunca probó un rechazo y debe tratarse como NO_CONFIRMADO.
 */
export function isDefinitiveStoredRejection(respuestaSunat: string | null | undefined): boolean {
  if (!respuestaSunat) return false;
  try {
    const parsed = JSON.parse(respuestaSunat);
    return cdrVerdict(parsed?.code) === 'REJECTED';
  } catch {
    return false;
  }
}

export type SeriesProbeVerdict = 'CLEAR' | 'COLLISION' | 'INCONCLUSIVE';

/**
 * Si SUNAT ya tiene registrado un número que todavía no emitimos, otro sistema
 * está usando la serie y la próxima emisión chocará con él.
 */
export function seriesProbeVerdict(outcomes: StatusCdrOutcome[]): SeriesProbeVerdict {
  if (outcomes.some((outcome) => ['ACCEPTED', 'REJECTED', 'VOIDED'].includes(outcome.kind))) return 'COLLISION';
  if (outcomes.length > 0 && outcomes.every((outcome) => outcome.kind === 'NOT_FOUND')) return 'CLEAR';
  return 'INCONCLUSIVE';
}

/** Estado local que corresponde a lo que SUNAT tiene registrado. */
export function localMatchesSunat(clase: ReportClass, estadoLocal: string): boolean {
  switch (clase) {
    case 'ACEPTADO_PROPIO': return estadoLocal === 'ACEPTADO';
    // Número de otro emisor: localmente es un número quemado que se reemplaza.
    case 'ACEPTADO_AJENO': return ['RECHAZADO', 'REEMPLAZADO'].includes(estadoLocal);
    case 'ACEPTADO_SIN_VERIFICAR': return estadoLocal === 'REVISION_MANUAL';
    case 'RECHAZADO': return ['RECHAZADO', 'REEMPLAZADO'].includes(estadoLocal);
    case 'NO_EXISTE': return estadoLocal !== 'ACEPTADO';
    case 'DE_BAJA': return ['ANULADO', 'REVISION_MANUAL'].includes(estadoLocal);
    default: return true;
  }
}

/** Acción sugerida para cada comprobante del reporte. */
export function suggestReportAction(row: { clase: ReportClass; estadoLocal: string; montoInconsistente: boolean }): string {
  if (row.clase === 'ACEPTADO_PROPIO' && row.montoInconsistente) {
    return 'Monto distinto al pedido: si el comprobante está mal, emitir nota de crédito y uno nuevo. No reemitir con el mismo número.';
  }
  switch (row.clase) {
    case 'ACEPTADO_PROPIO':
      return row.estadoLocal === 'ACEPTADO' ? 'Correcto.' : 'Marcar ACEPTADO y guardar el CDR (--apply).';
    case 'ACEPTADO_AJENO':
      return row.estadoLocal === 'REEMPLAZADO'
        ? 'Correcto: ya se emitió con otro número.'
        : 'Colisión de correlativo: revisión manual antes de emitir otro número.';
    case 'ACEPTADO_SIN_VERIFICAR':
      return 'Verificar en SUNAT (consulta de validez) que el comprobante aceptado sea este.';
    case 'RECHAZADO':
      return row.estadoLocal === 'REEMPLAZADO' ? 'Correcto: ya fue reemplazado.' : 'Reemitir con número nuevo (Reintentar).';
    case 'NO_EXISTE':
      return row.estadoLocal === 'ACEPTADO'
        ? 'Inconsistente: figura aceptado localmente pero SUNAT no lo tiene. Revisar.'
        : 'Reenviar el mismo XML firmado (Reintentar).';
    case 'DE_BAJA':
      return 'De baja en SUNAT: revisión manual.';
    default:
      return 'SUNAT no respondió: volver a consultar más tarde.';
  }
}
