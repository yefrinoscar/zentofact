import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const companies = [
  {
    slug: 'dolphin',
    name: 'TIENDAS DOLPHIN E.I.R.L.',
    ruc: '20612600563',
    status: 'Reporte listo',
    ready: true,
    period: 'Mayo 2026',
    reportHref: '../reporte-dolphin-mayo-2026.html',
    pdfHref: '../reporte-dolphin-mayo-2026.pdf',
    summary: [
      ['SUNAT boletas', '230', 'B001 y EB01 aceptadas en mayo 2026'],
      ['Sistema B001 contable', '217', 'Aceptadas mas anuladas con nota de credito'],
      ['Falabella boletas mayo', '108', 'Pedidos de mayo que pidieron boleta'],
    ],
    details: [
      ['SUNAT B001', '208 boletas', 'S/ 15,570.89'],
      ['SUNAT EB01', '22 boletas', 'S/ 1,660.59'],
      ['Sistema B001 aceptadas', '195 boletas', 'S/ 13,899.52'],
      ['Sistema B001 con nota de credito', '22 boletas', 'S/ 1,925.54'],
      ['Diferencia sistema vs SUNAT B001', '9 boletas', 'S/ 254.17'],
    ],
    note: 'El reporte completo explica por que Falabella muestra 108 ventas de mayo: Falabella ordena por fecha de pedido, mientras SUNAT y el sistema trabajan por fecha de emision. Parte de lo emitido en mayo viene de pedidos de abril.',
  },
  {
    slug: 'limbo',
    name: 'LIMBO PERU S.R.L.',
    ruc: '20607809136',
    status: 'Pendiente',
    period: 'Pendiente',
  },
  {
    slug: 'manta-raya',
    name: 'INVERSIONES MANTA RAYA E.I.R.L.',
    ruc: '20612346659',
    status: 'Pendiente',
    period: 'Pendiente',
  },
  {
    slug: 'runapuma',
    name: 'RUNAPUMA E.I.R.L.',
    ruc: '20612400882',
    status: 'Pendiente',
    period: 'Pendiente',
  },
  {
    slug: 'starfish',
    name: 'IMPORTACIONES STARFISH E.I.R.L.',
    ruc: '20612795305',
    status: 'Pendiente',
    period: 'Pendiente',
  },
  {
    slug: 'stingray',
    name: 'TIENDAS STINGRAY E.I.R.L.',
    ruc: '20612595675',
    status: 'Pendiente',
    period: 'Pendiente',
  },
  {
    slug: 'yakuruna',
    name: 'INVERSIONES YAKURUNA E.I.R.L.',
    ruc: '20612400866',
    status: 'Pendiente',
    period: 'Pendiente',
  },
  {
    slug: 'beauty-home',
    name: 'BEAUTY HOME E.I.R.L.',
    ruc: '20612784192',
    status: 'Pendiente',
    period: 'Pendiente',
  },
];

