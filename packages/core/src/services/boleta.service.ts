import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { boletas, clients, companies, branches, dailySummaries } from '../db/schema';
import { getNextCorrelative } from './correlative.service';
import { SunatService } from './sunat.service';
import type { CompanyConfig, BoletaSunatData } from './sunat.service';
import { saveSummaryCdr } from './file.service';
import { generateBoletaPdf, generateBoletaPreviewHtml } from './pdf.service';
import type { PdfFormat } from './pdf.service';
import { calculateTotals } from '../utils/tax-calculator';
import type { DetalleItem } from '../utils/tax-calculator';
import { getCorrelativeBySerie } from './correlative-query.service';
import { resolveIssueDate, withIssueDateTrace } from '../utils/issue-date';

export interface CreateBoletaInput {
  company_id: number;
  branch_id: number;
  order_number?: string;
  serie: string;
  fecha_emision: string;
  moneda?: string;
  tipo_operacion?: string;
  ubl_version?: string;
  metodo_envio: 'individual' | 'resumen_diario';
  forma_pago_tipo?: string;
  client: {
    tipo_documento: string;
    numero_documento: string;
    razon_social: string;
    nombre_comercial?: string;
    direccion?: string;
    ubigeo?: string;
    distrito?: string;
    provincia?: string;
    departamento?: string;
    telefono?: string;
    email?: string;
  };
  detalles: DetalleItem[];
  leyendas?: Array<{ code: string; value: string }>;
  datos_adicionales?: any[];
  usuario_creacion?: string;
  // false en beta: se asigna el correlativo pero NO se avanza el contador (la boleta beta se limpia después).
  persistCorrelative?: boolean;
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function formatLocalDate(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const VOID_SUMMARY_CREATOR_PREFIX = 'sistema:baja:';


function isVoidSummary(summary: { usuarioCreacion?: string | null }): boolean {
  return String(summary.usuarioCreacion || '').startsWith(VOID_SUMMARY_CREATOR_PREFIX);
}

function getSummaryOrderNumbers(summary: { orderNumbers?: unknown }): string[] {
  if (Array.isArray(summary.orderNumbers)) {
    return summary.orderNumbers.map(value => String(value)).filter(Boolean);
  }
  return [];
}

async function findBoletasForVoidSummary(summary: { companyId: number; orderNumbers?: unknown }) {
  const identifiers = new Set(getSummaryOrderNumbers(summary));
  if (!identifiers.size) return [];
  const rows = await db.select().from(boletas)
    .where(eq(boletas.companyId, summary.companyId));
  return rows.filter(boleta => identifiers.has(boleta.orderNumber || '') || identifiers.has(boleta.numeroCompleto));
}

export async function createBoleta(input: CreateBoletaInput) {
  const company = (await db.select().from(companies).where(eq(companies.id, input.company_id)).limit(1))[0];
  if (!company || !company.activo) throw new Error('Empresa no encontrada o inactiva');

  const branch = (await db.select().from(branches).where(and(
    eq(branches.id, input.branch_id), eq(branches.companyId, input.company_id),
  )).limit(1))[0];
  if (!branch || !branch.activo) throw new Error('Sucursal no encontrada o no pertenece a la empresa');

  let clientRecord = (await db.select().from(clients).where(and(
    eq(clients.companyId, input.company_id),
    eq(clients.tipoDocumento, input.client.tipo_documento),
    eq(clients.numeroDocumento, input.client.numero_documento),
  )).limit(1))[0];

  if (!clientRecord) {
    const insertedClient = await db.insert(clients).values({
      companyId: input.company_id,
      tipoDocumento: input.client.tipo_documento,
      numeroDocumento: input.client.numero_documento,
      razonSocial: input.client.razon_social,
      nombreComercial: input.client.nombre_comercial || null,
      direccion: input.client.direccion || null,
      ubigeo: input.client.ubigeo || null,
      distrito: input.client.distrito || null,
      provincia: input.client.provincia || null,
      departamento: input.client.departamento || null,
      telefono: input.client.telefono || null,
      email: input.client.email || null,
      activo: true, createdAt: now(), updatedAt: now(),
    }).returning();
    clientRecord = insertedClient[0];
  } else {
    await db.update(clients).set({ razonSocial: input.client.razon_social, updatedAt: now() })
      .where(eq(clients.id, clientRecord.id));
  }

  if (!clientRecord) throw new Error('Error al crear/encontrar cliente');

  const correlativo = await getNextCorrelative(input.branch_id, '03', input.serie, input.persistCorrelative !== false);
  const numeroCompleto = `${input.serie}-${correlativo}`;
  const issueDate = resolveIssueDate(input.fecha_emision, '03');
  const datosAdicionales = withIssueDateTrace(input.datos_adicionales, issueDate);
  const totals = calculateTotals(input.detalles);
  const ts = now();

  const result = await db.insert(boletas).values({
    companyId: input.company_id, branchId: input.branch_id, clientId: clientRecord.id,
    tipoDocumento: '03', serie: input.serie, correlativo, numeroCompleto,
    orderNumber: input.order_number || null,
    fechaEmision: issueDate.fechaEmision, ublVersion: input.ubl_version || '2.1',
    tipoOperacion: input.tipo_operacion || '0101', moneda: input.moneda || 'PEN',
    metodoEnvio: input.metodo_envio,
    valorVenta: String(totals.valorVenta), mtoOperGravadas: String(totals.mtoOperGravadas),
    mtoOperExoneradas: String(totals.mtoOperExoneradas), mtoOperInafectas: String(totals.mtoOperInafectas),
    mtoOperGratuitas: String(totals.mtoOperGratuitas), mtoIgvGratuitas: String(totals.mtoIgvGratuitas),
    mtoIgv: String(totals.mtoIgv), mtoBaseIvap: String(totals.mtoBaseIvap), mtoIvap: String(totals.mtoIvap),
    mtoIsc: String(totals.mtoIsc), mtoIcbper: String(totals.mtoIcbper),
    totalImpuestos: String(totals.totalImpuestos), subTotal: String(totals.subTotal),
    mtoImpVenta: String(totals.mtoImpVenta),
    detalles: input.detalles, leyendas: input.leyendas || null,
    datosAdicionales,
    estadoSunat: 'PENDIENTE', usuarioCreacion: input.usuario_creacion || null,
    createdAt: ts, updatedAt: ts,
  }).returning({ id: boletas.id });

  return {
    id: result[0].id, companyId: input.company_id, branchId: input.branch_id,
    clientId: clientRecord.id, serie: input.serie, correlativo, numeroCompleto,
    fechaEmision: issueDate.fechaEmision, moneda: input.moneda || 'PEN',
    ...totals, detalles: input.detalles, leyendas: input.leyendas || [], estadoSunat: 'PENDIENTE',
  };
}

export async function sendBoletaToSunat(id: number) {
  const boleta = (await db.select().from(boletas).where(eq(boletas.id, id)).limit(1))[0];
  if (!boleta) throw new Error('Boleta no encontrada');
  if (boleta.estadoSunat === 'ACEPTADO') throw new Error('La boleta ya fue aceptada por SUNAT');

  const company = (await db.select().from(companies).where(eq(companies.id, boleta.companyId)).limit(1))[0];
  if (!company) throw new Error('Empresa no encontrada');
  const branch = (await db.select().from(branches).where(eq(branches.id, boleta.branchId)).limit(1))[0];
  if (!branch) throw new Error('Sucursal no encontrada');
  const clientRecord = (await db.select().from(clients).where(eq(clients.id, boleta.clientId)).limit(1))[0];
  if (!clientRecord) throw new Error('Cliente no encontrado');

  const config: CompanyConfig = {
    ruc: company.ruc, razonSocial: company.razonSocial,
    direccion: company.direccion || '', ubigeo: company.ubigeo || '',
    usuarioSol: company.usuarioSol || 'MODDATOS', claveSol: company.claveSol || 'MODDATOS',
    certificado: company.certificado || '', certificadoPassword: company.certificadoPassword || '',
    modoProduccion: Boolean(company.modoProduccion),
    codigoLocal: branch.codigo || '0000',
  };

  const detalles = (boleta.detalles as any[]) || [];
  const sunatService = new SunatService(config);
  const boletaData: BoletaSunatData = {
    tipoDocumento: '03', serie: boleta.serie, correlativo: boleta.correlativo,
    fechaEmision: String(boleta.fechaEmision), moneda: boleta.moneda || 'PEN',
    tipoOperacion: boleta.tipoOperacion || '0101', ublVersion: boleta.ublVersion || '2.1',
    client: { tipoDocumento: clientRecord.tipoDocumento, numeroDocumento: clientRecord.numeroDocumento, razonSocial: clientRecord.razonSocial, direccion: clientRecord.direccion || undefined },
    detalles: detalles.map((d: any) => ({
      codigo: d.codigo, descripcion: d.descripcion, unidad: d.unidad,
      cantidad: Number(d.cantidad), mtoValorUnitario: Number(d.mto_valor_unitario || d.mtoValorUnitario || 0),
      porcentajeIgv: Number(d.porcentaje_igv || d.porcentajeIgv || 0),
      tipAfeIgv: d.tip_afe_igv || d.tipAfeIgv || '10',
      mtoValorGratuito: Number(d.mto_valor_gratuito || 0), isc: Number(d.isc || 0), icbper: Number(d.icbper || 0),
    })),
    mtoOperGravadas: Number(boleta.mtoOperGravadas || 0), mtoOperExoneradas: Number(boleta.mtoOperExoneradas || 0),
    mtoOperInafectas: Number(boleta.mtoOperInafectas || 0), mtoOperGratuitas: Number(boleta.mtoOperGratuitas || 0),
    mtoIgvGratuitas: Number(boleta.mtoIgvGratuitas || 0), mtoIgv: Number(boleta.mtoIgv || 0),
    mtoBaseIvap: Number(boleta.mtoBaseIvap || 0), mtoIvap: Number(boleta.mtoIvap || 0),
    mtoIsc: Number(boleta.mtoIsc || 0), mtoIcbper: Number(boleta.mtoIcbper || 0),
    totalImpuestos: Number(boleta.totalImpuestos || 0), subTotal: Number(boleta.subTotal || 0),
    mtoImpVenta: Number(boleta.mtoImpVenta || 0), formaPagoTipo: 'Contado',
  };

  const xml = sunatService.buildUBLXml(boletaData);
  const result = await sunatService.sendDocument(xml, `${company.ruc}-03-${boleta.serie}-${boleta.correlativo}`);
  const { saveXml, saveCdr } = await import('./file.service');

  if (result.success && result.xml) {
    const xmlPath = await saveXml({ serie: boleta.serie, correlativo: boleta.correlativo, fechaEmision: String(boleta.fechaEmision) }, result.xml);
    const hash = sunatService.getHashFromXml(result.xml);
    const updates: any = { estadoSunat: 'ACEPTADO', xmlPath, respuestaSunat: JSON.stringify(result.cdrResponse || { status: 'accepted' }), codigoHash: hash || null, updatedAt: Math.floor(Date.now() / 1000) };
    if (result.cdrZip) updates.cdrPath = await saveCdr({ serie: boleta.serie, correlativo: boleta.correlativo, fechaEmision: String(boleta.fechaEmision) }, result.cdrZip);
    await db.update(boletas).set(updates).where(eq(boletas.id, id));
    return { success: true, message: 'Boleta enviada exitosamente a SUNAT' };
  }
  const errorData = result.error || { code: 'UNKNOWN', message: 'Error desconocido' };
  await db.update(boletas).set({ estadoSunat: 'RECHAZADO', respuestaSunat: JSON.stringify(errorData), updatedAt: Math.floor(Date.now() / 1000) }).where(eq(boletas.id, id));
  return { success: false, message: `Error al enviar a SUNAT: ${errorData.message}`, error_code: errorData.code };
}

// Un rechazo "transitorio" (documento aún en proceso en SUNAT) NO quema el número.
export function isTransientSunatRejection(respuestaSunat: string | null | undefined): boolean {
  if (!respuestaSunat) return false;
  let code = '', message = '';
  try { const p = JSON.parse(respuestaSunat); code = String(p.code || ''); message = String(p.message || ''); }
  catch { message = String(respuestaSunat); }
  const t = `${code} ${message}`.toLowerCase();
  return /en proceso|vuelva a intentar|int[eé]ntelo|time ?out|0140/.test(t);
}

// Re-emite una boleta RECHAZADA. Transitorio → reintenta el mismo número. Definitivo →
// mantiene la rechazada como evidencia (sin la orden) y crea una NUEVA con el siguiente
// correlativo disponible, que se lleva la orden, y esa se emite.
export async function reEmitBoleta(id: number) {
  const boleta = (await db.select().from(boletas).where(eq(boletas.id, id)).limit(1))[0];
  if (!boleta) throw new Error('Boleta no encontrada');
  if (boleta.estadoSunat === 'ACEPTADO') throw new Error('La boleta ya fue aceptada por SUNAT');

  const burned = boleta.estadoSunat === 'RECHAZADO' && !isTransientSunatRejection(boleta.respuestaSunat);
  if (!burned) return sendBoletaToSunat(id);

  const now = Math.floor(Date.now() / 1000);
  const nextCorrelativo = await getNextCorrelative(boleta.branchId, '03', boleta.serie, true);
  const numeroCompleto = `${boleta.serie}-${nextCorrelativo}`;
  const issueDate = resolveIssueDate(boleta.fechaEmision, '03');
  const datosAdicionales = withIssueDateTrace(boleta.datosAdicionales, issueDate);

  await db.update(boletas).set({ orderNumber: null, estadoSunat: 'REEMPLAZADO', updatedAt: now }).where(eq(boletas.id, id));

  const { id: _oldId, createdAt: _c, updatedAt: _u, ...rest } = boleta as any;
  const inserted = await db.insert(boletas).values({
    ...rest,
    correlativo: nextCorrelativo,
    numeroCompleto,
    orderNumber: boleta.orderNumber,
    fechaEmision: issueDate.fechaEmision,
    dailySummaryId: null,
    datosAdicionales,
    estadoSunat: 'PENDIENTE',
    respuestaSunat: null,
    xmlPath: null,
    cdrPath: null,
    pdfPath: null,
    codigoHash: null,
    createdAt: now,
    updatedAt: now,
  }).returning({ id: boletas.id });

  return sendBoletaToSunat(inserted[0].id);
}

export async function checkDailySummaryStatus(summaryId: number) {
  const summary = (await db.select().from(dailySummaries).where(eq(dailySummaries.id, summaryId)).limit(1))[0];
  if (!summary) throw new Error('Resumen diario no encontrado');
  if (!summary.ticket) {
    return { success: false, estado: summary.estado || 'PENDIENTE', message: 'El resumen no tiene ticket SUNAT' };
  }

  const company = (await db.select().from(companies).where(eq(companies.id, summary.companyId)).limit(1))[0];
  if (!company) throw new Error('Empresa no encontrada');

  const sunatService = new SunatService(buildCompanyConfig(company));
  const result = await sunatService.getStatus(summary.ticket);

  if (!result.success) {
    const error = result.error || { code: 'UNKNOWN', message: 'Error desconocido al consultar ticket' };
    await db.update(dailySummaries).set({
      estado: 'ERROR',
      responseCode: error.code,
      responseDescription: error.message,
      respuestaSunat: JSON.stringify(error),
      updatedAt: now(),
    }).where(eq(dailySummaries.id, summaryId));
    return { success: false, estado: 'ERROR', error };
  }

  if (!result.cdrZip) {
    const statusCode = result.statusCode || '';
    const normalizedStatusCode = statusCode.replace(/^0+/, '') || statusCode;
    const estado = normalizedStatusCode === '98' ? 'EN_PROCESO' : 'ENVIADO';
    const responseDescription = result.statusMessage || (normalizedStatusCode === '98'
      ? 'SUNAT todavía está procesando el resumen diario. Consulta el ticket nuevamente en unos minutos.'
      : null);
    await db.update(dailySummaries).set({
      estado,
      responseCode: statusCode || null,
      responseDescription,
      respuestaSunat: JSON.stringify({ statusCode, statusMessage: responseDescription }),
      updatedAt: now(),
    }).where(eq(dailySummaries.id, summaryId));
    return { success: true, estado, statusCode, statusMessage: responseDescription };
  }

  const responseCode = result.cdrResponse?.code || result.statusCode || '';
  const responseDescription = result.cdrResponse?.description || result.statusMessage || '';
  const accepted = responseCode === '0';
  const estado = accepted ? 'ACEPTADO' : 'RECHAZADO';
  const cdrPath = await saveSummaryCdr({
    numeroCompleto: summary.numeroCompleto || `RC-${summary.fechaResumen}-${summary.correlativo}`,
    fechaResumen: summary.fechaResumen,
    companyRuc: company.ruc,
  }, result.cdrZip);
  const voidSummary = isVoidSummary(summary);

  await db.update(dailySummaries).set({
    estado,
    cdrPath,
    responseCode,
    responseDescription,
    respuestaSunat: JSON.stringify(result.cdrResponse || { statusCode: result.statusCode, statusMessage: result.statusMessage }),
    updatedAt: now(),
  }).where(eq(dailySummaries.id, summaryId));

  const linkedBoletas = voidSummary
    ? await findBoletasForVoidSummary(summary)
    : await db.select().from(boletas).where(eq(boletas.dailySummaryId, summaryId));

  if (accepted) {
    for (const boleta of linkedBoletas) {
      await db.update(boletas).set({
        estadoSunat: voidSummary ? 'ANULADO' : 'ACEPTADO',
        cdrPath,
        respuestaSunat: JSON.stringify(result.cdrResponse || {}),
        updatedAt: now(),
      }).where(eq(boletas.id, boleta.id));
    }
  }

  return { success: accepted, estado, responseCode, responseDescription, cdrPath };
}

export async function generateAcceptedBoletaPdfBase64(id: number, pdfFormat: PdfFormat = 'A4') {
  const boleta = (await db.select().from(boletas).where(eq(boletas.id, id)).limit(1))[0];
  if (!boleta) throw new Error('Boleta no encontrada');
  if (boleta.estadoSunat !== 'ACEPTADO') throw new Error('Solo se puede generar PDF de boletas aceptadas');

  const companyData = (await db.select().from(companies).where(eq(companies.id, boleta.companyId)).limit(1))[0];
  const branchData = (await db.select().from(branches).where(eq(branches.id, boleta.branchId)).limit(1))[0];
  const clientData = (await db.select().from(clients).where(eq(clients.id, boleta.clientId)).limit(1))[0];
  if (!companyData || !branchData || !clientData) throw new Error('Datos incompletos para generar PDF');

  const pdfBuffer = await generateBoletaPdf({
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
    serie: boleta.serie,
    correlativo: boleta.correlativo,
    numeroCompleto: boleta.numeroCompleto,
    fechaEmision: boleta.fechaEmision,
    moneda: boleta.moneda || 'PEN',
    detalles: (boleta.detalles as any[]) || [],
    mtoOperGravadas: String(boleta.mtoOperGravadas || '0'),
    mtoOperExoneradas: String(boleta.mtoOperExoneradas || '0'),
    mtoOperInafectas: String(boleta.mtoOperInafectas || '0'),
    mtoOperGratuitas: String(boleta.mtoOperGratuitas || '0'),
    mtoIgv: String(boleta.mtoIgv || '0'),
    mtoIgvGratuitas: String(boleta.mtoIgvGratuitas || '0'),
    mtoIsc: String(boleta.mtoIsc || '0'),
    mtoIcbper: String(boleta.mtoIcbper || '0'),
    totalImpuestos: String(boleta.totalImpuestos || '0'),
    subTotal: String(boleta.subTotal || '0'),
    mtoImpVenta: String(boleta.mtoImpVenta || '0'),
    codigoHash: boleta.codigoHash || undefined,
    logoPath: companyData.logoPath || undefined,
  }, pdfFormat);

  return pdfBuffer.toString('base64');
}

export async function generateAcceptedBoletaPreviewHtml(id: number, pdfFormat: PdfFormat = 'A4') {
  const boleta = (await db.select().from(boletas).where(eq(boletas.id, id)).limit(1))[0];
  if (!boleta) throw new Error('Boleta no encontrada');

  const companyData = (await db.select().from(companies).where(eq(companies.id, boleta.companyId)).limit(1))[0];
  const branchData = (await db.select().from(branches).where(eq(branches.id, boleta.branchId)).limit(1))[0];
  const clientData = (await db.select().from(clients).where(eq(clients.id, boleta.clientId)).limit(1))[0];
  if (!companyData || !branchData || !clientData) throw new Error('Datos incompletos para previsualizar la boleta');

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
    serie: boleta.serie,
    correlativo: boleta.correlativo,
    numeroCompleto: boleta.numeroCompleto,
    fechaEmision: boleta.fechaEmision,
    moneda: boleta.moneda || 'PEN',
    detalles: (boleta.detalles as any[]) || [],
    mtoOperGravadas: String(boleta.mtoOperGravadas || '0'),
    mtoOperExoneradas: String(boleta.mtoOperExoneradas || '0'),
    mtoOperInafectas: String(boleta.mtoOperInafectas || '0'),
    mtoOperGratuitas: String(boleta.mtoOperGratuitas || '0'),
    mtoIgv: String(boleta.mtoIgv || '0'),
    mtoIgvGratuitas: String(boleta.mtoIgvGratuitas || '0'),
    mtoIsc: String(boleta.mtoIsc || '0'),
    mtoIcbper: String(boleta.mtoIcbper || '0'),
    totalImpuestos: String(boleta.totalImpuestos || '0'),
    subTotal: String(boleta.subTotal || '0'),
    mtoImpVenta: String(boleta.mtoImpVenta || '0'),
    codigoHash: boleta.codigoHash || undefined,
    logoPath: companyData.logoPath || undefined,
  }, pdfFormat);

