import assert from 'node:assert/strict';
import test from 'node:test';
import { config } from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { Pool } from 'pg';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

const connectionString = process.env.DATABASE_URL_POSTGRES || process.env.AUTO_EMISSION_TEST_DATABASE_URL;
const PREFIX = `ZEN22T-${process.pid}-`;

test('PostgreSQL: cancelada/devuelta con boleta o factura aceptada encola nota de crédito', {
  skip: !connectionString && 'define DATABASE_URL_POSTGRES para ejecutar la integración',
}, async (t) => {
  process.env.DATABASE_URL_POSTGRES ||= connectionString;
  const autoEmit = await import('./auto-emission.js');
  await autoEmit.ensureTables();
  const db = new Pool({ connectionString, max: 2 });

  const company = (await db.query(
    `select c.id, b.id as branch_id, cl.id as client_id
     from companies c
     join branches b on b.company_id = c.id
     join clients cl on cl.company_id = c.id
     where c.ruc = '20990001001'
     order by b.id, cl.id
     limit 1`,
  )).rows[0];
  if (!company) {
    await db.end();
    t.skip('seed de LIMBO ausente');
    return;
  }

  const cronBefore = await autoEmit.getCron();
  const enabledBefore = (await db.query(
    'select enabled from auto_emission_config where company_id=$1',
    [company.id],
  )).rows[0]?.enabled === true;

  const cleanup = async () => {
    await db.query(
      `delete from credit_notes
        where company_id=$1
          and (
            affected_boleta_id in (select id from boletas where company_id=$1 and order_number like $2)
            or affected_factura_id in (select id from facturas where company_id=$1 and order_number like $2)
          )`,
      [company.id, `${PREFIX}%`],
    );
    await db.query(
      `delete from boletas where company_id=$1 and order_number like $2`,
      [company.id, `${PREFIX}%`],
    );
    await db.query(
      `delete from facturas where company_id=$1 and order_number like $2`,
      [company.id, `${PREFIX}%`],
    );
    await db.query(
      `delete from emission_jobs where company_id=$1 and order_number like $2`,
      [company.id, `${PREFIX}%`],
    );
    await db.query(
      `delete from falabella_orders where company_id=$1 and order_number like $2`,
      [company.id, `${PREFIX}%`],
    );
    await autoEmit.setCron({ enabled: cronBefore.enabled });
    await autoEmit.setCompanyEnabled(company.id, enabledBefore);
  };

  try {
    await autoEmit.setCron({ enabled: false });
    await autoEmit.setCompanyEnabled(company.id, true);

    const canceledBoleta = `${PREFIX}cancel-boleta`;
    const returnedFactura = `${PREFIX}return-factura`;
    const canceledNone = `${PREFIX}cancel-none`;
    const pendingBoleta = `${PREFIX}pending-boleta`;
    const canceledWithNc = `${PREFIX}cancel-has-nc`;
    const canceledLocal = `${PREFIX}cancel-local`;
    const docs = sequentialDocs();

    await insertBoleta(db, company, canceledBoleta, 'ACEPTADO', '18.00', docs.next());
    await insertFactura(db, company, returnedFactura, 'ACEPTADO', '120.00', docs.next());
    await insertBoleta(db, company, pendingBoleta, 'ACEPTADO', '18.00', docs.next());
    const boletaWithNc = await insertBoleta(db, company, canceledWithNc, 'ACEPTADO', '18.00', docs.next());
    await insertCreditNote(db, company, boletaWithNc, docs.next());
    await insertBoleta(db, company, canceledLocal, 'ACEPTADO', '18.00', docs.next());
    await insertFalabellaOrder(db, company, canceledWithNc, 'canceled');
    await insertFalabellaOrder(db, company, canceledLocal, 'canceled');

    const canceledOk = await autoEmit.handleWebhook(company.id, {
      OrderNumber: canceledBoleta,
      OrderId: `${canceledBoleta}-id`,
      Statuses: [{ Status: 'canceled' }],
    });
    assert.equal(canceledOk.kind, 'credit_note');
    assert.equal(canceledOk.ignored, undefined);

    const returnedOk = await autoEmit.handleWebhook(company.id, {
      OrderNumber: returnedFactura,
      OrderId: `${returnedFactura}-id`,
      Statuses: [{ Status: 'returned' }],
    });
    assert.equal(returnedOk.kind, 'credit_note');
    assert.equal(returnedOk.ignored, undefined);

    const noDocument = await autoEmit.handleWebhook(company.id, {
      OrderNumber: canceledNone,
      OrderId: `${canceledNone}-id`,
      Statuses: [{ Status: 'canceled' }],
    });
    assert.equal(noDocument.kind, 'credit_note');
    assert.match(String(noDocument.ignored || ''), /no hay documento emitido/);

    const stillPending = await autoEmit.handleWebhook(company.id, {
      OrderNumber: pendingBoleta,
      OrderId: `${pendingBoleta}-id`,
      Statuses: [{ Status: 'pending' }],
    });
    assert.equal(stillPending.kind, undefined);
    assert.match(String(stillPending.ignored || ''), /no dispara emisión automática/);

    const jobs = (await db.query(
      `select order_number, kind, status
       from emission_jobs
       where company_id=$1 and order_number like $2
       order by order_number`,
      [company.id, `${PREFIX}%`],
    )).rows;
    assert.deepEqual(
      jobs.map((row) => `${row.order_number}:${row.kind}`),
      [`${canceledBoleta}:credit_note`, `${returnedFactura}:credit_note`],
    );

    const alreadyQueued = new Set([canceledBoleta, returnedFactura]);
    const localQueued = await autoEmit.enqueueLocalCreditNotes(company.id, alreadyQueued);
    assert.equal(localQueued, 1);
    const localJob = (await db.query(
      `select kind, status from emission_jobs where company_id=$1 and order_number=$2`,
      [company.id, canceledLocal],
    )).rows[0];
    assert.equal(localJob?.kind, 'credit_note');
    const skippedBecauseNc = (await db.query(
      `select id from emission_jobs where company_id=$1 and order_number=$2`,
      [company.id, canceledWithNc],
    )).rows[0];
    assert.equal(skippedBecauseNc, undefined, 'si ya hay NC aceptada no se re-encola');

    await autoEmit.setCompanyEnabled(company.id, false);
    const disabled = await autoEmit.handleWebhook(company.id, {
      OrderNumber: `${PREFIX}disabled`,
      OrderId: `${PREFIX}disabled-id`,
      Statuses: [{ Status: 'canceled' }],
    });
    assert.equal(disabled.kind, 'credit_note');
    const disabledJob = (await db.query(
      `select id from emission_jobs where company_id=$1 and order_number=$2`,
      [company.id, `${PREFIX}disabled`],
    )).rows[0];
    assert.equal(disabledJob, undefined, 'empresa apagada no encola comprobante ni NC');
  } finally {
    await cleanup().catch(() => {});
    await db.end();
  }
});

