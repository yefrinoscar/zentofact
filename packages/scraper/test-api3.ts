import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  });
  const page = await context.newPage();

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
  console.log('Logged in:', page.url());

  // Set localStorage coachmark
  await page.evaluate(() => {
    localStorage.setItem('common-coach-mark', JSON.stringify([
      '.support-coachmark', '.col_0_0', '.col_0_2', '.col_1_0', '.col_2_0', '.col_3_0'
    ]));
  });

  // Extract seller ID from page
  const sellerId = await page.evaluate(() => {
    // Try various sources
    const fromStore = localStorage.getItem('sellerId') || localStorage.getItem('storeId');
    if (fromStore) return fromStore;
    // From URL or meta
    const meta = document.querySelector('meta[name="seller-id"]');
    if (meta) return meta.getAttribute('content');
    // From window
    return (window as any).sellerId || (window as any).__SELLER_ID__ || '';
  });
  console.log('Seller ID from page:', sellerId);

  // Try to find seller ID from homepage API responses
  await page.goto('https://sellercenter.falabella.com/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);

  const sellerId2 = await page.evaluate(() => {
    // Check URL params, window vars, meta
    return (window as any).sellerId || (window as any).__NEXT_DATA__?.props?.pageProps?.sellerId || '';
  });
  console.log('Seller ID from homepage:', sellerId2);

  // Get cookies for API call
  const cookies = await context.cookies();
  const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');

  // Try the API with the known seller ID from user
  const knownSellerId = 'SC64DB9';
  console.log('\n=== Calling orders API ===');
  
  const apiUrl = `https://seller-settlements.falabella.services/invoice-bff/v2/seller-order/${knownSellerId}?typeOfOrder=SO&page=1&limit=15&fromDate=2026-04-29&toDate=2026-05-06`;
  console.log('URL:', apiUrl);

  const resp = await page.evaluate(async ({ url, cookieStr }) => {
    const r = await fetch(url, {
      headers: {
        'Cookie': cookieStr,
        'Accept': 'application/json, text/plain, */*',
      },
      credentials: 'include',
    });
    const text = await r.text();
    return { status: r.status, ok: r.ok, text: text.substring(0, 3000) };
  }, { url: apiUrl, cookieStr });

  console.log('Status:', resp.status);
  console.log('Response:', resp.text);

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
