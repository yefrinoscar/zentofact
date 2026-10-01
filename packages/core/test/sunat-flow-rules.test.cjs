const assert = require('node:assert/strict');
const test = require('node:test');

const {
  auditDocumentAmounts,
  auditSaleAgainstSource,
  readExpectedAmount,
  readPayableAmount,
  withExpectedAmount,
} = require('../dist/services/amount-audit.js');
const {
  classifyForReport,
  isDefinitiveStoredRejection,
  localMatchesSunat,
  seriesProbeVerdict,
  suggestReportAction,
} = require('../dist/services/sunat-reconciliation.js');
const { limaDateDaysAgo } = require('../dist/utils/lima-date.js');
const { readDatoAdicional, withDatoAdicional } = require('../dist/utils/datos-adicionales.js');

const signedXml = (payable) => `<Invoice><cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="PEN">84.75</cbc:LineExtensionAmount><cbc:PayableAmount currencyID="PEN">${payable}</cbc:PayableAmount></cac:LegalMonetaryTotal></Invoice>`;

test('montos: origen = comprobante = XML, al céntimo', () => {
  assert.equal(readPayableAmount(signedXml('100.00')), 100);
  assert.equal(readPayableAmount('<Invoice/>'), null);

  const expected = { total: 100, source: 'total del pedido Falabella' };
  assert.deepEqual(auditDocumentAmounts({ expected, stored: 100, xml: 100 }), { ok: true, mismatches: [] });
  assert.equal(auditDocumentAmounts({ expected: null, stored: 100, xml: 100 }).ok, true, 'sin origen se compara comprobante y XML');

  const xmlOff = auditDocumentAmounts({ expected, stored: 100, xml: 100.01 });
  assert.equal(xmlOff.ok, false);
  assert.match(xmlOff.mismatches[0], /XML 100\.01 ≠ comprobante 100\.00/);

  const sourceOff = auditDocumentAmounts({ expected: { total: 99.5, source: 'pedido' }, stored: 100, xml: 100 });
  assert.match(sourceOff.mismatches[0], /pedido 99\.50 ≠ comprobante 100\.00/);

  assert.equal(auditDocumentAmounts({ stored: 0, xml: 0 }).ok, false, 'un total cero nunca se envía');
  assert.equal(auditDocumentAmounts({ stored: 100, xml: null }).ok, false);
});

test('la venta construida debe sumar el total del pedido antes de reservar número', () => {
  const lines = [
    { cantidad: 2, mtoValorUnitario: 42.37288136, mtoBruto: 100, porcentajeIgv: 18 },
    { cantidad: 1, mtoValorUnitario: 21.18644068, mtoBruto: 25, porcentajeIgv: 18 },
  ];
  assert.equal(auditSaleAgainstSource({ sourceTotal: 125, sourceLabel: 'pedido', lines }).ok, true);
  assert.equal(auditSaleAgainstSource({ sourceTotal: 130, sourceLabel: 'pedido', lines }).ok, false);
  assert.equal(auditSaleAgainstSource({ sourceTotal: 0, sourceLabel: 'pedido', lines }).ok, false);
  // Sin bruto por línea se recalcula desde la base más IGV.
  assert.equal(auditSaleAgainstSource({ sourceTotal: 118, sourceLabel: 'pedido', lines: [{ cantidad: 1, mtoValorUnitario: 100, porcentajeIgv: 18 }] }).ok, true);
});

test('el monto esperado viaja en datos_adicionales sin pisar otros datos', () => {
  const datos = withExpectedAmount([{ source: 'falabella-api', orderNumber: '123' }], { total: 89.9, source: 'pedido' });
  assert.deepEqual(datos[0], { source: 'falabella-api', orderNumber: '123' });
  assert.deepEqual(readExpectedAmount(datos), { total: 89.9, source: 'pedido' });
  assert.equal(withExpectedAmount(null, undefined), null);
  assert.equal(readExpectedAmount({}), null);

  const obj = withDatoAdicional({ a: 1 }, 'b', 2);
  assert.deepEqual(obj, { a: 1, b: 2 });
  assert.equal(readDatoAdicional([{ x: 1 }, { b: 3 }], 'b'), 3);
});

