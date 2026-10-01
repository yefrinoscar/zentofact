import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { facturas, clients, companies, branches } from '../db/schema';
import { getNextCorrelative, isRemoteSunatRejection, markCorrelativeUsed } from './correlative.service';
import { SunatService } from './sunat.service';
import { sendDocumentOnce } from './document-sender';
import { withActiveOrderDocumentGuard } from './order-document-guard';
import { withExpectedAmount } from './amount-audit';
import { CLOSED_STATES } from './sunat-reconciliation';
import { reconcileAndReemit, refreshStatusFromSunat } from './reemission.service';
import type { ReemissionAdapter } from './reemission.service';
import type { CompanyConfig } from './sunat.service';
import { readArchive, saveFacturaCdr, saveFacturaPdf, saveFacturaXml } from './file.service';
import { generateBoletaPdf, generateBoletaPreviewHtml } from './pdf.service';
import type { PdfFormat } from './pdf.service';
import { calculateTotals } from '../utils/tax-calculator';
import type { DetalleItem } from '../utils/tax-calculator';
import { getCorrelativeBySerie } from './correlative-query.service';
import { resolveIssueDate, withIssueDateTrace } from '../utils/issue-date';
import { isSunatProduction } from '../utils/sunat-env';

export interface CreateFacturaInput {
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
  persistCorrelative?: boolean;
  /** Total del origen (por ejemplo el pedido de Falabella); se audita antes de enviar a SUNAT. */
  expected_total?: { total: number; source: string };
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

function amount(value: string | number | null | undefined): string {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : '0.00';
}

function normalizeFacturaDetalles(detalles: DetalleItem[]): DetalleItem[] {
  return (detalles || []).map((detalle: any) => ({
    codigo: String(detalle.codigo || ''),
    descripcion: String(detalle.descripcion || ''),
    unidad: String(detalle.unidad || 'NIU'),
    cantidad: Number(detalle.cantidad || 0),
    mto_valor_unitario: Number(detalle.mto_valor_unitario ?? detalle.mtoValorUnitario ?? 0),
    mto_valor_gratuito: detalle.mto_valor_gratuito ?? detalle.mtoValorGratuito,
    mto_bruto: detalle.mto_bruto ?? detalle.mtoBruto,
    porcentaje_igv: Number(detalle.porcentaje_igv ?? detalle.porcentajeIgv ?? 18),
    porcentaje_ivap: detalle.porcentaje_ivap ?? detalle.porcentajeIvap,
    tip_afe_igv: String(detalle.tip_afe_igv ?? detalle.tipAfeIgv ?? '10'),
    isc: detalle.isc,
    icbper: detalle.icbper,
    factor_icbper: detalle.factor_icbper ?? detalle.factorIcbper,
    codigo_producto_sunat: detalle.codigo_producto_sunat ?? detalle.codigoProductoSunat,
  }));
}

function getIgvPercentFromFactura(factura: any): number {
  const detalles = Array.isArray(factura.detalles) ? factura.detalles : [];
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
  };
}

function isBetaFalabellaEmission(factura: any): boolean {
  const additionalData = Array.isArray(factura?.datosAdicionales) ? factura.datosAdicionales : [];
  return additionalData.some((item: any) => (
    String(item?.source || '').toLowerCase() === 'falabella-api'
    && String(item?.environment || '').toLowerCase() === 'beta'
  ));
}

function isProductionFacturaEmission(factura: any): boolean {
  return isSunatProduction() && !isBetaFalabellaEmission(factura);
}

// Una orden tiene a lo sumo un comprobante activo; ver withActiveOrderDocumentGuard.
export async function createFactura(input: CreateFacturaInput) {
  return withActiveOrderDocumentGuard(
    { table: 'facturas', companyId: input.company_id, orderNumber: input.order_number },
    () => insertFactura(input),
  );
}

