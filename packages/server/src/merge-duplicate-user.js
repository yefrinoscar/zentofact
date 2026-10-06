// Mantenimiento idempotente de consolidación de cuentas duplicadas de Better Auth.
//
// Objetivo: tras el release multi-perfil, unificar una cuenta duplicada
// (vendedor) dentro de una cuenta conservada (admin), trasladar la atribución
// de ventas (`orders.created_by`) y BORRAR la cuenta duplicada en la misma
// transacción, preservando los hechos históricos (auditoría, actores de
// eventos/stock) como referencias blandas.
//
// Reglas de seguridad:
//  - Dry-run por defecto; `--apply` es opt-in explícito.
//  - La conexión se lee siempre del entorno (DATABASE_URL_POSTGRES /
//    DATABASE_URL); nunca hay credenciales embebidas.
//  - Aborta si `user_roles` no existe: el release multi-perfil primero.
//  - Aborta si la cuenta a conservar no tiene filas en `user_roles` (evita
//    quitarle el perfil admin al insertar vendedor).
//  - Aborta si una FK real hacia "user"(id) no es CASCADE/SET NULL, o si
//    aparece una referencia blanda a user.id sin política explícita.
//  - Una sola transacción con advisory lock de administración (917204) y
//    bloqueo `FOR UPDATE` de las filas de usuario.
import { config } from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { ROLE_PRESETS, isAdminRole, normalizeRole } from './permissions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, '../../..');

export const MERGE_AUDIT_ACTION = 'user.merge';

/** Política explícita por columna blanda que referencia "user"(id). */
export const USER_REFERENCE_POLICIES = [
  // Atribución comercial: sigue a la identidad consolidada.
  { table: 'orders', column: 'created_by', strategy: 'reassign' },
  // Estado personal del usuario borrado: se elimina con la cuenta.
  { table: 'user_roles', column: 'user_id', strategy: 'delete' },
  { table: 'operator_notifications', column: 'user_id', strategy: 'delete' },
  { table: 'operator_notification_state', column: 'user_id', strategy: 'delete' },
  // Hechos históricos y procedencia: NO se reescriben ni se borran.
  { table: 'user_audit_log', column: 'actor_id', strategy: 'preserve' },
  { table: 'user_audit_log', column: 'target_id', strategy: 'preserve' },
  { table: 'order_events', column: 'actor_user_id', strategy: 'preserve' },
  { table: 'inventory_movements', column: 'actor_user_id', strategy: 'preserve' },
  { table: 'inventory_transfers', column: 'actor_user_id', strategy: 'preserve' },
  { table: 'product_return_incidents', column: 'actor_user_id', strategy: 'preserve' },
  { table: 'products', column: 'created_by', strategy: 'preserve' },
  { table: 'products', column: 'updated_by', strategy: 'preserve' },
  { table: 'insumos', column: 'created_by', strategy: 'preserve' },
  { table: 'insumos', column: 'updated_by', strategy: 'preserve' },
  { table: 'insumo_movements', column: 'actor_user_id', strategy: 'preserve' },
  { table: 'system_settings', column: 'updated_by', strategy: 'preserve' },
];

/** Columnas candidatas a referenciar "user"(id) cuando no hay FK real. */
export const USER_REFERENCE_COLUMN_NAMES = [
  'user_id', 'created_by', 'updated_by', 'actor_id', 'actor_user_id',
  'target_id', 'owner_id', 'assigned_to', 'created_by_user',
];

/** Caso verificado en producción (Railway zentofact, entorno production). */
export const DUPLICATE_USER_CASES = {
  julio: {
    keep: { id: 'lv4GATBWIJ7j6dPLIEDEIL8aIcDjpD67', email: 'jcalfarosanchez@gmail.com' },
    duplicate: { id: 'z1d1D7R2qGFTVxGzkt8NcBd0PGdQ8CSi', email: 'jcalfarosanchz@gmail.com' },
  },
};

