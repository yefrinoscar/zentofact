import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { boletas, branches, clients, companies, creditNotes } from '../db/schema';
import { getNextCorrelative } from './correlative.service';
import { SunatService } from './sunat.service';
import type { CompanyConfig, CreditNoteSunatData } from './sunat.service';
import { saveCreditNoteCdr, saveCreditNoteXml } from './file.service';
import { numeroALetras } from '../utils/number-to-words';
import { generateBoletaPreviewHtml } from './pdf.service';
import type { PdfFormat } from './pdf.service';

export interface CreateCreditNoteFromBoletaOptions {
  codMotivo?: string;
  desMotivo?: string;
  usuarioCreacion?: string;
  fechaEmision?: string;
  modoProduccion?: boolean;
}

export async function createCreditNoteFromBoleta(
  boletaId: number,
  options: CreateCreditNoteFromBoletaOptions = {},
) {
  const boleta = (await db.select().from(boletas).where(eq(boletas.id, boletaId)).limit(1))[0];
  if (!boleta) throw new Error('Boleta no encontrada');
  if (boleta.tipoDocumento !== '03') throw new Error('Solo se puede crear nota de crédito para boletas');
  if (boleta.estadoSunat !== 'ACEPTADO') throw new Error('La boleta afectada debe estar ACEPTADO');

  const existing = (await db.select().from(creditNotes).where(eq(creditNotes.affectedBoletaId, boletaId)).limit(1))[0];
  if (existing) throw new Error(`La boleta ${boleta.numeroCompleto} ya tiene nota de crédito ${existing.numeroCompleto}`);

  const company = (await db.select().from(companies).where(eq(companies.id, boleta.companyId)).limit(1))[0];
  if (!company) throw new Error('Empresa no encontrada');
  const branch = (await db.select().from(branches).where(and(eq(branches.id, boleta.branchId), eq(branches.companyId, boleta.companyId))).limit(1))[0];
  if (!branch) throw new Error('Sucursal no encontrada');
  const client = (await db.select().from(clients).where(eq(clients.id, boleta.clientId)).limit(1))[0];
  if (!client) throw new Error('Cliente no encontrado');

  const serie = resolveCreditNoteSerie(branch.seriesNotaCredito, boleta.serie);
  const correlativo = await getNextCorrelative(boleta.branchId, '07', serie);
  const numeroCompleto = `${serie}-${correlativo}`;
  const fechaEmision = options.fechaEmision || formatLocalDate();
  const ts = Math.floor(Date.now() / 1000);
  const montoTotal = Number(boleta.mtoImpVenta || 0);
  const leyendas = [{ code: '1000', value: `${numeroALetras(montoTotal).toUpperCase()} SOLES.` }];

  const result = await db.insert(creditNotes).values({
    companyId: boleta.companyId,
    branchId: boleta.branchId,
    clientId: boleta.clientId,
    affectedBoletaId: boleta.id,
    tipoDocumento: '07',
    serie,
    correlativo,
    numeroCompleto,
    tipoDocAfectado: boleta.tipoDocumento || '03',
    numDocAfectado: boleta.numeroCompleto,
    codMotivo: options.codMotivo || '01',
    desMotivo: options.desMotivo || 'ANULACION DE LA OPERACION',
    fechaEmision,
    ublVersion: boleta.ublVersion || '2.1',
    moneda: boleta.moneda || 'PEN',
    formaPagoTipo: 'Contado',
    valorVenta: boleta.valorVenta,
    mtoOperGravadas: boleta.mtoOperGravadas,
    mtoOperExoneradas: boleta.mtoOperExoneradas,
    mtoOperInafectas: boleta.mtoOperInafectas,
    mtoOperGratuitas: boleta.mtoOperGratuitas,
    mtoIgvGratuitas: boleta.mtoIgvGratuitas,
    mtoIgv: boleta.mtoIgv,
    mtoBaseIvap: boleta.mtoBaseIvap,
    mtoIvap: boleta.mtoIvap,
    mtoIsc: boleta.mtoIsc,
    mtoIcbper: boleta.mtoIcbper,
    totalImpuestos: boleta.totalImpuestos,
    subTotal: boleta.subTotal,
    mtoImpVenta: boleta.mtoImpVenta,
    detalles: boleta.detalles,
    leyendas,
    datosAdicionales: {
      affectedBoletaNumero: boleta.numeroCompleto,
      affectedOrderNumber: boleta.orderNumber || null,
    },
    estadoSunat: 'PENDIENTE',
    usuarioCreacion: options.usuarioCreacion || 'sistema:nota-credito',
    createdAt: ts,
    updatedAt: ts,
  }).returning({ id: creditNotes.id });

  return result[0].id;
}

