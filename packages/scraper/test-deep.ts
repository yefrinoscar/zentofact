import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true, slowMo: 50 });
  const page = await browser.newPage();

  await page.addInitScript(() => {
    const kill = () => {
      document.querySelectorAll('[role="dialog"], .modal, .ant-modal-wrap, .swal2-container, [class*="modal"], [class*="popup"], [class*="overlay"]').forEach((el: any) => {
        el.style.display = 'none';
      });
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    };
    new MutationObserver(kill).observe(document.body, { childList: true, subtree: true });
    setInterval(kill, 2000);
  });

  // Login
  await page.goto('https://sellercenter.falabella.com/user/auth/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.fill('#email', 'atencion@limbo.pe');
  await page.locator('#submit').click();
  await page.waitForTimeout(5000);
  await page.fill('#password', 'Atencioncita123@xx?');
  await page.locator('#login').click();
  await page.waitForTimeout(10000);

  // Orders - try multiple approaches
  console.log('Going to orders...');
  await page.goto('https://sellercenter.falabella.com/order/invoice#/purchased-order-list', {
    waitUntil: 'load', timeout: 60000,
  });

  // Wait and check loading states
  for (let i = 1; i <= 6; i++) {
    await page.waitForTimeout(5000);
    const state = await page.evaluate(() => ({
      url: location.href,
      hash: location.hash,
      tables: document.querySelectorAll('table').length,
      rows: document.querySelectorAll('tr').length,
      loadingEls: document.querySelectorAll('[class*="spin"], [class*="loading"], .ant-spin').length,
      emptyEls: document.querySelectorAll('[class*="empty"]').length,
      bodyLen: document.body?.innerHTML?.length,
      consoleErrors: (window as any).__errors || [],
      bodyText: document.body?.innerText?.substring(0, 500),
    }));
    console.log(`[${i}] wait...`, state);
    if (state.rows > 0 || state.tables > 0) break;
  }

  await page.screenshot({ path: './data/deep-orders.png', fullPage: true });

  // Full DOM dump of main content
  const dom = await page.evaluate(() => {
    const main = document.querySelector('main, [role="main"], .container-main, .content, #content, .main-content');
    return {
      mainHTML: main?.outerHTML?.substring(0, 5000) || 'NO MAIN',
      iframes: Array.from(document.querySelectorAll('iframe')).map(f => ({ src: f.src, id: f.id })),
      scripts: Array.from(document.querySelectorAll('script[src]')).map(s => s.src).slice(0, 10),
    };
  });
  console.log('DOM:', JSON.stringify(dom, null, 2).substring(0, 3000));

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
