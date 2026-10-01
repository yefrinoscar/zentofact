import { pool } from '../db';
import { SunatService } from './sunat.service';
import { classifyForReport, classifyStatusCdr, isDefinitiveStoredRejection, localMatchesSunat, suggestReportAction } from './sunat-reconciliation';

export { suggestReportAction };
import type { ReportClass } from './sunat-reconciliation';
import { readExpectedAmount } from './amount-audit';
import { refreshDocumentStatus } from './sunat-sweep.service';
import { sha256 } from './emission-ledger';
import type { DocumentTable } from './emission-ledger';

// Reporte de reconciliación con SUNAT por empresa (fase 2 del plan para
// BEAUTY HOME). Consulta SUNAT solo en modo lectura: nunca envía ni reemite.

export interface ReportRow {
  table: DocumentTable;
  id: number;
  numeroCompleto: string;
  fechaEmision: string;
  orderNumber: string | null;
  cliente: string;
  estadoLocal: string;
  montoLocal: number;
  montoEsperado: number | null;
  montoFalabella: number | null;
  clase: ReportClass;
  detalle: string;
  montoInconsistente: boolean;
  estadoLocalDistinto: boolean;
  accion: string;
}

const TABLES: Array<{ table: DocumentTable; tipo: '01' | '03' | '07'; orderExpr: string }> = [
  { table: 'boletas', tipo: '03', orderExpr: 'd.order_number' },
  { table: 'facturas', tipo: '01', orderExpr: 'd.order_number' },
  { table: 'credit_notes', tipo: '07', orderExpr: "d.datos_adicionales->>'affectedOrderNumber'" },
];

const differs = (a: number | null, b: number | null) => a !== null && b !== null && Math.abs(a - b) > 0.005;

export async function buildSunatReconciliationReport(params: {
  companyId: number;
  from?: string;
  to?: string;
  onlyUnconfirmed?: boolean;
  delayMs?: number;
}): Promise<{ company: { id: number; ruc: string; razonSocial: string }; rows: ReportRow[]; planHash: string }> {
  const company = (await pool.query('select * from companies where id=$1', [params.companyId])).rows[0];
  if (!company) throw new Error('Empresa no encontrada');
  const sunat = new SunatService({
    ruc: company.ruc,
    razonSocial: company.razon_social,
    direccion: company.direccion || '',
    ubigeo: company.ubigeo || '',
    usuarioSol: company.usuario_sol || 'MODDATOS',
    claveSol: company.clave_sol || 'MODDATOS',
    certificado: company.certificado || '',
    certificadoPassword: company.certificado_password || '',
  });

  const rows: ReportRow[] = [];
  for (const { table, tipo, orderExpr } of TABLES) {
    const documents = (await pool.query(
      `select d.id, d.serie, d.correlativo, d.numero_completo, d.fecha_emision, d.estado_sunat, d.mto_imp_venta,
              d.codigo_hash, d.datos_adicionales, ${orderExpr} as order_number,
              cl.numero_documento as client_documento, cl.razon_social as client_nombre,
              (select fo.grand_total from falabella_orders fo
                where fo.company_id = d.company_id and fo.order_number = ${orderExpr}
                order by fo.last_seen_at desc limit 1) as falabella_total
         from ${table} d
         left join clients cl on cl.id = d.client_id
        where d.company_id = $1
          and ($2::text is null or left(d.fecha_emision, 10) >= $2)
          and ($3::text is null or left(d.fecha_emision, 10) <= $3)
          and (not $4 or upper(coalesce(d.estado_sunat, '')) not in ('ACEPTADO', 'ANULADO', 'REEMPLAZADO'))
        order by d.serie, d.correlativo`,
      [params.companyId, params.from || null, params.to || null, !!params.onlyUnconfirmed],
    )).rows;

    for (const doc of documents) {
      const status = await sunat.getStatusCdr(company.ruc, tipo, doc.serie, doc.correlativo);
      const outcome = classifyStatusCdr(status);
      const { clase, detalle } = classifyForReport(outcome, {
        numeroCompleto: doc.numero_completo,
        fechaEmision: doc.fecha_emision,
        clientDocumento: doc.client_documento,
        codigoHash: doc.codigo_hash,
      });
      const estadoLocal = String(doc.estado_sunat || 'PENDIENTE').toUpperCase();
      const montoLocal = Number(doc.mto_imp_venta || 0);
      const montoEsperado = readExpectedAmount(doc.datos_adicionales)?.total ?? null;
      const montoFalabella = doc.falabella_total === null || doc.falabella_total === undefined ? null : Number(doc.falabella_total);
      // Una nota de crédito replica el total del comprobante, no del pedido.
      const montoInconsistente = table !== 'credit_notes' && (differs(montoLocal, montoEsperado) || differs(montoLocal, montoFalabella));
      const row = {
        table,
        id: doc.id,
        numeroCompleto: doc.numero_completo,
        fechaEmision: String(doc.fecha_emision || ''),
        orderNumber: doc.order_number || null,
        cliente: `${doc.client_documento || ''} ${doc.client_nombre || ''}`.trim(),
        estadoLocal,
        montoLocal,
        montoEsperado,
        montoFalabella,
        clase,
        detalle,
        montoInconsistente,
        estadoLocalDistinto: !localMatchesSunat(clase, estadoLocal),
      };
      rows.push({ ...row, accion: suggestReportAction(row) });
      if (params.delayMs) await new Promise((resolve) => setTimeout(resolve, params.delayMs));
    }
  }

  const planHash = sha256(JSON.stringify(rows.map((row) => [row.table, row.id, row.clase, row.estadoLocal])));
  return { company: { id: company.id, ruc: company.ruc, razonSocial: company.razon_social }, rows, planHash };
}

