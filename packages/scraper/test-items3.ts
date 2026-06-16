import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' });
  const page = await ctx.newPage();

  // Login
  await page.goto('https://sellercenter.falabella.com/user/auth/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.fill('#email', 'atencion@limbo.pe');
  await page.locator('#submit').click();
  await page.waitForTimeout(5000);
  const url = page.url();
  if (url.includes('access-key-corp')) {
    await page.fill('#password', 'Atencioncita123@xx?');
    await page.locator('#login').click();
  }
  await page.waitForTimeout(10000);
  console.log('Logged in:', page.url());

  // Get first order to know sellerOrderId
  await page.goto('https://sellercenter.falabella.com/order/invoice', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const resp = await page.waitForResponse(r => r.url().includes('invoice-bff/v2/seller-order') && r.status() === 200, { timeout: 60000 });
  const json = await resp.json();
  const order = json.data[0];
  console.log('Order:', order.orderNumber, order.sellerOrderId, order.deliveryOrderNumber);

  // Use page.route to intercept and proxy the items API call
  const itemsPromise = new Promise<any>((resolve) => {
    page.route('**/manage-orders/v1/order/items**', async (route) => {
      const resp = await route.fetch();
      const body = await resp.text();
      resolve({ status: resp.status(), body });
      await route.fulfill({ response: resp });
    });
  });

  // Trigger the items API from the page by navigating to order view
  await page.goto(`https://sellercenter.falabella.com/order/view/number/${order.orderNumber}`, {
    waitUntil: 'domcontentloaded', timeout: 60000,
  });
  await page.waitForTimeout(10000);

  // Or trigger via page.evaluate with the intercepted DMP token
  const result = await page.evaluate(async ({ sellerOrderId, deliveryOrderNumber }) => {
    // Extract fresh DMP token
    const dmp = document.cookie.split(';').find(c => c.trim().startsWith('dmp='))?.split('=')[1] || '';
    const r = await fetch(
      `https://seller-platforms.falabella.services/manage-orders/v1/order/items?sellerOrderId=${sellerOrderId}&deliveryOrderNumber=${deliveryOrderNumber}`,
      {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${dmp}`,
          'x-channel': 'WEB',
          'x-country': 'PE',
          'x-operator': 'FAPE',
          'x-seller': 'SC64DB9',
          'origin': window.location.origin,
        },
        credentials: 'include',
      }
    );
    return { status: r.status, ok: r.ok, data: r.ok ? await r.json() : null };
  }, { sellerOrderId: order.sellerOrderId, deliveryOrderNumber: order.deliveryOrderNumber });

  console.log('Items result:', result.status);
  if (result.data) console.log('Items:', JSON.stringify(result.data).substring(0, 2000));

  // Also check route interception
  try {
    const intercepted = await Promise.race([itemsPromise, new Promise(r => setTimeout(() => r(null), 5000))]);
    if (intercepted) console.log('Route intercepted:', intercepted.status, intercepted.body.substring(0, 1000));
  } catch {}

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
