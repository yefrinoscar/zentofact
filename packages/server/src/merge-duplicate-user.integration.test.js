import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import { consolidateDuplicateUser } from './merge-duplicate-user.js';

const connectionString = process.env.DATABASE_URL_POSTGRES || process.env.MERGE_TEST_DATABASE_URL;
const skipMsg = !connectionString && 'define DATABASE_URL_POSTGRES para ejecutar la integración';

const KEEP = { id: 'keep-admin', email: 'jcalfarosanchez@gmail.com' };
const DUP = { id: 'dup-seller', email: 'jcalfarosanchz@gmail.com' };

function schemaDDL({ userRoles = true } = {}) {
  return `
    CREATE TABLE "user" (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT,
      permissions TEXT,
      active BOOLEAN DEFAULT true,
      "createdAt" TIMESTAMPTZ DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ DEFAULT NOW()
    );
    ${userRoles ? `
    CREATE TABLE user_roles (
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      permissions TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, role)
    );` : ''}
    CREATE TABLE user_audit_log (
      id BIGSERIAL PRIMARY KEY,
      actor_id TEXT,
      target_id TEXT,
      action TEXT NOT NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
    );
    CREATE TABLE account (
      id TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      "providerId" TEXT,
      password TEXT,
      issuer TEXT
    );
    CREATE TABLE orders (
      id BIGSERIAL PRIMARY KEY,
      created_by TEXT,
      external_order_id TEXT,
      order_status TEXT DEFAULT 'confirmed',
      total NUMERIC(14,2),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE order_events (
      id BIGSERIAL PRIMARY KEY,
      order_id BIGINT,
      actor_user_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE operator_notifications (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT
    );
    CREATE TABLE operator_notification_state (
      user_id TEXT NOT NULL,
      notification_id BIGINT,
      PRIMARY KEY (user_id, notification_id)
    );
    CREATE TABLE products (id BIGSERIAL PRIMARY KEY, main_sku TEXT, created_by TEXT, updated_by TEXT);
    CREATE TABLE insumos (id BIGSERIAL PRIMARY KEY, created_by TEXT, updated_by TEXT);
    CREATE TABLE insumo_movements (id BIGSERIAL PRIMARY KEY, actor_user_id TEXT);
    CREATE TABLE inventory_movements (id BIGSERIAL PRIMARY KEY, actor_user_id TEXT);
    CREATE TABLE inventory_transfers (id BIGSERIAL PRIMARY KEY, actor_user_id TEXT NOT NULL);
    CREATE TABLE product_return_incidents (id BIGSERIAL PRIMARY KEY, actor_user_id TEXT);
    CREATE TABLE system_settings (key TEXT PRIMARY KEY, updated_by TEXT);
  `;
}

