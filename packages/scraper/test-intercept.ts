import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

async function main() {
  const browser = await chromium.launch({ headless: true, slowMo: 50 });
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' });
  const page = await ctx.newPage();

  await page.addInitScript(() => {
    const kill = () => {
      if (!document.body) return;
      document.querySelectorAll('.settlement-invoice-modal-wrap, .ant-modal-wrap, [role="dialog"], [class*="modal"], .fixed.inset-0')
        .forEach((el: any) => el.remove());
    };
    const start = () => { if (document.body) { kill(); new MutationObserver(kill).observe(document.body, {childList:true,subtree:true}); } else setTimeout(start, 100); };
    start();
  });

  // Login
  await page.goto('https://sellercenter.falabella.com/user/auth/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.fill('#email', 'atencion@limbo.pe');
  await page.locator('#submit').click();
  await page.waitForTimeout(8000);
  await page.fill('#password', 'Atencioncita123@xx?');
  await page.locator('#login').click();
  await page.waitForTimeout(10000);

  // Intercept the invoice API response
  const invoiceResponsePromise = page.waitForResponse(
    resp => resp.url().includes('invoice-bff/v2/seller-order') && resp.status() === 200,
    { timeout: 60000 }
  );

  // Navigate to orders page
  await page.goto('https://sellercenter.falabella.com/order/invoice', { waitUntil: 'networkidle', timeout: 60000 });

  try {
    const resp = await invoiceResponsePromise;
    const body = await resp.json();
    console.log('API Response keys:', Object.keys(body));
    console.log('data length:', body.data?.length);
    
    if (body.data?.length > 0) {
      console.log('First order keys:', Object.keys(body.data[0]));
      console.log('First order:', JSON.stringify(body.data[0], null, 2).substring(0, 2000));
    }

    writeFileSync('./data/api-response.json', JSON.stringify(body, null, 2));
    console.log('Saved to data/api-response.json');

    // Try navigating to order detail
    const firstOrder = body.data[0];
    const orderNumber = firstOrder.orderNumber || firstOrder.sellerOrderId?.split('-')[0];
    console.log('\nOrder number:', orderNumber);

    if (orderNumber) {
      await page.goto(`https://sellercenter.falabella.com/order/view/number/${orderNumber}`, {
        waitUntil: 'networkidle', timeout: 60000,
      });
      await page.waitForTimeout(10000);

      await page.screenshot({ path: './data/order-detail.png', fullPage: true });

      const detail = await page.evaluate(() => ({
        url: location.href,
        title: document.title,
        text: document.body?.innerText?.substring(0, 3000),
        tables: document.querySelectorAll('table').length,
        rows: document.querySelectorAll('tr').length,
      }));
      console.log('Detail page:', JSON.stringify(detail, null, 2));
    }
  } catch (e) {
    console.log('No API response caught:', (e as Error).message);
  }

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
