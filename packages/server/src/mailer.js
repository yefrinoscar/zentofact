// Envío de correo transaccional por Resend.
// Sin API key, el contenido se imprime en logs (mismo contrato que el reset de contraseña).

function resendConfig() {
  return {
    apiKey: String(process.env.RESEND_API_KEY || '').trim(),
    fromEmail: String(process.env.RESEND_FROM_EMAIL || 'ZentoFact <onboarding@resend.dev>').trim(),
  };
}

function recipientsOf(to) {
  return (Array.isArray(to) ? to : [to])
    .map((entry) => String(entry || '').trim())
    .filter((entry) => entry.includes('@'));
}

export function isMailerConfigured() {
  return Boolean(resendConfig().apiKey);
}

export async function sendEmail({ to, subject, html, text, logLabel = 'mailer' } = {}) {
  const recipients = recipientsOf(to);
  if (!recipients.length) return { sent: false, reason: 'no-recipients' };

  const { apiKey, fromEmail } = resendConfig();
  if (!apiKey) {
    console.warn(`[${logLabel}] RESEND_API_KEY no configurado. Correo (solo logs):`);
    console.warn(`[${logLabel}] to=${recipients.join(',')}`);
    console.warn(`[${logLabel}] subject=${subject}`);
    if (text) console.warn(`[${logLabel}] body=${text}`);
    return { sent: false, logged: true };
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
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
