# Product sales

Admin sales table at `/ventas`. Each row is a master product. It sums only Falabella listings of that product across sellers, shows the seller breakdown in a drawer, and lists Ventas brutas, Te llega, and Falabella buyers. Manual and Ripley sales stay out. There is no visits column and no Más vendidos strip.

## Sub-features

- Header `h1` `Ventas` with toolbar search `Buscar por nombre, SKU u otros criterios`, period chips, and seller filter.
- KPI strip `Indicadores de ventas` with Ventas brutas and Te llega. Te llega shows the total, then Pagado vs Pendiente beside it.
- Falabella + Te llega cover the same sales as Ventas brutas. Lines without a Pagos cruce inherit the take rate from crossed sales of that product or seller. Uncrossed Te llega stays pendiente.
- Table `Ventas de productos` lists product, gross sales (with a Falabella/Te llega bar), Falabella, Te llega, and a Pagado/Pendiente compare bar. Each column has its own filter.
- Row click opens the product drawer with the same money split per seller.
- `Compradores de más de 5 unidades` tracks buyers over 5 units with phone, seller companies, products, orders, and sales. `Compradores más importantes` lists the rest. Both tables have column filters.
- Operator and vendedor cannot open `/ventas`.

## How to get to it (user POV)

1. Sign in as `admin@zentofact.local`.
2. Open `#/ventas` from the Operación sidebar item `Ventas`.
3. Keep the default 30-day range. Seeded Falabella orders appear as master products, including AG301 summed across LIMBO and MANTA RAYA.
4. Search `AG301`, open that row, and confirm both Falabella sellers in the drawer.
5. Read `Más de 5 unidades` for Max Preview (`74561743`, `987654321`, LIMBO and MANTA RAYA). Ana Preview stays under Otros compradores.

## Driving it with control-zentofact

```bash
.cursor/skills/verify-zentofact/scripts/control-zentofact login admin@zentofact.local
.cursor/skills/verify-zentofact/scripts/control-zentofact api GET /dashboard/product-sales .cursor/skills/verify-zentofact/artifacts/<run>/product-sales.json
```

Expect `totals.grossSales` ≈ `totals.falabellaTake` + `totals.arrives`, and `totals.arrives` ≈ `totals.paidArrives` + `totals.pendingArrives`. AG301 has both LIMBO and MANTA RAYA. Buyer list includes a seeded customer name.

Browser: `http://127.0.0.1:3011/#/ventas`. Handles: header `h1` `Ventas`; search `role=textbox[name='Buscar por nombre, SKU u otros criterios']`; table `aria-label='Ventas de productos'`; region `Indicadores de ventas`; region `Compradores de más de 5 unidades`; region `Compradores más importantes`.

## Gotchas

- The page uses `ordered_at`, not promised shipping. Cancelled and returned seed orders stay out.
- Do not call Falabella seller APIs for visits. The column is gone.
- Dashboard permission only. `operator@preview.zentofact.local` is redirected away.
- Search and column filters apply to the product table. KPIs and buyers stay on the whole period. Buyer column filters are client-side.
