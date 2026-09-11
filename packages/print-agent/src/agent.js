const POLL_MS = 3_000;

export function parseArgs(argv, env = process.env) {
  const args = { command: 'run' };
  const rest = [...argv];
  const first = rest[0];
  if (first === 'install-login' || first === 'list-printers') {
    args.command = first;
    rest.shift();
  }
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    const next = rest[index + 1];
    if (token === '--api' && next) { args.api = next; index += 1; }
    else if (token === '--token' && next) { args.token = next; index += 1; }
    else if (token === '--printer' && next) { args.printer = next; index += 1; }
    else if (token === '--dry-run') args.dryRun = true;
    else if (token === '--once') args.once = true;
  }
  args.api = String(args.api || env.ZENTOFACT_API_URL || '').replace(/\/$/, '');
  args.token = String(args.token || env.ZENTOFACT_PRINT_TOKEN || '');
  args.printer = String(args.printer || env.ZENTOFACT_PRINTER || '');
  return args;
}

export async function requestNext(config, fetchImpl = fetch) {
  const response = await fetchImpl(`${config.api}/print-jobs/next`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.token}`,
      'content-type': 'application/json',
    },
    body: '{}',
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

export async function requestAck(config, payload, fetchImpl = fetch) {
  const response = await fetchImpl(`${config.api}/print-jobs/ack`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${response.status}`);
  }
}

export async function requestFail(config, payload, fetchImpl = fetch) {
  const response = await fetchImpl(`${config.api}/print-jobs/fail`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${response.status}`);
  }
}

export async function runOnce(config, dependencies = {}) {
  const next = dependencies.requestNext || requestNext;
  const ack = dependencies.requestAck || requestAck;
  const fail = dependencies.requestFail || requestFail;
  const printPdf = dependencies.printPdf;
  const log = dependencies.log || ((...args) => console.log('[print-agent]', ...args));
  const batch = await next(config, dependencies.fetch);
  if (batch.kind !== 'print' || !batch.base64) {
    log('escuchando', batch.reason || 'wait', `pendientes=${batch.pendingCount || 0}`);
    return { ...batch, printed: false };
  }
  try {
    await printPdf({
      pdf: batch.base64,
      printer: config.printer,
      filename: batch.filename,
      dryRun: config.dryRun === true,
    });
    await ack(config, { batchId: batch.batchId, orderIds: batch.orderIds }, dependencies.fetch);
    log('impreso', batch.reason, `pedidos=${batch.orderIds.length}`, `páginas=${batch.pages || '?'}`);
    return { ...batch, printed: true };
  } catch (error) {
    await fail(config, { batchId: batch.batchId, error: error.message }, dependencies.fetch).catch(() => {});
    log('error', error.message);
    throw error;
  }
}

export async function listen(config, dependencies = {}) {
  const sleep = dependencies.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const log = dependencies.log || ((...args) => console.log('[print-agent]', ...args));
  log('arrancó, esperando al API', config.api);
  let listening = false;
  for (;;) {
    try {
      const result = await runOnce(config, dependencies);
      if (!listening) {
        listening = true;
        log('conectado, imprime cuando haya 4 etiquetas o pase una hora');
      }
      if (config.once) return result;
      await sleep(Number(result.waitMs) > 0 ? result.waitMs : POLL_MS);
    } catch (error) {
      if (config.once) throw error;
      log('reintento', error.message);
      await sleep(POLL_MS);
    }
  }
}
