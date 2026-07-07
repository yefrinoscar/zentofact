import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db';
import { create } from 'xmlbuilder2';
import { boletas, clients, companies, branches, dailySummaries } from '../db/schema';
import { getNextCorrelative, getNextSummaryCorrelative } from './correlative.service';
import { SunatService } from './sunat.service';
import type { CompanyConfig, BoletaSunatData } from './sunat.service';
import { saveSummaryXml, saveSummaryCdr } from './file.service';
import { generateBoletaPdf, generateBoletaPreviewHtml } from './pdf.service';
import { savePdf } from './file.service';
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

function buildVoidSummaryCreator(referenceDate: string): string {
  return `${VOID_SUMMARY_CREATOR_PREFIX}${referenceDate}`;
}

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

export async function sendBoletasAsDailySummary(
  companyId: number,
  branchId: number,
  fechaReferencia: string,
  boletaIds: number[],
  onProgress?: (status: string) => void,
) {
  const uniqueIds = Array.from(new Set(boletaIds));
  const company = (await db.select().from(companies).where(eq(companies.id, companyId)).limit(1))[0];
  if (!company) throw new Error('Empresa no encontrada');
  const branch = (await db.select().from(branches).where(eq(branches.id, branchId)).limit(1))[0];
  if (!branch) throw new Error('Sucursal no encontrada');

  const config = buildCompanyConfig(company);
  const sunatService = new SunatService(config);

  const issueDate = formatLocalDate();
  const issueCompact = issueDate.replace(/-/g, '');
  const nextSummaryCorrelative = await getNextSummaryCorrelative(companyId, issueDate);

  const prepared = await db.transaction(async (tx) => {
    const fetched = await Promise.all(
      uniqueIds.map(id => tx.select().from(boletas).where(eq(boletas.id, id)).limit(1).then(r => r[0])),
    );
    const summaryBoletas = fetched
      .filter((boleta): boleta is NonNullable<typeof boleta> => !!boleta)
      .filter(boleta => boleta.companyId === companyId && boleta.branchId === branchId)
      .filter(boleta => !boleta.dailySummaryId && boleta.estadoSunat !== 'ACEPTADO' && boleta.estadoSunat !== 'ENVIANDO');

    if (!summaryBoletas.length) return null;

    const summaryCorrelative = nextSummaryCorrelative;
    const numeroCompleto = `RC-${issueCompact}-${summaryCorrelative}`;
    const nowTs = now();
    const orderNumbers = Array.from(new Set(summaryBoletas.map(boleta => boleta.orderNumber || boleta.numeroCompleto).filter(Boolean)));

    const insertResult = await tx.insert(dailySummaries).values({
      companyId,
      branchId,
      fechaResumen: issueDate,
      correlativo: summaryCorrelative,
      numeroCompleto,
      estado: 'ENVIANDO',
      boletaCount: summaryBoletas.length,
      orderNumbers,
      createdAt: nowTs,
      updatedAt: nowTs,
    }).returning({ id: dailySummaries.id });
    const summaryId = insertResult[0].id;

    for (const boleta of summaryBoletas) {
      await tx.update(boletas).set({
        dailySummaryId: summaryId,
        metodoEnvio: 'resumen_diario',
        estadoSunat: 'ENVIANDO',
        updatedAt: nowTs,
      }).where(eq(boletas.id, boleta.id));
    }

    return { summaryBoletas, summaryId, summaryCorrelative, numeroCompleto };
  });

  if (!prepared) {
    const fetchedLinked = await Promise.all(
      uniqueIds.map(id => db.select().from(boletas).where(eq(boletas.id, id)).limit(1).then(r => r[0])),
    );
    const linkedBoleta = fetchedLinked.find(boleta => boleta?.dailySummaryId);
    if (linkedBoleta?.dailySummaryId) {
      const summary = (await db.select().from(dailySummaries).where(eq(dailySummaries.id, linkedBoleta.dailySummaryId)).limit(1))[0];
      if (summary) {
        const status = summary.ticket
          ? await checkDailySummaryStatus(summary.id)
          : { success: true, estado: summary.estado || 'ENVIANDO', responseCode: summary.responseCode || undefined, responseDescription: summary.responseDescription || undefined };
        return {
          success: status.success,
          skipped: true,
          summaryId: summary.id,
          numeroCompleto: summary.numeroCompleto || undefined,
          ticket: summary.ticket || undefined,
          status,
          message: 'El resumen ya estaba registrado. No se volvió a enviar a SUNAT.',
        };
      }
    }
    return { success: true, skipped: true, message: 'No hay boletas pendientes para resumen diario' };
  }

  const { summaryBoletas, summaryId, numeroCompleto } = prepared;
  const fileName = `${company.ruc}-${numeroCompleto}`;

  onProgress?.(`Armando resumen diario ${numeroCompleto} (${summaryBoletas.length} boletas)...`);

  const xml = await buildDailySummaryXml(company, summaryBoletas, numeroCompleto, fechaReferencia, issueDate);
  onProgress?.(`Firmando y enviando resumen diario ${numeroCompleto} a SUNAT...`);
  let sendResult;
  try {
    sendResult = await sunatService.sendSummaryDocument(xml, fileName);
  } catch (e: any) {
    const error = { code: 'SEND_ERROR', message: e?.message || 'Error al enviar resumen diario a SUNAT' };
    await db.update(dailySummaries).set({
      estado: 'ERROR',
      responseCode: error.code,
      responseDescription: error.message,
      respuestaSunat: JSON.stringify(error),
      updatedAt: now(),
    }).where(eq(dailySummaries.id, summaryId));
    for (const boleta of summaryBoletas) {
      await db.update(boletas).set({
        dailySummaryId: null,
        estadoSunat: 'PENDIENTE',
        updatedAt: now(),
      }).where(eq(boletas.id, boleta.id));
    }
    return { success: false, summaryId, numeroCompleto, error };
  }
  if (sendResult.xml) {
    const xmlPath = await saveSummaryXml({ numeroCompleto, fechaResumen: issueDate, companyRuc: company.ruc }, sendResult.xml);
    await db.update(dailySummaries).set({ xmlPath, updatedAt: now() }).where(eq(dailySummaries.id, summaryId));
  }

  if (!sendResult.success || !sendResult.ticket) {
    const error = sendResult.error || { code: 'UNKNOWN', message: 'SUNAT no devolvió ticket' };
    await db.update(dailySummaries).set({
      estado: 'RECHAZADO',
      responseCode: error.code,
      responseDescription: error.message,
      respuestaSunat: JSON.stringify(error),
      updatedAt: now(),
    }).where(eq(dailySummaries.id, summaryId));
    for (const boleta of summaryBoletas) {
      await db.update(boletas).set({
        dailySummaryId: null,
        estadoSunat: 'PENDIENTE',
        updatedAt: now(),
      }).where(eq(boletas.id, boleta.id));
    }
    return { success: false, summaryId, numeroCompleto, error };
  }

  await db.update(dailySummaries).set({
    ticket: sendResult.ticket,
    estado: 'ENVIADO',
    updatedAt: now(),
  }).where(eq(dailySummaries.id, summaryId));

  for (const boleta of summaryBoletas) {
    await db.update(boletas).set({
      metodoEnvio: 'resumen_diario',
      estadoSunat: 'ENVIADO',
      updatedAt: now(),
    }).where(eq(boletas.id, boleta.id));
  }

  onProgress?.(`Consultando ticket ${sendResult.ticket} del resumen ${numeroCompleto}...`);
  const status = await checkDailySummaryStatus(summaryId);
  return {
    success: status.success,
    summaryId,
    numeroCompleto,
    ticket: sendResult.ticket,
    status,
    boletas: summaryBoletas,
  };
}

