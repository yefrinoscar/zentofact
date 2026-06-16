import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true, slowMo: 50 });
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' });
  const page = await ctx.newPage();

  await page.goto('https://sellercenter.falabella.com/user/auth/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.fill('#email', 'atencion@limbo.pe');
  await page.locator('#submit').click();
  await page.waitForTimeout(8000);
  await page.fill('#password', 'Atencioncita123@xx?');
  await page.locator('#login').click();
  await page.waitForTimeout(10000);

  const TARGET = '3234491646';

  for (let p = 1; p <= 5; p++) {
    const tab = await ctx.newPage();
    const respPromise = tab.waitForResponse(
      r => r.url().includes('invoice-bff/v2/seller-order') && r.status() === 200,
      { timeout: 60000 }
    );
    await tab.goto('https://sellercenter.falabella.com/order/invoice', { waitUntil: 'domcontentloaded', timeout: 60000 });
    
    try {
      const resp = await respPromise;
      const json = await resp.json();
      // API only returns based on date range in URL. Share the actual URL called
      console.log(`Page ${p} - API URL:`, resp.url());
      const found = json.data?.find((o: any) => 
        o.orderNumber === TARGET || o.deliveryOrderNumber === TARGET || o.sellerOrderNumber === TARGET
      );
      
      if (found) {
        console.log(`Found on page ${p}:`);
        console.log('  invoiceConfig:', JSON.stringify(found.invoiceConfig, null, 2));
        console.log('\n  restrictUpload:', found.invoiceConfig?.orderConfig?.restrictUpload);
        console.log('  reasonCodes:', found.invoiceConfig?.orderConfig?.reasonCodes);
        console.log('  => INVOICE_ALREADY_UPLOADED:', 
          found.invoiceConfig?.orderConfig?.reasonCodes?.includes('INVOICE_ALREADY_UPLOADED'));
        await tab.close();
        await browser.close();
        return;
      }
    } catch {}
    await tab.close();
  }
  
  console.log(`Order ${TARGET} not found in 5 pages`);
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
