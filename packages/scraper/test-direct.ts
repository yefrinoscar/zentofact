import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.addInitScript(() => {
    const kill = () => {
      document.querySelectorAll('.fixed.inset-0, [role="dialog"], .modal, [class*="modal"], [class*="popup"], [class*="overlay"], [class*="backdrop"]')
        .forEach((el: any) => el.remove());
    };
    kill();
    new MutationObserver(kill).observe(document.body, { childList: true, subtree: true });
    setInterval(kill, 1000);
  });

  // Login
  await page.goto('https://sellercenter.falabella.com/user/auth/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.fill('#email', 'atencion@limbo.pe');
  await page.locator('#submit').click();
  await page.waitForTimeout(5000);
  await page.fill('#password', 'Atencioncita123@xx?');
  await page.locator('#login').click();
  await page.waitForTimeout(10000);
  console.log('Logged in:', page.url());

  // Go DIRECTLY to orders with networkidle
  console.log('Going to orders...');
  await page.goto('https://sellercenter.falabella.com/order/invoice#/purchased-order-list', {
    waitUntil: 'networkidle', timeout: 120000,
  });
  console.log('Orders loaded. URL:', page.url());

  // Wait for SPA to hydrate
  await page.waitForTimeout(15000);

  const dom = await page.evaluate(() => ({
    url: location.href,
    hash: location.hash,
    tables: document.querySelectorAll('table').length,
    rows: document.querySelectorAll('tr').length,
    bodyLen: document.body?.innerHTML?.length || 0,
    nextRoot: document.getElementById('__next') ? 'YES' : 'NO',
    iframes: Array.from(document.querySelectorAll('iframe')).length,
    bodyText: document.body?.innerText?.substring(0, 2000),
    // Look for order/invoice related elements
    hasInvoiceContent: !!document.querySelector('[class*="invoice"], [class*="order-list"], [class*="purchased"]'),
    allClasses: Array.from(document.querySelectorAll('[class*="order"], [class*="invoice"], [class*="document"], [class*="row"], [class*="table"]'))
      .slice(0, 10).map(el => el.className?.substring(0, 80)),
  }));
  console.log('DOM:', JSON.stringify(dom, null, 2));

  await page.screenshot({ path: './data/direct-orders.png', fullPage: true });
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
