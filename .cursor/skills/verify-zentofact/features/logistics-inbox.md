# Logistics inbox

The logistics inbox lists Falabella, Ripley, Mercado Libre, and manual orders the warehouse must prepare or print. Pending, listos, and enviados are separate tabs. Metrics and today's sales totals stay out of this screen.

## Sub-features

- `bandeja-open` opens `/bandeja` with header `Bandeja`.
- `bandeja-pending` shows the `Pendientes` tab and its count.
- `bandeja-channels` can filter to Falabella, Ripley, Mercado Libre, or Manual.
- `bandeja-api` returns the same orders from `GET /logistics-inbox`.

## How to get to it (user POV)

- After sign-in, choose the sidebar link `Bandeja`.
- Open `http://127.0.0.1:3011/#/bandeja` directly.

## Driving it with control-zentofact

Preconditions:

- Baseline launch, doctor, and login have succeeded.
- The signed-in user can open `orders_inbox`.

- **Open the screen.** Navigate to `http://127.0.0.1:3011/#/bandeja`. The header `h1` reads `Bandeja`. The channel pills are `Todos`, `Falabella`, `Ripley`, `Mercado Libre`, and `Propios`.
- **Read pending.** Leave `Pendientes` selected and call `GET /logistics-inbox?stage=pending`. Preview includes Falabella `PV-10001`, own order `QNC-10010`, Ripley `RP-10020`, and Mercado Libre `ML-10030`.
- **Filter by channel or search.** Verify each marketplace pill narrows the list and search finds `QNC-10010`. Own orders show `Marcar entregado`.
- **Print manual and Mercado Libre.** `QNC-10010` builds a local ZentoFact PDF. In `Listos para enviar`, `ML-10031` prints the sandbox ME2 10×15 PDF. Do not print Falabella or Ripley in this recipe; Ripley printing remains disabled.
- **Ripley.** Confirmation and label printing remain disabled in the inbox; manage both directly in Ripley.
- **Proof.** Keep `bandeja.json` and a screenshot where the `h1` and the selected tab label are readable.

## Gotchas

- `Bandeja Falabella` at `/#/pedidos` stays. This screen does not replace it.
- `Imprimir` builds Falabella, Mercado Libre ME2, and own-order labels plus a packing sheet and records the print in `logistics_label_prints`. Ripley print stays paused. Mercado Libre requires an ME2 shipment in a printable substatus.
- Ripley confirmation and printing stay paused in the inbox. Do not invoke seller mutations from this recipe.
- `Sincronizar` calls `POST /order-management/sync` with `mode=incremental` and reconciles open Falabella statuses into `orders`. It also closes unified rows that `falabella_orders` already has as shipped/delivered, so they leave Vencidos even if the seller API is down. Preview keys are fake; the local close still runs.
- Marketplace orders already shipped or delivered must not appear in Vencidos or in Por preparar / Listos. Preview `PV-10013` is that drift case.
- Hash route: `/#/bandeja`, not `/bandeja`.
- The three layout variants tried before this design live on branch `yef/bandeja-prototipo-variantes-c820` (`/#/bandeja?variant=A|B|C`). `A` (cola por plazo) won; the others are not in `dev`.
