const { chromium } = require('playwright');
const { attachModalDismissal, dismissBlockingUi } = require('./dist/browser.js');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  await attachModalDismissal(page);

  await page.setContent(`
    <!doctype html>
    <html>
      <body>
        <button id="target" style="margin-top:120px;width:240px;height:48px">Cargar documento</button>
        <script>
          window.__clicked = 0;
          document.getElementById('target').addEventListener('click', () => {
            window.__clicked += 1;
          });

          setTimeout(() => {
            const backdrop = document.createElement('div');
            backdrop.className = 'ant-modal-mask';
            backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9998;';
            document.body.appendChild(backdrop);

            const wrap = document.createElement('div');
            wrap.className = 'settlement-invoice-modal-wrap';
            wrap.setAttribute('role', 'dialog');
            wrap.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;';
            wrap.innerHTML = \`
              <div class="settlement-invoice-modal-content" style="background:#fff;padding:24px;width:560px">
                <button class="close" aria-label="Cerrar">x</button>
                <p>Qué te parece la experiencia de carga de documentos tributarios?</p>
                <p>Cuéntanos qué opinas del proceso de carga de documentos tributarios.</p>
                <button class="settlement-invoice-btn settlement-invoice-btn-color-default settlement-invoice-btn-variant-outlined">Cancelar</button>
                <button>Enviar</button>
              </div>
            \`;
            document.body.appendChild(wrap);
          }, 300);
        </script>
      </body>
    </html>
  `);

  await page.waitForTimeout(1200);
  await dismissBlockingUi(page);

  const button = page.locator('#target');
  await button.click({ timeout: 5000 });

  const result = await page.evaluate(() => ({
    clicked: window.__clicked,
    surveyVisible: /que te parece la experiencia de carga|qué te parece la experiencia de carga|cuentanos qué opinas|cuéntanos qué opinas/i.test(document.body.innerText),
    hiddenModalCount: document.querySelectorAll('[data-boletas-hidden-modal="true"]').length,
  }));

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