export async function sendCreditNoteToSunat(
  creditNoteId: number,
  options: { modoProduccion?: boolean } = {},
) {
  const note = (await db.select().from(creditNotes).where(eq(creditNotes.id, creditNoteId)).limit(1))[0];
  if (!note) throw new Error('Nota de crédito no encontrada');
  if (note.estadoSunat === 'ACEPTADO') throw new Error('La nota de crédito ya fue aceptada por SUNAT');

  const company = (await db.select().from(companies).where(eq(companies.id, note.companyId)).limit(1))[0];
  if (!company) throw new Error('Empresa no encontrada');
  const client = (await db.select().from(clients).where(eq(clients.id, note.clientId)).limit(1))[0];
  if (!client) throw new Error('Cliente no encontrado');

  const config: CompanyConfig = {
    ruc: company.ruc,
    razonSocial: company.razonSocial,
    direccion: company.direccion || '',
    ubigeo: company.ubigeo || '',
    usuarioSol: company.usuarioSol || 'MODDATOS',
    claveSol: company.claveSol || 'MODDATOS',
    certificado: company.certificado || '',
    certificadoPassword: company.certificadoPassword || '',
    modoProduccion: options.modoProduccion ?? Boolean(company.modoProduccion),
  };

  const detalles = ((note.detalles as any[]) || []).map((d: any) => ({
    codigo: d.codigo,
    descripcion: d.descripcion,
    unidad: d.unidad,
    cantidad: Number(d.cantidad),
    mtoValorUnitario: Number(d.mto_valor_unitario || d.mtoValorUnitario || 0),
    tipAfeIgv: d.tip_afe_igv || d.tipAfeIgv || '10',
    porcentajeIgv: normalizeIgvPercentage(d.porcentaje_igv ?? d.porcentajeIgv, d.tip_afe_igv || d.tipAfeIgv || '10'),
    mtoValorGratuito: Number(d.mto_valor_gratuito || d.mtoValorGratuito || 0),
    isc: Number(d.isc || 0),
    icbper: Number(d.icbper || 0),
  }));
  const clientTipoDocumento = client.tipoDocumento || '0';
  const clientNumeroDocumento = clientTipoDocumento === '0' && !client.numeroDocumento
    ? '00000000'
    : client.numeroDocumento;

  const noteData: CreditNoteSunatData = {
    tipoDocumento: '07',
    serie: note.serie,
    correlativo: note.correlativo,
    fechaEmision: note.fechaEmision,
    moneda: note.moneda || 'PEN',
    ublVersion: note.ublVersion || '2.1',
    tipoDocAfectado: note.tipoDocAfectado,
    numDocAfectado: note.numDocAfectado,
    codMotivo: note.codMotivo,
    desMotivo: note.desMotivo,
    client: {
      tipoDocumento: clientTipoDocumento,
      numeroDocumento: clientNumeroDocumento,
      razonSocial: client.razonSocial,
      direccion: client.direccion || undefined,
    },
    detalles,
    mtoOperGravadas: Number(note.mtoOperGravadas || 0),
    mtoOperExoneradas: Number(note.mtoOperExoneradas || 0),
    mtoOperInafectas: Number(note.mtoOperInafectas || 0),
    mtoOperGratuitas: Number(note.mtoOperGratuitas || 0),
    mtoIgvGratuitas: Number(note.mtoIgvGratuitas || 0),
    mtoIgv: Number(note.mtoIgv || 0),
    mtoBaseIvap: Number(note.mtoBaseIvap || 0),
    mtoIvap: Number(note.mtoIvap || 0),
    mtoIsc: Number(note.mtoIsc || 0),
    mtoIcbper: Number(note.mtoIcbper || 0),
    totalImpuestos: Number(note.totalImpuestos || 0),
    subTotal: Number(note.subTotal || 0),
    mtoImpVenta: Number(note.mtoImpVenta || 0),
    leyendas: (note.leyendas as any[]) || [],
  };

  const sunatService = new SunatService(config);
  const xml = sunatService.buildCreditNoteXml(noteData);
  const result = await sunatService.sendDocument(xml, `${company.ruc}-07-${note.serie}-${note.correlativo}`);

  if (result.success && result.xml) {
    const xmlPath = await saveCreditNoteXml({ serie: note.serie, correlativo: note.correlativo, fechaEmision: note.fechaEmision }, result.xml);
    const updates: Record<string, unknown> = {
      estadoSunat: 'ACEPTADO',
      xmlPath,
      respuestaSunat: JSON.stringify(result.cdrResponse || { status: 'accepted' }),
      codigoHash: sunatService.getHashFromXml(result.xml) || null,
      updatedAt: Math.floor(Date.now() / 1000),
    };
    if (result.cdrZip) {
      updates.cdrPath = await saveCreditNoteCdr({ serie: note.serie, correlativo: note.correlativo, fechaEmision: note.fechaEmision }, result.cdrZip);
    }
    await db.update(creditNotes).set(updates).where(eq(creditNotes.id, creditNoteId));
    if (note.affectedBoletaId) {
      await db.update(boletas).set({
        estadoSunat: note.codMotivo === '01' ? 'ANULADO' : 'ACEPTADO',
        updatedAt: Math.floor(Date.now() / 1000),
      }).where(eq(boletas.id, note.affectedBoletaId));
    }
    return { success: true, id: creditNoteId, numeroCompleto: note.numeroCompleto };
  }

  // SUNAT la rechazó (o falló el envío): NO dejar nada registrado para que la
  // boleta afectada siga anulable. El correlativo NO se libera: si SUNAT llegó
  // a recibir el documento, reutilizar el mismo número puede provocar el error
  // "El comprobante fue informado anteriormente".
  const errorData = result.error || { code: 'UNKNOWN', message: 'Error desconocido' };
  await db.delete(creditNotes).where(eq(creditNotes.id, creditNoteId));

  return { success: false, id: creditNoteId, numeroCompleto: note.numeroCompleto, error: errorData };
}

