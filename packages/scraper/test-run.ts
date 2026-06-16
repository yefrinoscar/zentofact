import { FalabellaWorkflow } from './src/workflow';

async function main() {
  const wf = new FalabellaWorkflow({
    sellerUrl: 'https://sellercenter.falabella.com/order/invoice#/purchased-order-list',
    username: 'atencion@limbo.pe',
    password: 'Atencioncita123@xx?',
    headless: true,
    slowMo: 0,
    outputDir: './data',
  });

  console.log('Empresa: LIMBO PERU S.R.L.\n');

  console.log('=== PREVIEW ===');
  console.log(wf.getPreview());

  console.log('\n=== PASO 1: abrirNavegador ===');
  const r1 = await wf.abrirNavegador();
  console.log(r1);
  console.log('State:', wf.getState());

  if (!r1.success) {
    console.log('FALLÓ — esperando 30s para que veas la pantalla...');
    await new Promise(r => setTimeout(r, 30000));
    await wf.cleanup();
    return;
  }

  console.log('\n=== PASO 2: loginFalabella ===');
  const rLogin = await wf.loginFalabella();
  console.log(rLogin);
  console.log('State:', wf.getState());

  if (!rLogin.success) {
    console.log('FALLÓ — esperando 30s para que veas la pantalla...');
    await new Promise(r => setTimeout(r, 30000));
    await wf.cleanup();
    return;
  }

  console.log('\n=== PASO 3: filtrarVentasPendientes ===');
  const r2 = await wf.filtrarVentasPendientes();
  console.log(r2);
  console.log('State:', wf.getState());

  console.log('\nEsperando 10s para que veas...');
  await new Promise(r => setTimeout(r, 10000));

  await wf.cleanup();
}

main().catch(console.error);
