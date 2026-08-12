import { finiteNumber, httpError, jsonObject, loadCore, mapListing, positiveInt, text } from './utils.js';

const LISTING_STATUSES = ['active', 'inactive', 'unlinked'];

function channelCode(value) {
  const normalized = text(value, 'channelCode', 50).toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,49}$/.test(normalized)) throw httpError('channelCode inválido.');
  return normalized;
}

function status(value, fallback = 'active') {
  const normalized = String(value ?? fallback).trim().toLowerCase();
  if (!LISTING_STATUSES.includes(normalized)) throw httpError('status inválido.');
  return normalized;
}

function optionalQuantity(value) {
  return value === undefined || value === null || value === ''
    ? null
    : finiteNumber(value, 'marketplaceQuantity');
}

async function validateRelations(db, productId, companyId, accountId) {
  const result = await db.query(
    `select
       exists(select 1 from products where id=$1) as product_exists,
       exists(select 1 from companies where id=$2 and activo is not false) as company_exists,
       case when $3::bigint is null then true else exists(
         select 1 from order_channel_accounts where id=$3 and company_id=$2 and active=true
       ) end as account_exists`,
    [productId, companyId, accountId],
  );
  const row = result.rows[0];
  if (!row?.product_exists) throw httpError('Producto no encontrado.', 404);
  if (!row?.company_exists) throw httpError('Empresa no encontrada o inactiva.', 400);
  if (!row?.account_exists) throw httpError('La cuenta de canal no pertenece a la empresa o está inactiva.', 400);
}

export async function listProductListings(productId, db) {
  const target = db || (await loadCore()).pool;
  const result = await target.query(
    `select l.*, coalesce(nullif(c.nombre_comercial, ''), nullif(c.nombre, ''), c.razon_social) as company_name
     from product_listings l join companies c on c.id=l.company_id
     where l.product_id=$1 order by l.status='active' desc, l.channel_code, company_name, l.id`,
    [positiveInt(productId, 'productId')],
  );
  return result.rows.map(mapListing);
}

export async function createListing(productIdInput, input, db) {
  const target = db || (await loadCore()).pool;
  const productId = positiveInt(productIdInput, 'productId');
  const companyId = positiveInt(input.companyId, 'companyId');
  const accountId = input.channelAccountId ? positiveInt(input.channelAccountId, 'channelAccountId') : null;
  const code = channelCode(input.channelCode);
  const sellerSku = text(input.sellerSku, 'sellerSku', 300);
  await validateRelations(target, productId, companyId, accountId);
  try {
    const result = await target.query(
      `insert into product_listings (
         product_id, channel_code, company_id, channel_account_id, seller_sku, shop_sku,
         external_product_id, title, status, marketplace_quantity, marketplace_synced_at, metadata
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       returning *`,
      [
        productId,
        code,
        companyId,
        accountId,
        sellerSku,
        text(input.shopSku, 'shopSku', 300, { nullable: true }),
        text(input.externalProductId, 'externalProductId', 500, { nullable: true }),
        text(input.title, 'title', 1000, { nullable: true }),
        status(input.status),
        optionalQuantity(input.marketplaceQuantity),
        input.marketplaceSyncedAt || null,
        JSON.stringify(jsonObject(input.metadata)),
      ],
    );
    return mapListing(result.rows[0]);
  } catch (error) {
    if (error?.code === '23505') {
      throw httpError('Ese seller SKU ya está vinculado para el canal y la empresa.', 409, 'duplicate_listing');
    }
    throw error;
  }
}

