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

export function isCanceledStatus(status) {
  const key = normStatus(status);
  return key.includes('canceled') || key.includes('cancelled') || key.includes('cancelada');
}

export function isReturnedStatus(status) {
  const key = normStatus(status);
  return key.includes('returned') || key.includes('devuelta');
}

export function isCreditNoteStatus(status) {
  return isCanceledStatus(status) || isReturnedStatus(status);
}

/** Qué job encolar según el estado de Falabella. null = no encolar. */
export function jobKindForStatus(status) {
  if (isCreditNoteStatus(status)) return JOB_KIND_CREDIT_NOTE;
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
    return {
      action: 'fail',
      result: `nota de crédito ${numero} existe pero está ${String(creditNote.estadoSunat || creditNote.estado || 'SIN ACEPTAR').toUpperCase()} en SUNAT — revisar (no se re-emite para evitar duplicados)`,
      boletaNumero: numero || null,
    };
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
