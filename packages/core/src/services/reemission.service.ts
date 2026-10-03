import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { boletas, clients, companies, creditNotes, facturas } from '../db/schema';
import { getNextCorrelative } from './correlative.service';
import { withDocumentLock, reemissionLockKey } from './document-lock';
import { recordAttempt } from './emission-ledger';
import type { DocumentTable } from './emission-ledger';
import { SunatService } from './sunat.service';
import type { CompanyConfig, StatusResult } from './sunat.service';
import {
  CLOSED_STATES,
  classifyStatusCdr,
  decideReemission,
  readReconciliationTrace,
  withReconciliationTrace,
} from './sunat-reconciliation';
import type { ReemissionDecision, StatusCdrOutcome } from './sunat-reconciliation';
import { resolveIssueDate, withIssueDateTrace } from '../utils/issue-date';

export interface ReemissionAdapter {
  documentTable: DocumentTable;
  table: typeof boletas | typeof facturas | typeof creditNotes;
  tipoDocumento: '01' | '03' | '07';
  label: 'boleta' | 'factura' | 'nota de crédito';
  send: (id: number) => Promise<any>;
  saveCdr: (doc: { serie: string; correlativo: string; fechaEmision: string }, cdrZip: Buffer) => Promise<string>;
  /** Campos que se limpian en el comprobante que reemplaza al rechazado. */
  replacementOverrides: Record<string, unknown>;
  /**
   * Si existe, reemplaza la emisión automática de un número nuevo tras un
   * rechazo definitivo (las notas de crédito se descartan y se emiten de nuevo
   * desde su comprobante afectado).
   */
  onDefinitiveRejection?: (doc: any) => Promise<void>;
  /** Efectos adicionales cuando SUNAT confirma que el documento está aceptado. */
  onAccepted?: (doc: any) => Promise<void>;
}

const capitalized = (label: string) => label.charAt(0).toUpperCase() + label.slice(1);

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function companyConfig(company: any): CompanyConfig {
  return {
    ruc: company.ruc,
    razonSocial: company.razonSocial,
    direccion: company.direccion || '',
    ubigeo: company.ubigeo || '',
    usuarioSol: company.usuarioSol || 'MODDATOS',
    claveSol: company.claveSol || 'MODDATOS',
    certificado: company.certificado || '',
    certificadoPassword: company.certificadoPassword || '',
  };
}

async function loadDocument(adapter: ReemissionAdapter, id: number): Promise<any> {
  const table = adapter.table as any;
  return (await db.select().from(table).where(eq(table.id, id)).limit(1))[0] as any;
}

async function updateDocument(adapter: ReemissionAdapter, id: number, values: Record<string, unknown>) {
  const table = adapter.table as any;
  await db.update(table).set({ ...values, updatedAt: nowSeconds() }).where(eq(table.id, id));
}

interface StatusCheck {
  ruc: string;
  doc: any;
  status: StatusResult;
  outcome: StatusCdrOutcome;
  decision: ReemissionDecision;
}

/** Consulta getStatusCdr y decide, sin modificar nada todavía. */
async function checkWithSunat(adapter: ReemissionAdapter, doc: any): Promise<StatusCheck> {
  const company = (await db.select().from(companies).where(eq(companies.id, doc.companyId)).limit(1))[0];
  if (!company) throw new Error('Empresa no encontrada');
  const client = (await db.select().from(clients).where(eq(clients.id, doc.clientId)).limit(1))[0];

  const sunat = new SunatService(companyConfig(company));
  const status = await sunat.getStatusCdr(company.ruc, doc.tipoDocumento || adapter.tipoDocumento, doc.serie, doc.correlativo);
  const outcome = classifyStatusCdr(status);
  let decision = decideReemission({
    outcome,
    local: {
      numeroCompleto: doc.numeroCompleto,
      fechaEmision: doc.fechaEmision,
      clientDocumento: client?.numeroDocumento || null,
      clientTipoDocumento: client?.tipoDocumento || null,
      codigoHash: doc.codigoHash || null,
    },
    trace: readReconciliationTrace(doc.datosAdicionales),
  });
  if (adapter.tipoDocumento === '07' && decision.collision) {
    decision = { action: 'MANUAL_REVIEW', estadoSunat: 'REVISION_MANUAL', reason: 'El número de la nota de crédito pertenece a otro cliente. Requiere revisión manual.' };
  }
  return { ruc: company.ruc, doc, status, outcome, decision };
}

