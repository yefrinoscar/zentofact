import test from 'node:test';
import assert from 'node:assert/strict';
import { requireAnyPermission, requirePermission } from './auth.js';

function context(user, method = 'GET') {
  return {
    req: { method },
    get(key) { return key === 'user' ? user : undefined; },
    json(body, status) { return { body, status }; },
  };
}

test('requireAnyPermission permite continuar con cualquiera de los permisos', async () => {
  const guard = requireAnyPermission(['documentos', 'credit_notes']);
  const user = { role: 'operator', active: true, permissions: ['credit_notes'] };
  let continued = false;

  await guard(context(user), async () => { continued = true; });

  assert.equal(continued, true);
});

test('requireAnyPermission rechaza usuarios sin ninguno de los permisos', async () => {
  const guard = requireAnyPermission(['documentos', 'credit_notes']);
  const user = { role: 'operator', active: true, permissions: ['dashboard'] };

  assert.deepEqual(await guard(context(user), async () => {}), {
    body: { error: 'Sin permiso' },
    status: 403,
  });
});

test('los guards conservan el bloqueo de métodos unsafe para viewer', async () => {
  const user = { role: 'viewer', active: true, permissions: ['documentos', 'credit_notes'] };

  for (const guard of [
    requirePermission('documentos'),
    requireAnyPermission(['documentos', 'credit_notes']),
  ]) {
    assert.deepEqual(await guard(context(user, 'POST'), async () => {}), {
      body: { error: 'Perfil de solo lectura' },
      status: 403,
    });
  }
});

test('requireAnyPermission exige una lista no vacía', () => {
  assert.throws(() => requireAnyPermission([]), /al menos un permiso/);
  assert.throws(() => requireAnyPermission('documentos'), /al menos un permiso/);
});
