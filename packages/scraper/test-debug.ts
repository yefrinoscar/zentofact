import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Step 1: Go to login
  await page.goto('https://sellercenter.falabella.com/user/auth/login', { waitUntil: 'networkidle' });
  console.log('URL después de goto login:', page.url());
  await page.screenshot({ path: './data/debug-01-login.png', fullPage: true });

  // Log the HTML of the form
  const formHtml = await page.evaluate(() => {
    const form = document.querySelector('form, .rocket-form');
    return form ? form.outerHTML.substring(0, 2000) : 'NO FORM FOUND';
  });
  console.log('FORM HTML (primeros 2000 chars):\n', formHtml);
  console.log('---');

  // Check what fields are visible
  const emailVisible = await page.locator('#email').isVisible().catch(() => false);
  const passVisible = await page.locator('#password').isVisible().catch(() => false);
  const submitVisible = await page.locator('#submit').isVisible().catch(() => false);
  console.log({ emailVisible, passVisible, submitVisible });

  // Step 2: Fill email and click Continuar
  await page.fill('#email', 'atencion@limbo.pe');
  await page.waitForTimeout(500);
  await page.locator('#submit').first().click();
  await page.waitForTimeout(3000);
  console.log('URL después de click Continuar:', page.url());
  await page.screenshot({ path: './data/debug-02-after-email.png', fullPage: true });

  // Step 3: Check if password field appeared
  const passVisible2 = await page.locator('#password').isVisible().catch(() => false);
  console.log({ passVisible2 });

  if (passVisible2) {
    await page.fill('#password', 'Atencioncita123@xx?');
    await page.waitForTimeout(300);
    await page.locator('#submit').first().click();
    await page.waitForTimeout(5000);
    console.log('URL después de login:', page.url());
    await page.screenshot({ path: './data/debug-03-after-login.png', fullPage: true });
  }

  // Step 4: Go to orders page
  await page.goto('https://sellercenter.falabella.com/order/invoice#/purchased-order-list', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(5000);
  console.log('URL orders page:', page.url());
  await page.screenshot({ path: './data/debug-04-orders.png', fullPage: true });

  // Log page title and body snippet
  const pageInfo = await page.evaluate(() => ({
    title: document.title,
    url: location.href,
    bodySnippet: document.body ? document.body.innerText.substring(0, 1000) : 'NO BODY',
    tables: document.querySelectorAll('table').length,
    trCount: document.querySelectorAll('tr').length,
  }));
  console.log('PAGE INFO:', pageInfo);

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
