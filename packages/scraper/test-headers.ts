import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  });
  const page = await context.newPage();

  // Capture auth headers from real API calls
  const authHeaders: any[] = [];
  page.on('request', req => {
    if (req.url().includes('seller-settlements') || req.url().includes('/s/')) {
      authHeaders.push({ url: req.url(), headers: req.headers() });
    }
  });

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    (window as any).__name = (fn: any, name: string) => {
      try { Object.defineProperty(fn, 'name', { value: name }); } catch(e) {}
      return fn;
    };
  });

  // Login
  await page.goto('https://sellercenter.falabella.com/user/auth/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.fill('#email', 'atencion@limbo.pe');
  await page.locator('#submit').click();
  await page.waitForTimeout(5000);
  await page.fill('#password', 'Atencioncita123@xx?');
  await page.locator('#login').click();
  await page.waitForTimeout(10000);

  // Set localStorage
  await page.evaluate(() => {
    localStorage.setItem('common-coach-mark', JSON.stringify([
      '.support-coachmark', '.col_0_0', '.col_0_2', '.col_1_0', '.col_2_0', '.col_3_0'
    ]));
  });

  // Go to homepage to trigger API calls
  await page.goto('https://sellercenter.falabella.com/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(10000);

  console.log('Captured auth headers:');
  authHeaders.forEach(h => {
    console.log(`  ${h.url.substring(0, 80)}`);
    console.log(`    Cookie: ${(h.headers['cookie'] || '').substring(0, 80)}`);
    console.log(`    Authorization: ${h.headers['authorization'] || 'none'}`);
    console.log(`    x-api-key: ${h.headers['x-api-key'] || 'none'}`);
  });

  // Try API call with Playwright's request context
  const cookies = await context.cookies();
  const apiUrl = 'https://seller-settlements.falabella.services/invoice-bff/v2/seller-order/SC64DB9?typeOfOrder=SO&page=1&limit=5&fromDate=2026-04-29&toDate=2026-05-06';
  
  console.log('\n=== Trying with APIRequestContext ===');
  const apiContext = await browser.newContext().then(async (ctx) => {
    // Copy cookies
    await ctx.addCookies(cookies);
    return ctx.request;
  });

  // Actually, let me use the page's request context
  const resp2 = await page.evaluate(async ({ url, cookieStr }) => {
    const r = await fetch(url, {
      headers: {
        'Cookie': cookieStr,
        'Accept': 'application/json',
      },
      credentials: 'include',
      mode: 'cors',
    });
    return { status: r.status, text: await r.text().then(t => t.substring(0, 2000)) };
  }, { url: apiUrl, cookieStr: cookies.map(c => `${c.name}=${c.value}`).join('; ') });
  
  console.log('Fetch from page:', resp2.status, resp2.text.substring(0, 200));

  // Try via page.route to proxy the API call
  console.log('\n=== Trying via route proxy ===');
  const proxyResult = await new Promise<string>(resolve => {
    page.route('**/test-proxy**', async route => {
      const resp = await route.fetch();
      resolve(await resp.text());
      await route.fulfill({ body: 'ok' });
    });
  });
  console.log('Proxy:', proxyResult.substring(0, 500));

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
