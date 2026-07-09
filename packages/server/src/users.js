// Administración de usuarios de Better Auth + campos de rol/permisos.
import { randomBytes } from 'crypto';
import { Pool } from 'pg';
import { hashPassword } from 'better-auth/crypto';
import {
  ALL_PERMISSION_KEYS,
  ROLE_PRESETS,
  normalizePermissions,
  permissionsForRole,
  userHasPermission,
} from './permissions.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL_POSTGRES });

function newId() {
  return randomBytes(24).toString('base64url');
}

function parsePermissions(raw, role) {
  return normalizePermissions(raw, role);
}

function serializeUser(row) {
  if (!row) return null;
  const role = row.role || 'operator';
  const permissions = parsePermissions(row.permissions, role);
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role,
    permissions,
    active: row.active !== false && row.active !== 'f' && row.active !== 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function ensureUserColumns() {
  await pool.query(`
    ALTER TABLE "user" ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'operator';
    ALTER TABLE "user" ADD COLUMN IF NOT EXISTS permissions TEXT DEFAULT '[]';
    ALTER TABLE "user" ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;
  `);
  // Si no hay ningún admin activo, promover al usuario más antiguo.
  const admins = await pool.query(
    `SELECT id FROM "user" WHERE role = 'admin' AND COALESCE(active, true) = true LIMIT 1`,
  );
  if (!admins.rows.length) {
    await pool.query(
      `UPDATE "user"
       SET role = 'admin', permissions = $1, active = true, "updatedAt" = NOW()
       WHERE id = (SELECT id FROM "user" ORDER BY "createdAt" ASC LIMIT 1)`,
      [JSON.stringify(ALL_PERMISSION_KEYS)],
    );
  }
}

export async function listUsers() {
  const { rows } = await pool.query(`
    SELECT id, name, email, role, permissions, active, "createdAt", "updatedAt"
    FROM "user"
    ORDER BY "createdAt" ASC
  `);
  return rows.map(serializeUser);
}

export async function getUserById(id) {
  const { rows } = await pool.query(
    `SELECT id, name, email, role, permissions, active, "createdAt", "updatedAt" FROM "user" WHERE id = $1`,
    [id],
  );
  return serializeUser(rows[0]);
}

export async function createUser({ name, email, password, role = 'operator', permissions, active = true }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanName = String(name || '').trim() || cleanEmail.split('@')[0];
  if (!cleanEmail || !password) throw new Error('Email y contraseña son requeridos');
  if (String(password).length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres');

  const roleKey = ROLE_PRESETS[role] ? role : 'operator';
  const perms = roleKey === 'admin'
    ? [...ALL_PERMISSION_KEYS]
    : (permissions != null ? normalizePermissions(permissions, roleKey) : permissionsForRole(roleKey));

  const existing = await pool.query(`SELECT id FROM "user" WHERE lower(email) = $1`, [cleanEmail]);
  if (existing.rows[0]) throw new Error('Ya existe un usuario con ese correo');

  const userId = newId();
  const accountId = newId();
  const now = new Date();
  const hashed = await hashPassword(String(password));

  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", image, "createdAt", "updatedAt", role, permissions, active)
       VALUES ($1, $2, $3, false, null, $4, $4, $5, $6, $7)`,
      [userId, cleanName, cleanEmail, now, roleKey, JSON.stringify(perms), !!active],
    );
    await client.query(
      `INSERT INTO account (
         id, "accountId", "providerId", "userId", password,
         "accessToken", "refreshToken", "idToken",
         "accessTokenExpiresAt", "refreshTokenExpiresAt", scope,
         "createdAt", "updatedAt"
       ) VALUES ($1, $2, 'credential', $3, $4, null, null, null, null, null, null, $5, $5)`,
      [accountId, userId, userId, hashed, now],
    );
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }

  return getUserById(userId);
}

export async function updateUser(id, patch = {}) {
  const current = await getUserById(id);
  if (!current) throw new Error('Usuario no encontrado');

  const name = patch.name != null ? String(patch.name).trim() : current.name;
  const role = patch.role != null
    ? (ROLE_PRESETS[patch.role] ? patch.role : current.role)
    : current.role;
  const permissions = patch.permissions != null
    ? normalizePermissions(patch.permissions, role)
    : (role === 'admin' ? [...ALL_PERMISSION_KEYS] : current.permissions);
  const active = patch.active != null ? !!patch.active : current.active;

  // No dejar el sistema sin un admin activo.
  if (current.role === 'admin' && (role !== 'admin' || !active)) {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM "user" WHERE role = 'admin' AND active = true AND id <> $1`,
      [id],
    );
    if ((rows[0]?.n || 0) < 1) {
      throw new Error('Debe existir al menos un administrador activo');
    }
  }

  await pool.query(
    `UPDATE "user"
     SET name = $2, role = $3, permissions = $4, active = $5, "updatedAt" = $6
     WHERE id = $1`,
    [id, name, role, JSON.stringify(role === 'admin' ? ALL_PERMISSION_KEYS : permissions), active, new Date()],
  );

  if (patch.password) {
    if (String(patch.password).length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres');
    const hashed = await hashPassword(String(patch.password));
    await pool.query(
      `UPDATE account SET password = $2, "updatedAt" = $3
       WHERE "userId" = $1 AND "providerId" = 'credential'`,
      [id, hashed, new Date()],
    );
  }

  return getUserById(id);
}

export async function deleteUser(id, actorId) {
  if (id === actorId) throw new Error('No puedes eliminar tu propia cuenta');
  const current = await getUserById(id);
  if (!current) throw new Error('Usuario no encontrado');
  if (current.role === 'admin') {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM "user" WHERE role = 'admin' AND active = true AND id <> $1`,
      [id],
    );
    if ((rows[0]?.n || 0) < 1) throw new Error('No se puede eliminar el último administrador');
  }
  await pool.query(`DELETE FROM "user" WHERE id = $1`, [id]);
  return { ok: true };
}

export function requirePermission(key) {
  return async (c, next) => {
    const user = c.get('user');
    if (!userHasPermission(user, key)) {
      return c.json({ error: 'Sin permiso para esta acción' }, 403);
    }
    return next();
  };
}

export { ROLE_PRESETS, ALL_PERMISSION_KEYS, userHasPermission };
