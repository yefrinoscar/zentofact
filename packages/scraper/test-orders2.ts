import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Login
  await page.goto('https://sellercenter.falabella.com/user/auth/login', { waitUntil: 'networkidle' });
  await page.fill('#email', 'atencion@limbo.pe');
  await page.locator('#submit').click();
  await page.waitForTimeout(5000);

  // Keycloak
  await page.fill('#password', 'Atencioncita123@xx?');
  await page.locator('#login').click();
  await page.waitForTimeout(10000);

  // Go to orders with longer waits
  await page.goto('https://sellercenter.falabella.com/order/invoice#/purchased-order-list', { waitUntil: 'load' });
  
  // Wait for possible loading states
  console.log('Waiting for SPA to render...');
  
  // Try to wait for any table-like element
  for (const selector of [
    '.ant-table',
    'table',
    '[class*="table"]',
    '[class*="Table"]',
    '.data-table',
    '.grid-view',
    '.orders-list',
    '.purchase-orders',
    '[data-testid]',
    '.main-content',
    '.content-area',
    'iframe',
  ]) {
    try {
      await page.waitForSelector(selector, { timeout: 5000 });
      console.log(`Found: ${selector}`);
    } catch {
      // continue
    }
  }

  await page.waitForTimeout(10000);
  await page.screenshot({ path: './data/debug-orders-final.png', fullPage: true });

  // Full DOM analysis
  const analysis = await page.evaluate(() => {
    const all = document.querySelectorAll('*');
    const classCounts: Record<string, number> = {};
    const tagCounts: Record<string, number> = {};
    
    all.forEach(el => {
      const tag = el.tagName.toLowerCase();
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      if (el.className && typeof el.className === 'string') {
        el.className.split(/\s+/).forEach(c => {
          classCounts[c] = (classCounts[c] || 0) + 1;
        });
      }
    });

    // Find iframes
    const iframes = Array.from(document.querySelectorAll('iframe')).map(f => ({
      src: f.src,
      id: f.id,
      name: f.name,
    }));

    return {
      tagCounts,
      topClasses: Object.entries(classCounts).sort((a, b) => b[1] - a[1]).slice(0, 20),
      iframes,
      bodyHTML: document.body?.innerHTML?.substring(0, 3000),
    };
  });

  console.log('TAGS:', analysis.tagCounts);
  console.log('TOP CLASSES:', analysis.topClasses);
  console.log('IFRAMES:', analysis.iframes);
  console.log('BODY HTML:\n', analysis.bodyHTML);

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
