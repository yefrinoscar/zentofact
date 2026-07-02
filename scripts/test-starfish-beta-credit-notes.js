const Database = require('better-sqlite3');
const { SunatService } = require('../packages/core/dist/services/sunat.service.js');

const DB_PATH = '/Users/ylaurach/Library/Application Support/@zentofact/desktop/storage/boletas.db';

const docs = [
  { affected: 'EB01-577', doc: '45933036', name: 'YULIZA MARLENE BARRERA VIDAL', total: 262.80 },
  { affected: 'EB01-550', doc: '76057535', name: 'JOSE DAVID SANTA CRUZ SARAVIA', total: 24.90 },
  { affected: 'EB01-568', doc: '77201143', name: 'GRISEL MARIA CASTANEDA MITMA', total: 40.00 },
  { affected: 'EB01-559', doc: '73128722', name: 'LUIS CARLOS ENRIQUEZ ECHE', total: 262.80 },
  { affected: 'EB01-581', doc: '72940939', name: 'ANA CECILIA GUZMAN CHUMACERO', total: 250.00 },
  { affected: 'EB01-584', doc: '71993643', name: 'AMIRA CRISTHINA NAVARRETE GONZALES', total: 15.00 },
];

function splitAffected(value) {
  const [serie, rawCorrelative] = value.split('-');
  return { serie, correlative: rawCorrelative.padStart(8, '0') };
}

function money(value) {
  return Math.round(Number(value) * 100) / 100;
}

function totals(total) {
  const base = money(total / 1.18);
  const igv = money(total - base);
  return { base, igv, total: money(total) };
}

async function main() {
  const onlyOne = process.argv.includes('--one');
  const remaining = process.argv.includes('--remaining');
  const retryFailed = process.argv.includes('--retry-failed');
  const selected = onlyOne
    ? docs.slice(0, 1)
    : remaining
      ? docs.slice(1)
      : retryFailed
        ? docs.filter((doc) => ['EB01-568', 'EB01-559', 'EB01-584'].includes(doc.affected))
        : docs;
  const startCorrelative = retryFailed ? 900007 : remaining ? 900002 : 900001;

  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  const company = db.prepare('select * from companies where id = 5').get();
  const branch = db.prepare('select * from branches where company_id = 5 order by id limit 1').get();
  db.close();

  if (!company) throw new Error('No se encontro Starfish company_id=5');

  const production = process.argv.includes('--production');
  const service = new SunatService({
    ruc: company.ruc,
    razonSocial: company.razon_social,
    direccion: branch?.direccion || company.direccion || '',
    ubigeo: branch?.ubigeo || company.ubigeo || '',
    usuarioSol: company.usuario_sol || 'MODDATOS',
    claveSol: company.clave_sol || 'MODDATOS',
    certificado: company.certificado || '',
    certificadoPassword: company.certificado_password || '',
    modoProduccion: production,
  });

  const productionFirst = process.argv.includes('--production-first');
  const results = [];
  for (let index = 0; index < selected.length; index += 1) {
    const doc = selected[index];
    const affected = splitAffected(doc.affected);
    const t = totals(doc.total);
    const correlativo = String(productionFirst ? 1 + index : startCorrelative + index).padStart(8, '0');
    const noteNumber = `B001-${correlativo}`;

    const data = {
      tipoDocumento: '07',
      serie: 'B001',
      correlativo,
      fechaEmision: '2026-06-01',
      moneda: 'PEN',
      ublVersion: '2.1',
      tipoDocAfectado: '03',
      numDocAfectado: `${affected.serie}-${affected.correlative}`,
      codMotivo: '01',
      desMotivo: 'ANULACION DE LA OPERACION',
      client: {
        tipoDocumento: '1',
        numeroDocumento: doc.doc,
        razonSocial: doc.name,
      },
      detalles: [{
        codigo: 'ANULACION',
        descripcion: `ANULACION TOTAL ${doc.affected}`,
        unidad: 'NIU',
        cantidad: 1,
        mtoValorUnitario: t.base,
        porcentajeIgv: 18,
        tipAfeIgv: '10',
      }],
      mtoOperGravadas: t.base,
      mtoOperExoneradas: 0,
      mtoOperInafectas: 0,
      mtoOperGratuitas: 0,
      mtoIgvGratuitas: 0,
      mtoIgv: t.igv,
      mtoBaseIvap: 0,
      mtoIvap: 0,
      mtoIsc: 0,
      mtoIcbper: 0,
      totalImpuestos: t.igv,
      subTotal: t.base,
      mtoImpVenta: t.total,
    };

    const xml = service.buildCreditNoteXml(data);
    const response = await service.sendDocument(xml, `${company.ruc}-07-B001-${correlativo}`);
    results.push({
      affected: doc.affected,
      affectedNormalized: data.numDocAfectado,
      betaCreditNote: noteNumber,
      total: t.total,
      success: response.success,
      error: response.error || null,
      cdrResponse: response.cdrResponse || null,
    });

    if (onlyOne && !response.success) break;
  }

  console.log(JSON.stringify({
    environment: production ? 'SUNAT_PRODUCCION' : 'SUNAT_BETA',
    company: company.razon_social,
    sent: selected.length,
    results,
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
