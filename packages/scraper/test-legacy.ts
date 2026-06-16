import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  // Polyfill __name BEFORE any scripts run
  await page.addInitScript(() => {
    (window as any).__name = function(fn: any, name: string) {
      try { Object.defineProperty(fn, 'name', { value: name, configurable: true }); } catch (e) {}
      return fn;
    };
    // Hide automation
    delete (window as any).__playwright;
    delete (window as any).__pw_manual;
    (window as any).chrome = { runtime: {} };

    const kill = () => {
      document.querySelectorAll('.fixed.inset-0, [role="dialog"], .modal, [class*="modal"], [class*="popup"], [class*="overlay"], [class*="backdrop"]')
        .forEach((el: any) => el.remove());
    };
    kill();
    new MutationObserver(kill).observe(document.body, { childList: true, subtree: true });
    setInterval(kill, 1000);
  });

  // Collect JS errors on orders page
  const jsErrors: string[] = [];
  page.on('pageerror', err => jsErrors.push(err.message));

  // Login
  await page.goto('https://sellercenter.falabella.com/user/auth/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.fill('#email', 'atencion@limbo.pe');
  await page.locator('#submit').click();
  await page.waitForTimeout(5000);
  await page.fill('#password', 'Atencioncita123@xx?');
  await page.locator('#login').click();
  await page.waitForTimeout(10000);
  console.log('Logged in:', page.url());

  // Go directly to orders
  await page.goto('https://sellercenter.falabella.com/order/invoice#/purchased-order-list', {
    waitUntil: 'networkidle', timeout: 120000,
  });
  console.log('Loaded:', page.url());

  // Wait for legacy JS to execute
  await page.waitForTimeout(20000);

  await page.screenshot({ path: './data/legacy-orders.png', fullPage: true });

  const state = await page.evaluate(() => ({
    url: location.href,
    tables: document.querySelectorAll('table').length,
    rows: document.querySelectorAll('tr').length,
    bodyLen: document.body?.innerHTML?.length || 0,
    bodyText: document.body?.innerText?.substring(0, 3000),
    // Check for data tables
    dataTable: !!document.querySelector('.dataTable, .table-striped, table.table'),
    tbody: !!document.querySelector('tbody'),
    // Check specific elements
    divsWithContent: Array.from(document.querySelectorAll('div')).filter(d => d.children.length === 0 && d.textContent?.trim()).slice(0, 20).map(d => d.textContent?.trim()),
  }));
  console.log('State:', JSON.stringify(state, null, 2));
  console.log('JS Errors:', jsErrors);

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
