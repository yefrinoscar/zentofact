import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  await page.addInitScript(() => {
    // Hide automation
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    (window as any).chrome = { runtime: {} };

    // Fix __name
    (window as any).__name = function(fn: any, name: string) {
      try { Object.defineProperty(fn, 'name', { value: name, configurable: true }); } catch(e) {}
      return fn;
    };

    // Kill modals safely
    const kill = () => {
      if (!document.body) return;
      document.querySelectorAll('.fixed.inset-0, [role="dialog"], .modal, [class*="modal"], [class*="popup"], [class*="overlay"], [class*="backdrop"]')
        .forEach((el: any) => el.remove());
    };
    const startObserving = () => {
      if (!document.body) { setTimeout(startObserving, 100); return; }
      kill();
      new MutationObserver(kill).observe(document.body, { childList: true, subtree: true });
      setInterval(kill, 1000);
    };
    startObserving();
  });

  // Login
  await page.goto('https://sellercenter.falabella.com/user/auth/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.fill('#email', 'atencion@limbo.pe');
  await page.locator('#submit').click();
  await page.waitForTimeout(5000);
  await page.fill('#password', 'Atencioncita123@xx?');
  await page.locator('#login').click();
  await page.waitForTimeout(10000);
  console.log('✅ Logged in:', page.url());

  // Go to root first, then navigate via hash
  await page.goto('https://sellercenter.falabella.com/order/invoice', {
    waitUntil: 'networkidle', timeout: 120000,
  });
  await page.waitForTimeout(5000);
  console.log('Base invoice page:', page.url());

  // Manually set hash and trigger hashchange
  await page.evaluate(() => {
    location.hash = '#/purchased-order-list';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  console.log('Hash set');

  await page.waitForTimeout(20000);

  const info = await page.evaluate(() => ({
    url: location.href,
    hash: location.hash,
    tables: document.querySelectorAll('table').length,
    rows: document.querySelectorAll('tr').length,
    bodyLen: document.body?.innerText?.length || 0,
    text: document.body?.innerText?.substring(0, 2000),
  }));
  console.log('After hashchange:', info);

  await page.screenshot({ path: './data/hashchange.png', fullPage: true });
  console.log('Browser stays open 60s...');
  await page.waitForTimeout(60000);
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
