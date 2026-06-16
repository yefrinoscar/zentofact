import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto('https://sellercenter.falabella.com/user/auth/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('1. Login page:', page.url());

  // Fill email
  await page.fill('#email', 'atencion@limbo.pe');
  await page.waitForTimeout(300);
  
  // Click Continuar
  await page.locator('#submit').click();
  console.log('2. Clicked Continuar. URL:', page.url());
  
  // Wait for password field to appear (wrap-password loses hidden)
  await page.waitForFunction(() => {
    const wrap = document.querySelector('#wrap-password');
    return wrap && !wrap.classList.contains('hidden');
  }, { timeout: 15000 }).catch(() => console.log('wrap-password still hidden'));
  
  console.log('3. Password div visible. URL:', page.url());
  
  // Check if we're on Keycloak or still on same page
  if (page.url().includes('access-key-corp')) {
    console.log('ON KEYCLOAK');
  }

  // Fill password
  const passVisible = await page.locator('#password').isVisible().catch(() => false);
  console.log('Password visible:', passVisible);
  
  if (passVisible) {
    await page.fill('#password', 'Atencioncita123@xx?');
    await page.waitForTimeout(300);
    await page.locator('#submit').click();
    console.log('4. Clicked submit with password. URL:', page.url());
    await page.waitForTimeout(8000);
    console.log('5. After wait:', page.url());
  }

  // If we end up on Keycloak
  if (page.url().includes('access-key-corp')) {
    console.log('ON KEYCLOAK after submit');
    await page.fill('#password', 'Atencioncita123@xx?');
    await page.waitForTimeout(300);
    await page.locator('#login, input[type="submit"], button[type="submit"]').first().click();
    await page.waitForTimeout(8000);
    console.log('6. After Keycloak:', page.url());
  }

  // Go to orders
  await page.goto('https://sellercenter.falabella.com/order/invoice#/purchased-order-list', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(15000);
  console.log('7. Orders:', page.url());

  await page.screenshot({ path: './data/debug-flow.png', fullPage: true });

  const content = await page.evaluate(() => ({
    tables: document.querySelectorAll('table').length,
    rows: document.querySelectorAll('tr').length,
    bodySnippet: document.body?.innerText?.substring(0, 2000),
    links: Array.from(document.querySelectorAll('a')).filter(a => a.href?.includes('order')).map(a => a.href).slice(0, 10),
  }));
  console.log('PAGE:', content);

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
