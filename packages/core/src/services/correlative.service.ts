import fs from 'fs';
import path from 'path';
import { eq, and, sql } from 'drizzle-orm';
import { db, pool } from '../db';
import { correlatives } from '../db/schema';

const STORAGE_PATH = process.env.STORAGE_PATH || './storage';

export async function getNextCorrelative(
  branchId: number,
  tipoDocumento: string,
  serie: string,
): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query('begin');

    const branchResult = await client.query<{ ruc: string }>(
      `select c.ruc
         from branches b
         join companies c on c.id = b.company_id
        where b.id = $1
        limit 1`,
      [branchId],
    );
    const ruc = branchResult.rows[0]?.ruc;
    if (!ruc) throw new Error('Sucursal no encontrada');

    const branchIdsResult = await client.query<{ id: number }>(
      `select b.id
         from branches b
         join companies c on c.id = b.company_id
        where c.ruc = $1`,
      [ruc],
    );
    const branchIds = branchIdsResult.rows.map(row => row.id);

    await client.query(
      `select id
         from correlatives
        where branch_id = any($1::int[])
          and tipo_documento = $2
          and serie = $3
        for update`,
      [branchIds, tipoDocumento, serie],
    );

    const currentBranchCorrelative = await client.query<{ id: number }>(
      `select id
         from correlatives
        where branch_id = $1
          and tipo_documento = $2
          and serie = $3
        limit 1`,
      [branchId, tipoDocumento, serie],
    );

    if (!currentBranchCorrelative.rows[0]) {
      const now = Math.floor(Date.now() / 1000);
      await client.query(
        `insert into correlatives (branch_id, tipo_documento, serie, correlativo_actual, activo, created_at, updated_at)
         values ($1, $2, $3, 0, true, $4, $4)`,
        [branchId, tipoDocumento, serie, now],
      );
    }

    const correlativeMaxResult = await client.query<{ max: string | null }>(
      `select coalesce(max(correlativo_actual), 0)::text as max
         from correlatives
        where branch_id = any($1::int[])
          and tipo_documento = $2
          and serie = $3`,
      [branchIds, tipoDocumento, serie],
    );

    const boletaMaxResult = tipoDocumento === '03'
      ? await client.query<{ max: string | null }>(
          `select coalesce(max(cast(b.correlativo as integer)), 0)::text as max
             from boletas b
             join companies c on c.id = b.company_id
            where c.ruc = $1
              and b.tipo_documento = $2
              and b.serie = $3
              and b.correlativo ~ '^[0-9]+$'`,
          [ruc, tipoDocumento, serie],
        )
      : { rows: [{ max: '0' }] };

    const creditNoteMaxResult = tipoDocumento === '07'
      ? await client.query<{ max: string | null }>(
          `select coalesce(max(cast(cn.correlativo as integer)), 0)::text as max
             from credit_notes cn
             join companies c on c.id = cn.company_id
            where c.ruc = $1
              and cn.tipo_documento = $2
              and cn.serie = $3
              and cn.correlativo ~ '^[0-9]+$'`,
          [ruc, tipoDocumento, serie],
        )
      : { rows: [{ max: '0' }] };

    const next = Math.max(
      Number(correlativeMaxResult.rows[0]?.max || 0),
      Number(boletaMaxResult.rows[0]?.max || 0),
      Number(creditNoteMaxResult.rows[0]?.max || 0),
    ) + 1;
    const now = Math.floor(Date.now() / 1000);

    await client.query(
      `update correlatives
          set correlativo_actual = $1,
              updated_at = $2
        where branch_id = any($3::int[])
          and tipo_documento = $4
          and serie = $5`,
      [next, now, branchIds, tipoDocumento, serie],
    );

    await client.query('commit');
    return String(next).padStart(6, '0');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Re-sincroniza el contador de correlativos al máximo realmente usado por
 * boletas/notas de crédito existentes. Se llama tras BORRAR un documento que
 * SUNAT rechazó, para liberar su número y que el siguiente lo reutilice (en vez
 * de dejar un hueco). Es seguro: nunca baja por debajo de un documento aceptado.
 */