async function withDisposableDb(fn, { setup } = {}) {
  const admin = new Pool({ connectionString, max: 1 });
  const name = `merge_user_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await admin.query(`CREATE DATABASE ${name}`);
  const isolated = new Pool({ connectionString: connectionString.replace(/\/[^/]+$/, `/${name}`), max: 2 });
  try {
    await isolated.query(schemaDDL(setup || {}));
    return await fn(isolated);
  } finally {
    await isolated.end();
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin.end();
  }
}

async function seedScenario(pool, { keepRole = 'admin' } = {}) {
  await pool.query(`
    INSERT INTO "user" (id, name, email, role, permissions, active) VALUES
      ($1, 'Julio Alfaro', $2, $3, '[]', true),
      ($4, 'Julio Alfar', $5, 'vendedor', '["salesperson"]', true)`,
  [KEEP.id, KEEP.email, keepRole, DUP.id, DUP.email]);
  await pool.query(`
    INSERT INTO user_roles (user_id, role, permissions) VALUES
      ($1, $2, '[]'),
      ($3, 'vendedor', '["salesperson"]')`,
  [KEEP.id, keepRole, DUP.id]);
  await pool.query(`
    INSERT INTO account (id, "userId", "providerId", password, issuer) VALUES
      ('acc-keep', $1, 'credential', 'hash-keep', 'local:credential'),
      ('acc-dup', $2, 'credential', 'hash-dup', 'local:credential')`,
  [KEEP.id, DUP.id]);
  await pool.query(`
    INSERT INTO session (id, "userId") VALUES ('sess-keep', $1), ('sess-dup', $2)`,
  [KEEP.id, DUP.id]);
  await pool.query(`
    INSERT INTO orders (created_by, external_order_id, order_status, total, updated_at) VALUES
      ($1, '2610058697', 'confirmed', 150.00, TIMESTAMPTZ '2026-10-05 10:00:00+00'),
      ($1, '2610051534', 'delivered', 90.50, TIMESTAMPTZ '2026-10-05 11:00:00+00')`,
  [DUP.id]);
  await pool.query(`
    INSERT INTO order_events (order_id, actor_user_id) VALUES (1, 'operator-x'), (1, $1)`,
  [DUP.id]);
  await pool.query(`INSERT INTO operator_notifications (user_id, title) VALUES ($1, 'Hola')`, [DUP.id]);
  await pool.query(`INSERT INTO operator_notification_state (user_id, notification_id) VALUES ($1, 1)`, [DUP.id]);
  await pool.query(`INSERT INTO products (main_sku, created_by, updated_by) VALUES ('AG301', $1, $1)`, [DUP.id]);
  await pool.query(`INSERT INTO insumos (created_by, updated_by) VALUES ($1, $1)`, [DUP.id]);
  await pool.query(`INSERT INTO insumo_movements (actor_user_id) VALUES ($1)`, [DUP.id]);
  await pool.query(`INSERT INTO inventory_movements (actor_user_id) VALUES ($1)`, [DUP.id]);
  await pool.query(`INSERT INTO inventory_transfers (actor_user_id) VALUES ($1)`, [DUP.id]);
  await pool.query(`INSERT INTO product_return_incidents (actor_user_id) VALUES ($1)`, [DUP.id]);
  await pool.query(`INSERT INTO system_settings (key, updated_by) VALUES ('auto_emit', $1)`, [DUP.id]);
  await pool.query(`
    INSERT INTO user_audit_log (actor_id, target_id, action, details)
    VALUES ($1, $1, 'user.update', '{}'::jsonb)`, [DUP.id]);
}

async function countAudit(pool) {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM user_audit_log`);
  return Number(rows[0].n);
}

test('dry-run no persiste cambios y reporta el plan', { skip: skipMsg }, async () => {
  await withDisposableDb(async (pool) => {
    await seedScenario(pool);
    const auditBefore = await countAudit(pool);

    const result = await consolidateDuplicateUser({ database: pool, keep: KEEP, duplicate: DUP, apply: false });

    assert.equal(result.mode, 'dry-run');
    assert.equal(result.applied, false);
    assert.equal(result.orders.count, 2);

    const dup = await pool.query(`SELECT active FROM "user" WHERE id = $1`, [DUP.id]);
    assert.equal(dup.rows.length, 1, 'dry-run no debe borrar la cuenta duplicada');
    const dupOrders = await pool.query(`SELECT count(*)::int AS n FROM orders WHERE created_by = $1`, [DUP.id]);
    assert.equal(Number(dupOrders.rows[0].n), 2, 'dry-run no debe mover ventas');
    const keepSeller = await pool.query(`SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'vendedor'`, [KEEP.id]);
    assert.equal(keepSeller.rows.length, 0, 'dry-run no debe agregar vendedor');
    assert.equal(await countAudit(pool), auditBefore, 'dry-run no debe auditar');
  });
});

