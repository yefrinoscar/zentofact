import fs from 'fs';
import path from 'path';
import { isR2Enabled, putObject, getObject, objectExists } from './r2';
import { isProxyEnabled, proxyPut, proxyGet, proxyHead } from './r2-proxy';

const STORAGE_PATH = process.env.STORAGE_PATH || './storage';

const XML_TYPE = 'application/xml';
const ZIP_TYPE = 'application/zip';

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// XML/CDR legal archives storage backend, in priority order:
//   1. R2 via Worker proxy  (R2_PROXY_URL/R2_PROXY_SECRET) — for networks that
//      block the direct S3 endpoint of R2.
//   2. R2 direct S3 endpoint (R2_* vars).
//   3. Local disk (fallback for dev).
// The returned relative key is what gets stored in the DB (identical in all modes).
async function saveArchive(relativeKey: string, body: Buffer | string, contentType: string): Promise<string> {
  if (isProxyEnabled()) {
    await proxyPut(relativeKey, body, contentType);
    return relativeKey;
  }
  if (isR2Enabled()) {
    await putObject(relativeKey, body, contentType);
    return relativeKey;
  }
  const filepath = path.join(STORAGE_PATH, relativeKey);
  ensureDir(path.dirname(filepath));
  fs.writeFileSync(filepath, body);
  return relativeKey;
}

export async function saveXml(document: { serie: string; correlativo: string; fechaEmision: string }, xmlContent: string): Promise<string> {
  const dateStr = formatDate(document.fechaEmision);
  return saveArchive(`boletas/xml/${dateStr}/${document.serie}-${document.correlativo}.xml`, xmlContent, XML_TYPE);
}

export async function saveCdr(document: { serie: string; correlativo: string; fechaEmision: string }, cdrBuffer: Buffer): Promise<string> {
  const dateStr = formatDate(document.fechaEmision);
  return saveArchive(`boletas/cdr/${dateStr}/R-${document.serie}-${document.correlativo}.zip`, cdrBuffer, ZIP_TYPE);
}

export async function saveSummaryXml(summary: { numeroCompleto: string; fechaResumen: string; companyRuc?: string }, xmlContent: string): Promise<string> {
  const dateStr = formatDate(summary.fechaResumen);
  const filename = buildSummaryFilename(summary, 'xml');
  return saveArchive(`resumenes/xml/${dateStr}/${filename}`, xmlContent, XML_TYPE);
}

export async function saveSummaryCdr(summary: { numeroCompleto: string; fechaResumen: string; companyRuc?: string }, cdrBuffer: Buffer): Promise<string> {
  const dateStr = formatDate(summary.fechaResumen);
  const filename = buildSummaryFilename(summary, 'zip');
  return saveArchive(`resumenes/cdr/${dateStr}/${filename}`, cdrBuffer, ZIP_TYPE);
}

export async function saveCreditNoteXml(document: { serie: string; correlativo: string; fechaEmision: string }, xmlContent: string): Promise<string> {
  const dateStr = formatDate(document.fechaEmision);
  return saveArchive(`notas-credito/xml/${dateStr}/${document.serie}-${document.correlativo}.xml`, xmlContent, XML_TYPE);
}

export async function saveCreditNoteCdr(document: { serie: string; correlativo: string; fechaEmision: string }, cdrBuffer: Buffer): Promise<string> {
  const dateStr = formatDate(document.fechaEmision);
  return saveArchive(`notas-credito/cdr/${dateStr}/R-${document.serie}-${document.correlativo}.zip`, cdrBuffer, ZIP_TYPE);
}

// PDFs are NOT uploaded — they can be regenerated from the data in the DB and
// always stay on local disk.
export function savePdf(document: { serie: string; correlativo: string; fechaEmision: string }, pdfBuffer: Buffer, format: string): string {
  const dateStr = formatDate(document.fechaEmision);
  const dir = path.join(STORAGE_PATH, 'boletas', 'pdf', dateStr);
  ensureDir(dir);

  const suffix = format === 'A4' ? '' : `_${format}`;
  const filename = `${document.serie}-${document.correlativo}${suffix}.pdf`;
  const filepath = path.join(dir, filename);
  fs.writeFileSync(filepath, pdfBuffer);

  return `boletas/pdf/${dateStr}/${filename}`;
}

export function saveFacturaPdf(document: { numeroCompleto: string; fechaEmision: string; orderNumber?: string }, pdfBuffer: Buffer): string {
  const dateStr = formatDate(document.fechaEmision);
  const dir = path.join(STORAGE_PATH, 'facturas', 'pdf', dateStr);
  ensureDir(dir);

  const invoicePart = sanitizeFilename(document.numeroCompleto);
  const orderPart = document.orderNumber ? `-${sanitizeFilename(document.orderNumber)}` : '';
  const filename = `${invoicePart}${orderPart}.pdf`;
  const filepath = path.join(dir, filename);
  fs.writeFileSync(filepath, pdfBuffer);

  return `facturas/pdf/${dateStr}/${filename}`;
}

// Reads an archive (XML/CDR) by its stored key: from R2 when configured, else
// from local disk.
export async function readArchive(relativeKey: string): Promise<Buffer> {
  if (isProxyEnabled()) {
    return proxyGet(relativeKey);
  }
  if (isR2Enabled()) {
    return getObject(relativeKey);
  }
  return fs.readFileSync(path.join(STORAGE_PATH, relativeKey));
}

export async function archiveExists(relativeKey: string): Promise<boolean> {
  if (isProxyEnabled()) {
    return proxyHead(relativeKey);
  }
  if (isR2Enabled()) {
    return objectExists(relativeKey);
  }
  return fs.existsSync(path.join(STORAGE_PATH, relativeKey));
}

export function fileExists(filePath: string): boolean {
  const fullPath = path.join(STORAGE_PATH, filePath);
  return fs.existsSync(fullPath);
}

export function getFilePath(filePath: string): string {
  return path.join(STORAGE_PATH, filePath);
}

function formatDate(dateStr: string): string {
  const dateOnly = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateOnly) {
    return `${dateOnly[3]}${dateOnly[2]}${dateOnly[1]}`;
  }
  const d = new Date(dateStr);
  return `${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${d.getFullYear()}`;
}

function buildSummaryFilename(
  summary: { numeroCompleto: string; companyRuc?: string },
  extension: 'xml' | 'zip',
): string {
  const prefix = summary.companyRuc?.trim() ? `${summary.companyRuc.trim()}-` : '';
  return extension === 'zip'
    ? `R-${prefix}${summary.numeroCompleto}.zip`
    : `${prefix}${summary.numeroCompleto}.xml`;
}

function sanitizeFilename(value: string): string {
  return String(value || 'documento')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'documento';
}
