import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { config } from 'dotenv';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    apply: { type: 'boolean', default: false },
    'zero-missing': { type: 'boolean', default: false },
    'zero-missing-only': { type: 'boolean', default: false },
  },
});

const workbookPath = resolve(positionals[0] || '');
if (!positionals[0]) throw new Error('Indica la ruta del Excel de stock.');
if (values['zero-missing'] && values['zero-missing-only']) {
  throw new Error('Usa --zero-missing o --zero-missing-only, no ambos.');
}
config({ path: resolve('.env') });

const TARGETS = [
  ['G38L', [[2, 'G38L']]],
  ['G44', [[4, 'G44']]],
  ['Z77', [[5, 'Z77']]],
  ['G43', [[6, 'G43']]],
  ['Z5', [[7, 'Z5']]],
  ['Z9', [[8, 'Z9']]],
  ['Z34', [[9, 'Z34']]],
  ['Z20', [[10, 'Z20']]],
  ['AD060R', [[11, 'AD060R']]],
  ['G36', [[12, 'G36']]],
  ['Z7', [[13, 'Z7']]],
  ['H32', [[14, 'H32']]],
  ['H25', [[15, 'H25']]],
  ['G47', [[16, 'G47']]],
  ['H30', [[17, 'H30']]],
  ['H9MB', [[18, 'H9MB']]],
  ['H9MN', [[19, 'H9MN']]],
  ['H9LB', [[20, 'H9LB']]],
  ['H9LN', [[21, 'H9LN']]],
  ['H9XLB', [[22, 'H9XLB']]],
  ['H9XLN', [[23, 'H9XLN']]],
  ['H13L', [[25, 'H13L']]],
  ['H14', [[26, 'H14']]],
  ['H16', [[27, 'H16']]],
  ['G40L', [[28, 'G40L']]],
  ['Z25', [[30, 'Z25']]],
  ['G42N', [[31, 'G42N']]],
  ['G42B', [[32, 'G42B']]],
  ['H36', [[33, 'H36']]],
  ['G1FLORES', [[34, 'G1FLORES']]],
  ['G1HOJAS', [[35, 'G1HOJAS']]],
  ['G1RAMAS', [[36, 'G1RAMAS']]],
  ['H39', [[37, 'H39']]],
  ['G18', [[38, 'G18'], [55, 'G-19']]],
  ['H49', [[39, 'H49']]],
  ['G9', [[40, 'G9']]],
  ['G13', [[41, 'G13']]],
  ['G24N', [[42, 'G24N'], [43, 'G24CA']]],
  ['G26C', [[44, 'G26C']]],
  ['G-28N', [[45, 'G-28N']]],
  ['G34R', [[46, 'G34R']]],
  ['G34C', [[47, 'G34C']]],
  ['G35N', [[48, 'G35N']]],
  ['G35V', [[49, 'G35V']]],
  ['G35R', [[50, 'G35R']]],
  ['G37', [[51, 'G37']]],
  ['H24', [[52, 'H24']]],
  ['HOG001', [[53, 'HOG001']]],
  ['HOG013', [[54, 'HOG013']]],
  ['G-25', [[56, 'G-25']]],
  ['G-48', [[57, 'G-48']]],
  ['G-20', [[58, 'G-20']]],
  ['G-32', [[59, 'G-32']]],
  ['HOG-12-002', [[60, 'HOG-12-002']]],
  ['HOG-12-003', [[61, 'HOG-12-003']]],
  ['HOG-12-004', [[62, 'HOG-12-004']]],
  ['HOG-12-005', [[63, 'HOG-12-005']]],
  ['HOG025', [[64, 'HOG025']]],
  ['G-8', [[65, 'G-8']]],
  ['G-36', [[66, 'G-36']]],
  ['G-2', [[67, 'G-2'], [68, ''], [69, '']]],
  ['HOG028', [[70, 'HOG028']]],
  ['HOG029', [[71, 'HOG029']]],
  ['AG3', [[72, '']]],
  ['AG272', [[73, '']]],
  ['AG271', [[74, '']]],
  ['A-2', [[78, 'A-2']]],
  ['A-25', [[79, 'A-25']]],
  ['A-22', [[80, 'A-22']]],
  ['AG203', [[81, '']]],
  ['AG220', [[82, '']]],
  ['AG300', [[83, '']]],
  ['AG218', [[84, '']]],
  ['A-33', [[85, 'A-33']]],
  ['AG217', [[86, '']]],
  ['A-29', [[87, 'A-29']]],
  ['A-30', [[88, 'A-30']]],
];

