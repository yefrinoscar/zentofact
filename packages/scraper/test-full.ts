import { FalabellaWorkflow } from './src/workflow';

async function main() {
  const wf = new FalabellaWorkflow({
    sellerUrl: 'https://sellercenter.falabella.com/order/invoice#/purchased-order-list',
    username: 'atencion@limbo.pe',
    password: 'Atencioncita123@xx?',
    headless: true,
    slowMo: 50,
    outputDir: './data',
    dateFrom: '2026-01-01',
    dateTo: '2026-05-08',
  });

  console.log('=== PASO 1: abrirNavegador ===');
  console.log(wf.getPreview());
  const r1 = await wf.abrirNavegador();
  console.log('Result:', r1.success ? '✅' : '❌', r1.summary);

  if (!r1.success) { await wf.cleanup(); return; }

  console.log('\n=== PASO 2: loginFalabella ===');
  console.log(wf.getPreview());
  const rLogin = await wf.loginFalabella();
  console.log('Result:', rLogin.success ? '✅' : '❌', rLogin.summary);

  if (!rLogin.success) { await wf.cleanup(); return; }

  console.log('\n=== PASO 3: filtrarVentasPendientes ===');
  console.log(wf.getPreview());
  const r2 = await wf.filtrarVentasPendientes();
  console.log('Result:', r2.success ? '✅' : '❌', r2.summary);

  if (!r2.success) { await wf.cleanup(); return; }

  console.log('\n=== PASO 4: leerDetalleVentas ===');
  console.log(wf.getPreview());
  const r3 = await wf.leerDetalleVentas();
  console.log('Result:', r3.success ? '✅' : '❌', r3.summary);

  console.log('\n=== PASO 5: exportarJson ===');
  console.log(wf.getPreview());
  const r4 = await wf.exportarJson();
  console.log('Result:', r4.success ? '✅' : '❌', r4.summary);

  console.log('\n=== PASO 6: convertirAVentaItems ===');
  console.log(wf.getPreview());
  const r5 = await wf.convertirAVentaItems();
  console.log('Result:', r5.success ? '✅' : '❌', r5.summary);

  const ventas = wf.getVentas();
  console.log(`\n✅ ${ventas.length} ventas extraídas`);
  if (ventas.length > 0) {
    console.log('Primera venta:', JSON.stringify(ventas[0], null, 2).substring(0, 500));
  }

  await wf.cleanup();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