export async function sendBoletasAsVoidedDailySummary(
  companyId: number,
  branchId: number,
  fechaReferencia: string,
  boletaIds: number[],
  onProgress?: (status: string) => void,
) {
  const uniqueIds = Array.from(new Set(boletaIds));
  const company = (await db.select().from(companies).where(eq(companies.id, companyId)).limit(1))[0];
  if (!company) throw new Error('Empresa no encontrada');
  const branch = (await db.select().from(branches).where(eq(branches.id, branchId)).limit(1))[0];
  if (!branch) throw new Error('Sucursal no encontrada');

  const config = buildCompanyConfig(company);
  const sunatService = new SunatService(config);

  const issueDate = formatLocalDate();
  const issueCompact = issueDate.replace(/-/g, '');
  const nextSummaryCorrelative = await getNextSummaryCorrelative(companyId, issueDate);

  const prepared = await db.transaction(async (tx) => {
    const fetched = await Promise.all(
      uniqueIds.map(id => tx.select().from(boletas).where(eq(boletas.id, id)).limit(1).then(r => r[0])),
    );
    const summaryBoletas = fetched
      .filter((boleta): boleta is NonNullable<typeof boleta> => !!boleta)
      .filter(boleta => boleta.companyId === companyId && boleta.branchId === branchId)
      .filter(boleta => boleta.fechaEmision === fechaReferencia)
      .filter(boleta => boleta.estadoSunat === 'ACEPTADO');

    if (!summaryBoletas.length) return null;

    const summaryCorrelative = nextSummaryCorrelative;
    const numeroCompleto = `RC-${issueCompact}-${summaryCorrelative}`;
    const nowTs = now();
    const orderNumbers = Array.from(new Set(summaryBoletas.map(boleta => boleta.orderNumber || boleta.numeroCompleto).filter(Boolean)));

    const insertResult = await tx.insert(dailySummaries).values({
      companyId,
      branchId,
      fechaResumen: issueDate,
      correlativo: summaryCorrelative,
      numeroCompleto,
      estado: 'ENVIANDO',
      boletaCount: summaryBoletas.length,
      orderNumbers,
      responseDescription: `Baja de boletas emitidas el ${fechaReferencia}`,
      usuarioCreacion: buildVoidSummaryCreator(fechaReferencia),
      createdAt: nowTs,
      updatedAt: nowTs,
    }).returning({ id: dailySummaries.id });
    const summaryId = insertResult[0].id;

    return { summaryBoletas, summaryId, numeroCompleto };
  });

  if (!prepared) {
    return { success: true, skipped: true, message: `No hay boletas aceptadas elegibles para baja en ${fechaReferencia}` };
  }

  const { summaryBoletas, summaryId, numeroCompleto } = prepared;
  const fileName = `${company.ruc}-${numeroCompleto}`;

  onProgress?.(`Armando resumen de baja ${numeroCompleto} (${summaryBoletas.length} boletas del ${fechaReferencia})...`);

  const xml = await buildDailySummaryXml(company, summaryBoletas, numeroCompleto, fechaReferencia, issueDate, '3');
  onProgress?.(`Firmando y enviando resumen de baja ${numeroCompleto} a SUNAT...`);
  let sendResult;
  try {
    sendResult = await sunatService.sendSummaryDocument(xml, fileName);
  } catch (e: any) {
    const error = { code: 'SEND_ERROR', message: e?.message || 'Error al enviar resumen de baja a SUNAT' };
    await db.update(dailySummaries).set({
      estado: 'ERROR',
      responseCode: error.code,
      responseDescription: error.message,
      respuestaSunat: JSON.stringify(error),
      updatedAt: now(),
    }).where(eq(dailySummaries.id, summaryId));
    return { success: false, summaryId, numeroCompleto, error };
  }
  if (sendResult.xml) {
    const xmlPath = await saveSummaryXml({ numeroCompleto, fechaResumen: issueDate, companyRuc: company.ruc }, sendResult.xml);
    await db.update(dailySummaries).set({ xmlPath, updatedAt: now() }).where(eq(dailySummaries.id, summaryId));
  }

  if (!sendResult.success || !sendResult.ticket) {
    const error = sendResult.error || { code: 'UNKNOWN', message: 'SUNAT no devolvió ticket' };
    await db.update(dailySummaries).set({
      estado: 'RECHAZADO',
      responseCode: error.code,
      responseDescription: error.message,
      respuestaSunat: JSON.stringify(error),
      updatedAt: now(),
    }).where(eq(dailySummaries.id, summaryId));
    return { success: false, summaryId, numeroCompleto, error };
  }

  await db.update(dailySummaries).set({
    ticket: sendResult.ticket,
    estado: 'ENVIADO',
    updatedAt: now(),
  }).where(eq(dailySummaries.id, summaryId));

  onProgress?.(`Consultando ticket ${sendResult.ticket} del resumen de baja ${numeroCompleto}...`);
  const status = await checkDailySummaryStatus(summaryId);
  return {
    success: status.success,
    summaryId,
    numeroCompleto,
    ticket: sendResult.ticket,
    status,
    boletas: summaryBoletas,
  };
}

