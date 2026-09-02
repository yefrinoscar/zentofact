import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FAILED_EMISSION_ALERT_AFTER_ATTEMPTS,
  buildFailedEmissionAlertEmail,
  notifyFailedEmissionIfNeeded,
  parseAlertEmails,
  resolveFailedEmissionAlertRecipients,
  shouldSendFailedEmissionAlert,
} from './auto-emission-alert.js';
import { ROLE_PRESETS } from './permissions.js';

const invoiceJob = {
  id: 41,
  kind: 'invoice',
  attempts: FAILED_EMISSION_ALERT_AFTER_ATTEMPTS,
  orderNumber: 'PV-10001',
  companyName: 'LIMBO',
  last_error: 'SUNAT timeout',
  status: 'pending',
};

const billing = {
  email: 'billing@preview.zentofact.local',
  role: 'billing',
  active: true,
  permissions: ROLE_PRESETS.billing.permissions,
};
const operator = {
  email: 'operator@preview.zentofact.local',
  role: 'operator',
  active: true,
  permissions: ROLE_PRESETS.operator.permissions,
};
const admin = {
  email: 'admin@zentofact.local',
  role: 'admin',
  active: true,
  permissions: ROLE_PRESETS.admin.permissions,
};

test('avisa a partir del tercer intento de un comprobante', () => {
  assert.equal(shouldSendFailedEmissionAlert({ kind: 'invoice', attempts: 2 }), false);
  assert.equal(shouldSendFailedEmissionAlert({ kind: 'invoice', attempts: 3 }), true);
  assert.equal(shouldSendFailedEmissionAlert({ kind: 'invoice', attempts: 6 }), true);
});

test('no reenvía el aviso si ya se mandó', () => {
  assert.equal(shouldSendFailedEmissionAlert({
    kind: 'invoice',
    attempts: 3,
    alerted_at: '2026-09-02T12:00:00Z',
  }), false);
});

test('una nota de crédito no dispara el aviso de boleta', () => {
  assert.equal(shouldSendFailedEmissionAlert({ kind: 'credit_note', attempts: 4 }), false);
});

test('parsea la lista de correos de alerta', () => {
  assert.deepEqual(
    parseAlertEmails('ops@zentofact.local, Facturacion@zentofact.local ; ops@zentofact.local'),
    ['ops@zentofact.local', 'facturacion@zentofact.local'],
  );
});

test('avisa a facturación y al buzón extra; el operador no recibe', () => {
  assert.deepEqual(
    resolveFailedEmissionAlertRecipients({
      users: [operator, billing, admin, { ...billing, active: false, email: 'old@zentofact.local' }],
      extraEmails: 'ops@zentofact.local',
      fallbackEmail: 'fallback@zentofact.local',
    }),
    ['ops@zentofact.local', 'billing@preview.zentofact.local', 'admin@zentofact.local'],
  );
});

test('sin usuarios de boletas usa el correo de respaldo', () => {
  assert.deepEqual(
    resolveFailedEmissionAlertRecipients({
      users: [operator],
      fallbackEmail: 'admin@zentofact.local',
    }),
    ['admin@zentofact.local'],
  );
});

test('el correo nombra el pedido, los intentos y el error', () => {
  const email = buildFailedEmissionAlertEmail(invoiceJob);
  assert.equal(email.subject, 'Comprobante no emitido · pedido PV-10001');
  assert.match(email.text, /PV-10001/);
  assert.match(email.text, /LIMBO/);
  assert.match(email.text, /3 intentos/);
  assert.match(email.text, /SUNAT timeout/);
  assert.match(email.text, /Sigue en cola/);
});

test('un job de Postgres (order_number) nombra el pedido en el correo', () => {
  const email = buildFailedEmissionAlertEmail({
    kind: 'invoice',
    attempts: 3,
    order_number: 'PV-ALERT-25',
    company: 'LIMBO',
    last_error: 'SUNAT timeout',
    status: 'pending',
  });
  assert.equal(email.subject, 'Comprobante no emitido · pedido PV-ALERT-25');
  assert.match(email.text, /PV-ALERT-25/);
});

test('el error del correo no incluye HTML crudo', () => {
  const email = buildFailedEmissionAlertEmail({
    ...invoiceJob,
    last_error: '<script>alert(1)</script>',
  });
  assert.match(email.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(email.html, /<script>/);
});

test('si el job ya falló, el correo pide revisar y reintentar', () => {
  const email = buildFailedEmissionAlertEmail({ ...invoiceJob, attempts: 6, status: 'failed' });
  assert.match(email.text, /quedó fallido/);
  assert.match(email.text, /Revisa Automatización y reintenta/);
});

test('envía una sola vez y marca el job como avisado', async () => {
  const sent = [];
  const marked = [];
  const result = await notifyFailedEmissionIfNeeded(invoiceJob, {
    listUsers: async () => [billing],
    extraEmails: '',
    fallbackEmail: 'admin@zentofact.local',
    sendEmail: async (payload) => {
      sent.push(payload);
      return { sent: true };
    },
    markAlerted: async (job) => { marked.push(job.id); },
  });
  assert.equal(result.notified, true);
  assert.deepEqual(result.to, ['billing@preview.zentofact.local']);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, ['billing@preview.zentofact.local']);
  assert.equal(sent[0].subject, 'Comprobante no emitido · pedido PV-10001');
  assert.deepEqual(marked, [41]);
});

test('si Resend no está configurado, el log cuenta como aviso y no se reenvía', async () => {
  const marked = [];
  const result = await notifyFailedEmissionIfNeeded(invoiceJob, {
    listUsers: async () => [billing],
    sendEmail: async () => ({ sent: false, logged: true }),
    markAlerted: async (job) => { marked.push(job.id); },
  });
  assert.equal(result.notified, true);
  assert.equal(result.logged, true);
  assert.deepEqual(marked, [41]);
});

test('sin destinatarios no marca el job', async () => {
  const marked = [];
  const result = await notifyFailedEmissionIfNeeded(invoiceJob, {
    listUsers: async () => [operator],
    sendEmail: async () => ({ sent: true }),
    markAlerted: async (job) => { marked.push(job.id); },
  });
  assert.equal(result.notified, false);
  assert.equal(result.reason, 'no-recipients');
  assert.deepEqual(marked, []);
});

test('un job de dos intentos no llama al correo', async () => {
  let called = false;
  const result = await notifyFailedEmissionIfNeeded({ ...invoiceJob, attempts: 2 }, {
    sendEmail: async () => {
      called = true;
      return { sent: true };
    },
  });
  assert.equal(result.skipped, true);
  assert.equal(called, false);
});
