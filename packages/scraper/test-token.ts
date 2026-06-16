import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' });
  const page = await ctx.newPage();

  // Login
  await page.goto('https://sellercenter.falabella.com/user/auth/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.fill('#email', 'atencion@limbo.pe');
  await page.locator('#submit').click();
  await page.waitForTimeout(8000);
  await page.fill('#password', 'Atencioncita123@xx?');
  await page.locator('#login').click();
  await page.waitForTimeout(10000);

  // Extract JWT from various sources
  const tokens = await page.evaluate(() => {
    const findToken = () => {
      // localStorage
      for (const k of Object.keys(localStorage)) {
        const v = localStorage.getItem(k);
        if (v?.startsWith('eyJ')) return { source: `localStorage:${k}`, token: v };
      }
      // sessionStorage
      for (const k of Object.keys(sessionStorage)) {
        const v = sessionStorage.getItem(k);
        if (v?.startsWith('eyJ')) return { source: `sessionStorage:${k}`, token: v };
      }
      // cookies — find JWT in cookie string
      const cookies = document.cookie.split(';');
      for (const c of cookies) {
        const [name, val] = c.trim().split('=');
        if (val?.startsWith('eyJ')) return { source: `cookie:${name}`, token: val };
      }
      // window vars
      const win = window as any;
      for (const k of Object.keys(win)) {
        try {
          if (typeof win[k] === 'string' && win[k].startsWith('eyJ') && win[k].length > 200) {
            return { source: `window.${k}`, token: win[k] };
          }
        } catch {}
      }
      return null;
    };
    return findToken();
  });
  console.log('JWT found:', tokens?.source);

  // Also intercept an items API call to capture working headers
  let capturedHeaders: any = null;
  page.on('request', req => {
    if (req.url().includes('manage-orders/v1/order/items')) {
      capturedHeaders = req.headers();
      console.log('Intercepted items API headers:', JSON.stringify(capturedHeaders, null, 2));
    }
  });

  // Navigate to trigger some page + intercept
  await page.goto('https://sellercenter.falabella.com/order/invoice', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(10000);

  if (!capturedHeaders) {
    // Try calling items API manually with intercepted JWT
    if (tokens?.token) {
      console.log('\nTrying items API with JWT...');
      const result = await page.evaluate(async ({ token }) => {
        const r = await fetch(
          'https://seller-platforms.falabella.services/manage-orders/v1/order/items?sellerOrderId=e8a5f2d3-c142-4cee-b852-ac2ea25f4757&deliveryOrderNumber=1700530825',
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'x-channel': 'WEB',
              'x-country': 'PE',
              'x-operator': 'FAPE',
              'x-seller': 'SC64DB9',
              'Accept': 'application/json',
            },
            credentials: 'include',
          }
        );
        return { status: r.status, ok: r.ok, data: r.ok ? await r.json() : null };
      }, { token: tokens.token });
      console.log('Result:', result.status, JSON.stringify(result.data).substring(0, 1000));
    }
  }

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
