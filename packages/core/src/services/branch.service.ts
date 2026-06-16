import { db } from '../db';
import { branches } from '../db/schema';
import { eq, and } from 'drizzle-orm';

export interface CreateBranchInput {
  companyId: number;
  codigo: string;
  nombre: string;
  direccion?: string;
  ubigeo?: string;
  distrito?: string;
  provincia?: string;
  departamento?: string;
  telefono?: string;
  email?: string;
}

export interface UpdateBranchInput extends Partial<CreateBranchInput> {}

export function listBranches(companyId: number) {
  return db.select().from(branches)
    .where(and(eq(branches.companyId, companyId), eq(branches.activo, true)));
}

export async function getBranch(id: number) {
  const rows = await db.select().from(branches).where(eq(branches.id, id)).limit(1);
  return rows[0];
}

export async function createBranch(data: CreateBranchInput) {
  const now = Math.floor(Date.now() / 1000);
  const rows = await db.insert(branches).values({
    companyId: data.companyId,
    codigo: data.codigo,
    nombre: data.nombre,
    direccion: data.direccion,
    ubigeo: data.ubigeo,
    distrito: data.distrito,
    provincia: data.provincia,
    departamento: data.departamento,
    telefono: data.telefono,
    email: data.email,
    activo: true,
    createdAt: now,
    updatedAt: now,
  }).returning();
  return rows[0];
}

export async function updateBranch(id: number, data: UpdateBranchInput) {
  const now = Math.floor(Date.now() / 1000);
  const updates: Record<string, any> = { updatedAt: now };
  if (data.codigo !== undefined) updates.codigo = data.codigo;
  if (data.nombre !== undefined) updates.nombre = data.nombre;
  if (data.direccion !== undefined) updates.direccion = data.direccion;
  if (data.ubigeo !== undefined) updates.ubigeo = data.ubigeo;
  if (data.distrito !== undefined) updates.distrito = data.distrito;
  if (data.provincia !== undefined) updates.provincia = data.provincia;
  if (data.departamento !== undefined) updates.departamento = data.departamento;
  if (data.telefono !== undefined) updates.telefono = data.telefono;
  if (data.email !== undefined) updates.email = data.email;
  const rows = await db.update(branches).set(updates).where(eq(branches.id, id)).returning();
  return rows[0];
}
