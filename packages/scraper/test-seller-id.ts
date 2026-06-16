import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  });
  const page = await context.newPage();

  // Login
  await page.goto('https://sellercenter.falabella.com/user/auth/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.fill('#email', 'atencion@limbo.pe');
  await page.locator('#submit').click();
  await page.waitForTimeout(8000);
  await page.fill('#password', 'Atencioncita123@xx?');
  await page.locator('#login').click();
  await page.waitForTimeout(10000);

  // Go to homepage and dump ALL data
  await page.goto('https://sellercenter.falabella.com/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);

  // Extract seller ID from various sources
  const sellerInfo = await page.evaluate(() => {
    const sources: any = {};
    // Next.js data
    const nextData = (window as any).__NEXT_DATA__;
    if (nextData) sources.__NEXT_DATA__ = JSON.stringify(nextData.props?.pageProps).substring(0, 500);
    // Redux/Zustand stores
    const root = (window as any).__REDUX_STORE__ || (window as any).__ZUSTAND_STORE__;
    // Window vars
    sources.windowKeys = Object.keys(window).filter(k => 
      k.toLowerCase().includes('seller') || k.toLowerCase().includes('store') || k.toLowerCase().includes('user')
    );
    // Session/Local storage keys
    sources.localStorageKeys = Object.keys(localStorage).filter(k => 
      k.toLowerCase().includes('seller') || k.toLowerCase().includes('store') || k.toLowerCase().includes('user') || k.toLowerCase().includes('auth')
    );
    sources.sessionStorageKeys = Object.keys(sessionStorage).filter(k => 
      k.toLowerCase().includes('seller') || k.toLowerCase().includes('store') || k.toLowerCase().includes('user') || k.toLowerCase().includes('auth')
    );
    // URL path
    sources.pathname = location.pathname;
    // Cookies
    sources.cookies = document.cookie.substring(0, 500);
    return sources;
  });
  console.log('Seller info:', JSON.stringify(sellerInfo, null, 2));

  // Check localStorage values
  const lsValues = await page.evaluate(() => {
    const vals: any = {};
    for (const k of Object.keys(localStorage)) {
      try { vals[k] = localStorage.getItem(k)?.substring(0, 200); } catch {}
    }
    return vals;
  });
  console.log('\nlocalStorage:', JSON.stringify(lsValues, null, 2));

  // Capture API responses from homepage
  const apiResponses: any[] = [];
  page.on('response', async resp => {
    if (resp.url().includes('/s/') && resp.status() === 200) {
      try {
        const ct = resp.headers()['content-type'] || '';
        if (ct.includes('json')) {
          const body = await resp.text();
          apiResponses.push({ url: resp.url(), body: body.substring(0, 500) });
        }
      } catch {}
    }
  });

  // Reload homepage to capture API calls
  await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(10000);

  console.log('\nAPI responses:');
  apiResponses.forEach(r => {
    console.log(`  ${r.url}`);
    console.log(`  ${r.body}`);
  });

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
