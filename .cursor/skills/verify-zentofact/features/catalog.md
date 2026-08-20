# Catalog

The catalog shows canonical products, internal SKU, and on-hand stock in one operational table. Seller publications live in the product drawer, not on the master row.

## Sub-features

- `catalog-open` opens `/productos` with header `Catálogo de productos`.
- `catalog-list` shows a paginated table named `Catálogo de productos`.
- `catalog-search` filters by product, SKU, or brand from the toolbar.
- `catalog-api` returns the same working set from `GET /products`.

## How to get to it (user POV)

- After sign-in, choose the sidebar link `Productos`.
- Open `http://127.0.0.1:3011/#/productos` directly.

## Driving it with control-zentofact

Preconditions:

- Baseline launch, doctor, and login have succeeded.
- The signed-in user can open `productos` (seeded superadmin can).

- **Open the screen.** Navigate to `http://127.0.0.1:3011/#/productos`. The header `h1` reads `Catálogo de productos`. The search box is named `Buscar por producto, SKU o marca`. The table is named `Catálogo de productos`.
- **Read the working set.** Run `.cursor/skills/verify-zentofact/scripts/control-zentofact api GET /products?limit=5 .cursor/skills/verify-zentofact/artifacts/<run>/products.json`. HTTP status is 200. The JSON includes a `products` array. Each visible row's name or `mainSku` appears in that payload (or the table shows the empty state and the array is empty).
- **Search.** Type a SKU taken from `products.json` into `Buscar por producto, SKU o marca` and press Enter. The table shows that product. Confirm with `GET /products?search=<sku>&limit=5` saved as `products-search.json`.
- **Proof.** Screenshot the header plus at least one product row (or the empty table). Keep both JSON files. Do not open publication switches and do not POST `/products/:id/inventory/adjust`.

## Gotchas

- The route is a hash URL. Navigating to `/productos` without `#/` misses the app router.
- Master rows are channel-agnostic. Marketplace badges on the master row are a regression, not a proof of catalog health.
- `productos` is hidden in the production nav (`hiddenInProduction`). Local/dev still shows it for the seeded admin.
- A summary KPI without the table is not proof that the list loaded.