/**
 * Guarda la evidencia de la consulta: estado decidido, respuesta de SUNAT, CDR
 * y contadores. Si el CDR de una aceptación no se puede guardar, la boleta no
 * se da por aceptada.
 */
async function persistCheck(adapter: ReemissionAdapter, check: StatusCheck, source: string): Promise<ReemissionDecision> {
  const { doc, status, outcome } = check;
  let decision = check.decision;
  let cdrPath = doc.cdrPath;
  if (status.cdrZip) {
    try {
      cdrPath = await adapter.saveCdr(
        { serie: doc.serie, correlativo: doc.correlativo, fechaEmision: String(doc.fechaEmision) },
        status.cdrZip,
      );
    } catch (error: any) {
      if (decision.action === 'MARK_ACCEPTED') {
        decision = { action: 'BLOCK', estadoSunat: 'NO_CONFIRMADO', reason: `SUNAT tiene el comprobante aceptado, pero no se pudo guardar el CDR: ${error.message}` };
      }
    }
  }

  await recordAttempt({
    ruc: check.ruc,
    tipoDocumento: adapter.tipoDocumento,
    serie: doc.serie,
    correlativo: doc.correlativo,
    documentTable: adapter.documentTable,
    documentId: doc.id,
    reference: doc.orderNumber || doc.numDocAfectado || null,
    kind: 'STATUS_CHECK',
    outcome: `${outcome.kind}:${decision.action}`,
    responseCode: ('code' in outcome ? outcome.code : outcome.kind === 'QUERY_FAILED' ? null : outcome.statusCode) || status.statusCode || null,
    responseMessage: decision.reason,
    cdrPath,
  });

  const trace = readReconciliationTrace(doc.datosAdicionales);
  const checkedAt = new Date().toISOString();
  await updateDocument(adapter, doc.id, {
    ...(decision.estadoSunat ? { estadoSunat: decision.estadoSunat } : {}),
    cdrPath,
    respuestaSunat: JSON.stringify({
      source,
      outcome: outcome.kind,
      statusCode: status.statusCode || null,
      statusMessage: status.statusMessage || null,
      code: 'code' in outcome ? outcome.code : null,
      description: outcome.message || null,
      decision: decision.action,
      reason: decision.reason,
      checkedAt,
    }),
    datosAdicionales: withReconciliationTrace(doc.datosAdicionales, {
      resendCount: trace.resendCount + (decision.action === 'RESEND_SAME_NUMBER' ? 1 : 0),
      newNumberCount: trace.newNumberCount,
      lastDecision: decision.action,
      lastReason: decision.reason,
      checkedAt,
    }),
  });
  return decision;
}

async function nextAvailableCorrelative(adapter: ReemissionAdapter, doc: any): Promise<string> {
  const company = (await db.select().from(companies).where(eq(companies.id, doc.companyId)).limit(1))[0];
  if (!company) throw new Error('Empresa no encontrada');
  const sunat = new SunatService(companyConfig(company));
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const next = await getNextCorrelative(doc.branchId, adapter.tipoDocumento, doc.serie, true);
    const outcome = classifyStatusCdr(await sunat.getStatusCdr(company.ruc, adapter.tipoDocumento, doc.serie, next));
    if (outcome.kind === 'NOT_FOUND') return next;
    if (!['ACCEPTED', 'REJECTED', 'VOIDED'].includes(outcome.kind)) {
      throw new Error(`No se pudo confirmar si ${doc.serie}-${next} está libre en SUNAT: ${outcome.message}`);
    }
  }
  throw new Error('SUNAT tiene ocupados los siguientes 100 correlativos. Vuelve a intentar para continuar la búsqueda.');
}

