# Sign in

Sign in lets an operator open ZentoFact in the browser, enter the seeded admin email and password, and reach a module that their role allows.

## Sub-features

- `sign-in-form` shows the login heading and the Correo / Contraseña fields when there is no session.
- `sign-in-submit` authenticates with the seeded admin and lands inside the app.
- `sign-in-session` exposes the same user through `GET /me`.

## How to get to it (user POV)

- Open `http://127.0.0.1:3011/` with no session cookie.
- Submit the form labeled `Bienvenido de vuelta`.

## Driving it with control-zentofact

Preconditions:

- `control-zentofact doctor` reports `api_health=ok` and `web_health=ok`.
- `.env` contains `ADMIN_EMAIL` or `AUTH_SUPERADMIN_EMAIL`. Submitting the form also needs `ADMIN_PASSWORD` in the environment. The login screen itself can be proved without the password.
- No session cookie, or a previous `stop` cleared `.run/cookies.txt`.

- **See the gate.** Open `http://127.0.0.1:3011/`. The heading reads `Bienvenido de vuelta`. Fields `Correo` and `Contraseña` are visible. The submit button is named `Ingresar`.
- **Submit in the browser.** Fill `Correo` with `ADMIN_EMAIL` and `Contraseña` with `ADMIN_PASSWORD`. Click `Ingresar`. The heading `Bienvenido de vuelta` disappears. A signed-in header `h1` appears (`Dashboard`, `Bandeja Falabella`, or another allowed module).
- **Submit through the helper.** Run `.cursor/skills/verify-zentofact/scripts/control-zentofact login`. Stdout contains `login=ok email=` plus the admin email and `role=superadmin`. To prove another selectable role, pass that email: `login operator@preview.zentofact.local`.
- **Confirm session.** Run `.cursor/skills/verify-zentofact/scripts/control-zentofact api GET /me .cursor/skills/verify-zentofact/artifacts/<run>/me.json`. The JSON `user.email` matches the email you passed. Save doctor stdout after login as `doctor.txt`.
- **Proof.** Screenshot the signed-in header with the ZentoFact mark visible. Keep `me.json`.

## Gotchas

- Signup is disabled in normal runs. Do not look for a register link.
- Password minimum is 12 characters. The seed admin already satisfies this.
- Safari and the web app keep auth on the web origin. Always call `/api/auth/sign-in/email` and `/me` through `http://127.0.0.1:3011`, not the raw API port, when proving the browser cookie.
- A 200 from `/health` is not a session. `/me` without a cookie is unauthenticated.
