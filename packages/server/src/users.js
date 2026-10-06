// Administración de usuarios de Better Auth con Drizzle, jerarquía y auditoría.
import { randomBytes } from 'crypto';
import { db, pool } from '@zentofact/core';
import { asc, and, eq, ilike, sql } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import {
  ALL_PERMISSION_KEYS,
  ROLE_PRESETS,
  explicitPermissions,
  isAdminRole,
  isAdminUser,
  isSuperadminRole,
  isSuperadminUser,
  normalizePermissions,
  normalizeRole,
  parsePermissionInput,
  permissionsForRole,
  permissionsForUser,
  primaryRoleOf,
  roleRank,
  userHasPermission,
} from './permissions.js';
import { authAccounts, authSessions, authUsers, LOCAL_CREDENTIAL_ISSUER, userAuditLog, userRoles } from './db-schema.js';
import { toPublicUserError } from './user-errors.js';

const PASSWORD_MIN_LENGTH = 12;
/** Advisory lock de administración de usuarios; compartido por el mantenimiento de consolidación. */
export const USER_ADMIN_LOCK = 917204;

function newId() {
  return randomBytes(24).toString('base64url');
}

function isActive(value) {
  return value !== false && value !== 'f' && value !== 0 && value !== 'false';
}

function validRole(value) {
  const clean = String(value || '').trim();
  return ROLE_PRESETS[clean] ? clean : null;
}

function groupRoleRows(rows) {
  const byUser = new Map();
  for (const row of rows || []) {
    if (!row?.userId) continue;
    if (!byUser.has(row.userId)) byUser.set(row.userId, []);
    byUser.get(row.userId).push(row);
  }
  return byUser;
}

/**
 * Serializa un usuario con sus pertenencias. `role` y `permissions` se
 * conservan como compatibilidad; `roles`/`rolePermissions` describen cada
 * asignación y `permissions` queda como la unión efectiva.
 */
function serializeUser(row, roleRows = []) {
  if (!row) return null;
  const role = normalizeRole(row.role);
  const roles = [];
  const rolePermissions = {};
  for (const entry of roleRows || []) {
    const key = validRole(entry?.role);
    if (!key || roles.includes(key)) continue;
    roles.push(key);
    if (entry.permissions != null) {
      rolePermissions[key] = parsePermissionInput(entry.permissions);
    }
  }
  if (!roles.length) roles.push(role);
  if (!Object.prototype.hasOwnProperty.call(rolePermissions, role)) {
    rolePermissions[role] = normalizePermissions(row.permissions, role);
  }
  const access = { role, permissions: row.permissions, roles, rolePermissions };
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role,
    roles,
    rolePermissions,
    permissions: permissionsForUser(access),
    active: isActive(row.active),
    commissionPercent: Number(row.commissionPercent ?? 0) || 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeRequestedRoles(roles, fallbackRole, fallbackList) {
  const source = roles != null
    ? (Array.isArray(roles) ? roles : [roles])
    : (fallbackRole != null ? [fallbackRole] : (fallbackList || []));
  const list = [];
  for (const value of source) {
    const role = validRole(value);
    if (!role) throw new Error('Rol inválido');
    if (!list.includes(role)) list.push(role);
  }
  if (!list.length) throw new Error('Elige al menos un perfil');
  return list;
}

function resolveAssignmentPermissions(role, provided) {
  const normalizedRole = normalizeRole(role);
  if (isAdminRole(normalizedRole)) return [...ALL_PERMISSION_KEYS];
  if (normalizedRole === 'vendedor') return [...ROLE_PRESETS.vendedor.permissions];
  if (provided === undefined || provided === null) return permissionsForRole(normalizedRole);
  return explicitPermissions(provided, normalizedRole);
}

/**
 * Deriva la lista de pertenencias, el perfil principal y los permisos de cada
 * asignación. `role` sigue siendo el alias legacy del perfil principal y
 * `permissions` aplica solo a ese perfil principal.
 */
function buildRoleAssignments(input = {}, current = null) {
  const requestedRole = validRole(input.role);
  const list = normalizeRequestedRoles(input.roles, input.role, current?.roles);
  const primary = requestedRole && list.includes(requestedRole)
    ? requestedRole
    : (current && list.includes(current.role) ? current.role : primaryRoleOf(list));
  const rolePermissions = input.rolePermissions && typeof input.rolePermissions === 'object'
    ? input.rolePermissions
    : null;
  const map = {};
  for (const role of list) {
    let provided;
    if (rolePermissions && Object.prototype.hasOwnProperty.call(rolePermissions, role)) {
      provided = rolePermissions[role];
    } else if (role === primary && input.permissions !== undefined) {
      provided = input.permissions;
    } else if (current?.rolePermissions && Object.prototype.hasOwnProperty.call(current.rolePermissions, role)) {
      provided = current.rolePermissions[role];
    }
    map[role] = resolveAssignmentPermissions(role, provided);
  }
  return { roles: list, primary, map };
}

function normalizeCommissionPercent(value, fallback = 0) {
  if (value == null || value === '') return Number(fallback) || 0;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100) {
    throw new Error('La comisión debe estar entre 0 y 100');
  }
  return Math.round(amount * 100) / 100;
}

