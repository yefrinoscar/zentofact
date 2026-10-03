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