async function issueReplacement(adapter: ReemissionAdapter, doc: any, collision = false) {
  if (adapter.tipoDocumento === '07') throw new Error('Las notas de crédito no se reemplazan con otro número; se emiten desde su comprobante afectado.');
  const nextCorrelativo = collision
    ? await nextAvailableCorrelative(adapter, doc)
    : await getNextCorrelative(doc.branchId, adapter.tipoDocumento, doc.serie, true);
  const numeroCompleto = `${doc.serie}-${nextCorrelativo}`;
  const issueDate = resolveIssueDate(doc.fechaEmision, adapter.tipoDocumento as '01' | '03');
  const trace = readReconciliationTrace(doc.datosAdicionales);
  const datosAdicionales = withReconciliationTrace(withIssueDateTrace(doc.datosAdicionales, issueDate), {
    resendCount: 0,
    newNumberCount: trace.newNumberCount + 1,
    lastDecision: 'ISSUE_NEW_NUMBER',
    lastReason: `Reemplaza a ${doc.numeroCompleto}, ${collision ? 'ocupado por otro cliente' : 'rechazado por SUNAT'}.`,
    checkedAt: new Date().toISOString(),
  });
  const table = adapter.table as any;
  const ts = nowSeconds();

  // El rechazado queda como evidencia (sin la orden) y el reemplazo se lleva la
  // orden en la misma transacción: nunca queda una orden sin comprobante activo.
  const newId = await db.transaction(async (tx) => {
    await tx.update(table).set({ orderNumber: null, estadoSunat: 'REEMPLAZADO', updatedAt: ts }).where(eq(table.id, doc.id));
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = doc;
    const inserted = await tx.insert(table).values({
      ...rest,
      ...adapter.replacementOverrides,
      correlativo: nextCorrelativo,
      numeroCompleto,
      orderNumber: doc.orderNumber,
      fechaEmision: issueDate.fechaEmision,
      datosAdicionales,
      estadoSunat: 'PENDIENTE',
      respuestaSunat: null,
      xmlPath: null,
      cdrPath: null,
      pdfPath: null,
      codigoHash: null,
      createdAt: ts,
      updatedAt: ts,
    }).returning({ id: table.id });
    const column = adapter.documentTable === 'facturas' ? sql`factura_id` : sql`boleta_id`;
    const kind = adapter.documentTable === 'facturas' ? 'factura' : 'boleta';
    await tx.execute(sql`insert into order_documents (order_id, document_kind, ${column})
      select order_id, document_kind, ${inserted[0].id} from order_documents
      where ${column}=${doc.id} and document_kind=${kind} on conflict do nothing`);
    return inserted[0].id as number;
  });
  return { id: newId, numeroCompleto };
}

function closedResult(adapter: ReemissionAdapter, doc: any) {
  const estado = String(doc.estadoSunat || '').toUpperCase();
  if (estado === 'ACEPTADO') {
    return { success: true, reemitted: false, estadoSunat: 'ACEPTADO', documentId: doc.id, numeroCompleto: doc.numeroCompleto, message: `La ${adapter.label} ya está aceptada por SUNAT.` };
  }
  return {
    success: false,
    blocked: true,
    manualReview: estado === 'REVISION_MANUAL',
    error_code: 'DOCUMENT_CLOSED',
    estadoSunat: estado,
    documentId: doc.id,
    numeroCompleto: doc.numeroCompleto,
    message: `No se reemite: la ${adapter.label} ${doc.numeroCompleto} está ${estado}.`,
  };
}

/**
 * Reemite un comprobante no aceptado solo después de consultar SUNAT:
 * - aceptado y es nuestro: se marca ACEPTADO y se guarda el CDR;
 * - aceptado para otro cliente: busca un correlativo libre y reemplaza;
 * - aceptado pero no se puede probar que sea nuestro: REVISION_MANUAL;
 * - no existe (respuesta explícita): se reenvía el mismo XML firmado;
 * - rechazado: se quema el número y se emite uno nuevo, con tope por pedido;
 * - consulta fallida o estado incierto: no se hace nada.
 */
