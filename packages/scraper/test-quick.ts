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

  await page.evaluate(() => localStorage.setItem('common-coach-mark', JSON.stringify(['.support-coachmark','.col_0_0','.col_0_2','.col_1_0','.col_2_0','.col_3_0'])));

  const allOrders: any[] = [];
  const errors: string[] = [];

  for (let pageNum = 1; pageNum <= 5; pageNum++) {
    const expectedUrl = `https://seller-settlements.falabella.services/invoice-bff/v2/seller-order/SC64DB9?typeOfOrder=SO&page=${pageNum}&limit=15&fromDate=2026-04-29&toDate=2026-05-06`;
    console.log(`\nPage ${pageNum}: waiting for ${expectedUrl}`);

    const responsePromise = page.waitForResponse(
      resp => resp.url().includes('invoice-bff/v2/seller-order') && resp.status() === 200,
      { timeout: 60000 },
    );

    // Trigger navigation
    if (pageNum === 1) {
      await page.goto('https://sellercenter.falabella.com/order/invoice', { waitUntil: 'networkidle', timeout: 60000 });
    } else {
      await page.evaluate(p => { location.hash = `#/purchased-order-list?page=${p}`; }, pageNum);
      await page.waitForTimeout(3000);
    }

    try {
      const resp = await responsePromise;
      const json = await resp.json();
      console.log(`  Got response: ${json.data?.length} items, meta:`, json.meta?.pagination);

      if (json.data) {
        for (const item of json.data) {
          allOrders.push({
            orderNumber: item.orderNumber,
            clientName: [item.userName?.firstName, item.userName?.lastName1, item.userName?.lastName2].filter(Boolean).join(' '),
            docId: item.document?.id,
            docType: item.document?.type,
            total: item.totals?.find((t: any) => t.type === 'ITEM_TOTAL')?.amount?.centAmount,
            invoiceType: item.invoiceInstruction?.invoiceType,
          });
        }
      }

      const totalPages = json.meta?.pagination?.totalPages;
      if (totalPages && pageNum >= totalPages) break;
    } catch (e: any) {
      console.log(`  Error: ${e.message}`);
      errors.push(e.message);
      break;
    }
  }

  console.log(`\n=== Total: ${allOrders.length} orders ===`);
  allOrders.slice(0, 5).forEach((o, i) => console.log(`  ${i}: ${o.docType} ${o.docId} - ${o.clientName} - S/${o.total/100} (${o.invoiceType})`));
  console.log(`Errors: ${errors.length}`);

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
