// Administración de usuarios de Better Auth con Drizzle, jerarquía y auditoría.
import { randomBytes } from 'crypto';
import { db, pool } from '@zentofact/core';
import { asc, and, count, eq, ilike, inArray, sql } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import {
  ALL_PERMISSION_KEYS,
  ROLE_PRESETS,
  isAdminRole,
  isSuperadminRole,
  normalizePermissions,
  normalizeRole,
  permissionsForRole,
  roleRank,
  userHasPermission,
} from './permissions.js';
import { authAccounts, authSessions, authUsers, LOCAL_CREDENTIAL_ISSUER, userAuditLog } from './db-schema.js';
import { toPublicUserError } from './user-errors.js';

const PASSWORD_MIN_LENGTH = 12;
const USER_ADMIN_LOCK = 917204;

function newId() {
  return randomBytes(24).toString('base64url');
}

function parsePermissions(raw, role) {
  return normalizePermissions(raw, role);
}

function isActive(value) {
  return value !== false && value !== 'f' && value !== 0 && value !== 'false';
}

function serializeUser(row) {
  if (!row) return null;
  const role = normalizeRole(row.role);
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role,
    permissions: parsePermissions(row.permissions, role),
    active: isActive(row.active),
    commissionPercent: Number(row.commissionPercent ?? 0) || 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeRequestedRole(role, fallback = 'operator') {
  if (role == null) return normalizeRole(fallback);
  const value = String(role).trim();
  if (!ROLE_PRESETS[value]) throw new Error('Rol inválido');
  return value;
}

function normalizeRequestedPermissions(input, role, fallback) {
  if (isAdminRole(role)) return [...ALL_PERMISSION_KEYS];
  if (normalizeRole(role) === 'vendedor') return permissionsForRole(role);
  return normalizePermissions(input != null ? input : fallback, role)
    .filter((key) => key !== 'users' && key !== 'dashboard' && key !== 'pagos');
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
  if (!actor || !actor.active || !isAdminRole(actor.role)) {
    throw new Error('Solo un administrador puede gestionar usuarios');
  }
}

function assertCanAssignRole(actor, targetRole) {
  requireAdminActor(actor);
  if (!isSuperadminRole(actor.role) && roleRank(targetRole) >= roleRank('admin')) {
    throw new Error('Solo un superadministrador puede crear o promover administradores');
  }
}

function assertCanManageTarget(actor, target, nextRole, patch) {
  requireAdminActor(actor);
  if (actor.id === target.id) {
    const keys = Object.keys(patch || {});
    if (keys.every((key) => key === 'name')) return;
    throw new Error('No puedes cambiar tus propios privilegios, estado o contraseña desde esta pantalla');
  }
  if (isSuperadminRole(actor.role)) return;
  if (roleRank(target.role) >= roleRank('admin') || roleRank(nextRole) >= roleRank('admin')) {
    throw new Error('Solo un superadministrador puede administrar cuentas administrativas');
  }
}

async function getUserByIdWith(database, id) {
  const rows = await database
    .select()
    .from(authUsers)
    .where(eq(authUsers.id, id))
    .limit(1);
  return serializeUser(rows[0]);
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

async function assertAdminInvariants(tx, current, nextRole, nextActive) {
  const losesSuperadmin = isSuperadminRole(current.role) && (!isSuperadminRole(nextRole) || !nextActive);
  if (losesSuperadmin) {
    const [row] = await tx
      .select({ n: count() })
      .from(authUsers)
      .where(and(eq(authUsers.active, true), eq(authUsers.role, 'superadmin')));
    if (Number(row?.n || 0) < 2) throw new Error('Debe existir al menos un superadministrador activo');
  }

  const losesAdmin = isAdminRole(current.role) && (!isAdminRole(nextRole) || !nextActive);
  if (losesAdmin) {
    const [row] = await tx
      .select({ n: count() })
      .from(authUsers)
      .where(and(eq(authUsers.active, true), inArray(authUsers.role, ['admin', 'superadmin'])));
    if (Number(row?.n || 0) < 2) throw new Error('Debe existir al menos un administrador activo');
  }
}

export async function ensureAuthSchema() {
  // Better Auth crea "user"/session/account; sin esto un Postgres vacío
  // (p. ej. Railway PR preview) rompe el boot en ensureUserColumns.
  const { ensureAuthSchema: migrateAuthSchema } = await import('./ensure-auth-schema.js');
  await migrateAuthSchema();
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
  const rows = await db.select().from(authUsers).orderBy(asc(authUsers.createdAt));
  return rows.map(serializeUser);
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
    if (!isSuperadminRole(current.role)) {
      await tx
        .update(authUsers)
        .set({ role: 'superadmin', permissions: JSON.stringify(ALL_PERMISSION_KEYS), updatedAt: new Date() })
        .where(eq(authUsers.id, current.id));
      await addAudit(tx, {
        actorId,
        targetId: current.id,
        action: 'superadmin.bootstrap',
        details: { source: actorId ? 'system' : 'seed' },
      });
    }
    return { id: current.id, changed: !isSuperadminRole(current.role) };
  });
}

