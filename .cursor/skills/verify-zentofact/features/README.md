# ZentoFact verification map

This directory is the maintained source for verifying operator-facing behavior. Read this index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Launch with `.cursor/skills/verify-zentofact/scripts/control-zentofact launch`.
- Doctor must report `api_health=ok` (`service=zentofact-api`) and `web_health=ok` at `http://127.0.0.1:3011`.
- Sign in with `.cursor/skills/verify-zentofact/scripts/control-zentofact login` or `login <email>` from `docs/agents/cloud-agent.md`.
- Seeded catalog, inbox, and roles are required on this VM. If AG301 or PV-10001 is missing, run `control-zentofact seed`.
- The PostgreSQL catalog is shared. Run one verification drive at a time. Default recipes are read-only.
- Never drive Falabella seller mutations or inventory adjustments unless a later feature file says so.

## Driving conventions

- Start every recipe from the baseline unless its preconditions say otherwise.
- Prefer ARIA roles and accessible names. Hash routes: `http://127.0.0.1:3011/#/productos`.
- Treat helper commands as literal.
- Restore nothing on the shared DB after a read. If a recipe mutates, it must name the compensating read and the leftover rows.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes a screenshot with the page `h1` visible plus the matching authenticated API JSON.
- Record the feature ID and entry point with every artifact under `.cursor/skills/verify-zentofact/artifacts/<run-id>/`.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features`
2. `How to get to it (user POV)`
3. `Driving it with control-zentofact`
4. `Gotchas`

## Features

- [Sign in](./sign-in.md) covers the login screen and the authenticated `/me` session.
- [Catalog](./catalog.md) covers the product table, search, and stock visible on `/productos`.
- [Falabella inbox](./falabella-inbox.md) covers pending vs listo-para-enviar tabs without mutating orders.
- [Logistics inbox](./logistics-inbox.md) covers the all-channel warehouse tray at `/bandeja` without printing or marking ready.
- [Today outbound](./salidas.md) covers products leaving today by promised shipping date.
