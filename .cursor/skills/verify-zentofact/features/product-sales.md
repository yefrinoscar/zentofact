# Product sales

Admin sales table at `/ventas`. Each row is a master product. It sums only Falabella listings of that product across sellers, shows the seller breakdown in a drawer, and lists the period KPIs plus the Falabella buyers who spent the most. Marketplace visit counts are empty because Falabella does not send them. Manual and Ripley sales stay out.

## Sub-features

- Header `h1` `Ventas` with toolbar search `Buscar por nombre, SKU u otros criterios`, period chips, and seller filter.
- KPI strip `Indicadores de ventas` with Ventas brutas, Falabella, Te llega, Unidades, Pedidos, and Ticket for the selected period.
- Falabella and Te llega come from `sale_settlements` (Pagos). Without a cruce they show `—`.
- `Más vendidos` names the top products by gross sales, with units and seller count.
- Table `Ventas de productos` lists product name, copyable SKU, published, gross sales, Falabella, Te llega, units, orders, and visits (`—`).
- Row click opens the product drawer with per-seller gross sales, Falabella take, Te llega, and units.
- `Compradores más importantes` lists the highest-spend buyers with document, orders, units, and gross sales.
- Operator and vendedor cannot open `/ventas`.

## How to get to it (user POV)

1. Sign in as `admin@zentofact.local`.
2. Open `#/ventas` from the Operación sidebar item `Ventas`.
3. Keep the default 30-day range. Seeded Falabella orders appear as master products, including AG301 summed across LIMBO and MANTA RAYA.
4. Search `AG301`, open that row, and confirm both Falabella sellers in the drawer.
5. Read the Compradores section for a seeded Falabella buyer such as Ana Preview.

## Driving it with control-zentofact

```bash
.cursor/skills/verify-zentofact/scripts/control-zentofact login admin@zentofact.local
.cursor/skills/verify-zentofact/scripts/control-zentofact api GET /dashboard/product-sales .cursor/skills/verify-zentofact/artifacts/<run>/product-sales.json
```

Expect `totals.grossSales`, `totals.falabellaTake`, and `totals.arrives`. AG301 has Falabella take and Te llega from Pagos. At least one product has `sellers.length >= 2` when LIMBO and MANTA RAYA both sold it. `visits` is `null`. Buyer list includes a seeded customer name.

Browser: `http://127.0.0.1:3011/#/ventas`. Handles: header `h1` `Ventas`; search `role=textbox[name='Buscar por nombre, SKU u otros criterios']`; table `aria-label='Ventas de productos'`; region `Indicadores de ventas`; region `Compradores más importantes`.

## Gotchas

- The page uses `ordered_at`, not promised shipping. Cancelled and returned seed orders stay out.
- Visits stay `—`. Do not call Falabella seller APIs to fill them.
- Dashboard permission only. `operator@preview.zentofact.local` is redirected away.
- Search filters the product table. KPIs, top products, and buyers stay on the whole period.
