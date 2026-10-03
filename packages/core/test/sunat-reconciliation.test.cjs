const assert = require('node:assert/strict');
const test = require('node:test');
const AdmZip = require('adm-zip');

const {
  cdrVerdict,
  classifyStatusCdr,
  compareCdrIdentity,
  decideReemission,
  parseCdrIdentityXml,
  readReconciliationTrace,
  withReconciliationTrace,
} = require('../dist/services/sunat-reconciliation.js');

// CDR con la forma de SUNAT: ReceiverParty es el emisor (nuestro RUC) y
// RecipientParty, dentro de DocumentResponse, es el cliente del comprobante.
function cdrXml({ code = '0', number = 'B001-000123', recipient = '45678912', issueDate = '2026-09-20', hash = '' } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ar:ApplicationResponse xmlns:ar="urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2" xmlns:cac="urn:cac" xmlns:cbc="urn:cbc">
  <cbc:UBLVersionID>2.0</cbc:UBLVersionID>
  <cbc:ID>1727800000000</cbc:ID>
  <cbc:IssueDate>2026-09-21</cbc:IssueDate>
  <cac:SenderParty><cac:PartyIdentification><cbc:ID>20131312955</cbc:ID></cac:PartyIdentification></cac:SenderParty>
  <cac:ReceiverParty><cac:PartyIdentification><cbc:ID>20600000001</cbc:ID></cac:PartyIdentification></cac:ReceiverParty>
  <cac:DocumentResponse>
    <cac:Response>
      <cbc:ReferenceID>${number}</cbc:ReferenceID>
      <cbc:ResponseCode>${code}</cbc:ResponseCode>
      <cbc:Description>La Boleta numero ${number}, ha sido aceptada</cbc:Description>
    </cac:Response>
    <cac:DocumentReference>
      <cbc:ID>${number}</cbc:ID>
      <cbc:IssueDate>${issueDate}</cbc:IssueDate>
      ${hash ? `<cac:Attachment><cac:ExternalReference><cbc:DocumentHash>${hash}</cbc:DocumentHash></cac:ExternalReference></cac:Attachment>` : ''}
    </cac:DocumentReference>
    <cac:RecipientParty><cac:PartyIdentification><cbc:ID schemeID="1">${recipient}</cbc:ID></cac:PartyIdentification></cac:RecipientParty>
  </cac:DocumentResponse>
</ar:ApplicationResponse>`;
}

function cdrZip(options) {
  const zip = new AdmZip();
  zip.addFile('R-20600000001-03-B001-000123.xml', Buffer.from(cdrXml(options), 'utf-8'));
  return zip.toBuffer();
}

const local = { numeroCompleto: 'B001-000123', fechaEmision: '2026-09-20', clientDocumento: '45678912', codigoHash: 'abc=' };
const freshTrace = { resendCount: 0, newNumberCount: 0 };

test('un CDR con observaciones (4000+) es aceptado; solo 2000-3999 es rechazo', () => {
  assert.equal(cdrVerdict('0'), 'ACCEPTED');
  assert.equal(cdrVerdict('4252'), 'ACCEPTED');
  assert.equal(cdrVerdict('2800'), 'REJECTED');
  assert.equal(cdrVerdict('3105'), 'REJECTED');
  // Excepciones y vacíos no deciden nada.
  assert.equal(cdrVerdict('1033'), 'UNKNOWN');
  assert.equal(cdrVerdict('0130'), 'UNKNOWN');
  assert.equal(cdrVerdict(''), 'UNKNOWN');
  assert.equal(cdrVerdict(undefined), 'UNKNOWN');
});

test('lee del CDR el cliente del comprobante, no el RUC del emisor', () => {
  const identity = parseCdrIdentityXml(cdrXml({ hash: 'xyz=' }));
  assert.deepEqual(identity, {
    documentId: 'B001-000123',
    issueDate: '2026-09-20',
    recipientId: '45678912',
    recipientDocumentType: '1',
    documentHash: 'xyz=',
  });
});

test('un error de consulta o un código ambiguo nunca cuenta como "no existe"', () => {
  assert.equal(classifyStatusCdr({ success: false, error: { code: 'HTTP_ERROR', message: 'timeout' } }).kind, 'QUERY_FAILED');
  // 0127 es "ticket no existe" del servicio de resúmenes: no prueba nada sobre el número.
  assert.equal(classifyStatusCdr({ success: true, statusCode: '0127', statusMessage: 'El ticket no existe' }).kind, 'UNKNOWN');
  assert.equal(classifyStatusCdr({ success: true, statusCode: '0125', statusMessage: 'No se pudo obtener la constancia' }).kind, 'UNKNOWN');
  assert.equal(classifyStatusCdr({ success: true }).kind, 'UNKNOWN');
});

test('clasifica las respuestas explícitas de getStatusCdr', () => {
  assert.equal(classifyStatusCdr({ success: true, statusCode: '0011', statusMessage: 'El comprobante de pago electrónico no existe.' }).kind, 'NOT_FOUND');
  assert.equal(classifyStatusCdr({ success: true, statusCode: '0003', statusMessage: 'El comprobante existe pero está de baja' }).kind, 'VOIDED');
  assert.equal(classifyStatusCdr({ success: true, statusCode: '0012', statusMessage: 'No le pertenece' }).kind, 'NOT_OWNED');

  const accepted = classifyStatusCdr({ success: true, statusCode: '0001', cdrZip: cdrZip(), cdrResponse: { code: '0', description: 'aceptada' } });
  assert.equal(accepted.kind, 'ACCEPTED');
  assert.equal(accepted.identity.recipientId, '45678912');

  const rejected = classifyStatusCdr({ success: true, statusCode: '0002', cdrZip: cdrZip({ code: '2800' }), cdrResponse: { code: '2800', description: 'rechazada' } });
  assert.equal(rejected.kind, 'REJECTED');
});

test('identidad: el número igual no basta, debe coincidir el cliente o el hash', () => {
  assert.equal(compareCdrIdentity(parseCdrIdentityXml(cdrXml()), local).result, 'MATCH');
  assert.equal(compareCdrIdentity(parseCdrIdentityXml(cdrXml({ recipient: '70000001' })), local).result, 'MISMATCH');
  assert.equal(compareCdrIdentity(parseCdrIdentityXml(cdrXml({ number: 'B001-000124' })), local).result, 'MISMATCH');
  assert.equal(compareCdrIdentity(parseCdrIdentityXml(cdrXml({ issueDate: '2026-09-18' })), local).result, 'MISMATCH');
  // Ceros a la izquierda distintos son el mismo número.
  assert.equal(compareCdrIdentity(parseCdrIdentityXml(cdrXml({ number: 'B001-123' })), local).result, 'MATCH');
});

test('identidad: el hash del XML firmado prueba que es nuestro aunque no haya cliente', () => {
  const identity = parseCdrIdentityXml(cdrXml({ recipient: '-', hash: 'abc=' }));
  assert.equal(compareCdrIdentity(identity, local).result, 'MATCH');
});

test('identidad: sin cliente comparable ni hash no se puede afirmar que sea nuestro', () => {
  assert.equal(compareCdrIdentity(parseCdrIdentityXml(cdrXml({ recipient: '00000000' })), local).result, 'UNVERIFIABLE');
  assert.equal(compareCdrIdentity(parseCdrIdentityXml(cdrXml()), { ...local, clientDocumento: '-' }).result, 'UNVERIFIABLE');
  assert.equal(compareCdrIdentity(null, local).result, 'UNVERIFIABLE');
});

function decide(statusResult, trace = freshTrace) {
  return decideReemission({ outcome: classifyStatusCdr(statusResult), local, trace });
}

test('respuesta perdida: SUNAT tiene aceptado nuestro comprobante → se recupera, no se reemite', () => {
  const decision = decide({ success: true, statusCode: '0001', cdrZip: cdrZip(), cdrResponse: { code: '0' } });
  assert.equal(decision.action, 'MARK_ACCEPTED');
  assert.equal(decision.estadoSunat, 'ACEPTADO');
});

test('colisión probada con otro cliente → número nuevo consultando los siguientes', () => {
  const decision = decide({ success: true, statusCode: '0001', cdrZip: cdrZip({ recipient: '70000001' }), cdrResponse: { code: '0' } });
  assert.equal(decision.action, 'ISSUE_NEW_NUMBER');
  assert.equal(decision.estadoSunat, 'RECHAZADO');
  assert.equal(decision.collision, true);
});

test('aceptado sin CDR legible → revisión manual, nunca aceptación a ciegas', () => {
  const decision = decide({ success: true, statusCode: '0001', cdrResponse: { code: '0' } });
  assert.equal(decision.action, 'MANUAL_REVIEW');
});

test('no existe → se reenvía el mismo XML hasta el tope y luego revisión manual', () => {
  const notFound = { success: true, statusCode: '0011', statusMessage: 'El comprobante de pago electrónico no existe.' };
  assert.equal(decide(notFound, { resendCount: 0, newNumberCount: 0 }).action, 'RESEND_SAME_NUMBER');
  assert.equal(decide(notFound, { resendCount: 2, newNumberCount: 0 }).action, 'RESEND_SAME_NUMBER');
  assert.equal(decide(notFound, { resendCount: 3, newNumberCount: 0 }).action, 'MANUAL_REVIEW');
});

test('rechazo con CDR → número nuevo, con tope de números nuevos por pedido', () => {
  const rejected = { success: true, statusCode: '0002', cdrZip: cdrZip({ code: '2800' }), cdrResponse: { code: '2800', description: 'Dato inválido' } };
  assert.equal(decide(rejected, { resendCount: 0, newNumberCount: 0 }).action, 'ISSUE_NEW_NUMBER');
  assert.equal(decide(rejected, { resendCount: 0, newNumberCount: 1 }).action, 'ISSUE_NEW_NUMBER');
  assert.equal(decide(rejected, { resendCount: 0, newNumberCount: 2 }).action, 'MANUAL_REVIEW');
});

test('consulta fallida → se bloquea sin tocar el estado; incierto → NO_CONFIRMADO', () => {
  const failed = decide({ success: false, error: { code: 'SOAP_ERROR', message: '0130' } });
  assert.equal(failed.action, 'BLOCK');
  assert.equal(failed.estadoSunat, null);

  const uncertain = decide({ success: true, statusCode: '0125', statusMessage: 'No se pudo obtener la constancia' });
  assert.equal(uncertain.action, 'BLOCK');
  assert.equal(uncertain.estadoSunat, 'NO_CONFIRMADO');
});

test('de baja o de otro RUC → revisión manual', () => {
  assert.equal(decide({ success: true, statusCode: '0003', statusMessage: 'de baja' }).action, 'MANUAL_REVIEW');
  assert.equal(decide({ success: true, statusCode: '0012', statusMessage: 'no pertenece' }).action, 'MANUAL_REVIEW');
});

test('los contadores se guardan sin perder el resto de datos_adicionales', () => {
  const trace = { resendCount: 2, newNumberCount: 1, lastDecision: 'RESEND_SAME_NUMBER' };

  const fromObject = withReconciliationTrace({ falabella_pdf_upload: { uploadedAt: 'x' } }, trace);
  assert.deepEqual(fromObject.falabella_pdf_upload, { uploadedAt: 'x' });
  assert.deepEqual(readReconciliationTrace(fromObject), { resendCount: 2, newNumberCount: 1 });

  const fromArray = withReconciliationTrace([{ source: 'falabella-api' }, { sunat_reconciliation: { resend_count: 9 } }], trace);
  assert.equal(fromArray.length, 2);
  assert.deepEqual(fromArray[0], { source: 'falabella-api' });
  assert.deepEqual(readReconciliationTrace(fromArray), { resendCount: 2, newNumberCount: 1 });

  assert.deepEqual(readReconciliationTrace(withReconciliationTrace(null, trace)), { resendCount: 2, newNumberCount: 1 });
  assert.deepEqual(readReconciliationTrace(null), { resendCount: 0, newNumberCount: 0 });
});


test('CDR: el prefijo 1- del tipo DNI no cambia la identidad del cliente', () => {
  const outcome = classifyStatusCdr({ success: true, statusCode: '0001', cdrZip: cdrZip({ recipient: '1-76805729' }), cdrResponse: { code: '0' } });
  const document = { ...local, clientDocumento: '76805729', clientTipoDocumento: '1' };
  assert.equal(compareCdrIdentity(outcome.identity, document).result, 'MATCH');
  assert.equal(decideReemission({ outcome, local: document, trace: freshTrace }).action, 'MARK_ACCEPTED');
});


test('CDR: tipo, número y fecha distintos siguen bloqueados', () => {
  const document = { ...local, clientDocumento: '76805729', clientTipoDocumento: '1' };
  for (const options of [{ recipient: '1-76805728' }, { recipient: '1-76805729', issueDate: '2026-09-19' }]) {
    assert.equal(compareCdrIdentity(parseCdrIdentityXml(cdrXml(options)), document).result, 'MISMATCH');
  }
  const wrongType = parseCdrIdentityXml(cdrXml({ recipient: '4-76805729' }).replace('schemeID="1"', 'schemeID="4"'));
  assert.equal(compareCdrIdentity(wrongType, document).result, 'MISMATCH');
  assert.equal(compareCdrIdentity(parseCdrIdentityXml(cdrXml({ recipient: '4-76805729' })), document).result, 'UNVERIFIABLE');
  assert.equal(compareCdrIdentity(parseCdrIdentityXml(cdrXml({ recipient: '1-7680572' })), document).result, 'UNVERIFIABLE');
});

test('CDR: RUC prefijado, DNI con cero inicial y documento plano', () => {
  const ruc = parseCdrIdentityXml(cdrXml({ recipient: '6-20600000001' }).replace('schemeID="1"', 'schemeID="6"'));
  assert.equal(compareCdrIdentity(ruc, { ...local, clientDocumento: '20600000001', clientTipoDocumento: '6' }).result, 'MATCH');
  for (const recipient of ['1-06805729', '06805729']) {
    assert.equal(compareCdrIdentity(parseCdrIdentityXml(cdrXml({ recipient })), { ...local, clientDocumento: '06805729', clientTipoDocumento: '1' }).result, 'MATCH');
  }
  assert.equal(compareCdrIdentity(parseCdrIdentityXml(cdrXml({ recipient: '1-00000000' })), local).result, 'UNVERIFIABLE');
});


test('CDR: SUNAT puede incluir tipo-número sin atributo schemeID', () => {
  const identity = parseCdrIdentityXml(cdrXml({ recipient: '1-76805729' }).replace(' schemeID="1"', ''));
  assert.equal(compareCdrIdentity(identity, { ...local, clientDocumento: '76805729', clientTipoDocumento: '1' }).result, 'MATCH');
});

test('otro número, misma identidad con fecha distinta o tipo distinto no autorizan reemplazo por colisión', () => {
  for (const attrs of [{number:'B001-000124',recipient:'70000001'}, {issueDate:'2026-09-18'}, {recipient:'6-45678912'}]) {
    assert.equal(decide({success:true,statusCode:'0001',cdrZip:cdrZip(attrs),cdrResponse:{code:'0'}}).action,'MANUAL_REVIEW');
  }
});
