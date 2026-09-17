import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInsumoLowStockEmail,
  isInsumoLowStock,
  notifyInsumoLowStockIfNeeded,
  resolveInsumoLowStockRecipients,
  shouldNotifyInsumoLowStock,
} from './insumo-low-stock-alert.js';
import { ROLE_PRESETS } from './permissions.js';

const fill = {
  id: 1,
  code: 'cinta-fill',
  name: 'Fill grande',
  unit: 'rollos',
  quantityOnHand: 2,
  reorderPoint: 2,
  status: 'active',
  supplierCode: 'P06',
  lowStock: true,
};

const above = { ...fill, quantityOnHand: 8, lowStock: false };
const operator = {
  email: 'operator@preview.zentofact.local',
  role: 'operator',
  active: true,
  permissions: ROLE_PRESETS.operator.permissions,
};
const billing = {
  email: 'billing@preview.zentofact.local',
  role: 'billing',
  active: true,
  permissions: ROLE_PRESETS.billing.permissions,
};
const admin = {
  email: 'admin@zentofact.local',
  role: 'admin',
  active: true,
  permissions: ROLE_PRESETS.admin.permissions,
};

test('marca stock bajo al llegar al punto de reposición', () => {
  assert.equal(isInsumoLowStock(above), false);
  assert.equal(isInsumoLowStock(fill), true);
  assert.equal(isInsumoLowStock({ ...fill, quantityOnHand: 0 }), true);
  assert.equal(isInsumoLowStock({ ...fill, reorderPoint: null }), false);
  assert.equal(isInsumoLowStock({ ...fill, status: 'archived' }), false);
});

test('avisa solo al cruzar el mínimo, no si ya estaba bajo', () => {
  assert.equal(shouldNotifyInsumoLowStock({ previous: above, current: fill }), true);
  assert.equal(shouldNotifyInsumoLowStock({
    previous: { ...fill, quantityOnHand: 3, lowStock: false },
    current: { ...fill, quantityOnHand: 0 },
  }), true);
  assert.equal(shouldNotifyInsumoLowStock({
    previous: fill,
    current: { ...fill, quantityOnHand: 1 },
  }), false);
  assert.equal(shouldNotifyInsumoLowStock({ previous: above, current: above }), false);
  assert.equal(shouldNotifyInsumoLowStock({
    previous: fill,
    current: { ...fill, quantityOnHand: 8, lowStock: false },
  }), false);
});

test('un cambio de mínimo que deja el saldo corto también avisa', () => {
  assert.equal(shouldNotifyInsumoLowStock({
    previous: { ...above, reorderPoint: 2 },
    current: { ...above, reorderPoint: 10, lowStock: true },
  }), true);
});

test('los correos configurados son los únicos destinatarios', () => {
  assert.deepEqual(
    resolveInsumoLowStockRecipients({
      users: [operator, billing, admin],
      configuredEmails: 'compras@zentofact.local',
      fallbackEmail: 'fallback@zentofact.local',
    }),
    ['compras@zentofact.local'],
  );
});

test('sin lista configurada avisa a quien ve Insumos', () => {
  assert.deepEqual(
    resolveInsumoLowStockRecipients({
      users: [operator, billing, admin, { ...operator, active: false, email: 'old@zentofact.local' }],
      fallbackEmail: 'fallback@zentofact.local',
    }),
    ['operator@preview.zentofact.local', 'admin@zentofact.local'],
  );
});

test('sin usuarios de insumos usa el correo de respaldo', () => {
  assert.deepEqual(
    resolveInsumoLowStockRecipients({
      users: [billing],
      fallbackEmail: 'admin@zentofact.local',
    }),
    ['admin@zentofact.local'],
  );
});

test('el correo nombra el insumo, el saldo y el mínimo', () => {
  const email = buildInsumoLowStockEmail(fill);
  assert.equal(email.subject, 'Insumo por reponer · Fill grande');
  assert.match(email.text, /Fill grande se está acabando/);
  assert.match(email.text, /Saldo: 2 rollos/);
  assert.match(email.text, /Mínimo: 2 rollos/);
  assert.match(email.text, /Proveedor: P06/);
  assert.match(email.text, /Revisa Insumos/);
});

test('si el saldo es 0, el asunto dice agotado', () => {
  const email = buildInsumoLowStockEmail({ ...fill, quantityOnHand: 0 });
  assert.equal(email.subject, 'Insumo agotado · Fill grande');
  assert.match(email.text, /se acabó/);
});

test('el nombre del correo no incluye HTML crudo', () => {
  const email = buildInsumoLowStockEmail({
    ...fill,
    name: '<script>alert(1)</script>',
  });
  assert.match(email.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(email.html, /<script>/);
});

test('envía una sola vez al cruzar el mínimo', async () => {
  const sent = [];
  const result = await notifyInsumoLowStockIfNeeded({ previous: above, current: fill }, {
    listUsers: async () => [operator],
    configuredEmails: '',
    fallbackEmail: 'admin@zentofact.local',
    sendEmail: async (payload) => {
      sent.push(payload);
      return { sent: true };
    },
  });
  assert.equal(result.notified, true);
  assert.deepEqual(result.to, ['operator@preview.zentofact.local']);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, ['operator@preview.zentofact.local']);
  assert.equal(sent[0].subject, 'Insumo por reponer · Fill grande');
  assert.equal(sent[0].logLabel, 'insumos');
});

test('si Resend no está configurado, el log cuenta como aviso', async () => {
  const result = await notifyInsumoLowStockIfNeeded({ previous: above, current: fill }, {
    listUsers: async () => [operator],
    sendEmail: async () => ({ sent: false, logged: true }),
  });
  assert.equal(result.notified, true);
  assert.equal(result.logged, true);
});

test('sin destinatarios no llama al correo', async () => {
  let called = false;
  const result = await notifyInsumoLowStockIfNeeded({ previous: above, current: fill }, {
    listUsers: async () => [billing],
    sendEmail: async () => {
      called = true;
      return { sent: true };
    },
  });
  assert.equal(result.notified, false);
  assert.equal(result.reason, 'no-recipients');
  assert.equal(called, false);
});

test('si ya estaba bajo no llama al correo', async () => {
  let called = false;
  const result = await notifyInsumoLowStockIfNeeded({
    previous: fill,
    current: { ...fill, quantityOnHand: 1 },
  }, {
    sendEmail: async () => {
      called = true;
      return { sent: true };
    },
  });
  assert.equal(result.skipped, true);
  assert.equal(called, false);
});
