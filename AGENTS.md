# Repository workflow

- `main` is the canonical branch and the production branch.
- Every new feature must be developed on its own branch created from the latest `main`. Do not implement a new feature directly on `main`.
- When the user says "commit and push", commit the relevant work on the current feature branch, push that branch, open a pull request targeting `main`, and merge it into `main`. Approve the pull request when the hosting platform permits it; if authors cannot approve their own pull requests, merge it without self-approval once the permitted required checks pass.
- Railway production services must deploy from `main`, not from a feature branch.
- For now, do not add or run security checks, security reviews, or security gates as part of this workflow unless the user explicitly asks for them. Do not remove or weaken existing security controls.
