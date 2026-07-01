const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { Client } = require('pg');

const OUT_DIR = path.resolve('reports/mayo-2026-boletas-claro');
const NUMEROS = ['B001-000232', 'B001-000233', 'B001-000234'];
const REASON = 'Ajuste manual: boletas aceptadas en sistema pero ausentes del CSV SUNAT mayo 2026; no deben sumar en indicadores de mayo.';

function nowEpochSeconds() {
  return Math.floor(Date.now() / 1000);
}

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function writeJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function csvEscape(value) {
  const str = String(value ?? '');
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function writeCsv(file, rows) {
  const columns = rows[0] ? Object.keys(rows[0]) : ['empty'];
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map((column) => csvEscape(row[column])).join(','));
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
}

function zeroDetails(details) {
  if (!Array.isArray(details)) return details;
  return details.map((item) => ({
    ...item,
    mto_valor_unitario: 0,
    mto_precio_unitario: 0,
    mto_valor_venta: 0,
    mto_base_igv: 0,
    igv: 0,
    total_impuestos: 0,
  }));
}

function auditDatosAdicionales(current, original) {
  const base = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  const audit = Array.isArray(base.auditAdjustments) ? base.auditAdjustments : [];
  return {
    ...base,
    auditAdjustments: [
      ...audit,
      {
        at: new Date().toISOString(),
        script: 'scripts/zero-may-not-in-csv-boletas.js',
        reason: REASON,
        previous: {
          valorVenta: original.valor_venta,
          mtoOperGravadas: original.mto_oper_gravadas,
          mtoIgv: original.mto_igv,
          totalImpuestos: original.total_impuestos,
          subTotal: original.sub_total,
          mtoImpVenta: original.mto_imp_venta,
          detalles: original.detalles,
        },
      },
    ],
  };
}

async function main() {
  if (!process.env.DATABASE_URL_POSTGRES) throw new Error('Missing DATABASE_URL_POSTGRES');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const client = new Client({ connectionString: process.env.DATABASE_URL_POSTGRES });
  await client.connect();
  try {
    await client.query('begin');
    const beforeResult = await client.query(
      `select b.id, b.company_id, c.nombre as company_name, b.numero_completo, b.order_number,
              b.fecha_emision, b.estado_sunat, b.valor_venta, b.mto_oper_gravadas,
              b.mto_igv, b.total_impuestos, b.sub_total, b.mto_imp_venta,
              b.detalles, b.datos_adicionales, b.updated_at,
              ds.numero_completo as resumen, ds.fecha_resumen, ds.estado as resumen_estado
       from boletas b
       join companies c on c.id = b.company_id
       left join daily_summaries ds on ds.id = b.daily_summary_id
       where c.ruc = '20607809136'
         and b.numero_completo = any($1)
       order by b.numero_completo
       for update of b`,
      [NUMEROS],
    );

    if (beforeResult.rows.length !== NUMEROS.length) {
      throw new Error(`Se esperaban ${NUMEROS.length} boletas, se encontraron ${beforeResult.rows.length}`);
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const beforePath = path.join(OUT_DIR, `ajuste_no_csv_mayo_before_${timestamp}.json`);
    writeJson(beforePath, { reason: REASON, rows: beforeResult.rows });

    const updatedAt = nowEpochSeconds();
    for (const row of beforeResult.rows) {
      await client.query(
        `update boletas
         set valor_venta = '0',
             mto_oper_gravadas = '0',
             mto_oper_exoneradas = '0',
             mto_oper_inafectas = '0',
             mto_oper_gratuitas = '0',
             mto_igv_gratuitas = '0',
             mto_igv = '0',
             mto_base_ivap = '0',
             mto_ivap = '0',
             mto_isc = '0',
             mto_icbper = '0',
             total_impuestos = '0',
             sub_total = '0',
             mto_imp_venta = '0',
             detalles = $2::jsonb,
             datos_adicionales = $3::jsonb,
             updated_at = $4
         where id = $1`,
        [
          row.id,
          JSON.stringify(zeroDetails(row.detalles)),
          JSON.stringify(auditDatosAdicionales(row.datos_adicionales, row)),
          updatedAt,
        ],
      );
    }

    const afterResult = await client.query(
      `select b.id, b.company_id, c.nombre as company_name, b.numero_completo, b.order_number,
              b.fecha_emision, b.estado_sunat, b.valor_venta, b.mto_oper_gravadas,
              b.mto_igv, b.total_impuestos, b.sub_total, b.mto_imp_venta,
              b.detalles, b.datos_adicionales, b.updated_at,
              ds.numero_completo as resumen, ds.fecha_resumen, ds.estado as resumen_estado
       from boletas b
       join companies c on c.id = b.company_id
       left join daily_summaries ds on ds.id = b.daily_summary_id
       where b.id = any($1)
       order by b.numero_completo`,
      [beforeResult.rows.map((row) => row.id)],
    );

    const afterPath = path.join(OUT_DIR, `ajuste_no_csv_mayo_after_${timestamp}.json`);
    writeJson(afterPath, { reason: REASON, rows: afterResult.rows });

    const csvRows = beforeResult.rows.map((before) => {
      const after = afterResult.rows.find((row) => row.id === before.id);
      return {
        boleta: before.numero_completo,
        orderNumber: before.order_number,
        resumen: before.resumen,
        estado: before.estado_sunat,
        totalAntes: round2(before.mto_imp_venta),
        totalDespues: round2(after?.mto_imp_venta),
        motivo: REASON,
      };
    });
    const csvPath = path.join(OUT_DIR, `ajuste_no_csv_mayo_resumen_${timestamp}.csv`);
    writeCsv(csvPath, csvRows);

    await client.query('commit');

    console.log(JSON.stringify({
      ok: true,
      updated: afterResult.rows.length,
      totalBefore: round2(beforeResult.rows.reduce((sum, row) => sum + Number(row.mto_imp_venta || 0), 0)),
      totalAfter: round2(afterResult.rows.reduce((sum, row) => sum + Number(row.mto_imp_venta || 0), 0)),
      beforePath,
      afterPath,
      csvPath,
    }, null, 2));
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