test('RECHAZADO antiguo solo es definitivo si lo respaldó un CDR 2000-3999', () => {
  assert.equal(isDefinitiveStoredRejection(JSON.stringify({ code: '2800', message: 'dato inválido' })), true);
  assert.equal(isDefinitiveStoredRejection(JSON.stringify({ code: 'soap-env:Client.0130', message: 'timeout' })), false);
  assert.equal(isDefinitiveStoredRejection(JSON.stringify({ code: '1033', message: 'registrado con otros datos' })), false);
  assert.equal(isDefinitiveStoredRejection(JSON.stringify({ code: 'SOAP_ERROR' })), false);
  assert.equal(isDefinitiveStoredRejection('texto plano'), false);
  assert.equal(isDefinitiveStoredRejection(null), false);
});

test('centinela: un solo número ajeno en SUNAT basta para declarar colisión', () => {
  const notFound = { kind: 'NOT_FOUND', statusCode: '0011', message: '' };
  assert.equal(seriesProbeVerdict([notFound, notFound]), 'CLEAR');
  assert.equal(seriesProbeVerdict([notFound, { kind: 'ACCEPTED', code: '0', message: '', identity: null }]), 'COLLISION');
  assert.equal(seriesProbeVerdict([{ kind: 'REJECTED', code: '2800', message: '', identity: null }]), 'COLLISION');
  assert.equal(seriesProbeVerdict([notFound, { kind: 'QUERY_FAILED', message: 'timeout' }]), 'INCONCLUSIVE');
  assert.equal(seriesProbeVerdict([]), 'INCONCLUSIVE');
});

test('reporte: clase, coherencia con el estado local y acción sugerida', () => {
  const local = { numeroCompleto: 'B001-000010', fechaEmision: '2026-09-20', clientDocumento: '45678912' };
  const accepted = (recipientId) => ({ kind: 'ACCEPTED', code: '0', message: '', identity: { documentId: 'B001-000010', recipientId } });

  assert.equal(classifyForReport(accepted('45678912'), local).clase, 'ACEPTADO_PROPIO');
  assert.equal(classifyForReport(accepted('70000001'), local).clase, 'ACEPTADO_AJENO');
  assert.equal(classifyForReport(accepted(''), local).clase, 'ACEPTADO_SIN_VERIFICAR');
  assert.equal(classifyForReport({ kind: 'NOT_FOUND', statusCode: '0011', message: '' }, local).clase, 'NO_EXISTE');
  assert.equal(classifyForReport({ kind: 'QUERY_FAILED', message: 'x' }, local).clase, 'NO_CONSULTABLE');

  assert.equal(localMatchesSunat('ACEPTADO_PROPIO', 'NO_CONFIRMADO'), false);
  assert.equal(localMatchesSunat('ACEPTADO_AJENO', 'ACEPTADO'), false);
  assert.equal(localMatchesSunat('RECHAZADO', 'REEMPLAZADO'), true);
  assert.equal(localMatchesSunat('NO_EXISTE', 'ACEPTADO'), false);

  assert.match(suggestReportAction({ clase: 'ACEPTADO_PROPIO', estadoLocal: 'ACEPTADO', montoInconsistente: true }), /nota de crédito/);
  assert.match(suggestReportAction({ clase: 'ACEPTADO_AJENO', estadoLocal: 'ACEPTADO', montoInconsistente: false }), /Colisión/);
  assert.match(suggestReportAction({ clase: 'NO_EXISTE', estadoLocal: 'ACEPTADO', montoInconsistente: false }), /Inconsistente/);
  assert.match(suggestReportAction({ clase: 'NO_EXISTE', estadoLocal: 'NO_CONFIRMADO', montoInconsistente: false }), /mismo XML/);
});

test('las fechas del plazo se calculan en hora de Lima', () => {
  // 02:00 UTC del 1 de octubre todavía es 30 de septiembre en Lima.
  assert.equal(limaDateDaysAgo(0, new Date('2026-10-01T02:00:00Z')), '2026-09-30');
  assert.equal(limaDateDaysAgo(2, new Date('2026-10-01T15:00:00Z')), '2026-09-29');
});
