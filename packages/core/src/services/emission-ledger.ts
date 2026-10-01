import crypto from 'node:crypto';
import { pool } from '../db';
import { isSunatProduction } from '../utils/sunat-env';

export type DocumentTable = 'boletas' | 'facturas' | 'credit_notes';

export interface LedgerNumber {
  ruc: string;
  tipoDocumento: string;
  serie: string;
  correlativo: string | number;
  documentTable: DocumentTable;
  documentId: number;
}

export function sha256(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

export type RegisterXmlResult =
  | { ok: true }
  | { ok: false; existingSha: string; existingDocumentTable: string; existingDocumentId: number };

/**
 * Fija el XML firmado de un número. El primer XML registrado para
 * (RUC, tipo, serie, correlativo) es el único válido: cualquier otro XML
 * para ese número se rechaza. En beta los números se reutilizan, así que no
 * se registra nada.
 */
export async function registerSignedXml(number: LedgerNumber & { xmlSha256: string; xmlPath: string }): Promise<RegisterXmlResult> {
  if (!isSunatProduction()) return { ok: true };
  const correlativo = Number(number.correlativo);
  await pool.query(
    `insert into sunat_document_xml (ruc, tipo_documento, serie, correlativo, document_table, document_id, xml_sha256, xml_path)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (ruc, tipo_documento, serie, correlativo) do nothing`,
    [number.ruc, number.tipoDocumento, number.serie, correlativo, number.documentTable, number.documentId, number.xmlSha256, number.xmlPath],
  );
  const existing = (await pool.query<{ xml_sha256: string; document_table: string; document_id: number }>(
    `select xml_sha256, document_table, document_id from sunat_document_xml
      where ruc=$1 and tipo_documento=$2 and serie=$3 and correlativo=$4`,
    [number.ruc, number.tipoDocumento, number.serie, correlativo],
  )).rows[0];
  if (!existing || existing.xml_sha256 === number.xmlSha256) return { ok: true };
  return {
    ok: false,
    existingSha: existing.xml_sha256,
    existingDocumentTable: existing.document_table,
    existingDocumentId: existing.document_id,
  };
}

export type AttemptKind = 'SEND' | 'STATUS_CHECK' | 'BLOCKED';

export async function recordAttempt(attempt: LedgerNumber & {
  kind: AttemptKind;
  outcome: string;
  reference?: string | null;
  responseCode?: string | null;
  responseMessage?: string | null;
  xmlSha256?: string | null;
  cdrPath?: string | null;
}): Promise<void> {
  await pool.query(
    `insert into sunat_emission_attempts
       (ambiente, ruc, tipo_documento, serie, correlativo, document_table, document_id, reference,
        kind, outcome, response_code, response_message, xml_sha256, cdr_path)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      isSunatProduction() ? 'produccion' : 'beta',
      attempt.ruc,
      attempt.tipoDocumento,
      attempt.serie,
      Number(attempt.correlativo),
      attempt.documentTable,
      attempt.documentId,
      attempt.reference || null,
      attempt.kind,
      attempt.outcome,
      attempt.responseCode || null,
      attempt.responseMessage ? String(attempt.responseMessage).slice(0, 2000) : null,
      attempt.xmlSha256 || null,
      attempt.cdrPath || null,
    ],
  );
}

/** Números distintos que SUNAT rechazó para una misma referencia (pedido o documento afectado). */
export async function countRejectedNumbers(ruc: string, tipoDocumento: string, reference: string): Promise<number> {
  const result = await pool.query<{ total: string }>(
    `select count(distinct (serie, correlativo))::text as total
       from sunat_emission_attempts
      where ruc=$1 and tipo_documento=$2 and reference=$3 and outcome='RECHAZADO' and ambiente=$4`,
    [ruc, tipoDocumento, reference, isSunatProduction() ? 'produccion' : 'beta'],
  );
  return Number(result.rows[0]?.total || 0);
}
