# Falabella inbox

The Falabella inbox lists seller orders the warehouse must prepare or dispatch. Pending and listo-para-enviar are separate tabs. Marking listo para enviar is a mutation; this feature only reads.

## Sub-features

- `inbox-open` opens `/pedidos` with header `Bandeja Falabella`.
- `inbox-pending` shows the `Pendientes` tab and its count.
- `inbox-ready` shows the `Listos para enviar` tab without changing any order.
- `inbox-api` returns the same orders from `GET /orders-inbox`.

## How to get to it (user POV)

- After sign-in, choose the sidebar link `Bandeja Falabella`.
- Open `http://127.0.0.1:3011/#/pedidos` directly.

## Driving it with control-zentofact

Preconditions:

- Baseline launch, doctor, and login have succeeded.
- The signed-in user can open `orders_inbox` (seeded operator, admin, or superadmin).
- `GET /orders-inbox?view=open` includes PV-10001 (`pending`) and the ready tab can show PV-10003. If the open inbox is empty, run `control-zentofact seed`. That empty state is a missing fixture on this VM, not a valid warehouse.

- **Open the screen.** Navigate to `http://127.0.0.1:3011/#/pedidos`. The header `h1` reads `Bandeja Falabella`. A tablist named `Flujo de pedidos` contains `Pendientes` and `Listos para enviar`. A search box is named `Buscar pedidos`.
- **Read pending.** Leave `Pendientes` selected. Run `.cursor/skills/verify-zentofact/scripts/control-zentofact api GET /orders-inbox .cursor/skills/verify-zentofact/artifacts/<run>/inbox.json`. HTTP 200. The visible count on `Pendientes` matches the pending orders in that payload (or both are zero).
- **Read ready.** Choose the tab `Listos para enviar`. Screenshot the tab selected (`aria-selected=true`) and at least the empty state or one order number. Do **not** click `Marcar listo para enviar`.
- **Proof.** Keep `inbox.json` and a screenshot where the `h1` and the selected tab label are readable.

## Gotchas

- `Marcar listo para enviar` talks to Falabella and enqueues stock jobs. Clicking it is not a read-only proof and can change warehouse stock.
- Inbox data is seller-specific. On this VM after seed, Pendientes includes PV-10001 and Listos para enviar includes PV-10003. An empty open inbox means the preview seed did not write `falabella_orders`.
- Sync (`POST /orders-inbox/sync`) hits Falabella. Do not run it from this recipe.
- Hash route: `/#/pedidos`, not `/pedidos`.
