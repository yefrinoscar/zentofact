import type { PdfFormat } from './services/pdf.service';
import { processWorkflow } from './workflow';

// ── Tipos públicos ──

export interface CoreConfig {
  companyId?: number;
  branchId?: number;
  ruc: string;
  razonSocial: string;
  direccion: string;
  ubigeo: string;
  usuarioSol: string;
  claveSol: string;
  certificadoBase64: string;
  certificadoPassword: string;
  modoProduccion?: boolean;
  branchCodigo?: string;
  branchNombre?: string;
  serieBoleta?: string;
  pdfFormat?: PdfFormat;
  outputDir: string;
  dbPath?: string;
}

export interface VentaItem {
  orderNumber?: string;
  serie?: string;
  fechaEmision: string;
  moneda?: string;
  total?: number;
  client: {
    tipoDocumento: '1' | '4' | '6' | '7' | '0';
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
    mtoBruto?: number;
    porcentajeIgv: number;
    tipAfeIgv: string;
    codigoProductoSunat?: string;
  }>;
}

export interface WorkflowResult {
  total: number;
  exitosas: number;
  rechazadas: number;
  boletas: Array<{
    numeroCompleto: string;
    estadoSunat: string;
    pdfPath: string;
    xmlPath: string;
    error?: string;
    orderNumber?: string;
    summaryId?: number;
    summaryNumero?: string;
    summaryTicket?: string;
    summaryEstado?: string;
    summaryResponseCode?: string;
    summaryResponse?: string;
  }>;
  outputDir: string;
  dbPath: string;
}

export type WorkflowProgress = (current: number, total: number, status: string) => void;

// ── API pública ──

export { processWorkflow };
export { listCompanies, getCompany, getCompanyByRuc, createCompany, updateCompany, deleteCompany, testSunatConnection } from './services/company.service';
export type { CreateCompanyInput, UpdateCompanyInput, TestSunatConnectionResult, SunatEnvironment } from './services/company.service';
export { listBranches, getBranch, createBranch, updateBranch } from './services/branch.service';
export type { CreateBranchInput, UpdateBranchInput } from './services/branch.service';
export { listBoletas } from './services/boleta-query.service';
export type { BoletaFilter } from './services/boleta-query.service';
export { listFacturas } from './services/factura-query.service';
export type { FacturaFilter } from './services/factura-query.service';
export { listCreditNotes } from './services/credit-note-query.service';
export type { CreditNoteFilter } from './services/credit-note-query.service';
export { listDailySummaries, refreshDailySummaryStatus, refreshBoletaStatus } from './services/daily-summary-query.service';
export type { DailySummaryFilter } from './services/daily-summary-query.service';
export { createBoleta, sendBoletaToSunat, sendBoletasAsDailySummary, generateAcceptedBoletaPdf, generateAcceptedBoletaPdfBase64, generateAcceptedBoletaPreviewHtml, markBoletaFalabellaPdfUpload, generateDailySummaryPdfs, generatePreviewBoletaHtmlForVenta, sendBoletasAsVoidedDailySummary, sendBoletasAsVoidedDailySummaries } from './services/boleta.service';
export { recordFacturaUpload } from './services/factura.service';
export { createCreditNoteFromBoleta, sendCreditNoteToSunat, createAndSendCreditNoteFromBoleta, createAndSendCreditNotesFromBoletas, listCreditNotesByAffectedBoletaIds, generatePreviewCreditNoteHtml } from './services/credit-note.service';
export type { CreateCreditNoteFromBoletaOptions } from './services/credit-note.service';
export { getCorrelatives, getCorrelativeBySerie } from './services/correlative-query.service';
export {
  falabellaGetOrders, falabellaGetOrderItems, falabellaBuildBoletaVenta, falabellaResolveOrderIds,
  falabellaResolveDocument, falabellaUploadInvoicePdf, falabellaUploadBoletaPdf, falabellaMonthSummary,
} from './services/falabella.service';

// ── Utilitarios ──

export function validateConfig(config: CoreConfig): string[] {
  const errors: string[] = [];
  if (!config.ruc || config.ruc.length !== 11) errors.push('RUC inválido (debe tener 11 dígitos)');
  if (!config.razonSocial) errors.push('Razón social requerida');
  if (!config.usuarioSol) errors.push('Usuario SOL requerido');
  if (!config.claveSol) errors.push('Clave SOL requerida');
  if (!config.certificadoBase64) errors.push('Certificado digital requerido');
  if (!config.outputDir) errors.push('Directorio de salida requerido');
  return errors;
}

export function validateVentas(ventas: VentaItem[]): string[] {
  const errors: string[] = [];
  if (!ventas.length) errors.push('No hay ventas para procesar');
  ventas.forEach((v, i) => {
    if (!v.fechaEmision) errors.push(`Venta ${i + 1}: fecha de emisión requerida`);
    if (!v.client?.razonSocial) errors.push(`Venta ${i + 1}: razón social del cliente requerida`);
    if (!v.detalles?.length) errors.push(`Venta ${i + 1}: al menos un detalle requerido`);
  });
  return errors;
}

export function sanitizeVentaItem(v: VentaItem): VentaItem {
  return {
    orderNumber: v.orderNumber,
    serie: v.serie,
    fechaEmision: v.fechaEmision,
    moneda: v.moneda,
    client: {
      tipoDocumento: v.client.tipoDocumento,
      numeroDocumento: v.client.numeroDocumento,
      razonSocial: v.client.razonSocial,
      direccion: v.client.direccion,
    },
    detalles: v.detalles.map(d => ({
      codigo: d.codigo,
      descripcion: d.descripcion,
      unidad: d.unidad,
      cantidad: d.cantidad,
      mtoValorUnitario: d.mtoValorUnitario,
      ...(d.mtoBruto != null ? { mtoBruto: d.mtoBruto } : {}),
      porcentajeIgv: d.porcentajeIgv,
      tipAfeIgv: d.tipAfeIgv,
      ...(d.codigoProductoSunat ? { codigoProductoSunat: d.codigoProductoSunat } : {}),
    })),
  };
}
