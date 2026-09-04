// Envío de correo transaccional por Resend.
// Sin API key, el contenido se imprime en logs (mismo contrato que el reset de contraseña).

const RESEND_API_KEY = String(process.env.RESEND_API_KEY || '').trim();
const RESEND_FROM_EMAIL = String(process.env.RESEND_FROM_EMAIL || 'ZentoFact <onboarding@resend.dev>').trim();

function recipientsOf(to) {
  return (Array.isArray(to) ? to : [to])
    .map((entry) => String(entry || '').trim())
    .filter((entry) => entry.includes('@'));
}

export async function sendEmail({ to, subject, html, text, logLabel = 'mailer' } = {}) {
  const recipients = recipientsOf(to);
  if (!recipients.length) return { sent: false, reason: 'no-recipients' };

  if (!RESEND_API_KEY) {
    console.warn(`[${logLabel}] RESEND_API_KEY no configurado. Correo (solo logs):`);
    console.warn(`[${logLabel}] to=${recipients.join(',')}`);
    console.warn(`[${logLabel}] subject=${subject}`);
    if (text) console.warn(`[${logLabel}] body=${text}`);
    return { sent: false, logged: true };
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: recipients,
      subject,
      html,
      text: text || undefined,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[${logLabel}] Resend error`, res.status, body);
    throw new Error('No se pudo enviar el correo');
  }
  return { sent: true };
}
