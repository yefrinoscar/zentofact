import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Go to login
  await page.goto('https://sellercenter.falabella.com/user/auth/login', { waitUntil: 'networkidle' });
  console.log('1. Login page:', page.url());

  // Fill email and click Continuar
  await page.fill('#email', 'atencion@limbo.pe');
  await page.waitForTimeout(300);
  await page.locator('#submit').click();
  await page.waitForTimeout(5000);
  console.log('2. After email submit:', page.url());
  await page.screenshot({ path: './data/debug-keycloak.png', fullPage: true });

  // Log Keycloak form HTML
  const formHtml = await page.evaluate(() => {
    const form = document.querySelector('form');
    return form ? form.outerHTML.substring(0, 3000) : 'NO FORM';
  });
  console.log('KEYCLOAK FORM HTML:\n', formHtml);
  console.log('---');

  // Find all inputs and buttons
  const inputs = await page.evaluate(() => {
    return {
      inputs: Array.from(document.querySelectorAll('input')).map(i => ({
        id: i.id,
        name: i.name,
        type: i.type,
        placeholder: i.placeholder,
        value: i.value?.substring(0, 20),
      })),
      buttons: Array.from(document.querySelectorAll('button, input[type="submit"]')).map(b => ({
        id: b.id,
        name: (b as any).name,
        type: (b as any).type,
        text: (b.textContent || '').trim().substring(0, 30),
      })),
    };
  });
  console.log('INPUTS:', JSON.stringify(inputs.inputs, null, 2));
  console.log('BUTTONS:', JSON.stringify(inputs.buttons, null, 2));

  // Try to fill password and submit
  const passField = await page.locator('#password').first();
  if (await passField.isVisible()) {
    await passField.fill('Atencioncita123@xx?');
    await page.waitForTimeout(300);
  }

  // Find and click submit button
  const submitBtn = await page.locator('input[type="submit"], button[type="submit"], #kc-login').first();
  console.log('Submit button visible:', await submitBtn.isVisible());
  await submitBtn.click();
  await page.waitForTimeout(8000);
  console.log('3. After Keycloak submit:', page.url());
  await page.screenshot({ path: './data/debug-after-keycloak.png', fullPage: true });

  // Go to orders
  await page.goto('https://sellercenter.falabella.com/order/invoice#/purchased-order-list', { waitUntil: 'networkidle' });
  await page.waitForTimeout(5000);
  console.log('4. Orders page:', page.url());
  await page.screenshot({ path: './data/debug-orders.png', fullPage: true });

  // Log page content
  const info = await page.evaluate(() => ({
    title: document.title,
    text: document.body?.innerText?.substring(0, 1500),
    tables: document.querySelectorAll('table').length,
    rows: document.querySelectorAll('tr').length,
  }));
  console.log('ORDERS PAGE:', info);

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
