import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import { ROLE_PRESETS } from './permissions.js';

const connectionString = process.env.DATABASE_URL_POSTGRES;
const skipMsg = !connectionString && 'define DATABASE_URL_POSTGRES para ejecutar la integración';

function userTableDDL() {
  return `
    CREATE TABLE "user" (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      "emailVerified" BOOLEAN NOT NULL DEFAULT false,
      image TEXT,
      role TEXT DEFAULT 'operator',
      permissions TEXT DEFAULT '[]',
      active BOOLEAN DEFAULT true,
      commission_percent NUMERIC(5,2) DEFAULT 0,
      "createdAt" TIMESTAMPTZ,
      "updatedAt" TIMESTAMPTZ
    )
  `;
}

test('migración: user_roles backfillea solo usuarios sin filas y es idempotente', {
  skip: skipMsg,
}, async () => {
  const { ensureUserRolesSchema, backfillUserRoles } = await import('./users.js');
  const dbName = `user_roles_${process.pid}_${Date.now()}`;
  const admin = new Pool({ connectionString, max: 1 });
  await admin.query(`CREATE DATABASE ${dbName}`);
  const isolated = new Pool({ connectionString: connectionString.replace(/\/[^/]+$/, `/${dbName}`), max: 1 });
  try {
    await isolated.query(userTableDDL());
    await isolated.query(`
      INSERT INTO "user" (id, name, email, role, permissions, active) VALUES
        ('u-admin', 'Admin', 'admin@x.test', 'admin', '[]', true),
        ('u-operator', 'Operador', 'op@x.test', 'operator', '[]', true),
        ('u-vendedor', 'Vendedor', 'v@x.test', 'vendedor', '[]', true),
        ('u-custom', 'Custom', 'custom@x.test', 'operator',
          '["order_management","boletas"]', true),
        ('u-inactivo', 'Inactivo', 'off@x.test', 'vendedor', '[]', false)
    `);

    await ensureUserRolesSchema(isolated);
    const first = await backfillUserRoles(isolated);
    assert.equal(first.inserted, 5);

    const rows = await isolated.query('SELECT user_id, role, permissions FROM user_roles ORDER BY user_id');
    const byUser = new Map(rows.rows.map((r) => [r.user_id, r]));
    assert.deepEqual(byUser.get('u-admin').role, 'admin');
    assert.deepEqual(JSON.parse(byUser.get('u-admin').permissions).length > 0, true);
    // La lista personalizada del perfil original se conserva en el backfill.
    assert.deepEqual(JSON.parse(byUser.get('u-custom').permissions).sort(), ['boletas', 'order_management']);
    // El vendedor conserva su preset.
    assert.deepEqual(JSON.parse(byUser.get('u-vendedor').permissions), ['salesperson']);
    // Usuarios inactivos también se migran para no perder su configuración.
    assert.equal(byUser.has('u-inactivo'), true);

    // Idempotente: una segunda pasada no reinserta nada.
    const second = await backfillUserRoles(isolated);
    assert.equal(second.inserted, 0);

    // Retirar un perfil (borrar una fila) no hace que el backfill lo reintroduzca:
    // el usuario ya está migrado y su propia fila restante lo protege.
    await isolated.query(`INSERT INTO user_roles (user_id, role, permissions, created_at)
                          VALUES ('u-operator', 'billing', '[]', NOW())
                          ON CONFLICT DO NOTHING`);
    await isolated.query(`DELETE FROM user_roles WHERE user_id = 'u-operator' AND role = 'billing'`);
    const third = await backfillUserRoles(isolated);
    assert.equal(third.inserted, 0);

    // Un usuario nuevo (sin filas en user_roles) sí se migra en la próxima pasada.
    await isolated.query(`
      INSERT INTO "user" (id, name, email, role, permissions, active)
      VALUES ('u-nueva', 'Nueva', 'nueva@x.test', 'billing', '[]', true)
    `);
    const fourth = await backfillUserRoles(isolated);
    assert.equal(fourth.inserted, 1);
    const billingRole = await isolated.query(
      `SELECT role, permissions FROM user_roles WHERE user_id = 'u-nueva'`,
    );
    assert.equal(billingRole.rows.length, 1);
    assert.deepEqual(JSON.parse(billingRole.rows[0].permissions), ROLE_PRESETS.billing.permissions);
  } finally {
    await isolated.end();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.end();
  }
});