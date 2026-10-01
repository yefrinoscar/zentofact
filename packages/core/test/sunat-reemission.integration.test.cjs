// Integración de la reconciliación con SUNAT contra PostgreSQL real.
// Usa una base DESECHABLE: corre las migraciones y crea empresas de prueba.
//   CORE_TEST_DATABASE_URL=postgres://... npm test -w @zentofact/core
// La firma del XML es real (certificado autofirmado); solo se reemplazan los
// dos llamados SOAP (sendBill y getStatusCdr) por respuestas guionadas.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it, before, beforeEach, after } = require('node:test');
const AdmZip = require('adm-zip');
const forge = require('node-forge');

const connectionString = process.env.CORE_TEST_DATABASE_URL;
const skip = !connectionString && 'define CORE_TEST_DATABASE_URL para ejecutar la integración';

const CLIENT_DOC = '45678912';
const OTHER_CLIENT_DOC = '70000001';

let pool;
let boletaService;
let summaryQuery;
let creditNoteService;
let sweep;
let report;
let certificatePem;

// Respuestas guionadas de SUNAT para cada prueba.
const sunat = { sendQueue: [], statusQueue: [], sent: [], queried: [], statusDelayMs: 0 };

function testCertificatePem() {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 86400000);
  const attrs = [{ name: 'commonName', value: 'ZentoFact Test' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const privateKey = forge.pki.privateKeyInfoToPem(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(keys.privateKey)));
  return `${privateKey}\n${forge.pki.certificateToPem(cert)}`;
}

function cdrZip({ code, number, recipient, issueDate }) {
  const zip = new AdmZip();
  zip.addFile(`R-${number}.xml`, Buffer.from(`<ar:ApplicationResponse>
  <cbc:ID>1727800000000</cbc:ID>
  <cac:ReceiverParty><cac:PartyIdentification><cbc:ID>20600000001</cbc:ID></cac:PartyIdentification></cac:ReceiverParty>
  <cac:DocumentResponse>
    <cac:Response><cbc:ReferenceID>${number}</cbc:ReferenceID><cbc:ResponseCode>${code}</cbc:ResponseCode><cbc:Description>respuesta ${code}</cbc:Description></cac:Response>
    <cac:DocumentReference><cbc:ID>${number}</cbc:ID>${issueDate ? `<cbc:IssueDate>${issueDate}</cbc:IssueDate>` : ''}</cac:DocumentReference>
    <cac:RecipientParty><cac:PartyIdentification><cbc:ID>${recipient}</cbc:ID></cac:PartyIdentification></cac:RecipientParty>
  </cac:DocumentResponse>
</ar:ApplicationResponse>`, 'utf-8'));
  return zip.toBuffer().toString('base64');
}

// Número "B001-000001" a partir del nombre de archivo "RUC-03-B001-000001.zip".
const numberFromFile = (fileName) => fileName.replace(/\.zip$/, '').split('-').slice(2).join('-');

const send = {
  accepted: (code = '0') => (fileName) => ({ applicationResponse: cdrZip({ code, number: numberFromFile(fileName), recipient: CLIENT_DOC }) }),
  rejected: () => (fileName) => ({ applicationResponse: cdrZip({ code: '2800', number: numberFromFile(fileName), recipient: CLIENT_DOC }) }),
  fault: (code, message) => () => { const error = new Error(message); error.code = code; throw error; },
  timeout: () => () => { const error = new Error('socket hang up'); error.code = 'ECONNRESET'; throw error; },
};

const status = {
  accepted: (recipient = CLIENT_DOC) => ({ number }) => ({ statusCode: '0001', statusMessage: 'aceptado', content: cdrZip({ code: '0', number, recipient }) }),
  rejected: () => ({ number }) => ({ statusCode: '0002', statusMessage: 'rechazado', content: cdrZip({ code: '2800', number, recipient: CLIENT_DOC }) }),
  notFound: () => () => ({ statusCode: '0011', statusMessage: 'El comprobante de pago electrónico no existe.' }),
  fails: () => () => { const error = new Error('HTTP 503'); error.code = 'HTTP_ERROR'; throw error; },
};

