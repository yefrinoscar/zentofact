import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { combineFalabellaManifestPdfDocuments } from './falabella-manifest-pdf.js';

async function pdf(widths) {
  const document = await PDFDocument.create();
  widths.forEach((width) => document.addPage([width, 100]));
  return Buffer.from(await document.save()).toString('base64');
}

test('combina todas las páginas de tiendas en el orden recibido', async () => {
  const combined = await combineFalabellaManifestPdfDocuments([
    { base64: await pdf([101, 102]), filename: 'a.pdf', mimeType: 'application/pdf' },
    { base64: await pdf([201]), filename: 'b.pdf', mimeType: 'application/pdf' },
  ], 'todos.pdf');
  const loaded = await PDFDocument.load(Buffer.from(combined.base64, 'base64'));
  assert.equal(combined.filename, 'todos.pdf');
  assert.deepEqual(loaded.getPages().map((page) => page.getWidth()), [101, 102, 201]);
});

test('no omite silenciosamente un lote sin documentos', async () => {
  await assert.rejects(
    combineFalabellaManifestPdfDocuments([], 'todos.pdf'),
    /no devolvió ningún PDF/,
  );
  await assert.rejects(
    combineFalabellaManifestPdfDocuments([
      { base64: await pdf([100]), filename: 'a.pdf' },
      { base64: '', filename: 'b.pdf' },
    ], 'todos.pdf'),
    /no devolvió todos los PDF/,
  );
});
