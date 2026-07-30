import type { PdfFormat } from './services/pdf.service';
import { processWorkflow } from './workflow';

// ── Tipos públicos ──

export interface CoreConfig {
  /** Obligatorio: secretos se cargan en el servidor desde la empresa. */
  companyId?: number;
  branchId?: number;
  /** @deprecated No se usan en HTTP; se conservan solo por compatibilidad tipada. */
  ruc?: string;
  razonSocial?: string;
  direccion?: string;
  ubigeo?: string;
  usuarioSol?: string;
  claveSol?: string;
  certificadoBase64?: string;
  certificadoPassword?: string;
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
export { db, pool } from './db';
export { runMigrations } from './db/migrate';
export {
  listCompanies,
  getCompany,
  listPublicCompanies,
  getPublicCompany,
  toPublicCompany,
  createCompany,
  updateCompany,
  deleteCompany,
  testSunatConnection,
} from './services/company.service';
export type {
  CreateCompanyInput,
  UpdateCompanyInput,
  PublicCompany,
  CompanyRecord,
  TestSunatConnectionResult,
  SunatEnvironment,
} from './services/company.service';
export { listBranches, createBranch, updateBranch } from './services/branch.service';
export type { CreateBranchInput, UpdateBranchInput } from './services/branch.service';
export { listBoletas } from './services/boleta-query.service';
export type { BoletaFilter } from './services/boleta-query.service';
export { listFacturas } from './services/factura-query.service';
export type { FacturaFilter } from './services/factura-query.service';
export { getDocumentStats, getCompanyDocumentStats } from './services/document-stats.service';
export type {
  DocumentStats,
  DocumentStatsFilter,
  CompanyDocumentStats,
} from './services/document-stats.service';
export { listCreditNotes } from './services/credit-note-query.service';
export type { CreditNoteFilter } from './services/credit-note-query.service';
export { refreshBoletaStatus } from './services/daily-summary-query.service';
// PDF disk helpers (generateAccepted*Pdf) stay internal; web/server use base64 variants.
export {
  createBoleta,
  sendBoletaToSunat,
  reEmitBoleta,
  generateAcceptedBoletaPdfBase64,
  generateAcceptedBoletaPreviewHtml,
  generatePreviewBoletaHtmlForVenta,
} from './services/boleta.service';
export {
  refreshFacturaStatus,
  createFactura,
  sendFacturaToSunat,
  reEmitFactura,
  generateAcceptedFacturaPdfBase64,
  generateAcceptedFacturaPreviewHtml,
  generatePreviewFacturaHtmlForVenta,
} from './services/factura.service';
export type { CreateFacturaInput } from './services/factura.service';
export {
  createCreditNoteFromFactura,
  createAndSendCreditNoteFromBoleta,
  createAndSendCreditNoteFromFactura,
  createAndSendCreditNotesFromBoletas,
  generatePreviewCreditNoteHtml,
} from './services/credit-note.service';
export type { CreateCreditNoteFromBoletaOptions, CreateCreditNoteFromFacturaOptions } from './services/credit-note.service';
export { getCorrelatives } from './services/correlative-query.service';
export {
  falabellaGetOrders, falabellaGetOrderItems, falabellaGetShippingLabel, falabellaSetStatusToReadyToShip, falabellaBuildBoletaVenta, falabellaBuildFacturaVenta, falabellaResolveOrderIds,
  falabellaGetProducts, falabellaCreateProduct,
  falabellaGetFeeds, falabellaGetFeedStatus,
  falabellaResolveDocument, falabellaUploadInvoicePdf, falabellaUploadBoletaPdf, falabellaMonthSummary,
  falabellaGetWebhooks, falabellaCreateWebhook, falabellaDeleteWebhook,
} from './services/falabella.service';
export { recordFalabellaLabelPrintIndexes } from './services/falabella-label-print.service';

// ── Utilitarios ──

export { isSunatProduction, sunatEnvironmentLabel } from './utils/sunat-env';

export function validateConfig(config: CoreConfig): string[] {
  const errors: string[] = [];
  // Flujo actual: el servidor carga secretos por companyId; no se aceptan credenciales del cliente.
  if (!config.companyId) {
    errors.push('companyId es requerido');
  }
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