const css = `
    :root {
      --ink: #162033;
      --muted: #667085;
      --line: #d8dee8;
      --paper: #ffffff;
      --soft: #f5f7fb;
      --blue: #1d5f8d;
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
    body {
      margin: 0;
      color: var(--ink);
      font-family: Arial, Helvetica, sans-serif;
      background: #eef2f7;
    }
    header {
      background: #12395b;
      color: #fff;
      padding: 34px 24px 30px;
    }
    .wrap {
      width: min(1120px, calc(100% - 32px));
      margin: 0 auto;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 30px;
      line-height: 1.15;
      letter-spacing: 0;
    }
    h2 {
      margin: 0 0 12px;
      font-size: 18px;
      letter-spacing: 0;
    }
    .lead {
      max-width: 820px;
      margin: 0;
      color: #dbe8f3;
      font-size: 15px;
      line-height: 1.5;
    }
    main { padding: 24px 0 42px; }
    .topbar {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      margin-bottom: 18px;
    }
    .back,
    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 36px;
      border-radius: 8px;
      padding: 8px 12px;
      border: 1px solid var(--blue);
      color: #fff;
      background: var(--blue);
      font-size: 13px;
      font-weight: 700;
      text-decoration: none;
    }
    .back,
    .button.secondary {
      color: var(--blue);
      background: var(--blue-soft);
    }
    .pill {
      display: inline-flex;
      align-items: center;
      min-height: 28px;
      border-radius: 999px;
      padding: 5px 10px;
      font-size: 12px;
      font-weight: 700;
    }
    .ready { color: var(--green); background: var(--green-soft); }
    .pending { color: var(--gold); background: var(--gold-soft); }
    .grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 18px;
    }
    .card,
    .panel {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--paper);
      box-shadow: var(--shadow);
    }
    .card { padding: 16px; }
    .card span {
      display: block;
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 6px;
    }
    .card strong {
      display: block;
      font-size: 25px;
      line-height: 1;
    }
    .card small {
      display: block;
      margin-top: 8px;
      color: var(--muted);
      line-height: 1.4;
    }
    .panel {
      padding: 18px;
      margin-bottom: 18px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }
    th {
      color: #344054;
      text-align: left;
      background: var(--soft);
      border-bottom: 1px solid var(--line);
      padding: 10px;
      font-size: 12px;
      text-transform: uppercase;
    }
    td {
      border-bottom: 1px solid var(--line);
      padding: 11px 10px;
      vertical-align: top;
    }
    tr:last-child td { border-bottom: 0; }
    .notice {
      border-left: 4px solid var(--gold);
      background: var(--gold-soft);
      padding: 13px 14px;
      color: #533f04;
      line-height: 1.5;
    }
    .empty-state {
      display: grid;
      grid-template-columns: 1fr;
      gap: 12px;
    }
    .empty-state .notice {
      border-left-color: var(--blue);
      background: var(--blue-soft);
      color: #12395b;
    }
    @media (max-width: 820px) {
      .grid { grid-template-columns: 1fr; }
      .topbar { align-items: flex-start; flex-direction: column; }
    }
`;

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function companyPage(company) {
  const summary = company.summary || [
    ['SUNAT', 'Pendiente', 'Aun falta cargar o procesar el reporte de SUNAT.'],
    ['Falabella', 'Pendiente', 'Aun falta consultar pedidos para este periodo.'],
    ['Sistema', 'Pendiente', 'Aun falta cruzar la informacion interna.'],
  ];
  const rows = company.details || [
    ['SUNAT', 'Pendiente', 'Sin datos publicados'],
    ['Falabella', 'Pendiente', 'Sin datos publicados'],
    ['Sistema', 'Pendiente', 'Sin datos publicados'],
  ];
  const actions = company.ready
    ? `<a class="button" href="${company.reportHref}">Abrir reporte completo</a><a class="button secondary" href="${company.pdfHref}">PDF</a>`
    : '';

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(company.name)} - Reporte</title>
  <style>${css}</style>
</head>
<body>
  <header>
    <div class="wrap">
      <h1>${escapeHtml(company.name)}</h1>
      <p class="lead">RUC ${escapeHtml(company.ruc)} · Reporte de conciliacion SUNAT, Falabella y sistema.</p>
    </div>
  </header>
  <main class="wrap">
    <div class="topbar">
      <a class="back" href="../index.html">Volver a empresas</a>
      <span class="pill ${company.ready ? 'ready' : 'pending'}">${escapeHtml(company.status)}</span>
    </div>

    <section class="grid" aria-label="Resumen">
      ${summary.map(([label, value, text]) => `<article class="card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(text)}</small></article>`).join('')}
    </section>

    <section class="panel">
      <h2>Detalle del reporte</h2>
      <table>
        <thead>
          <tr>
            <th>Fuente</th>
            <th>Cantidad</th>
            <th>Monto / estado</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(([source, count, amount]) => `<tr><td>${escapeHtml(source)}</td><td>${escapeHtml(count)}</td><td>${escapeHtml(amount)}</td></tr>`).join('')}
        </tbody>
      </table>
    </section>

    <section class="panel ${company.ready ? '' : 'empty-state'}">
      <h2>${company.ready ? 'Lectura rapida' : 'Estado'}</h2>
      <div class="notice">${escapeHtml(company.note || 'La pagina esta creada para esta empresa. Falta generar la conciliacion del periodo para publicar numeros reales con el mismo formato del reporte Dolphin.')}</div>
      ${actions ? `<p>${actions}</p>` : ''}
    </section>
  </main>
