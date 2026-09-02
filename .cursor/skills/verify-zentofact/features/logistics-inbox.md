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
- **Read pending.** Leave `Pendientes` selected. Run `.cursor/skills/verify-zentofact/scripts/control-zentofact api GET /logistics-inbox?stage=pending .cursor/skills/verify-zentofact/artifacts/<run>/bandeja.json`. HTTP 200. The `Pendientes` badge matches `counts.pending`; the group counts match `counts.urgency`. Preview rows include Falabella `PV-10001` (Vencidos, `Marcar listo`), manual `QNC-10010` (Vencen mañana, `Imprimir`), and Ripley `RP-10020` (Próximos, `Imprimir`, one product line tagged `x3` because the seed inserts three unit lines).
- **Filter by channel or search.** Click `Ripley`: only `RP-10020` stays. Type `QNC` in `Buscar pedidos`: only `QNC-10010` stays. Clear both.
- **Print manual.** Click `Imprimir etiquetas`; checkboxes appear on printable rows and the status line reads `N de M etiquetas`. Keep only `QNC-10010` checked and click `Imprimir 1 en A4` (or use the row button). That path builds a local PDF (label + `GUÍA DE ARMADO`) and does not call a seller API. Afterwards the row action reads `Reimprimir`, and the detail dialog shows `Etiqueta impresa el …`. Do **not** click `Marcar listo` or `Marcar todos` on Falabella rows. Do **not** print Falabella or Ripley rows in this recipe; those calls hit live seller APIs.
- **Proof.** Keep `bandeja.json` and a screenshot where the `h1` and the selected tab label are readable.

## Gotchas

- `Bandeja Falabella` at `/#/pedidos` stays. This screen does not replace it.
- `Imprimir` builds Falabella, Ripley, and manual labels plus a packing sheet and records the print in `logistics_label_prints`. Treat it as a mutation.
- `Sincronizar` calls `POST /order-management/sync` (live marketplaces). Preview keys are fake; leave it alone unless the recipe is a sync check.
- Hash route: `/#/bandeja`, not `/bandeja`.
- The three layout variants tried before this design live on branch `yef/bandeja-prototipo-variantes-c820` (`/#/bandeja?variant=A|B|C`). `A` (cola por plazo) won; the others are not in `dev`.