async function insertFactura(input: CreateFacturaInput) {
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

  if (input.persistCorrelative === false && input.order_number) {
    await db.delete(facturas).where(and(
      eq(facturas.companyId, input.company_id),
      eq(facturas.orderNumber, input.order_number),
      eq(facturas.estadoSunat, 'RECHAZADO'),
    ));
  }

  const correlativo = await getNextCorrelative(input.branch_id, '01', input.serie, input.persistCorrelative !== false);
  const numeroCompleto = `${input.serie}-${correlativo}`;
  const issueDate = resolveIssueDate(input.fecha_emision, '01');
  const datosAdicionales = withExpectedAmount(withIssueDateTrace(input.datos_adicionales, issueDate), input.expected_total);
  const detalles = normalizeFacturaDetalles(input.detalles);
  const totals = calculateTotals(detalles);
  const ts = now();

  if (input.persistCorrelative === false) {
    await db.delete(facturas).where(and(
      eq(facturas.companyId, input.company_id),
      eq(facturas.serie, input.serie),
      eq(facturas.correlativo, correlativo),
      eq(facturas.estadoSunat, 'RECHAZADO'),
    ));
  }

  const result = await db.insert(facturas).values({
    companyId: input.company_id, branchId: input.branch_id, clientId: clientRecord.id,
    tipoDocumento: '01', serie: input.serie, correlativo, numeroCompleto,
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
    detalles, leyendas: input.leyendas || null,
    datosAdicionales,
    estadoSunat: 'PENDIENTE', usuarioCreacion: input.usuario_creacion || null,
    createdAt: ts, updatedAt: ts,
  }).returning({ id: facturas.id });

  return {
    id: result[0].id, companyId: input.company_id, branchId: input.branch_id,
    clientId: clientRecord.id, serie: input.serie, correlativo, numeroCompleto,
    fechaEmision: issueDate.fechaEmision, moneda: input.moneda || 'PEN',
    ...totals, detalles, leyendas: input.leyendas || [], estadoSunat: 'PENDIENTE',
  };
}

export async function sendFacturaToSunat(id: number) {
  const factura = (await db.select().from(facturas).where(eq(facturas.id, id)).limit(1))[0];
  if (!factura) throw new Error('Factura no encontrada');
  if (factura.estadoSunat === 'ACEPTADO') throw new Error('La factura ya fue aceptada por SUNAT');
  const estadoActual = String(factura.estadoSunat || '').toUpperCase();
  if (CLOSED_STATES.includes(estadoActual)) {
    return { success: false, blocked: true, error_code: 'DOCUMENT_CLOSED', message: `No se envía: la factura ${factura.numeroCompleto} está ${estadoActual}.` };
  }

  const company = (await db.select().from(companies).where(eq(companies.id, factura.companyId)).limit(1))[0];
  if (!company) throw new Error('Empresa no encontrada');
  const branch = (await db.select().from(branches).where(eq(branches.id, factura.branchId)).limit(1))[0];
  if (!branch) throw new Error('Sucursal no encontrada');
  const clientRecord = (await db.select().from(clients).where(eq(clients.id, factura.clientId)).limit(1))[0];
  if (!clientRecord) throw new Error('Cliente no encontrado');

  const config: CompanyConfig = {
    ruc: company.ruc, razonSocial: company.razonSocial,
    direccion: company.direccion || '', ubigeo: company.ubigeo || '',
    usuarioSol: company.usuarioSol || 'MODDATOS', claveSol: company.claveSol || 'MODDATOS',
    certificado: company.certificado || '', certificadoPassword: company.certificadoPassword || '',
    codigoLocal: branch.codigo || '0000',
  };

  const detalles = (factura.detalles as any[]) || [];
  const sunatService = new SunatService(config);
  const facturaData = {
    tipoDocumento: '01', serie: factura.serie, correlativo: factura.correlativo,
    fechaEmision: String(factura.fechaEmision), moneda: factura.moneda || 'PEN',
    tipoOperacion: factura.tipoOperacion || '0101', ublVersion: factura.ublVersion || '2.1',
    client: { tipoDocumento: clientRecord.tipoDocumento, numeroDocumento: clientRecord.numeroDocumento, razonSocial: clientRecord.razonSocial, direccion: clientRecord.direccion || undefined },
    detalles: detalles.map((d: any) => ({
      codigo: d.codigo, descripcion: d.descripcion, unidad: d.unidad,
      cantidad: Number(d.cantidad), mtoValorUnitario: Number(d.mto_valor_unitario || d.mtoValorUnitario || 0),
      porcentajeIgv: Number(d.porcentaje_igv || d.porcentajeIgv || 0),
      tipAfeIgv: d.tip_afe_igv || d.tipAfeIgv || '10',
      mtoValorGratuito: Number(d.mto_valor_gratuito || 0), isc: Number(d.isc || 0), icbper: Number(d.icbper || 0),
    })),
    mtoOperGravadas: Number(factura.mtoOperGravadas || 0), mtoOperExoneradas: Number(factura.mtoOperExoneradas || 0),
    mtoOperInafectas: Number(factura.mtoOperInafectas || 0), mtoOperGratuitas: Number(factura.mtoOperGratuitas || 0),
    mtoIgvGratuitas: Number(factura.mtoIgvGratuitas || 0), mtoIgv: Number(factura.mtoIgv || 0),
    mtoBaseIvap: Number(factura.mtoBaseIvap || 0), mtoIvap: Number(factura.mtoIvap || 0),
    mtoIsc: Number(factura.mtoIsc || 0), mtoIcbper: Number(factura.mtoIcbper || 0),
    totalImpuestos: Number(factura.totalImpuestos || 0), subTotal: Number(factura.subTotal || 0),
    mtoImpVenta: Number(factura.mtoImpVenta || 0), formaPagoTipo: 'Contado',
  };

  const sent = await sendDocumentOnce({
    documentTable: 'facturas',
    table: facturas,
    tipoDocumento: '01',
    ruc: company.ruc,
    doc: factura,
    reference: factura.orderNumber,
    sunat: sunatService,
    buildUnsignedXml: () => sunatService.buildUBLXml(facturaData),
    saveXml: saveFacturaXml,
    saveCdr: saveFacturaCdr,
  });
  if (sent.success) return { ...sent, message: 'Factura enviada exitosamente a SUNAT' };

  if (!isProductionFacturaEmission(factura)) {
    // Factura de prueba: se descarta. Si salió hacia SUNAT producción o SUNAT la
    // procesó, su número nunca se reutiliza.
    if (isSunatProduction() || isRemoteSunatRejection(sent.error_code, sent.message)) {
      await markCorrelativeUsed(factura.branchId, '01', factura.serie, factura.correlativo);
    }
    await db.delete(facturas).where(eq(facturas.id, id));
  }
  return sent;
}

