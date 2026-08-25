# Research: Railway preview deployments for cloud agents (frontend-only)

**Date:** 2026-08-25  
**Question:** How should ZentoFact run PR/preview deployments so cloud agents (and humans) can validate UI changes without local `.env`, ideally deploying only the frontend and reusing a shared backend?

## Primary sources

- [Preview Deployments with PR Environments](https://docs.railway.com/guides/preview-deployments-with-pr-environments)
- [Environments (PR / Focused / Bot)](https://docs.railway.com/environments)
- [Deploying a Monorepo (watch paths)](https://docs.railway.com/deployments/monorepo)
- [Ship on merge / PR canaries](https://docs.railway.com/guides/ship-on-merge-pr-canaries)
- Community feedback on linking PR services to base URLs: [station feedback](https://station.railway.com/feedback/pr-and-focused-environment-feedback-1996ab3b), [PR environments Q&A](https://station.railway.com/questions/pr-enviroments-22945a53)

Repo facts that constrain the design:

- Web service: `packages/web/railway.json` runs `vite preview` with a **runtime proxy** (`vite.config.ts` `preview.proxy` → `VITE_API_TARGET`).
- Browser client uses relative URLs (`packages/web/src/lib/apiHttp.ts` `BASE = ''`), so cookies stay on the **web** origin when the proxy works.
- API trusts explicit origins via `WEB_ORIGINS` + Better Auth `trustedOrigins` (`packages/server/src/auth.js`). Ephemeral `*.up.railway.app` preview hosts are **not** trusted today.
- AGENTS.md: Railway **development** deploys from `dev`; **production** from `main`. Previews must not blur those.

## What Railway offers

| Mode | Behavior | Cost / speed | Fit for UI-only PRs |
| --- | --- | --- | --- |
| Full PR Environment | Clones base env (web + api + DB vars) per PR | Highest | Overkill for Mis ventas UI |
| **Focused PR Environments** | Deploys only services matching **watch paths** (+ `${{service.URL}}` deps) | Lower | Right lever for monorepo |
| Bot PR Environments | Opt-in for Dependabot / Cursor / Copilot / etc. | — | **Required** for cloud-agent PRs |

Base environment for PRs should be **`development`**, not `production` (project setting: PR Environments base). That keeps previews on the same data/config cloud agents already reason about, without touching prod.

## Recommendation (best fit for this repo + cloud agents)

**Frontend-only preview → shared `zentofact-api` in `development`.**

Do **not** spin a new API/DB per UI PR. Reasons:

1. Agents lack local secrets; they need a **public HTTPS URL** with a real session.
2. UI PRs (Mis ventas mobile, etc.) do not need a fresh Postgres.
3. Full stack PR envs are slower/costlier and still need seed users.
4. Web already supports pointing at a remote API via `VITE_API_TARGET` + Vite preview proxy.

### Target shape

```text
PR opens (human or Cursor bot)
  → Railway PR env (base = development)
  → Focused: only zentofact-web builds from the PR branch
  → zentofact-api skipped
  → Web preview proxies to https://zentofact-api-development.up.railway.app
  → GitHub comment with preview URL
  → Agent / human logs in and drives the UI
```

### Railway project settings (dashboard)

1. **Project Settings → Environments → Enable PR Environments**
2. Set **base environment** to `development` (not production).
3. **Enable Focused PR Environments**
4. **Enable Bot PR Environments** (Cursor / cloud agents open bot PRs; otherwise no preview)
5. Per service **watch paths** (Build settings), roughly:
   - `zentofact-web`: `packages/web/**`, root lockfiles / workspace manifests as needed
   - `zentofact-api`: `packages/server/**`, `packages/core/**`, `packages/falabella-api/**`, `packages/ripley-api/**`, root `railway.json` if applicable

### Critical: do not create an API dependency via `${{…}}`

Focused mode also deploys services referenced as `${{service.URL}}`.  
Community reports that even pasting a Railway public URL can be treated as a link and boot the API.

For preview-friendly web vars in **development** (and thus PR clones):

- Set `VITE_API_TARGET` (or `VITE_API_URL`) to the **literal** development API URL, e.g. `https://zentofact-api-development.up.railway.app`
- Avoid `${{zentofact-api.RAILWAY_PUBLIC_DOMAIN}}` on the web service if the goal is “skip API”

Persistent `development` web can keep using a service reference if desired; PR envs then need an override strategy. Literal shared URL is the simplest path that matches “front only → same back”.

### Auth / CORS (must fix for previews to login)

Today `WEB_ORIGINS` is a fixed list. Each PR gets a new `https://….up.railway.app`. Options, in preferred order:

1. **Proxy-only (current Vite pattern)**  
   Browser talks only to the preview web origin; preview server proxies to development API.  
   Works if `Set-Cookie` is usable on the web host through the proxy (already how web+api are split on Railway with `vite preview`).  
   Still ensure Better Auth `trustedOrigins` accepts the preview web origin **or** that server-side proxy traffic does not depend on browser Origin matching the API.

2. **Allowlist pattern on development API only**  
   e.g. trust `https://*.up.railway.app` (or a dedicated preview subdomain) when `VITE_APP_ENV` / Railway env is development — never on production.

3. **Manual `WEB_ORIGINS` update per PR** — unusable for agents.

Recommendation: keep proxy-same-origin for previews; add a **development-only** trusted-origin helper for Railway preview hosts as a safety net when Origin is the ephemeral web URL.

### Data safety

Shared development API means preview UIs **read/write real development data**. For agent verification:

- Prefer read-only recipes (same as `verify-zentofact`).
- Use a dedicated vendedor test user.
- Avoid destructive marketplace mutations in preview drives.

## Alternatives (when not to use front-only)

| Situation | Better approach |
| --- | --- |
| API/schema migrations in the PR | Full or Focused deploy of **api** (and migrate against a **non-prod** DB — never production) |
| Need isolated data | Duplicate env with its own Postgres (expensive; seed required) |
| Only static visual check | Storybook / Playwright against mocks (no auth, limited) |

## Cloud-agent workflow once enabled

1. Agent opens PR → `dev` (already policy).
2. Railway Bot PR Environment builds **web** preview.
3. Agent waits on GitHub deployment / PR comment URL (subscribe to CI + Railway deploy status).
4. Agent drives `https://<preview>/#/mis-ventas` with known test credentials from **development** (stored as agent/env secrets, not in git).
5. PR close/merge tears down the preview.

Missing pieces to make this agent-complete (separate from Railway toggles):

- Development credentials available to cloud agents (Railway shared vars or Cursor env secrets).
- Optional: document the preview URL pattern in `verify-zentofact`.
- Bot PR Environments enabled (dashboard).

## “Potato mode” / plugin note

No Cursor plugin named `potato` was available in this environment’s plugin cache. If that referred to a marketplace add-on or an internal mode, it needs to be installed/authenticated in the Cursor client separately from this Railway design.

## Suggested implementation order

1. Dashboard: PR + Focused + Bot envs; base = `development`; watch paths.
2. Web service: literal `VITE_API_TARGET` → development API (confirm preview proxy still works).
3. Small API change: development-only trust for Railway preview web origins (if login fails through proxy).
4. Put a vendedor + admin password in cloud-agent secrets.
5. Update agent verify skill: “prefer Railway preview URL from PR deployments when present”.

## Verdict

**Yes — frontend-only previews pointing at the same development API is the best default for cloud agents on this monorepo**, using Railway **Focused + Bot PR Environments** with base **`development`**. Full stack PR envs should be reserved for API/data-model work. The main engineering gap is **auth origin allowlisting / proxy cookie behavior** for ephemeral preview hosts, not the Railway toggle itself.
