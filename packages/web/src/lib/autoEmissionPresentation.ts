type EmissionJob = {
  status: string;
  kind?: string | null;
  attempts: number;
  last_error: string | null;
  result: string | null;

};

export function emissionNeedsReview(job: EmissionJob) {
  return job.status === 'failed' && (job.attempts >= 6
    || /REVISION_MANUAL|ANULADO|REEMPLAZADO/.test(`${job.last_error || ''} ${job.result || ''}`));
}

export function emissionSummary(job: EmissionJob) {
  const message = job.last_error || job.result || '';
  if (/Colisión de correlativo|El número está ocupado/.test(message)) return 'El número requiere verificación en SUNAT. Abre la revisión para comparar el comprobante.';
  if (message.includes('REVISION_MANUAL')) return 'Verifica el estado en SUNAT antes de emitir otro documento.';
  if (message.includes('ANULADO')) return 'El documento está anulado. Revisa el comprobante antes de continuar.';
  if (message.includes('REEMPLAZADO')) return 'El documento fue reemplazado. Revisa el comprobante vigente.';
  return message;
}

export function discountDateParts(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return {
    date: date.toLocaleDateString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: 'short', year: 'numeric' }),
    time: date.toLocaleTimeString('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: false }),
  };
}


export type EmissionReviewResult = {
  jobId: number; state: string; message: string; error: boolean;
  operation: 'verify' | 'resolve' | 'preview' | 'retry';
};

type ReviewJob = EmissionJob & { document_id?: number | null; document_status?: string | null };

export function documentStateLabel(state: string | null | undefined) {
  const labels: Record<string, string> = {
    ACEPTADO: 'Aceptado', REVISION_MANUAL: 'Revisión manual', RECHAZADO: 'Rechazado',
    PENDIENTE: 'Pendiente', NO_CONFIRMADO: 'Sin confirmar', ENVIANDO: 'Enviando',
    ANULADO: 'Anulado', REEMPLAZADO: 'Reemplazado',
  };
  return state ? labels[state] || state.replace(/_/g, ' ') : 'Sin confirmar';
}

export function emissionReviewNotice(job: ReviewJob, result: EmissionReviewResult | null) {
  const state = result?.state || job.document_status;
  if (result?.error) return {
    tone: 'error', title: result.operation === 'resolve' ? 'No se pudo cerrar la revisión'
      : result.operation === 'preview' ? 'No se pudo abrir el comprobante' : result.operation === 'retry' ? 'No se pudo reintentar la emisión' : 'No se pudo consultar SUNAT',
    body: 'Vuelve a intentar. El detalle de la respuesta está disponible en Diagnóstico de la emisión.',
  };
  if (!job.document_id) return { tone: 'warning', title: 'No hay un comprobante vinculado', body: 'No se puede consultar SUNAT desde este caso. Consulta el diagnóstico de la emisión para identificar el motivo.' };
  if (state === 'ACEPTADO') return job.status === 'failed' ? {
    tone: 'success', title: 'Documento aceptado en SUNAT',
    body: 'Cierra la revisión para completar este caso sin emitir otro comprobante.',
  } : {
    tone: 'success', title: 'Revisión completada', body: 'El comprobante está aceptado por SUNAT.',
  };
  if (result?.state === 'REVISION_MANUAL') return {
    tone: 'warning', title: 'No se pudo confirmar que sea este comprobante',
    body: /Mismo cliente, pero el CDR tiene fecha/.test(result.message)
      ? 'El cliente coincide, pero la fecha del CDR es distinta a la del comprobante local. No se puede cerrar la revisión ni emitir otro número automáticamente.'
      : /ocupado por un comprobante|tipo de documento.*no coincide|El CDR corresponde/.test(result.message)
        ? 'El CDR identifica otro cliente, tipo de documento o número de comprobante. No se puede cerrar la revisión ni emitir otro número automáticamente.'
        : 'Los datos del CDR no permiten cerrar la revisión. No se emitirá otro número automáticamente. Consulta el diagnóstico para ver la diferencia encontrada.',
  };
  if (result) return { tone: 'warning', title: 'Consulta terminada: revisión pendiente', body: 'SUNAT aún no confirma la aceptación de este comprobante. Puedes volver a verificar; la consulta no crea ni reenvía documentos.' };
  if (emissionNeedsReview(job)) return {
    tone: 'warning', title: 'Emisión detenida para revisión',
    body: 'Verifica en SUNAT si el comprobante registrado corresponde a esta emisión. La consulta no crea ni reenvía documentos.',
  };
  return null;
}