const FACTURA_REEMISSION: ReemissionAdapter = {
  documentTable: 'facturas',
  table: facturas,
  tipoDocumento: '01',
  label: 'factura',
  send: (id) => sendFacturaToSunat(id),
  saveCdr: (doc, cdrZip) => saveFacturaCdr(doc, cdrZip),
  replacementOverrides: { respuestaFalabella: null },
};

// Reemite una factura no aceptada solo después de reconciliarla con SUNAT. Ver
// reconcileAndReemit para las reglas: nunca se usa otro número mientras el
// anterior pueda existir en SUNAT.
export async function reEmitFactura(id: number) {
  const factura = (await db.select().from(facturas).where(eq(facturas.id, id)).limit(1))[0];
  if (!factura) throw new Error('Factura no encontrada');
  if (factura.estadoSunat === 'ACEPTADO') throw new Error('La factura ya fue aceptada por SUNAT');
  return reconcileAndReemit(FACTURA_REEMISSION, id);
}

// Consulta a SUNAT por RUC, tipo, serie y correlativo y sincroniza el estado local
// usando el CDR autoritativo. Solo marca ACEPTADO si el CDR corresponde a esta
// factura; "REGISTRADO" nunca se interpreta como aceptación tributaria.
export async function refreshFacturaStatus(id: number) {
  return refreshStatusFromSunat(FACTURA_REEMISSION, id);
}


