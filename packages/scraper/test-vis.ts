import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: false, slowMo: 150 });
  const page = await browser.newPage();

  // Aggressive modal/overlay killer
  await page.addInitScript(() => {
    const kill = () => {
      document.querySelectorAll(
        '.fixed.inset-0, [class*="fixed"][class*="inset-0"], [style*="z-index"], [role="dialog"], .modal, .ant-modal-wrap, .swal2-container, [class*="modal"], [class*="popup"], [class*="overlay"], [class*="backdrop"], [class*="mask"]'
      ).forEach((el: any) => {
        const btn = el.querySelector('[aria-label="Close"], [aria-label="Cerrar"], .close, .modal-close, button[class*="close"]');
        if (btn) btn.click();
        el.remove();
      });
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    };
    kill();
    new MutationObserver(kill).observe(document.body, { childList: true, subtree: true });
    setInterval(kill, 1000);
  });

  // ── LOGIN ──
  console.log('🔑 Login...');
  await page.goto('https://sellercenter.falabella.com/user/auth/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);

  await page.fill('#email', 'atencion@limbo.pe');
  await page.locator('#submit').click();
  await page.waitForTimeout(5000);

  // Keycloak
  console.log('🔐 Keycloak...');
  await page.fill('#password', 'Atencioncita123@xx?');
  await page.locator('#login').click();
  await page.waitForTimeout(10000);
  console.log('✅ Logged in:', page.url());

  // Kill any post-login overlays
  await page.evaluate(() => {
    document.querySelectorAll('.fixed.inset-0, [class*="fixed"][class*="inset"], [role="dialog"], .modal, [class*="modal"], [class*="popup"], [class*="overlay"], [class*="backdrop"]')
      .forEach((el: any) => el.remove());
  });
  await page.waitForTimeout(1000);

  // ── ORDERS ──
  console.log('📋 Orders...');
  await page.goto('https://sellercenter.falabella.com/order/invoice#/purchased-order-list', {
    waitUntil: 'domcontentloaded', timeout: 60000,
  });

  // Kill overlays on orders page
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(2000);
    await page.evaluate(() => {
      document.querySelectorAll('.fixed.inset-0, [class*="fixed"][class*="inset"], [role="dialog"], .modal, [class*="modal"], [class*="popup"], [class*="overlay"], [class*="backdrop"]')
        .forEach((el: any) => el.remove());
    });
    
    const info = await page.evaluate(() => ({
      tables: document.querySelectorAll('table').length,
      rows: document.querySelectorAll('tr').length,
      overlayCount: document.querySelectorAll('.fixed.inset-0, [class*="fixed"][class*="inset-0"], [role="dialog"]').length,
    }));
    console.log(`  [${i+1}] tables:${info.tables} rows:${info.rows} overlays:${info.overlayCount}`);
    if (info.rows > 0) break;
  }

  await page.screenshot({ path: './data/vis-orders.png', fullPage: true });
  console.log('📸 Screenshot saved. Browser stays open 30s...');
  await page.waitForTimeout(30000);
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
