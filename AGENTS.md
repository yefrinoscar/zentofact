# Repository workflow

- `main` is the canonical branch and the production branch.
- Every new feature must be developed on its own branch created from the latest `main`. Do not implement a new feature directly on `main`.
- When the user says "commit and push", commit the relevant work on the current feature branch, push that branch, open a pull request targeting `main`, and merge it into `main`. Approve the pull request when the hosting platform permits it; if authors cannot approve their own pull requests, merge it without self-approval once the permitted required checks pass.
- Railway production services must deploy from `main`, not from a feature branch.
- For now, do not add or run security checks, security reviews, or security gates as part of this workflow unless the user explicitly asks for them. Do not remove or weaken existing security controls.

## Versioning and releases

- `packages/web/package.json` is the source of truth for the application version. Keep its matching entry in `package-lock.json` synchronized.
- Every pull request merged into `main` must contain exactly one Semantic Versioning increment and produce exactly one GitHub Release. Pull requests closed without merging do not create a release.
- Apply exactly one release label to every pull request before merging:
  - `release:patch` for fixes and internal changes that preserve existing behavior, including bug fixes, refactors, tests, documentation, dependency updates, performance improvements, and minor UI corrections.
  - `release:minor` for new backward-compatible functionality that does not require existing users or integrations to change.
  - `release:major` for breaking changes that require users, integrations, configuration, or stored data to change.
- When a pull request contains more than one change type, use the highest-impact increment: `release:major` over `release:minor` over `release:patch`.
- Compare the version on the feature branch with the current version on `main` and update it as follows:
  - Patch: `X.Y.Z` becomes `X.Y.(Z+1)`.
  - Minor: `X.Y.Z` becomes `X.(Y+1).0`.
  - Major: `X.Y.Z` becomes `(X+1).0.0`.
- Update the feature branch from the latest `main` immediately before final validation. Recalculate the version if `main` changed while the pull request was open.
- Never reuse an existing version, create a release tag from a feature branch, or manually create an additional version after a release job fails.
- The pull request description must state the selected release type and why it applies.
- After merge, the release workflow tags the merged commit as `vX.Y.Z` and creates the corresponding GitHub Release. If it fails, rerun the same workflow for the same commit.
- When the user says "commit and push", apply the appropriate release label, wait for the version validation to pass, merge the pull request, and verify that the GitHub Release was created.

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
