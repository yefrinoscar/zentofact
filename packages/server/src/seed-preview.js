// Seed idempotente para PR previews / demos locales.
// Cubre auth, usuarios de rol, sellers, catálogo, stock, listings, clientes y pedidos de muestra.
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { randomBytes } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../../.env') });

const { hashPassword } = await import('better-auth/crypto');
const { createCompany, pool, runMigrations } = await import('@zentofact/core');
const { auth } = await import('./auth.js');
const { ensureAuthSchema } = await import('./ensure-auth-schema.js');
const { adjustInventory } = await import('./catalog/inventory-service.js');
const { upsertListing } = await import('./catalog/listing-service.js');
const { createProduct } = await import('./catalog/product-service.js');
const { permissionsForRole } = await import('./permissions.js');
const { shouldSeedPreview } = await import('./preview-env.js');
const users = await import('./users.js');

const SEED_MARKER = 'preview-seed-v1';
const DEFAULT_SEED_PASSWORD = 'ZentoFactPreview123';

const SEED_USERS = [
  { email: 'operator@preview.zentofact.local', name: 'Operador Preview', role: 'operator' },
  { email: 'vendedor@preview.zentofact.local', name: 'Vendedor Preview', role: 'vendedor', commissionPercent: 5 },
  { email: 'billing@preview.zentofact.local', name: 'Facturación Preview', role: 'billing' },
];

const SEED_COMPANIES = [
  {
    ruc: '20990001001',
    nombre: 'LIMBO',
    razonSocial: 'LIMBO PERU S.R.L.',
    nombreComercial: 'LIMBO',
    direccion: 'Av. Demo 101, Lima',
    ubigeo: '150101',
    distrito: 'Lima',
    provincia: 'Lima',
    departamento: 'Lima',
    email: 'limbo@preview.zentofact.local',
    falabellaApiUserId: 'preview-limbo',
    falabellaApiKey: 'preview-limbo-key',
  },
  {
    ruc: '20990001002',
    nombre: 'MANTA RAYA',
    razonSocial: 'INVERSIONES MANTA RAYA E.I.R.L.',
    nombreComercial: 'MANTA RAYA',
    direccion: 'Av. Demo 202, Lima',
    ubigeo: '150101',
    distrito: 'Lima',
    provincia: 'Lima',
    departamento: 'Lima',
    email: 'mantaraya@preview.zentofact.local',
    falabellaApiUserId: 'preview-mantaraya',
    falabellaApiKey: 'preview-mantaraya-key',
  },
  {
    ruc: '20990001003',
    nombre: 'YAKURUNA',
    razonSocial: 'YAKURUNA SAC',
    nombreComercial: 'YAKURUNA',
    direccion: 'Av. Demo 303, Lima',
    ubigeo: '150101',
    distrito: 'Lima',
    provincia: 'Lima',
    departamento: 'Lima',
    email: 'yakuruna@preview.zentofact.local',
    falabellaApiUserId: 'preview-yakuruna',
    falabellaApiKey: 'preview-yakuruna-key',
  },
];

