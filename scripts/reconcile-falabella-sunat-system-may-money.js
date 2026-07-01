const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { Client } = require('pg');

const RUC = '20607809136';
const OUT_DIR = path.resolve('reports/mayo-2026-boletas-claro');
const FALABELLA_MAY_CSV = path.join(OUT_DIR, 'falabella_mayo_boletas_limbo_higher.csv');
const FALABELLA_MAY_ALL_CSV = path.join(OUT_DIR, 'falabella_mayo_todas_ordenes_limbo_higher.csv');
const SUNAT_FILES = {
  abril: '/Users/ylaurach/Library/CloudStorage/OneDrive2-Personal/zentoo/SELLERS/LIMBO/ABRIL/LE206078091362026060014040001EXP2.csv',
  mayo: '/Users/ylaurach/Library/CloudStorage/OneDrive2-Personal/zentoo/SELLERS/LIMBO/MAYO/LE206078091362026060014040001EXP2.csv',
  junio: '/Users/ylaurach/Library/CloudStorage/OneDrive2-Personal/zentoo/SELLERS/LIMBO/JUNIO/LE206078091362026060014040001EXP2.csv',
};

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function readCsv(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).filter(Boolean).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, i) => [header, values[i] || '']));
  });
}

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function money(value) {
  return round2(value).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function amount(value) {
  const parsed = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? round2(parsed) : 0;
}

function typeCode(row) {
  return String(row['Tipo CP/Doc.'] || '').padStart(2, '0');
}

function docNumber(row) {
  return String(row['Nro CP o Doc. Nro Inicial (Rango)'] || '').padStart(6, '0');
}

function numeroCompleto(row) {
  return `${row['Serie del CDP']}-${docNumber(row)}`;
}

function sunatBoletas(file, monthKey) {
  return readCsv(file)
    .filter((row) => typeCode(row) === '03')
    .map((row) => ({
      monthKey,
      numeroCompleto: numeroCompleto(row),
      fechaSunat: row['Fecha de emisión'],
      totalSunat: amount(row['Total CP']),
      clienteDoc: row['Nro Doc Identidad'],
      cliente: row['Apellidos Nombres/ Razón Social'],
      estadoComp: row['Est. Comp'],
    }));
}

function sum(rows, selector) {
  return round2(rows.reduce((total, row) => total + Number(selector(row) || 0), 0));
}

function addGroup(map, key, amountValue, countValue = 1) {
  const current = map.get(key) || { grupo: key, count: 0, total: 0 };
  current.count += countValue;
  current.total = round2(current.total + Number(amountValue || 0));
  map.set(key, current);
}

function writeCsv(file, rows) {
  const columns = rows[0] ? Object.keys(rows[0]) : ['empty'];
  const escape = (value) => {
    const str = String(value ?? '');
    return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map((column) => escape(row[column])).join(','));
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
}

function mdTable(rows, columns) {
  return [
    `| ${columns.map((col) => col.label).join(' | ')} |`,
    `| ${columns.map((col) => col.align || '---').join(' | ')} |`,
    ...rows.map((row) => `| ${columns.map((col) => row[col.key] ?? '').join(' | ')} |`),
  ];
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const falabellaMayBoletas = readCsv(FALABELLA_MAY_CSV).map((row) => ({
    ...row,
    companyId: Number(row.companyId),
    price: amount(row.price),
  }));
  const falabellaMayAll = readCsv(FALABELLA_MAY_ALL_CSV).map((row) => ({
    ...row,
    companyId: Number(row.companyId),
    price: amount(row.price),
  }));
  const falabellaBoletaByCompanyOrder = new Map(falabellaMayBoletas.map((row) => [`${row.companyId}:${row.orderNumber}`, row]));
  const falabellaAllByCompanyOrder = new Map(falabellaMayAll.map((row) => [`${row.companyId}:${row.orderNumber}`, row]));

  const sunatRows = {
    abril: sunatBoletas(SUNAT_FILES.abril, 'abril'),
    mayo: sunatBoletas(SUNAT_FILES.mayo, 'mayo'),
    junio: sunatBoletas(SUNAT_FILES.junio, 'junio'),
  };
  const sunatByNumero = new Map();
  for (const [monthKey, rows] of Object.entries(sunatRows)) {
    for (const row of rows) {
      const current = sunatByNumero.get(row.numeroCompleto) || [];
      current.push({ ...row, monthKey });
      sunatByNumero.set(row.numeroCompleto, current);
    }
  }
  const sunatMayByNumero = new Map(sunatRows.mayo.map((row) => [row.numeroCompleto, row]));

  const client = new Client({ connectionString: process.env.DATABASE_URL_POSTGRES });
  await client.connect();
  try {
    const dbResult = await client.query(
      `select b.id, b.company_id, c.nombre as company_name, c.seller_username, c.ruc,
              b.numero_completo, b.order_number, b.fecha_emision, b.estado_sunat,
              b.mto_imp_venta::numeric as total_db,
              ds.numero_completo as resumen, ds.fecha_resumen, ds.estado as resumen_estado
       from boletas b
       join companies c on c.id = b.company_id
       left join daily_summaries ds on ds.id = b.daily_summary_id
       where c.ruc = $1
         and (
           (b.fecha_emision >= '2026-04-01' and b.fecha_emision < '2026-07-01')
           or (ds.fecha_resumen >= '2026-04-01' and ds.fecha_resumen < '2026-07-01')
           or b.order_number = any($2)
         )
       order by b.company_id, b.numero_completo`,
      [RUC, falabellaMayBoletas.map((row) => String(row.orderNumber))],
    );
    const dbRows = dbResult.rows.map((row) => ({ ...row, total_db: round2(row.total_db) }));
    const dbByCompanyOrder = new Map();
    const dbByNumero = new Map();
    for (const row of dbRows) {
      if (row.order_number) {
        const key = `${row.company_id}:${row.order_number}`;
        const current = dbByCompanyOrder.get(key) || [];
        current.push(row);
        dbByCompanyOrder.set(key, current);
      }
      dbByNumero.set(row.numero_completo, row);
    }

    const falabellaFlow = [];
    const falabellaGroups = new Map();
    for (const order of falabellaMayBoletas) {
      const dbMatches = dbByCompanyOrder.get(`${order.companyId}:${order.orderNumber}`) || [];
      if (!dbMatches.length) {
        const grupo = 'Falabella mayo boleta sin boleta en DB';
        addGroup(falabellaGroups, grupo, order.price);
        falabellaFlow.push({
          grupo,
          company: order.company,
          seller: order.seller,
          orderNumber: order.orderNumber,
          falabellaPrice: order.price,
          boleta: '',
          dbEstado: '',
          dbTotal: '',
          sunatMes: '',
          sunatTotal: '',
          resumen: '',
        });
        continue;
      }
      for (const db of dbMatches) {
        const sunatMatches = sunatByNumero.get(db.numero_completo) || [];
        const sunatMay = sunatMatches.find((row) => row.monthKey === 'mayo');
        const sunatJune = sunatMatches.find((row) => row.monthKey === 'junio');
        const sunatApril = sunatMatches.find((row) => row.monthKey === 'abril');
        const sunat = sunatMay || sunatJune || sunatApril || null;
        const sunatMes = sunat?.monthKey || '';
        let grupo;
        if (sunatMay) grupo = 'Falabella mayo -> DB -> SUNAT mayo';
        else if (sunatJune) grupo = 'Falabella mayo -> DB -> SUNAT junio';
        else if (sunatApril) grupo = 'Falabella mayo -> DB -> SUNAT abril';
        else if (db.estado_sunat === 'PENDIENTE') grupo = 'Falabella mayo -> DB pendiente/no enviado a SUNAT';
        else grupo = 'Falabella mayo -> DB sin CSV abril/mayo/junio';
        addGroup(falabellaGroups, grupo, order.price);
        falabellaFlow.push({
          grupo,
          company: order.company,
          seller: order.seller,
          orderNumber: order.orderNumber,
          falabellaPrice: order.price,
          boleta: db.numero_completo,
          dbEstado: db.estado_sunat,
          dbTotal: db.total_db,
          sunatMes,
          sunatTotal: sunat?.totalSunat ?? '',
          resumen: db.resumen || '',
        });
      }
    }

    const sunatFlow = [];
    const sunatGroups = new Map();
    for (const sunat of sunatRows.mayo) {
      const db = dbByNumero.get(sunat.numeroCompleto);
      let grupo;
      let falabella = null;
      let allFalabella = null;
      if (!db) {
        grupo = 'SUNAT mayo sin boleta en DB';
      } else {
        falabella = db.order_number ? falabellaBoletaByCompanyOrder.get(`${db.company_id}:${db.order_number}`) : null;
        allFalabella = db.order_number ? falabellaAllByCompanyOrder.get(`${db.company_id}:${db.order_number}`) : null;
        if (falabella) grupo = 'SUNAT mayo respaldado por Falabella boleta mayo';
        else if (allFalabella) grupo = `SUNAT mayo con orden Falabella mayo tipo ${allFalabella.tipoComprobante}`;
        else if (db.order_number) grupo = 'SUNAT mayo con orderNumber DB, no aparece en Falabella mayo';
        else grupo = 'SUNAT mayo sin orderNumber en DB';
      }
      addGroup(sunatGroups, grupo, sunat.totalSunat);
      sunatFlow.push({
        grupo,
        boleta: sunat.numeroCompleto,
        sunatFecha: sunat.fechaSunat,
        sunatTotal: sunat.totalSunat,
        dbCompany: db?.company_name || '',
        orderNumber: db?.order_number || '',
        dbEstado: db?.estado_sunat || '',
        dbTotal: db?.total_db ?? '',
        falabellaTipo: falabella?.tipoComprobante || allFalabella?.tipoComprobante || '',
        falabellaTotal: falabella?.price ?? allFalabella?.price ?? '',
        falabellaCreatedAt: falabella?.createdAt || allFalabella?.createdAt || '',
        resumen: db?.resumen || '',
      });
    }

    const falabellaGroupRows = Array.from(falabellaGroups.values()).sort((a, b) => b.total - a.total);
    const sunatGroupRows = Array.from(sunatGroups.values()).sort((a, b) => b.total - a.total);
    writeCsv(path.join(OUT_DIR, 'origen_dinero_falabella_mayo_a_sunat.csv'), falabellaFlow);
    writeCsv(path.join(OUT_DIR, 'origen_dinero_sunat_mayo_a_falabella.csv'), sunatFlow);
    writeCsv(path.join(OUT_DIR, 'origen_dinero_falabella_mayo_resumen.csv'), falabellaGroupRows);
    writeCsv(path.join(OUT_DIR, 'origen_dinero_sunat_mayo_resumen.csv'), sunatGroupRows);

    const falabellaTotal = sum(falabellaMayBoletas, (row) => row.price);
    const sunatMayTotal = sum(sunatRows.mayo, (row) => row.totalSunat);
    const lines = [
      '# Origen del dinero - Falabella vs SUNAT mayo 2026',
      '',
      `Generado: ${new Date().toISOString()}`,
      `RUC: ${RUC}`,
      '',
      '## Totales base',
      '',
      '| Fuente | Cantidad | Total |',
      '| --- | ---: | ---: |',
      `| Falabella mayo con boleta | ${falabellaMayBoletas.length} | S/ ${money(falabellaTotal)} |`,
      `| SUNAT CSV mayo boletas | ${sunatRows.mayo.length} | S/ ${money(sunatMayTotal)} |`,
      `| Diferencia SUNAT - Falabella | ${sunatRows.mayo.length - falabellaMayBoletas.length} | S/ ${money(sunatMayTotal - falabellaTotal)} |`,
      '',
      '## A donde fue el dinero de Falabella mayo con boleta',
      '',
      ...mdTable(falabellaGroupRows.map((row) => ({
        grupo: row.grupo,
        count: row.count,
        total: `S/ ${money(row.total)}`,
      })), [
        { key: 'grupo', label: 'Grupo' },
        { key: 'count', label: 'Ordenes/boletas', align: '---:' },
        { key: 'total', label: 'Total Falabella', align: '---:' },
      ]),
      '',
      '## De donde viene el dinero de SUNAT mayo',
      '',
      ...mdTable(sunatGroupRows.map((row) => ({
        grupo: row.grupo,
        count: row.count,
        total: `S/ ${money(row.total)}`,
      })), [
        { key: 'grupo', label: 'Grupo' },
        { key: 'count', label: 'Boletas SUNAT', align: '---:' },
        { key: 'total', label: 'Total SUNAT', align: '---:' },
      ]),
      '',
      '## Lectura corta',
      '',
      `Falabella mayo con boleta suma S/ ${money(falabellaTotal)}. SUNAT mayo suma S/ ${money(sunatMayTotal)}. La diferencia neta SUNAT - Falabella es S/ ${money(sunatMayTotal - falabellaTotal)}.`,
      'La tabla "A donde fue" muestra si ventas de Falabella mayo acabaron en SUNAT mayo, junio, quedaron pendientes o no tienen CSV.',
      'La tabla "De donde viene" muestra que parte del CSV SUNAT mayo tiene respaldo directo en Falabella mayo y que parte viene de otros origenes/fechas.',
      '',
      'Archivos detalle:',
      '- `origen_dinero_falabella_mayo_a_sunat.csv`',
      '- `origen_dinero_sunat_mayo_a_falabella.csv`',
      '- `origen_dinero_falabella_mayo_resumen.csv`',
      '- `origen_dinero_sunat_mayo_resumen.csv`',
    ];
    fs.writeFileSync(path.join(OUT_DIR, 'origen_dinero_falabella_sunat_mayo.md'), `${lines.join('\n')}\n`);
    console.log(lines.join('\n'));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
