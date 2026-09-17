import test from 'node:test';
import assert from 'node:assert/strict';
import { isMailerConfigured, sendEmail } from './mailer.js';

test('sin destinatarios válidos no envía', async () => {
  assert.deepEqual(await sendEmail({ to: 'hola', subject: 'Aviso' }), {
    sent: false,
    reason: 'no-recipients',
  });
});

test('sin API key deja el correo en logs', async () => {
  const previous = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  try {
    assert.equal(isMailerConfigured(), false);
    const result = await sendEmail({
      to: 'ops@zentofact.local',
      subject: 'Aviso',
      text: 'cuerpo',
    });
    assert.deepEqual(result, { sent: false, logged: true });
  } finally {
    if (previous === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previous;
  }
});

test('con API key llama a Resend', async () => {
  const previous = process.env.RESEND_API_KEY;
  const originalFetch = globalThis.fetch;
  const calls = [];
  process.env.RESEND_API_KEY = 're_test';
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, text: async () => '' };
  };
  try {
    assert.equal(isMailerConfigured(), true);
    const result = await sendEmail({
      to: ['ops@zentofact.local', 'invalido'],
      subject: 'Aviso',
      html: '<p>cuerpo</p>',
      text: 'cuerpo',
    });
    assert.deepEqual(result, { sent: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.resend.com/emails');
    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(body.to, ['ops@zentofact.local']);
    assert.equal(body.subject, 'Aviso');
    assert.equal(body.text, 'cuerpo');
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previous;
  }
});

test('un error de Resend no se silencia', async () => {
  const previous = process.env.RESEND_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.RESEND_API_KEY = 're_test';
  globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => 'unauthorized' });
  try {
    await assert.rejects(
      () => sendEmail({ to: 'ops@zentofact.local', subject: 'Aviso' }),
      /No se pudo enviar el correo/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previous;
  }
});