const SEED_PRODUCTS = [
  {
    mainSku: 'AG301',
    name: 'Coche Bastón tipo Paraguas Liviano plegable Celeste',
    brand: 'Zento',
    referencePrice: 189.9,
    stock: 12,
    listings: [
      { companyRuc: '20990001001', channelCode: 'falabella', sellerSku: 'LIMBO-AG301', title: 'Coche bastón celeste · LIMBO' },
      { companyRuc: '20990001002', channelCode: 'falabella', sellerSku: 'MR-AG301', title: 'Coche bastón celeste · MANTA RAYA' },
    ],
  },
  {
    mainSku: 'HOG025',
    name: 'Silla de comer evolutiva gris',
    brand: 'Zento',
    referencePrice: 249.0,
    stock: 8,
    listings: [
      { companyRuc: '20990001001', channelCode: 'falabella', sellerSku: 'LIMBO-HOG025', title: 'Silla evolutiva gris · LIMBO' },
      { companyRuc: '20990001003', channelCode: 'falabella', sellerSku: 'YAK-HOG025', title: 'Silla evolutiva gris · YAKURUNA' },
      { companyRuc: '20990001002', channelCode: 'ripley', sellerSku: 'S166285', title: 'Silla evolutiva gris · Ripley' },
    ],
  },
  {
    mainSku: 'BB110',
    name: 'Almohada de lactancia multifunción',
    brand: 'Zento',
    referencePrice: 79.9,
    stock: 25,
    listings: [
      { companyRuc: '20990001003', channelCode: 'falabella', sellerSku: 'YAK-BB110', title: 'Almohada lactancia · YAKURUNA' },
    ],
  },
  {
    mainSku: 'BB220',
    name: 'Set de platos antideslizantes 3 piezas',
    brand: 'Zento',
    referencePrice: 45.5,
    stock: 40,
    listings: [
      { companyRuc: '20990001001', channelCode: 'falabella', sellerSku: 'LIMBO-BB220', title: 'Set platos · LIMBO' },
      { companyRuc: '20990001002', channelCode: 'falabella', sellerSku: 'MR-BB220', title: 'Set platos · MANTA RAYA' },
    ],
  },
  {
    mainSku: 'HOG040',
    name: 'Organizador de pañales beige',
    brand: 'Zento',
    referencePrice: 59.0,
    stock: 15,
    listings: [
      { companyRuc: '20990001003', channelCode: 'falabella', sellerSku: 'YAK-HOG040', title: 'Organizador pañales · YAKURUNA' },
    ],
  },
];

function newId() {
  return randomBytes(24).toString('base64url');
}

function seedPassword(env = process.env) {
  return String(env.SEED_USER_PASSWORD || env.ADMIN_PASSWORD || DEFAULT_SEED_PASSWORD);
}

function adminCredentials(env = process.env) {
  return {
    email: String(env.ADMIN_EMAIL || env.AUTH_SUPERADMIN_EMAIL || '').trim().toLowerCase(),
    password: String(env.ADMIN_PASSWORD || '').trim() || seedPassword(env),
    name: String(env.ADMIN_NAME || 'Admin Preview').trim() || 'Admin Preview',
  };
}

async function ensureOrdersItemsColumns() {
  await pool.query(`
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS items_status TEXT NOT NULL DEFAULT 'pending';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS items_error TEXT;
  `);
}

