import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Login
  await page.goto('https://sellercenter.falabella.com/user/auth/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('Login page loaded');
  await page.fill('#email', 'atencion@limbo.pe');
  await page.locator('#submit').click();
  await page.waitForTimeout(5000);

  // Keycloak
  console.log('On Keycloak:', page.url());
  await page.fill('#password', 'Atencioncita123@xx?');
  await page.locator('#login').click();
  await page.waitForTimeout(10000);
  console.log('After login:', page.url());

  // Orders page
  await page.goto('https://sellercenter.falabella.com/order/invoice#/purchased-order-list', { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('Orders page loaded');
  await page.waitForTimeout(15000);
  console.log('After wait:', page.url());

  await page.screenshot({ path: './data/debug-orders-final2.png', fullPage: true });

  const content = await page.evaluate(() => {
    return {
      bodyText: document.body?.innerText?.substring(0, 3000),
      trCount: document.querySelectorAll('tr').length,
      tableCount: document.querySelectorAll('table').length,
      allText: Array.from(document.querySelectorAll('*')).filter(el => 
        el.children.length === 0 && el.textContent?.trim()
      ).map(el => el.textContent?.trim()).filter(t => t && t.length > 3 && t.length < 100).slice(0, 40),
    };
  });

  console.log('TABLES:', content.tableCount, 'ROWS:', content.trCount);
  console.log('TEXT NODES:', content.allText);
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