function ident(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function isActive(value) {
  return value !== false && value !== 'f' && value !== 0 && value !== 'false';
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function parsePermissions(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function policyFor(table, column) {
  return USER_REFERENCE_POLICIES.find((entry) => entry.table === table && entry.column === column) || null;
}

function roleListOf(roleRows, legacyRole) {
  const roles = [...new Set((roleRows || []).map((row) => normalizeRole(row.role)))];
  if (roles.length) return roles;
  return [normalizeRole(legacyRole)];
}

function membershipsOf(roleRows) {
  return (roleRows || []).map((row) => ({
    role: normalizeRole(row.role),
    permissions: parsePermissions(row.permissions),
  }));
}

/** Argumentos CLI del mantenimiento. Dry-run salvo `--apply`. */
export function parseMergeArgs(argv = []) {
  const options = { apply: false, help: false, case: null, keep: {}, duplicate: {} };
  const takeValue = (flag, index) => {
    const value = argv[index + 1];
    if (value === undefined || String(value).startsWith('--')) {
      throw new Error(`${flag} requiere un valor`);
    }
    return value;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--apply') options.apply = true;
    else if (token === '--dry-run') options.apply = false;
    else if (token === '--help' || token === '-h') options.help = true;
    else if (token === '--case') { options.case = takeValue(token, i); i += 1; }
    else if (token === '--keep-id') { options.keep.id = takeValue(token, i); i += 1; }
    else if (token === '--keep-email') { options.keep.email = takeValue(token, i); i += 1; }
    else if (token === '--dup-id') { options.duplicate.id = takeValue(token, i); i += 1; }
    else if (token === '--dup-email') { options.duplicate.email = takeValue(token, i); i += 1; }
    else throw new Error(`Argumento no reconocido: ${token}`);
  }

  const preset = options.case ? DUPLICATE_USER_CASES[options.case] : null;
  if (options.case && !preset) throw new Error(`Caso desconocido: ${options.case}`);
  const keep = { id: options.keep.id || preset?.keep.id, email: options.keep.email || preset?.keep.email };
  const duplicate = {
    id: options.duplicate.id || preset?.duplicate.id,
    email: options.duplicate.email || preset?.duplicate.email,
  };
  if (options.help) return { help: true, apply: options.apply, keep, duplicate };

  const missing = [];
  if (!keep.id) missing.push('--keep-id');
  if (!keep.email) missing.push('--keep-email');
  if (!duplicate.id) missing.push('--dup-id');
  if (!duplicate.email) missing.push('--dup-email');
  if (missing.length) {
    throw new Error(`Faltan argumentos: ${missing.join(', ')} (o usa --case <nombre>)`);
  }
  return { help: false, apply: options.apply, keep, duplicate };
}

async function discoverForeignKeyConstraints(client) {
  const { rows } = await client.query(`
    SELECT tc.table_name, kcu.column_name, rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
     WHERE tc.constraint_type = 'FOREIGN KEY'
       AND ccu.table_name = 'user' AND ccu.column_name = 'id'
     ORDER BY tc.table_name, kcu.column_name
  `);
  return rows.map((row) => ({
    table: row.table_name,
    column: row.column_name,
    onDelete: String(row.delete_rule || '').toUpperCase(),
  }));
}

async function discoverSoftReferences(client) {
  const { rows } = await client.query(`
    SELECT table_name, column_name
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name <> 'user'
       AND column_name = ANY($1::text[])
     ORDER BY table_name, column_name
  `, [USER_REFERENCE_COLUMN_NAMES]);
  return rows;
}

async function countReferences(client, table, column, userId) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM ${ident(table)} WHERE ${ident(column)} = $1`,
    [userId],
  );
  return Number(rows[0]?.n || 0);
}

async function loadRoleRows(client, userId) {
  const { rows } = await client.query(
    `SELECT role, permissions FROM user_roles WHERE user_id = $1 ORDER BY role`,
    [userId],
  );
  return rows;
}

function assertIdentity({ keep, duplicate, keepRow, keepRoles, dupRow, dupRoles }) {
  if (!keepRow) throw new Error(`La cuenta a conservar ${keep.id} no existe`);
  if (normalizeEmail(keepRow.email) !== normalizeEmail(keep.email)) {
    throw new Error(`El correo de la cuenta a conservar no coincide con el esperado para ${keep.id}`);
  }
  if (!isActive(keepRow.active)) throw new Error('La cuenta a conservar está inactiva');
  if (!keepRoles.length) {
    throw new Error('La cuenta a conservar no tiene filas en user_roles (migración multi-perfil incompleta). Ejecuta el release/backfill antes de consolidar.');
  }
  if (!keepRoles.some((role) => isAdminRole(role))) {
    throw new Error('La cuenta a conservar debe pertenecer a admin o superadmin');
  }

  if (!dupRow) return;
  if (normalizeEmail(dupRow.email) !== normalizeEmail(duplicate.email)) {
    throw new Error(`El correo de la cuenta duplicada no coincide con el esperado para ${duplicate.id}`);
  }
  if (dupRoles.some((role) => isAdminRole(role))) {
    throw new Error('La cuenta duplicada tiene perfil administrativo; no se consolida automáticamente');
  }
  const isVendedor = dupRoles.includes('vendedor');
  if (!isVendedor) throw new Error('La cuenta duplicada debe pertenecer al perfil vendedor');
  const extra = dupRoles.filter((role) => role !== 'vendedor');
  if (extra.length) {
    throw new Error(`La cuenta duplicada tiene perfiles adicionales (${extra.join(', ')}); revísalos antes de borrar`);
  }
}

async function collectReferences(client, duplicateId) {
  const soft = await discoverSoftReferences(client);
  const references = [];
  for (const { table_name: table, column_name: column } of soft) {
    const count = await countReferences(client, table, column, duplicateId);
    const policy = policyFor(table, column);
    if (count > 0 && !policy) {
      throw new Error(`Referencia a user.id sin política explícita: ${table}.${column} (${count} filas). Se aborta sin tocar la cuenta.`);
    }
    if (count > 0) {
      references.push({ table, column, count, strategy: policy.strategy });
    }
  }
  return references;
}

/**
 * Consolida la cuenta duplicada dentro de la conservada y la elimina.
 * Ejecuta toda la operación dentro de una transacción; en dry-run revierte
 * al final para validar exactamente el plan sin persistir cambios.
 */
export async function consolidateDuplicateUser({
  database,
  keep,
  duplicate,
  apply = false,
  now = new Date(),
  log = () => {},
} = {}) {
  if (!database) throw new Error('database requerido (Pool de pg)');
  if (!keep?.id || !duplicate?.id) throw new Error('keep.id y duplicate.id son obligatorios');
  if (keep.id === duplicate.id) throw new Error('La cuenta a conservar y la duplicada no pueden ser la misma');

  const { listActiveSalespeople, USER_ADMIN_LOCK } = await import('./users.js');

  const client = await database.connect();
  let result = null;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [USER_ADMIN_LOCK]);

    const schema = await client.query(
      `SELECT to_regclass('public.user_roles') AS user_roles`,
    );
    if (!schema.rows[0]?.user_roles) {
      throw new Error('user_roles no existe: despliega el release multi-perfil antes de consolidar. Abortado sin cambios.');
    }

    const fks = await discoverForeignKeyConstraints(client);
    const blocking = fks.filter((fk) => !['CASCADE', 'SET NULL'].includes(fk.onDelete));
    if (blocking.length) {
      throw new Error(`FK(s) que impiden borrar la cuenta: ${blocking.map((fk) => `${fk.table}.${fk.column} (${fk.onDelete})`).join(', ')}`);
    }

    const usersRes = await client.query(
      `SELECT id, name, email, role, permissions, active FROM "user"
        WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE`,
      [[keep.id, duplicate.id]],
    );
    const keepRow = usersRes.rows.find((row) => row.id === keep.id) || null;
    const dupRow = usersRes.rows.find((row) => row.id === duplicate.id) || null;

    const keepRoleRows = await loadRoleRows(client, keep.id);
    const keepRoles = roleListOf(keepRoleRows, keepRow?.role);
    const dupRoleRows = dupRow ? await loadRoleRows(client, duplicate.id) : [];
    const dupRoles = dupRow ? roleListOf(dupRoleRows, dupRow.role) : [];

    assertIdentity({ keep, duplicate, keepRow, keepRoles, dupRow, dupRoles });

    // Reintento idempotente: la cuenta ya fue consolidada y borrada antes.
    if (!dupRow) {
      const prior = await client.query(
        `SELECT id FROM user_audit_log
          WHERE action = $1 AND details->>'source' = $2 AND details->>'target' = $3
          LIMIT 1`,
        [MERGE_AUDIT_ACTION, duplicate.id, keep.id],
      );
      if (!prior.rows.length) {
        throw new Error(`La cuenta duplicada ${duplicate.id} no existe y no hay auditoría de consolidación previa; verifica los ids.`);
      }
      const leftovers = await countReferences(client, 'orders', 'created_by', duplicate.id);
      if (leftovers > 0) throw new Error(`La cuenta ${duplicate.id} no existe pero aún tiene ${leftovers} ventas atribuidas`);
      if (!keepRoles.includes('vendedor')) {
        throw new Error('La cuenta conservada no tiene el perfil vendedor; la consolidación previa está incompleta');
      }
      await client.query('COMMIT');
      log({ event: 'user.merge.already_applied', source: duplicate.id, target: keep.id });
      return {
        mode: apply ? 'apply' : 'dry-run',
        applied: false,
        convergent: true,
        keep: { id: keep.id, email: keepRow.email, rolesBefore: keepRoles, rolesAfter: keepRoles },
        duplicate: { id: duplicate.id, email: duplicate.email, rolesBefore: [], rolesAfter: [], deleted: true },
        orders: { moved: [], count: 0 },
        sessionsRevoked: { keep: 0, duplicate: 0 },
        accountDeleted: 0,
        rolesDeleted: 0,
        notificationsDeleted: 0,
        references: [],
        foreignKeys: fks,
        auditId: null,
      };
    }

    const references = await collectReferences(client, duplicate.id);
    const orders = await client.query(
      `SELECT id, external_order_id FROM orders WHERE created_by = $1 ORDER BY id`,
      [duplicate.id],
    );
    const orderRows = orders.rows.map((row) => ({ id: row.id, externalOrderId: row.external_order_id }));

    const grantsChanged = !keepRoles.includes('vendedor');

    // ── Mutaciones (se revierten en dry-run) ───────────────────────────────
    if (grantsChanged) {
      await client.query(
        `INSERT INTO user_roles (user_id, role, permissions, created_at)
         VALUES ($1, 'vendedor', $2, $3)
         ON CONFLICT (user_id, role) DO NOTHING`,
        [keep.id, JSON.stringify(ROLE_PRESETS.vendedor.permissions), now],
      );
    }

    for (const reference of references) {
      if (reference.strategy === 'reassign') {
        await client.query(
          `UPDATE ${ident(reference.table)} SET ${ident(reference.column)} = $1 WHERE ${ident(reference.column)} = $2`,
          [keep.id, duplicate.id],
        );
      } else if (reference.strategy === 'delete') {
        await client.query(
          `DELETE FROM ${ident(reference.table)} WHERE ${ident(reference.column)} = $1`,
          [duplicate.id],
        );
      }
    }

    const sessionsDup = await client.query(`DELETE FROM session WHERE "userId" = $1`, [duplicate.id]);
    await client.query(`DELETE FROM account WHERE "userId" = $1`, [duplicate.id]);
    const deletedUser = await client.query(`DELETE FROM "user" WHERE id = $1`, [duplicate.id]);
    if ((deletedUser.rowCount || 0) !== 1) {
      throw new Error(`No se pudo borrar la cuenta duplicada ${duplicate.id}`);
    }

    let sessionsKeep = 0;
    if (grantsChanged) {
      const revoked = await client.query(`DELETE FROM session WHERE "userId" = $1`, [keep.id]);
      sessionsKeep = revoked.rowCount || 0;
    }

    const audit = await client.query(
      `INSERT INTO user_audit_log (actor_id, target_id, action, details, created_at)
       VALUES (NULL, $1, $2, $3::jsonb, $4) RETURNING id`,
      [keep.id, MERGE_AUDIT_ACTION, JSON.stringify({
        source: duplicate.id,
        target: keep.id,
        sourceEmail: duplicate.email,
        targetEmail: keep.email,
        deleted: true,
        orders: { ids: orderRows.map((o) => o.id), externalOrderIds: orderRows.map((o) => o.externalOrderId) },
        membershipsBefore: {
          keep: membershipsOf(keepRoleRows),
          duplicate: membershipsOf(dupRoleRows),
        },
        membershipsAfter: { keep: [...keepRoles, ...(grantsChanged ? ['vendedor'] : [])], duplicate: [] },
        sessionsRevoked: { keep: sessionsKeep, duplicate: sessionsDup.rowCount || 0 },
        references,
        foreignKeys: fks,
      }), now],
    );

    // ── Validación dentro de la transacción ────────────────────────────────
    const afterDup = await client.query(`SELECT 1 FROM "user" WHERE id = $1`, [duplicate.id]);
    if (afterDup.rows.length) throw new Error('La cuenta duplicada sigue existiendo tras el borrado');

    const afterRoles = (await loadRoleRows(client, keep.id)).map((row) => normalizeRole(row.role));
    if (!afterRoles.includes('vendedor')) throw new Error('La cuenta conservada no quedó con perfil vendedor');
    if (!afterRoles.some((role) => isAdminRole(role))) throw new Error('La cuenta conservada perdió el perfil admin/superadmin');

    const dupOrdersLeft = await countReferences(client, 'orders', 'created_by', duplicate.id);
    if (dupOrdersLeft !== 0) throw new Error(`Quedaron ${dupOrdersLeft} ventas atribuidas a la cuenta duplicada`);

    if (orderRows.length) {
      const moved = await client.query(
        `SELECT count(*)::int AS n FROM orders WHERE id = ANY($1::bigint[]) AND created_by = $2`,
        [orderRows.map((o) => o.id), keep.id],
      );
      if (Number(moved.rows[0]?.n || 0) !== orderRows.length) {
        throw new Error('No se trasladaron todas las ventas a la cuenta conservada');
      }
    }

    const salespeople = await listActiveSalespeople(client);
    const salespeopleIds = salespeople.map((entry) => entry.id);
    if (!salespeopleIds.includes(keep.id)) throw new Error('listActiveSalespeople no incluye la cuenta conservada con vendedor');
    if (salespeopleIds.includes(duplicate.id)) throw new Error('listActiveSalespeople todavía incluye la cuenta duplicada');

    if (apply) await client.query('COMMIT');
    else await client.query('ROLLBACK');

    result = {
      mode: apply ? 'apply' : 'dry-run',
      applied: apply,
      convergent: false,
      keep: { id: keep.id, email: keepRow.email, rolesBefore: keepRoles, rolesAfter: afterRoles },
      duplicate: { id: duplicate.id, email: duplicate.email, rolesBefore: dupRoles, rolesAfter: [], deleted: true },
      orders: { moved: orderRows, count: orderRows.length },
      sessionsRevoked: { keep: sessionsKeep, duplicate: sessionsDup.rowCount || 0 },
      accountDeleted: dupRow ? 1 : 0,
      rolesDeleted: dupRoleRows.length,
      notificationsDeleted: references
        .filter((ref) => ref.strategy === 'delete' && ref.table !== 'user_roles')
        .reduce((sum, ref) => sum + ref.count, 0),
      references,
      foreignKeys: fks,
      auditId: audit.rows[0]?.id ?? null,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  if (result?.applied) {
    const salespeople = await listActiveSalespeople(database);
    const salespeopleIds = salespeople.map((entry) => entry.id);
    if (!salespeopleIds.includes(keep.id)) throw new Error('Postread: listActiveSalespeople no incluye la cuenta conservada');
    if (salespeopleIds.includes(duplicate.id)) throw new Error('Postread: listActiveSalespeople todavía incluye la cuenta duplicada');
  }
  return result;
}

function usage() {
  return [
    'Uso: node packages/server/src/merge-duplicate-user.js [opciones]',
    '',
    '  --case julio            Carga ids/emails verificados (prod) y permite sobrescribirlos.',
    '  --keep-id <id>          Cuenta que se conserva (admin/superadmin).',
    '  --keep-email <email>    Email esperado de la cuenta conservada.',
    '  --dup-id <id>           Cuenta duplicada (vendedor) que se elimina.',
    '  --dup-email <email>     Email esperado de la cuenta duplicada.',
    '  --apply                 Ejecuta y confirma la transacción. Por defecto dry-run.',
    '  --dry-run               Fuerza dry-run (revertir).',
    '  --help                  Muestra esta ayuda.',
    '',
    'DATABASE_URL_POSTGRES (o DATABASE_URL no sqlite) debe venir del entorno.',
    'El release multi-perfil (user_roles) debe estar desplegado antes de ejecutar.',
  ].join('\n');
}

async function main() {
  config({ path: resolve(appRoot, '.env') });
  const options = parseMergeArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const connectionString = process.env.DATABASE_URL_POSTGRES
    || (process.env.DATABASE_URL && !process.env.DATABASE_URL.startsWith('sqlite:') ? process.env.DATABASE_URL : undefined);
  if (!connectionString) {
    throw new Error('Falta DATABASE_URL_POSTGRES (o DATABASE_URL no sqlite) en el entorno. No se aceptan credenciales embebidas.');
  }
  const { Pool } = await import('pg');
  const database = new Pool({ connectionString, max: 2 });
  const parsed = new URL(connectionString);
  console.log(JSON.stringify({
    event: options.apply ? 'user.merge.start' : 'user.merge.dry_run_start',
    mode: options.apply ? 'apply' : 'dry-run',
    host: parsed.hostname,
    database: parsed.pathname.replace(/^\//, ''),
    keepId: options.keep.id,
    duplicateId: options.duplicate.id,
  }));
  try {
    const result = await consolidateDuplicateUser({
      database,
      keep: options.keep,
      duplicate: options.duplicate,
      apply: options.apply,
      log: (entry) => console.log(JSON.stringify(entry)),
    });
    console.log(JSON.stringify({ event: 'user.merge.done', ...result }));
  } finally {
    await database.end();
  }
}

const isCli = process.argv[1] && String(process.argv[1]).endsWith('merge-duplicate-user.js');
if (isCli) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
}
