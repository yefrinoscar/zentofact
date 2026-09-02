// Aviso cuando un comprobante de Emisión automática no sale tras 3 intentos.
// Sin I/O en las decisiones: el worker pregunta si avisar, a quién, y con qué texto.
import { JOB_KIND_CREDIT_NOTE, JOB_KIND_INVOICE } from './auto-emission-policy.js';
import { userHasPermission } from './permissions.js';

export const FAILED_EMISSION_ALERT_AFTER_ATTEMPTS = 3;

export function parseAlertEmails(value) {
  const raw = Array.isArray(value) ? value.join(',') : String(value || '');
  const emails = raw
    .split(/[,;\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.includes('@'));
  return [...new Set(emails)];
}

function jobKindOf(job) {
  return job?.kind === JOB_KIND_CREDIT_NOTE ? JOB_KIND_CREDIT_NOTE : JOB_KIND_INVOICE;
}

export function shouldSendFailedEmissionAlert(job) {
  if (jobKindOf(job) !== JOB_KIND_INVOICE) return false;
  if (Number(job?.attempts || 0) < FAILED_EMISSION_ALERT_AFTER_ATTEMPTS) return false;
  if (job?.alerted_at || job?.alertedAt) return false;
  return true;
}

export function resolveFailedEmissionAlertRecipients({
  users = [],
  extraEmails = [],
  fallbackEmail = '',
} = {}) {
  const extra = parseAlertEmails(extraEmails);
  const fromUsers = (users || [])
    .filter((user) => userHasPermission(user, 'boletas'))
    .map((user) => String(user.email || '').trim().toLowerCase())
    .filter((email) => email.includes('@'));
  const fallback = parseAlertEmails(fallbackEmail);
  const ordered = extra.concat(fromUsers.length ? fromUsers : fallback);
  return [...new Set(ordered)];
}

export function buildFailedEmissionAlertEmail({
  companyName,
  company,
  orderNumber,
  order_number,
  attempts,
  lastError,
  last_error,
  status,
} = {}) {
  const order = String(orderNumber || order_number || '').trim() || 'sin número';
  const companyLabel = String(companyName || company || '').trim() || 'empresa';
  const count = Number(attempts || 0);
  const error = String(lastError || last_error || 'sin detalle').trim() || 'sin detalle';
  const failed = status === 'failed';
  const subject = `Comprobante no emitido · pedido ${order}`;
  const lead = failed
    ? `El comprobante del pedido ${order} (${companyLabel}) no se emitió tras ${count} intentos y quedó fallido.`
    : `El comprobante del pedido ${order} (${companyLabel}) no se emitió tras ${count} intentos.`;
  const next = failed
    ? 'Revisa Automatización y reintenta si corresponde.'
    : 'Sigue en cola. Revisa Automatización si hay que intervenir.';
  const text = `${lead}\n\nÚltimo error: ${error}\n\n${next}`;
  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
      <p style="font-size:16px;margin:0 0 12px">${lead}</p>
      <p style="font-size:14px;line-height:1.5;margin:0 0 16px;color:#444">Último error: ${escapeHtml(error)}</p>
      <p style="font-size:14px;line-height:1.5;margin:0;color:#444">${next}</p>
    </div>
  `.trim();
  return { subject, text, html };
}

export async function notifyFailedEmissionIfNeeded(job, {
  sendEmail,
  listUsers,
  extraEmails,
  fallbackEmail,
  markAlerted,
  log = () => {},
} = {}) {
  if (!shouldSendFailedEmissionAlert(job)) return { notified: false, skipped: true };
  const users = typeof listUsers === 'function' ? await listUsers() : [];
  const to = resolveFailedEmissionAlertRecipients({ users, extraEmails, fallbackEmail });
  if (!to.length) {
    log('aviso de emisión: no hay destinatarios');
    return { notified: false, reason: 'no-recipients' };
  }
  if (typeof sendEmail !== 'function') {
    log('aviso de emisión: no hay envío configurado');
    return { notified: false, reason: 'no-mailer' };
  }
  const email = buildFailedEmissionAlertEmail(job);
  const result = await sendEmail({
    to,
    subject: email.subject,
    html: email.html,
    text: email.text,
    logLabel: 'auto-emit',
  });
  const delivered = result?.sent === true || result?.logged === true;
  if (!delivered) return { notified: false, reason: 'send-failed', to };
  if (typeof markAlerted === 'function') await markAlerted(job);
  return { notified: true, sent: result?.sent === true, logged: result?.logged === true, to };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