async function ensureSeedMarkerTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS preview_seed_state (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      marker TEXT NOT NULL,
      seeded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      summary JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `);
}

async function readSeedMarker() {
  const result = await pool.query('SELECT marker, summary FROM preview_seed_state WHERE id = 1');
  return result.rows[0] || null;
}

async function writeSeedMarker(summary) {
  await pool.query(
    `INSERT INTO preview_seed_state (id, marker, seeded_at, summary)
     VALUES (1, $1, NOW(), $2::jsonb)
     ON CONFLICT (id) DO UPDATE SET marker = EXCLUDED.marker, seeded_at = NOW(), summary = EXCLUDED.summary`,
    [SEED_MARKER, JSON.stringify(summary)],
  );
}

async function ensureAdminUser(credentials) {
  if (!credentials.email || !credentials.password) {
    throw new Error('ADMIN_EMAIL y ADMIN_PASSWORD (o SEED_USER_PASSWORD) son obligatorios para el seed de preview');
  }
  process.env.AUTH_ALLOW_SIGNUP = 'true';
  try {
    await auth.api.signUpEmail({
      body: { email: credentials.email, password: credentials.password, name: credentials.name },
    });
    console.log('[SEED] Admin creado:', credentials.email);
  } catch (error) {
    const message = String(error?.message || error || '');
    if (!/already exists|existe|registered/i.test(message)) {
      console.warn('[SEED] Admin no creado:', message.slice(0, 160));
    }
  }
  await users.promoteSuperadminByEmail(credentials.email, 'system.preview-seed');
  await syncCredentialPassword(credentials.email, credentials.password);
  const listed = await users.listUsers();
  const admin = listed.find((user) => user.email === credentials.email);
  if (!admin) throw new Error(`No se pudo resolver el admin seed ${credentials.email}`);
  return admin;
}

async function syncCredentialPassword(email, password) {
  const hashed = await hashPassword(password);
  const result = await pool.query(
    `UPDATE account AS a
        SET password = $1, "updatedAt" = NOW()
      FROM "user" AS u
     WHERE a."userId" = u.id
       AND u.email = $2
       AND a."providerId" = 'credential'
     RETURNING a.id`,
    [hashed, email],
  );
  if (!result.rowCount) {
    console.warn('[SEED] No hay cuenta credential para', email);
  }
}

async function ensureRoleUser({ email, name, role, commissionPercent = 0 }, password, actorId) {
  const existing = (await users.listUsers()).find((user) => user.email === email);
  if (existing) return { user: existing, created: false };
  try {
    const user = await users.createUser({
      name,
      email,
      password,
      role,
      permissions: permissionsForRole(role),
      active: true,
      commissionPercent,
    }, actorId);
    return { user, created: true };
  } catch (error) {
    // Fallback directo si createUser falla por schema (p. ej. issuer) en Better Auth nuevo.
    const message = String(error?.message || error || '');
    console.warn(`[SEED] createUser falló para ${email} (${message.slice(0, 80)}); insert directo.`);
    const userId = newId();
    const accountId = newId();
    const now = new Date();
    const hashed = await hashPassword(password);
    await pool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", image, role, permissions, active, commission_percent, "createdAt", "updatedAt")
       VALUES ($1,$2,$3,false,null,$4,$5,true,$6,$7,$7)
       ON CONFLICT (email) DO NOTHING`,
      [userId, name, email, role, JSON.stringify(permissionsForRole(role)), commissionPercent, now],
    );
    const row = (await pool.query('SELECT id FROM "user" WHERE lower(email)=lower($1) LIMIT 1', [email])).rows[0];
    const resolvedId = row?.id || userId;
    await pool.query(
      `INSERT INTO account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
       VALUES ($1,$2,'credential',$3,$4,$5,$5)
       ON CONFLICT DO NOTHING`,
      [accountId, resolvedId, resolvedId, hashed, now],
    ).catch(async () => {
      // Better Auth ≥1.7 puede exigir issuer.
      await pool.query(
        `INSERT INTO account (id, "accountId", "providerId", "userId", issuer, password, "createdAt", "updatedAt")
         VALUES ($1,$2,'credential',$3,'local:credential',$4,$5,$5)
         ON CONFLICT DO NOTHING`,
        [accountId, resolvedId, resolvedId, hashed, now],
      );
    });
    return { user: await users.getUserById(resolvedId), created: true };
  }
}

async function ensureCompany(data) {
  const existing = await pool.query(
    'SELECT id, ruc, nombre, nombre_comercial, razon_social FROM companies WHERE ruc = $1 LIMIT 1',
    [data.ruc],
  );
  if (existing.rows[0]) {
    return {
      id: Number(existing.rows[0].id),
      ruc: existing.rows[0].ruc,
      nombre: existing.rows[0].nombre,
      nombreComercial: existing.rows[0].nombre_comercial,
      razonSocial: existing.rows[0].razon_social,
      created: false,
    };
  }
  const created = await createCompany(data);
  return { ...created, created: true };
}

async function ensureFalabellaChannelAccount(company) {
  const displayName = company.nombreComercial || company.nombre || company.razonSocial || 'Falabella';
  await pool.query(
    `INSERT INTO order_channel_accounts (
       company_id, channel_id, external_account_id, display_name,
       auto_create_orders, document_requirement, document_type_policy, settings
     )
     SELECT c.id, ch.id, 'default', $2, TRUE, 'optional', 'automatic', '{"origin":"preview_seed"}'::jsonb
     FROM companies c
     JOIN order_channels ch ON ch.code = 'falabella'
     WHERE c.id = $1
     ON CONFLICT (company_id, channel_id, external_account_id) DO NOTHING`,
    [company.id, displayName],
  );
  const account = await pool.query(
    `SELECT a.id, a.company_id, ch.code AS channel_code
     FROM order_channel_accounts a
     JOIN order_channels ch ON ch.id = a.channel_id
     WHERE a.company_id = $1 AND ch.code = 'falabella' AND a.external_account_id = 'default'
     LIMIT 1`,
    [company.id],
  );
  return account.rows[0] ? { id: Number(account.rows[0].id), companyId: Number(account.rows[0].company_id) } : null;
}

