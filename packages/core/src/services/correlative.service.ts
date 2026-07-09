import { eq, and } from 'drizzle-orm';
import { db, pool } from '../db';
import { correlatives } from '../db/schema';

export async function getNextCorrelative(
  branchId: number,
  tipoDocumento: string,
  serie: string,
  persist: boolean = true,
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

    const facturaMaxResult = tipoDocumento === '01'
      ? await client.query<{ max: string | null }>(
          `select coalesce(max(cast(f.correlativo as integer)), 0)::text as max
             from facturas f
             join companies c on c.id = f.company_id
            where c.ruc = $1
              and f.tipo_documento = $2
              and f.serie = $3
              and ($4::boolean or f.estado_sunat = 'ACEPTADO')
              and f.correlativo ~ '^[0-9]+$'`,
          [ruc, tipoDocumento, serie, persist],
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
      Number(facturaMaxResult.rows[0]?.max || 0),
      Number(creditNoteMaxResult.rows[0]?.max || 0),
    ) + 1;
    const now = Math.floor(Date.now() / 1000);

    // En beta (persist=false) no se avanza al crear. Solo se marca después si SUNAT
    // llegó a registrar/rechazar remotamente ese número, porque ya no se puede reutilizar.
    if (persist) {
      await client.query(
        `update correlatives
            set correlativo_actual = $1,
                updated_at = $2
          where branch_id = any($3::int[])
            and tipo_documento = $4
            and serie = $5`,
        [next, now, branchIds, tipoDocumento, serie],
      );
    }

    await client.query('commit');
    return String(next).padStart(6, '0');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function markCorrelativeUsed(
  branchId: number,
  tipoDocumento: string,
  serie: string,
  correlativo: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');

    const branchResult = await client.query<{ ruc: string }>(
      `select c.ruc from branches b join companies c on c.id = b.company_id where b.id = $1 limit 1`,
      [branchId],
    );
    const ruc = branchResult.rows[0]?.ruc;
    if (!ruc) throw new Error('Sucursal no encontrada');

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

    const used = Number(correlativo);
    if (Number.isFinite(used) && used > 0) {
      await client.query(
        `update correlatives
            set correlativo_actual = greatest(coalesce(correlativo_actual, 0), $1),
                updated_at = $2
          where branch_id = any($3::int[])
            and tipo_documento = $4
            and serie = $5`,
        [used, Math.floor(Date.now() / 1000), branchIds, tipoDocumento, serie],
      );
    }

    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export function isRemoteSunatRejection(errorCode?: string, errorMessage?: string): boolean {
  const code = String(errorCode || '');
  const message = String(errorMessage || '');
  return code === '1032'
    || /^\d{4}$/.test(code)
    || /fue rechazado con codigo de error/i.test(message)
    || /ticket:\s*\d+/i.test(message);
}
