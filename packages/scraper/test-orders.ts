import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Login flow
  await page.goto('https://sellercenter.falabella.com/user/auth/login', { waitUntil: 'networkidle' });
  await page.fill('#email', 'atencion@limbo.pe');
  await page.waitForTimeout(400);
  await page.locator('#submit').click();
  await page.waitForTimeout(5000);

  // Keycloak
  await page.fill('#password', 'Atencioncita123@xx?');
  await page.waitForTimeout(300);
  await page.locator('#login').click();
  await page.waitForTimeout(8000);
  console.log('Logged in. URL:', page.url());

  // Go to orders
  await page.goto('https://sellercenter.falabella.com/order/invoice#/purchased-order-list', { waitUntil: 'networkidle' });
  console.log('Orders URL:', page.url());

  // Wait for SPA to render
  await page.waitForTimeout(8000);
  await page.screenshot({ path: './data/debug-orders-wait.png', fullPage: true });

  // Look for table, rows, any data
  const info = await page.evaluate(() => {
    const allTr = document.querySelectorAll('tr');
    const allTables = document.querySelectorAll('table');
    const antRows = document.querySelectorAll('.ant-table-row, [class*="table-row"], [class*="TableRow"]');
    const classNames = new Set<string>();
    document.querySelectorAll('*').forEach(el => {
      if (el.className && typeof el.className === 'string') {
        el.className.split(/\s+/).filter(c => c.includes('table') || c.includes('order') || c.includes('row')).forEach(c => classNames.add(c));
      }
    });
    return {
      trCount: allTr.length,
      tableCount: allTables.length,
      antRowsCount: antRows.length,
      relevantClasses: Array.from(classNames).slice(0, 30),
      bodyText: document.body?.innerText?.substring(0, 2000),
    };
  });
  console.log('PAGE ANALYSIS:', JSON.stringify(info, null, 2));

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
