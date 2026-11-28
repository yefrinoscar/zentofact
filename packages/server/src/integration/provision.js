// Alta de la integración de una tienda: llave de API y endpoint de webhook.
//   npm run integration:provision -- --account <channelAccountId> --webhook-url <url>
//   npm run integration:provision -- --company <companyId> --create-account --webhook-url <url>
// Imprime la llave y el secreto whsec_ UNA sola vez; en la base solo quedan el
// hash de la llave y el secreto cifrado.

import { encryptSecret, generateApiKey, generateWebhookSecret, serverKeyEnv } from './crypto.js';
import { DEFAULT_STORE_SETTINGS, documentRequirementForIssuance } from './settings.js';
import { SCOPES } from './auth.js';

export function parseProvisionArgs(argv) {
  const options = { scopes: [...SCOPES] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`Falta el valor de ${arg}.`);
      index += 1;
      return value;
    };
    if (arg === '--account') options.accountId = Number(next());
    else if (arg === '--company') options.companyId = Number(next());
    else if (arg === '--create-account') options.createAccount = true;
    else if (arg === '--webhook-url') options.webhookUrl = next();
    else if (arg === '--env') options.env = next();
    else if (arg === '--display-name') options.displayName = next();
    else if (arg === '--external-account-id') options.externalAccountId = next();
    else if (arg === '--issuance-mode') options.issuanceMode = next();
    else if (arg === '--scopes') options.scopes = next().split(',').map((scope) => scope.trim()).filter(Boolean);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Opción desconocida: ${arg}`);
  }
  if (options.help) return options;
  if (options.createAccount) {
    if (!Number.isInteger(options.companyId) || options.companyId <= 0) throw new Error('--create-account requiere --company <id>.');
  } else if (!Number.isInteger(options.accountId) || options.accountId <= 0) {
    throw new Error('Indica --account <channelAccountId> o --company <id> --create-account.');
  }
  if (options.webhookUrl && !/^https?:\/\//i.test(options.webhookUrl)) throw new Error('--webhook-url debe empezar con http:// o https://.');
  if (options.env && !['live', 'test'].includes(options.env)) throw new Error('--env debe ser live o test.');
  if (options.issuanceMode && !['on_request', 'always'].includes(options.issuanceMode)) {
    throw new Error('--issuance-mode debe ser on_request o always.');
  }
  const unknownScope = options.scopes.find((scope) => !SCOPES.includes(scope));
  if (unknownScope) throw new Error(`Scope desconocido: ${unknownScope}`);
  return options;
}

export async function provisionIntegration(db, options, { env = process.env } = {}) {
  const client = typeof db.connect === 'function' ? await db.connect() : db;
  const owns = client !== db;
  try {
    if (owns) await client.query('begin');
    let accountId = options.accountId;
    if (options.createAccount) {
      const channel = (await client.query(`select id from order_channels where code='external'`)).rows[0];
      if (!channel) throw new Error('No existe el canal external (Pedido externo).');
      const company = (await client.query(
        `select id, coalesce(nullif(nombre_comercial, ''), nullif(nombre, ''), razon_social) as name from companies where id=$1`,
        [options.companyId],
      )).rows[0];
      if (!company) throw new Error(`No existe la empresa ${options.companyId}.`);
      const settings = { ...DEFAULT_STORE_SETTINGS, ...(options.issuanceMode ? { issuanceMode: options.issuanceMode } : {}) };
      const row = (await client.query(
        `insert into order_channel_accounts (
           company_id, channel_id, external_account_id, display_name,
           auto_create_orders, document_requirement, document_type_policy, settings, active
         ) values ($1, $2, $3, $4, true, $5, 'automatic', $6, true)
         on conflict (company_id, channel_id, external_account_id) do update set
           settings = $6::jsonb || order_channel_accounts.settings,
           updated_at = now()
         returning id`,
        [
          company.id,
          channel.id,
          options.externalAccountId || 'tienda-web',
          options.displayName || `Tienda web · ${company.name || company.id}`,
          documentRequirementForIssuance(settings.issuanceMode),
          JSON.stringify(settings),
        ],
      )).rows[0];
      accountId = Number(row.id);
    }
    const account = (await client.query(
      `select a.id, a.settings, ch.code as channel_code from order_channel_accounts a
       join order_channels ch on ch.id=a.channel_id where a.id=$1 for update of a`,
      [accountId],
    )).rows[0];
    if (!account) throw new Error(`No existe la cuenta de canal ${accountId}.`);
    if (!['external'].includes(account.channel_code)) {
      throw new Error(`La cuenta ${accountId} es del canal ${account.channel_code}; la integración es para el canal external.`);
    }
    if (account.settings?.integration !== true) {
      const settings = { ...DEFAULT_STORE_SETTINGS, ...(account.settings || {}), integration: true };
      await client.query(
        `update order_channel_accounts set settings=$2, document_requirement=$3, updated_at=now() where id=$1`,
        [accountId, JSON.stringify(settings), documentRequirementForIssuance(settings.issuanceMode)],
      );
    }
    const keyEnv = options.env || serverKeyEnv(env);
    const key = generateApiKey(keyEnv);
    await client.query(
      `insert into integration_keys (key_id, channel_account_id, env, secret_hash, scopes, label)
       values ($1, $2, $3, $4, $5, $6)`,
      [key.keyId, accountId, keyEnv, key.secretHash, options.scopes, 'provision-cli'],
    );
    let webhookSecret = null;
    if (options.webhookUrl) {
      webhookSecret = generateWebhookSecret();
      await client.query(
        `update integration_endpoints set active=false, disabled_reason='reemplazado', disabled_at=now(), updated_at=now()
         where channel_account_id=$1 and active`,
        [accountId],
      );
      await client.query(
        `insert into integration_endpoints (channel_account_id, url, secret_encrypted) values ($1, $2, $3)`,
        [accountId, options.webhookUrl, encryptSecret(webhookSecret, env)],
      );
    }
    if (owns) await client.query('commit');
    return { accountId, apiKey: key.token, keyId: key.keyId, env: keyEnv, webhookUrl: options.webhookUrl || null, webhookSecret };
  } catch (error) {
    if (owns) await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    if (owns) client.release();
  }
}

const HELP = `Uso:
  npm run integration:provision -- --account <channelAccountId> --webhook-url <url>
  npm run integration:provision -- --company <companyId> --create-account --webhook-url <url>
Opciones: --env live|test, --issuance-mode on_request|always, --display-name, --external-account-id, --scopes a,b`;

async function main() {
  const { config } = await import('dotenv');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve } = await import('node:path');
  config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../../.env') });
  const options = parseProvisionArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return;
  }
  const core = await import('@zentofact/core');
  await core.runMigrations(core.pool);
  try {
    const result = await provisionIntegration(core.pool, options);
    console.log(`Cuenta de canal: ${result.accountId} (entorno de la llave: ${result.env})`);
    console.log('Guarda estos valores ahora; no se vuelven a mostrar.');
    console.log(`ZENTOFACT_API_KEY=${result.apiKey}`);
    if (result.webhookSecret) {
      console.log(`ZENTOFACT_WEBHOOK_SECRET=${result.webhookSecret}`);
      console.log(`Webhook: ${result.webhookUrl}`);
    }
  } finally {
    await core.pool.end();
  }
}

if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  });
}
