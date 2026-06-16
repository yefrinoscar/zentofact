import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true, slowMo: 50 });
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' });
  const page = await ctx.newPage();

  // Intercept items API to capture response  
  page.on('response', async resp => {
    if (resp.url().includes('manage-orders/v1/order/items') && resp.status() === 200) {
      const body = await resp.text();
      console.log('Items API response:', body.substring(0, 1000));
    }
  });

  // Login
  await page.goto('https://sellercenter.falabella.com/user/auth/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.fill('#email', 'atencion@limbo.pe');
  await page.locator('#submit').click();
  await page.waitForTimeout(5000);
  
  // Handle either Keycloak or inline
  const url = page.url();
  if (url.includes('access-key-corp')) {
    await page.fill('#password', 'Atencioncita123@xx?');
    await page.locator('#login').click();
  } else {
    // Password might be revealed inline
    await page.waitForSelector('#password:visible', { timeout: 5000 }).catch(() => {});
    const passVis = await page.locator('#password').isVisible().catch(() => false);
    if (passVis) {
      await page.fill('#password', 'Atencioncita123@xx?');
      await page.locator('#submit').click();
      // Might redirect to Keycloak after
      await page.waitForTimeout(5000);
      if (page.url().includes('access-key-corp')) {
        await page.waitForSelector('#password:visible', { timeout: 5000 });
        await page.fill('#password', 'Atencioncita123@xx?');
        await page.locator('#login').click();
      }
    }
  }
  await page.waitForTimeout(10000);
  console.log('Logged in:', page.url());

  // Intercept items API
  page.on('request', req => {
    if (req.url().includes('manage-orders/v1/order/items')) {
      console.log('Items request headers:', JSON.stringify(req.headers(), null, 2));
    }
  });

  // Get first page of orders to find a sellerOrderId
  await page.goto('https://sellercenter.falabella.com/order/invoice', { waitUntil: 'domcontentloaded', timeout: 60000 });
  
  const respPromise = page.waitForResponse(
    r => r.url().includes('invoice-bff/v2/seller-order') && r.status() === 200,
    { timeout: 60000 }
  );
  const resp = await respPromise;
  const json = await resp.json();
  
  if (json.data?.length > 0) {
    const order = json.data[0];
    console.log('Order:', order.orderNumber, order.sellerOrderId, order.deliveryOrderNumber);

    // Try calling items API via page.evaluate with extracted headers
    const itemsResult = await page.evaluate(async ({ sellerOrderId, deliveryOrderNumber }) => {
      // Extract token from DMP cookie
      const dmpCookie = document.cookie.split(';').find(c => c.trim().startsWith('dmp='));
      const dmp = dmpCookie ? dmpCookie.split('=')[1] : '';

      const r = await fetch(
        `https://seller-platforms.falabella.services/manage-orders/v1/order/items?sellerOrderId=${sellerOrderId}&deliveryOrderNumber=${deliveryOrderNumber}`,
        {
          headers: {
            'Accept': 'application/json',
            'x-channel': 'WEB',
            'x-country': 'PE',
            'x-operator': 'FAPE',
            'x-seller': 'SC64DB9',
            'Authorization': `Bearer ${dmp}`,
            'origin': 'https://sellercenter.falabella.com',
          },
          credentials: 'include',
        }
      );
      return { status: r.status, ok: r.ok, text: r.ok ? await r.text() : `ERROR ${r.status}` };
    }, { sellerOrderId: order.sellerOrderId, deliveryOrderNumber: order.deliveryOrderNumber });

    console.log('Items result:', itemsResult.status, itemsResult.text?.substring(0, 1500));
  }

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