export async function createUser({ name, email, password, role = 'operator', permissions, active = true, commissionPercent }, actorId) {
  const actor = await getUserById(actorId);
  const cleanEmail = validateEmail(email);
  const cleanName = String(name || '').trim() || cleanEmail.split('@')[0];
  if (!cleanName) throw new Error('Nombre requerido');
  validatePassword(password);

  const roleKey = normalizeRequestedRole(role);
  assertCanAssignRole(actor, roleKey);
  const perms = normalizeRequestedPermissions(permissions, roleKey, permissionsForRole(roleKey));
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
      role: roleKey,
      permissions: JSON.stringify(perms),
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
    await addAudit(tx, { actorId, targetId: userId, action: 'user.create', details: { role: roleKey, active: !!active } });
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

    const role = normalizeRequestedRole(patch.role, current.role);
    assertCanManageTarget(actor, current, role, patch);
    const name = patch.name != null ? String(patch.name).trim() : current.name;
    if (!name) throw new Error('Nombre requerido');
    const permissionFallback = patch.role != null && role !== current.role
      ? permissionsForRole(role)
      : current.permissions;
    const permissions = normalizeRequestedPermissions(patch.permissions, role, permissionFallback);
    const active = patch.active != null ? !!patch.active : current.active;
    const commissionPercent = patch.commissionPercent != null
      ? normalizeCommissionPercent(patch.commissionPercent)
      : Number(current.commissionPercent || 0);
    const passwordChanged = patch.password != null && String(patch.password) !== '';
    if (passwordChanged) validatePassword(patch.password);

    await assertAdminInvariants(tx, current, role, active);
    await tx
      .update(authUsers)
      .set({
        name,
        role,
        permissions: JSON.stringify(permissions),
        active,
        commissionPercent: String(commissionPercent),
        updatedAt: new Date(),
      })
      .where(eq(authUsers.id, id));

    if (passwordChanged) {
      await tx
        .update(authAccounts)
        .set({ password: await hashPassword(String(patch.password)), updatedAt: new Date() })
        .where(and(eq(authAccounts.userId, id), eq(authAccounts.providerId, 'credential')));
    }

    const privilegesChanged = current.role !== role || JSON.stringify(current.permissions) !== JSON.stringify(permissions);
    const sessionsRevoked = passwordChanged || !active || privilegesChanged;
    if (sessionsRevoked) await tx.delete(authSessions).where(eq(authSessions.userId, id));
    await addAudit(tx, {
      actorId,
      targetId: id,
      action: passwordChanged ? 'user.update_with_password_reset' : 'user.update',
      details: { fromRole: current.role, toRole: role, active, sessionsRevoked },
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
    assertCanManageTarget(actor, current, current.role, {});
    await assertAdminInvariants(tx, current, 'viewer', false);
    await tx.delete(authSessions).where(eq(authSessions.userId, id));
    await tx.delete(authAccounts).where(eq(authAccounts.userId, id));
    await tx.delete(authUsers).where(eq(authUsers.id, id));
    await addAudit(tx, { actorId, targetId: id, action: 'user.delete', details: { role: current.role } });
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
