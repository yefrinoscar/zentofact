// Decisiones de la cola de autoemisión. Sin I/O: webhook, worker y cron
// preguntan aquí qué job crear y si una cancelada/devuelta debe anularse.

export const JOB_KIND_INVOICE = 'invoice';
export const JOB_KIND_CREDIT_NOTE = 'credit_note';

export const READY_STATUSES = ['ready_to_ship', 'shipped', 'delivered'];

export function normStatus(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, '_');
}

export function isReadyStatus(status) {
  const key = normStatus(status);
  return READY_STATUSES.some((item) => key.includes(item));
}

export function isPendingStatus(status) {
  return normStatus(status).includes('pending');
}

function statusParts(status) {
  return normStatus(status).split('|').map((part) => part.trim()).filter(Boolean);
}

function partIsCanceled(part) {
  return part.includes('canceled') || part.includes('cancelled') || part.includes('cancelada');
}

function partIsReturned(part) {
  return part.includes('returned') || part.includes('devuelta');
}

function partIsCreditNote(part) {
  return partIsCanceled(part) || partIsReturned(part);
}

export function isCanceledStatus(status) {
  const parts = statusParts(status);
  return parts.length > 0 && parts.every(partIsCanceled);
}

export function isReturnedStatus(status) {
  const parts = statusParts(status);
  return parts.length > 0 && parts.every(partIsReturned);
}

/** Cancelada/devuelta completa. Un ítem cancelado junto a otro entregado no cuenta. */
export function isCreditNoteStatus(status) {
  const parts = statusParts(status);
  return parts.length > 0 && parts.every(partIsCreditNote);
}

/** Hay ítems vigentes y otros cancelados/devueltos: no se anula el comprobante entero. */
export function isPartialCreditNoteStatus(status) {
  const parts = statusParts(status);
  if (parts.length < 2) return false;
  return parts.some(partIsCreditNote) && !parts.every(partIsCreditNote);
}

/** Qué job encolar según el estado de Falabella. null = no encolar. */
export function jobKindForStatus(status) {
  if (isCreditNoteStatus(status)) return JOB_KIND_CREDIT_NOTE;
  if (isPartialCreditNoteStatus(status)) return null;
  if (isReadyStatus(status)) return JOB_KIND_INVOICE;
  return null;
}

export function acceptedSunat(document) {
  return String(document?.estadoSunat || document?.estado || '').toUpperCase() === 'ACEPTADO';
}

function documentAmount(document) {
  const raw = document?.total ?? document?.mtoImpVenta ?? document?.mto_imp_venta;
  const amount = Number(String(raw ?? '').replace(/,/g, ''));
  return Number.isFinite(amount) ? amount : 0;
}

function acceptedSalesDocument(boleta, factura) {
  if (boleta && acceptedSunat(boleta)) {
    return { type: 'boleta', document: boleta, id: boleta.id };
  }
  if (factura && acceptedSunat(factura)) {
    return { type: 'factura', document: factura, id: factura.id };
  }
  return null;
}

/**
 * Decide qué hace un job de nota de crédito.
 * No emite: sin comprobante aceptado, S/ 0, o si ya hay NC aceptada.
 */
export function decideCreditNoteJob({
  status,
  orderDate,
  minOrderDate,
  boleta,
  factura,
  creditNote,
  dryRun = false,
} = {}) {
  if (orderDate && minOrderDate && orderDate < minOrderDate) {
    return {
      action: 'skip',
      result: `orden de ${orderDate.toISOString().slice(0, 10)} anterior a la fecha mínima (julio 2026), se omite`,
    };
  }

  const currentStatus = normStatus(status);
  if (isPartialCreditNoteStatus(currentStatus)) {
    return {
      action: 'skip',
      result: `estado mixto "${currentStatus}": hay ítems vigentes; no se emite nota de crédito de anulación completa`,
    };
  }
  if (!isCreditNoteStatus(currentStatus)) {
    if (isPendingStatus(currentStatus) || isReadyStatus(currentStatus)) {
      return { action: 'retry', error: `estado "${currentStatus || 'desconocido'}" aún no pide nota de crédito` };
    }
    return { action: 'skip', result: `estado "${currentStatus || 'desconocido'}" no corresponde nota de crédito` };
  }

  if (creditNote) {
    const numero = creditNote.numeroCompleto || creditNote.numero_completo || '';
    if (acceptedSunat(creditNote)) {
      return {
        action: 'done',
        result: `ya tenía nota de crédito ${numero}`.trim(),
        boletaNumero: numero || null,
      };
    }
    const estado = String(creditNote.estadoSunat || creditNote.estado || '').toUpperCase();
    if (HUMAN_ONLY_STATES.includes(estado)) {
      return {
        action: 'fail',
        result: `nota de crédito ${numero} está ${estado}: requiere revisión manual antes de emitir otra`,
        boletaNumero: numero || null,
      };
    }
    // Sin confirmar: SUNAT pudo aceptarla. Se reconcilia; nunca se emite otra a ciegas.
    if (dryRun) {
      return { action: 'skip', result: `Simulación: reconciliaría la nota de crédito ${numero} (${estado || 'SIN ESTADO'}) con SUNAT`, boletaNumero: numero || null };
    }
    return { action: 'reconcile', creditNoteId: creditNote.id, boletaNumero: numero || null };
  }

  const sales = acceptedSalesDocument(boleta, factura);
  if (!sales) {
    const existing = boleta || factura;
    if (existing) {
      const tipo = boleta ? 'boleta' : 'factura';
      const numero = existing.numeroCompleto || existing.numero_completo || '';
      const est = String(existing.estadoSunat || existing.estado || 'SIN ACEPTAR').toUpperCase();
      return {
        action: 'fail',
        result: `${tipo} ${numero} existe pero está ${est} en SUNAT — no se emite nota de crédito`,
        boletaNumero: numero || null,
      };
    }
    return { action: 'skip', result: 'no hay documento emitido; no corresponde nota de crédito' };
  }

  if (documentAmount(sales.document) <= 0) {
    return { action: 'skip', result: 'documento de S/ 0.00; no corresponde nota de crédito' };
  }

  if (dryRun) {
    return { action: 'skip', result: 'Simulación: cumpliría condiciones, no se emitió' };
  }

  return {
    action: 'emit',
    source: sales.type,
    documentId: sales.id,
    boletaNumero: sales.document.numeroCompleto || sales.document.numero_completo || null,
  };
}

