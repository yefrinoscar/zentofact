import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
const {
  FalabellaApiClient,
  getFalabellaError,
  normalizeGetOrdersResult,
} = require('../packages/falabella-api/dist');

const { Pool } = pg;
const MONTH = '2026-05';
const FROM = '2026-05-01';
const TO = '2026-06-01';
const CREATED_AFTER = `${FROM}T00:00:00+00:00`;
const CREATED_BEFORE = `${TO}T00:00:00+00:00`;
const LIMIT = 100;

const outputRoot = join(process.cwd(), 'reports');
const companyDir = join(outputRoot, 'empresas');

const sellersRoot = process.env.SELLERS_SUNAT_ROOT
  || '/Users/ylaurach/Library/CloudStorage/OneDrive2-Personal/zentoo/SELLERS';

const companySlugOverrides = new Map([
  [2, 'dolphin'],
  [3, 'manta-raya'],
  [5, 'starfish'],
  [6, 'stingray'],
  [7, 'yakuruna'],
  [8, 'beauty-home'],
]);

function money(value) {
  return `S/ ${Number(value || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function num(value) {
  return Number(value || 0).toLocaleString('es-PE');
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function slug(input) {
  return String(input || 'empresa')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function companySlug(company) {
  if (companySlugOverrides.has(Number(company.id))) return companySlugOverrides.get(Number(company.id));
  if (company.ruc === '20607809136' && String(company.seller_username || '').includes('higher')) return 'limbo-higher';
  if (company.ruc === '20607809136') return 'limbo';
  return slug(company.razon_social);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && quoted && line[i + 1] === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
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

async function readSunatCsv(filePath) {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(filePath, 'utf8');
  const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));
  });

  const boletas = rows.filter((row) => String(row['Tipo CP/Doc.']).padStart(2, '0') === '03');
  const creditNotes = rows.filter((row) => String(row['Tipo CP/Doc.']).padStart(2, '0') === '07');
  const b001 = boletas.filter((row) => row['Serie del CDP'] === 'B001');
  const eb01 = boletas.filter((row) => row['Serie del CDP'] === 'EB01');
  const total = (items) => round2(items.reduce((sum, row) => sum + Number(row['Total CP'] || 0), 0));

  return {
    source: `CSV SUNAT: ${filePath.split('/').pop()}`,
    totalCount: boletas.length,
    totalAmount: total(boletas),
    b001Count: b001.length,
    b001Total: total(b001),
    eb01Count: eb01.length,
    eb01Total: total(eb01),
    creditNoteCount: creditNotes.length,
    creditNoteTotal: total(creditNotes),
    rows: rows.length,
  };
}

async function findSunatCsvByRuc(rootDir) {
  const byRuc = new Map();
  const sellerDirs = await readdir(rootDir, { withFileTypes: true });
  for (const sellerDir of sellerDirs) {
    if (!sellerDir.isDirectory()) continue;
    const sellerPath = join(rootDir, sellerDir.name);
    const children = await readdir(sellerPath, { withFileTypes: true });
    for (const child of children) {
      if (!child.isDirectory()) continue;
      const nestedPath = join(sellerPath, child.name);
      const files = await readdir(nestedPath, { withFileTypes: true });
      for (const file of files) {
        if (!file.isFile() || !file.name.toLowerCase().endsWith('.csv')) continue;
        const match = file.name.match(/^LE(\d{11})/);
        if (match) byRuc.set(match[1], join(nestedPath, file.name));
      }
    }
  }
  return byRuc;
}

function invoiceType(value) {
  if (value === true || value === 1) return 'FACTURA';
  if (value === false || value === 0) return 'BOLETA';
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'true' || text === '1') return 'FACTURA';
  if (text === 'false' || text === '0') return 'BOLETA';
  return '';
}

function parseAmount(value) {
  const parsed = Number(String(value || '').replace(/[^0-9,.\-]/g, '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function fetchFalabellaSummary(company) {
  if (!String(company.falabella_api_user_id || '').trim() || !String(company.falabella_api_key || '').trim()) {
    return { ok: false, reason: 'Sin credenciales API', orders: 0, boletas: 0, facturas: 0, total: 0, boletaTotal: 0, facturaTotal: 0 };
  }

  const client = new FalabellaApiClient({
    userId: company.falabella_api_user_id,
    apiKey: company.falabella_api_key,
    version: process.env.FALABELLA_API_VERSION || '1.0',
    defaultFormat: 'JSON',
  });

  const orders = [];
  for (let offset = 0; offset < 100000; offset += LIMIT) {
    const response = await client.getOrdersV2({
      createdAfter: CREATED_AFTER,
      createdBefore: CREATED_BEFORE,
      limit: LIMIT,
      offset,
      sortDirection: 'ASC',
    });
    const error = getFalabellaError(response.data);
    if (error) {
      throw new Error(error.Head?.ErrorMessage || error.Head?.ErrorCode || 'Error Falabella');
    }
    const normalized = normalizeGetOrdersResult(response.data);
    orders.push(...normalized.orders);
    if (!normalized.orders.length || normalized.orders.length < LIMIT) break;
  }

  const byKey = new Map();
  for (const order of orders) {
    byKey.set(String(order.OrderNumber || order.OrderId || JSON.stringify(order)), order);
  }
  const unique = [...byKey.values()];
  const boletas = unique.filter((order) => invoiceType(order.InvoiceRequired) === 'BOLETA');
  const facturas = unique.filter((order) => invoiceType(order.InvoiceRequired) === 'FACTURA');

  return {
    ok: true,
    orders: unique.length,
    boletas: boletas.length,
    facturas: facturas.length,
    sinTipo: unique.length - boletas.length - facturas.length,
    total: round2(unique.reduce((sum, order) => sum + parseAmount(order.Price), 0)),
    boletaTotal: round2(boletas.reduce((sum, order) => sum + parseAmount(order.Price), 0)),
    facturaTotal: round2(facturas.reduce((sum, order) => sum + parseAmount(order.Price), 0)),
  };
}

const css = `
    :root {
      --ink: #162033;
      --muted: #667085;
      --line: #d8dee8;
      --paper: #ffffff;
      --soft: #f5f7fb;
      --blue: #1d5f8d;
      --blue-dark: #12395b;
      --blue-soft: #e7f3fb;
      --green: #197448;
      --green-soft: #e8f7ef;
      --gold: #9a6700;
      --gold-soft: #fff6dd;
      --red: #b42318;
      --red-soft: #fff1f0;
      --shadow: 0 16px 45px rgba(22, 32, 51, 0.08);
    }
    * { box-sizing: border-box; }
    body { margin: 0; color: var(--ink); font-family: Arial, Helvetica, sans-serif; background: #eef2f7; }
    header { background: var(--blue-dark); color: #fff; padding: 32px 24px 28px; }
    .wrap { width: min(1160px, calc(100% - 32px)); margin: 0 auto; }
    h1 { margin: 0 0 8px; font-size: 30px; line-height: 1.12; letter-spacing: 0; }
    h2 { margin: 0 0 12px; font-size: 18px; letter-spacing: 0; }
    h3 { margin: 0 0 8px; font-size: 15px; letter-spacing: 0; }
    .lead { max-width: 860px; margin: 0; color: #dbe8f3; font-size: 15px; line-height: 1.5; }
    main { padding: 24px 0 42px; }
    .topbar { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 18px; }
    .button, .back { display: inline-flex; align-items: center; justify-content: center; min-height: 36px; border-radius: 8px; padding: 8px 12px; border: 1px solid var(--blue); color: #fff; background: var(--blue); font-size: 13px; font-weight: 700; text-decoration: none; }
    .back, .button.secondary { color: var(--blue); background: var(--blue-soft); }
    .pill { display: inline-flex; align-items: center; min-height: 28px; border-radius: 999px; padding: 5px 10px; font-size: 12px; font-weight: 700; }
    .ready { color: var(--green); background: var(--green-soft); }
    .warn { color: var(--gold); background: var(--gold-soft); }
    .bad { color: var(--red); background: var(--red-soft); }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 18px; }
    .card, .panel { border: 1px solid var(--line); border-radius: 8px; background: var(--paper); box-shadow: var(--shadow); }
    .card { padding: 16px; }
    .card span { display: block; color: var(--muted); font-size: 12px; margin-bottom: 6px; }
    .card strong { display: block; font-size: 25px; line-height: 1; }
    .card small { display: block; margin-top: 8px; color: var(--muted); line-height: 1.4; }
    .panel { padding: 18px; margin-bottom: 18px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th { color: #344054; text-align: left; background: var(--soft); border-bottom: 1px solid var(--line); padding: 10px; font-size: 12px; text-transform: uppercase; }
    td { border-bottom: 1px solid var(--line); padding: 11px 10px; vertical-align: top; }
    tr:last-child td { border-bottom: 0; }
    .notice { border-left: 4px solid var(--blue); background: var(--blue-soft); padding: 13px 14px; color: #12395b; line-height: 1.5; }
    .bars { display: grid; gap: 10px; }
    .bar-row { display: grid; grid-template-columns: 145px 1fr 90px; gap: 10px; align-items: center; font-size: 13px; }
    .bar-track { height: 12px; border-radius: 999px; background: #e7edf5; overflow: hidden; }
    .bar-fill { height: 100%; border-radius: 999px; background: var(--blue); }
    .bar-fill.green { background: var(--green); }
    .bar-fill.gold { background: var(--gold); }
    .right { text-align: right; }
    .toolbar { display: grid; grid-template-columns: 1fr auto; gap: 14px; align-items: center; margin-bottom: 18px; }
    .search { width: 100%; border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; color: var(--ink); font-size: 14px; background: var(--paper); box-shadow: var(--shadow); }
    .count { color: var(--muted); font-size: 13px; white-space: nowrap; }
    .reports { display: grid; gap: 12px; }
    .company { display: grid; grid-template-columns: 1.25fr 0.7fr 0.7fr auto; gap: 16px; align-items: center; border: 1px solid var(--line); border-radius: 8px; padding: 16px; background: var(--paper); box-shadow: var(--shadow); }
    .name { margin: 0 0 5px; font-size: 16px; line-height: 1.25; }
    .ruc, .label { color: var(--muted); font-size: 12px; }
    .value { display: block; margin-top: 4px; color: var(--ink); font-size: 14px; font-weight: 700; }
    .actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
    .empty { display: none; border: 1px dashed var(--line); border-radius: 8px; padding: 26px; color: var(--muted); background: var(--paper); text-align: center; }
    @media (max-width: 920px) { .grid, .two, .company, .toolbar { grid-template-columns: 1fr; } .actions { justify-content: flex-start; } .bar-row { grid-template-columns: 1fr; } .right { text-align: left; } }
`;

function bars(rows) {
  const max = Math.max(1, ...rows.map((row) => Number(row.value || 0)));
  return `<div class="bars">${rows.map((row, index) => `
    <div class="bar-row">
      <div>${escapeHtml(row.label)}</div>
      <div class="bar-track"><div class="bar-fill ${index === 1 ? 'green' : index === 2 ? 'gold' : ''}" style="width:${Math.max(3, Math.round((Number(row.value || 0) / max) * 100))}%"></div></div>
      <div class="right">${escapeHtml(row.display)}</div>
    </div>`).join('')}</div>`;
}

function companyPage(company) {
  const s = company.system;
  const f = company.falabella;
  const isDolphin = Number(company.id) === 2;
  const externalSunat = company.sunatExternal || null;
  const sunatSource = externalSunat ? externalSunat.source : 'Estado SUNAT guardado en Postgres';
  const sunatCount = externalSunat ? externalSunat.totalCount : Number(s.aceptadas);
  const sunatTotal = externalSunat ? externalSunat.totalAmount : Number(s.total_aceptado);
  const gapCount = Number(s.contable_count) - sunatCount;
  const gapTotal = round2(Number(s.contable_total) - sunatTotal);
  const falabellaNote = f.ok
    ? `Falabella cuenta pedidos creados entre ${FROM} y ${TO}. SUNAT y sistema cuentan fecha de emision; por eso los numeros no siempre cuadran uno a uno.`
    : `No se pudo consultar Falabella: ${f.reason || 'error no especificado'}.`;

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(company.razon_social)} - Mayo 2026</title>
  <style>${css}</style>
</head>
<body>
  <header>
    <div class="wrap">
      <h1>${escapeHtml(company.razon_social)}</h1>
      <p class="lead">RUC ${escapeHtml(company.ruc)} · Conciliacion mayo 2026 entre SUNAT, Falabella y nuestro sistema.</p>
    </div>
  </header>
  <main class="wrap">
    <div class="topbar">
      <a class="back" href="../index.html">Volver a empresas</a>
      <span class="pill ready">Reporte mayo 2026</span>
    </div>

    <section class="grid" aria-label="Resumen">
      <article class="card"><span>Sistema contable</span><strong>${num(s.contable_count)}</strong><small>${money(s.contable_total)} en boletas aceptadas + boletas con nota de credito.</small></article>
      <article class="card"><span>SUNAT</span><strong>${num(sunatCount)}</strong><small>${money(sunatTotal)} · ${escapeHtml(sunatSource)}.</small></article>
      <article class="card"><span>Falabella boletas</span><strong>${f.ok ? num(f.boletas) : 'Error'}</strong><small>${f.ok ? `${money(f.boletaTotal)} en pedidos que pidieron boleta.` : escapeHtml(f.reason || 'Sin dato')}</small></article>
      <article class="card"><span>Diferencia sistema vs SUNAT</span><strong>${gapCount >= 0 ? '+' : ''}${num(gapCount)}</strong><small>${gapTotal >= 0 ? '+' : ''}${money(gapTotal)}.</small></article>
    </section>

    <section class="two">
      <article class="panel">
        <h2>Boletas por fuente</h2>
        ${bars([
          { label: 'Sistema contable', value: s.contable_count, display: `${num(s.contable_count)} bol.` },
          { label: 'SUNAT', value: sunatCount, display: `${num(sunatCount)} bol.` },
          { label: 'Falabella boletas', value: f.ok ? f.boletas : 0, display: f.ok ? `${num(f.boletas)} ord.` : 'Error' },
        ])}
      </article>
      <article class="panel">
        <h2>Montos por fuente</h2>
        ${bars([
          { label: 'Sistema contable', value: s.contable_total, display: money(s.contable_total) },
          { label: 'SUNAT', value: sunatTotal, display: money(sunatTotal) },
          { label: 'Falabella boletas', value: f.ok ? f.boletaTotal : 0, display: f.ok ? money(f.boletaTotal) : 'Error' },
        ])}
      </article>
    </section>

    <section class="panel">
      <h2>Tabla principal</h2>
      <table>
        <thead><tr><th>Fuente</th><th>Base de conteo</th><th>Cantidad</th><th>Total</th><th>Comentario</th></tr></thead>
        <tbody>
          <tr><td>SUNAT</td><td>${escapeHtml(sunatSource)}</td><td>${num(sunatCount)}</td><td>${money(sunatTotal)}</td><td>${externalSunat ? `Boletas: B001 ${num(externalSunat.b001Count)} (${money(externalSunat.b001Total)})${externalSunat.eb01Count ? `, EB01 ${num(externalSunat.eb01Count)} (${money(externalSunat.eb01Total)})` : ''}.` : 'Para estas empresas se usa estado_sunat ACEPTADO del sistema; falta importar archivo SUNAT externo si quieres comparacion oficial descargada.'}</td></tr>
          <tr><td>Sistema</td><td>Boletas emitidas en mayo</td><td>${num(s.boletas)}</td><td>${money(s.total)}</td><td>Incluye todos los estados del sistema.</td></tr>
          <tr><td>Sistema contable</td><td>Aceptadas + anuladas con nota de credito</td><td>${num(s.contable_count)}</td><td>${money(s.contable_total)}</td><td>Este es el numero operativo para comparar contra ventas emitidas.</td></tr>
          <tr><td>Falabella</td><td>Pedidos creados en mayo que pidieron boleta</td><td>${f.ok ? num(f.boletas) : 'Error'}</td><td>${f.ok ? money(f.boletaTotal) : '-'}</td><td>${escapeHtml(falabellaNote)}</td></tr>
        </tbody>
      </table>
    </section>

    <section class="panel">
      <h2>Detalle del sistema</h2>
      <table>
        <thead><tr><th>Estado</th><th>Cantidad</th><th>Total</th><th>Lectura</th></tr></thead>
        <tbody>
          <tr><td>Aceptadas</td><td>${num(s.aceptadas)}</td><td>${money(s.total_aceptado)}</td><td>Boletas vigentes en sistema.</td></tr>
          <tr><td>Con nota de credito / anuladas</td><td>${num(s.anuladas)}</td><td>${money(s.total_anulado)}</td><td>Se cuentan aparte para explicar anulaciones.</td></tr>
          <tr><td>Enviadas no aceptadas</td><td>${num(s.enviadas)}</td><td>${money(s.total_enviado)}</td><td>No entran al conteo contable si no tienen aceptacion.</td></tr>
          <tr><td>Otros estados</td><td>${num(s.otras)}</td><td>${money(s.total_otras)}</td><td>Revisar si son pendientes, rechazadas u otro estado.</td></tr>
          <tr><td>Notas de credito mayo</td><td>${num(s.notas)}</td><td>${money(s.total_notas)}</td><td>${num(s.notas_aceptadas)} notas aceptadas por SUNAT.</td></tr>
        </tbody>
      </table>
    </section>

    <section class="panel">
      <h2>Detalle Falabella</h2>
      <table>
        <thead><tr><th>Cuenta</th><th>Pedidos mayo</th><th>Boletas</th><th>Facturas</th><th>Total pedidos</th></tr></thead>
        <tbody>
          <tr><td>${escapeHtml(company.seller_username || '-')}</td><td>${f.ok ? num(f.orders) : 'Error'}</td><td>${f.ok ? `${num(f.boletas)} · ${money(f.boletaTotal)}` : '-'}</td><td>${f.ok ? `${num(f.facturas)} · ${money(f.facturaTotal)}` : '-'}</td><td>${f.ok ? money(f.total) : escapeHtml(f.reason || '-')}</td></tr>
        </tbody>
      </table>
    </section>

    <section class="panel">
      <h2>Conclusion</h2>
      <div class="notice">${externalSunat
          ? `Este reporte usa el CSV SUNAT externo de mayo para ${escapeHtml(company.razon_social)}. Sistema contable: ${num(s.contable_count)} boletas; SUNAT: ${num(sunatCount)} boletas; diferencia: ${gapCount >= 0 ? '+' : ''}${num(gapCount)} boletas.`
          : `Este reporte usa Postgres y Falabella reales para mayo. No se encontro CSV SUNAT externo para esta cuenta/RUC; por eso SUNAT se representa por las boletas ACEPTADAS registradas en el sistema.`}</div>
    </section>
  </main>
</body>
</html>`;
}

function indexPage(companies) {
  const cards = companies.map((company) => {
    const s = company.system;
    const f = company.falabella;
    const link = `empresas/${company.slug}.html`;
    return `<article class="company" data-search="${escapeHtml(`${company.razon_social} ${company.ruc} ${company.seller_username}`.toLowerCase())}">
        <div><h2 class="name">${escapeHtml(company.razon_social)}</h2><div class="ruc">RUC ${escapeHtml(company.ruc)}</div><div class="ruc">${escapeHtml(company.seller_username || '')}</div></div>
        <div><div class="label">Sistema contable</div><span class="value">${num(s.contable_count)} bol.</span></div>
        <div><div class="label">Falabella boletas</div><span class="value">${f.ok ? num(f.boletas) : 'Error'}</span></div>
        <div class="actions"><a class="button" href="${link}">Ver reporte</a></div>
      </article>`;
  }).join('\n');

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Reportes mayo 2026</title>
  <style>${css}</style>
</head>
<body>
  <header><div class="wrap"><h1>Reportes de conciliacion mayo 2026</h1><p class="lead">Reportes reales por empresa con datos de Postgres y Falabella. Dolphin incluye ademas el archivo SUNAT externo pegado en la sesion.</p></div></header>
  <main class="wrap">
    <section class="grid">
      <article class="card"><span>Empresas/cuentas</span><strong>${companies.length}</strong><small>Incluye cuentas separadas cuando usan el mismo RUC.</small></article>
      <article class="card"><span>Sistema contable</span><strong>${num(companies.reduce((sum, c) => sum + Number(c.system.contable_count), 0))}</strong><small>Boletas aceptadas + anuladas con nota de credito.</small></article>
      <article class="card"><span>Falabella boletas</span><strong>${num(companies.reduce((sum, c) => sum + (c.falabella.ok ? Number(c.falabella.boletas) : 0), 0))}</strong><small>Pedidos de mayo que solicitaron boleta.</small></article>
      <article class="card"><span>Periodo</span><strong>Mayo</strong><small>2026-05-01 a 2026-05-31.</small></article>
    </section>
    <section class="toolbar"><input class="search" id="search" type="search" placeholder="Buscar por empresa, cuenta o RUC"><div class="count" id="count">${companies.length} empresas</div></section>
    <section class="reports">${cards}</section>
    <div class="empty" id="empty">No hay empresas que coincidan con la busqueda.</div>
  </main>
  <script>
    const search = document.getElementById('search');
    const cards = Array.from(document.querySelectorAll('.company'));
    const count = document.getElementById('count');
    const empty = document.getElementById('empty');
    function render() {
      const term = search.value.trim().toLowerCase();
      let visible = 0;
      cards.forEach((card) => {
        const match = !term || card.dataset.search.includes(term);
        card.style.display = match ? 'grid' : 'none';
        if (match) visible += 1;
      });
      count.textContent = visible === 1 ? '1 empresa' : visible + ' empresas';
      empty.style.display = visible ? 'none' : 'block';
    }
    search.addEventListener('input', render);
    render();
  </script>
</body>
</html>`;
}

async function main() {
  mkdirSync(companyDir, { recursive: true });
  const sunatCsvByRuc = await findSunatCsvByRuc(sellersRoot);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL_POSTGRES || process.env.DATABASE_URL });

  const { rows } = await pool.query(`
    with b as (
      select company_id,
        count(*) as boletas,
        count(*) filter (where estado_sunat='ACEPTADO') as aceptadas,
        count(*) filter (where estado_sunat='ANULADO') as anuladas,
        count(*) filter (where estado_sunat='ENVIADO') as enviadas,
        count(*) filter (where estado_sunat not in ('ACEPTADO','ANULADO','ENVIADO') or estado_sunat is null) as otras,
        coalesce(sum(mto_imp_venta::numeric),0) as total,
        coalesce(sum(mto_imp_venta::numeric) filter (where estado_sunat='ACEPTADO'),0) as total_aceptado,
        coalesce(sum(mto_imp_venta::numeric) filter (where estado_sunat='ANULADO'),0) as total_anulado,
        coalesce(sum(mto_imp_venta::numeric) filter (where estado_sunat='ENVIADO'),0) as total_enviado,
        coalesce(sum(mto_imp_venta::numeric) filter (where estado_sunat not in ('ACEPTADO','ANULADO','ENVIADO') or estado_sunat is null),0) as total_otras
      from boletas
      where fecha_emision >= $1 and fecha_emision < $2
      group by company_id
    ), cn as (
      select company_id,
        count(*) as notas,
        count(*) filter (where estado_sunat='ACEPTADO') as notas_aceptadas,
        coalesce(sum(mto_imp_venta::numeric),0) as total_notas
      from credit_notes
      where fecha_emision >= $1 and fecha_emision < $2
      group by company_id
    )
    select c.id, c.ruc, c.razon_social, c.seller_username, c.falabella_api_user_id, c.falabella_api_key,
      coalesce(b.boletas,0)::int boletas,
      coalesce(b.aceptadas,0)::int aceptadas,
      coalesce(b.anuladas,0)::int anuladas,
      coalesce(b.enviadas,0)::int enviadas,
      coalesce(b.otras,0)::int otras,
      coalesce(b.total,0)::float total,
      coalesce(b.total_aceptado,0)::float total_aceptado,
      coalesce(b.total_anulado,0)::float total_anulado,
      coalesce(b.total_enviado,0)::float total_enviado,
      coalesce(b.total_otras,0)::float total_otras,
      coalesce(cn.notas,0)::int notas,
      coalesce(cn.notas_aceptadas,0)::int notas_aceptadas,
      coalesce(cn.total_notas,0)::float total_notas
    from companies c
    left join b on b.company_id = c.id
    left join cn on cn.company_id = c.id
    where c.activo is true
    order by c.id
  `, [FROM, TO]);
  await pool.end();

  const companies = [];
  for (const row of rows) {
    process.stdout.write(`Falabella ${row.id} ${row.seller_username || row.razon_social}... `);
    let falabella;
    try {
      falabella = await fetchFalabellaSummary(row);
      process.stdout.write(falabella.ok ? `${falabella.orders} pedidos\n` : `${falabella.reason}\n`);
    } catch (error) {
      falabella = { ok: false, reason: error?.message || String(error), orders: 0, boletas: 0, facturas: 0, total: 0, boletaTotal: 0, facturaTotal: 0 };
      process.stdout.write(`ERROR ${falabella.reason}\n`);
    }
    const {
      falabella_api_key: _apiKey,
      falabella_api_user_id: _apiUserId,
      ...safeRow
    } = row;
    const system = {
      ...safeRow,
      contable_count: Number(row.aceptadas) + Number(row.anuladas),
      contable_total: round2(Number(row.total_aceptado) + Number(row.total_anulado)),
    };
    const company = { ...safeRow, slug: companySlug(row), system, falabella };
    if (sunatCsvByRuc.has(row.ruc)) {
      company.sunatExternal = await readSunatCsv(sunatCsvByRuc.get(row.ruc));
    }
    companies.push(company);
    writeFileSync(join(companyDir, `${company.slug}.html`), companyPage(company));
  }

  writeFileSync(join(outputRoot, 'index.html'), indexPage(companies));
  writeFileSync(join(outputRoot, 'mayo-2026-data.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    period: MONTH,
    companies,
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
