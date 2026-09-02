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

- **Open the screen.** Navigate to `http://127.0.0.1:3011/#/bandeja`. The header `h1` reads `Bandeja`. A tablist named `Flujo de pedidos` contains `Pendientes`, `Listos`, and `Enviados`. A search box is named `Buscar pedidos`. Channel filters include `Falabella`, `Ripley`, and `Manual`.
- **Read pending.** Leave `Pendientes` selected. Run `.cursor/skills/verify-zentofact/scripts/control-zentofact api GET /logistics-inbox?stage=pending .cursor/skills/verify-zentofact/artifacts/<run>/bandeja.json`. HTTP 200. The visible count on `Pendientes` matches `counts.pending` in that payload (or both are zero). Preview rows include Falabella `PV-10001`, manual `QNC-10010`, and Ripley `RP-10020`.
- **Print manual.** Filter to `Manual` and print `QNC-10010`. That path builds a local PDF (label + packing sheet) and does not call a seller API. Do **not** click `Listo` on a Falabella row. Do **not** print Falabella or Ripley rows in this recipe; those calls hit live seller APIs.
- **Proof.** Keep `bandeja.json` and a screenshot where the `h1` and the selected tab label are readable.

## Gotchas

- `Bandeja Falabella` at `/#/pedidos` stays. This screen does not replace it.
- `Imprimir` builds Falabella, Ripley, and manual labels plus a packing sheet. Treat it as a mutation of print counts for Falabella.
- Hash route: `/#/bandeja`, not `/bandeja`.
