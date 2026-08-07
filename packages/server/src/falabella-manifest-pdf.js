import { PDFDocument } from 'pdf-lib';

export async function combineFalabellaManifestPdfDocuments(documents, filename) {
  const available = documents || [];
  if (!available.length) throw new Error('Falabella no devolvió ningún PDF de manifiesto.');
  if (available.some((document) => !document?.base64)) {
    throw new Error('Falabella no devolvió todos los PDF de manifiesto solicitados.');
  }
  if (available.length === 1) {
    return {
      base64: available[0].base64,
      filename: available[0].filename || filename,
      mimeType: available[0].mimeType || 'application/pdf',
    };
  }
  const output = await PDFDocument.create();
  for (const document of available) {
    const source = await PDFDocument.load(Buffer.from(document.base64, 'base64'));
    const pages = await output.copyPages(source, source.getPageIndices());
    pages.forEach((page) => output.addPage(page));
  }
  return {
    base64: Buffer.from(await output.save()).toString('base64'),
    filename,
    mimeType: 'application/pdf',
  };
}
