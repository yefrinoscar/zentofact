import { chromium } from 'playwright';

const USER = 'atencion@limbo.pe';
const PASS = 'Atencioncita123@xx?';

async function dismissModals(page: any) {
  await page.evaluate(() => {
    document.querySelectorAll('[role="dialog"], .modal, .ant-modal-wrap, .swal2-container, [class*="modal"], [class*="popup"], [class*="overlay"]').forEach((el: any) => {
      const btn = el.querySelector('[aria-label="Close"], [aria-label="Cerrar"], .close, .modal-close');
      if (btn) btn.click();
      else el.click?.();
    });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
}

async function main() {
  const browser = await chromium.launch({ headless: true, slowMo: 100 });
  const page = await browser.newPage();

  // ── Modal killer init script ──
  await page.addInitScript(() => {
    const kill = () => {
      document.querySelectorAll('[role="dialog"], .modal, .ant-modal-wrap, .swal2-container, [class*="modal"], [class*="popup"], [class*="overlay"]').forEach((el: any) => {
        el.style.display = 'none';
        el.remove?.();
      });
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    };
    new MutationObserver(kill).observe(document.body, { childList: true, subtree: true });
    setInterval(kill, 2000);
  });

  // ═══ SCREEN 1: Falabella login ═══
  console.log('=== SCREEN 1: Falabella login ===');
  await page.goto('https://sellercenter.falabella.com/user/auth/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);
  console.log('URL:', page.url());

  const emailVis = await page.locator('#email').isVisible().catch(() => false);
  const passVis = await page.locator('#password').isVisible().catch(() => false);
  const submitVis = await page.locator('#submit').isVisible().catch(() => false);
  console.log(`email visible: ${emailVis}, password visible: ${passVis}, submit visible: ${submitVis}`);

  if (emailVis) {
    await page.fill('#email', USER);
    await page.waitForTimeout(300);
    await page.locator('#submit').click();
    console.log('Clicked Continuar');
    await page.waitForTimeout(5000);
    console.log('URL after click:', page.url());
    await dismissModals(page);
  }

  // ═══ SCREEN 2: Keycloak? ═══
  console.log('\n=== SCREEN 2: After email ===');
  await page.waitForTimeout(2000);
  await dismissModals(page);
  console.log('URL:', page.url());

  const onKeycloak = page.url().includes('access-key-corp');
  console.log('On Keycloak:', onKeycloak);

  if (onKeycloak) {
    const kcPassVis = await page.locator('#password').isVisible().catch(() => false);
    const kcLoginVis = await page.locator('#login').isVisible().catch(() => false);
    console.log(`Keycloak password: ${kcPassVis}, login btn: ${kcLoginVis}`);

    if (kcPassVis) {
      await page.fill('#password', PASS);
      await page.waitForTimeout(300);
      await page.locator('#login').click();
      console.log('Clicked Login on Keycloak');
      await page.waitForTimeout(10000);
      console.log('URL after Keycloak:', page.url());
      await dismissModals(page);
    }
  } else {
    // Still on Falabella — maybe password revealed
    const passVis2 = await page.locator('#password').isVisible().catch(() => false);
    console.log('Password visible now:', passVis2);
    if (passVis2) {
      await page.fill('#password', PASS);
      await page.locator('#submit').click();
      console.log('Clicked submit with password');
      await page.waitForTimeout(8000);
      console.log('URL after:', page.url());
    }
  }

  // ═══ SCREEN 3: Orders ═══
  console.log('\n=== SCREEN 3: Orders ===');
  await page.goto('https://sellercenter.falabella.com/order/invoice#/purchased-order-list', {
    waitUntil: 'domcontentloaded', timeout: 60000,
  });
  await page.waitForTimeout(10000);
  await dismissModals(page);
  await page.waitForTimeout(5000);
  console.log('Orders URL:', page.url());

  await page.screenshot({ path: './data/result-orders.png', fullPage: true });

  const info = await page.evaluate(() => ({
    title: document.title,
    bodyLen: document.body?.innerText?.length || 0,
    tables: document.querySelectorAll('table').length,
    rows: document.querySelectorAll('tr').length,
    snippet: document.body?.innerText?.substring(0, 2000),
    links: Array.from(document.querySelectorAll('a')).filter(a => a.href.includes('order/view')).map(a => a.href).slice(0, 5),
    allLinks: Array.from(document.querySelectorAll('a')).map(a => a.href).filter(h => h).slice(0, 15),
  }));
  console.log('PAGE INFO:', JSON.stringify(info, null, 2));

  await browser.close();
  console.log('\n=== DONE ===');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
