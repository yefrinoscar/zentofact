# Cloud Agent fixtures

How a Cloud Agent boots ZentoFact on this VM and which seeded profile to use for each task. Source of truth for emails, SKUs, and inbox rows is `packages/server/src/seed-preview.js` (`SEED_USERS`, `SEED_COMPANIES`, `SEED_PRODUCTS`, `SEED_MARKER`). This file is the disclosed map those constants feed.

Prove at `http://127.0.0.1:3011`. The API is `http://127.0.0.1:3010`. Railway is the public host after a merge into `dev` or `main`, not the proof. Do not open a GitHub pull request and do not create a Railway PR environment to boot or prove this VM. Postgres, `.env`, seeds, API, and web already live here. Skip Railway GitHub checks and drive this VM.

## Boot

1. `bash scripts/cloud-agent-start.sh` — done when stdout is `cloud-agent-start=ok`. Postgres 16 is listening. Role `zento` / `zento` owns DB `zentofact` on `127.0.0.1:5432` without SSL. If `.env` was missing, the script wrote one with `SEED_PREVIEW=true`.
2. `.cursor/skills/verify-zentofact/scripts/control-zentofact launch` — done when it prints `ready` or `already running`, then `doctor` prints `api_health=ok` (`service=zentofact-api`) and `web_health=ok`.
3. API boot runs `bootstrapPreviewIfNeeded`. Done when every selectable role can `login` and `GET /products?search=AG301` returns that SKU.

`install` (`bash scripts/cloud-agent-install.sh`) runs on an environment Build, not every agent. `start` plus the API/web terminals run every boot. Snapshot stores disk (`node_modules`, `dist/`, Postgres files). Processes always restart.

If catalog or inbox is empty, run `.cursor/skills/verify-zentofact/scripts/control-zentofact seed` (same as `SEED_PREVIEW=true npm run seed:preview -w @zentofact/server -- --force`). Marker today is `preview-seed-v3`.

## Password

Every seeded user shares `ADMIN_PASSWORD` from `.env`. On a fresh VM that is `ZentoFactLocal123`. `control-zentofact login` never prints the password.

Postgres: `zento` / `zento`. Connection: `postgresql://zento:zento@127.0.0.1:5432/zentofact`.

## Profiles

Sign in with `.cursor/skills/verify-zentofact/scripts/control-zentofact login <email>`. List emails with `control-zentofact profiles`. `SELECTABLE_ROLES` is `superadmin`, `admin`, `operator`, `billing`, `vendedor`.

| Email | Role | Use this profile when the task is |
|---|---|---|
| `admin@zentofact.local` | superadmin | catalog, users, companies, dashboard, anything |
| `admin@preview.zentofact.local` | admin | same modules without the superadmin seat |
| `operator@preview.zentofact.local` | operator | `#/pedidos`, `#/scanner`, `#/insumos`, `#/orders` |
| `vendedor@preview.zentofact.local` | vendedor | `#/mis-ventas` |
| `billing@preview.zentofact.local` | billing | `#/boletas`, `#/facturas`, `#/credit-notes` |

Default `login` without an email uses `ADMIN_EMAIL` (`admin@zentofact.local`).

## Catalog, inventory, sellers

Companies: LIMBO `20990001001`, MANTA RAYA `20990001002`, YAKURUNA `20990001003`. Fake Falabella keys sit on those rows; sync stays off.

| SKU | Stock | Listings |
|---|---|---|
| AG301 | 12 | LIMBO + MANTA RAYA Falabella |
| HOG025 | 8 | LIMBO + YAKURUNA Falabella, Ripley `S166285`, LIMBO Mercado Libre `HOG025` |
| BB110 | 25 | YAKURUNA Falabella |
| BB220 | 40 | LIMBO + MANTA RAYA Falabella |
| HOG040 | 15 | YAKURUNA Falabella |

Proof: `GET /products?search=AG301&limit=5` returns `mainSku=AG301` with `stockOnHand` 12. Open `#/productos` as superadmin or admin. Seller publications live in the product drawer, not on the master row.

Do not POST inventory adjust or click publication switches unless the task explicitly enables marketplace mutation.

## Inbox and outbound seed

Inbox reads `falabella_orders`, not the unified `orders` table.

| Order | Status | Screen |
|---|---|---|
| PV-10001 | `pending` | `#/pedidos` tab Pendientes |
| PV-10003 | `ready_to_ship` | `#/pedidos` tab Listos para enviar |
| PV-10002 | `shipped` | not the pending tab; promised shipping today is noon America/Lima so `GET /catalog/sales/today` lists AG301 |

Proof: as operator or admin, `GET /orders-inbox?view=open` includes PV-10001. Inbox `order_id` matches the unified `orders.external_order_id`. Promised shipping is noon America/Lima today, so `GET /catalog/sales/today` lists AG301. `#/salidas` redirects to `#/orders`. Do not click **Marcar listo para enviar**. Do not `POST /orders-inbox/sync`.

Unified sample orders on LIMBO:

| Order | Channel | Fulfillment | Screen |
|---|---|---|---|
| PV-10001 | Falabella | `pending` | `#/bandeja` tab Pendientes |
| QNC-10010 | Manual | `pending` | `#/bandeja` tab Pendientes · printable label |
| RP-10020 | Ripley | `pending` | `#/bandeja` tab Pendientes · three unit lines shown as one product `x3` |
| ML-10030 | Mercado Libre | `pending` | `#/bandeja` tab Pendientes · espera etiqueta ME2 |
| ML-10031 | Mercado Libre | `ready_to_ship` | `#/bandeja` tab Listos · etiqueta ME2 10×15 imprimible |
| PV-10003 | Falabella | `ready_to_ship` | `#/bandeja` tab Listos |
| PV-10002 | Falabella | `shipped` | `#/bandeja` tab Enviados |

Proof: `GET /logistics-inbox?stage=pending` includes PV-10001, QNC-10010, RP-10020, and ML-10030. `GET /logistics-inbox?stage=ready` includes ML-10031. Print QNC-10010 (etiqueta ZentoFact) and ML-10031 (PDF ME2 del sandbox). Falabella y Ripley siguen necesitando APIs vivas.

Cómo entra un pedido ML: webhook `POST /webhooks/mercadolibre` (`orders_v2` / `shipments`) o sync si el flag está on. En este VM el sandbox local (`MERCADO_LIBRE_SANDBOX=true`) imita la API: `POST /sandbox/mercadolibre/dev/push-order` crea la orden y dispara el webhook. LIMBO queda con `user_id` `200000001` y tokens `SANDBOX-*` que nunca salen a `api.mercadolibre.com`. Health: `GET /sandbox/mercadolibre/health`.

## Flags

`SEED_PREVIEW=true`. `FALABELLA_SYNC_ENABLED=false`. `MERCADO_LIBRE_SYNC_ENABLED=false`. `MERCADO_LIBRE_SANDBOX=true`. `MARKETPLACE_PUBLICATION_MUTATION_ENABLED=false`. `AUTO_EMIT_ENABLED=false`. `SUNAT_FORCE_ENV=beta`. Inbox is local DB. Falabella and Ripley seller APIs stay off. Mercado Libre uses the local sandbox (tokens `SANDBOX-*`); it must not call `https://api.mercadolibre.com`.

## Drive

Harness: `.cursor/skills/verify-zentofact/scripts/control-zentofact`. Feature recipes: `.cursor/skills/verify-zentofact/features/README.md`.
