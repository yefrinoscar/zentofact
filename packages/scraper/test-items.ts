import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true, slowMo: 50 });
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

  // Get first page of orders
  const respPromise = page.waitForResponse(
    r => r.url().includes('invoice-bff/v2/seller-order') && r.status() === 200,
    { timeout: 60000 }
  );
  await page.goto('https://sellercenter.falabella.com/order/invoice', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const resp = await respPromise;
  const json = await resp.json();

  // Check invoiceConfig for each order
  const filtered = json.data.filter((o: any) => {
    const cfg = o.invoiceConfig?.orderConfig;
    if (!cfg) return true; // no config = allow
    if (cfg.restrictUpload && cfg.reasonCodes?.includes('INVOICE_ALREADY_UPLOADED')) {
      console.log(`  SKIP ${o.orderNumber}: already uploaded`);
      return false;
    }
    return true;
  });

  console.log(`Total: ${json.data.length}, Pending: ${filtered.length}`);

  // Show first filtered order details
  const first = filtered[0];
  console.log('\nFirst pending order:');
  console.log('  orderNumber:', first.orderNumber);
  console.log('  sellerOrderId:', first.sellerOrderId);
  console.log('  deliveryOrderNumber:', first.deliveryOrderNumber);
  console.log('  invoiceConfig:', JSON.stringify(first.invoiceConfig?.orderConfig));

  // Try items API
  const itemsUrl = `https://seller-platforms.falabella.services/manage-orders/v1/order/items?sellerOrderId=${first.sellerOrderId}&deliveryOrderNumber=${first.deliveryOrderNumber}`;
  console.log('\nItems API:', itemsUrl);

  try {
    const itemsResult = await page.evaluate(async (url) => {
      const r = await fetch(url, { headers: { 'Accept': 'application/json' }, credentials: 'include' });
      return { status: r.status, ok: r.ok, data: await r.json() };
    }, itemsUrl);
    console.log('  Status:', itemsResult.status);
    console.log('  Data:', JSON.stringify(itemsResult.data).substring(0, 2000));
  } catch (e: any) {
    console.log('  Error:', e.message);
  }

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