/**
 * Aplica el reporte revisado. Solo sincroniza estados locales:
 * - respuestas concluyentes de SUNAT → se vuelve a consultar y se guarda el
 *   estado con verificación de identidad (refreshDocumentStatus);
 * - RECHAZADO antiguo sin CDR de rechazo y sin respuesta de SUNAT →
 *   NO_CONFIRMADO, porque nunca probó un rechazo.
 * Nunca envía, reemite ni consume correlativos.
 */
export async function applySunatReconciliationReport(rows: ReportRow[]) {
  const summary = { refreshed: 0, reclassified: 0, skipped: 0, errors: [] as string[] };
  for (const row of rows) {
    try {
      if (row.clase === 'ACEPTADO_AJENO' && row.estadoLocal === 'ACEPTADO') {
        // Figura aceptado localmente, pero SUNAT tiene ese número con datos de
        // otro comprobante: la venta en realidad no tiene comprobante válido.
        await pool.query(
          `update ${row.table} set estado_sunat='REVISION_MANUAL', respuesta_sunat=$2, updated_at=$3 where id=$1`,
          [row.id, JSON.stringify({ code: 'SUNAT_IDENTITY_MISMATCH', message: row.detalle }), Math.floor(Date.now() / 1000)],
        );
        summary.refreshed += 1;
        continue;
      }
      if (row.clase !== 'NO_CONSULTABLE') {
        if (row.estadoLocalDistinto) {
          await refreshDocumentStatus(row.table, row.id);
          summary.refreshed += 1;
        } else {
          summary.skipped += 1;
        }
        continue;
      }
      if (row.estadoLocal !== 'RECHAZADO') { summary.skipped += 1; continue; }
      const stored = (await pool.query(`select respuesta_sunat from ${row.table} where id=$1`, [row.id])).rows[0];
      if (isDefinitiveStoredRejection(stored?.respuesta_sunat)) { summary.skipped += 1; continue; }
      await pool.query(
        `update ${row.table} set estado_sunat='NO_CONFIRMADO', updated_at=$2 where id=$1 and upper(estado_sunat)='RECHAZADO'`,
        [row.id, Math.floor(Date.now() / 1000)],
      );
      summary.reclassified += 1;
    } catch (error: any) {
      summary.errors.push(`${row.numeroCompleto}: ${error.message}`);
    }
  }
  return summary;
}
