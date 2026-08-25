# Repository workflow

- `main` is the canonical production branch. Railway **production** (`zentofact-web` and `zentofact-api` in the `production` environment) must deploy from `main` only.
- `dev` is the permanent development and integration branch. Railway **development** (`zentofact-web` and `zentofact-api` in the `development` environment) deploys from `dev` only. Do not delete `dev` or point production services at it.
- Keep `dev` synchronized with `main`. After every merge or hotfix on `main`, merge `main` back into `dev` before starting more work.
- Every new feature or fix must be developed on its own short-lived branch created from the latest `dev`. Do not implement regular work directly on `dev` or `main`.
- All feature and fix pull requests must target `dev`. Merging a pull request into `dev` does not create a production release.
- Production releases use a pull request from `dev` to `main`. Do not merge another branch directly into `main` unless the user explicitly authorizes an emergency hotfix; immediately merge any such hotfix back into `dev`.
- When the user says "commit and push", commit the relevant work on the current feature branch, push that branch, and open a pull request targeting `dev`. Do **not** merge that pull request. Merging into `dev` is manual and only happens when the user explicitly asks to merge it.
- Only release to production when the user explicitly asks to release, deploy to production, or merge `dev` into `main`.
- The phrase "release please" is explicit authorization to run the complete production release workflow: synchronize `dev` from `main`, open and merge the `dev` to `main` release pull request, verify the GitHub Release, and verify the Railway production deployment from `main`.
- For now, do not add or run security checks, security reviews, or security gates as part of this workflow unless the user explicitly asks for them. Do not remove or weaken existing security controls.

## Versioning and releases

- `packages/web/package.json` is the source of truth for the application version. Keep its matching entry in `package-lock.json` synchronized.
- Every release pull request from `dev` to `main` must contain exactly one Semantic Versioning increment and produce exactly one GitHub Release. Pull requests merged only into `dev`, or closed without merging, do not create a release.
- Apply exactly one release label to every release pull request before merging into `main`:
  - `release:patch` for fixes and internal changes that preserve existing behavior, including bug fixes, refactors, tests, documentation, dependency updates, performance improvements, and minor UI corrections.
  - `release:minor` for new backward-compatible functionality that does not require existing users or integrations to change.
  - `release:major` for breaking changes that require users, integrations, configuration, or stored data to change.
- When a pull request contains more than one change type, use the highest-impact increment: `release:major` over `release:minor` over `release:patch`.
- Compare the version on `dev` with the current version on `main` before opening the release pull request and update it as follows:
  - Patch: `X.Y.Z` becomes `X.Y.(Z+1)`.
  - Minor: `X.Y.Z` becomes `X.(Y+1).0`.
  - Major: `X.Y.Z` becomes `(X+1).0.0`.
- Update `dev` from the latest `main` immediately before final release validation. Recalculate the version if `main` changed while the release pull request was open.
- Never reuse an existing version, create a release tag from a feature branch, or manually create an additional version after a release job fails.
- The release pull request description must state the selected release type and why it applies.
- After merge, the release workflow tags the merged commit as `vX.Y.Z` and creates the corresponding GitHub Release. If it fails, rerun the same workflow for the same commit.
- When the user explicitly asks to release or merge `dev` into `main`, apply the appropriate release label, wait for version validation to pass, merge the release pull request, verify that the GitHub Release was created, and confirm Railway production deployed the merged `main` commit successfully.

## UI composition

- Prefer one clear page surface and a single advanced table for dense operational data. Avoid nesting cards, bordered panels, or rounded boxes inside other boxed surfaces when rows, separators, spacing, or a focused product drawer can express the hierarchy.
- Keep canonical product rows channel-agnostic: do not show “published in”, marketplace badges, or publication actions on the master row. Marketplace data and actions belong only to the individual seller rows in the product drawer.
- Use the shortest available commercial seller name in operational tables. Avoid legal suffixes and generic prefixes when a clear name such as `LIMBO`, `MANTA RAYA`, or `YAKURUNA` is available.
- A marketplace publication is always seller-specific. Existing-listing actions keep that seller fixed; a new-publication action may start from the product drawer, but it must require an explicit seller and channel selection before continuing.
- In the product master row, show the short internal SKU directly below the product name and make it copyable. Do not use filler labels such as “Generic” or “Internal product” when brand data is absent.
- In seller rows, allow product and company names to use up to two lines, render the marketplace as a tag below the company, expose publication state with a compact switch protected by confirmation, and place unrelated secondary row actions inside a three-dot menu.
- Keep the catalog and seller-publication drawer within the available page width. Do not force horizontal scrolling with fixed minimum table widths; prioritize operational fields and omit low-value columns such as a per-row “last queried” timestamp.
- Keep page headings plain and concise. Do not add decorative feature tags such as “multi-seller” when the surrounding copy and table already communicate the capability.
- Use the application header as the single page title. Do not repeat the route title or subtitle inside the page body; place search, filters, and primary actions in one compact operational toolbar directly below it.
- Build dense operational tables with server-side filtering and pagination. Use React Query for cache/invalidation and React Table for the row/column model; never load an unbounded catalog into browser state. Add row virtualization only when the UX requires continuous scrolling beyond the paginated working set.
- Do not use `useEffect` in the product catalog screen. Fetch and cache with React Query, derive defaults during render, and perform selection resets or prefetching from explicit user events.
- Open product details in a right-side drawer with concise tabs for overview, seller publications, inventory, and on-demand sales. Do not reintroduce inline row expansion for full product details.
- Until marketplace mutation is explicitly enabled, publication and unpublication controls must remain visual-only. Protect unpublication previews with an explicit typed confirmation and never call a seller API from a visual prototype.

