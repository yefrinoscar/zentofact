import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeInvoiceSpreadsheet,
  headerLooksLikeInvoiceReport,
  invoiceChargeAmount,
  invoiceConceptLabel,
  invoiceImportSummary,
  invoiceKindLabel,
  invoiceNumberLabel,
  invoicePeriodLabel,
  isInvoiceReportFilename,
  readInvoiceReportUpload,
} from './pagos-invoice-report.ts';

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
  'Seller ID',
];

test('nombra factura, nota y conceptos como en el Excel', () => {
  assert.equal(isInvoiceReportFilename('InvoiceReport_FAPE-SCDE75A-2026-08-01-2026-08-07.xlsx'), true);
  assert.equal(headerLooksLikeInvoiceReport(HEADER.join(',')), true);
  assert.equal(invoiceKindLabel('factura'), 'Factura');
  assert.equal(invoiceKindLabel('nota_credito'), 'Nota de crédito');
  assert.equal(invoiceNumberLabel({ kind: 'factura', number: '249302' }), 'Factura 249302');
  assert.equal(invoiceNumberLabel({ kind: 'nota_credito', number: '74527' }), 'NC 74527');
  assert.equal(invoiceConceptLabel('commission'), 'Comisiones');
  assert.equal(invoiceConceptLabel('logistics'), 'Logística');
  assert.equal(invoiceConceptLabel('buyer_shipping'), 'Envío del comprador');
  assert.equal(invoiceConceptLabel('ads'), 'Publicidad');
  assert.equal(invoicePeriodLabel('2026-08-01', '2026-08-07'), '1 ago. – 7 ago.');
  assert.equal(invoiceImportSummary({ reused: true }), 'Esta factura ya está cargada.');
  assert.equal(
    invoiceImportSummary({
      documents: [{ kind: 'nota_credito', number: '74527' }, { kind: 'factura', number: '249302' }],
      lineCount: 235,
    }),
    'Factura 249302 · NC 74527 · 235 líneas',
  );
});

test('la vista de factura muestra el cobro en positivo', () => {
  assert.deepEqual(invoiceChargeAmount('factura', -14.38), { amount: 14.38, credit: false });
  assert.deepEqual(invoiceChargeAmount('factura', -4561.09), { amount: 4561.09, credit: false });
  assert.deepEqual(invoiceChargeAmount('nota_credito', 9), { amount: 9, credit: true });
});

test('lee el InvoiceReport xlsx y rechaza el estado de cuenta', async () => {
  const { utils, write } = await import('xlsx');
  const invoiceSheet = utils.aoa_to_sheet([
    HEADER,
    ['249302', 'Factura', '2026-08-07', 'Comisiones', 'Cobro por comisión por venta', 'Mochila', 'df65dr6', '144957725', '-12.19', '-2.19', '-14.38', 'PEN', 'FAPE-SCDE75A-20260807-PEN', '3247518451', 'SCDE75A'],
  ]);
  const invoiceBook = utils.book_new();
  utils.book_append_sheet(invoiceBook, invoiceSheet, 'settlement invoice');
  const csv = decodeInvoiceSpreadsheet(write(invoiceBook, { type: 'array', bookType: 'xlsx' }));
  assert.match(csv, /Numero de documento/);
  assert.match(csv, /249302/);
  assert.match(csv, /3247518451/);

  const settlementSheet = utils.aoa_to_sheet([
    ['Fecha creación de la orden', 'N° del orden', 'Estado de pago', 'Monto con IVA'],
    ['2026-08-19', '3248910865', 'Pagado', '8.99'],
  ]);
  const settlementBook = utils.book_new();
  utils.book_append_sheet(settlementBook, settlementSheet, 'Reporte');
  const settlementBytes = write(settlementBook, { type: 'array', bookType: 'xlsx' });
  assert.throws(
    () => decodeInvoiceSpreadsheet(settlementBytes),
    /Subir archivo/,
  );

  const fromFile = await readInvoiceReportUpload({
    name: 'InvoiceReport_demo.xlsx',
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    arrayBuffer: async () => write(invoiceBook, { type: 'array', bookType: 'xlsx' }),
  });
  assert.match(fromFile, /249302/);
});