export async function generateAcceptedFacturaPdfBase64(id: number, pdfFormat: PdfFormat = 'A4') {
  const factura = (await db.select().from(facturas).where(eq(facturas.id, id)).limit(1))[0];
  if (!factura) throw new Error('Factura no encontrada');
  if (factura.estadoSunat !== 'ACEPTADO') throw new Error('Solo se puede generar PDF de facturas aceptadas');

  const companyData = (await db.select().from(companies).where(eq(companies.id, factura.companyId)).limit(1))[0];
  const branchData = (await db.select().from(branches).where(eq(branches.id, factura.branchId)).limit(1))[0];
  const clientData = (await db.select().from(clients).where(eq(clients.id, factura.clientId)).limit(1))[0];
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
    serie: factura.serie,
    correlativo: factura.correlativo,
    numeroCompleto: factura.numeroCompleto,
    fechaEmision: factura.fechaEmision,
    moneda: factura.moneda || 'PEN',
    detalles: (factura.detalles as any[]) || [],
    mtoOperGravadas: String(factura.mtoOperGravadas || '0'),
    mtoOperExoneradas: String(factura.mtoOperExoneradas || '0'),
    mtoOperInafectas: String(factura.mtoOperInafectas || '0'),
    mtoOperGratuitas: String(factura.mtoOperGratuitas || '0'),
    mtoIgv: String(factura.mtoIgv || '0'),
    mtoIgvGratuitas: String(factura.mtoIgvGratuitas || '0'),
    mtoIsc: String(factura.mtoIsc || '0'),
    mtoIcbper: String(factura.mtoIcbper || '0'),
    totalImpuestos: String(factura.totalImpuestos || '0'),
    subTotal: String(factura.subTotal || '0'),
    mtoImpVenta: String(factura.mtoImpVenta || '0'),
    codigoHash: factura.codigoHash || undefined,
    logoPath: companyData.logoPath || undefined,
    documentTypeCode: '01',
    documentTitle: 'FACTURA ELECTRÓNICA',
    printDocumentLabel: 'FACTURA ELECTRÓNICA',
  }, pdfFormat);

  return pdfBuffer.toString('base64');
}

export async function getFacturaXmlBase64(id: number) {
  const factura = (await db.select().from(facturas).where(eq(facturas.id, id)).limit(1))[0];
  if (!factura) throw new Error('Factura no encontrada');
  if (!factura.xmlPath) throw new Error('La factura no tiene un XML disponible');
  return (await readArchive(factura.xmlPath)).toString('base64');
}

export async function generateAcceptedFacturaPreviewHtml(id: number, pdfFormat: PdfFormat = 'A4') {
  const factura = (await db.select().from(facturas).where(eq(facturas.id, id)).limit(1))[0];
  if (!factura) throw new Error('Factura no encontrada');

  const companyData = (await db.select().from(companies).where(eq(companies.id, factura.companyId)).limit(1))[0];
  const branchData = (await db.select().from(branches).where(eq(branches.id, factura.branchId)).limit(1))[0];
  const clientData = (await db.select().from(clients).where(eq(clients.id, factura.clientId)).limit(1))[0];
  if (!companyData || !branchData || !clientData) throw new Error('Datos incompletos para previsualizar la factura');

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
    serie: factura.serie,
    correlativo: factura.correlativo,
    numeroCompleto: factura.numeroCompleto,
    fechaEmision: factura.fechaEmision,
    moneda: factura.moneda || 'PEN',
    detalles: (factura.detalles as any[]) || [],
    mtoOperGravadas: String(factura.mtoOperGravadas || '0'),
    mtoOperExoneradas: String(factura.mtoOperExoneradas || '0'),
    mtoOperInafectas: String(factura.mtoOperInafectas || '0'),
    mtoOperGratuitas: String(factura.mtoOperGratuitas || '0'),
    mtoIgv: String(factura.mtoIgv || '0'),
    mtoIgvGratuitas: String(factura.mtoIgvGratuitas || '0'),
    mtoIsc: String(factura.mtoIsc || '0'),
    mtoIcbper: String(factura.mtoIcbper || '0'),
    totalImpuestos: String(factura.totalImpuestos || '0'),
    subTotal: String(factura.subTotal || '0'),
    mtoImpVenta: String(factura.mtoImpVenta || '0'),
    codigoHash: factura.codigoHash || undefined,
    logoPath: companyData.logoPath || undefined,
    documentTypeCode: '01',
    documentTitle: 'FACTURA ELECTRÓNICA',
    printDocumentLabel: 'FACTURA ELECTRÓNICA',
  }, pdfFormat);

  return {
    html,
    numeroCompleto: factura.numeroCompleto,
    fechaEmision: factura.fechaEmision,
    total: factura.mtoImpVenta,
    client: {
      razonSocial: clientData.razonSocial,
      numeroDocumento: clientData.numeroDocumento,
    },
  };
}