export async function sendBoletasAsVoidedDailySummaries(
  companyId: number,
  branchId: number,
  boletaIds: number[],
  onProgress?: (status: string) => void,
) {
  const uniqueIds = Array.from(new Set(boletaIds));
  const fetchedSelected = await Promise.all(
    uniqueIds.map(id => db.select().from(boletas).where(eq(boletas.id, id)).limit(1).then(r => r[0])),
  );
  const selectedBoletas = fetchedSelected
    .filter((boleta): boleta is NonNullable<typeof boleta> => !!boleta)
    .filter(boleta => boleta.companyId === companyId && boleta.branchId === branchId);

  const groups = new Map<string, number[]>();
  for (const boleta of selectedBoletas) {
    const list = groups.get(boleta.fechaEmision) || [];
    list.push(boleta.id);
    groups.set(boleta.fechaEmision, list);
  }

  const orderedDates = Array.from(groups.keys()).sort();
  const results = [];
  for (const referenceDate of orderedDates) {
    const ids = groups.get(referenceDate) || [];
    onProgress?.(`Preparando baja para ${ids.length} boletas del ${referenceDate}...`);
    results.push(await sendBoletasAsVoidedDailySummary(companyId, branchId, referenceDate, ids, onProgress));
  }

  return {
    success: results.every(result => result.success || result.skipped),
    results,
  };
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

export async function generateAcceptedBoletaPdf(id: number, outputDir: string, pdfFormat: PdfFormat = 'A4') {
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

  const pdfPath = savePdf(
    { serie: boleta.serie, correlativo: boleta.correlativo, fechaEmision: boleta.fechaEmision },
    pdfBuffer,
    pdfFormat,
  );

  const fs = await import('fs');
  const path = await import('path');
  const summary = boleta.dailySummaryId
    ? (await db.select().from(dailySummaries).where(eq(dailySummaries.id, boleta.dailySummaryId)).limit(1))[0]
    : null;
  const targetDir = summary?.numeroCompleto ? path.join(outputDir, summary.numeroCompleto) : outputDir;
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
  const pdfFilename = `${boleta.orderNumber || boleta.id}_${boleta.serie}-${clientData.numeroDocumento}.pdf`;
  const outPath = path.join(targetDir, pdfFilename);
  fs.writeFileSync(outPath, pdfBuffer);

  await db.update(boletas).set({ pdfPath: outPath, updatedAt: now() }).where(eq(boletas.id, id));
  if (summary) {
    await db.update(dailySummaries).set({ pdfFolder: targetDir, updatedAt: now() }).where(eq(dailySummaries.id, summary.id));
  }
  return { pdfPath: outPath, internalPdfPath: pdfPath };
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

export async function generateDailySummaryPdfs(summaryId: number, outputDir: string, pdfFormat: PdfFormat = 'A4') {
  const summary = (await db.select().from(dailySummaries).where(eq(dailySummaries.id, summaryId)).limit(1))[0];
  if (!summary) throw new Error('Resumen diario no encontrado');

  const linkedBoletas = await db.select().from(boletas).where(eq(boletas.dailySummaryId, summaryId));
  if (!linkedBoletas.length) throw new Error('El resumen no tiene boletas asociadas');
  const acceptedBoletas = linkedBoletas.filter((boleta) => boleta.estadoSunat === 'ACEPTADO');
  if (!acceptedBoletas.length) {
    throw new Error('El resumen no tiene boletas aceptadas para generar PDF');
  }

  const generated = [];
  for (const boleta of acceptedBoletas) {
    generated.push(await generateAcceptedBoletaPdf(boleta.id, outputDir, pdfFormat));
  }

  const folder = generated[0]?.pdfPath ? (await import('path')).dirname(generated[0].pdfPath) : summary.pdfFolder || '';
  if (folder) await db.update(dailySummaries).set({ pdfFolder: folder, updatedAt: now() }).where(eq(dailySummaries.id, summaryId));
  return { folder, generated };
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

async function buildDailySummaryXml(
  company: any,
  summaryBoletas: any[],
  summaryId: string,
  referenceDate: string,
  issueDate: string,
  conditionCode: '1' | '3' = '1',
): Promise<string> {
  const doc = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('SummaryDocuments', {
      xmlns: 'urn:sunat:names:specification:ubl:peru:schema:xsd:SummaryDocuments-1',
      'xmlns:cac': 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
      'xmlns:cbc': 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
      'xmlns:ds': 'http://www.w3.org/2000/09/xmldsig#',
      'xmlns:ext': 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
      'xmlns:sac': 'urn:sunat:names:specification:ubl:peru:schema:xsd:SunatAggregateComponents-1',
    });

  doc.ele('ext:UBLExtensions').ele('ext:UBLExtension').ele('ext:ExtensionContent').up().up().up();
  doc.ele('cbc:UBLVersionID').txt('2.0').up();
  doc.ele('cbc:CustomizationID').txt('1.1').up();
  doc.ele('cbc:ID').txt(summaryId).up();
  doc.ele('cbc:ReferenceDate').txt(referenceDate).up();
  doc.ele('cbc:IssueDate').txt(issueDate).up();

  const signature = doc.ele('cac:Signature');
  signature.ele('cbc:ID').txt(company.ruc).up();
  const signatory = signature.ele('cac:SignatoryParty');
  signatory.ele('cac:PartyIdentification').ele('cbc:ID').txt(company.ruc).up().up();
  signatory.ele('cac:PartyName').ele('cbc:Name').txt(company.razonSocial).up().up();
  signature.ele('cac:DigitalSignatureAttachment').ele('cac:ExternalReference').ele('cbc:URI').txt(`#${company.ruc}`).up().up().up();
  signature.up();

  const supplier = doc.ele('cac:AccountingSupplierParty');
  supplier.ele('cbc:CustomerAssignedAccountID').txt(company.ruc).up();
  supplier.ele('cbc:AdditionalAccountID').txt('6').up();
  supplier.ele('cac:Party').ele('cac:PartyLegalEntity').ele('cbc:RegistrationName').txt(company.razonSocial).up().up().up();
  supplier.up();

  for (let index = 0; index < summaryBoletas.length; index++) {
    const boleta = summaryBoletas[index];
    const clientRecord = (await db.select().from(clients).where(eq(clients.id, boleta.clientId)).limit(1))[0];
    if (!clientRecord) throw new Error(`Cliente no encontrado para ${boleta.numeroCompleto}`);

    const line = doc.ele('sac:SummaryDocumentsLine');
    line.ele('cbc:LineID').txt(String(index + 1)).up();
    line.ele('cbc:DocumentTypeCode').txt('03').up();
    line.ele('cbc:ID').txt(boleta.numeroCompleto).up();

    const customer = line.ele('cac:AccountingCustomerParty');
    customer.ele('cbc:CustomerAssignedAccountID').txt(clientRecord.numeroDocumento).up();
    customer.ele('cbc:AdditionalAccountID').txt(clientRecord.tipoDocumento).up();
    const customerName = String(clientRecord.razonSocial || '').trim();
    if (customerName && customerName !== '-') {
      customer
        .ele('cac:Party')
        .ele('cac:PartyLegalEntity')
        .ele('cbc:RegistrationName')
        .txt(customerName)
        .up()
        .up()
        .up();
    }
    customer.up();

    line.ele('cac:Status').ele('cbc:ConditionCode').txt(conditionCode).up().up();
    line.ele('sac:TotalAmount', { currencyID: boleta.moneda || 'PEN' }).txt(amount(boleta.mtoImpVenta)).up();

    addBillingPayment(line, boleta, boleta.mtoOperGravadas, '01');
    addBillingPayment(line, boleta, boleta.mtoOperExoneradas, '02');
    addBillingPayment(line, boleta, boleta.mtoOperInafectas, '03');
    addBillingPayment(line, boleta, boleta.mtoOperGratuitas, '05');

    const tax = line.ele('cac:TaxTotal');
    tax.ele('cbc:TaxAmount', { currencyID: boleta.moneda || 'PEN' }).txt(amount(boleta.mtoIgv)).up();
    const subtotal = tax.ele('cac:TaxSubtotal');
    subtotal.ele('cbc:TaxAmount', { currencyID: boleta.moneda || 'PEN' }).txt(amount(boleta.mtoIgv)).up();
    const category = subtotal.ele('cac:TaxCategory');
    category.ele('cbc:Percent').txt(formatPercent(getIgvPercentFromBoleta(boleta))).up();
    const scheme = category.ele('cac:TaxScheme');
    scheme.ele('cbc:ID').txt('1000').up();
    scheme.ele('cbc:Name').txt('IGV').up();
    scheme.ele('cbc:TaxTypeCode').txt('VAT').up();
    line.up();
  }

  return doc.end({ prettyPrint: true });
}

function addBillingPayment(line: any, boleta: any, value: string | number | null | undefined, instructionId: string) {
  if (Number(value || 0) <= 0) return;
  line.ele('sac:BillingPayment')
    .ele('cbc:PaidAmount', { currencyID: boleta.moneda || 'PEN' }).txt(amount(value)).up()
    .ele('cbc:InstructionID').txt(instructionId).up()
    .up();
}

function amount(value: string | number | null | undefined): string {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : '0.00';
}

function getIgvPercentFromBoleta(boleta: any): number {
  const detalles = Array.isArray(boleta.detalles) ? boleta.detalles : [];
  const detailWithPercent = detalles.find((detail: any) => {
    const percent = Number(detail?.porcentaje_igv ?? detail?.porcentajeIgv);
    return Number.isFinite(percent);
  });

  const percent = Number(detailWithPercent?.porcentaje_igv ?? detailWithPercent?.porcentajeIgv ?? 0);
  return Number.isFinite(percent) ? percent : 0;
}

function formatPercent(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export async function createSummaryFromBoletas(companyId: number, branchId: number, fechaResumen: string) {
  const branch = (await db.select().from(branches).where(and(eq(branches.id, branchId), eq(branches.companyId, companyId))).limit(1))[0];
  if (!branch) throw new Error('Sucursal no encontrada o no pertenece a la empresa');

  const pendingBoletas = await db.select().from(boletas).where(and(
    eq(boletas.companyId, companyId), eq(boletas.branchId, branchId),
    eq(boletas.fechaEmision, fechaResumen), eq(boletas.estadoSunat, 'PENDIENTE'),
    sql`${boletas.dailySummaryId} IS NULL`,
  ));
  if (pendingBoletas.length === 0) throw new Error('No hay boletas pendientes para la fecha seleccionada');

  const correlativo = await getNextSummaryCorrelative(companyId, fechaResumen);
  const ts = Math.floor(Date.now() / 1000);
  const result = await db.insert(dailySummaries).values({
    companyId, branchId, fechaResumen, correlativo,
    numeroCompleto: `RC-${fechaResumen.replace(/-/g, '')}-${correlativo}`,
    estado: 'PENDIENTE', usuarioCreacion: 'sistema', createdAt: ts, updatedAt: ts,
  }).returning({ id: dailySummaries.id });

  const summaryId = result[0].id;
  await db.update(boletas).set({ dailySummaryId: summaryId }).where(and(
    eq(boletas.companyId, companyId), eq(boletas.branchId, branchId),
    eq(boletas.fechaEmision, fechaResumen), eq(boletas.estadoSunat, 'PENDIENTE'),
  ));

  const summary = (await db.select().from(dailySummaries).where(eq(dailySummaries.id, summaryId)).limit(1))[0];
  return { summary, boletasCount: pendingBoletas.length };
}
