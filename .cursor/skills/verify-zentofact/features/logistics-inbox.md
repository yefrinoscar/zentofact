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

- **Open the screen.** Navigate to `http://127.0.0.1:3011/#/bandeja`. The header `h1` reads `Bandeja`. One line holds the tablist `Flujo de pedidos` (`Pendientes`, `Listos para enviar`, `Enviados`, underlined) on the left and, on the right, channel pills `Todos`, `Falabella`, `Ripley`, `Manual`, a small search `Buscar pedidos`, and a refresh icon button (`Sincronizar`). Below it a status line (`N pedidos · N sin enviar · actualizado …`) with `Imprimir etiquetas` and `Marcar todos`. Orders are a single list grouped under headings `Vencidos`, `Vencen mañana`, `Vencen hoy`, `Próximos` (sections named after the group), each row with a colored left rail. There is no store selector, no priority cards, and no table header.
- **Read pending.** Leave `Por preparar` selected. Run `.cursor/skills/verify-zentofact/scripts/control-zentofact api GET /logistics-inbox?stage=pending .cursor/skills/verify-zentofact/artifacts/<run>/bandeja.json`. HTTP 200. The pending badge matches `counts.pending`. Preview rows include Falabella `PV-10001` (`Marcar listo`), manual `QNC-10010` (`Imprimir`), and Ripley `RP-10020` (`Marcar listo`, one product line tagged `x3`). The SKU under the product name is the master SKU (`HOG025` on `RP-10020`), not the seller SKU (`S126718`).
- **Filter by channel or search.** Click `Ripley`: `RP-10020` and `RP-10021` stay. Type `QNC` in search: only `QNC-10010` stays. Clear both.
- **Print manual.** Use the row button `Imprimir` on `QNC-10010`. That path builds a local PDF (label + `GUÍA DE ARMADO`) and does not call a seller API. Afterwards the row action reads `Reimprimir`. Do **not** click `Marcar listo` on Falabella rows. Do **not** print Falabella or Ripley rows; Ripley print stays paused (`Etiqueta no disponible` / `Muy pronto.`).
- **Ripley ready.** On a Ripley pending row, `Marcar listo` opens a confirm that agendas recojo for tomorrow and the seller warehouse address. In preview this uses the SVC sandbox (`hasRipleySvcCredentials` is false). After confirm the row moves to `Listos para imprimir` and still cannot print.
- **Proof.** Keep `bandeja.json` and a screenshot where the `h1` and the selected tab label are readable.

## Gotchas

- `Bandeja Falabella` at `/#/pedidos` stays. This screen does not replace it.
- `Imprimir` builds Falabella and manual labels plus a packing sheet and records the print in `logistics_label_prints`. Ripley print stays paused. Treat Falabella print and Falabella `Marcar listo` as live seller mutations.
- Ripley `Marcar listo` calls `POST /logistics-inbox/:orderId/ready`, which agendas recojo in Seller Center (`manifest/schedule/generate`) and persists `metadata.ripleySvc.statusManagement = TO_PICKUP`. Preview sellers without SVC credentials use the sandbox.
- `Sincronizar` calls `POST /order-management/sync` (live marketplaces). Preview keys are fake; leave it alone unless the recipe is a sync check.
- Hash route: `/#/bandeja`, not `/bandeja`.
- The three layout variants tried before this design live on branch `yef/bandeja-prototipo-variantes-c820` (`/#/bandeja?variant=A|B|C`). `A` (cola por plazo) won; the others are not in `dev`.
