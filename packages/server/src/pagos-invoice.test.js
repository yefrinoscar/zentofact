import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attachInvoicesToSales,
  classifyInvoiceConcept,
  classifyInvoiceKind,
  cobroFromSigned,
  csvIsInvoiceReport,
  foldInvoiceCharges,
  groupInvoiceDocuments,
  headerLooksLikeInvoiceReport,
  isInvoiceReportFilename,
  parseInvoiceReportCsv,
  periodFromFilename,
} from './pagos-invoice.js';
import { importSettlementCsv } from './pagos.js';

const HEADER = [
  'Numero de documento',
  'Tipo de documento',
  'Fecha de Transaccion',
  'Descripcion Factura',
  'Tipo de Transaccion',
  'Nombre del producto',
  'SKU vendedor',
  'SKU Falabella',
  'Monto (Sin IVA)',
  'IVA',
  'Monto con IVA',
  'Divisa',
  'N estado de cuenta',
  'N de orden',
  'Referencia de pago Fpay',
  'Falabella-Id',
  'Seller ID',
].join(',');

function line(values) {
  return values.join(',');
}

const CSV = [
  HEADER,
  line(['249302', 'Factura', '2026-08-07 09:08:49', 'Comisiones', 'Cobro por comisión por venta', 'Mochila Táctica', 'df65dr6', '144957725', '-12.19', '-2.19', '-14.38', 'PEN', 'FAPE-SCDE75A-20260807-PEN', '3247518451', '352554518', 'id-1', 'SCDE75A']),
  line(['249302', 'Factura', '2026-08-07 09:08:49', 'Envio: Cofinanciamiento logistico', 'Cobro por cofinanciamiento logístico', 'Mochila Táctica', 'df65dr6', '144957725', '-6.69', '-1.21', '-7.90', 'PEN', 'FAPE-SCDE75A-20260807-PEN', '3247518451', '352554518', 'id-1', 'SCDE75A']),
  line(['249302', 'Factura', '2026-08-01 03:08:15', 'Publicidad: Productos patrocinados', 'Cobro por Productos patrocinados', '', '', '', '-2209.40', '-397.69', '-2607.09', 'PEN', 'FAPE-SCDE75A-20260801-PEN', '', '352380758', 'id-ads', 'SCDE75A']),
  line(['74527', 'Nota de Credito', '2026-08-07 09:08:00', 'Comisiones', 'Reembolso por comisión por venta', 'Mochila Táctica', 'df65dr6', '144957725', '7.63', '1.37', '9.00', 'PEN', 'FAPE-SCDE75A-20260807-PEN', '3247518451', '352554518', 'id-1', 'SCDE75A']),
].join('\n');

test('reconoce el InvoiceReport por nombre y cabecera', () => {
  assert.equal(isInvoiceReportFilename('InvoiceReport_FAPE-SCDE75A-2026-08-01-2026-08-07.xlsx'), true);
  assert.equal(isInvoiceReportFilename('NewReportTransaction.xlsx'), false);
  assert.equal(headerLooksLikeInvoiceReport(HEADER), true);
  assert.equal(csvIsInvoiceReport(CSV), true);
  assert.equal(csvIsInvoiceReport('Estado de pago,N° de orden,Monto\nPagado,1,10'), false);
  assert.deepEqual(
    periodFromFilename('InvoiceReport_FAPE-SCDE75A-2026-08-01-2026-08-07_2026-09-01T18.xlsx'),
    { from: '2026-08-01', to: '2026-08-07' },
  );
});

test('clasifica factura, nota y el concepto que Falabella cobra', () => {
  assert.equal(classifyInvoiceKind('Factura'), 'factura');
  assert.equal(classifyInvoiceKind('Nota de Credito'), 'nota_credito');
  assert.equal(classifyInvoiceConcept('Comisiones', 'Cobro por comisión por venta'), 'commission');
  assert.equal(classifyInvoiceConcept('Envio: Cofinanciamiento logistico'), 'logistics');
  assert.equal(classifyInvoiceConcept('Envio: A cargo de cliente', 'Reversa de pago de envío comprador'), 'buyer_shipping');
  assert.equal(classifyInvoiceConcept('Publicidad: Productos patrocinados'), 'ads');
});

test('agrupa el InvoiceReport en factura y nota de crédito', () => {
  const parsed = parseInvoiceReportCsv(CSV);
  assert.equal(parsed.lines.length, 4);
  assert.equal(parsed.documents.length, 2);
  const factura = parsed.documents.find((document) => document.kind === 'factura');
  const credit = parsed.documents.find((document) => document.kind === 'nota_credito');
  assert.equal(factura.number, '249302');
  assert.equal(factura.sellerId, 'SCDE75A');
  assert.equal(factura.lineCount, 3);
  assert.equal(factura.net, -2228.28);
  assert.equal(factura.igv, -401.09);
  assert.equal(factura.gross, -2629.37);
  assert.deepEqual(factura.concepts.map((row) => row.key), ['commission', 'logistics', 'ads']);
  assert.equal(factura.concepts.find((row) => row.key === 'ads').gross, -2607.09);
  assert.equal(credit.number, '74527');
  assert.equal(credit.gross, 9);
  assert.equal(credit.lineCount, 1);
});

test('el pedido apunta a la factura de Falabella y también a la nota', () => {
  const grouped = groupInvoiceDocuments(parseInvoiceReportCsv(CSV).lines);
  const factura = grouped.find((document) => document.kind === 'factura');
  const credit = grouped.find((document) => document.kind === 'nota_credito');
  const [sale] = attachInvoicesToSales(
    [{ orderId: '3247518451', bruto: 98.89 }],
    [
      { orderNumber: '3247518451', id: 11, number: factura.number, kind: 'factura' },
      { orderNumber: '3247518451', id: 22, number: credit.number, kind: 'nota_credito' },
    ],
  );
  assert.equal(sale.falabellaInvoice.number, '249302');
  assert.equal(sale.falabellaInvoice.kind, 'factura');
  assert.equal(sale.falabellaInvoices.length, 2);
  const [empty] = attachInvoicesToSales([{ orderId: 'no-existe' }], []);
  assert.equal(empty.falabellaInvoice, null);
  assert.equal(empty.invoiceCharges, null);
});

test('los cobros de la factura Falabella se cruzan al pedido', () => {
  assert.equal(cobroFromSigned(-14.38), 14.38);
  assert.equal(cobroFromSigned(9), -9);
  const charges = foldInvoiceCharges(parseInvoiceReportCsv(CSV).lines);
  const order = charges.get('3247518451');
  assert.equal(order.commission.gross, 5.38);
  assert.equal(order.logistics.gross, 7.9);
  const [sale] = attachInvoicesToSales(
    [{ orderId: '3247518451' }],
    [{ orderNumber: '3247518451', id: 11, number: '249302', kind: 'factura' }],
    parseInvoiceReportCsv(CSV).lines,
  );
  assert.equal(sale.invoiceCharges.commission.gross, 5.38);
  assert.equal(sale.invoiceCharges.logistics.net, 6.69);
});

test('el cruce de pagos rechaza el InvoiceReport', async () => {
  await assert.rejects(
    () => importSettlementCsv({ filename: 'InvoiceReport_FAPE-SCDE75A.xlsx', csv: CSV }, { query: async () => ({ rows: [] }) }),
    /Subir facturas/,
  );
});