function validatePassword(password) {
  if (String(password || '').length < PASSWORD_MIN_LENGTH) {
    throw new Error(`La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`);
  }
}

function validateEmail(email) {
  const clean = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error('Correo inválido');
  return clean;
}

function requireAdminActor(actor) {
  if (!actor || !actor.active || !isAdminUser(actor)) {
    throw new Error('Solo un administrador puede gestionar usuarios');
  }
}

function assertCanAssignRole(actor, targetRole) {
  requireAdminActor(actor);
  if (!isSuperadminUser(actor) && roleRank(targetRole) >= roleRank('admin')) {
    throw new Error('Solo un superadministrador puede crear o promover administradores');
  }
}

function assertCanManageTarget(actor, target, nextPrimary, patch) {
  requireAdminActor(actor);
  if (actor.id === target.id) {
    const keys = Object.keys(patch || {});
    if (keys.every((key) => key === 'name')) return;
    throw new Error('No puedes cambiar tus propios privilegios, estado o contraseña desde esta pantalla');
  }
  if (isSuperadminUser(actor)) return;
  if (isAdminUser(target) || isAdminRole(nextPrimary)) {
    throw new Error('Solo un superadministrador puede administrar cuentas administrativas');
  }
}

async function listRoleRows(database, userId = null) {
  if (userId != null) {
    const rows = await database.select().from(userRoles).where(eq(userRoles.userId, userId));
    return { byUser: groupRoleRows(rows), rows };
  }
  const rows = await database.select().from(userRoles);
  return { byUser: groupRoleRows(rows), rows };
}

async function replaceUserRoles(tx, userId, roles, map, now = new Date()) {
  await tx.delete(userRoles).where(eq(userRoles.userId, userId));
  for (const role of roles) {
    await tx.insert(userRoles).values({
      userId,
      role,
      permissions: JSON.stringify(map[role] || []),
      createdAt: now,
    });
  }
}

async function getUserByIdWith(database, id) {
  const rows = await database
    .select()
    .from(authUsers)
    .where(eq(authUsers.id, id))
    .limit(1);
  if (!rows[0]) return null;
  const { rows: roleRows } = await listRoleRows(database, id);
  return serializeUser(rows[0], roleRows);
}

async function addAudit(tx, { actorId = null, targetId = null, action, details = {} }) {
  await tx.insert(userAuditLog).values({
    actorId,
    targetId,
    action,
    details,
    createdAt: new Date(),
  });
}

async function lockAdministration(tx) {
  // PostgreSQL advisory lock: serializa cambios sobre administradores.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${USER_ADMIN_LOCK})`);
}

async function countActiveAdministrators(tx, superadminOnly = false) {
  // Cuenta usuarios distintos con pertenencia admin/superadmin; el rol legacy
  // de `user` solo cuenta para usuarios todavía no migrados a user_roles.
  const rolesSql = superadminOnly ? "'superadmin'" : "'admin', 'superadmin'";
  const result = await tx.execute(sql.raw(`
    SELECT count(*)::int AS n
      FROM "user" u
     WHERE u.active = true
       AND (
         EXISTS (
           SELECT 1 FROM user_roles r
           WHERE r.user_id = u.id AND r.role IN (${rolesSql})
         )
         OR (
           u.role IN (${rolesSql})
           AND NOT EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id)
         )
       )
  `));
  const rows = result?.rows || result || [];
  return Number(rows[0]?.n || 0);
}

async function assertAdminInvariants(tx, current, nextRoles, nextActive) {
  const nextAdmin = nextRoles.some((role) => isAdminRole(role));
  const nextSuperadmin = nextRoles.some((role) => isSuperadminRole(role));
  const losesSuperadmin = isSuperadminUser(current) && (!nextSuperadmin || !nextActive);
  if (losesSuperadmin) {
    const n = await countActiveAdministrators(tx, true);
    if (n < 2) throw new Error('Debe existir al menos un superadministrador activo');
  }

  const losesAdmin = isAdminUser(current) && (!nextAdmin || !nextActive);
  if (losesAdmin) {
    const n = await countActiveAdministrators(tx, false);
    if (n < 2) throw new Error('Debe existir al menos un administrador activo');
  }
}

