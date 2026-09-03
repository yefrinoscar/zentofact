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
- Railway does not deploy pull requests. PR Environments stay off. Do not wait for a Railway GitHub check, preview URL, or green deploy status on a feature PR. Prove the change on this Cloud Agent VM at `http://127.0.0.1:3011`. Railway **development** still deploys from `dev` after a merge into `dev`. Railway **production** still deploys from `main` after a release.
- A Cloud Agent must not open a GitHub pull request unless the user explicitly asks to commit, push, or open one. It must not create a Railway environment, PR environment, or preview deploy. Postgres, `.env`, fixture users, catalog, inbox, API, and web are created only on this Cloud Agent VM.
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

### Cloud Agent fixtures

When proving a UI or API change on this VM, or when the task names a role, catalog, inbox, inventory, or seed: read `docs/agents/cloud-agent.md`.

## Cursor Cloud specific instructions

The Cloud Agent VM is the only test appliance. Postgres, `.env`, fixture users, catalog, Falabella inbox, API (`3010`), and web (`3011`) are created here by `scripts/cloud-agent-start.sh` and the configured terminals. Do not provision Neon, Railway Postgres, a GitHub pull request, or a Railway PR environment to make this app start.

Do not open a GitHub pull request unless the user explicitly asks to commit, push, or open one. Do not create a Railway environment, PR environment, or preview deploy. Prove operator flows on this VM at `http://127.0.0.1:3011`. Railway **development** still deploys from `dev` after a merge into `dev`. Railway **production** still deploys from `main` after a release.

1. `bash scripts/cloud-agent-start.sh` — done when it prints `cloud-agent-start=ok`. Local Postgres is up and DB `zentofact` accepts `zento` on `127.0.0.1:5432`. If `.env` was missing, the script wrote one with `SEED_PREVIEW=true`.
2. `.cursor/skills/verify-zentofact/scripts/control-zentofact launch` then `doctor` — done when doctor prints `api_health=ok` (`service=zentofact-api`) and `web_health=ok`.
3. Pick the fixture profile that matches the task from `docs/agents/cloud-agent.md`, then `.cursor/skills/verify-zentofact/scripts/control-zentofact login <email>`. Done when stdout prints `login=ok email=<that email>` and the screen under test shows seeded rows (or the role's authorized empty view).

`SEED_PREVIEW=true` fills every selectable role, LIMBO / MANTA RAYA / YAKURUNA, catalog stock, and Falabella inbox rows on boot. Falabella Seller API stays off (`FALABELLA_SYNC_ENABLED=false`).

`bash scripts/cloud-agent-install.sh` refreshes `node_modules`, linux-x64 native bindings for Vite, and `dist/` for `@zentofact/falabella-api`, `@zentofact/core`, and `@zentofact/ripley-api`. A plain `npm install` does not restore those native bindings.

`vp` is not a project dependency. Build per workspace. Tests are `npm test -w @zentofact/{core,falabella-api,server,web}`. Typecheck is `npm run typecheck -w @zentofact/web`.

Optional remotes stay unset: R2 falls back to disk, Resend prints reset links, Maps stays empty, `SUNAT_FORCE_ENV=beta`.
