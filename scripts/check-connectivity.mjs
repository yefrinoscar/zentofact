// Diagnóstico de red: prueba desde ESTA máquina qué servicios son alcanzables.
// Correr en tu Terminal:  node scripts/check-connectivity.mjs
import 'dotenv/config';
import { Client } from 'pg';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

function line(name, ok, detail) {
  console.log(`  ${ok ? '✅' : '❌'}  ${name.padEnd(28)} ${detail}`);
}

console.log('\n=== Diagnóstico de conectividad (desde tu red) ===\n');

// 1) Neon Postgres — la base de datos de la app
let neonOk = false;
if (!process.env.DATABASE_URL_POSTGRES) {
  line('Neon Postgres', false, 'falta DATABASE_URL_POSTGRES en .env');
} else {
  const c = new Client({ connectionString: process.env.DATABASE_URL_POSTGRES });
  try {
    await c.connect();
    const r = await c.query('select count(*)::int as n from companies');
    neonOk = true;
    line('Neon Postgres', true, `conecta OK (${r.rows[0].n} empresas)`);
  } catch (e) {
    line('Neon Postgres', false, e.message);
  } finally {
    try { await c.end(); } catch {}
  }
}

// 2) Cloudflare R2 — almacenamiento de XML/CDR
let r2Ok = false;
const haveR2 = ['R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET'].every(k => process.env[k]);
if (!haveR2) {
  line('Cloudflare R2', false, 'faltan variables R2_* en .env');
} else {
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
  });
  try {
    const k = `_conn-test/${Date.now()}.txt`;
    await s3.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: k, Body: 'ok' }));
    await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: k }));
    r2Ok = true;
    line('Cloudflare R2', true, 'sube/borra OK');
  } catch (e) {
    const net = /EPROTO|handshake|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET/i.test(e.message);
    line('Cloudflare R2', false, (net ? 'BLOQUEO DE RED — ' : '') + e.message);
  }
}

console.log('\n=== Resultado ===');
if (neonOk && r2Ok) {
  console.log('Todo alcanzable. Puedes correr: npm run r2:backfill');
} else if (neonOk && !r2Ok) {
  console.log('Neon SÍ funciona, R2 NO. Recomendado: guardar los XML/CDR dentro de Neon');
  console.log('(son ~12 MB, caben de sobra y no necesitas R2).');
} else if (!neonOk) {
  console.log('OJO: Neon NO es alcanzable desde tu red. La app NO funcionaría así.');
  console.log('Hay que revisar tu red/firewall o reconsiderar el hosting de la DB.');
}
console.log('');
process.exit(0);
