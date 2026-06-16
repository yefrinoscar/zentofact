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
    const kill = () => {
      if (!document.body) return;
      document.querySelectorAll('.fixed.inset-0, [role="dialog"], .modal, [class*="modal"], [class*="popup"]')
        .forEach((el: any) => el.remove());
    };
    const start = () => { if (document.body) { kill(); new MutationObserver(kill).observe(document.body, {childList:true,subtree:true}); setInterval(kill, 1000); } else setTimeout(start, 100); };
    start();
  });

  // Intercept ALL XHR/fetch calls
  const apiRequests: any[] = [];
  page.on('request', req => {
    const url = req.url();
    if (url.includes('/s/') || url.includes('/api/') || url.includes('invoice') || url.includes('order')) {
      apiRequests.push({ url, method: req.method(), headers: req.headers() });
    }
  });
  page.on('response', async resp => {
    const url = resp.url();
    if (url.includes('/s/order') || url.includes('/s/invoice') || url.includes('fetchOrders')) {
      try {
        const body = await resp.text();
        apiRequests.push({ responseUrl: url, status: resp.status(), body: body.substring(0, 1000) });
      } catch {}
    }
  });

  // Login
  await page.goto('https://sellercenter.falabella.com/user/auth/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.fill('#email', 'atencion@limbo.pe');
  await page.locator('#submit').click();
  await page.waitForTimeout(5000);
  await page.fill('#password', 'Atencioncita123@xx?');
  await page.locator('#login').click();
  await page.waitForTimeout(10000);

  // Go to homepage first (this triggers the API calls seen before)
  console.log('Loading homepage to trigger APIs...');
  await page.goto('https://sellercenter.falabella.com/', { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(15000);

  // Now go to invoice page
  await page.goto('https://sellercenter.falabella.com/order/invoice#/purchased-order-list', {
    waitUntil: 'networkidle', timeout: 120000,
  });
  await page.waitForTimeout(20000);

  console.log('\n=== All API requests detected ===');
  const uniqueUrls = [...new Set(apiRequests.map(r => r.url || r.responseUrl))].filter(Boolean);
  uniqueUrls.forEach(u => console.log(' ', u));

  // Specifically look for order-related API
  const orderApis = uniqueUrls.filter(u => u.includes('/s/order') || u.includes('/s/invoice') || u.includes('fetchOrder') || u.includes('purchased'));
  console.log('\n=== Order APIs ===');
  orderApis.forEach(u => console.log(' ', u));

  // Try calling the API directly
  console.log('\n=== Trying direct API call ===');
  const cookies = await context.cookies();
  const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');

  // Try common order API patterns
  for (const apiPath of [
    'https://sellercenter.falabella.com/s/order/v1/fetchOrders?status=pending',
    'https://sellercenter.falabella.com/s/order/v1/fetchPurchasedOrders',
    'https://sellercenter.falabella.com/s/invoice/v1/fetchPendingInvoices',
    'https://sellercenter.falabella.com/s/order/v1/fetchOrderList?page=1&limit=10',
    'https://sellercenter.falabella.com/order/invoice/fetch?status=pending',
  ]) {
    try {
      const resp = await page.evaluate(async ({ url, cookieStr }) => {
        const r = await fetch(url, {
          headers: { 'Cookie': cookieStr, 'Accept': 'application/json' },
          credentials: 'include',
        });
        return { status: r.status, ok: r.ok, text: await r.text().then(t => t.substring(0, 500)) };
      }, { url: apiPath, cookieStr });
      console.log(`  ${apiPath} -> ${resp.status} ${resp.text.substring(0, 100)}`);
    } catch (e: any) {
      console.log(`  ${apiPath} -> ERROR: ${e.message}`);
    }
  }

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
