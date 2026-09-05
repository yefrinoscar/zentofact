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

export function parseAlertEmailInput(value) {
  const tokens = String(Array.isArray(value) ? value.join('\n') : value || '')
    .split(/[,;\n\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const invalid = tokens.filter((entry) => !entry.includes('@'));
  if (invalid.length) throw new Error('Hay direcciones inválidas');
  return parseAlertEmails(tokens);
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
  configuredEmails = [],
  extraEmails = [],
  fallbackEmail = '',
} = {}) {
  const configured = parseAlertEmails(configuredEmails.length ? configuredEmails : extraEmails);
  if (configured.length) return configured;
  const fromUsers = (users || [])
    .filter((user) => userHasPermission(user, 'boletas'))
    .map((user) => String(user.email || '').trim().toLowerCase())
    .filter((email) => email.includes('@'));
  if (fromUsers.length) return fromUsers;
  return parseAlertEmails(fallbackEmail);
}

const NOTIFICATION_TITLE_MAX = 120;
const NOTIFICATION_MESSAGE_MAX = 4000;
const FAILED_EMISSION_PREVIEW_JOB = {
  kind: JOB_KIND_INVOICE,
  attempts: FAILED_EMISSION_ALERT_AFTER_ATTEMPTS,
  orderNumber: 'PV-PRUEBA',
  companyName: 'LIMBO',
  lastError: 'Prueba de aviso de boleta no emitida',
  status: 'failed',
};

export function normalizeNotificationInput({ title, message } = {}) {
  const subject = String(title || '').trim();
  const body = String(message || '').trim();
  if (!subject) throw new Error('Escribe el título');
  if (!body) throw new Error('Escribe el mensaje');
  if (subject.length > NOTIFICATION_TITLE_MAX) throw new Error('El título es demasiado largo');
  if (body.length > NOTIFICATION_MESSAGE_MAX) throw new Error('El mensaje es demasiado largo');
  return { title: subject, message: body };
}

export function buildOperatorNotificationEmail(input = {}) {
  const { title, message } = normalizeNotificationInput(input);
  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
      <p style="font-size:16px;margin:0 0 12px">${escapeHtml(title)}</p>
      <p style="font-size:14px;line-height:1.5;margin:0;color:#444;white-space:pre-wrap">${escapeHtml(message)}</p>
    </div>
  `.trim();
  return { subject: title, text: message, html };
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
  preview = false,
} = {}) {
  const order = String(orderNumber || order_number || '').trim() || 'sin número';
  const companyLabel = String(companyName || company || '').trim() || 'empresa';
  const count = Number(attempts || 0);
  const error = String(lastError || last_error || 'sin detalle').trim() || 'sin detalle';
  const failed = status === 'failed';
  const subject = `${preview ? 'Prueba · ' : ''}Comprobante no emitido · pedido ${order}`;
  const lead = failed
    ? `El comprobante del pedido ${order} (${companyLabel}) no se emitió tras ${count} intentos y quedó fallido.`
    : `El comprobante del pedido ${order} (${companyLabel}) no se emitió tras ${count} intentos.`;
  const next = failed
    ? 'Revisa Automatización y reintenta si corresponde.'
    : 'Sigue en cola. Revisa Automatización si hay que intervenir.';
  const previewLine = preview ? 'Este es un envío de prueba.\n\n' : '';
  const text = `${previewLine}${lead}\n\nÚltimo error: ${error}\n\n${next}`;
  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
      ${preview ? '<p style="font-size:13px;margin:0 0 12px;color:#777">Este es un envío de prueba.</p>' : ''}
      <p style="font-size:16px;margin:0 0 12px">${lead}</p>
      <p style="font-size:14px;line-height:1.5;margin:0 0 16px;color:#444">Último error: ${escapeHtml(error)}</p>
      <p style="font-size:14px;line-height:1.5;margin:0;color:#444">${next}</p>
    </div>
  `.trim();
  return { subject, text, html };
}

export async function deliverAlertEmail({
  email,
  sendEmail,
  listUsers,
  configuredEmails,
  extraEmails,
  fallbackEmail,
  log = () => {},
} = {}) {
  const configured = parseAlertEmails(configuredEmails ?? extraEmails);
  const users = configured.length || typeof listUsers !== 'function' ? [] : await listUsers();
  const to = resolveFailedEmissionAlertRecipients({ users, configuredEmails: configured, fallbackEmail });
  if (!to.length) {
    log('aviso de emisión: no hay destinatarios');
    return { notified: false, reason: 'no-recipients' };
  }
  if (typeof sendEmail !== 'function') {
    log('aviso de emisión: no hay envío configurado');
    return { notified: false, reason: 'no-mailer' };
  }
  const result = await sendEmail({
    to,
    subject: email?.subject,
    html: email?.html,
    text: email?.text,
    logLabel: 'auto-emit',
  });
  const delivered = result?.sent === true || result?.logged === true;
  if (!delivered) return { notified: false, reason: 'send-failed', to };
  return {
    notified: true,
    sent: result?.sent === true,
    logged: result?.logged === true,
    to,
    subject: email?.subject || '',
  };
}

export async function notifyFailedEmissionIfNeeded(job, {
  sendEmail,
  listUsers,
  configuredEmails,
  extraEmails,
  fallbackEmail,
  markAlerted,
  log = () => {},
} = {}) {
  if (!shouldSendFailedEmissionAlert(job)) return { notified: false, skipped: true };
  const result = await deliverAlertEmail({
    email: buildFailedEmissionAlertEmail(job),
    sendEmail,
    listUsers,
    configuredEmails,
    extraEmails,
    fallbackEmail,
    log,
  });
  if (result.notified && typeof markAlerted === 'function') await markAlerted(job);
  return result;
}

export async function sendOperatorNotification(input, deps = {}) {
  return deliverAlertEmail({
    email: buildOperatorNotificationEmail(input),
    ...deps,
  });
}

export async function sendFailedEmissionAlertPreview(deps = {}) {
  return deliverAlertEmail({
    email: buildFailedEmissionAlertEmail({ ...FAILED_EMISSION_PREVIEW_JOB, preview: true }),
    ...deps,
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
