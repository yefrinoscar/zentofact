import test from 'node:test';
import assert from 'node:assert/strict';
import { originMatchesRequestHost, requireAnyPermission, requirePermission } from './auth.js';

function context(user, method = 'GET') {
  return {
    req: { method },
    get(key) { return key === 'user' ? user : undefined; },
    json(body, status) { return { body, status }; },
  };
}

test('requireAnyPermission permite continuar con cualquiera de los permisos', async () => {
  const guard = requireAnyPermission(['boletas', 'credit_notes_bulk']);
  const user = { role: 'operator', active: true, permissions: ['credit_notes_bulk'] };
  let continued = false;

  await guard(context(user), async () => { continued = true; });

  assert.equal(continued, true);
});

test('requireAnyPermission rechaza usuarios sin ninguno de los permisos', async () => {
  const guard = requireAnyPermission(['boletas', 'credit_notes_bulk']);
  const user = { role: 'operator', active: true, permissions: ['dashboard'] };

  assert.deepEqual(await guard(context(user), async () => {}), {
    body: { error: 'Sin permiso' },
    status: 403,
  });
});

test('los guards conservan el bloqueo de métodos unsafe para viewer', async () => {
  const user = { role: 'viewer', active: true, permissions: ['boletas', 'credit_notes_bulk'] };

  for (const guard of [
    requirePermission('boletas'),
    requireAnyPermission(['boletas', 'credit_notes_bulk']),
  ]) {
    assert.deepEqual(await guard(context(user, 'POST'), async () => {}), {
      body: { error: 'Perfil de solo lectura' },
      status: 403,
    });
  }
});

test('el origen CSRF coincide con el host de la petición o el forwarded host', () => {
  assert.equal(originMatchesRequestHost('http://localhost:3011', 'localhost:3011'), true);
  assert.equal(originMatchesRequestHost('https://preview.example', 'localhost:3011', 'preview.example'), true);
  assert.equal(originMatchesRequestHost('https://evil.example', 'localhost:3011'), false);
  assert.equal(originMatchesRequestHost('', 'localhost:3011'), false);
});

test('requireAnyPermission exige una lista no vacía', () => {
  assert.throws(() => requireAnyPermission([]), /al menos un permiso/);
  assert.throws(() => requireAnyPermission('boletas'), /al menos un permiso/);
});
