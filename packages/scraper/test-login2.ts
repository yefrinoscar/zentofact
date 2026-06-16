import { chromium } from 'playwright';

async function login(page: any) {
  await page.goto('https://sellercenter.falabella.com/user/auth/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.fill('#email', 'atencion@limbo.pe');
  await page.locator('#submit').click();
  console.log('Clicked Continuar');
  
  // Wait for navigation OR password reveal
  await page.waitForTimeout(8000);
  console.log('After wait:', page.url());

  // Handle Keycloak redirect
  if (page.url().includes('access-key-corp')) {
    console.log('On Keycloak');
    await page.waitForSelector('#password:visible', { timeout: 10000 });
    await page.fill('#password', 'Atencioncita123@xx?');
    await page.locator('#login').click();
    await page.waitForTimeout(10000);
    console.log('Keycloak done:', page.url());
    return;
  }

  // Handle inline password reveal on same page
  const passVis = await page.locator('#password').isVisible().catch(() => false);
  console.log('Password visible:', passVis);
  
  if (passVis) {
    await page.fill('#password', 'Atencioncita123@xx?');
    await page.locator('#submit').click();
    await page.waitForTimeout(8000);
    console.log('After password submit:', page.url());
  }

  // If we got redirected to Keycloak after password
  if (page.url().includes('access-key-corp')) {
    await page.fill('#password', 'Atencioncita123@xx?');
    await page.locator('#login').click();
    await page.waitForTimeout(10000);
    console.log('Keycloak (2nd try):', page.url());
  }

  console.log('Final URL:', page.url());
}

async function main() {
  const browser = await chromium.launch({ headless: true, slowMo: 50 });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  });
  const page = await context.newPage();

  await login(page);

  // Set coachmark
  await page.evaluate(() => {
    localStorage.setItem('common-coach-mark', JSON.stringify([
      '.support-coachmark', '.col_0_0', '.col_0_2', '.col_1_0', '.col_2_0', '.col_3_0'
    ]));
  });

  // Now try the API with page.request
  console.log('\n=== Calling invoice API ===');
  const apiUrl = 'https://seller-settlements.falabella.services/invoice-bff/v2/seller-order/SC64DB9?typeOfOrder=SO&page=1&limit=5&fromDate=2026-04-29&toDate=2026-05-06';

  try {
    const resp = await page.request.get(apiUrl, {
      headers: { 'Accept': 'application/json' },
    });
    console.log('Status:', resp.status());
    const body = await resp.text();
    console.log('Body:', body.substring(0, 2000));
  } catch (e: any) {
    console.log('Error:', e.message);
  }

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
