// Copia al almacenamiento propio (proxy R2 / R2 / disco) la foto principal de
// todos los productos, para no depender de Falabella o Ripley.
//
// Fuente de cada producto, en orden:
//   1. products.image_url, si es una URL externa (https://...).
//   2. Si no tiene foto: la primera imagen de sus publicaciones activas o,
//      como último recurso, la foto de Falabella de su shop SKU.
// Ya copiados (URL /catalog/product-images/...) se saltan. La URL original se
// guarda en products.attributes.imageSourceUrl.
//
// Uso:
//   node scripts/mirror-product-images.mjs --dry-run      # solo lista lo que haría
//   node scripts/mirror-product-images.mjs                # copia y actualiza
//   node scripts/mirror-product-images.mjs --limit 20 --sku G078
// Requiere DATABASE_URL (o DATABASE_URL_POSTGRES) y las variables R2_* del API.
import 'dotenv/config';
import {
  isOwnProductImageUrl,
  storeProductImage,
} from '../packages/server/src/catalog/product-image-store.js';
import { fetchPublicProductImage } from '../packages/server/src/shipping-label-sheet.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitIndex = args.indexOf('--limit');
const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : 0;
const skuIndex = args.indexOf('--sku');
const onlySku = skuIndex >= 0 ? String(args[skuIndex + 1] || '').toUpperCase() : '';
const CONCURRENCY = 4;

const core = await import('@zentofact/core');
const { pool } = core;

const LISTING_IMAGE_SQL = `(
  select coalesce(
    nullif(l.metadata->'images'->>0, ''),
    nullif(l.metadata->'images'->0->>'Url', ''),
    nullif(l.metadata->'images'->0->>'url', ''),
    nullif(l.metadata->>'imageUrl', ''),
    case when l.channel_code='falabella' and trim(l.shop_sku) ~ '^[A-Za-z0-9_-]+$'
      then 'https://media.falabella.com/falabellaPE/' || trim(l.shop_sku) || '_01' end
  )
  from product_listings l
  where l.product_id=p.id and l.status='active'
  order by (nullif(l.metadata->'images'->>0, '') is null and nullif(l.metadata->>'imageUrl', '') is null), l.id
  limit 1
)`;

const { rows } = await pool.query(
  `select p.id, p.main_sku, nullif(trim(p.image_url), '') as image_url, ${LISTING_IMAGE_SQL} as listing_image
   from products p
   where p.status <> 'archived' and ($1 = '' or upper(p.main_sku) = $1)
   order by p.id`,
  [onlySku],
);

const pending = [];
let alreadyOwn = 0;
let withoutSource = 0;
for (const row of rows) {
  if (row.image_url && isOwnProductImageUrl(row.image_url)) { alreadyOwn += 1; continue; }
  const source = row.image_url && /^https:\/\//i.test(row.image_url) ? row.image_url : row.listing_image;
  if (!source || !/^https:\/\//i.test(source)) { withoutSource += 1; continue; }
  pending.push({ ...row, source, from: row.image_url ? 'producto' : 'publicación' });
}
const work = limit > 0 ? pending.slice(0, limit) : pending;
console.log(JSON.stringify({ products: rows.length, alreadyOwn, withoutSource, toMirror: pending.length, processing: work.length, dryRun }));

let copied = 0;
const failed = [];
let next = 0;
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, work.length) }, async () => {
  while (next < work.length) {
    const item = work[next];
    next += 1;
    if (dryRun) { console.log(`${item.main_sku}\t${item.from}\t${item.source}`); continue; }
    try {
      const { bytes } = await fetchPublicProductImage(item.source);
      const stored = await storeProductImage(item.id, bytes);
      await pool.query(
        `update products
         set image_url=$2,
             attributes=coalesce(attributes, '{}'::jsonb) || jsonb_build_object('imageSourceUrl', $3::text),
             updated_at=now()
         where id=$1`,
        [item.id, stored.url, item.source],
      );
      copied += 1;
      console.log(`ok\t${item.main_sku}\t${stored.url}`);
    } catch (error) {
      failed.push({ sku: item.main_sku, source: item.source, error: String(error?.message || error) });
      console.log(`error\t${item.main_sku}\t${String(error?.message || error)}`);
    }
  }
}));

console.log(JSON.stringify({ copied, failed: failed.length }));
if (failed.length) console.log(JSON.stringify(failed, null, 2));
await pool.end();