export async function upsertListing(productIdInput, input, db) {
  const target = db || (await loadCore()).pool;
  const productId = positiveInt(productIdInput, 'productId');
  const companyId = positiveInt(input.companyId, 'companyId');
  const accountId = input.channelAccountId ? positiveInt(input.channelAccountId, 'channelAccountId') : null;
  const code = channelCode(input.channelCode);
  const sellerSku = text(input.sellerSku, 'sellerSku', 300);
  await validateRelations(target, productId, companyId, accountId);
  const result = await target.query(
    `insert into product_listings (
       product_id, channel_code, company_id, channel_account_id, seller_sku, shop_sku,
       external_product_id, title, status, marketplace_quantity, marketplace_synced_at, metadata
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9,$10,$11)
     on conflict (channel_code, company_id, seller_sku) do update set
       product_id=excluded.product_id,
       channel_account_id=coalesce(excluded.channel_account_id, product_listings.channel_account_id),
       shop_sku=coalesce(excluded.shop_sku, product_listings.shop_sku),
       external_product_id=coalesce(excluded.external_product_id, product_listings.external_product_id),
       title=coalesce(excluded.title, product_listings.title),
       status='active', marketplace_quantity=excluded.marketplace_quantity,
       marketplace_synced_at=excluded.marketplace_synced_at,
       metadata=product_listings.metadata || excluded.metadata, updated_at=now()
     returning *`,
    [
      productId, code, companyId, accountId, sellerSku,
      text(input.shopSku, 'shopSku', 300, { nullable: true }),
      text(input.externalProductId, 'externalProductId', 500, { nullable: true }),
      text(input.title, 'title', 1000, { nullable: true }),
      optionalQuantity(input.marketplaceQuantity),
      input.marketplaceSyncedAt || null,
      JSON.stringify(jsonObject(input.metadata)),
    ],
  );
  return mapListing(result.rows[0]);
}

export async function updateListing(idInput, input, db) {
  const target = db || (await loadCore()).pool;
  const id = positiveInt(idInput, 'listingId');
  const existing = (await target.query('select * from product_listings where id=$1', [id])).rows[0];
  if (!existing) throw httpError('Listing no encontrado.', 404);
  const productId = input.productId === undefined ? Number(existing.product_id) : positiveInt(input.productId, 'productId');
  const companyId = input.companyId === undefined ? Number(existing.company_id) : positiveInt(input.companyId, 'companyId');
  const accountId = input.channelAccountId === undefined
    ? existing.channel_account_id
    : input.channelAccountId ? positiveInt(input.channelAccountId, 'channelAccountId') : null;
  await validateRelations(target, productId, companyId, accountId);
  const result = await target.query(
    `update product_listings set
       product_id=$1, channel_code=$2, company_id=$3, channel_account_id=$4,
       seller_sku=$5, shop_sku=$6, external_product_id=$7, title=$8, status=$9,
       marketplace_quantity=$10, marketplace_synced_at=$11, metadata=$12, updated_at=now()
     where id=$13 returning *`,
    [
      productId,
      input.channelCode === undefined ? existing.channel_code : channelCode(input.channelCode),
      companyId,
      accountId,
      input.sellerSku === undefined ? existing.seller_sku : text(input.sellerSku, 'sellerSku', 300),
      input.shopSku === undefined ? existing.shop_sku : text(input.shopSku, 'shopSku', 300, { nullable: true }),
      input.externalProductId === undefined ? existing.external_product_id : text(input.externalProductId, 'externalProductId', 500, { nullable: true }),
      input.title === undefined ? existing.title : text(input.title, 'title', 1000, { nullable: true }),
      input.status === undefined ? existing.status : status(input.status),
      input.marketplaceQuantity === undefined ? existing.marketplace_quantity : optionalQuantity(input.marketplaceQuantity),
      input.marketplaceSyncedAt === undefined ? existing.marketplace_synced_at : input.marketplaceSyncedAt,
      JSON.stringify(input.metadata === undefined ? existing.metadata : jsonObject(input.metadata)),
      id,
    ],
  );
  return mapListing(result.rows[0]);
}

export function unlinkListing(id, db) {
  return updateListing(id, { status: 'unlinked' }, db);
}

export async function linkListing(input, db) {
  if (input.listingId) return updateListing(input.listingId, { productId: input.productId, status: 'active' }, db);
  return createListing(input.productId, input, db);
}
