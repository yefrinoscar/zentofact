# Cloud Agent fixtures

How a Cloud Agent boots ZentoFact on this VM and which seeded profile to use for each task. Source of truth for emails, SKUs, and inbox rows is `packages/server/src/seed-preview.js` (`SEED_USERS`, `SEED_COMPANIES`, `SEED_PRODUCTS`, `SEED_MARKER`). This file is the disclosed map those constants feed.

Prove at `http://127.0.0.1:3011`. The API is `http://127.0.0.1:3010`. Railway is the public host after a merge into `dev` or `main`, not the proof. Opening a pull request must not spin a Railway PR environment; skip Railway GitHub checks and drive this VM.

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
| `operator@preview.zentofact.local` | operator | `#/pedidos`, `#/scanner`, `#/salidas`, `#/insumos`, `#/orders` |
| `vendedor@preview.zentofact.local` | vendedor | `#/mis-ventas` |
| `billing@preview.zentofact.local` | billing | `#/boletas`, `#/facturas`, `#/credit-notes` |

Default `login` without an email uses `ADMIN_EMAIL` (`admin@zentofact.local`).

## Catalog, inventory, sellers

Companies: LIMBO `20990001001`, MANTA RAYA `20990001002`, YAKURUNA `20990001003`. Fake Falabella keys sit on those rows; sync stays off.

| SKU | Stock | Listings |
|---|---|---|
| AG301 | 12 | LIMBO + MANTA RAYA Falabella |
| HOG025 | 8 | LIMBO + YAKURUNA Falabella, Ripley `S166285` |
| BB110 | 25 | YAKURUNA Falabella |
| BB220 | 40 | LIMBO + MANTA RAYA Falabella |
| HOG040 | 15 | YAKURUNA Falabella |

Proof: `GET /products?search=AG301&limit=5` returns `mainSku=AG301` with `stockOnHand` 12. Open `#/productos` as superadmin or admin. Seller publications live in the product drawer, not on the master row.

Do not POST inventory adjust or click publication switches unless the task explicitly enables marketplace mutation.

## Inbox and salidas

Inbox reads `falabella_orders`, not the unified `orders` table.

| Order | Status | Screen |
|---|---|---|
| PV-10001 | `pending` | `#/pedidos` tab Pendientes |
| PV-10003 | `ready_to_ship` | `#/pedidos` tab Listos para enviar |
| PV-10002 | `shipped` | not the pending tab; promised shipping today feeds `#/salidas` with AG301 |

Proof: as operator or admin, `GET /orders-inbox?view=open` includes PV-10001. Inbox `order_id` matches the unified `orders.external_order_id`. Promised shipping is noon America/Lima today, so `#/salidas` and `GET /catalog/sales/today` list AG301. Do not click **Marcar listo para enviar**. Do not `POST /orders-inbox/sync`.

Unified sample orders PV-10001, PV-10002, and PV-10003 exist on LIMBO's Falabella channel account for `#/orders`.

## Flags

`SEED_PREVIEW=true`. `FALABELLA_SYNC_ENABLED=false`. `MARKETPLACE_PUBLICATION_MUTATION_ENABLED=false`. `AUTO_EMIT_ENABLED=false`. `SUNAT_FORCE_ENV=beta`. Inbox is local DB. Seller API stays off.

## Drive

Harness: `.cursor/skills/verify-zentofact/scripts/control-zentofact`. Feature recipes: `.cursor/skills/verify-zentofact/features/README.md`.