test('apply consolida ventas, agrega vendedor y borra la cuenta duplicada', { skip: skipMsg }, async () => {
  await withDisposableDb(async (pool) => {
    await seedScenario(pool);

    const result = await consolidateDuplicateUser({ database: pool, keep: KEEP, duplicate: DUP, apply: true });
    assert.equal(result.mode, 'apply');
    assert.equal(result.applied, true);
    assert.equal(result.orders.count, 2);
    assert.deepEqual(result.orders.moved.map((o) => o.externalOrderId).sort(), ['2610051534', '2610058697']);

    const dup = await pool.query(`SELECT 1 FROM "user" WHERE id = $1`, [DUP.id]);
    assert.equal(dup.rows.length, 0, 'la cuenta duplicada debe eliminarse');
    const dupAccount = await pool.query(`SELECT 1 FROM account WHERE "userId" = $1`, [DUP.id]);
    assert.equal(dupAccount.rows.length, 0, 'las credenciales de la cuenta duplicada se eliminan');
    const dupSession = await pool.query(`SELECT 1 FROM session WHERE "userId" = $1`, [DUP.id]);
    assert.equal(dupSession.rows.length, 0, 'las sesiones de la cuenta duplicada se eliminan');

    const keep = await pool.query(`SELECT role, active, email FROM "user" WHERE id = $1`, [KEEP.id]);
    assert.equal(keep.rows[0].role, 'admin', 'user.role admin se conserva');
    assert.equal(keep.rows[0].active, true);
    const keepRoles = await pool.query(`SELECT role FROM user_roles WHERE user_id = $1 ORDER BY role`, [KEEP.id]);
    assert.deepEqual(keepRoles.rows.map((r) => r.role), ['admin', 'vendedor']);

    const keepPassword = await pool.query(`SELECT password FROM account WHERE "userId" = $1`, [KEEP.id]);
    assert.equal(keepPassword.rows[0].password, 'hash-keep', 'la contraseña conservada no se toca');

    const moved = await pool.query(`
      SELECT created_by, external_order_id, order_status, total, updated_at
        FROM orders ORDER BY external_order_id`);
    assert.deepEqual(moved.rows.map((r) => r.created_by), [KEEP.id, KEEP.id]);
    assert.deepEqual(moved.rows.map((r) => r.order_status), ['delivered', 'confirmed']);
    const totals = moved.rows.map((r) => Number(r.total));
    assert.deepEqual(totals, [90.5, 150]);
    const updatedAt = await pool.query(`SELECT updated_at FROM orders WHERE external_order_id='2610058697'`);
    assert.equal(updatedAt.rows[0].updated_at.toISOString(), '2026-10-05T10:00:00.000Z', 'no se toca updated_at');

    const events = await pool.query(`SELECT actor_user_id FROM order_events ORDER BY id`);
    assert.deepEqual(events.rows.map((r) => r.actor_user_id), ['operator-x', DUP.id], 'order_events históricos se preservan');
    const audit = await pool.query(`
      SELECT action, target_id, details FROM user_audit_log WHERE action = 'user.merge'`);
    assert.equal(audit.rows.length, 1);
    assert.equal(audit.rows[0].target_id, KEEP.id);
    assert.equal(audit.rows[0].details.source, DUP.id);
    assert.equal(audit.rows[0].details.target, KEEP.id);
    assert.deepEqual(audit.rows[0].details.orders.externalOrderIds.sort(), ['2610051534', '2610058697']);
    assert.equal(audit.rows[0].details.deleted, true);
    assert.equal(JSON.stringify(audit.rows[0].details).includes('hash-'), false, 'la auditoría no filtra credenciales');

    const preserved = await pool.query(`SELECT created_by, updated_by FROM products`);
    assert.deepEqual(preserved.rows[0], { created_by: DUP.id, updated_by: DUP.id });
    const notifications = await pool.query(`SELECT count(*)::int AS n FROM operator_notifications`);
    assert.equal(Number(notifications.rows[0].n), 0, 'notificaciones personales se eliminan');
    const historicalAudit = await pool.query(`SELECT count(*)::int AS n FROM user_audit_log WHERE actor_id = $1`, [DUP.id]);
    assert.equal(Number(historicalAudit.rows[0].n), 1, 'auditoría histórica se preserva');

    const { listActiveSalespeople } = await import('./users.js');
    const sellers = await listActiveSalespeople(pool);
    const ids = sellers.map((s) => s.id);
    assert.ok(ids.includes(KEEP.id), 'admin+vendedor aparece como vendedor activo');
    assert.ok(!ids.includes(DUP.id), 'la cuenta duplicada ya no aparece');
  });
});