## Git worktrees

Cuando trabajes dentro de un Git worktree, o al crear una rama/worktree nueva, ejecuta primero:

```bash
npm run worktree:setup
```

Ese script (`scripts/setup-worktree.sh`) hace el arranque:

- Identifica el worktree principal con `git worktree list --porcelain`.
- Si `.env` no existe aquí y sí existe en el principal, crea un symlink hacia ese `.env`. Si el principal todavía no lo tiene, usa el primer worktree hermano que sí lo tenga.
- Comparte `node_modules` solo desde un worktree con el mismo lock y con `packages/*/node_modules` completo. npm no hoist a la raíz paquetes como `better-auth`, así que también enlaza el `node_modules` de cada `packages/*`.
- Si ningún origen está completo, o el lock es distinto, ejecuta `npm install` en este worktree. No instales sobre un symlink: bórralo antes para no mutar al origen.
- No reemplaza un `node_modules` que sea un directorio real. Un symlink incompleto sí se retargetea.
- Verifica que `packages/web` y `packages/server` resuelvan `better-auth` antes de continuar.

## Agent skills

### Issue tracker

Issues live in Linear and are created manually; agents draft title and body but do not create tickets. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Cursor Cloud specific instructions

This runs against a **local PostgreSQL on the VM** (not Neon). The startup update script only refreshes npm dependencies; the database daemon, `.env`, and services are not started automatically.

- **Start PostgreSQL each boot** (no systemd, so it does not auto-start): `sudo pg_ctlcluster 16 main start`. The local DB is `zentofact`, role `zento`/`zento` (superuser, so `CREATE EXTENSION pg_trgm` works). The root `.env` already points `DATABASE_URL_POSTGRES` at `postgresql://zento:zento@127.0.0.1:5432/zentofact` (no SSL — do not add `sslmode=require` for the local cluster).
- **Run everything**: `npm run dev` from the repo root (builds `@zentofact/falabella-api` + `@zentofact/core`, then runs API on `:3010`, web on `:3011`, plus the two `tsc --watch` builders). Web UI: `http://127.0.0.1:3011/` (HashRouter). API health: `http://127.0.0.1:3010/health`. This is the canonical entrypoint; the `verify-zentofact` skill's `control-zentofact` helper is an alternative.
- **Auth bootstrap is already applied** in the snapshot (`npm run auth:migrate -w @zentofact/server` then `npm run auth:seed-admin -w @zentofact/server`). If the DB is ever reset, rerun both. Seeded superadmin: `admin@zentofact.local` / `ZentoFactLocal123`. Non-auth schema is auto-created on API startup via `runMigrations`.
- **Preview seed (Railway PR envs):** on boot, when `RAILWAY_ENVIRONMENT_NAME` matches `zentofact-pr-<n>` (or `SEED_PREVIEW=true` outside production), the API runs `ensureAuthSchema`, creates the admin from `ADMIN_EMAIL`/`ADMIN_PASSWORD`, and idempotently seeds demo data (users, LIMBO/MANTA RAYA/YAKURUNA, catálogo con stock/listings, insumos, pedidos de muestra). Manual rerun: `npm run seed:preview -w @zentofact/server -- --force`. Demo logins share `ADMIN_PASSWORD` or `SEED_USER_PASSWORD`: `operator@preview.zentofact.local`, `vendedor@preview.zentofact.local`, `billing@preview.zentofact.local`.
- **Native-binding gotcha (important):** the committed `package-lock.json` omits the `linux-x64-gnu` optional deps for `@tailwindcss/oxide` and `lightningcss` (npm optional-deps bug npm/cli#4828). Without them Vite crashes on start with "Cannot find native binding". A plain `npm install` does **not** fix this; the startup update script reinstalls the matching binaries with `npm install --no-save --no-package-lock`. Do not delete `node_modules` expecting `npm install` alone to recover — rerun the update-script step or `npm run dev` will fail on the web service only (the API still comes up).
- **`vp` is not installed**: the root `build`/`dev:all`/`core`/`web` scripts use the "Vite+" (`vp`) CLI, which is not a project dependency. Build per workspace instead: `npm run build -w @zentofact/falabella-api`, `-w @zentofact/core`, `-w @zentofact/web`.
- **Lint/test/build:** there is no repo-wide `lint` script; the static check is `npm run typecheck -w @zentofact/web` (`tsc --noEmit`). Tests are per package via `node --test`: `npm test -w @zentofact/{core,falabella-api,server,web}`. Web production build: `npm run build -w @zentofact/web`.
- **Optional integrations are unset by default** and degrade gracefully: Falabella Seller API (catalog only simulates), Cloudflare R2 (falls back to local disk), Resend (reset links printed to logs), Google Maps. `SUNAT_FORCE_ENV=beta` locally — never real emission. Puppeteer/Chrome (PDF render + Falabella manifest scraper) is not needed for login/catalog flows and its Chrome download is not part of setup.
