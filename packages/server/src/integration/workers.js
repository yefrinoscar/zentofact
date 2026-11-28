// Workers de la integración de tiendas. Cada uno corre en su propio intervalo,
// nunca se solapa consigo mismo y no tumba el proceso si falla una vuelta.
import { processDeliveries } from './deliveries.js';
import { enqueueAlwaysEmissions, processDocumentCommands } from './document-jobs.js';
import { flushInventoryChanges, reconcileIntegrationDocuments } from './events.js';

const log = (...args) => console.log('[integracion]', ...args);

function loop(name, intervalMs, work) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await work();
    } catch (error) {
      log(`${name} error:`, error?.message || error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => { tick().catch(() => {}); }, intervalMs);
  timer.unref?.();
  setTimeout(() => { tick().catch(() => {}); }, 5_000).unref?.();
  return timer;
}

export function integrationWorkersEnabled(env = process.env) {
  return String(env.INTEGRATION_WORKERS_ENABLED ?? 'true').trim().toLowerCase() !== 'false';
}

export function startIntegrationWorkers() {
  if (!integrationWorkersEnabled()) {
    log('workers apagados (INTEGRATION_WORKERS_ENABLED=false).');
    return [];
  }
  const timers = [
    loop('webhooks', 2_000, () => processDeliveries()),
    loop('inventario', 5_000, () => flushInventoryChanges()),
    loop('comprobantes', 30_000, () => reconcileIntegrationDocuments()),
    loop('emisión', 20_000, async () => {
      await enqueueAlwaysEmissions((await import('@zentofact/core')).pool);
      await processDocumentCommands();
    }),
  ];
  log('activo: webhooks 2s, inventario 5s, comprobantes 30s, emisión/NC 20s.');
  return timers;
}