const SKIPPED_ROWS = new Map([
  [3, 'G38M no tiene cantidad'],
  [24, 'H13M no tiene cantidad'],
  [29, 'G40XL no tiene cantidad'],
  [75, 'Casaca morada tiene un total sin distribución entre tallas M y S'],
  [76, 'Mini scanner no tiene cantidad'],
]);

const PRESENT_WITHOUT_QUANTITY = new Set(['AG103', 'AG146', 'AG147', 'AG158', 'H13M', 'G40XL']);

function decodeXml(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function tagValues(xml, tagName) {
  const matches = xml.matchAll(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'g'));
  return [...matches].map((match) => decodeXml(match[1].replace(/<[^>]+>/g, '')));
}

function readWorkbookRows(path) {
  const sharedStringsXml = execFileSync('unzip', ['-p', path, 'xl/sharedStrings.xml'], { encoding: 'utf8' });
  const sheetXml = execFileSync('unzip', ['-p', path, 'xl/worksheets/sheet1.xml'], { encoding: 'utf8' })
    .replace(/<c\b[^>]*\/>/g, '');
  const sharedStrings = [...sharedStringsXml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)]
    .map((match) => tagValues(match[1], 't').join(''));
  const rows = new Map();

  for (const cell of sheetXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
    const attributes = cell[1];
    const reference = /\br="([A-Z]+)(\d+)"/.exec(attributes);
    if (!reference) continue;
    const [, column, rowText] = reference;
    if (!['B', 'D', 'E', 'F'].includes(column)) continue;
    const rawValue = /<v>([\s\S]*?)<\/v>/.exec(cell[2])?.[1];
    if (rawValue === undefined) continue;
    const type = /\bt="([^"]+)"/.exec(attributes)?.[1];
    const value = type === 's' ? sharedStrings[Number(rawValue)] : decodeXml(rawValue);
    const rowNumber = Number(rowText);
    const row = rows.get(rowNumber) || { row: rowNumber };
    row[column] = typeof value === 'string' ? value.trim() : value;
    rows.set(rowNumber, row);
  }
  return rows;
}

function validateAndBuildTargets(rows) {
  const classifiedRows = new Set(SKIPPED_ROWS.keys());
  const targets = TARGETS.map(([masterSku, sourceRows]) => {
    let targetQuantity = 0;
    for (const [rowNumber, expectedCode] of sourceRows) {
      if (classifiedRows.has(rowNumber)) throw new Error(`La fila ${rowNumber} está clasificada más de una vez.`);
      classifiedRows.add(rowNumber);
      const row = rows.get(rowNumber);
      if (!row) throw new Error(`No existe la fila ${rowNumber} en el Excel.`);
      const actualCode = String(row.B || '').trim();
      if (actualCode !== expectedCode) {
        throw new Error(`La fila ${rowNumber} cambió: se esperaba ${expectedCode || '(sin código)'} y llegó ${actualCode || '(sin código)'}.`);
      }
      const quantity = Number(row.F);
      if (!Number.isFinite(quantity) || quantity < 0 || !Number.isInteger(quantity)) {
        throw new Error(`La cantidad de la fila ${rowNumber} no es un entero válido.`);
      }
      targetQuantity += quantity;
    }
    return { masterSku, sourceRows: sourceRows.map(([row]) => row), targetQuantity };
  });

  const unclassified = [...rows.values()]
    .filter((row) => row.row > 1 && row.row <= 88)
    .filter((row) => row.B || row.D || row.E || row.F)
    .filter((row) => !classifiedRows.has(row.row));
  if (unclassified.length) throw new Error(`Hay filas sin clasificar: ${unclassified.map((row) => row.row).join(', ')}.`);
  return targets;
}

const workbookRows = readWorkbookRows(workbookPath);
const workbookTargets = validateAndBuildTargets(workbookRows);
const sourceHash = createHash('sha256').update(readFileSync(workbookPath)).digest('hex');
const importKeyPrefix = `inventory-count:${sourceHash.slice(0, 24)}`;
const { pool } = await import('@zentofact/core');
const { adjustInventory } = await import('../packages/server/src/catalog/inventory-service.js');

