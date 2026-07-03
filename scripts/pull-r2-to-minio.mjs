// Réplica de objetos R2 (prod, vía Worker proxy) → MinIO local (S3).
// Enumera las keys (xml_path/cdr_path) desde la BD LOCAL ya replicada.
// Idempotente (salta lo que ya está en MinIO) y resumible.
//
// Env requeridas:
//   LOCAL_DB_URL          postgres local (réplica)
//   SRC_R2_PROXY_URL      Worker proxy de R2 prod
//   SRC_R2_PROXY_SECRET   secreto del proxy
//   MINIO_ENDPOINT        http://localhost:9100
//   MINIO_KEY / MINIO_SECRET / MINIO_BUCKET
// Opcional: PULL_CONCURRENCY (def 8), PULL_LIMIT (máx keys)
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import pg from 'pg';

const {
  LOCAL_DB_URL, SRC_R2_PROXY_URL, SRC_R2_PROXY_SECRET,
  MINIO_ENDPOINT = 'http://localhost:9100', MINIO_KEY = 'zentofact', MINIO_SECRET = 'zentofact123',
  MINIO_BUCKET = 'zunat', PULL_CONCURRENCY = '8', PULL_LIMIT,
} = process.env;

if (!LOCAL_DB_URL || !SRC_R2_PROXY_URL || !SRC_R2_PROXY_SECRET) {
  console.error('Faltan env: LOCAL_DB_URL, SRC_R2_PROXY_URL, SRC_R2_PROXY_SECRET'); process.exit(1);
}

const s3 = new S3Client({ region: 'us-east-1', endpoint: MINIO_ENDPOINT, forcePathStyle: true,
  credentials: { accessKeyId: MINIO_KEY, secretAccessKey: MINIO_SECRET } });
const pool = new pg.Pool({ connectionString: LOCAL_DB_URL });

const proxyBase = SRC_R2_PROXY_URL.replace(/\/+$/, '');
const proxyUrl = (key) => `${proxyBase}/${key.split('/').map(encodeURIComponent).join('/')}`;

async function existsInMinio(key) {
  try { await s3.send(new HeadObjectCommand({ Bucket: MINIO_BUCKET, Key: key })); return true; } catch { return false; }
}
function contentTypeFor(key) {
  if (key.endsWith('.xml')) return 'application/xml';
  if (key.endsWith('.zip')) return 'application/zip';
  if (key.endsWith('.pdf')) return 'application/pdf';
  return 'application/octet-stream';
}

async function collectKeys() {
  // Tablas que tienen columnas xml_path / cdr_path.
  const cols = (await pool.query(
    `select table_name, column_name from information_schema.columns
     where column_name in ('xml_path','cdr_path') and table_schema='public'`)).rows;
  const byTable = new Map();
  for (const { table_name, column_name } of cols) {
    if (!byTable.has(table_name)) byTable.set(table_name, []);
    byTable.get(table_name).push(column_name);
  }
  const keys = new Set();
  for (const [table, columns] of byTable) {
    const parts = columns.map((c) => `select ${c} as k from ${table} where ${c} is not null and ${c} <> ''`);
    const rows = (await pool.query(parts.join(' union '))).rows;
    for (const r of rows) if (r.k) keys.add(String(r.k));
  }
  return [...keys];
}

async function run() {
  let keys = await collectKeys();
  if (PULL_LIMIT) keys = keys.slice(0, Number(PULL_LIMIT));
  console.log(`Keys a replicar: ${keys.length}`);
  let done = 0, copied = 0, skipped = 0, missing = 0, failed = 0;
  const conc = Number(PULL_CONCURRENCY);
  let idx = 0;
  async function worker() {
    while (idx < keys.length) {
      const key = keys[idx++];
      try {
        if (await existsInMinio(key)) { skipped++; }
        else {
          const res = await fetch(proxyUrl(key), { headers: { authorization: `Bearer ${SRC_R2_PROXY_SECRET}` } });
          if (res.status === 404) { missing++; }
          else if (!res.ok) { failed++; }
          else {
            const buf = Buffer.from(await res.arrayBuffer());
            await s3.send(new PutObjectCommand({ Bucket: MINIO_BUCKET, Key: key, Body: buf, ContentType: contentTypeFor(key) }));
            copied++;
          }
        }
      } catch (e) { failed++; }
      if (++done % 100 === 0 || done === keys.length) {
        console.log(`  ${done}/${keys.length} · copiados=${copied} saltados=${skipped} faltantes=${missing} fallos=${failed}`);
      }
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));
  console.log(`Listo. copiados=${copied} saltados=${skipped} faltantes=${missing} fallos=${failed}`);
  await pool.end();
  process.exit(0);
}
run().catch((e) => { console.error(e); process.exit(1); });
