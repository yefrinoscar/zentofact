import { chromium } from 'playwright';

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

  // Set coachmark
  await page.evaluate(() => localStorage.setItem('common-coach-mark', JSON.stringify(['.support-coachmark','.col_0_0','.col_0_2','.col_1_0','.col_2_0','.col_3_0'])));

  // Intercept API responses to find seller ID
  page.on('response', async resp => {
    const url = resp.url();
    if ((url.includes('/s/') || url.includes('seller')) && resp.status() === 200) {
      try {
        const ct = resp.headers()['content-type'] || '';
        if (ct.includes('json')) {
          const body = await resp.text();
          if (body.includes('sellerId') || body.includes('seller_id') || body.includes('SC')) {
            console.log('API with sellerId:', url);
            console.log(' ', body.substring(0, 300));
          }
        }
      } catch {}
    }
  });

  // Navigate to orders page
  await page.goto('https://sellercenter.falabella.com/order/invoice', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(15000);

  // Extract all seller-related data
  const info = await page.evaluate(() => {
    const win = window as any;
    return {
      sellerVars: {
        isSeller: win.isSeller,
        iduser: win.iduser,
        sellerCreationDateAndTime: win.sellerCreationDateAndTime,
      },
      localStorage: {
        sellerId: localStorage.getItem('sellerId'),
        storeId: localStorage.getItem('storeId'),
        scSellerId: localStorage.getItem('scSellerId'),
        fscSellerId: localStorage.getItem('fscSellerId'),
      },
      cookies: document.cookie.substring(0, 1000),
      pathname: location.pathname,
      hash: location.hash,
    };
  });
  console.log('Seller info:', JSON.stringify(info, null, 2));

  // Look for order numbers in the page
  const orderNumbers = await page.evaluate(() => {
    const nums = new Set<string>();
    document.querySelectorAll('a[href*="order/view/number"]').forEach(a => {
      const m = a.getAttribute('href')?.match(/number\/(\d+)/);
      if (m) nums.add(m[1]);
    });
    // Also try text content
    document.body?.innerText?.match(/\b(\d{10,12})\b/g)?.forEach((n: string) => nums.add(n));
    return Array.from(nums).slice(0, 10);
  });
  console.log('Order numbers found:', orderNumbers);

  // Try opening one order detail
  if (orderNumbers.length > 0) {
    const orderId = orderNumbers[0];
    console.log(`\nTrying order detail: /order/view/number/${orderId}`);
    await page.goto(`https://sellercenter.falabella.com/order/view/number/${orderId}`, {
      waitUntil: 'networkidle', timeout: 60000,
    });
    await page.waitForTimeout(10000);

    const detail = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      text: document.body?.innerText?.substring(0, 2000),
      tables: document.querySelectorAll('table').length,
      rows: document.querySelectorAll('tr').length,
    }));
    console.log('Detail page:', JSON.stringify(detail, null, 2));
  }

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