export async function ensureAuthSchema() {
  // Better Auth crea "user"/session/account; sin esto un Postgres vacío
  // (p. ej. Railway PR preview) rompe el boot en ensureUserColumns.
  const { ensureAuthSchema: migrateAuthSchema } = await import('./ensure-auth-schema.js');
  await migrateAuthSchema();
}

/** Tabla de pertenencias multi-perfil (una fila por usuario y perfil). */
export async function ensureUserRolesSchema(database) {
  await database.query(`
    CREATE TABLE IF NOT EXISTS user_roles (
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      permissions TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, role)
    );
    CREATE INDEX IF NOT EXISTS user_roles_role_idx ON user_roles (role);
  `);
}

/**
 * Backfill idempotente: crea la pertenencia del rol actual (con sus permisos
 * efectivos normalizados) solo para usuarios sin ninguna fila en user_roles.
 * Nunca reinserta perfiles retirados al reiniciar.
 */
export async function backfillUserRoles(database) {
  const { rows } = await database.query(`
    SELECT u.id, u.role, u.permissions
      FROM "user" u
     WHERE NOT EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id)
  `);
  if (!rows.length) return { inserted: 0 };
  const client = await database.connect();
  let inserted = 0;
  try {
    await client.query('BEGIN');
    for (const row of rows) {
      const role = normalizeRole(row.role);
      const permissions = normalizePermissions(row.permissions, role);
      const result = await client.query(
        `INSERT INTO user_roles (user_id, role, permissions, created_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id, role) DO NOTHING`,
        [row.id, role, JSON.stringify(permissions)],
      );
      inserted += result.rowCount || 0;
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return { inserted };
}

export async function ensureUserColumns() {
  // DDL de compatibilidad para tablas de Better Auth; el CRUD usa Drizzle.
  // issuer MUST exist before createUser and before Better Auth 1.7 migrations.
  const { ensureAccountIssuerColumn } = await import('./ensure-auth-schema.js');
  await ensureAccountIssuerColumn(pool);
  await ensureAuthSchema();
  await pool.query(`
    ALTER TABLE "user" ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'operator';
    ALTER TABLE "user" ADD COLUMN IF NOT EXISTS permissions TEXT DEFAULT '[]';
    ALTER TABLE "user" ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;
    ALTER TABLE "user" ADD COLUMN IF NOT EXISTS commission_percent NUMERIC(5,2) DEFAULT 0;
    UPDATE "user" SET commission_percent = 0 WHERE commission_percent IS NULL;
    CREATE TABLE IF NOT EXISTS user_audit_log (
      id BIGSERIAL PRIMARY KEY,
      actor_id TEXT,
      target_id TEXT,
      action TEXT NOT NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS user_audit_log_target_created_idx ON user_audit_log (target_id, created_at DESC);
  `);
  await ensureUserRolesSchema(pool);
  await backfillUserRoles(pool);

  // Bootstrap explícito: nunca promocionar la cuenta más antigua ni reactivar usuarios.
  const bootstrapEmail = String(process.env.AUTH_SUPERADMIN_EMAIL || '').trim().toLowerCase();
  if (bootstrapEmail) {
    try {
      await promoteSuperadminByEmail(bootstrapEmail, 'system.bootstrap');
    } catch (error) {
      console.error('[AUTH] No se pudo aplicar AUTH_SUPERADMIN_EMAIL:', error?.message || error);
    }
  }
}

export async function ensureBootstrapAdmin() {
  // Solo para Postgres vacíos (p. ej. Railway PR preview): crea el primer
  // superadmin si ADMIN_EMAIL/ADMIN_PASSWORD están definidos y no hay usuarios.
  const email = String(process.env.ADMIN_EMAIL || process.env.AUTH_SUPERADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || '').trim();
  if (!email || password.length < 12) return;
  const existing = await pool.query('select count(*)::int as n from "user"');
  if (Number(existing.rows[0]?.n || 0) > 0) return;
  if (process.env.AUTH_ALLOW_SIGNUP !== 'true') {
    console.warn('[auth] ADMIN_* definidos pero AUTH_ALLOW_SIGNUP!=true; no se crea el bootstrap admin.');
    return;
  }
  try {
    const { auth } = await import('./auth.js');
    await auth.api.signUpEmail({ body: { email, password, name: 'Admin' } });
    await promoteSuperadminByEmail(email, 'system.bootstrap');
    console.log('[auth] bootstrap admin creado:', email);
  } catch (error) {
    console.error('[auth] No se pudo crear bootstrap admin:', error?.message || error);
  }
}

export async function listUsers() {
  const [rows, { rows: roleRows }] = await Promise.all([
    db.select().from(authUsers).orderBy(asc(authUsers.createdAt)),
    listRoleRows(db),
  ]);
  const byUser = groupRoleRows(roleRows);
  return rows.map((row) => serializeUser(row, byUser.get(row.id) || []));
}

export async function listActiveSalespeople(database = db) {
  // Vendedor por pertenencia al perfil vendedor; los usuarios sin filas en
  // user_roles conservan su rol legacy solo durante la transición.
  // `database` acepta el cliente Drizzle (por defecto) o un Pool/Client de `pg`
  // para reutilizar exactamente esta consulta en mantenimiento y pruebas.
  const query = `
    SELECT DISTINCT u.id, u.name
      FROM "user" u
     WHERE u.active = true
       AND (
         EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role = 'vendedor')
         OR (u.role = 'vendedor' AND NOT EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id))
       )
     ORDER BY u.name
  `;
  const result = typeof database.execute === 'function'
    ? await database.execute(sql.raw(query))
    : await database.query(query);
  const rows = result?.rows || result || [];
  return rows.map((row) => ({
    id: row.id,
    name: String(row.name || '').trim() || 'Vendedora sin nombre',
    roles: ['vendedor'],
  }));
}

export async function getUserById(id) {
  return getUserByIdWith(db, id);
}

export async function promoteSuperadminByEmail(email, actorId = null) {
  const cleanEmail = validateEmail(email);
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: authUsers.id, role: authUsers.role })
      .from(authUsers)
      .where(and(ilike(authUsers.email, cleanEmail), eq(authUsers.active, true)))
      .limit(1);
    const current = rows[0];
    if (!current) throw new Error('No existe un usuario activo con ese correo para promoverlo a superadministrador');
    const { rows: roleRows } = await listRoleRows(tx, current.id);
    const existingRoles = roleRows.map((row) => validRole(row.role)).filter(Boolean);
    const hasSuperadmin = existingRoles.includes('superadmin')
      || (!existingRoles.length && isSuperadminRole(current.role));
    if (!hasSuperadmin) {
      const now = new Date();
      if (existingRoles.length) {
        await tx
          .insert(userRoles)
          .values({
            userId: current.id,
            role: 'superadmin',
            permissions: JSON.stringify(ALL_PERMISSION_KEYS),
            createdAt: now,
          })
          .onConflictDoUpdate({
            target: [userRoles.userId, userRoles.role],
            set: { permissions: JSON.stringify(ALL_PERMISSION_KEYS) },
          });
      } else {
        // Usuario recién creado (sin filas previas): queda como superadmin puro.
        await tx.insert(userRoles).values({
          userId: current.id,
          role: 'superadmin',
          permissions: JSON.stringify(ALL_PERMISSION_KEYS),
          createdAt: now,
        });
      }
      await tx
        .update(authUsers)
        .set({ role: 'superadmin', permissions: JSON.stringify(ALL_PERMISSION_KEYS), updatedAt: now })
        .where(eq(authUsers.id, current.id));
      await addAudit(tx, {
        actorId,
        targetId: current.id,
        action: 'superadmin.bootstrap',
        details: { source: actorId ? 'system' : 'seed' },
      });
    }
    return { id: current.id, changed: !hasSuperadmin };
  });
}