async function ensureProduct(spec, actorUserId, companiesByRuc) {
  const existing = await pool.query('SELECT id, main_sku FROM products WHERE main_sku = $1 LIMIT 1', [spec.mainSku]);
  let productId;
  let created = false;
  if (existing.rows[0]) {
    productId = Number(existing.rows[0].id);
  } else {
    const product = await createProduct({
      mainSku: spec.mainSku,
      name: spec.name,
      brand: spec.brand,
      referencePrice: spec.referencePrice,
      status: 'active',
      description: `Producto demo del seed preview (${SEED_MARKER}).`,
    }, actorUserId);
    productId = Number(product.id);
    created = true;
  }

  await adjustInventory(productId, {
    absoluteTarget: spec.stock,
    reason: `Stock inicial ${SEED_MARKER}`,
    idempotencyKey: `${SEED_MARKER}:stock:${spec.mainSku}:${spec.stock}`,
  }, actorUserId);

  const listings = [];
  for (const listing of spec.listings) {
    const company = companiesByRuc.get(listing.companyRuc);
    if (!company) continue;
    const account = await ensureFalabellaChannelAccount(company);
    const saved = await upsertListing(productId, {
      channelCode: listing.channelCode,
      companyId: company.id,
      channelAccountId: listing.channelCode === 'falabella' ? account?.id : null,
      sellerSku: listing.sellerSku,
      shopSku: listing.sellerSku,
      title: listing.title,
      status: 'active',
      marketplaceQuantity: Math.max(1, Math.floor(spec.stock / Math.max(spec.listings.length, 1))),
      metadata: { origin: SEED_MARKER },
    });
    listings.push(saved);
  }
  return { productId, mainSku: spec.mainSku, created, listings: listings.length };
}