export async function generatePreviewFacturaHtmlForVenta(
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
  const branchData = availableBranches.find(branch => branch.codigo === '0000') || availableBranches[0];
  if (!branchData) throw new Error('La empresa no tiene una sucursal activa para previsualizar.');

  const serie = venta.serie || 'F001';
  const currentCorrelative = await getCorrelativeBySerie(branchData.id, '01', serie);
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
    documentTypeCode: '01',
    documentTitle: 'FACTURA ELECTRÓNICA',
    printDocumentLabel: 'FACTURA ELECTRÓNICA',
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

// Kept for backward compatibility with Falabella upload tracking
export interface RecordFacturaUploadInput {
  companyId: number;
  branchId?: number | null;
  orderNumber: string;
  numeroCompleto: string;
  fechaEmision: string;
  pdfBuffer: Buffer;
  source?: string;
  orderItemIds?: string[];
  respuestaFalabella?: unknown;
}

async function getOrCreateGenericClient(companyId: number): Promise<number> {
  const genericDocNum = '00000000';
  let clientRecord = (await db.select().from(clients).where(and(
    eq(clients.companyId, companyId),
    eq(clients.tipoDocumento, '0'),
    eq(clients.numeroDocumento, genericDocNum),
  )).limit(1))[0];

  if (!clientRecord) {
    const inserted = await db.insert(clients).values({
      companyId,
      tipoDocumento: '0',
      numeroDocumento: genericDocNum,
      razonSocial: '-',
      activo: true,
      createdAt: now(),
      updatedAt: now(),
    }).returning();
    clientRecord = inserted[0];
  }

  return clientRecord.id;
}

export async function recordFacturaUpload(input: RecordFacturaUploadInput) {
  const ts = now();
  const pdfPath = saveFacturaPdf({
    numeroCompleto: input.numeroCompleto,
    fechaEmision: input.fechaEmision,
    orderNumber: input.orderNumber,
  }, input.pdfBuffer);

  const existingRows = await db.select().from(facturas).where(and(
    eq(facturas.companyId, input.companyId),
    eq(facturas.orderNumber, input.orderNumber),
    eq(facturas.numeroCompleto, input.numeroCompleto),
  )).orderBy(desc(facturas.id)).limit(1);
  const existing = existingRows[0];

  if (existing) {
    // No pisar ACEPTADO/ANULADO: el upload a Falabella no cambia el estado SUNAT.
    const estadoActual = String(existing.estadoSunat || '').toUpperCase();
    const keepSunatStatus = estadoActual === 'ACEPTADO' || estadoActual === 'ANULADO' || estadoActual === 'RECHAZADO';
    const updated = await db.update(facturas).set({
      branchId: input.branchId ?? existing.branchId ?? 0,
      fechaEmision: input.fechaEmision,
      pdfPath,
      fuente: input.source || existing.fuente || 'manual',
      estadoSunat: keepSunatStatus ? existing.estadoSunat : 'REGISTRADO',
      orderItemIds: input.orderItemIds || existing.orderItemIds || null,
      respuestaFalabella: input.respuestaFalabella ? JSON.stringify(input.respuestaFalabella) : existing.respuestaFalabella,
      updatedAt: ts,
    }).where(eq(facturas.id, existing.id)).returning();

    return updated[0];
  }

  const clientId = await getOrCreateGenericClient(input.companyId);

  const inserted = await db.insert(facturas).values({
    companyId: input.companyId,
    branchId: input.branchId ?? 0,
    clientId,
    tipoDocumento: '01',
    serie: '',
    correlativo: '',
    numeroCompleto: input.numeroCompleto,
    orderNumber: input.orderNumber,
    fechaEmision: input.fechaEmision,
    pdfPath,
    detalles: [],
    fuente: input.source || 'manual',
    estadoSunat: 'REGISTRADO',
    orderItemIds: input.orderItemIds || null,
    respuestaFalabella: input.respuestaFalabella ? JSON.stringify(input.respuestaFalabella) : null,
    createdAt: ts,
    updatedAt: ts,
  }).returning();

  return inserted[0];
}