test('rerun es no-op y no duplica auditoría', { skip: skipMsg }, async () => {
  await withDisposableDb(async (pool) => {
    await seedScenario(pool);
    await consolidateDuplicateUser({ database: pool, keep: KEEP, duplicate: DUP, apply: true });
    const auditAfterFirst = await countAudit(pool);

    const second = await consolidateDuplicateUser({ database: pool, keep: KEEP, duplicate: DUP, apply: true });
    assert.equal(second.convergent, true);
    assert.equal(second.applied, false);
    assert.equal(second.orders.count, 0);
    assert.equal(await countAudit(pool), auditAfterFirst, 'no se duplica la auditoría');
  });
});

test('fallo a mitad de transacción revierte todo', { skip: skipMsg }, async () => {
  await withDisposableDb(async (pool) => {
    await seedScenario(pool);
    await pool.query(`
      CREATE FUNCTION fail_merge() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'boom'; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_merge_trg BEFORE UPDATE ON orders
        FOR EACH ROW WHEN (OLD.created_by IS DISTINCT FROM NEW.created_by)
        EXECUTE FUNCTION fail_merge();
    `);
    const auditBefore = await countAudit(pool);

    await assert.rejects(
      () => consolidateDuplicateUser({ database: pool, keep: KEEP, duplicate: DUP, apply: true }),
      /boom/,
    );

    const dup = await pool.query(`SELECT active FROM "user" WHERE id = $1`, [DUP.id]);
    assert.equal(dup.rows.length, 1, 'la cuenta duplicada sigue existiendo tras el rollback');
    const keepSeller = await pool.query(`SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'vendedor'`, [KEEP.id]);
    assert.equal(keepSeller.rows.length, 0, 'el vendedor agregado se revierte');
    const dupOrders = await pool.query(`SELECT count(*)::int AS n FROM orders WHERE created_by = $1`, [DUP.id]);
    assert.equal(Number(dupOrders.rows[0].n), 2, 'las ventas no se mueven');
    assert.equal(await countAudit(pool), auditBefore, 'no se deja auditoría a medias');
  });
});

test('aborta si user_roles no existe (esquema monoperfil)', { skip: skipMsg }, async () => {
  await withDisposableDb(async (pool) => {
    await pool.query(`
      INSERT INTO "user" (id, name, email, role, permissions, active)
      VALUES ($1, 'Julio', $2, 'admin', '[]', true), ($3, 'Duplicado', $4, 'vendedor', '[]', true)`,
    [KEEP.id, KEEP.email, DUP.id, DUP.email]);
    await assert.rejects(
      () => consolidateDuplicateUser({ database: pool, keep: KEEP, duplicate: DUP, apply: true }),
      /user_roles no existe/,
    );
    const dup = await pool.query(`SELECT 1 FROM "user" WHERE id = $1`, [DUP.id]);
    assert.equal(dup.rows.length, 1, 'no se toca nada sin user_roles');
  }, { setup: { userRoles: false } });
});

test('aborta con referencia blanda sin política explícita', { skip: skipMsg }, async () => {
  await withDisposableDb(async (pool) => {
    await seedScenario(pool);
    await pool.query(`CREATE TABLE custom_refs (id BIGSERIAL PRIMARY KEY, created_by TEXT)`);
    await pool.query(`INSERT INTO custom_refs (created_by) VALUES ($1)`, [DUP.id]);

    await assert.rejects(
      () => consolidateDuplicateUser({ database: pool, keep: KEEP, duplicate: DUP, apply: true }),
      /sin política explícita/,
    );
    const dup = await pool.query(`SELECT 1 FROM "user" WHERE id = $1`, [DUP.id]);
    assert.equal(dup.rows.length, 1, 'no se borra la cuenta ante una referencia desconocida');
  });
});

