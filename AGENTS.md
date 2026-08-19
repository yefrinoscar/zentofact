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

Ese script (`scripts/setup-worktree.sh`) hace el arranque y no reemplaza nada que ya exista:

- Identifica el worktree principal con `git worktree list --porcelain`.
- Si `.env` no existe aquí y sí existe en el principal, crea un symlink hacia ese `.env`. Si el principal todavía no lo tiene, usa el primer worktree hermano que sí lo tenga.
- Si `node_modules` no existe y el lock (`package-lock.json`, `pnpm-lock.yaml` o `yarn.lock`) es idéntico al del origen, crea un symlink hacia esos `node_modules`.
- Si los archivos lock son diferentes, instala las dependencias en el worktree y no compartas `node_modules`.
- Nunca reemplaces archivos o directorios existentes.
- Verifica que los symlinks funcionen antes de continuar.

## Agent skills

### Issue tracker

Issues live in Linear and are created manually; agents draft title and body but do not create tickets. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