/**
 * Anula una boleta emitiendo y enviando UNA nota de crédito (flujo 1 × 1).
 * Crea el documento 07, lo firma y lo envía a SUNAT vía sendBill, devolviendo
 * su CDR de inmediato. Es la unidad reutilizada por el envío en grupo.
 */
export async function createAndSendCreditNoteFromBoleta(
  boletaId: number,
  options: CreateCreditNoteFromBoletaOptions = {},
): Promise<CreditNoteSendOutcome> {
  const creditNoteId = await createCreditNoteFromBoleta(boletaId, options);
  const result = await sendCreditNoteToSunat(creditNoteId, options);
  return { boletaId, creditNoteId, ...result };
}

export interface CreditNoteSendOutcome {
  boletaId: number;
  creditNoteId?: number;
  success: boolean;
  numeroCompleto?: string;
  error?: { code: string; message: string };
}

export interface CreditNoteBatchResult {
  success: boolean;
  total: number;
  accepted: number;
  rejected: number;
  results: CreditNoteSendOutcome[];
}

/**
 * Anula varias boletas en lote reutilizando el flujo 1 × 1
 * (`createAndSendCreditNoteFromBoleta`). Cada boleta genera su propia nota de
 * crédito individual; el "grupo" es operativo (un disparo procesa N), no un solo
 * documento. Un fallo en una boleta no detiene al resto.
 */
export async function createAndSendCreditNotesFromBoletas(
  boletaIds: number[],
  options: CreateCreditNoteFromBoletaOptions = {},
): Promise<CreditNoteBatchResult> {
  const uniqueIds = Array.from(new Set(boletaIds));
  const results: CreditNoteSendOutcome[] = [];

  for (const boletaId of uniqueIds) {
    try {
      results.push(await createAndSendCreditNoteFromBoleta(boletaId, options));
    } catch (error: any) {
      results.push({
        boletaId,
        success: false,
        error: { code: 'CREATE_ERROR', message: error?.message || 'Error al crear nota de crédito' },
      });
    }
  }

  const accepted = results.filter(result => result.success).length;
  return {
    success: results.every(result => result.success),
    total: results.length,
    accepted,
    rejected: results.length - accepted,
    results,
  };
}

export async function listCreditNotesByAffectedBoletaIds(boletaIds: number[]) {
  if (!boletaIds.length) return [];
  return db.select().from(creditNotes).where(inArray(creditNotes.affectedBoletaId, boletaIds));
}