try {
  const productsResult = await pool.query(
    `select p.id, p.main_sku, p.name, p.status,
       coalesce(i.quantity_on_hand, 0) as quantity_on_hand,
       coalesce(i.quantity_reserved, 0) as quantity_reserved
     from products p
     left join product_inventory i on i.product_id=p.id
     order by p.id`,
  );
  const productsBySku = new Map(productsResult.rows.map((product) => [product.main_sku, product]));
  const missingMasters = workbookTargets.map((target) => target.masterSku).filter((sku) => !productsBySku.has(sku));
  if (missingMasters.length) throw new Error(`No existen estos maestros: ${missingMasters.join(', ')}.`);

  const representedMasters = new Set([
    ...workbookTargets.map((target) => target.masterSku),
    ...PRESENT_WITHOUT_QUANTITY,
  ]);
  const shouldZeroMissing = values['zero-missing'] || values['zero-missing-only'];
  const absentTargets = shouldZeroMissing
    ? productsResult.rows
        .filter((product) => !representedMasters.has(product.main_sku))
        .map((product) => ({ masterSku: product.main_sku, sourceRows: [], targetQuantity: 0, absentFromWorkbook: true }))
    : [];
  const targets = values['zero-missing-only'] ? absentTargets : [...workbookTargets, ...absentTargets];

  const plan = targets.map((target) => {
    const product = productsBySku.get(target.masterSku);
    const previousQuantity = Number(product.quantity_on_hand);
    const quantityReserved = Number(product.quantity_reserved);
    if (target.targetQuantity < quantityReserved) {
      throw new Error(`${target.masterSku} tiene ${quantityReserved} reservadas y el conteo es ${target.targetQuantity}.`);
    }
    return {
      ...target,
      productId: Number(product.id),
      productName: product.name,
      previousQuantity,
      quantityReserved,
      delta: target.targetQuantity - previousQuantity,
      idempotencyKey: `${target.absentFromWorkbook ? `${importKeyPrefix}-missing` : importKeyPrefix}:${target.masterSku.toLowerCase()}`,
    };
  });

  console.table(plan.map((item) => ({
    maestro: item.masterSku,
    filas: item.sourceRows.length ? item.sourceRows.join(',') : 'fuera Excel',
    anterior: item.previousQuantity,
    nuevo: item.targetQuantity,
    diferencia: item.delta,
    producto: item.productName,
  })));
  console.log(`Archivo: ${basename(workbookPath)}`);
  console.log(`SHA-256: ${sourceHash}`);
  console.log(`Maestros conciliados desde el Excel: ${values['zero-missing-only'] ? 0 : workbookTargets.length}`);
  if (shouldZeroMissing) console.log(`Maestros fuera del Excel llevados a cero: ${absentTargets.length}`);
  console.log(`Filas omitidas: ${[...SKIPPED_ROWS].map(([row, reason]) => `${row}: ${reason}`).join('; ')}`);

  if (!values.apply) {
    console.log('DRY RUN: no se modificó la base. Usa --apply para aplicar estos saldos absolutos.');
    process.exitCode = 0;
  } else {
    const keys = plan.map((item) => item.idempotencyKey);
    const existing = await pool.query(
      'select idempotency_key from inventory_movements where idempotency_key = any($1)',
      [keys],
    );
    const existingKeys = new Set(existing.rows.map((row) => row.idempotency_key));
    const changedAfterImport = plan.filter((item) => existingKeys.has(item.idempotencyKey) && item.delta !== 0);
    if (changedAfterImport.length) {
      throw new Error(`Este Excel ya fue aplicado y luego cambiaron estos saldos: ${changedAfterImport.map((item) => item.masterSku).join(', ')}.`);
    }
    const pendingPlan = plan.filter((item) => !existingKeys.has(item.idempotencyKey) && item.delta !== 0);
    if (!pendingPlan.length) {
      console.log('El Excel ya había sido aplicado y todos sus saldos siguen en el valor contado.');
      process.exitCode = 0;
    } else {
      const client = await pool.connect();
      try {
        await client.query('begin');
        for (const item of pendingPlan) {
          await adjustInventory(item.productId, {
            absoluteTarget: item.targetQuantity,
            reason: item.absentFromWorkbook
              ? `Producto ausente del conteo ${basename(workbookPath)}`
              : `Conteo físico según ${basename(workbookPath)}`,
            idempotencyKey: item.idempotencyKey,
            allowNegative: false,
          }, null, client);
        }
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
      console.log(`APLICADO: ${pendingPlan.length} ajustes; ${plan.filter((item) => item.delta === 0).length} saldos ya coincidían.`);
    }
  }
} finally {
  await pool.end();
}
