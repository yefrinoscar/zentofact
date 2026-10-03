import { pool } from '../db';
import { limaDateDaysAgo } from '../utils/lima-date';
import { refreshIndividualBoletaStatus } from './boleta.service';
import { refreshFacturaStatus } from './factura.service';
import { refreshCreditNoteStatus } from './credit-note.service';
import type { DocumentTable } from './emission-ledger';

// El centinela de serie pertenece al mismo perímetro de contingencia, pero se
// mantiene en su módulo propio para no mezclar la consulta de documentos
// inciertos con la protección de correlativos.
export { probeSeriesCollision, seriesProbeVerdict } from './series-guard.service';
export type { SeriesProbe, SeriesProbeVerdict } from './series-guard.service';

export { limaDateDaysAgo };

// Barrido periódico de comprobantes cuyo envío a SUNAT no quedó confirmado.
// Nada de lo que hay aquí envía comprobantes: solo recupera estados, consulta
// SUNAT en modo lectura y señala lo que necesita atención.

/** Un ENVIANDO más antiguo que esto significa que el proceso murió durante el envío. */
export const STALE_SENDING_MINUTES = 10;
/**
 * Plazo máximo de envío a SUNAT, en días calendario desde la emisión. Verificar
 * el plazo vigente de SUNAT para cada tipo de comprobante.
 */
export const SUNAT_SEND_DEADLINE_DAYS = 3;
/** Se avisa con margen: un día antes de que venza el plazo. */
export const DEADLINE_ALERT_DAYS = SUNAT_SEND_DEADLINE_DAYS - 1;

const DOCUMENT_TABLES: Array<{ table: DocumentTable; tipoDocumento: '01' | '03' | '07'; orderColumn: string | null }> = [
  { table: 'boletas', tipoDocumento: '03', orderColumn: 'order_number' },
  { table: 'facturas', tipoDocumento: '01', orderColumn: 'order_number' },
  // La nota guarda la orden del comprobante que anula en datos_adicionales.
  { table: 'credit_notes', tipoDocumento: '07', orderColumn: "datos_adicionales->>'affectedOrderNumber'" },
];

const FINAL_STATES = ['ACEPTADO', 'ANULADO', 'REEMPLAZADO'];

export interface SweepDocument {
  table: DocumentTable;
  id: number;
  companyId: number;
  numeroCompleto: string;
  orderNumber: string | null;
  estadoSunat: string;
  fechaEmision: string;
}

const epochSeconds = () => Math.floor(Date.now() / 1000);

function selectColumns(orderColumn: string | null): string {
  return `id, company_id, numero_completo, ${orderColumn ? `${orderColumn} as order_number` : 'null::text as order_number'}, estado_sunat, fecha_emision`;
}

function toSweepDocument(table: DocumentTable, row: any): SweepDocument {
  return {
    table,
    id: row.id,
    companyId: row.company_id,
    numeroCompleto: row.numero_completo,
    orderNumber: row.order_number || null,
    estadoSunat: String(row.estado_sunat || '').toUpperCase(),
    fechaEmision: String(row.fecha_emision || ''),
  };
}

/** ENVIANDO abandonado → NO_CONFIRMADO, para que se reconcilie antes de cualquier reenvío. */
export async function markStaleSendingAsUnconfirmed(staleMinutes = STALE_SENDING_MINUTES): Promise<SweepDocument[]> {
  const recovered: SweepDocument[] = [];
  const respuesta = JSON.stringify({
    code: 'SEND_INTERRUPTED',
    message: 'El envío a SUNAT se interrumpió sin respuesta. Se consultará SUNAT antes de reenviar.',
  });
  for (const { table, orderColumn } of DOCUMENT_TABLES) {
    const rows = (await pool.query(
      `update ${table}
          set estado_sunat='NO_CONFIRMADO', respuesta_sunat=$1, updated_at=$2
        where upper(coalesce(estado_sunat, ''))='ENVIANDO' and coalesce(updated_at, 0) < $3
        returning ${selectColumns(orderColumn)}`,
      [respuesta, epochSeconds(), epochSeconds() - staleMinutes * 60],
    )).rows;
    recovered.push(...rows.map((row) => toSweepDocument(table, row)));
  }
  return recovered;
}

/** Comprobantes sin confirmar que no se revisaron en los últimos minutos. */
export async function listDocumentsNeedingReconciliation(options: { notCheckedForMinutes?: number; limit?: number } = {}): Promise<SweepDocument[]> {
  const notCheckedFor = (options.notCheckedForMinutes ?? 30) * 60;
  const limit = options.limit ?? 50;
  const found: SweepDocument[] = [];
  for (const { table, orderColumn } of DOCUMENT_TABLES) {
    const rows = (await pool.query(
      `select ${selectColumns(orderColumn)} from ${table}
        where (upper(coalesce(estado_sunat, '')) in ('NO_CONFIRMADO', 'NO_ENCONTRADO')
          or (${table !== 'credit_notes' ? 'true' : 'false'}
            and upper(coalesce(estado_sunat, '')) in ('REVISION_MANUAL', 'RECHAZADO')
            and coalesce(respuesta_sunat, '') like '%Colisión de correlativo%'))
          and coalesce(updated_at, 0) < $1
        order by updated_at asc nulls first
        limit $2`,
      [epochSeconds() - notCheckedFor, limit],
    )).rows;
    found.push(...rows.map((row) => toSweepDocument(table, row)));
  }
  return found.slice(0, limit);
}

/**
 * Comprobantes que siguen sin aceptación cerca del plazo de SUNAT. Solo mira
 * los últimos 30 días para no repetir avisos de documentos antiguos.
 */
export async function listOverdueDocuments(options: { olderThanDays?: number; now?: Date } = {}): Promise<SweepDocument[]> {
  const cutoff = limaDateDaysAgo(options.olderThanDays ?? DEADLINE_ALERT_DAYS, options.now);
  const floor = limaDateDaysAgo(30, options.now);
  const found: SweepDocument[] = [];
  for (const { table, orderColumn } of DOCUMENT_TABLES) {
    const rows = (await pool.query(
      `select ${selectColumns(orderColumn)} from ${table}
        where upper(coalesce(estado_sunat, '')) <> all($1::text[])
          and left(fecha_emision, 10) <= $2
          and left(fecha_emision, 10) >= $3
        order by fecha_emision asc`,
      [FINAL_STATES, cutoff, floor],
    )).rows;
    found.push(...rows.map((row) => toSweepDocument(table, row)));
  }
  return found;
}

/** Consulta SUNAT en modo lectura y actualiza el estado local; nunca envía. */
export async function refreshDocumentStatus(table: DocumentTable, id: number) {
  if (table === 'boletas') return refreshIndividualBoletaStatus(id);
  if (table === 'facturas') return refreshFacturaStatus(id);
  return refreshCreditNoteStatus(id);
}
