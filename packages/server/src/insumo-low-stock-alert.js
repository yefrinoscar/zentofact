// Aviso cuando un Insumo cruza el punto de reposición.
// Sin I/O en las decisiones: la ruta pregunta si avisar, a quién, y con qué texto.
import { parseAlertEmails } from './auto-emission-alert.js';
import { userHasPermission } from './permissions.js';

export function isInsumoLowStock(insumo) {
  if (!insumo) return false;
  if (String(insumo.status || 'active') === 'archived') return false;
  const reorder = insumo.reorderPoint;
  if (reorder == null || reorder === '') return false;
  return Number(insumo.quantityOnHand || 0) <= Number(reorder);
}

export function shouldNotifyInsumoLowStock({ previous, current } = {}) {
  if (!isInsumoLowStock(current)) return false;
  if (isInsumoLowStock(previous)) return false;
  return true;
}

export function resolveInsumoLowStockRecipients({
  users = [],
  configuredEmails = [],
  extraEmails = [],
  fallbackEmail = '',
} = {}) {
  const configured = parseAlertEmails(configuredEmails.length ? configuredEmails : extraEmails);
  if (configured.length) return configured;
  const fromUsers = (users || [])
    .filter((user) => userHasPermission(user, 'insumos'))
    .map((user) => String(user.email || '').trim().toLowerCase())
    .filter((email) => email.includes('@'));
  if (fromUsers.length) return fromUsers;
  return parseAlertEmails(fallbackEmail);
}

function formatQuantity(value) {
  return Number(value).toLocaleString('es-PE', { maximumFractionDigits: 2 });
}

function quantityLine(insumo, field) {
  const amount = formatQuantity(field === 'min' ? insumo.reorderPoint : insumo.quantityOnHand);
  const unit = String(insumo.unit || '').trim();
  return unit ? `${amount} ${unit}` : amount;
}

export function buildInsumoLowStockEmail(insumo = {}) {
  const name = String(insumo.name || '').trim() || 'Insumo';
  const empty = Number(insumo.quantityOnHand || 0) <= 0;
  const subject = empty ? `Insumo agotado · ${name}` : `Insumo por reponer · ${name}`;
  const lead = empty ? `${name} se acabó.` : `${name} se está acabando.`;
  const lines = [
    `Saldo: ${quantityLine(insumo, 'saldo')}`,
    `Mínimo: ${quantityLine(insumo, 'min')}`,
  ];
  const supplier = String(insumo.supplierCode || '').trim();
  if (supplier) lines.push(`Proveedor: ${supplier}`);
  const next = 'Revisa Insumos y pide lo que falte.';
  const text = `${lead}\n\n${lines.join('\n')}\n\n${next}`;
  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
      <p style="font-size:16px;margin:0 0 12px">${escapeHtml(lead)}</p>
      <p style="font-size:14px;line-height:1.5;margin:0 0 16px;color:#444">${lines.map(escapeHtml).join('<br>')}</p>
      <p style="font-size:14px;line-height:1.5;margin:0;color:#444">${escapeHtml(next)}</p>
    </div>
  `.trim();
  return { subject, text, html };
}

export async function notifyInsumoLowStockIfNeeded({ previous, current } = {}, {
  sendEmail,
  listUsers,
  configuredEmails,
  extraEmails,
  fallbackEmail,
  log = () => {},
} = {}) {
  if (!shouldNotifyInsumoLowStock({ previous, current })) {
    return { notified: false, skipped: true };
  }
  const configured = parseAlertEmails(configuredEmails ?? extraEmails);
  const users = configured.length || typeof listUsers !== 'function' ? [] : await listUsers();
  const to = resolveInsumoLowStockRecipients({ users, configuredEmails: configured, fallbackEmail });
  if (!to.length) {
    log('aviso de insumos: no hay destinatarios');
    return { notified: false, reason: 'no-recipients' };
  }
  if (typeof sendEmail !== 'function') {
    log('aviso de insumos: no hay envío configurado');
    return { notified: false, reason: 'no-mailer' };
  }
  const email = buildInsumoLowStockEmail(current);
  const result = await sendEmail({
    to,
    subject: email.subject,
    html: email.html,
    text: email.text,
    logLabel: 'insumos',
  });
  const delivered = result?.sent === true || result?.logged === true;
  if (!delivered) return { notified: false, reason: 'send-failed', to };
  return { notified: true, sent: result?.sent === true, logged: result?.logged === true, to };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
