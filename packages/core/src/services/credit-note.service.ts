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

export async function sendCreditNoteToSunat(creditNoteId: number) {
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
    modoProduccion: Boolean(company.modoProduccion),
  };

  const detalles = ((note.detalles as any[]) || []).map((d: any) => ({
    codigo: d.codigo,
    descripcion: d.descripcion,
    unidad: d.unidad,
    cantidad: Number(d.cantidad),
    mtoValorUnitario: Number(d.mto_valor_unitario || d.mtoValorUnitario || 0),
    porcentajeIgv: Number(d.porcentaje_igv || d.porcentajeIgv || 0),
    tipAfeIgv: d.tip_afe_igv || d.tipAfeIgv || '10',
    mtoValorGratuito: Number(d.mto_valor_gratuito || d.mtoValorGratuito || 0),
    isc: Number(d.isc || 0),
    icbper: Number(d.icbper || 0),
  }));

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
      tipoDocumento: client.tipoDocumento,
      numeroDocumento: client.numeroDocumento,
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

  if (result.xml) {
    const xmlPath = await saveCreditNoteXml({ serie: note.serie, correlativo: note.correlativo, fechaEmision: note.fechaEmision }, result.xml);
    await db.update(creditNotes).set({ xmlPath, updatedAt: Math.floor(Date.now() / 1000) }).where(eq(creditNotes.id, creditNoteId));
  }

  if (result.success && result.xml) {
    const updates: Record<string, unknown> = {
      estadoSunat: 'ACEPTADO',
      respuestaSunat: JSON.stringify(result.cdrResponse || { status: 'accepted' }),
      codigoHash: sunatService.getHashFromXml(result.xml) || null,
      updatedAt: Math.floor(Date.now() / 1000),
    };
    if (result.cdrZip) {
      updates.cdrPath = await saveCreditNoteCdr({ serie: note.serie, correlativo: note.correlativo, fechaEmision: note.fechaEmision }, result.cdrZip);
    }
    await db.update(creditNotes).set(updates).where(eq(creditNotes.id, creditNoteId));
    await db.update(boletas).set({
      estadoSunat: note.codMotivo === '01' ? 'ANULADO' : 'ACEPTADO',
      updatedAt: Math.floor(Date.now() / 1000),
    }).where(eq(boletas.id, note.affectedBoletaId));
    return { success: true, id: creditNoteId, numeroCompleto: note.numeroCompleto };
  }

  const errorData = result.error || { code: 'UNKNOWN', message: 'Error desconocido' };
  await db.update(creditNotes).set({
    estadoSunat: 'RECHAZADO',
    respuestaSunat: JSON.stringify(errorData),
    updatedAt: Math.floor(Date.now() / 1000),
  }).where(eq(creditNotes.id, creditNoteId));

  return { success: false, id: creditNoteId, numeroCompleto: note.numeroCompleto, error: errorData };
}

export async function createAndSendCreditNoteFromBoleta(
  boletaId: number,
  options: CreateCreditNoteFromBoletaOptions = {},
) {
  const creditNoteId = await createCreditNoteFromBoleta(boletaId, options);
  return sendCreditNoteToSunat(creditNoteId);
}

export async function createAndSendCreditNotesFromBoletas(
  boletaIds: number[],
  options: CreateCreditNoteFromBoletaOptions = {},
) {
  const uniqueIds = Array.from(new Set(boletaIds));
  const createdIds: number[] = [];
  const results = [];

  for (const boletaId of uniqueIds) {
    try {
      const creditNoteId = await createCreditNoteFromBoleta(boletaId, options);
      createdIds.push(creditNoteId);
      results.push(await sendCreditNoteToSunat(creditNoteId));
    } catch (error: any) {
      results.push({
        success: false,
        boletaId,
        error: { code: 'CREATE_ERROR', message: error?.message || 'Error al crear nota de crédito' },
      });
    }
  }

  return {
    success: results.every(result => result.success),
    createdIds,
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
  const preferredPrefix = String(affectedSerie || '').startsWith('F') ? 'F' : 'B';
  const preferred = series.find(serie => serie.startsWith(preferredPrefix));
  if (preferred) return preferred;
  if (series.length > 0) return series[0];
  if (affectedSerie && /^[BF]/i.test(affectedSerie)) return affectedSerie;
  throw new Error('La sucursal no tiene serie de nota de crédito configurada y no se pudo inferir una serie válida');
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
