import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  });
  const page = await context.newPage();

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  // Login
  await page.goto('https://sellercenter.falabella.com/user/auth/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.fill('#email', 'atencion@limbo.pe');
  await page.locator('#submit').click();
  await page.waitForTimeout(5000);
  await page.fill('#password', 'Atencioncita123@xx?');
  await page.locator('#login').click();
  await page.waitForTimeout(10000);

  // Set coachmark localStorage
  await page.evaluate(() => {
    localStorage.setItem('common-coach-mark', JSON.stringify([
      '.support-coachmark', '.col_0_0', '.col_0_2', '.col_1_0', '.col_2_0', '.col_3_0'
    ]));
  });

  // Go to orders page to trigger invoice API
  await page.goto('https://sellercenter.falabella.com/order/invoice', {
    waitUntil: 'networkidle', timeout: 60000,
  });
  await page.waitForTimeout(15000);

  // Intercept the invoice API response
  let invoiceResponse: any = null;
  page.on('response', async (resp) => {
    if (resp.url().includes('invoice-bff') || resp.url().includes('seller-order')) {
      console.log('INVOICE API:', resp.url(), resp.status());
      try {
        invoiceResponse = { url: resp.url(), status: resp.status(), body: await resp.text() };
      } catch {}
    }
  });

  // Click on "Documentos tributarios" link to trigger the SPA
  try {
    await page.click('a[href*="invoice"]');
    await page.waitForTimeout(10000);
  } catch {}

  // Check if we caught the API
  if (invoiceResponse) {
    console.log('\nCaught invoice response:', invoiceResponse.status);
    console.log('Body:', invoiceResponse.body?.substring(0, 2000));
  }

  // Try using Playwright's APIRequestContext (shares cookies)
  const apiUrl = 'https://seller-settlements.falabella.services/invoice-bff/v2/seller-order/SC64DB9?typeOfOrder=SO&page=1&limit=5&fromDate=2026-04-29&toDate=2026-05-06';
  console.log('\nTrying API via request context...');
  
  const resp = await context.request.get(apiUrl, {
    headers: { 'Accept': 'application/json' },
  });
  console.log('Status:', resp.status());
  console.log('Body:', (await resp.text()).substring(0, 1000));

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
