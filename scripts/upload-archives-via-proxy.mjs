// Sube los XML/CDR locales (mayo, etc.) a R2 a través del Worker proxy.
// PDFs excluidos. Reachable donde el endpoint S3 de R2 está bloqueado.
//
// Uso (tras desplegar el Worker y poner R2_PROXY_URL / R2_PROXY_SECRET en .env):
//   node scripts/upload-archives-via-proxy.mjs
//   (opcional) STORAGE_PATH=storage
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_PATH = process.env.STORAGE_PATH ||
  path.join(__dirname, '..', 'storage');

const URL_BASE = (process.env.R2_PROXY_URL || '').replace(/\/+$/, '');
const SECRET = process.env.R2_PROXY_SECRET;
if (!URL_BASE || !SECRET) {
  console.error('Faltan R2_PROXY_URL y/o R2_PROXY_SECRET en el .env');
  process.exit(1);
}

const PREFIXES = [
  'boletas/xml', 'boletas/cdr',
  'notas-credito/xml', 'notas-credito/cdr',
  'resumenes/xml', 'resumenes/cdr',
];

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const ctype = (f) => f.endsWith('.xml') ? 'application/xml' : f.endsWith('.zip') ? 'application/zip' : 'application/octet-stream';
const keyUrl = (key) => `${URL_BASE}/${key.split('/').map(encodeURIComponent).join('/')}`;
const isArchiveFile = (f) => f.endsWith('.xml') || f.endsWith('.zip');

const files = [];
for (const prefix of PREFIXES) {
  for (const f of walk(path.join(STORAGE_PATH, prefix))) {
    if (!isArchiveFile(f)) continue;
    files.push({ f, key: path.relative(STORAGE_PATH, f).split(path.sep).join('/') });
  }
}

console.log(`Encontrados ${files.length} archivos en ${STORAGE_PATH}`);

// Pre-check de conexión al Worker sin crear objetos en R2.
try {
  const probe = await fetch(`${URL_BASE}/_conn-test/probe.txt`, {
    method: 'HEAD',
    headers: { authorization: `Bearer ${SECRET}` },
  });
  if (![200, 404].includes(probe.status)) { console.error(`El Worker respondió ${probe.status}. Revisa URL/secret.`); process.exit(2); }
  console.log('Conexión al Worker OK ✓\n');
} catch (e) {
  console.error('No se pudo conectar al Worker:', e.message);
  process.exit(2);
}

let done = 0, failed = 0;
const CONCURRENCY = 16;
for (let i = 0; i < files.length; i += CONCURRENCY) {
  const batch = files.slice(i, i + CONCURRENCY);
  await Promise.all(batch.map(async ({ f, key }) => {
    try {
      const res = await fetch(keyUrl(key), {
        method: 'PUT',
        headers: { authorization: `Bearer ${SECRET}`, 'content-type': ctype(f) },
        body: fs.readFileSync(f),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      done++;
    } catch (err) {
      failed++;
      console.error(`  FAIL ${key}: ${err.message}`);
    }
  }));
  process.stdout.write(`\r  ${done + failed}/${files.length} (${failed} fallos)`);
}
console.log(`\n\nListo. Subidos: ${done}, fallos: ${failed}.`);
process.exit(failed ? 1 : 0);
