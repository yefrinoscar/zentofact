import { join } from 'path';
import { createBrowser, ensureAuthenticated, saveAuthState } from './src/browser';
import { extractPendingOrders, getProfile } from './src/falabella';
import type { ScraperConfig } from './src/types';

async function main() {
  const config: ScraperConfig = {
    sellerUrl: 'https://sellercenter.falabella.com/order/invoice#/purchased-order-list',
    username: 'atencion@limbo.pe',
    password: 'Atencioncita123@xx?',
    headless: false,
    outputDir: './data',
    authStatePath: join(process.env.HOME!, '.zentofact', 'falabella-session.json'),
  };

  const profile = getProfile();

  console.log('[test] Abriendo navegador...');
  const { browser, context, page } = await createBrowser(config);

  try {
    console.log('[test] Verificando sesión...');
    await ensureAuthenticated(page, config, profile);
    await saveAuthState(context, config.authStatePath!);
    console.log('[test] Autenticado. Buscando órdenes sin documento...');
    console.log('[test] (Observa el navegador - si aparece el modal de "experiencia de carga", debería cerrarse solo)');

    const result = await extractPendingOrders(page, config, profile);
    console.log(`[test] Resultado: ${result.orders.length} pendientes, ${result.totalReviewed} revisadas, ${result.errors.length} errores`);

    if (result.errors.length > 0) {
      for (const err of result.errors) {
        console.log(`  [ERROR] p${err.page}: ${err.reason}`);
      }
    }

    if (result.orders.length > 0) {
      console.log('[test] Primeras órdenes:');
      for (const o of result.orders.slice(0, 5)) {
        console.log(`  - ${o.orderNumber} | ${o.clientName || 'sin nombre'} | S/ ${o.total}`);
      }
    }

    console.log('[test] ÉXITO - el paso "Buscar órdenes sin documento" completó sin problemas de modal.');
  } catch (e: any) {
    console.error('[test] FALLÓ:', e.message);
  } finally {
    await browser.close();
    console.log('[test] Navegador cerrado.');
  }
}

main();