async function createCompany() {
  const ruc = `20${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  const company = (await pool.query(
    `insert into companies (ruc, razon_social, direccion, ubigeo, certificado, usuario_sol, clave_sol)
     values ($1, 'EMPRESA PRUEBA SAC', 'AV PRUEBA 123', '150101', $2, 'USUARIO', 'CLAVE') returning id`,
    [ruc, certificatePem],
  )).rows[0];
  const branch = (await pool.query(
    `insert into branches (company_id, codigo, nombre) values ($1, '0000', 'PRINCIPAL') returning id`,
    [company.id],
  )).rows[0];
  return { companyId: company.id, branchId: branch.id, ruc };
}

const newOrderNumber = () => `ORD-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

async function createBoletaFor(company, orderNumber = newOrderNumber(), extra = {}) {
  const created = await boletaService.createBoleta({
    company_id: company.companyId,
    branch_id: company.branchId,
    order_number: orderNumber,
    serie: 'B001',
    fecha_emision: new Date().toISOString().slice(0, 10),
    metodo_envio: 'individual',
    client: { tipo_documento: '1', numero_documento: CLIENT_DOC, razon_social: 'CLIENTE PRUEBA' },
    detalles: [{ codigo: 'P1', descripcion: 'PRODUCTO', unidad: 'NIU', cantidad: 1, mto_valor_unitario: 84.75, mto_bruto: 100, porcentaje_igv: 18, tip_afe_igv: '10' }],
    persistCorrelative: true,
    ...extra,
  });
  return { ...created, orderNumber, companyId: company.companyId, ruc: company.ruc };
}

async function createBoleta(orderNumber = newOrderNumber(), extra = {}) {
  return createBoletaFor(await createCompany(), orderNumber, extra);
}

const boletaRow = async (id) => (await pool.query('select * from boletas where id=$1', [id])).rows[0];
const companyBoletas = async (companyId) => (await pool.query('select * from boletas where company_id=$1 order by id', [companyId])).rows;

describe('reconciliación con SUNAT antes de reemitir', { skip }, () => {
  before(async () => {
    process.env.DATABASE_URL_POSTGRES = connectionString;
    process.env.STORAGE_PATH = fs.mkdtempSync(path.join(os.tmpdir(), 'zentofact-reemision-'));
    // Producción: aplica el registro "un número, un XML" (los SOAP están simulados).
    process.env.SUNAT_FORCE_ENV = 'produccion';
    for (const key of ['R2_PROXY_URL', 'R2_PROXY_SECRET', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_ENDPOINT', 'R2_REGION']) {
      process.env[key] = '';
    }

    ({ pool } = require('../dist/db/index.js'));
    const { runMigrations } = require('../dist/db/migrate.js');
    await runMigrations(pool);
    boletaService = require('../dist/services/boleta.service.js');
    summaryQuery = require('../dist/services/daily-summary-query.service.js');
    creditNoteService = require('../dist/services/credit-note.service.js');
    sweep = require('../dist/services/sunat-sweep.service.js');
    report = require('../dist/services/sunat-report.service.js');
    certificatePem = testCertificatePem();

    const { SunatService } = require('../dist/services/sunat.service.js');
    SunatService.prototype.sendBillSoap = async function (fileName, base64Zip) {
      const zip = new AdmZip(Buffer.from(base64Zip, 'base64'));
      sunat.sent.push({ number: numberFromFile(fileName), xml: zip.getEntries()[0].getData().toString('utf-8') });
      const next = sunat.sendQueue.shift();
      if (!next) throw new Error(`sendBill no esperado para ${fileName}`);
      return next(fileName);
    };
    SunatService.prototype.getStatusCdrSoap = async function (_ruc, _tipo, serie, numero) {
      const number = `${serie}-${numero}`;
      sunat.queried.push(number);
      if (sunat.statusDelayMs) await new Promise((resolve) => setTimeout(resolve, sunat.statusDelayMs));
      const next = sunat.statusQueue.shift();
      if (!next) throw new Error(`getStatusCdr no esperado para ${number}`);
      return next({ number });
    };
  });

  beforeEach(() => {
    Object.assign(sunat, { sendQueue: [], statusQueue: [], sent: [], queried: [], statusDelayMs: 0 });
  });

  after(async () => {
    await pool?.end();
  });

  it('respuesta perdida: SUNAT ya lo tenía aceptado → se recupera sin reemitir', async () => {
    const boleta = await createBoleta();
    sunat.sendQueue.push(send.timeout());
    const first = await boletaService.sendBoletaToSunat(boleta.id);
    assert.equal(first.success, false);

    const afterTimeout = await boletaRow(boleta.id);
    assert.equal(afterTimeout.estado_sunat, 'NO_CONFIRMADO');
    assert.ok(afterTimeout.xml_path, 'el XML firmado se guarda antes de enviar');
    assert.ok(afterTimeout.codigo_hash);

    sunat.statusQueue.push(status.accepted());
    const reconciled = await boletaService.reEmitBoleta(boleta.id);
    assert.equal(reconciled.success, true);
    assert.equal(reconciled.decision, 'MARK_ACCEPTED');

    const row = await boletaRow(boleta.id);
    assert.equal(row.estado_sunat, 'ACEPTADO');
    assert.ok(row.cdr_path);
    assert.equal(sunat.sent.length, 1, 'no se vuelve a enviar');
    assert.equal((await companyBoletas(boleta.companyId)).length, 1, 'no se crea otra boleta');
  });

  it('1033 por colisión de serie: aceptado para otro cliente → revisión manual, sin otro número', async () => {
    const boleta = await createBoleta();
    sunat.sendQueue.push(send.fault('soap-env:Client.1033', 'El comprobante fue registrado previamente con otros datos'));
    await boletaService.sendBoletaToSunat(boleta.id);
    assert.equal((await boletaRow(boleta.id)).estado_sunat, 'NO_CONFIRMADO');

    sunat.statusQueue.push(status.accepted(OTHER_CLIENT_DOC));
    const reconciled = await boletaService.reEmitBoleta(boleta.id);
    assert.equal(reconciled.success, false);
    assert.equal(reconciled.manualReview, true);

    const row = await boletaRow(boleta.id);
    assert.equal(row.estado_sunat, 'REVISION_MANUAL');
    assert.equal(row.order_number, boleta.orderNumber, 'la orden sigue vinculada para revisión');
    assert.equal((await companyBoletas(boleta.companyId)).length, 1);

    // Ningún camino automático sale de REVISION_MANUAL.
    const resend = await boletaService.sendBoletaToSunat(boleta.id);
    assert.equal(resend.error_code, 'DOCUMENT_CLOSED');
    const again = await boletaService.reEmitBoleta(boleta.id);
    assert.equal(again.error_code, 'DOCUMENT_CLOSED');
    assert.equal(sunat.sent.length, 1);
    assert.equal(sunat.queried.length, 1);
  });

  it('no existe en SUNAT → se reenvía exactamente el mismo XML firmado y el mismo número', async () => {
    const boleta = await createBoleta();
    sunat.sendQueue.push(send.timeout(), send.accepted());
    await boletaService.sendBoletaToSunat(boleta.id);

    sunat.statusQueue.push(status.notFound());
    const reconciled = await boletaService.reEmitBoleta(boleta.id);
    assert.equal(reconciled.success, true);
    assert.equal(reconciled.decision, 'RESEND_SAME_NUMBER');

    assert.equal(sunat.sent.length, 2);
    assert.equal(sunat.sent[1].number, sunat.sent[0].number);
    assert.equal(sunat.sent[1].xml, sunat.sent[0].xml, 'mismos bytes firmados');
    const row = await boletaRow(boleta.id);
    assert.equal(row.estado_sunat, 'ACEPTADO');
    assert.equal(row.datos_adicionales.sunat_reconciliation.resend_count, 1);
  });

  it('un CDR con observaciones se acepta y no consume otro número', async () => {
    const boleta = await createBoleta();
    sunat.sendQueue.push(send.accepted('4252'));
    const result = await boletaService.sendBoletaToSunat(boleta.id);
    assert.equal(result.success, true);
    assert.equal((await boletaRow(boleta.id)).estado_sunat, 'ACEPTADO');
  });

  it('rechazo definitivo → número nuevo que se lleva la orden; el rechazado queda como evidencia', async () => {
    const boleta = await createBoleta();
    sunat.sendQueue.push(send.rejected());
    await boletaService.sendBoletaToSunat(boleta.id);
    assert.equal((await boletaRow(boleta.id)).estado_sunat, 'RECHAZADO');

    sunat.statusQueue.push(status.rejected());
    sunat.sendQueue.push(send.accepted());
    const reconciled = await boletaService.reEmitBoleta(boleta.id);
    assert.equal(reconciled.success, true);
    assert.equal(reconciled.reemitted, true);
    assert.equal(reconciled.replacedNumeroCompleto, 'B001-000001');
    assert.equal(reconciled.numeroCompleto, 'B001-000002');

    const [old, replacement] = await companyBoletas(boleta.companyId);
    assert.equal(old.estado_sunat, 'REEMPLAZADO');
    assert.equal(old.order_number, null);
    assert.equal(replacement.order_number, boleta.orderNumber);
    assert.equal(replacement.estado_sunat, 'ACEPTADO');
    assert.equal(replacement.datos_adicionales.sunat_reconciliation.new_number_count, 1);
    assert.notEqual(sunat.sent[1].xml, sunat.sent[0].xml, 'el número nuevo tiene su propio XML');
  });

  it('rechazos repetidos agotan el tope de números nuevos y pasan a revisión manual', async () => {
    const boleta = await createBoleta();
    sunat.sendQueue.push(send.rejected());
    await boletaService.sendBoletaToSunat(boleta.id);

    let current = boleta.id;
    for (let i = 0; i < 2; i += 1) {
      sunat.statusQueue.push(status.rejected());
      sunat.sendQueue.push(send.rejected());
      const result = await boletaService.reEmitBoleta(current);
      assert.equal(result.reemitted, true);
      current = result.documentId;
    }

    sunat.statusQueue.push(status.rejected());
    const capped = await boletaService.reEmitBoleta(current);
    assert.equal(capped.manualReview, true);

    const rows = await companyBoletas(boleta.companyId);
    assert.equal(rows.length, 3, 'como máximo dos números nuevos por pedido');
    const linked = rows.filter((row) => row.order_number === boleta.orderNumber);
    assert.equal(linked.length, 1, 'un solo comprobante activo por pedido');
    assert.equal(linked[0].estado_sunat, 'REVISION_MANUAL');
  });

  it('dos reemisiones simultáneas del mismo pedido crean un solo reemplazo', async () => {
    const boleta = await createBoleta();
    sunat.sendQueue.push(send.rejected());
    await boletaService.sendBoletaToSunat(boleta.id);

    sunat.statusDelayMs = 150;
    sunat.statusQueue.push(status.rejected(), status.rejected());
    sunat.sendQueue.push(send.accepted(), send.accepted());
    const results = await Promise.all([boletaService.reEmitBoleta(boleta.id), boletaService.reEmitBoleta(boleta.id)]);

    assert.equal(results.filter((result) => result.reemitted).length, 1);
    assert.equal(results.filter((result) => result.error_code === 'REEMISSION_IN_PROGRESS').length, 1);
    assert.equal((await companyBoletas(boleta.companyId)).length, 2);
  });

  it('si la consulta a SUNAT falla no se reenvía ni cambia el estado', async () => {
    const boleta = await createBoleta();
    sunat.sendQueue.push(send.timeout());
    await boletaService.sendBoletaToSunat(boleta.id);

    sunat.statusQueue.push(status.fails());
    const reconciled = await boletaService.reEmitBoleta(boleta.id);
    assert.equal(reconciled.blocked, true);
    assert.equal(reconciled.error_code, 'SUNAT_STATUS_CHECK_FAILED');
    assert.equal((await boletaRow(boleta.id)).estado_sunat, 'NO_CONFIRMADO');
    assert.equal(sunat.sent.length, 1);
  });

  it('"Verificar estado" no marca como aceptada una boleta de otro cliente', async () => {
    const boleta = await createBoleta();
    sunat.sendQueue.push(send.timeout());
    await boletaService.sendBoletaToSunat(boleta.id);

    sunat.statusQueue.push(status.accepted(OTHER_CLIENT_DOC));
    const refreshed = await summaryQuery.refreshBoletaStatus(boleta.id);
    assert.equal(refreshed.estadoSunat, 'REVISION_MANUAL');

    // Verificar es solo lectura: un "no existe" no consume reenvíos.
    const second = await createBoleta();
    sunat.sendQueue.push(send.timeout());
    await boletaService.sendBoletaToSunat(second.id);
    sunat.statusQueue.push(status.notFound());
    await summaryQuery.refreshBoletaStatus(second.id);
    const row = await boletaRow(second.id);
    assert.equal(row.estado_sunat, 'NO_ENCONTRADO');
    assert.equal(row.datos_adicionales.sunat_reconciliation.resend_count, 0);
    assert.equal(sunat.sent.length, 2, 'verificar nunca envía');
  });

  it('historial: cada envío y consulta queda registrado y no se puede modificar ni borrar', async () => {
    const boleta = await createBoleta();
    sunat.sendQueue.push(send.timeout());
    await boletaService.sendBoletaToSunat(boleta.id);
    sunat.statusQueue.push(status.accepted());
    await boletaService.reEmitBoleta(boleta.id);

    const attempts = (await pool.query(
      `select kind, outcome from sunat_emission_attempts where document_table='boletas' and document_id=$1 order by id`,
      [boleta.id],
    )).rows;
    assert.deepEqual(attempts.map((a) => `${a.kind}:${a.outcome}`), ['SEND:NO_CONFIRMADO', 'STATUS_CHECK:ACCEPTED:MARK_ACCEPTED']);

    const registered = (await pool.query(
      `select xml_sha256 from sunat_document_xml where ruc=$1 and tipo_documento='03' and serie='B001' and correlativo=1`,
      [boleta.ruc],
    )).rows[0];
    const crypto = require('node:crypto');
    assert.equal(registered.xml_sha256, crypto.createHash('sha256').update(sunat.sent[0].xml, 'utf8').digest('hex'));

    await assert.rejects(pool.query(`update sunat_emission_attempts set outcome='X' where document_id=$1`, [boleta.id]), /inmutable/);
    await assert.rejects(pool.query(`delete from sunat_document_xml where ruc=$1`, [boleta.ruc]), /inmutable/);
  });

  it('un número admite un solo XML: si se pierde el XML, no se envía uno distinto', async () => {
    const boleta = await createBoleta();
    sunat.sendQueue.push(send.timeout());
    await boletaService.sendBoletaToSunat(boleta.id);

    // Simula el comportamiento antiguo: el XML guardado se pierde y los datos cambian.
    await pool.query(`update boletas set xml_path=null, estado_sunat='NO_CONFIRMADO', detalles=jsonb_set(detalles, '{0,descripcion}', '"OTRO"') where id=$1`, [boleta.id]);
    const result = await boletaService.sendBoletaToSunat(boleta.id);
    assert.equal(result.error_code, 'XML_CONFLICT');
    assert.equal((await boletaRow(boleta.id)).estado_sunat, 'REVISION_MANUAL');
    assert.equal(sunat.sent.length, 1, 'el XML distinto nunca sale hacia SUNAT');
  });

  it('montos: si el comprobante no cuadra con el pedido, no se envía', async () => {
    const boleta = await createBoleta(undefined, { expected_total: { total: 120, source: 'total del pedido Falabella' } });
    const result = await boletaService.sendBoletaToSunat(boleta.id);
    assert.equal(result.error_code, 'AMOUNT_MISMATCH');
    assert.match(result.message, /120\.00 ≠ comprobante 100\.00/);
    assert.equal((await boletaRow(boleta.id)).estado_sunat, 'REVISION_MANUAL');
    assert.equal(sunat.sent.length, 0);

    const blocked = (await pool.query(`select kind, outcome from sunat_emission_attempts where document_table='boletas' and document_id=$1`, [boleta.id])).rows;
    assert.deepEqual(blocked, [{ kind: 'BLOCKED', outcome: 'AMOUNT_MISMATCH' }]);
  });

  it('montos que cuadran con el pedido se envían normalmente', async () => {
    const boleta = await createBoleta(undefined, { expected_total: { total: 100, source: 'total del pedido Falabella' } });
    sunat.sendQueue.push(send.accepted());
    const result = await boletaService.sendBoletaToSunat(boleta.id);
    assert.equal(result.success, true);
  });

  it('mientras se envía el estado es ENVIANDO; si el proceso muere, el barrido lo pasa a NO_CONFIRMADO', async () => {
    const boleta = await createBoleta();
    let stateDuringSend = '';
    sunat.sendQueue.push(async () => {
      stateDuringSend = (await boletaRow(boleta.id)).estado_sunat;
      return send.accepted()(`X-03-B001-000001.zip`);
    });
    await boletaService.sendBoletaToSunat(boleta.id);
    assert.equal(stateDuringSend, 'ENVIANDO');

    // Proceso muerto a mitad del envío: queda ENVIANDO sin respuesta.
    const crashed = await createBoleta();
    await pool.query(`update boletas set estado_sunat='ENVIANDO', updated_at=$2 where id=$1`, [crashed.id, Math.floor(Date.now() / 1000) - 3600]);
    const recovered = await sweep.markStaleSendingAsUnconfirmed();
    assert.ok(recovered.some((doc) => doc.table === 'boletas' && doc.id === crashed.id));
    assert.equal((await boletaRow(crashed.id)).estado_sunat, 'NO_CONFIRMADO');

    // Un ENVIANDO reciente no se toca: puede estar enviándose ahora.
    const live = await createBoleta();
    await pool.query(`update boletas set estado_sunat='ENVIANDO', updated_at=$2 where id=$1`, [live.id, Math.floor(Date.now() / 1000)]);
    await sweep.markStaleSendingAsUnconfirmed();
    assert.equal((await boletaRow(live.id)).estado_sunat, 'ENVIANDO');
  });

  it('una orden no puede tener dos comprobantes activos, ni siquiera en paralelo', async () => {
    const company = await createCompany();
    const order = newOrderNumber();
    await createBoletaFor(company, order);
    await assert.rejects(createBoletaFor(company, order), /ya tiene la boleta B001-000001/);

    const parallelOrder = newOrderNumber();
    const results = await Promise.allSettled([createBoletaFor(company, parallelOrder), createBoletaFor(company, parallelOrder)]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const counter = (await pool.query(`select correlativo_actual from correlatives where branch_id=$1 and serie='B001'`, [company.branchId])).rows[0];
    assert.equal(counter.correlativo_actual, 2, 'los intentos rechazados no consumen correlativos');
  });

  it('nota de crédito sin confirmar se conserva, bloquea otra y se reconcilia', async () => {
    const boleta = await createBoleta();
    sunat.sendQueue.push(send.accepted());
    await boletaService.sendBoletaToSunat(boleta.id);

    sunat.sendQueue.push(send.timeout());
    const first = await creditNoteService.createAndSendCreditNoteFromBoleta(boleta.id);
    assert.equal(first.success, false);
    assert.equal(first.pending, true);
    const note = (await pool.query(`select * from credit_notes where affected_boleta_id=$1`, [boleta.id])).rows[0];
    assert.equal(note.estado_sunat, 'NO_CONFIRMADO', 'antes se borraba y se podía anular dos veces');

    await assert.rejects(creditNoteService.createAndSendCreditNoteFromBoleta(boleta.id), /NO_CONFIRMADO\. Reconcíliala/);

    sunat.statusQueue.push(status.accepted());
    const reconciled = await creditNoteService.reEmitCreditNote(note.id);
    assert.equal(reconciled.success, true);
    assert.equal((await pool.query(`select estado_sunat from credit_notes where id=$1`, [note.id])).rows[0].estado_sunat, 'ACEPTADO');
    assert.equal(sunat.sent.length, 2, 'boleta + una sola nota');
  });

  it('nota de crédito rechazada con CDR se descarta (con evidencia) y permite otra con número nuevo', async () => {
    const boleta = await createBoleta();
    sunat.sendQueue.push(send.accepted());
    await boletaService.sendBoletaToSunat(boleta.id);

    sunat.sendQueue.push(send.rejected());
    const rejected = await creditNoteService.createAndSendCreditNoteFromBoleta(boleta.id);
    assert.equal(rejected.rejected, true);
    assert.equal((await pool.query(`select count(*)::int as n from credit_notes where affected_boleta_id=$1`, [boleta.id])).rows[0].n, 0);
    const evidence = (await pool.query(
      `select outcome, reference from sunat_emission_attempts where ruc=$1 and tipo_documento='07'`,
      [boleta.ruc],
    )).rows;
    assert.deepEqual(evidence, [{ outcome: 'RECHAZADO', reference: boleta.numeroCompleto }]);

    sunat.sendQueue.push(send.accepted());
    const second = await creditNoteService.createAndSendCreditNoteFromBoleta(boleta.id);
    assert.equal(second.success, true);
    assert.notEqual(second.numeroCompleto, rejected.numeroCompleto, 'el número rechazado nunca se reutiliza');
  });

  it('nota de crédito y boleta nueva para el mismo pedido es un remedio válido', async () => {
    const company = await createCompany();
    const order = newOrderNumber();
    const boleta = await createBoletaFor(company, order);
    sunat.sendQueue.push(send.accepted(), send.accepted());
    await boletaService.sendBoletaToSunat(boleta.id);
    await creditNoteService.createAndSendCreditNoteFromBoleta(boleta.id);

    const replacement = await createBoletaFor(company, order);
    assert.equal(replacement.numeroCompleto, 'B001-000002');
  });

  it('centinela de serie: detecta números que otro sistema ya usó', async () => {
    const boleta = await createBoleta();
    sunat.sendQueue.push(send.accepted());
    await boletaService.sendBoletaToSunat(boleta.id);

    sunat.statusQueue.push(status.notFound(), status.notFound());
    const clear = await sweep.probeSeriesCollision({ companyId: boleta.companyId, tipoDocumento: '03', serie: 'B001' });
    assert.equal(clear.localMax, 1);
    assert.deepEqual(sunat.queried, ['B001-000002', 'B001-000003']);
    assert.equal(clear.verdict, 'CLEAR');

    sunat.statusQueue.push(status.notFound(), status.accepted(OTHER_CLIENT_DOC));
    const collision = await sweep.probeSeriesCollision({ companyId: boleta.companyId, tipoDocumento: '03', serie: 'B001' });
    assert.equal(collision.verdict, 'COLLISION');
  });

  it('reporte de reconciliación: clasifica, sugiere y al aplicar solo sincroniza estados', async () => {
    const company = await createCompany();
    const ours = await createBoletaFor(company, newOrderNumber(), { expected_total: { total: 100, source: 'pedido' } });
    const foreign = await createBoletaFor(company);
    const legacy = await createBoletaFor(company);
    sunat.sendQueue.push(send.timeout(), send.accepted());
    await boletaService.sendBoletaToSunat(ours.id);
    await boletaService.sendBoletaToSunat(foreign.id);
    // RECHAZADO guardado por la versión anterior ante un 0130: nunca probó un rechazo.
    await pool.query(`update boletas set estado_sunat='RECHAZADO', respuesta_sunat=$2 where id=$1`, [legacy.id, JSON.stringify({ code: 'soap-env:Client.0130', message: 'timeout' })]);

    const sentBefore = sunat.sent.length;
    const statuses = [status.accepted(), status.accepted(OTHER_CLIENT_DOC), status.fails()];
    sunat.statusQueue.push(...statuses);
    const built = await report.buildSunatReconciliationReport({ companyId: company.companyId });
    const byNumber = Object.fromEntries(built.rows.map((row) => [row.numeroCompleto, row]));
    assert.equal(byNumber['B001-000001'].clase, 'ACEPTADO_PROPIO');
    assert.equal(byNumber['B001-000001'].estadoLocalDistinto, true);
    assert.equal(byNumber['B001-000002'].clase, 'ACEPTADO_AJENO');
    assert.equal(byNumber['B001-000003'].clase, 'NO_CONSULTABLE');

    // Solo la boleta propia se vuelve a consultar; la ajena ya está probada por el reporte revisado.
    sunat.statusQueue.push(status.accepted());
    const applied = await report.applySunatReconciliationReport(built.rows);
    assert.deepEqual({ refreshed: applied.refreshed, reclassified: applied.reclassified }, { refreshed: 2, reclassified: 1 });
    assert.equal((await boletaRow(ours.id)).estado_sunat, 'ACEPTADO');
    assert.equal((await boletaRow(foreign.id)).estado_sunat, 'REVISION_MANUAL');
    assert.equal((await boletaRow(legacy.id)).estado_sunat, 'NO_CONFIRMADO');
    assert.equal(sunat.sent.length, sentBefore, 'el reporte nunca envía');
  });
});
