import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Polyfill __name + modal killer
  await page.addInitScript(() => {
    (window as any).__name = (fn: any, name: string) => { try { Object.defineProperty(fn, 'name', { value: name }); } catch {} };
    const kill = () => {
      document.querySelectorAll('.fixed.inset-0, [role="dialog"], .modal, [class*="modal"], [class*="popup"], [class*="overlay"], [class*="backdrop"]')
        .forEach((el: any) => el.remove());
    };
    kill();
    new MutationObserver(kill).observe(document.body, { childList: true, subtree: true });
    setInterval(kill, 1000);
  });

  // Login
  await page.goto('https://sellercenter.falabella.com/user/auth/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.fill('#email', 'atencion@limbo.pe');
  await page.locator('#submit').click();
  await page.waitForTimeout(5000);
  await page.fill('#password', 'Atencioncita123@xx?');
  await page.locator('#login').click();
  await page.waitForTimeout(10000);

  // Try the invoice page directly WITHOUT hash
  console.log('Trying /order/invoice (no hash)...');
  await page.goto('https://sellercenter.falabella.com/order/invoice', {
    waitUntil: 'networkidle', timeout: 60000,
  });
  await page.waitForTimeout(5000);
  console.log('URL:', page.url());
  
  let info = await page.evaluate(() => ({
    tables: document.querySelectorAll('table').length,
    rows: document.querySelectorAll('tr').length,
    bodyText: document.body?.innerText?.substring(0, 1000),
  }));
  console.log('Info:', info);

  // Try with hash
  console.log('\nTrying with hash...');
  await page.goto('https://sellercenter.falabella.com/order/invoice#/purchased-order-list', {
    waitUntil: 'networkidle', timeout: 60000,
  });
  await page.waitForTimeout(8000);

  info = await page.evaluate(() => ({
    tables: document.querySelectorAll('table').length,
    rows: document.querySelectorAll('tr').length,
    url: location.href,
    hash: location.hash,
    bodyText: document.body?.innerText?.substring(0, 1000),
  }));
  console.log('With hash:', info);

  // Try through the page itself - look for router links
  console.log('\nTrying SPA router...');
  try {
    // Try clicking on pagination or filter buttons
    const clickable = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a, button')).filter(el => {
        const t = el.textContent?.trim() || '';
        return t && (t.includes('Documento') || t.includes('Tributario') || t.includes('Invoice') || t.includes('Orden'));
      }).map(el => ({ tag: el.tagName, text: el.textContent?.trim(), href: (el as any).href }));
    });
    console.log('Clickable elements:', clickable);

    // Try clicking a link to Documentos Tributarios
    const docLink = page.locator('a:has-text("Documentos tributarios")').first();
    if (await docLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('Clicking Documentos tributarios...');
      await docLink.click();
      await page.waitForTimeout(8000);
      info = await page.evaluate(() => ({
        tables: document.querySelectorAll('table').length,
        rows: document.querySelectorAll('tr').length,
        url: location.href,
        bodyText: document.body?.innerText?.substring(0, 500),
      }));
      console.log('After click:', info);
    }
  } catch (e) {
    console.log('Router error:', (e as Error).message);
  }

  // Check if there's an XHR API we can call directly
  console.log('\nLooking for API endpoints...');
  await page.screenshot({ path: './data/final-state.png', fullPage: true });

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
