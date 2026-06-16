import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  });
  const page = await context.newPage();

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    (window as any).__name = (fn: any, name: string) => {
      try { Object.defineProperty(fn, 'name', { value: name }); } catch(e) {}
      return fn;
    };
    const kill = () => {
      if (!document.body) return;
      document.querySelectorAll('.fixed.inset-0, [role="dialog"], .modal, [class*="modal"], [class*="popup"]')
        .forEach((el: any) => el.remove());
    };
    const start = () => {
      if (document.body) { kill(); new MutationObserver(kill).observe(document.body, {childList:true,subtree:true}); setInterval(kill, 1500); }
      else setTimeout(start, 100);
    };
    start();
  });

  // Login
  console.log('Login...');
  await page.goto('https://sellercenter.falabella.com/user/auth/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.fill('#email', 'atencion@limbo.pe');
  await page.locator('#submit').click();
  await page.waitForTimeout(6000);
  await page.fill('#password', 'Atencioncita123@xx?');
  await page.locator('#login').click();
  await page.waitForTimeout(12000);
  console.log('After login:', page.url());

  // Navigate via location.href (SPA-style, not full reload)
  console.log('SPA navigate to orders...');
  await page.evaluate(() => {
    window.location.href = 'https://sellercenter.falabella.com/order/invoice#/purchased-order-list';
  });

  for (let i = 1; i <= 15; i++) {
    await page.waitForTimeout(5000);
    await page.evaluate(() => {
      document.querySelectorAll('.fixed.inset-0, [role="dialog"], .modal, [class*="modal"], [class*="popup"]')
        .forEach((el: any) => el.remove());
    });

    const state = await page.evaluate(() => ({
      url: location.href,
      hash: location.hash,
      tables: document.querySelectorAll('table').length,
      trs: document.querySelectorAll('tr').length,
      tds: document.querySelectorAll('td').length,
      bodyText: document.body?.innerText?.substring(0, 500),
    }));

    console.log(`[${i}] ${state.url} | tables:${state.tables} tr:${state.trs} td:${state.tds} text:${state.bodyText.length}chars`);

    if (state.trs > 3) {
      console.log('✅ DATA LOADED!');
      await page.screenshot({ path: './data/spa-ok.png', fullPage: true });
      break;
    }
  }

  console.log('Open 3min...');
  await page.waitForTimeout(180000);
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
