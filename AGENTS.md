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