</body>
</html>`;
}

function indexPage() {
  const readyCount = companies.filter((company) => company.ready).length;
  const cards = companies.map((company) => {
    const link = `empresas/${company.slug}.html`;
    return `      <article class="company" data-search="${escapeHtml(`${company.name} ${company.ruc} ${company.slug}`.toLowerCase())}">
        <div>
          <h2 class="name">${escapeHtml(company.name)}</h2>
          <div class="ruc">RUC ${escapeHtml(company.ruc)}</div>
        </div>
        <div>
          <div class="label">Periodo</div>
          <span class="value">${escapeHtml(company.period)}</span>
        </div>
        <div>
          <span class="pill ${company.ready ? 'ready' : 'pending'}">${escapeHtml(company.status)}</span>
        </div>
        <div class="actions">
          <a class="button" href="${link}">Ver reporte</a>
          ${company.ready ? `<a class="button secondary" href="${company.pdfHref.replace('../', '')}">PDF</a>` : ''}
        </div>
      </article>`;
  }).join('\n\n');

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Reportes de conciliacion</title>
  <style>${css}
    .toolbar {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 14px;
      align-items: center;
      margin-bottom: 18px;
    }
    .search {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px 14px;
      color: var(--ink);
      font-size: 14px;
      background: var(--paper);
      box-shadow: var(--shadow);
    }
    .count {
      color: var(--muted);
      font-size: 13px;
      white-space: nowrap;
    }
    .reports { display: grid; gap: 12px; }
    .company {
      display: grid;
      grid-template-columns: 1.25fr 0.8fr 0.9fr auto;
      gap: 16px;
      align-items: center;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
      background: var(--paper);
      box-shadow: var(--shadow);
    }
    .name {
      margin: 0 0 5px;
      font-size: 16px;
      line-height: 1.25;
    }
    .ruc,
    .label {
      color: var(--muted);
      font-size: 12px;
    }
    .value {
      display: block;
      margin-top: 4px;
      color: var(--ink);
      font-size: 14px;
      font-weight: 700;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .empty {
      display: none;
      border: 1px dashed var(--line);
      border-radius: 8px;
      padding: 26px;
      color: var(--muted);
      background: var(--paper);
      text-align: center;
    }
    @media (max-width: 820px) {
      .company,
      .toolbar {
        grid-template-columns: 1fr;
      }
      .actions {
        justify-content: flex-start;
        flex-wrap: wrap;
      }
    }
  </style>
</head>
<body>
  <header>
    <div class="wrap">
      <h1>Reportes de conciliacion</h1>
      <p class="lead">Web simple para revisar conciliaciones por empresa. Cada empresa tiene su pagina; Dolphin ya tiene el reporte completo y las demas quedan listas para publicar el mismo formato.</p>
    </div>
  </header>

  <main class="wrap">
    <section class="grid" aria-label="Resumen">
      <div class="card"><span>Empresas configuradas</span><strong>${companies.length}</strong><small>Listado base para reportes por compania.</small></div>
      <div class="card"><span>Reportes completos</span><strong>${readyCount}</strong><small>Con cruce SUNAT, Falabella y sistema.</small></div>
      <div class="card"><span>Ultimo periodo publicado</span><strong>2026-05</strong><small>Dolphin mayo 2026.</small></div>
    </section>

    <section class="toolbar">
      <input class="search" id="search" type="search" placeholder="Buscar por empresa o RUC" autocomplete="off">
      <div class="count" id="count">${companies.length} empresas</div>
    </section>

    <section class="reports" id="reports" aria-label="Lista de reportes">
${cards}
    </section>

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

const outputDir = join(process.cwd(), 'reports', 'empresas');
mkdirSync(outputDir, { recursive: true });

for (const company of companies) {
  writeFileSync(join(outputDir, `${company.slug}.html`), companyPage(company));
}

writeFileSync(join(process.cwd(), 'reports', 'index.html'), indexPage());