  return {
    html,
    numeroCompleto: boleta.numeroCompleto,
    fechaEmision: boleta.fechaEmision,
    total: boleta.mtoImpVenta,
    client: {
      razonSocial: clientData.razonSocial,
      numeroDocumento: clientData.numeroDocumento,
    },
  };
}

export async function markBoletaFalabellaPdfUpload(id: number, response: unknown) {
  const boleta = (await db.select().from(boletas).where(eq(boletas.id, id)).limit(1))[0];
  if (!boleta) throw new Error('Boleta no encontrada');

  const current = boleta.datosAdicionales && typeof boleta.datosAdicionales === 'object' && !Array.isArray(boleta.datosAdicionales)
    ? boleta.datosAdicionales as Record<string, unknown>
    : {};
  const falabellaPdfUpload = {
    uploadedAt: new Date().toISOString(),
    response,
  };

  await db.update(boletas)
    .set({
      datosAdicionales: {
        ...current,
        falabellaPdfUpload,
      },
      updatedAt: now(),
    })
    .where(eq(boletas.id, id));

  return falabellaPdfUpload;
}

export async function generatePreviewBoletaHtmlForVenta(
  companyId: number,
  venta: {
    serie?: string;
    fechaEmision: string;
    moneda?: string;
    client: {
      tipoDocumento: string;
      numeroDocumento: string;
      razonSocial: string;
      direccion?: string;
    };
    detalles: Array<{
      codigo: string;
      descripcion: string;
      unidad: string;
      cantidad: number;
      mtoValorUnitario: number;
      porcentajeIgv: number;
      tipAfeIgv: string;
    }>;
  },
  pdfFormat: PdfFormat = 'A4',
) {
  const companyData = (await db.select().from(companies).where(eq(companies.id, companyId)).limit(1))[0];
  if (!companyData) throw new Error('Empresa no encontrada');

  const availableBranches = await db.select().from(branches)
    .where(and(eq(branches.companyId, companyId), eq(branches.activo, true)));
  const branchData = availableBranches.find(branch => branch.codigo === '0001') || availableBranches[0];
  if (!branchData) throw new Error('La empresa no tiene una sucursal activa para previsualizar.');

  const serie = venta.serie || 'B001';
  const currentCorrelative = await getCorrelativeBySerie(branchData.id, '03', serie);
  const correlativo = String((currentCorrelative?.correlativoActual || 0) + 1).padStart(6, '0');
  const numeroCompleto = `${serie}-${correlativo}`;
  const detalles = (venta.detalles || []).map((detalle) => ({
    codigo: detalle.codigo,
    descripcion: detalle.descripcion,
    unidad: detalle.unidad,
    cantidad: Number(detalle.cantidad || 0),
    mto_valor_unitario: Number(detalle.mtoValorUnitario || 0),
    porcentaje_igv: Number(detalle.porcentajeIgv || 0),
    tip_afe_igv: detalle.tipAfeIgv || '10',
  }));
  const totals = calculateTotals(detalles);

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
      tipoDocumento: venta.client.tipoDocumento,
      numeroDocumento: venta.client.numeroDocumento,
      razonSocial: venta.client.razonSocial,
      direccion: venta.client.direccion || undefined,
    },
    serie,
    correlativo,
    numeroCompleto,
    fechaEmision: venta.fechaEmision,
    moneda: venta.moneda || 'PEN',
    detalles,
    mtoOperGravadas: String(totals.mtoOperGravadas),
    mtoOperExoneradas: String(totals.mtoOperExoneradas),
    mtoOperInafectas: String(totals.mtoOperInafectas),
    mtoOperGratuitas: String(totals.mtoOperGratuitas),
    mtoIgv: String(totals.mtoIgv),
    mtoIgvGratuitas: String(totals.mtoIgvGratuitas),
    mtoIsc: String(totals.mtoIsc),
    mtoIcbper: String(totals.mtoIcbper),
    totalImpuestos: String(totals.totalImpuestos),
    subTotal: String(totals.subTotal),
    mtoImpVenta: String(totals.mtoImpVenta),
    logoPath: companyData.logoPath || undefined,
  }, pdfFormat);

  return {
    html,
    numeroCompleto,
    branch: {
      id: branchData.id,
      codigo: branchData.codigo,
      nombre: branchData.nombre,
    },
    totals: {
      mtoImpVenta: totals.mtoImpVenta,
      mtoIgv: totals.mtoIgv,
      mtoOperGravadas: totals.mtoOperGravadas,
    },
  };
}

function buildCompanyConfig(company: any): CompanyConfig {
  return {
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
}

