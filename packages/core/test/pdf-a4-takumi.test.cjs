const test = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument } = require('pdf-lib');

const { generateBoletaPdf } = require('../dist/services/pdf.service.js');

const MM_TO_PT = 72 / 25.4;

function boleta(overrides = {}) {
  return {
    company: { ruc: '20612345678', razonSocial: 'MANTA RAYA E.I.R.L.', nombreComercial: 'MANTA RAYA', direccion: 'Av. Javier Prado Este 1234, San Isidro, Lima', ubigeo: '150131' },
    branch: { codigo: '0000', nombre: 'Principal', direccion: 'Av. Javier Prado Este 1234' },
    client: { tipoDocumento: '1', numeroDocumento: '45678912', razonSocial: 'JUAN PÉREZ QUISPE', direccion: 'Jr. Ñaña 456, Ate' },
    serie: 'B001',
    correlativo: '1234',
    numeroCompleto: 'B001-1234',
    fechaEmision: '2026-11-12',
    moneda: 'PEN',
    detalles: [{ codigo: 'AG301', descripcion: 'Polo algodón pima cuello redondo talla M', unidad: 'NIU', cantidad: 2, mto_valor_unitario: 42.37, tip_afe_igv: '10', porcentaje_igv: 18 }],
    mtoOperGravadas: '84.74',
    mtoOperExoneradas: '0.00',
    mtoOperInafectas: '0.00',
    mtoOperGratuitas: '0.00',
    mtoIgv: '15.26',
    mtoIgvGratuitas: '0.00',
    mtoIsc: '0.00',
    mtoIcbper: '0.00',
    totalImpuestos: '15.26',
    subTotal: '100.00',
    mtoImpVenta: '100.00',
    codigoHash: 'qK7mZ3xV9pL2nR8tY4wB1cD6fH0=',
    ...overrides,
  };
}

const items = (n) => Array.from({ length: n }, (_, i) => ({
  codigo: `SKU-${i + 1}`,
  descripcion: `Producto ${i + 1} – edición «Ñandú»`,
  unidad: 'NIU',
  cantidad: 1,
  mto_valor_unitario: 10,
  tip_afe_igv: '10',
  porcentaje_igv: 18,
}));

test('A4 se imprime con takumi-pdf, sin Chromium, en una hoja A4', async () => {
  const bytes = await generateBoletaPdf(boleta(), 'A4');
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');

  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  assert.match(pdf.getProducer() || '', /^takumi-pdf /, 'no debe salir de Skia/Chromium');
  assert.equal(pdf.getPageCount(), 1);
  const { width, height } = pdf.getPage(0).getSize();
  assert.ok(Math.abs(width - 210 * MM_TO_PT) < 0.5, `ancho ${width}`);
  assert.ok(Math.abs(height - 297 * MM_TO_PT) < 0.5, `alto ${height}`);
});

test('A4 incrusta Liberation Sans, la fuente que usa Chromium en Railway', async () => {
  const bytes = await generateBoletaPdf(boleta(), 'A4');
  const raw = bytes.toString('latin1');
  assert.match(raw, /LiberationSans-Bold/);
  assert.match(raw, /LiberationSans/);
});

test('A4 con muchos productos pasa a una segunda página', async () => {
  const pdf = await PDFDocument.load(await generateBoletaPdf(boleta({ detalles: items(30) }), 'A4'), { updateMetadata: false });
  assert.equal(pdf.getPageCount(), 2);
});

test('factura A4 con observaciones también usa takumi-pdf', async () => {
  const bytes = await generateBoletaPdf(boleta({
    documentTypeCode: '01',
    documentTitle: 'FACTURA ELECTRÓNICA',
    serie: 'F001',
    numeroCompleto: 'F001-0000789',
    client: { tipoDocumento: '6', numeroDocumento: '20554433221', razonSocial: 'DISTRIBUIDORA LOS ANDES S.A.C.', direccion: 'Calle Las Begonias 415, San Isidro' },
    detalles: items(6),
    observations: [{ label: 'Orden de compra', value: 'OC-2026-5561' }],
  }), 'A4');
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  assert.match(pdf.getProducer() || '', /^takumi-pdf /);
  assert.equal(pdf.getPageCount(), 1);
});

test('un carácter sin glifo (emoji) no bloquea la emisión', async () => {
  const bytes = await generateBoletaPdf(boleta({
    detalles: [{ ...boleta().detalles[0], descripcion: 'Taza 🎁 regalo 漢字' }],
  }), 'A4');
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  assert.match(pdf.getProducer() || '', /^takumi-pdf /);
});