export async function generatePreviewCreditNoteHtml(id: number, pdfFormat: PdfFormat = 'A4') {
  const note = (await db.select().from(creditNotes).where(eq(creditNotes.id, id)).limit(1))[0];
  if (!note) throw new Error('Nota de crédito no encontrada');

  const companyData = (await db.select().from(companies).where(eq(companies.id, note.companyId)).limit(1))[0];
  const branchData = (await db.select().from(branches).where(eq(branches.id, note.branchId)).limit(1))[0];
  const clientData = (await db.select().from(clients).where(eq(clients.id, note.clientId)).limit(1))[0];
  if (!note.affectedBoletaId) {
    throw new Error('Esta nota de crédito no tiene boleta afectada para previsualizar');
  }
  const affectedBoleta = (await db.select().from(boletas).where(eq(boletas.id, note.affectedBoletaId)).limit(1))[0];
  if (!companyData || !branchData || !clientData || !affectedBoleta) {
    throw new Error('Datos incompletos para previsualizar la nota de crédito');
  }

  const html = await generateBoletaPreviewHtml({
    company: {
      ruc: companyData.ruc,
      razonSocial: companyData.razonSocial,
      nombreComercial: companyData.nombreComercial || undefined,
      direccion: companyData.direccion || '',
      ubigeo: companyData.ubigeo || '',
    },
    branch: {
      codigo: branchData.codigo,
      nombre: branchData.nombre,
      direccion: branchData.direccion || '',
    },
    client: {
      tipoDocumento: clientData.tipoDocumento,
      numeroDocumento: clientData.numeroDocumento,
      razonSocial: clientData.razonSocial,
      direccion: clientData.direccion || undefined,
    },
    serie: note.serie,
    correlativo: note.correlativo,
    numeroCompleto: note.numeroCompleto,
    fechaEmision: note.fechaEmision,
    moneda: note.moneda || 'PEN',
    detalles: (note.detalles as any[]) || [],
    mtoOperGravadas: String(note.mtoOperGravadas || '0'),
    mtoOperExoneradas: String(note.mtoOperExoneradas || '0'),
    mtoOperInafectas: String(note.mtoOperInafectas || '0'),
    mtoOperGratuitas: String(note.mtoOperGratuitas || '0'),
    mtoIgv: String(note.mtoIgv || '0'),
    mtoIgvGratuitas: String(note.mtoIgvGratuitas || '0'),
    mtoIsc: String(note.mtoIsc || '0'),
    mtoIcbper: String(note.mtoIcbper || '0'),
    totalImpuestos: String(note.totalImpuestos || '0'),
    subTotal: String(note.subTotal || '0'),
    mtoImpVenta: String(note.mtoImpVenta || '0'),
    logoPath: companyData.logoPath || undefined,
    documentTypeCode: '07',
    documentTitle: 'NOTA DE CRÉDITO ELECTRÓNICA',
    printDocumentLabel: 'NOTA DE CRÉDITO ELECTRÓNICA',
    observations: [
      { label: 'Doc. afectado', value: note.numDocAfectado },
      { label: 'Motivo', value: note.desMotivo },
    ],
  }, pdfFormat);

  return {
    html,
    numeroCompleto: note.numeroCompleto,
    totals: {
      mtoImpVenta: Number(note.mtoImpVenta || 0),
      mtoIgv: Number(note.mtoIgv || 0),
      mtoOperGravadas: Number(note.mtoOperGravadas || 0),
    },
    affectedBoleta: {
      numeroCompleto: affectedBoleta.numeroCompleto,
      orderNumber: affectedBoleta.orderNumber,
      estadoSunat: affectedBoleta.estadoSunat,
    },
  };
}

function resolveCreditNoteSerie(rawSeries: unknown, affectedSerie: string): string {
  const series = normalizeSeries(rawSeries);
  const normalizedAffectedSerie = String(affectedSerie || '').trim().toUpperCase();
  const fallbackSerie = inferCreditNoteSerieFromAffectedSerie(normalizedAffectedSerie);

  const exactSerie = series.find(serie => serie.toUpperCase() === fallbackSerie);
  if (exactSerie) return exactSerie;

  const preferredPrefix = fallbackSerie?.startsWith('F') ? 'F' : 'B';
  const preferred = series.find(serie => serie.toUpperCase().startsWith(preferredPrefix));
  if (preferred) return preferred;
  if (series.length > 0) return series[0];
  if (fallbackSerie) return fallbackSerie;
  throw new Error('La sucursal no tiene serie de nota de crédito configurada y no se pudo inferir una serie válida');
}

function inferCreditNoteSerieFromAffectedSerie(affectedSerie: string): string | null {
  if (/^[BF]/.test(affectedSerie)) return affectedSerie;

  const marketplaceMatch = affectedSerie.match(/^E([BF])(\d{2})$/);
  if (marketplaceMatch) {
    return `${marketplaceMatch[1]}${marketplaceMatch[2].padStart(3, '0')}`;
  }

  if (affectedSerie.startsWith('EB')) return 'B001';
  if (affectedSerie.startsWith('EF')) return 'F001';
  return null;
}

function normalizeIgvPercentage(value: unknown, tipAfeIgv: string): number {
  if (tipAfeIgv === '10') return 18;

  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  if (numeric > 0 && numeric < 1) return numeric * 100;
  return numeric;
}

function normalizeSeries(rawSeries: unknown): string[] {
  if (!Array.isArray(rawSeries)) return [];
  return rawSeries.map(value => String(value || '').trim()).filter(Boolean);
}

function formatLocalDate(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