// Estados de un comprobante existente que ningún job automático debe tocar.
const HUMAN_ONLY_STATES = ['REVISION_MANUAL', 'ANULADO', 'REEMPLAZADO'];

/**
 * Decide qué hace un job de comprobante cuando la orden ya tiene un documento.
 * Un documento no aceptado se reconcilia con SUNAT antes de enviar. También
 * se revisan los bloqueos históricos por colisión; SUNAT debe confirmar que
 * el número pertenece a otro cliente para permitir un reemplazo.
 */
export function decideExistingDocumentJob({ document, tipo, dryRun = false }) {
  const numero = document?.numeroCompleto || '';
  const estado = String(document?.estadoSunat || document?.estado || '').toUpperCase();
  if (estado === 'ACEPTADO') {
    return { action: 'done', result: `ya tenía ${tipo} ${numero}`, boletaNumero: numero };
  }
  if (['ANULADO', 'REEMPLAZADO'].includes(estado)) {
    return {
      action: 'fail',
      result: `${tipo} ${numero} está ${estado}: requiere revisión manual antes de emitir otro comprobante`,
      boletaNumero: numero,
    };
  }
  if (dryRun) {
    return { action: 'skip', result: `Simulación: reconciliaría ${tipo} ${numero} (${estado || 'SIN ESTADO'}) con SUNAT`, boletaNumero: numero };
  }
  return { action: 'reconcile' };
}

/**
 * Traduce el resultado de reEmitBoleta/reEmitFactura en el siguiente paso del
 * job. Si quedó aceptado (recuperado o reemitido) hay que subirlo a Falabella
 * con el número que realmente quedó activo, que puede ser uno nuevo.
 */
export function reconciliationJobOutcome(reconciled, { tipo, document }) {
  const numero = reconciled?.numeroCompleto || document?.numeroCompleto || '';
  if (reconciled?.success) {
    return {
      action: 'upload',
      documentId: reconciled.documentId ?? document?.id,
      numeroCompleto: numero,
      note: reconciled.replacedNumeroCompleto
        ? `${tipo} ${numero} ACEPTADA (reemplaza a ${reconciled.replacedNumeroCompleto})`
        : `${tipo} ${numero} ACEPTADA tras reconciliar con SUNAT`,
    };
  }
  const message = reconciled?.message || `${tipo} ${numero} requiere revisión antes de reemitir`;
  if (reconciled?.manualReview || reconciled?.error_code === 'DOCUMENT_CLOSED') {
    return { action: 'fail', result: message, boletaNumero: numero };
  }
  // Consulta fallida, estado incierto, otro proceso reconciliando o envío no
  // aceptado: se reconcilia otra vez en el siguiente intento. Los topes de
  // reenvíos y números nuevos terminan llevándolo a revisión manual.
  return { action: 'retry', error: message };
}

/**
 * Traduce la reconciliación de una nota de crédito en el resultado del job.
 * Si SUNAT la rechazó, la nota se descartó: el siguiente intento emite otra.
 */
export function creditNoteReconciliationOutcome(reconciled, { numero = '' } = {}) {
  const message = reconciled?.message || `nota de crédito ${numero} requiere revisión`;
  if (reconciled?.success) {
    return { action: 'done', result: `nota de crédito ${reconciled.numeroCompleto || numero} ACEPTADA tras reconciliar con SUNAT`, boletaNumero: reconciled.numeroCompleto || numero || null };
  }
  if (reconciled?.manualReview || reconciled?.error_code === 'DOCUMENT_CLOSED') {
    return { action: 'fail', result: message, boletaNumero: numero || null };
  }
  return { action: 'retry', error: message };
}

/**
 * Qué hace el barrido con un comprobante sin confirmar:
 * - si su job está activo, nada (el job lo reconcilia);
 * - un job fallido se consulta en modo lectura; no se resetea el contador ni se
 *   reintenta indefinidamente;
 * - solo una respuesta explícita (aceptado, rechazado o no encontrado) puede
 *   devolverlo a la cola para continuar el flujo.
 */
export function sweepDocumentAction({ document, job, companyEnabled }) {
  if (job && ['pending', 'processing'].includes(job.status)) return 'wait';
  return 'refresh';
}
