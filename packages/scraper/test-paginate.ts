import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' });
  const page = await ctx.newPage();

  await page.goto('https://sellercenter.falabella.com/user/auth/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.fill('#email', 'atencion@limbo.pe');
  await page.locator('#submit').click();
  await page.waitForTimeout(8000);
  await page.fill('#password', 'Atencioncita123@xx?');
  await page.locator('#login').click();
  await page.waitForTimeout(10000);

  // Use Playwright's APIRequest — shares the browser context cookie jar
  const apiRequest = ctx.request;
  const TARGET = '3234491646';
  let found = false;

  for (let p = 1; p <= 10; p++) {
    const apiUrl = `https://seller-settlements.falabella.services/invoice-bff/v2/seller-order/SC64DB9?typeOfOrder=SO&page=${p}&limit=15&fromDate=2026-04-29&toDate=2026-05-06`;

    try {
      const resp = await apiRequest.get(apiUrl, {
        headers: { 'Accept': 'application/json' },
      });
      
      if (resp.status() !== 200) {
        console.log(`Page ${p}: ${resp.status()}`);
        break;
      }

      const json = await resp.json();
      const items = json.data || [];
      if (!items.length) break;

      const match = items.find((o: any) => 
        o.orderNumber === TARGET || o.deliveryOrderNumber === TARGET || o.sellerOrderNumber === TARGET
      );

      if (match) {
        console.log(`Found on page ${p}/${json.meta?.pagination?.totalPages}:`);
        console.log('  orderNumber:', match.orderNumber);
        console.log('  deliveryOrderNumber:', match.deliveryOrderNumber);
        console.log('  createdAt:', match.createdAt);
        console.log('  client:', match.userName?.firstName, match.userName?.lastName1);
        console.log('  document:', match.document?.type, match.document?.id);
        const cfg = match.invoiceConfig?.orderConfig;
        console.log('  restrictUpload:', cfg?.restrictUpload);
        console.log('  reasonCodes:', cfg?.reasonCodes);
        console.log('  => INVOICE_ALREADY_UPLOADED:', cfg?.reasonCodes?.includes('INVOICE_ALREADY_UPLOADED'));
        found = true;
      }

      const totalPages = json.meta?.pagination?.totalPages || 1;
      if (p >= totalPages) break;
    } catch (e: any) {
      console.log(`Page ${p} error:`, e.message);
      break;
    }
  }

  if (!found) console.log(`Order ${TARGET} not found`);
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
