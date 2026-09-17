import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  filterAggregatedSales, settlementDailySeries, settlementMonthOptions, summarizeSettlementSales,
} from '../../server/src/pagos-sales.js';

// Run against Vite on :3011 with Playwright available through PLAYWRIGHT_MODULE.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseUrl = process.env.ZENTOFACT_WEB_URL || 'http://127.0.0.1:3011';

const fixture = process.env.PAGOS_REPLAY_FILE
  ? JSON.parse(await readFile(process.env.PAGOS_REPLAY_FILE, 'utf8'))
  : { items: Array.from({ length: 4608 }, (_, index) => ({
    orderId: String(3200000000 + index), productName: `Producto ${index}`, skus: [`SKU${index % 106}`],
    paid: index % 30 !== 0, returned: index % 27 === 0, matched: index % 11 !== 0,
    date: `2026-${index % 2 ? '08' : '07'}-${String(index % 28 + 1).padStart(2, '0')}`,
    bruto: 100, neto: 70, take: 30, commission: 20, shipping: 10,
  })) };
const monthOptions = settlementMonthOptions(fixture.items);

const harness = `
<div id="root"></div><script type="module">
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Pagos from '/src/routes/Pagos.tsx';
import '/src/index.css';
window.commits = [];
ReactDOM.createRoot(document.getElementById('root')).render(
  React.createElement(QueryClientProvider, { client: new QueryClient() },
    React.createElement(React.Profiler, {
      id: 'pagos', onRender: (_id, phase, duration) => window.commits.push({ phase, duration }),
    }, React.createElement(Pagos))),
);
</script>`;

test('Pagos remains responsive after changing filters and stops rendering when idle', { timeout: 90_000 }, async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  });
  const harnessName = `perf-test-${randomUUID()}.html`;
  const harnessFile = new URL(`../${harnessName}`, import.meta.url);
  try {
    await writeFile(harnessFile, harness);
    const page = await browser.newPage();
    page.setDefaultTimeout(5_000);
    const errors = [];
    page.on('pageerror', (error) => { errors.push(error.message); console.error(error.message); });
    await page.route('**/companies', (route) => route.fulfill({ json: [] }));
    await page.route('**/pagos/invoices?*', (route) => route.fulfill({ json: { items: [] } }));
    const requests = [];
    await page.route('**/pagos/sales?*', async (route) => {
      const params = new URL(route.request().url()).searchParams;
      const filter = Object.fromEntries(params);
      const items = filterAggregatedSales(fixture.items, filter);
      const limit = Number(params.get('limit'));
      const offset = Number(params.get('offset'));
      requests.push({ offset, limit, totalCount: items.length });
      await new Promise((resolve) => setTimeout(resolve, 80));
      return route.fulfill({ json: {
        items: items.slice(offset, offset + limit),
        totalCount: items.length, limit, offset, ...monthOptions,
        summary: summarizeSettlementSales(items), days: settlementDailySeries(items),
      } });
    });
    await page.goto(`${baseUrl}/${harnessName}`);
    const month = page.getByLabel('Mes de la orden');
    await month.waitFor();
    const scroll = page.locator('[aria-label="Cobros de Falabella por venta"] .overflow-auto');
    for (let loaded = 80; loaded < fixture.items.length; loaded += 80) {
      const expected = Math.min(loaded + 80, fixture.items.length);
      await scroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
      const note = expected === fixture.items.length
        ? `${expected} ventas`
        : `Mostrando ${expected} de ${fixture.items.length}`;
      await page.getByLabel('Cobros de Falabella por venta').getByText(note, { exact: false }).waitFor();
    }
    assert.equal(requests.length, Math.ceil(fixture.items.length / 80));
    assert.ok(requests.every((request) => request.limit === 80));
    assert.ok(await page.getByRole('row').count() < 50, 'Only visible rows should be mounted');
    console.log({ replaySales: fixture.items.length, pagesLoaded: requests.length });
    for (const value of ['2026-08', '2026-07', 'all']) {
      await month.selectOption(value);
      await page.getByLabel('Buscar venta').fill('no-match-performance-check');
      await page.getByText('Sube un Excel de Falabella para ver lo que ganas.').waitFor();
      await page.getByLabel('Buscar venta').fill('');
      await page.getByLabel('Estado de pago').selectOption('pagado');
      await page.waitForTimeout(500);
      assert.equal(await month.inputValue(), value);
      assert.ok(await page.getByRole('cell').count() > 0);
    }
    const before = await page.evaluate(() => window.commits.length);
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => window.commits.length);
    assert.equal(after, before, 'Pagos must stop rendering after the filters settle');
    assert.deepEqual(errors, []);
    console.log(await page.evaluate(() => ({
      commits: window.commits.length,
      maxRenderMs: Math.max(...window.commits.map((commit) => commit.duration)),
    })));
  } finally {
    await browser.close();
    await unlink(harnessFile);
  }
});