export async function reconcileAndReemit(adapter: ReemissionAdapter, id: number) {
  const initial = await loadDocument(adapter, id);
  if (!initial) throw new Error(`${capitalized(adapter.label)} no encontrada`);

  const lockKey = reemissionLockKey({ ...initial, tipoDocumento: adapter.tipoDocumento });
  return withDocumentLock(lockKey, async () => {
    // Releer dentro del lock: otro proceso pudo reemplazarlo o aceptarlo.
    const doc = await loadDocument(adapter, id);
    const state = String(doc.estadoSunat || '').toUpperCase();
    // Los bloqueos históricos de ventas se consultan otra vez; solo evidencia
    // nueva de otro cliente habilita un reemplazo. Las NC mantienen su bloqueo.
    if (CLOSED_STATES.includes(state) && !(state === 'REVISION_MANUAL' && adapter.tipoDocumento !== '07')) return closedResult(adapter, doc);

    const check = await checkWithSunat(adapter, doc);
    if (state === 'REVISION_MANUAL' && check.decision.action !== 'MARK_ACCEPTED'
      && !(check.decision.action === 'ISSUE_NEW_NUMBER' && check.decision.collision)) return closedResult(adapter, doc);
    const decision = await persistCheck(adapter, check, 'SUNAT_GET_STATUS_CDR_BEFORE_REEMIT');
    const base = { documentId: doc.id, numeroCompleto: doc.numeroCompleto, decision: decision.action };

    switch (decision.action) {
      case 'MARK_ACCEPTED':
        await adapter.onAccepted?.(doc);
        return { ...base, success: true, reemitted: false, refreshed: true, estadoSunat: 'ACEPTADO', message: `SUNAT confirmó que la ${adapter.label} ${doc.numeroCompleto} ya estaba aceptada; se recuperó su CDR.` };
      case 'BLOCK':
        return {
          ...base,
          success: false,
          blocked: true,
          error_code: check.outcome.kind === 'QUERY_FAILED' ? 'SUNAT_STATUS_CHECK_FAILED' : 'SUNAT_STATUS_PENDING',
          message: `No se reemite: ${decision.reason}`,
        };
      case 'MANUAL_REVIEW':
        return { ...base, success: false, blocked: true, manualReview: true, error_code: 'SUNAT_MANUAL_REVIEW', message: `Requiere revisión manual: ${decision.reason}` };
      case 'RESEND_SAME_NUMBER': {
        const sent = await adapter.send(doc.id);
        return { ...base, ...sent, reemitted: false };
      }
      case 'ISSUE_NEW_NUMBER': {
        if (adapter.onDefinitiveRejection) {
          await adapter.onDefinitiveRejection(doc);
          return { ...base, success: false, rejected: true, error_code: 'SUNAT_REJECTED', message: `SUNAT rechazó la ${adapter.label} ${doc.numeroCompleto}; se descartó y puede emitirse otra. ${decision.reason}` };
        }
        const replacement = await issueReplacement(adapter, doc, decision.collision);
        const sent = await adapter.send(replacement.id);
        return {
          ...sent,
          decision: decision.action,
          reemitted: true,
          documentId: replacement.id,
          numeroCompleto: replacement.numeroCompleto,
          replacedNumeroCompleto: doc.numeroCompleto,
        };
      }
    }
  }, () => ({
    success: false,
    blocked: true,
    error_code: 'REEMISSION_IN_PROGRESS',
    documentId: initial.id,
    numeroCompleto: initial.numeroCompleto,
    message: `Otro proceso ya está reconciliando la ${adapter.label} ${initial.numeroCompleto}.`,
  }));
}

/**
 * Sincroniza el estado local con SUNAT sin enviar ni reemitir nada. Solo
 * marca ACEPTADO cuando el CDR corresponde a este comprobante.
 */
export async function refreshStatusFromSunat(adapter: ReemissionAdapter, id: number) {
  const doc = await loadDocument(adapter, id);
  if (!doc) throw new Error(`${capitalized(adapter.label)} no encontrada`);
  const previous = String(doc.estadoSunat || '').toUpperCase();
  if (previous === 'ACEPTADO') return { success: true, estadoSunat: 'ACEPTADO', changed: false };

  const check = await checkWithSunat(adapter, doc);
  if (check.outcome.kind === 'QUERY_FAILED') {
    return { success: false, estadoSunat: previous, changed: false, code: 'SUNAT_QUERY_ERROR', message: check.outcome.message };
  }
  // Una consulta informativa no consume reenvíos ni números nuevos.
  const informative: StatusCheck = check.decision.action === 'RESEND_SAME_NUMBER' || check.decision.action === 'ISSUE_NEW_NUMBER'
    ? { ...check, decision: { ...check.decision, action: 'BLOCK' } }
    : check;
  const decision = await persistCheck(adapter, informative, 'SUNAT_GET_STATUS_CDR');
  if (decision.action === 'MARK_ACCEPTED') await adapter.onAccepted?.(doc);
  const estadoSunat = decision.estadoSunat || previous;
  return {
    success: true,
    estadoSunat,
    changed: estadoSunat !== previous,
    statusCode: check.status.statusCode,
    message: decision.reason,
  };
}
