import { pool } from '../db';

export class ActiveOrderDocumentError extends Error {
  constructor(public readonly numeroCompleto: string, public readonly estadoSunat: string, label: string, orderNumber: string) {
    super(
      `La orden ${orderNumber} ya tiene la ${label} ${numeroCompleto} (${estadoSunat || 'PENDIENTE'}). `
      + 'Reconcíliala o reemítela en lugar de crear otra.',
    );
    this.name = 'ActiveOrderDocumentError';
  }
}

const TABLES = {
  boletas: { label: 'boleta', creditNoteColumn: 'affected_boleta_id' },
  facturas: { label: 'factura', creditNoteColumn: 'affected_factura_id' },
} as const;

/**
 * Crea un comprobante solo si la orden no tiene otro activo. Activo es todo lo
 * que no fue reemplazado, anulado ni revertido por una nota de crédito aceptada.
 * El advisory lock por orden serializa las creaciones concurrentes: la segunda
 * espera, ve el comprobante de la primera y se rechaza. La verificación ocurre
 * antes de reservar el correlativo, así un rechazo no consume números.
 */
export async function withActiveOrderDocumentGuard<T>(
  params: { table: keyof typeof TABLES; companyId: number; orderNumber?: string | null },
  create: () => Promise<T>,
): Promise<T> {
  const orderNumber = String(params.orderNumber || '').trim();
  if (!orderNumber) return create();
  const { label } = TABLES[params.table];

  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [`order-document:${params.companyId}:${orderNumber}`]);
    const active = (await client.query<{ numero_completo: string; estado_sunat: string }>(
      `select d.numero_completo, d.estado_sunat from (
         select f.id, f.numero_completo, f.estado_sunat, f.created_at from facturas f
         where f.company_id=$1 and f.order_number=$2
           and upper(coalesce(f.estado_sunat, '')) not in ('REEMPLAZADO', 'ANULADO')
           and not exists (select 1 from credit_notes cn where cn.affected_factura_id=f.id and upper(coalesce(cn.estado_sunat, ''))='ACEPTADO')
         union all
         select b.id, b.numero_completo, b.estado_sunat, b.created_at from boletas b
         where b.company_id=$1 and b.order_number=$2
           and upper(coalesce(b.estado_sunat, '')) not in ('REEMPLAZADO', 'ANULADO')
           and not exists (select 1 from credit_notes cn where cn.affected_boleta_id=b.id and upper(coalesce(cn.estado_sunat, ''))='ACEPTADO')
       ) d order by d.created_at desc, d.id desc limit 1`,
      [params.companyId, orderNumber],
    )).rows[0];
    if (active) throw new ActiveOrderDocumentError(active.numero_completo, active.estado_sunat, label, orderNumber);
    const result = await create();
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
