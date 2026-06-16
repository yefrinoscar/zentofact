import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  });
  const page = await context.newPage();

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    (window as any).chrome = { runtime: {} };
    (window as any).__name = (fn: any, name: string) => {
      try { Object.defineProperty(fn, 'name', { value: name }); } catch(e) {}
      return fn;
    };
    const kill = () => {
      if (!document.body) return;
      document.querySelectorAll('.fixed.inset-0, [role="dialog"], .modal, [class*="modal"], [class*="popup"], [class*="overlay"], [class*="backdrop"]')
        .forEach((el: any) => el.remove());
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
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
  await page.waitForTimeout(2000);
  await page.fill('#email', 'atencion@limbo.pe');
  await page.locator('#submit').click();
  await page.waitForTimeout(6000);
  await page.fill('#password', 'Atencioncita123@xx?');
  await page.locator('#login').click();
  await page.waitForTimeout(12000);
  console.log('Logged in:', page.url());

  // Go to orders
  console.log('Navigating to orders...');
  await page.goto('https://sellercenter.falabella.com/order/invoice#/purchased-order-list', {
    waitUntil: 'load', timeout: 60000,
  });

  // Wait a long time for SPA to render
  console.log('Waiting for table to render...');
  for (let i = 1; i <= 20; i++) {
    await page.waitForTimeout(5000);
    // Kill modals each iteration
    await page.evaluate(() => {
      document.querySelectorAll('.fixed.inset-0, [role="dialog"], .modal, [class*="modal"], [class*="popup"]')
        .forEach((el: any) => el.remove());
    });

    const state = await page.evaluate(() => {
      const trs = document.querySelectorAll('tr');
      const tds = document.querySelectorAll('td');
      const btns = document.querySelectorAll('button, a, input[type="button"]');
      const btnTexts: string[] = [];
      btns.forEach(b => {
        const t = b.textContent?.trim() || '';
        if (t) btnTexts.push(t.substring(0, 40));
      });
      return {
        url: location.href,
        hash: location.hash,
        trCount: trs.length,
        tdCount: tds.length,
        tableCount: document.querySelectorAll('table').length,
        bodyText: document.body?.innerText?.substring(0, 500),
        buttons: btnTexts.filter(t => t.includes('Cargar') || t.includes('documento') || t.includes('Invoice') || t.includes('Ver')).slice(0, 10),
        loadingSpinners: document.querySelectorAll('[class*="spin"], [class*="loading"], .fa-spinner').length,
      };
    });

    console.log(`[${i}/20] tables:${state.tableCount} rows:${state.trCount} btns:"${state.buttons.join(', ')}" body-len:${state.bodyText.length}`);
    
    if (state.trCount > 5) {
      console.log('✅ TABLE RENDERED!');
      await page.screenshot({ path: './data/table-found.png', fullPage: true });
      break;
    }
  }

  console.log('\nFinal check...');
  const final = await page.evaluate(() => ({
    html: document.body?.innerHTML?.substring(0, 5000),
  }));
  console.log(final.html);

  console.log('Browser open 2min...');
  await page.waitForTimeout(120000);
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
