# Logistics inbox

The logistics inbox lists Falabella, Ripley, and manual orders the warehouse must prepare or print. Pending, listos, and enviados are separate tabs. Metrics and today's sales totals stay out of this screen.

## Sub-features

- `bandeja-open` opens `/bandeja` with header `Bandeja`.
- `bandeja-pending` shows the `Pendientes` tab and its count.
- `bandeja-channels` can filter to Falabella, Ripley, or Manual.
- `bandeja-api` returns the same orders from `GET /logistics-inbox`.

## How to get to it (user POV)

- After sign-in, choose the sidebar link `Bandeja`.
- Open `http://127.0.0.1:3011/#/bandeja` directly.

## Driving it with control-zentofact

Preconditions:

- Baseline launch, doctor, and login have succeeded.
- The signed-in user can open `orders_inbox`.

- **Open the screen.** Navigate to `http://127.0.0.1:3011/#/bandeja`. The header `h1` reads `Bandeja`. The layout mirrors `Bandeja Falabella`: a toolbar (store select, search `Buscar pedidos`, `Sincronizar`), a `Prioridad de entrega` section with cards `Vencidos`, `Vencen hoy`, `Vencen mañana`, `Próximos`, an `Estado del pedido` tablist named `Flujo de pedidos` with `Pendientes`, `Listos para enviar`, `Enviados`, and a table panel with channel pills `Todos`, `Falabella`, `Ripley`, `Manual`. Table columns: `Orden de venta`, `Productos`, `Ingresó`, `Entrega`, `Tienda`, `Siguiente paso`.
- **Read pending.** Leave `Pendientes` selected. Run `.cursor/skills/verify-zentofact/scripts/control-zentofact api GET /logistics-inbox?stage=pending .cursor/skills/verify-zentofact/artifacts/<run>/bandeja.json`. HTTP 200. The `Pendientes` badge matches `counts.pending`; the four priority cards match `counts.urgency`. Preview rows include Falabella `PV-10001` (overdue, `Marcar listo`), manual `QNC-10010` (tomorrow, `Imprimir`), and Ripley `RP-10020` (later, `Imprimir`).
- **Filter by priority.** Click a priority card: it reads `Filtro activo` and the table narrows to that urgency (`GET /logistics-inbox?stage=pending&urgency=tomorrow` returns the same rows). Click again to clear.
- **Print manual.** Click `Imprimir etiquetas`, keep only `QNC-10010` checked, and click `Imprimir 1 en A4` (or use the row button). That path builds a local PDF (label + `GUÍA DE ARMADO`) and does not call a seller API. Afterwards the row reads `Reimprimir` with `Impresa`, and the detail dialog shows `Etiqueta impresa el …`. Do **not** click `Marcar listo` or `Marcar todos` on Falabella rows. Do **not** print Falabella or Ripley rows in this recipe; those calls hit live seller APIs.
- **Proof.** Keep `bandeja.json` and a screenshot where the `h1` and the selected tab label are readable.

## Gotchas

- `Bandeja Falabella` at `/#/pedidos` stays. This screen does not replace it.
- `Imprimir` builds Falabella, Ripley, and manual labels plus a packing sheet and records the print in `logistics_label_prints`. Treat it as a mutation.
- `Sincronizar` calls `POST /order-management/sync` (live marketplaces). Preview keys are fake; leave it alone unless the recipe is a sync check.
- Hash route: `/#/bandeja`, not `/bandeja`.
