import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Capture console errors
  const consoleErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(err.message));

  await page.addInitScript(() => {
    const kill = () => {
      document.querySelectorAll('[role="dialog"], .modal, .swal2-container, [class*="modal"], [class*="popup"], [class*="overlay"]')
        .forEach((el: any) => { el.style.display = 'none'; });
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

  // Try clicking through nav instead of direct URL
  console.log('Trying nav click...');
  await page.goto('https://sellercenter.falabella.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  console.log('Home URL:', page.url());

  // Find "Documentos tributarios" or "Órdenes" link and click
  const navLinks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a')).map(a => ({
      text: a.textContent?.trim(),
      href: a.href,
    })).filter(l => l.text && (l.text.includes('Documento') || l.text.includes('Orden') || l.text.includes('Invoice') || l.text.includes('factura') || l.text.includes('boleta')));
  });
  console.log('Nav links:', navLinks);

  // Try clicking Ordenes in nav
  try {
    const ordenesLink = page.locator('a:has-text("Órdenes"), a:has-text("Ordenes"), a:has-text("Orders")').first();
    if (await ordenesLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await ordenesLink.hover();
      await page.waitForTimeout(500);
      await page.screenshot({ path: './data/nav-hover.png', fullPage: true });
      
      // Look for submenu
      const submenu = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.dropdown-menu a, .submenu a, [class*="submenu"] a, [class*="dropdown"] a'))
          .map(a => ({ text: a.textContent?.trim(), href: a.href }));
      });
      console.log('Submenu:', submenu);
    }
  } catch (e) {
    console.log('Nav click error:', (e as Error).message);
  }

  console.log('\nConsole errors:', consoleErrors);

  await page.screenshot({ path: './data/nav-debug.png', fullPage: true });
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