test('conserva los perfiles y grants existentes de la cuenta admin+vendedor', { skip: skipMsg }, async () => {
  await withDisposableDb(async (pool) => {
    await seedScenario(pool);
    await pool.query(`INSERT INTO user_roles (user_id, role, permissions) VALUES ($1, 'operator', '["orders_inbox"]')`, [KEEP.id]);
    await pool.query(`INSERT INTO user_roles (user_id, role, permissions) VALUES ($1, 'vendedor', '["salesperson"]')`, [KEEP.id]);

    const result = await consolidateDuplicateUser({ database: pool, keep: KEEP, duplicate: DUP, apply: true });
    assert.equal(result.keep.rolesAfter.includes('operator'), true);
    const roles = await pool.query(`SELECT role, permissions FROM user_roles WHERE user_id = $1 ORDER BY role`, [KEEP.id]);
    assert.deepEqual(roles.rows.map((r) => r.role), ['admin', 'operator', 'vendedor']);
    assert.equal(roles.rows.find((r) => r.role === 'operator').permissions, '["orders_inbox"]', 'los grants del perfil existente no se tocan');
  });
});

test('aborta si la cuenta duplicada no es vendedor o tiene perfiles extra', { skip: skipMsg }, async () => {
  await withDisposableDb(async (pool) => {
    await seedScenario(pool);
    await pool.query(`UPDATE user_roles SET role = 'operator' WHERE user_id = $1`, [DUP.id]);
    await assert.rejects(
      () => consolidateDuplicateUser({ database: pool, keep: KEEP, duplicate: DUP, apply: true }),
      /perfil vendedor/,
    );

    await pool.query(`UPDATE user_roles SET role = 'vendedor' WHERE user_id = $1`, [DUP.id]);
    await pool.query(`INSERT INTO user_roles (user_id, role, permissions) VALUES ($1, 'billing', '[]')`, [DUP.id]);
    await assert.rejects(
      () => consolidateDuplicateUser({ database: pool, keep: KEEP, duplicate: DUP, apply: true }),
      /perfiles adicionales/,
    );
  });
});

test('listActiveSalespeople incluye admin+vendedor y no infiere por permiso', { skip: skipMsg }, async () => {
  await withDisposableDb(async (pool) => {
    await pool.query(`
      INSERT INTO "user" (id, name, email, role, permissions, active) VALUES
        ('u-admin', 'Solo Admin', 'a@x.test', 'admin', '[]', true),
        ('u-admin-seller', 'Admin Vendedor', 'as@x.test', 'admin', '[]', true),
        ('u-legacy-seller', 'Vendedor Legacy', 'vs@x.test', 'vendedor', '["salesperson"]', true),
        ('u-perm-only', 'Permiso Suelto', 'po@x.test', 'operator', '["salesperson"]', true),
        ('u-off', 'Vendedor Inactivo', 'off@x.test', 'vendedor', '[]', false)`);
    await pool.query(`
      INSERT INTO user_roles (user_id, role, permissions) VALUES
        ('u-admin', 'admin', '[]'),
        ('u-admin-seller', 'admin', '[]'),
        ('u-admin-seller', 'vendedor', '["salesperson"]'),
        ('u-perm-only', 'operator', '["salesperson"]'),
        ('u-off', 'vendedor', '["salesperson"]')`);

    const { listActiveSalespeople } = await import('./users.js');
    const ids = (await listActiveSalespeople(pool)).map((s) => s.id).sort();
    assert.deepEqual(ids, ['u-admin-seller', 'u-legacy-seller']);
  });
});