export async function releaseCorrelative(
  branchId: number,
  tipoDocumento: string,
  serie: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');

    const branchResult = await client.query<{ ruc: string }>(
      `select c.ruc from branches b join companies c on c.id = b.company_id where b.id = $1 limit 1`,
      [branchId],
    );
    const ruc = branchResult.rows[0]?.ruc;
    if (!ruc) {
      await client.query('rollback');
      return;
    }

    const branchIdsResult = await client.query<{ id: number }>(
      `select b.id from branches b join companies c on c.id = b.company_id where c.ruc = $1`,
      [ruc],
    );
    const branchIds = branchIdsResult.rows.map(row => row.id);

    await client.query(
      `select id from correlatives
        where branch_id = any($1::int[]) and tipo_documento = $2 and serie = $3
        for update`,
      [branchIds, tipoDocumento, serie],
    );

    const boletaMaxResult = tipoDocumento === '03'
      ? await client.query<{ max: string | null }>(
          `select coalesce(max(cast(b.correlativo as integer)), 0)::text as max
             from boletas b join companies c on c.id = b.company_id
            where c.ruc = $1 and b.tipo_documento = $2 and b.serie = $3 and b.correlativo ~ '^[0-9]+$'`,
          [ruc, tipoDocumento, serie],
        )
      : { rows: [{ max: '0' }] };

    const creditNoteMaxResult = tipoDocumento === '07'
      ? await client.query<{ max: string | null }>(
          `select coalesce(max(cast(cn.correlativo as integer)), 0)::text as max
             from credit_notes cn join companies c on c.id = cn.company_id
            where c.ruc = $1 and cn.tipo_documento = $2 and cn.serie = $3 and cn.correlativo ~ '^[0-9]+$'`,
          [ruc, tipoDocumento, serie],
        )
      : { rows: [{ max: '0' }] };

    const trueMax = Math.max(
      Number(boletaMaxResult.rows[0]?.max || 0),
      Number(creditNoteMaxResult.rows[0]?.max || 0),
    );

    await client.query(
      `update correlatives set correlativo_actual = $1, updated_at = $2
        where branch_id = any($3::int[]) and tipo_documento = $4 and serie = $5`,
      [trueMax, Math.floor(Date.now() / 1000), branchIds, tipoDocumento, serie],
    );

    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function getNextSummaryCorrelative(
  companyId: number,
  fechaResumen: string,
): Promise<string> {
  const { dailySummaries } = await import('../db/schema');

  const lastSummaryRows = await db.select({
    maxCorrelativo: sql<number>`coalesce(max(cast(${dailySummaries.correlativo} as integer)), 0)`,
  })
    .from(dailySummaries)
    .where(
      eq(dailySummaries.fechaResumen, fechaResumen),
    )
    .limit(1);
  const lastSummary = lastSummaryRows[0];

  const storageMaxCorrelative = getMaxSummaryCorrelativeFromStorage(fechaResumen);
  const nextCorrelative = Math.max(Number(lastSummary?.maxCorrelativo || 0), storageMaxCorrelative) + 1;
  return String(nextCorrelative);
}

function getMaxSummaryCorrelativeFromStorage(fechaResumen: string): number {
  const issueCompact = fechaResumen.replace(/-/g, '');
  const dateFolder = formatDateFolder(fechaResumen);
  const roots = [
    path.join(STORAGE_PATH, 'resumenes', 'xml', dateFolder),
    path.join(STORAGE_PATH, 'resumenes', 'cdr', dateFolder),
  ];

  let maxCorrelative = 0;
  for (const dir of roots) {
    if (!fs.existsSync(dir)) continue;
    for (const filename of fs.readdirSync(dir)) {
      const match = filename.match(new RegExp(`(?:^|-)RC-${issueCompact}-(\\d+)\\.(?:xml|zip)$`));
      if (!match) continue;
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > maxCorrelative) {
        maxCorrelative = value;
      }
    }
  }

  return maxCorrelative;
}

function formatDateFolder(fechaResumen: string): string {
  const [year, month, day] = fechaResumen.split('-');
  return `${day}${month}${year}`;
}
