// One-time backfill: upload existing XML/CDR archives from local storage to R2.
// PDFs are intentionally skipped (they stay local / are regenerated on demand).
//
// Usage (after creating the R2 bucket + token):
//   R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET=zentofact \
//   node scripts/upload-archives-to-r2.mjs
//   (optional) STORAGE_PATH=packages/desktop/storage
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

const __dirname = dirname();
function dirname() { return path.dirname(fileURLToPath(import.meta.url)); }

const STORAGE_PATH = process.env.STORAGE_PATH ||
  path.join(__dirname, '..', 'packages', 'desktop', 'storage');

for (const v of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) {
  if (!process.env[v]) { console.error(`Missing env var: ${v}`); process.exit(1); }
}

// Only these prefixes (XML + CDR). PDFs excluded.
const PREFIXES = [
  'boletas/xml', 'boletas/cdr',
  'notas-credito/xml', 'notas-credito/cdr',
  'resumenes/xml', 'resumenes/cdr',
];

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const bucket = process.env.R2_BUCKET;

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function contentType(file) {
  if (file.endsWith('.xml')) return 'application/xml';
  if (file.endsWith('.zip')) return 'application/zip';
  return 'application/octet-stream';
}

// Pre-flight: probar que R2 es alcanzable antes de intentar 1000+ subidas.
console.log('Probando conexión a R2...');
try {
  const k = `_conn-test/${Date.now()}.txt`;
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: k, Body: 'ok', ContentType: 'text/plain' }));
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: k }));
  console.log('Conexión a R2 OK ✓\n');
} catch (err) {
  const net = /EPROTO|handshake|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET/i.test(err.message);
  console.error('\n✗ No se pudo conectar a R2:', err.message, '\n');
  if (net) {
    console.error('Esto es un BLOQUEO DE RED (TLS/SNI), no un problema de credenciales.');
    console.error('Tu red filtra los subdominios *.r2.cloudflarestorage.com.');
    console.error('Opciones: usar otra red (datos del celular/hotspot), una VPN,');
    console.error('o cambiar de almacenamiento (guardar los XML/CDR en Neon).');
  } else {
    console.error('Revisa las credenciales R2_* en el .env.');
  }
  process.exit(2);
}

const files = [];
for (const prefix of PREFIXES) {
  for (const f of walk(path.join(STORAGE_PATH, prefix))) {
    const key = path.relative(STORAGE_PATH, f).split(path.sep).join('/');
    files.push({ f, key });
  }
}

console.log(`Found ${files.length} archive(s) under ${STORAGE_PATH}`);
console.log(`Uploading to R2 bucket "${bucket}"...\n`);

let done = 0, failed = 0;
const CONCURRENCY = 16;
for (let i = 0; i < files.length; i += CONCURRENCY) {
  const batch = files.slice(i, i + CONCURRENCY);
  await Promise.all(batch.map(async ({ f, key }) => {
    try {
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: fs.readFileSync(f),
        ContentType: contentType(f),
      }));
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
