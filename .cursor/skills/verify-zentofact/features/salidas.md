# Today outbound

Salidas de hoy lists products leaving the warehouse on the Lima operational date, using promised shipping time rather than purchase time.

## Sub-features

- `salidas-open` opens `/salidas` with header `Salidas de hoy`.
- `salidas-table` shows the region `Productos con salida en esta fecha`.
- `salidas-api` returns the same aggregation from `GET /catalog/sales/today`.

## How to get to it (user POV)

- After sign-in, choose the sidebar link `Salidas de hoy`.
- Open `http://127.0.0.1:3011/#/salidas` directly.

## Driving it with control-zentofact

Preconditions:

- Baseline launch, doctor, and login have succeeded.
- The signed-in user can open `salidas` (seeded operator, admin, or superadmin).
- Seeded Falabella and unified orders share promised shipping time of today, so AG301 appears. If the JSON list is empty after seed, run `control-zentofact seed`.

- **Open the screen.** Navigate to `http://127.0.0.1:3011/#/salidas`. The header `h1` reads `Salidas de hoy`. A search box is named `Buscar SKU, producto o seller`. A region is named `Productos con salida en esta fecha`.
- **Read the aggregation.** Run `.cursor/skills/verify-zentofact/scripts/control-zentofact api GET /catalog/sales/today .cursor/skills/verify-zentofact/artifacts/<run>/salidas.json`. HTTP 200. If the JSON lists products, at least one name or SKU is visible in the table. If the JSON list is empty, the table shows the empty state, not a spinner that never ends.
- **Proof.** Screenshot the header and the table or empty state. Keep `salidas.json`. Do not click `Actualizar pedidos recientes de Falabella` unless a later recipe is explicitly live-syncing.

## Gotchas

- Operational date is promised shipping time in Lima, not order created-at.
- The first paint reads the local database only. A Falabella refresh is a separate, slower action.
- Hash route: `/#/salidas`.
