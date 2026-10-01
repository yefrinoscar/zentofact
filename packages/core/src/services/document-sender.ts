import { eq } from 'drizzle-orm';
import { db } from '../db';
import { classifySunatSendResult } from './sunat.service';
import type { SunatService } from './sunat.service';
import { readArchive } from './file.service';
import { auditDocumentAmounts, readExpectedAmount, readPayableAmount } from './amount-audit';
import { recordAttempt, registerSignedXml, sha256 } from './emission-ledger';
import type { DocumentTable } from './emission-ledger';
import { MANUAL_REVIEW_STATE } from './sunat-reconciliation';

type ArchiveMeta = { serie: string; correlativo: string; fechaEmision: string };

export interface SendTarget {
  documentTable: DocumentTable;
  table: any;
  tipoDocumento: '01' | '03' | '07';
  ruc: string;
  doc: any;
  /** Pedido o documento afectado: agrupa los intentos de una misma venta. */
  reference?: string | null;
  sunat: SunatService;
  buildUnsignedXml: () => string;
  saveXml: (meta: ArchiveMeta, xml: string) => Promise<string>;
  saveCdr: (meta: ArchiveMeta, cdrZip: Buffer) => Promise<string>;
}

export interface SendOutcome {
  success: boolean;
  estadoSunat: string;
  message: string;
  error_code?: string;
  blocked?: boolean;
  manualReview?: boolean;
  cdrResponse?: any;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * Envía un comprobante a SUNAT con estas garantías:
 * 1. El XML se firma una sola vez y se guarda ANTES de enviarlo; los reintentos
 *    reenvían exactamente esos bytes.
 * 2. En producción, un número tiene un único XML (sunat_document_xml).
 * 3. Si el total del origen, del comprobante y del XML no cuadran, no se envía.
 * 4. Mientras se envía, el estado es ENVIANDO: si el proceso muere, el barrido
 *    lo pasa a NO_CONFIRMADO y se reconcilia antes de cualquier reemisión.
 * 5. Cada envío o bloqueo queda en sunat_emission_attempts.
 */
export async function sendDocumentOnce(target: SendTarget): Promise<SendOutcome> {
  const { doc, table, sunat } = target;
  const meta: ArchiveMeta = { serie: doc.serie, correlativo: doc.correlativo, fechaEmision: String(doc.fechaEmision) };
  const ledger = {
    ruc: target.ruc,
    tipoDocumento: target.tipoDocumento,
    serie: doc.serie,
    correlativo: doc.correlativo,
    documentTable: target.documentTable,
    documentId: doc.id,
    reference: target.reference || null,
  };
  const update = (values: Record<string, unknown>) => db.update(table).set({ ...values, updatedAt: nowSeconds() }).where(eq(table.id, doc.id));

  // 1. XML firmado: el guardado, o uno nuevo que se guarda antes de enviar.
  let signedXml: string;
  let xmlPath: string = doc.xmlPath;
  try {
    if (xmlPath) {
      signedXml = (await readArchive(xmlPath)).toString('utf8');
    } else {
      signedXml = sunat.signDocument(target.buildUnsignedXml());
      xmlPath = await target.saveXml(meta, signedXml);
      await update({ xmlPath, codigoHash: sunat.getHashFromXml(signedXml) || null });
    }
  } catch (error: any) {
    // Nada salió hacia SUNAT: el estado no cambia.
    const message = `No se pudo preparar el XML firmado: ${error.message}`;
    await update({ respuestaSunat: JSON.stringify({ code: 'ARCHIVE_ERROR', message }) });
    return { success: false, estadoSunat: String(doc.estadoSunat || 'PENDIENTE'), message, error_code: 'ARCHIVE_ERROR' };
  }
  const xmlSha256 = sha256(signedXml);

  const block = async (code: string, message: string): Promise<SendOutcome> => {
    await recordAttempt({ ...ledger, kind: 'BLOCKED', outcome: code, responseMessage: message, xmlSha256 });
    await update({ estadoSunat: MANUAL_REVIEW_STATE, respuestaSunat: JSON.stringify({ code, message }) });
    return { success: false, estadoSunat: MANUAL_REVIEW_STATE, message, error_code: code, blocked: true, manualReview: true };
  };

  // 2. Un número, un XML.
  const registered = await registerSignedXml({ ...ledger, xmlSha256, xmlPath });
  if (!registered.ok) {
    return block('XML_CONFLICT', `El número ${doc.serie}-${doc.correlativo} ya tiene otro XML registrado (${registered.existingDocumentTable} #${registered.existingDocumentId}). No se envía un XML distinto para el mismo número.`);
  }

  // 3. Montos: origen = comprobante = XML.
  const audit = auditDocumentAmounts({
    expected: readExpectedAmount(doc.datosAdicionales),
    stored: Number(doc.mtoImpVenta),
    xml: readPayableAmount(signedXml),
  });
  if (!audit.ok) {
    return block('AMOUNT_MISMATCH', `Los montos no cuadran; no se envía a SUNAT: ${audit.mismatches.join('; ')}.`);
  }

  // 4. Envío.
  await update({ estadoSunat: 'ENVIANDO' });
  const fileName = `${target.ruc}-${target.tipoDocumento}-${doc.serie}-${doc.correlativo}`;
  const result = await sunat.sendSignedDocument(signedXml, fileName);
  let estadoSunat: string = classifySunatSendResult(result);

  let cdrPath = doc.cdrPath || null;
  let cdrError = '';
  if (result.cdrZip) {
    try {
      cdrPath = await target.saveCdr(meta, result.cdrZip);
    } catch (error: any) {
      cdrError = error.message;
    }
  }
  if (estadoSunat === 'ACEPTADO' && cdrError) estadoSunat = 'NO_CONFIRMADO';

  const errorData = estadoSunat === 'ACEPTADO'
    ? null
    : cdrError && classifySunatSendResult(result) === 'ACEPTADO'
      ? { code: 'CDR_ARCHIVE_ERROR', message: `SUNAT respondió aceptación, pero no se pudo guardar el CDR: ${cdrError}` }
      : result.error || { code: 'UNKNOWN', message: 'Error desconocido' };

  await recordAttempt({
    ...ledger,
    kind: 'SEND',
    outcome: estadoSunat,
    responseCode: errorData?.code || result.cdrResponse?.code || null,
    responseMessage: errorData?.message || result.cdrResponse?.description || null,
    xmlSha256,
    cdrPath,
  });
  await update({
    estadoSunat,
    cdrPath,
    respuestaSunat: JSON.stringify(errorData || result.cdrResponse),
  });

  if (estadoSunat === 'ACEPTADO') {
    return { success: true, estadoSunat, message: 'Comprobante aceptado por SUNAT', cdrResponse: result.cdrResponse };
  }
  return {
    success: false,
    estadoSunat,
    message: `Error al enviar a SUNAT: ${errorData!.message}`,
    error_code: errorData!.code,
    cdrResponse: result.cdrResponse,
  };
}
