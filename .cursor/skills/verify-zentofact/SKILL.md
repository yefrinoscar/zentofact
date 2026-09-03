---
name: verify-zentofact
description: Drive the ZentoFact web app and API the way an operator does — login as each fixture role, catalog, and Falabella inbox. Use when proving a UI or API change, checking inventory after listo-para-enviar, or verifying local app behavior.
---

# Verify ZentoFact

ZentoFact is a Hash-routed React web app (`packages/web`) talking to a Hono API (`packages/server`) on a shared PostgreSQL catalog. The primary user surface is the web UI at `http://127.0.0.1:3011`. The API at `http://127.0.0.1:3010` is the same origin through Vite's proxy. A CLI exists only for Falabella seller calls; do not treat it as the operator surface.

This skill is for an agent that has never seen the app. Read `features/README.md` before driving. Proof that uses one convenient entry point is incomplete when the map lists others.

## Launch

Repo root: three levels above this file (`../../../` from `.cursor/skills/verify-zentofact`). `launch` runs `scripts/cloud-agent-start.sh` so local Postgres and `.env` exist. Fixture emails and SKUs live in `docs/agents/cloud-agent.md`. Default login is `admin@zentofact.local`; pass another seeded email to `login` when the task is a non-admin role.

Exact start:

```bash
.cursor/skills/verify-zentofact/scripts/control-zentofact launch
```

That script runs `npm run worktree:setup` when `.env` or `node_modules` is missing, links nested workspace `node_modules` when they are absent, and builds `@zentofact/falabella-api` plus `@zentofact/core` when `dist/` is missing (the API imports those files). Then:

- API: `PORT=3010 npm run dev:api` — ready when `GET http://127.0.0.1:3010/health` returns JSON with `"service":"zentofact-api"`.
- Web: `VITE_API_TARGET=http://127.0.0.1:3010 npm run dev:web` — ready when `GET http://127.0.0.1:3011/` is HTTP 200.

If both ports already serve a healthy pair, the helper **attaches** and must not start a second pair. If only one port is up, it refuses. This VM's catalog lives in local Postgres. Default to read-only recipes. Do not click **Marcar listo para enviar**, do not POST `/catalog/inventory/adjust`, and do not sync Falabella unless the feature file says so.

Teardown:

```bash
.cursor/skills/verify-zentofact/scripts/control-zentofact stop
```

Stop kills only PIDs recorded by this run. An attached pre-existing pair is left running. Artifacts under `.cursor/skills/verify-zentofact/artifacts/` are never deleted.

## Doctor

Run first whenever anything looks off:

```bash
.cursor/skills/verify-zentofact/scripts/control-zentofact doctor
```

Worth driving only when:

- `api_health=ok` and the body includes `"service":"zentofact-api"`
- `web_health=ok`
- after login, `session=ok` and the email matches the profile you signed in as (the helper prints the email, never the password)

If doctor fails, read `.cursor/skills/verify-zentofact/.run/api.log` and `web.log` for the pair this run started.

## Drive

Harness: `control-zentofact` for session and HTTP. Browser for screens the operator sees. Hash routes live at `http://127.0.0.1:3011/#<path>`.

```bash
.cursor/skills/verify-zentofact/scripts/control-zentofact profiles
.cursor/skills/verify-zentofact/scripts/control-zentofact login
.cursor/skills/verify-zentofact/scripts/control-zentofact login operator@preview.zentofact.local
.cursor/skills/verify-zentofact/scripts/control-zentofact api GET /products?search=AG301&limit=5 .cursor/skills/verify-zentofact/artifacts/<run>/products.json
.cursor/skills/verify-zentofact/scripts/control-zentofact api GET /orders-inbox?view=open&limit=20 .cursor/skills/verify-zentofact/artifacts/<run>/inbox.json
.cursor/skills/verify-zentofact/scripts/control-zentofact api GET /catalog/sales/today .cursor/skills/verify-zentofact/artifacts/<run>/sales-today.json
```

`login [email]` POSTs to `http://127.0.0.1:3011/api/auth/sign-in/email` with that email (or `ADMIN_EMAIL` / `AUTH_SUPERADMIN_EMAIL`) plus `ADMIN_PASSWORD` from `.env`, and stores cookies in `.run/cookies.txt`. All later `api` calls go through the web origin so Vite's proxy and Better Auth cookies stay on the same site. Seeded catalog/inbox rows are in `docs/agents/cloud-agent.md`. If those rows are missing, run `control-zentofact seed`.

Browser (T3 preview tools, Playwright, or any CDP session) — stable handles from this repo:

| Screen | URL | Handles |
|---|---|---|
| Login | `http://127.0.0.1:3011/` | heading `Bienvenido de vuelta`; textbox labeled `Correo`; textbox labeled `Contraseña`; button `Ingresar` |
| Catalog | `http://127.0.0.1:3011/#/productos` | header `h1` `Catálogo de productos`; sidebar link `Productos`; search `role=textbox[name='Buscar por producto, SKU o marca']`; table `aria-label='Catálogo de productos'` |
| Inbox | `http://127.0.0.1:3011/#/pedidos` | header `h1` `Bandeja Falabella`; tablist `Flujo de pedidos`; tabs `Pendientes`, `Listos para enviar`; search `Buscar pedidos`; **do not** click `Marcar listo para enviar` |
| Dashboard | `http://127.0.0.1:3011/#/dashboard` | header `h1` `Dashboard` |

Prefer ARIA role + accessible name. The router is HashRouter; `preview_navigate` to `/#/productos`, not `/productos`.

## Evidence

Put every artifact under `.cursor/skills/verify-zentofact/artifacts/<run-id>/`. Keep them after `stop`.

Proof standards:

- Exercise the operator path: login screen or `control-zentofact login`, then the route in the feature file. Do not write inventory through test helpers or call seller APIs just because they exist.
- Capture the action and the resulting state. A screenshot of the catalog with no matching `GET /products` body is incomplete. An API JSON dump with no browser heading is incomplete for a UI change.
- Side effects: for a catalog read, the JSON `products` array and the table `Catálogo de productos` must agree on at least one visible name or SKU. For inbox, the tab count and `/orders-inbox` payload must agree on stage.
- Shared DB: treat mutations as production-adjacent. Read-only features are the default proof.

Minimum files for a UI proof:

- `doctor.txt` — stdout of `control-zentofact doctor` after login
- `*.json` — the authenticated API body for that screen
- `*.png` — screenshot with the page `h1` visible
- `aria.txt` — accessibility snapshot or pasted visible headings/labels

## Cleanup

```bash
.cursor/skills/verify-zentofact/scripts/control-zentofact stop
```

Removes the cookie jar and, only if this run started them, the API and web PIDs (including their child processes). Does not delete `artifacts/`. Does not drop database rows. Does not kill by process name (`node`, `vite`).

## Helpers

The script is executable. Invoke it from the repo root:

```bash
.cursor/skills/verify-zentofact/scripts/control-zentofact doctor
.cursor/skills/verify-zentofact/scripts/control-zentofact launch
.cursor/skills/verify-zentofact/scripts/control-zentofact profiles
.cursor/skills/verify-zentofact/scripts/control-zentofact login
.cursor/skills/verify-zentofact/scripts/control-zentofact login operator@preview.zentofact.local
.cursor/skills/verify-zentofact/scripts/control-zentofact seed
.cursor/skills/verify-zentofact/scripts/control-zentofact api GET /me
.cursor/skills/verify-zentofact/scripts/control-zentofact stop
```