async function ensureClients(companies) {
  let created = 0;
  const now = Math.floor(Date.now() / 1000);
  for (const company of companies) {
    const result = await pool.query(
      `INSERT INTO clients (
         company_id, tipo_documento, numero_documento, razon_social, nombre_comercial,
         direccion, ubigeo, distrito, provincia, departamento, email, activo, created_at, updated_at
       ) VALUES ($1,'1','12345678','Cliente Demo Preview','Cliente Demo',
         'Jr. Cliente 123',$2,'Lima','Lima','Lima','cliente@preview.zentofact.local',true,$3,$3)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [company.id, company.ubigeo || '150101', now],
    ).catch(async () => {
      // Sin unique constraint en clients: insertar solo si no existe el DNI demo.
      const found = await pool.query(
        `SELECT id FROM clients
         WHERE company_id = $1 AND numero_documento = '12345678' LIMIT 1`,
        [company.id],
      );
      if (found.rows[0]) return { rows: [] };
      return pool.query(
        `INSERT INTO clients (
           company_id, tipo_documento, numero_documento, razon_social, nombre_comercial,
           direccion, ubigeo, distrito, provincia, departamento, email, activo, created_at, updated_at
         ) VALUES ($1,'1','12345678','Cliente Demo Preview','Cliente Demo',
           'Jr. Cliente 123',$2,'Lima','Lima','Lima','cliente@preview.zentofact.local',true,$3,$3)
         RETURNING id`,
        [company.id, '150101', now],
      );
    });
    if (result?.rows?.length) created += 1;
  }
  return created;
}

async function ensureSampleOrders(companiesByRuc, products) {
  await ensureOrdersItemsColumns();
  const limbo = companiesByRuc.get('20990001001');
  const product = products[0];
  if (!limbo || !product) return { orders: 0 };

  const account = await ensureFalabellaChannelAccount(limbo);
  if (!account) return { orders: 0 };

  const externalOrderId = `${SEED_MARKER}-order-1`;
  const orderNumber = 'PV-10001';
  const now = new Date();
  const orderResult = await pool.query(
    `INSERT INTO orders (
       company_id, channel_account_id, external_order_id, external_order_number,
       order_status, payment_status, fulfillment_status, document_status, provider_status,
       document_requirement, document_type_policy, currency, subtotal, total,
       customer, shipping, metadata, ordered_at, provider_updated_at, items_status, created_by
     ) VALUES (
       $1,$2,$3,$4,
       'confirmed','paid','pending','not_requested','pending',
       'optional','automatic','PEN',$5,$5,
       $6::jsonb,'{}'::jsonb,$7::jsonb,$8,$8,'complete',$9
     )
     ON CONFLICT (channel_account_id, external_order_id) DO UPDATE SET
       last_seen_at = NOW(), updated_at = NOW()
     RETURNING id`,
    [
      limbo.id,
      account.id,
      externalOrderId,
      orderNumber,
      product.referencePrice || 100,
      JSON.stringify({ name: 'Ana Preview', documentNumber: '12345678', email: 'ana@preview.zentofact.local' }),
      JSON.stringify({ origin: SEED_MARKER }),
      now,
      'preview-seed',
    ],
  );
  const orderId = Number(orderResult.rows[0].id);
  await pool.query(
    `INSERT INTO order_items (
       order_id, external_item_id, sku, provider_sku, description, quantity,
       unit_price, total, product_id, main_sku, stock_state, metadata
     ) VALUES ($1,$2,$3,$3,$4,1,$5,$5,$6,$3,'none',$7::jsonb)
     ON CONFLICT (order_id, external_item_id) DO NOTHING`,
    [
      orderId,
      `${externalOrderId}-item-1`,
      product.mainSku,
      product.name,
      product.referencePrice || 100,
      product.productId,
      JSON.stringify({ origin: SEED_MARKER }),
    ],
  );

  // Pedido listo para salidas de hoy (shipped hoy).
  const shippedId = `${SEED_MARKER}-order-shipped`;
  const shipped = await pool.query(
    `INSERT INTO orders (
       company_id, channel_account_id, external_order_id, external_order_number,
       order_status, payment_status, fulfillment_status, document_status, provider_status,
       document_requirement, document_type_policy, currency, subtotal, total,
       customer, shipping, metadata, ordered_at, provider_updated_at, items_status, created_by
     ) VALUES (
       $1,$2,$3,'PV-10002',
       'completed','paid','shipped','not_requested','shipped',
       'optional','automatic','PEN',$4,$4,
       $5::jsonb,'{}'::jsonb,$6::jsonb,NOW(),NOW(),'complete',$7
     )
     ON CONFLICT (channel_account_id, external_order_id) DO UPDATE SET
       fulfillment_status='shipped', last_seen_at=NOW(), updated_at=NOW()
     RETURNING id`,
    [
      limbo.id,
      account.id,
      shippedId,
      product.referencePrice || 100,
      JSON.stringify({ name: 'Luis Preview', documentNumber: '87654321' }),
      JSON.stringify({ origin: SEED_MARKER }),
      'preview-seed',
    ],
  );
  await pool.query(
    `INSERT INTO order_items (
       order_id, external_item_id, sku, provider_sku, description, quantity,
       unit_price, total, product_id, main_sku, stock_state, stock_applied_quantity, metadata
     ) VALUES ($1,$2,$3,$3,$4,1,$5,$5,$6,$3,'applied',1,$7::jsonb)
     ON CONFLICT (order_id, external_item_id) DO NOTHING`,
    [
      Number(shipped.rows[0].id),
      `${shippedId}-item-1`,
      product.mainSku,
      product.name,
      product.referencePrice || 100,
      product.productId,
      JSON.stringify({ origin: SEED_MARKER }),
    ],
  );

  return { orders: 2 };
}

async function bumpInsumosStock() {
  await pool.query(
    `UPDATE insumos
        SET quantity_on_hand = GREATEST(quantity_on_hand, 8),
            updated_at = NOW()
      WHERE code IN ('cinta-fill', 'fill-pequeno', 'cinta-scotch')`,
  );
}

export async function seedPreviewData({ force = false } = {}) {
  await runMigrations(pool);
  await ensureSeedMarkerTable();
  const marker = await readSeedMarker();
  if (!force && marker?.marker === SEED_MARKER) {
    console.log('[SEED] Preview ya sembrado; omitiendo (force=false).');
    return { skipped: true, summary: marker.summary || {} };
  }

  const credentials = adminCredentials();
  const password = seedPassword();
  const admin = await ensureAdminUser(credentials);

  const roleUsers = [];
  for (const spec of SEED_USERS) {
    const result = await ensureRoleUser(spec, password, admin.id);
    roleUsers.push({ email: spec.email, role: spec.role, created: result.created });
  }

  const companies = [];
  for (const spec of SEED_COMPANIES) {
    companies.push(await ensureCompany(spec));
  }
  // Re-correr migraciones de canales para cuentas manuales de empresas nuevas.
  await pool.query(`
    INSERT INTO order_channel_accounts (
      company_id, channel_id, external_account_id, display_name,
      auto_create_orders, document_requirement, document_type_policy, settings
    )
    SELECT
      c.id, ch.id, 'default',
      'Ventas manuales · ' || coalesce(nullif(c.nombre, ''), nullif(c.nombre_comercial, ''), c.razon_social, 'Empresa'),
      FALSE, 'optional', 'automatic', '{"origin":"preview_seed"}'::jsonb
    FROM companies c
    JOIN order_channels ch ON ch.code = 'manual'
    ON CONFLICT (company_id, channel_id, external_account_id) DO NOTHING
  `);

  const companiesByRuc = new Map(companies.map((company) => [company.ruc, company]));
  for (const company of companies) {
    await ensureFalabellaChannelAccount(company);
  }

  const products = [];
  for (const spec of SEED_PRODUCTS) {
    products.push({
      ...spec,
      ...(await ensureProduct(spec, admin.id, companiesByRuc)),
    });
  }

  const clientsCreated = await ensureClients(companies);
  const orders = await ensureSampleOrders(companiesByRuc, products);
  const insumosModule = await import('./insumos.js');
  await insumosModule.ensureTables();
  await bumpInsumosStock();

  const summary = {
    marker: SEED_MARKER,
    adminEmail: credentials.email,
    users: roleUsers,
    companies: companies.map((company) => ({ id: company.id, ruc: company.ruc, created: company.created })),
    products: products.map((product) => ({
      id: product.productId,
      mainSku: product.mainSku,
      created: product.created,
      listings: product.listings,
    })),
    clientsCreated,
    orders,
    loginHint: {
      admin: credentials.email,
      operator: 'operator@preview.zentofact.local',
      vendedor: 'vendedor@preview.zentofact.local',
      billing: 'billing@preview.zentofact.local',
      passwordEnv: 'ADMIN_PASSWORD o SEED_USER_PASSWORD',
    },
  };
  await writeSeedMarker(summary);
  console.log('[SEED] Preview listo:', JSON.stringify({
    admin: summary.adminEmail,
    companies: summary.companies.length,
    products: summary.products.length,
    users: summary.users.length,
    orders: summary.orders.orders,
  }));
  return { skipped: false, summary };
}

export async function bootstrapPreviewIfNeeded() {
  if (!shouldSeedPreview()) {
    console.log('[SEED] Omitido: SEED_PREVIEW=false o SKIP_PREVIEW_SEED=true');
    return { ran: false, skipped: true };
  }
  const envName = String(process.env.RAILWAY_ENVIRONMENT_NAME || 'local').trim() || 'local';
  console.log(`[SEED] Bootstrap de preview en ${envName}`);
  await ensureAuthSchema();
  await users.ensureUserColumns();
  const result = await seedPreviewData();
  await ensureAdminUser(adminCredentials());
  return { ran: true, ...result };
}

// CLI: `node src/seed-preview.js` o `SEED_PREVIEW=true node src/seed-preview.js --force`
const isCli = process.argv[1] && String(process.argv[1]).endsWith('seed-preview.js');
if (isCli) {
  const force = process.argv.includes('--force');
  process.env.SEED_PREVIEW ||= 'true';
  try {
    await ensureAuthSchema();
    await users.ensureUserColumns();
    const result = await seedPreviewData({ force });
    if (result.skipped) {
      console.log('Seed omitido (ya aplicado). Usa --force para re-aplicar datos faltantes.');
    } else {
      console.log('Seed preview aplicado ✅');
      console.log(JSON.stringify(result.summary.loginHint, null, 2));
    }
    process.exit(0);
  } catch (error) {
    console.error('Seed preview falló:', error);
    process.exit(1);
  }
}
