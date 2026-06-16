import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.addInitScript(() => {
    const kill = () => {
      document.querySelectorAll('.fixed.inset-0, [role="dialog"], .modal, [class*="modal"], [class*="popup"], [class*="overlay"], [class*="backdrop"]')
        .forEach((el: any) => el.remove());
    };
    kill();
    new MutationObserver(kill).observe(document.body, { childList: true, subtree: true });
    setInterval(kill, 1000);
  });

  // Collect XHR/fetch URLs
  const apiCalls: string[] = [];
  page.on('request', req => {
    const url = req.url();
    if (url.includes('/api/') || url.includes('invoice') || url.includes('order') || url.includes('v1') || url.includes('v2') || url.includes('graphql') || url.includes('seller')) {
      if (!apiCalls.includes(url)) apiCalls.push(url);
    }
  });

  // Login
  await page.goto('https://sellercenter.falabella.com/user/auth/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.fill('#email', 'atencion@limbo.pe');
  await page.locator('#submit').click();
  await page.waitForTimeout(5000);
  await page.fill('#password', 'Atencioncita123@xx?');
  await page.locator('#login').click();
  await page.waitForTimeout(10000);

  // Navigate via clicking the link from the homepage
  console.log('Going to orders via nav click...');
  await page.goto('https://sellercenter.falabella.com/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);

  // Click "Documentos tributarios" link
  const docLink = page.locator('a[href="https://sellercenter.falabella.com/order/invoice"]').first();
  if (await docLink.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('Clicking Documentos tributarios link...');
    await docLink.click();
    await page.waitForTimeout(15000);
  }

  console.log('URL after click:', page.url());
  
  const info = await page.evaluate(() => ({
    tables: document.querySelectorAll('table').length,
    rows: document.querySelectorAll('tr').length,
    bodyLen: document.body?.innerText?.length || 0,
    snippet: document.body?.innerText?.substring(0, 1000),
  }));
  console.log('Page:', info);

  console.log('\nAPI calls detected:');
  apiCalls.forEach(u => console.log(' ', u));

  await page.screenshot({ path: './data/api-debug.png', fullPage: true });
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