async function insertFalabellaOrder(db, company, orderNumber, status) {
  await db.query(
    `insert into falabella_orders (
       company_id, order_id, order_number, falabella_created_at, falabella_updated_at,
       status, invoice_required, grand_total, currency, raw_data
     ) values ($1,$2,$3,now(),now(),$4,false,18,'PEN','{}'::jsonb)
     on conflict (company_id, order_id) do update set status=excluded.status, order_number=excluded.order_number`,
    [company.id, `${orderNumber}-id`, orderNumber, status],
  );
}

function sequentialDocs() {
  let n = 0;
  return {
    next() {
      n += 1;
      return `${String(process.pid).slice(-4)}${String(n).padStart(4, '0')}`;
    },
  };
}

async function insertBoleta(db, company, orderNumber, estado, total, correlativo) {
  const numero = `ZZ1-${correlativo}`;
  const inserted = await db.query(
    `insert into boletas (
       company_id, branch_id, client_id, tipo_documento, serie, correlativo, numero_completo,
       order_number, fecha_emision, moneda, valor_venta, mto_oper_gravadas, mto_igv,
       total_impuestos, sub_total, mto_imp_venta, detalles, estado_sunat, created_at, updated_at
     ) values (
       $1,$2,$3,'03','ZZ1',$4,$5,$6,to_char(now(),'YYYY-MM-DD'),'PEN',
       $7,$7,'0','0',$7,$7,'[]'::jsonb,$8,extract(epoch from now())::bigint, extract(epoch from now())::bigint
     ) returning id`,
    [company.id, company.branch_id, company.client_id, correlativo, numero, orderNumber, total, estado],
  );
  return { id: inserted.rows[0].id, numero };
}

async function insertFactura(db, company, orderNumber, estado, total, correlativo) {
  await db.query(
    `insert into facturas (
       company_id, branch_id, client_id, tipo_documento, serie, correlativo, numero_completo,
       order_number, fecha_emision, moneda, valor_venta, mto_oper_gravadas, mto_igv,
       total_impuestos, sub_total, mto_imp_venta, detalles, estado_sunat, created_at, updated_at
     ) values (
       $1,$2,$3,'01','FZ1',$4,$5,$6,to_char(now(),'YYYY-MM-DD'),'PEN',
       $7,$7,'0','0',$7,$7,'[]'::jsonb,$8,extract(epoch from now())::bigint, extract(epoch from now())::bigint
     )`,
    [company.id, company.branch_id, company.client_id, correlativo, `FZ1-${correlativo}`, orderNumber, total, estado],
  );
}

async function insertCreditNote(db, company, boleta, correlativo) {
  await db.query(
    `insert into credit_notes (
       company_id, branch_id, client_id, affected_boleta_id, tipo_documento, serie, correlativo,
       numero_completo, tipo_doc_afectado, num_doc_afectado, cod_motivo, des_motivo, fecha_emision,
       moneda, detalles, estado_sunat, created_at, updated_at
     ) values (
       $1,$2,$3,$4,'07','ZZ1',$5,$6,'03',$7,'01','ANULACION DE LA OPERACION',
       to_char(now(),'YYYY-MM-DD'),'PEN','[]'::jsonb,'ACEPTADO',
       extract(epoch from now())::bigint, extract(epoch from now())::bigint
     )`,
    [company.id, company.branch_id, company.client_id, boleta.id, correlativo, `ZZ1-${correlativo}`, boleta.numero],
  );
}