export async function createUser({
  name, email, password, role = 'operator', roles, permissions, rolePermissions,
  active = true, commissionPercent,
}, actorId) {
  const actor = await getUserById(actorId);
  const cleanEmail = validateEmail(email);
  const cleanName = String(name || '').trim() || cleanEmail.split('@')[0];
  if (!cleanName) throw new Error('Nombre requerido');
  validatePassword(password);

  const { roles: roleList, primary, map } = buildRoleAssignments({ roles, role, permissions, rolePermissions });
  for (const targetRole of roleList) assertCanAssignRole(actor, targetRole);
  const commission = normalizeCommissionPercent(commissionPercent, 0);
  const userId = newId();
  const accountId = newId();
  const now = new Date();
  const hashed = await hashPassword(String(password));

  await db.transaction(async (tx) => {
    await tx.insert(authUsers).values({
      id: userId,
      name: cleanName,
      email: cleanEmail,
      emailVerified: false,
      image: null,
      role: primary,
      permissions: JSON.stringify(map[primary]),
      active: !!active,
      commissionPercent: String(commission),
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(authAccounts).values({
      id: accountId,
      accountId: userId,
      providerId: 'credential',
      issuer: LOCAL_CREDENTIAL_ISSUER,
      userId,
      password: hashed,
      createdAt: now,
      updatedAt: now,
    });
    await replaceUserRoles(tx, userId, roleList, map, now);
    await addAudit(tx, {
      actorId,
      targetId: userId,
      action: 'user.create',
      details: { roles: roleList, primary, active: !!active },
    });
  }).catch((error) => {
    throw toPublicUserError(error);
  });

  return getUserById(userId);
}

export async function updateUser(id, patch = {}, actorId) {
  await db.transaction(async (tx) => {
    await lockAdministration(tx);
    const current = await getUserByIdWith(tx, id);
    const actor = await getUserByIdWith(tx, actorId);
    if (!current) throw new Error('Usuario no encontrado');

    const { roles: nextRoles, primary, map } = buildRoleAssignments(patch, current);
    for (const targetRole of nextRoles) assertCanAssignRole(actor, targetRole);
    assertCanManageTarget(actor, current, primary, patch);
    const name = patch.name != null ? String(patch.name).trim() : current.name;
    if (!name) throw new Error('Nombre requerido');
    const active = patch.active != null ? !!patch.active : current.active;
    const commissionPercent = patch.commissionPercent != null
      ? normalizeCommissionPercent(patch.commissionPercent)
      : Number(current.commissionPercent || 0);
    const passwordChanged = patch.password != null && String(patch.password) !== '';
    if (passwordChanged) validatePassword(patch.password);

    await assertAdminInvariants(tx, current, nextRoles, active);
    await tx
      .update(authUsers)
      .set({
        name,
        role: primary,
        permissions: JSON.stringify(map[primary]),
        active,
        commissionPercent: String(commissionPercent),
        updatedAt: new Date(),
      })
      .where(eq(authUsers.id, id));
    await replaceUserRoles(tx, id, nextRoles, map);

    if (passwordChanged) {
      await tx
        .update(authAccounts)
        .set({ password: await hashPassword(String(patch.password)), updatedAt: new Date() })
        .where(and(eq(authAccounts.userId, id), eq(authAccounts.providerId, 'credential')));
    }

    const privilegesChanged = JSON.stringify(current.roles) !== JSON.stringify(nextRoles)
      || JSON.stringify(current.rolePermissions) !== JSON.stringify(map);
    const sessionsRevoked = passwordChanged || !active || privilegesChanged;
    if (sessionsRevoked) await tx.delete(authSessions).where(eq(authSessions.userId, id));
    await addAudit(tx, {
      actorId,
      targetId: id,
      action: passwordChanged ? 'user.update_with_password_reset' : 'user.update',
      details: { fromRoles: current.roles, toRoles: nextRoles, primary, active, sessionsRevoked },
    });
  });
  return getUserById(id);
}

export async function deleteUser(id, actorId) {
  if (id === actorId) throw new Error('No puedes eliminar tu propia cuenta');
  await db.transaction(async (tx) => {
    await lockAdministration(tx);
    const current = await getUserByIdWith(tx, id);
    const actor = await getUserByIdWith(tx, actorId);
    if (!current) throw new Error('Usuario no encontrado');
    assertCanManageTarget(actor, current, primaryRoleOf(current.roles), {});
    await assertAdminInvariants(tx, current, [], false);
    await tx.delete(userRoles).where(eq(userRoles.userId, id));
    await tx.delete(authSessions).where(eq(authSessions.userId, id));
    await tx.delete(authAccounts).where(eq(authAccounts.userId, id));
    await tx.delete(authUsers).where(eq(authUsers.id, id));
    await addAudit(tx, { actorId, targetId: id, action: 'user.delete', details: { roles: current.roles } });
  });
  return { ok: true };
}

/**
 * Cierra sesión en todos los dispositivos: elimina todas las filas de session
 * del usuario. Cualquier cookie residual deja de ser válida y obliga a login.
 */
export async function revokeAllSessionsForUser(userId) {
  if (!userId) throw new Error('Usuario requerido');
  let revoked = 0;
  await db.transaction(async (tx) => {
    const existing = await tx.select({ id: authSessions.id }).from(authSessions).where(eq(authSessions.userId, userId));
    revoked = existing.length;
    await tx.delete(authSessions).where(eq(authSessions.userId, userId));
    await addAudit(tx, {
      actorId: userId,
      targetId: userId,
      action: 'user.logout_all_sessions',
      details: { revoked },
    });
  });
  return { ok: true, revoked };
}

export { ROLE_PRESETS, ALL_PERMISSION_KEYS, userHasPermission, toPublicUserError };
