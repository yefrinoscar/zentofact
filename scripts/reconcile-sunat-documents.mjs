// Reconciliación de comprobantes con SUNAT por empresa (solo lectura en SUNAT).
//
// Prueba (no cambia nada), para una empresa o para todas:
//   node scripts/reconcile-sunat-documents.mjs --company=<id|all> [--from=2026-08-01] [--to=2026-09-30] [--only-unconfirmed]
// Aplicar (sincroniza estados locales; nunca envía ni reemite):
//   node scripts/reconcile-sunat-documents.mjs --company=<id> ... --apply --plan-hash=<hash de la prueba>
//
// Escribe un CSV con cada comprobante, lo que SUNAT tiene, la comparación de
// montos (local / esperado / Falabella) y la acción sugerida. También consulta
// los próximos números de cada serie para detectar si otro sistema la usa.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { config } from 'dotenv';

const { values } = parseArgs({
  options: {
    company: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    'only-unconfirmed': { type: 'boolean', default: false },
    out: { type: 'string' },
    apply: { type: 'boolean', default: false },
    'plan-hash': { type: 'string' },
    'delay-ms': { type: 'string', default: '300' },
  },
});

if (!values.company) throw new Error('Indica la empresa con --company=<id> o --company=all.');
if (values.apply && !values['plan-hash']) throw new Error('Para aplicar usa --apply --plan-hash=<hash exacto de la prueba>.');

config({ path: resolve('.env') });
const core = await import('@zentofact/core');
if (!core.isSunatProduction()) {
  console.warn('Aviso: el ambiente no es producción. getStatusCdr solo responde para comprobantes de producción.');
}

const companyIds = values.company === 'all'
  ? (await core.pool.query('select id from companies where activo is not false order by id')).rows.map((row) => row.id)
  : [Number(values.company)];
if (companyIds.some((id) => !Number.isInteger(id) || id <= 0)) throw new Error('--company debe ser un id numérico o "all".');

const allRows = [];
const hashes = [];
for (const companyId of companyIds) {
  const report = await core.buildSunatReconciliationReport({
    companyId,
    from: values.from,
    to: values.to,
    onlyUnconfirmed: values['only-unconfirmed'],
    delayMs: Number(values['delay-ms']) || 0,
  });
  if (!report.rows.length) continue;
  hashes.push(report.planHash);
  allRows.push(...report.rows.map((row) => ({ ...row, empresa: report.company.razonSocial, ruc: report.company.ruc })));

  const byClass = {};
  for (const row of report.rows) byClass[row.clase] = (byClass[row.clase] || 0) + 1;
  console.log(`\nEmpresa: ${report.company.razonSocial} (RUC ${report.company.ruc}) · ${report.rows.length} comprobantes`);
  console.table(byClass);
  const attention = report.rows.filter((row) => row.estadoLocalDistinto || row.montoInconsistente || row.clase !== 'ACEPTADO_PROPIO');
  if (attention.length) {
    console.table(attention.map((row) => ({
      numero: row.numeroCompleto,
      orden: row.orderNumber || '',
      local: row.estadoLocal,
      sunat: row.clase,
      monto: row.montoLocal.toFixed(2),
      falabella: row.montoFalabella === null ? '' : row.montoFalabella.toFixed(2),
      accion: row.accion,
    })));
  }

  // Centinela: ¿otro sistema ya usa los próximos números de estas series?
  const seriesSeen = new Set(report.rows.filter((row) => row.table !== 'credit_notes').map((row) => `${row.table}:${row.numeroCompleto.split('-')[0]}`));
  for (const key of seriesSeen) {
    const [table, serie] = key.split(':');
    const probe = await core.probeSeriesCollision({ companyId, tipoDocumento: table === 'facturas' ? '01' : '03', serie });
    console.log(`Serie ${serie}: último local ${probe.localMax}; próximos ${probe.checked.map((item) => `${item.numero}=${item.kind}`).join(', ')} → ${probe.verdict}`);
  }
}
const planHash = createHash('sha256').update(hashes.join(':')).digest('hex');

const csvEscape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
const header = ['empresa', 'ruc', 'tipo', 'numero', 'fecha', 'orden', 'cliente', 'estado_local', 'sunat', 'detalle', 'monto_local', 'monto_esperado', 'monto_falabella', 'monto_inconsistente', 'estado_local_distinto', 'accion'];
const csv = [header.join(','), ...allRows.map((row) => [
  row.empresa, row.ruc, row.table, row.numeroCompleto, row.fechaEmision, row.orderNumber, row.cliente, row.estadoLocal, row.clase, row.detalle,
  row.montoLocal.toFixed(2), row.montoEsperado ?? '', row.montoFalabella ?? '', row.montoInconsistente, row.estadoLocalDistinto, row.accion,
].map(csvEscape).join(','))].join('\n');
const outPath = resolve(values.out || `sunat-reconciliacion-${values.company}-${new Date().toISOString().slice(0, 10)}.csv`);
writeFileSync(outPath, csv);
console.log(`CSV: ${outPath}`);
console.log(`Comprobantes revisados: ${allRows.length}`);
console.log(`Plan hash: ${planHash}`);

if (!values.apply) {
  console.log('Prueba: no se cambió nada. Para sincronizar los estados locales usa --apply --plan-hash=<hash>.');
  await core.pool.end();
  process.exit(0);
}
if (values['plan-hash'] !== planHash) {
  await core.pool.end();
  throw new Error('El plan cambió desde la prueba (SUNAT o la base respondieron distinto). Vuelve a revisar y usa el hash nuevo.');
}
const applied = await core.applySunatReconciliationReport(allRows);
console.table([{ refrescados: applied.refreshed, reclasificados: applied.reclassified, sin_cambio: applied.skipped, errores: applied.errors.length }]);
for (const error of applied.errors) console.error(error);
await core.pool.end();
