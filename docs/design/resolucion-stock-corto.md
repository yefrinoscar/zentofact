# Resolución de descuentos con stock corto

Spec UX + contrato de datos para resolver jobs de `/descuentos-stock` que fallan por falta de stock (`order_items.stock_state = 'skipped_insufficient'`).
Mock visual: [`resolucion-stock-corto.html`](./resolucion-stock-corto.html).

Alcance implementado (v1): **solo Mover stock** (transferencia atómica + reencolado). Los tabs *Cambiar maestro* e *Incidencia* quedan fuera: las incidencias se registran por otro lado y no se toca ese flujo. El historial del job se cubre con los movimientos y el código `TRF-…` en la fila.

Estado: diseño, listo para implementar. No hay cambios de producto en este documento.

---

## 1. Problema

Caso real: **LIMBO · Falabella · Orden 3254021996**, línea "Adorno de Pared de…", maestro `G1H0JAS`, seller SKU `CUA12454522`. El job queda en **Requiere atención** después de 3 de 3 intentos con el detalle "1 línea sin stock disponible. Repón stock y reintenta."

Casi siempre el stock físico existe. Lo que falla es que está asignado a otro producto maestro, por dos razones:

1. **Duplicado.** La importación creó un maestro por seller SKU. Las unidades viven en `G1H0JAS-B` (la misma pieza publicada por YAKURUNA) y `G1H0JAS` está en 0.
2. **Maestro equivocado.** El listing `CUA12454522` de LIMBO apunta a `G1H0JAS`, pero el producto real es otro maestro que sí tiene stock.

Para el caso 1 hay que **mover unidades** de un maestro a otro, desconectando ese stock del origen. Para el caso 2 hay que **cambiar el maestro del listing**. En ambos casos el descuento debe correr enseguida para que el marketplace no sancione al seller. Cuando no se puede resolver, el operador **reporta una incidencia** y puede deshacerla después.

## 2. Decisión principal

**Un único drawer lateral "Resolver stock" por job**, abierto desde la fila con stock corto. Cumple la regla de AGENTS.md: el detalle va en un drawer derecho y no hay expansión inline. El drawer tiene un **diagnóstico fijo arriba** y tres caminos en tabs segmentados:

| Tab | Cuándo | Resultado |
|---|---|---|
| **Mover stock** (por defecto) | Las unidades están en otro maestro, sea duplicado o sobrante | Transferencia atómica origen → destino. Luego se reencolan los jobs cubiertos |
| **Cambiar maestro** | El seller SKU apunta al maestro equivocado | Reasociar el listing (`allowReassign`), re-apuntar las líneas abiertas y reprocesar |
| **Incidencia** | No hay stock en ningún maestro, o el problema está en el marketplace | Ticket con motivo, destino y n.º, reversible |
| **Historial** | Siempre | Auditoría del job: intentos, transferencias, reasociaciones, incidencias |

Un solo drawer muestra los tres caminos con el mismo diagnóstico. Así el operador no elige a ciegas, y las acciones dejan de vivir como botones sueltos dentro de la celda "Detalle".

## 3. Dónde vive

### 3.1 Fila (DescuentosCola.tsx)

En jobs `failed`/`skipped` con `insufficient_items > 0`:

- **Celda Detalle**: el texto queda igual que hoy, por ejemplo "1 línea sin stock disponible. (3 de 3 intentos)". A la derecha va **un botón compacto `Resolver`** (`Button size="sm" variant="outline"`, icono `Wrench`) que abre el drawer en el tab *Mover stock*.
- **Menú `⋯`** (columna nueva de acciones, alineada a la derecha, `aria-label="Acciones de la orden 3254021996"`):
  - `Reintentar ahora`, que es el `retryJob` actual, sin cambios.
  - `Mover stock desde otro producto…`, que abre el drawer en el tab Mover.
  - `Cambiar maestro del SKU…`, que abre el drawer en el tab Cambiar maestro.
  - `Reportar incidencia…`, que abre el drawer en el tab Incidencia.
  - `Ver pedido`, que usa el `order-preview` existente.
- El botón suelto "Marcar ticket enviado" y su `window.confirm` **desaparecen**.
- "Asignar maestro" para líneas **sin producto** (`unmatched`) se queda como está, porque es otro problema.

Estados de fila nuevos o ajustados (`stock-job-presentation.ts`):

| Estado job | Badge | Detalle |
|---|---|---|
| `failed` + insuficiente | rojo **Requiere atención** | `1 línea sin stock · faltan 1 u de G1H0JAS (3 de 3 intentos)` + `Resolver` |
| `failed` + insuficiente + despacho < 24 h | rojo **Requiere atención** + ámbar **Despacha hoy 18:00** | igual |
| `pending` tras una transferencia | azul **En cola** | `Stock movido desde G1H0JAS-B (TRF-8F2K) · reintentando` |
| `done` tras una transferencia | esmeralda **Descontado** | `1 u descontada · stock movido desde G1H0JAS-B` |
| `warning` (incidencia) | ámbar **Incidencia abierta** | `Ticket FAL-558201 · Falabella Seller Center · hace 2 h · Sin reintentos automáticos` + `Ver` |
| `failed` tras deshacer una incidencia | rojo **Requiere atención** | `Incidencia cerrada sin resolver · 1 línea sin stock` |

Badge ámbar extra **Comparte stock: 3 pedidos** cuando hay otros jobs esperando el mismo maestro. Le dice al operador que una sola transferencia puede resolver varios jobs.

### 3.2 Productos (drawer, tab Inventario)

El historial de movimientos muestra los tipos nuevos `transfer_in` / `transfer_out` así:

- `Transferencia recibida · +1 · desde G1H0JAS-B · TRF-8F2K · Duplicado de importación · Ana P.`
- `Transferencia enviada · −1 · hacia G1H0JAS · TRF-8F2K · …`

El código `TRF-…` se puede copiar y, al hacer clic, abre el detalle de la transferencia (popover con origen, destino, jobs reencolados y nota). Este documento no agrega un punto de entrada para transferir desde Productos. El endpoint lo permite y se puede sumar después sin cambiar el contrato.

## 4. Drawer "Resolver stock"

`Sheet side="right"`, ancho `sm:max-w-[720px]`, sin tarjetas anidadas.

### 4.1 Cabecera (fija)

```
Resolver stock · Orden 3254021996                                   [×]
LIMBO  [Falabella]  ·  Requiere atención  ·  Cron · 3 de 3 intentos
Despacho comprometido: hoy 18:00 (en 5 h 20 min)    ← ámbar si < 24 h, rojo si vencido
```

El texto "Despacho comprometido" sale de `promised_shipping_time` (Falabella `raw_data.PromisedShippingTime`). En canales que no lo exponen se oculta la línea. No se muestra "—".

### 4.2 Diagnóstico (fijo, sobre los tabs)

Un bloque sobre `bg-muted/30`, sin borde de tarjeta. Contiene:

**Línea afectada.** Miniatura, título completo, `SKU interno G1H0JAS` (copiable), `SKU del seller CUA12454522`, `Shop SKU 1384420…`.

**Números** (cuadrícula de 5 cifras, `tabular-nums`):

| Requerido | Físico | Reservado | En devolución | **Disponible** |
|---|---|---|---|---|
| 1 | 0 | 0 | 0 | **0** (rojo) |

Frase: **"Faltan 1 u en G1H0JAS para este pedido · 3 u para todos los pedidos que esperan este producto."**

**Pedidos esperando este maestro** (tabla densa, máx. 5 filas y luego "ver 2 más"):

| Orden | Seller | Canal | Cant. | Despacho | Estado |
|---|---|---|---|---|---|
| 3254021996 (este) | LIMBO | Falabella | 1 | hoy 18:00 | Requiere atención |
| 3254030112 | LIMBO | Falabella | 1 | mañana 12:00 | Requiere atención |
| 2000011873 | MANTA RAYA | Ripley | 1 | 07/10 | En cola (reintento 2/3) |

Orden FIFO por despacho comprometido. Si falta, se ordena por `ordered_at`. **Esta misma prioridad decide qué jobs cubre una transferencia.**

Cuando la orden tiene **varias líneas sin stock**, aparece encima un `Select` "Línea a resolver (1 de 2)". Cada camino actúa sobre el maestro de la línea elegida.

### 4.3 Tab "Mover stock"

Formulario de una sola pantalla con 3 bloques separados por espacio, no por tarjetas.

**① Producto de origen**

- `Input` con icono Search: "Buscar por SKU interno, SKU del seller o nombre".
- Lista de candidatos (`DataTable` compacta, selección por radio en toda la fila):

| | Producto | Por qué se sugiere | Disponible | Comprometido | |
|---|---|---|---|---|---|
| ◉ | 🖼 Adorno de Pared de Metal Hojas Doradas<br>`G1H0JAS-B` · YAKURUNA [Falabella] | `Mismo Shop SKU` | **4** | 0 | |
| ○ | 🖼 Adorno de Pared Hojas Doradas 60 cm<br>`G1H0JAS2` · MANTA RAYA [Ripley] | `Mismo SKU del seller` | **2** | 1 · 1 pedido espera | ⚠ |
| ○ | 🖼 Cuadro Decorativo Hojas Metal<br>`DEC-HJ-01` | `Título similar 86 %` | **1** | 0 | |
| ○ | … | | 0 | | desactivado: "Sin stock disponible" |

  - La razón es un badge con texto. Tooltip para "Título similar": "Coincidencia por título e imagen; verifica que sea la misma pieza".
  - Orden: razón (shop SKU > seller SKU > similitud) y después disponible desc.
  - Los candidatos con disponible 0 se muestran atenuados y no se pueden seleccionar. Así el operador ve que el duplicado existe pero está vacío.
  - Con búsqueda manual: resultados paginados de 10 y la misma columna Disponible. Nunca carga el catálogo completo.
  - El destino (`G1H0JAS`) **nunca aparece** como candidato. Si se busca, sale atenuado con "Es el producto de destino".

**② Cantidad**

- `Input type=number` con stepper. Valor por defecto = **faltante de este pedido** (1).
- Atajos (botones `ghost` compactos): `Cubrir este pedido (1)` · `Cubrir todos los que esperan (3)`. El segundo queda limitado por el disponible del origen.
- Tope duro = **disponible del origen** (on_hand − reserved − pending_return). Si se supera: "YAKURUNA G1H0JAS-B solo tiene 4 u disponibles."
- **Motivo** (`Select`, obligatorio): `Duplicado de importación` (por defecto si la razón es shop/seller SKU) · `Stock registrado en otro producto` · `Corrección de conteo` · `Otro`. **Nota** (`Input`, opcional, obligatoria si el motivo es "Otro", máx. 500).
- `Checkbox` marcado: "Reintentar los pedidos cubiertos al confirmar".

**③ Efecto** (vista previa en vivo desde `POST /inventory/transfers/preview`, con debounce de 250 ms)

| | Disponible antes | Movimiento | Disponible después |
|---|---|---|---|
| Origen `G1H0JAS-B` | 4 | **−1** | 3 |
| Destino `G1H0JAS` | 0 | **+1** | 1 |

"Cubre **1 de 3** pedidos que esperan G1H0JAS: 3254021996. Los otros 2 seguirán en Requiere atención."

**Pie fijo del drawer:** `Cancelar` (outline) · **`Mover 1 u y reintentar`** (primario, icono `ArrowRightLeft`). El texto del botón cambia con la cantidad y el checkbox. Sin reintento queda `Mover 1 u`.

#### Confirmación (Dialog sobre el drawer)

```
¿Mover 1 unidad de G1H0JAS-B a G1H0JAS?

  G1H0JAS-B (YAKURUNA)   4 → 3 disponibles
  G1H0JAS   (LIMBO)      0 → 1 disponible

  Se reintentará: 3254021996
  Motivo: Duplicado de importación

Este movimiento queda registrado a tu nombre en ambos productos.
No cambia publicaciones ni stock en Falabella, Ripley o Mercado Libre.

                                   [Volver]  [Confirmar movimiento]
```

No se usa confirmación tecleada porque la acción es reversible: basta otra transferencia inversa. El diálogo no se cierra mientras guarda. Los errores se muestran dentro, encima del resumen.

#### Éxito (reemplaza el contenido del tab, el drawer sigue abierto)

```
✓ Stock movido · TRF-8F2K                                   [Copiar]
  1 u de G1H0JAS-B → G1H0JAS · Ana P. · 05/10/2026 12:41

  Pedidos reintentados
  3254021996   LIMBO · Falabella   ● Descontado         ← polling 2 s, máx. 30 s
  
  [Ver movimientos de G1H0JAS]        [Cerrar]
```

- El estado de cada job se actualiza con React Query (`refetchInterval: 2000` mientras haya `pending`/`processing`, se detiene en 30 s). El worker corre cada 5 s.
- Si después de 30 s sigue `pending`: "Sigue en cola. El worker lo procesará en segundos; puedes cerrar." y un botón `Reintentar ahora`.
- Si vuelve a `failed`, aparece un aviso rojo: "El reintento volvió a fallar: {last_error}". El diagnóstico se recarga en el mismo drawer.
- Si el operador no marcó reintentar, en lugar de la lista aparece **`Reintentar ahora (1 pedido)`**.
- Al cerrar se invalidan `['stock-jobs']`, `['product-inventory', id]` (origen y destino) y `['product-movements', id]`.

#### Casos borde

| Caso | Comportamiento |
|---|---|
| **Stock parcial** (origen 1, faltan 3) | Se permite mover 1. El efecto dice "Cubre 1 de 3 pedidos". El atajo "Cubrir todos" muestra `(1 de 3)`. Si este pedido requiere 2 y solo se pueden mover 1: "Aún faltará 1 u para esta orden; no se reintentará" y el checkbox de reintento se desactiva para ese job |
| **Origen con pedidos esperando** (columna Comprometido > 0) | Aviso ámbar dentro de ③: "MANTA RAYA tiene 1 pedido esperando G1H0JAS2 (2000011873). Si mueves 2 u, ese pedido quedará sin stock." Se exige el checkbox `Entiendo, mover de todas formas` → `acknowledgeCommitted: true` |
| **Origen = destino** | Imposible desde la UI (se excluye). La API responde 400 `same_product` |
| **Sin candidatos** | Estado vacío compacto: "No encontramos otro producto con stock para G1H0JAS." + "Busca por SKU o nombre, o" `Reportar incidencia` (lleva al tab) |
| **Destino ya tiene stock** (otro proceso repuso) | La preview muestra faltante 0: "G1H0JAS ya tiene stock suficiente. Reintenta sin mover." con botón `Reintentar ahora` |
| **Disponible del origen cambió entre preview y confirmación** | 409 `insufficient_stock` → dentro del Dialog: "G1H0JAS-B ahora tiene 0 u disponibles. Actualizamos los números; revisa y confirma de nuevo." Se refresca la preview |
| **El job cambió de estado** (otro operador lo resolvió) | 409 `job_changed` → "Esta orden ya no requiere stock (Descontado por Luis R. hace 1 min)." El drawer pasa a solo lectura |
| **Doble clic / reenvío** | La misma `Idempotency-Key` (generada al abrir el Dialog) devuelve la transferencia original con `replayed: true`. No hay doble movimiento |
| **Pedido cancelado** mientras se resolvía | No se reencola. La respuesta lo reporta en `skipped: [{jobId, reason:'order_cancelled'}]` y la UI muestra "No se reintentó: pedido cancelado" |
| **Incidencia abierta** en el job | El tab Mover se puede usar igual. Al confirmar con reintento, la incidencia se cierra automáticamente con resolución `resolved_by_transfer` (queda en el historial) |

### 4.4 Tab "Cambiar maestro"

Para cuando el listing está mal asociado.

```
El SKU del seller CUA12454522 (LIMBO · Falabella) descuenta hoy de:
  G1H0JAS · Adorno de Pared de…  · Disponible 0

Nuevo producto maestro
  [ buscador + candidatos: la misma lista del tab Mover, sin columna Comprometido ]

Efecto
  • CUA12454522 dejará de descontar de G1H0JAS y descontará de G1H0JAS-B.
  • 2 líneas abiertas de LIMBO · Falabella pasarán a G1H0JAS-B: 3254021996, 3254030112.
  • G1H0JAS conserva su stock y sus otras 1 publicación(es).    ← o "quedará sin publicaciones" (ámbar)
  • Disponible de G1H0JAS-B: 4 → 2 tras descontar.

Motivo [Select: Maestro equivocado · Duplicado de importación · Otro]  Nota [ ]
                                         [Cancelar]  [Cambiar maestro y reintentar]
```

- Confirmación en Dialog: "Las ventas futuras de CUA12454522 descontarán de G1H0JAS-B. Los descuentos ya aplicados no cambian."
- Solo re-apunta líneas en `skipped_unmapped`/`skipped_insufficient` de órdenes abiertas, igual que `applyStockToOpenOrders` hoy. Los descuentos ya aplicados en el maestro anterior **no se mueven**. Se informa en la UI: "1 venta ya descontada de G1H0JAS no se mueve; si corresponde, usa Mover stock."
- Si el nuevo maestro no alcanza para todas las líneas re-apuntadas, las que no alcanzan quedan en Requiere atención y el resultado lo dice.
- Éxito: el mismo patrón de lista de pedidos con polling que en Mover stock.

### 4.5 Tab "Incidencia"

Formulario (reemplaza `window.confirm`):

| Campo | Control | Reglas |
|---|---|---|
| Motivo | `Select` | `Sin stock físico` · `Producto dañado o incompleto` · `Error de publicación en el marketplace` · `Pedido duplicado` · `Otro` (obligatorio) |
| Enviado a | `Select` | `Soporte Falabella` · `Soporte Ripley` · `Soporte Mercado Libre` · `Equipo interno` (por defecto, el canal de la orden) |
| N.º de ticket | `Input` | opcional, 100, `font-mono` |
| Nota | `Textarea` (`Input` multilínea compartido) | obligatoria, 500 |

Texto de ayuda: "La orden dejará de reintentarse sola. No cambia stock ni el estado del pedido en el marketplace. Puedes cerrar la incidencia cuando se resuelva."
Botón: **`Registrar incidencia`** (primario). Sin diálogo extra porque se puede deshacer.

**Con incidencia abierta**, el tab muestra la ficha en solo lectura:

```
[Incidencia abierta]  Sin stock físico · Soporte Falabella · Ticket FAL-558201
Registrada por Ana P. · 05/10/2026 10:12 · 1 línea, 1 u pendiente
"Se pidió cancelación al seller center, cliente avisado."

Cerrar incidencia:
  ( ) Se resolvió: reintentar el descuento     → job pending, attempts 0
  ( ) Reabrir: volver a Requiere atención      → job failed, sin reintento
  Nota de cierre [            ]  (obligatoria)
                                              [Cerrar incidencia]
```

- "Reabrir" es el **deshacer**: el job vuelve a `failed` con `last_error` original, listo para Mover o Cambiar maestro.
- Si la orden se cancela en el marketplace, el job pasa a `cancelled` por la sincronización normal y la incidencia queda `closed` con `resolution: 'order_cancelled'` sin intervención manual.
- Todas las incidencias, también las cerradas, quedan en `orders.metadata.stockIncidents[]` (historial). `stockIncident` sigue apuntando a la vigente para no romper lecturas actuales.

### 4.6 Tab "Historial"

Línea de tiempo compacta (lista, sin tarjetas), lo más reciente arriba:

```
12:41  Ana P.   Stock movido · TRF-8F2K · 1 u desde G1H0JAS-B · Duplicado de importación
12:41  Sistema  Reintento manual encolado
12:42  Sistema  Descontado · 1 u de G1H0JAS
10:12  Ana P.   Incidencia registrada · Sin stock físico · FAL-558201
09:30  Cron     Intento 3 de 3 · 1 línea sin stock disponible
```

Fuente: `GET /catalog/stock-jobs/jobs/:id/events` (§6.7).

## 5. Permisos

- Ver la cola y abrir el drawer: `productos` (igual que la ruta hoy).
- **Mover stock, Cambiar maestro, registrar/cerrar incidencia**: `productos`. Se aplica `requirePermission('productos')` en el servidor a los endpoints nuevos. Las rutas de stock-jobs actuales no lo aplican, así que se corrige de paso en las que mutan.
- Todas las mutaciones registran `actor_user_id` de la sesión. Nunca se acepta actor desde el body.
- Ninguna acción llama APIs de marketplace.

## 6. Contrato de datos / API

Convenciones existentes: respuestas `ok(c, data)` / `fail(c, e, status)`. Los errores llevan `{ error, code }`. Idempotencia por header `Idempotency-Key`, con fallback a `body.idempotencyKey`, igual que `/products/:id/inventory/adjust`.

### 6.1 Esquema

```sql
-- tipos de movimiento nuevos (MOVEMENT_TYPES en inventory-service.js)
--   'transfer_out', 'transfer_in'
-- No usar adjustment_in/out: system-config.js los cuenta como "stock sembrado".

create table inventory_transfers (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,            -- 'TRF-8F2K' (visible, copiable)
  source_product_id bigint not null references products(id),
  target_product_id bigint not null references products(id),
  quantity         integer not null check (quantity > 0),
  reason_code      text not null,                   -- import_duplicate | stock_on_other_product | count_correction | other
  note             text,
  actor_user_id    text not null,
  stock_job_id     bigint references inventory_stock_jobs(id),  -- job desde el que se originó (nullable)
  idempotency_key  text not null unique,
  requeued_job_ids bigint[] not null default '{}',
  acknowledged_committed boolean not null default false,
  created_at       timestamptz not null default now(),
  check (source_product_id <> target_product_id)
);
create index on inventory_transfers (source_product_id, created_at desc);
create index on inventory_transfers (target_product_id, created_at desc);
```

Cada transferencia genera **dos** `inventory_movements` en la misma transacción:

| campo | salida | entrada |
|---|---|---|
| product_id | origen | destino |
| movement_type | `transfer_out` | `transfer_in` |
| quantity_delta | −N | +N |
| source | `transfer` | `transfer` |
| idempotency_key | `transfer:{key}:out` | `transfer:{key}:in` |
| reason | texto del motivo + nota | ídem |
| metadata | `{ transferId, transferCode, counterpartProductId, counterpartMainSku, stockJobId }` | ídem |

### 6.2 `GET /catalog/stock-jobs/jobs/:id/shortage`, diagnóstico

```jsonc
{
  "job": { "id": 9123, "status": "failed", "attempts": 3, "maxAttempts": 3, "source": "cron",
           "lastError": "1 línea sin stock disponible. Repón stock y reintenta.", "incident": null },
  "order": { "id": 55120, "orderNumber": "3254021996", "companyId": 4, "companyName": "LIMBO",
             "channelCode": "falabella", "fulfillmentStatus": "pending",
             "promisedShippingAt": "2026-10-05T23:00:00.000Z" },
  "lines": [{
    "orderItemId": 88001, "quantity": 1, "missing": 1,
    "listingId": 3301, "sellerSku": "CUA12454522", "shopSku": "138442012",
    "product": { "id": 701, "mainSku": "G1H0JAS", "title": "Adorno de Pared de Metal…", "imageUrl": "…" },
    "inventory": { "onHand": 0, "reserved": 0, "pendingReturn": 0, "available": 0 }
  }],
  "waiting": [   // jobs failed|skipped|pending|warning con líneas skipped_insufficient del mismo producto (por línea seleccionada)
    { "jobId": 9123, "orderNumber": "3254021996", "companyName": "LIMBO", "channelCode": "falabella",
      "quantity": 1, "status": "failed", "promisedShippingAt": "…", "isCurrent": true },
    { "jobId": 9130, "orderNumber": "3254030112", "companyName": "LIMBO", "channelCode": "falabella",
      "quantity": 1, "status": "failed", "promisedShippingAt": "…", "isCurrent": false }
  ],
  "missingForProduct": 3
}
```

Query opcional `?orderItemId=` cuando la orden tiene varias líneas cortas. Si falta, se usa la primera.

### 6.3 `GET /products/:id/inventory/transfer-candidates`

`:id` = producto **destino**. Query: `q` (búsqueda manual), `orderItemId`, `limit` (máx. 20, por defecto 10), `offset`.

Sin `q`: sugerencias, en este orden:
1. `same_shop_sku`: otro maestro con un listing del mismo `shop_sku`.
2. `same_seller_sku`: mismo `seller_sku` en otra empresa o canal.
3. `similar_title`: `scoreFalabellaAssociation` ≥ 0.75 sobre título e imagen (reutiliza `catalog-association.js`; es candidato a duplicado).

Con `q`: búsqueda por `main_sku`, `seller_sku`, `shop_sku` o título, paginada.

```jsonc
{
  "candidates": [{
    "productId": 742, "mainSku": "G1H0JAS-B", "title": "Adorno de Pared de Metal Hojas Doradas", "imageUrl": "…",
    "inventory": { "onHand": 4, "reserved": 0, "pendingReturn": 0, "available": 4 },
    "committed": { "units": 0, "jobs": [] },          // demanda de jobs esperando ESTE origen
    "reasons": [{ "kind": "same_shop_sku", "label": "Mismo Shop SKU", "score": 1 }],
    "listings": [{ "companyName": "YAKURUNA", "channelCode": "falabella", "sellerSku": "CUA12454522-Y" }],
    "selectable": true, "disabledReason": null        // "Sin stock disponible" | "Es el producto de destino"
  }],
  "totalCount": 3, "limit": 10, "offset": 0
}
```

### 6.4 `POST /inventory/transfers/preview`, sin escritura

```jsonc
// req
{ "sourceProductId": 742, "targetProductId": 701, "quantity": 1, "stockJobId": 9123 }
// res
{
  "source": { "productId": 742, "mainSku": "G1H0JAS-B", "availableBefore": 4, "availableAfter": 3,
              "committedUnits": 0, "committedJobsAffected": [] },
  "target": { "productId": 701, "mainSku": "G1H0JAS", "availableBefore": 0, "availableAfter": 1,
              "missingBefore": 3, "missingAfter": 2 },
  "covered":   [{ "jobId": 9123, "orderNumber": "3254021996", "quantity": 1 }],   // FIFO por despacho
  "uncovered": [{ "jobId": 9130, "orderNumber": "3254030112", "quantity": 1 }, { "jobId": 9141, … }],
  "currentJobCovered": true,
  "requiresAcknowledgeCommitted": false,
  "errors": []   // [{ code: 'exceeds_available', message: '…' }] sin lanzar 4xx, para mostrar inline
}
```

### 6.5 `POST /inventory/transfers`, transferencia atómica (+ reencolado)

Header `Idempotency-Key: <uuid>` (generado al abrir el Dialog de confirmación). Permiso `productos`.

```jsonc
// req
{
  "sourceProductId": 742,
  "targetProductId": 701,
  "quantity": 1,
  "reasonCode": "import_duplicate",
  "note": "Misma pieza importada por YAKURUNA",
  "stockJobId": 9123,                 // opcional: origen del flujo (auditoría + validación)
  "retry": true,                      // reencolar jobs cubiertos
  "retryJobIds": [9123],              // opcional: limitar; por defecto = preview.covered
  "acknowledgeCommitted": false
}
// 201
{
  "transfer": {
    "id": "6b1e…", "code": "TRF-8F2K", "quantity": 1,
    "reasonCode": "import_duplicate", "note": "…",
    "actor": { "id": "usr_…", "name": "Ana P." }, "createdAt": "2026-10-05T17:41:02Z",
    "source": { "productId": 742, "mainSku": "G1H0JAS-B", "onHandBefore": 4, "onHandAfter": 3, "movementId": 120331 },
    "target": { "productId": 701, "mainSku": "G1H0JAS",   "onHandBefore": 0, "onHandAfter": 1, "movementId": 120332 }
  },
  "requeued": [{ "jobId": 9123, "orderNumber": "3254021996", "status": "pending" }],
  "skipped":  [],                     // [{ jobId, reason: 'order_cancelled' | 'not_covered' | 'job_changed' }]
  "incidentsClosed": [],              // jobIds cuya incidencia se cerró con resolved_by_transfer
  "replayed": false
}
```

Algoritmo (una sola transacción, `inTransaction`):
1. Validar `source ≠ target` (400 `same_product`), `quantity` entero > 0, `reasonCode` válido y `note` si es `other`.
2. Si existe `inventory_transfers.idempotency_key`, devolver ese registro con `replayed: true` y status 200.
3. `insert … on conflict do nothing` en `product_inventory` para ambos y luego `select … for update` **ordenado por product_id** para evitar deadlock entre transferencias cruzadas.
4. `available(source) = on_hand − reserved − pending_return`. Si `quantity > available`, responder 409 `insufficient_stock` con `{ available }`. Se usa *available* y no on_hand, porque lo reservado ya pertenece a otros pedidos.
5. `committedUnits(source)` = demanda de jobs que esperan el origen. Si `quantity > available − committedUnits` y no hay `acknowledgeCommitted`, responder 409 `source_committed` con la lista de jobs.
6. Insertar `inventory_transfers` y dos `applyInventoryMovement` (`transfer_out` y `transfer_in`) con las claves de §6.1.
7. Si `retry`: calcular los cubiertos FIFO con el nuevo disponible del destino. Para cada job en `failed|skipped`, aplicar la misma actualización que `retryJob` (`pending`, `attempts=0`). Para un job en `warning`, cerrar la incidencia (`resolved_by_transfer`) y pasarlo a `pending`. Bloquear la orden igual que `reportStockIncident` (`orders for update`).
8. Si `stockJobId` ya no está en `failed|skipped|warning|pending`, responder 409 `job_changed` **antes** de mover stock, salvo que la orden siga teniendo líneas cortas del destino.
9. Después del commit: `drainStockQueue({ limit: requeued.length })` en segundo plano (no bloquea la respuesta).

Errores: `400 same_product | invalid_quantity | invalid_reason`, `403`, `404 product_not_found`, `409 insufficient_stock | source_committed | job_changed`.

### 6.6 `GET /inventory/transfers/:idOrCode`

Devuelve el objeto `transfer` de §6.5 más `requeuedJobs` con su estado actual. Lo usa el popover de Productos y el Historial.

### 6.7 `GET /catalog/stock-jobs/jobs/:id/events`

```jsonc
{ "events": [
  { "at": "…", "kind": "transfer",   "actor": "Ana P.", "label": "Stock movido", "ref": "TRF-8F2K",
    "detail": "1 u desde G1H0JAS-B · Duplicado de importación" },
  { "at": "…", "kind": "requeue",    "actor": "Sistema", "label": "Reintento manual encolado" },
  { "at": "…", "kind": "attempt",    "actor": "Cron", "label": "Intento 3 de 3", "detail": "1 línea sin stock disponible" },
  { "at": "…", "kind": "incident_open" | "incident_close" | "reassign" | "done", … }
]}
```

Se arma con `inventory_transfers` (`stock_job_id` o `requeued_job_ids @> {id}`), `orders.metadata.stockIncidents[]`, `inventory_movements` de las líneas de la orden y `inventory_stock_jobs`. Para los intentos se necesita una tabla ligera nueva `inventory_stock_job_events (job_id, kind, actor_user_id, payload jsonb, created_at)`, escrita en `finishJob`, `retryJob`, incidencias y transferencias. Sin ella, solo se puede mostrar el último intento.

### 6.8 `POST /catalog/stock-jobs/requeue`, reencolado masivo

```jsonc
// req
{ "jobIds": [9123, 9130] }
// res
{ "requeued": [{ "jobId": 9123, "status": "pending" }], "skipped": [{ "jobId": 9130, "reason": "job_changed" }] }
```

Misma semántica que `retryJob` (`failed|skipped → pending`, `attempts=0`). Lo usan "Reintentar ahora (n pedidos)" en el estado de éxito y el caso "Destino ya tiene stock".

### 6.9 `POST /catalog/stock-jobs/jobs/:id/reassign-listing`, cambiar maestro

Compone `linkListing({ listingId, productId, allowReassign: true })` y `applyStockToOpenOrders(listingId)` **en una sola transacción**. Hoy son dos llamadas separadas; si la segunda falla, el listing queda movido sin reprocesar.

```jsonc
// req  (Idempotency-Key)
{ "orderItemId": 88001, "listingId": 3301, "targetProductId": 742,
  "reasonCode": "wrong_master", "note": "", "retry": true }
// res
{ "listing": { "id": 3301, "sellerSku": "CUA12454522", "fromProductId": 701, "toProductId": 742 },
  "openLines": { "matched": 2, "applied": 1, "skipped": 1 },
  "requeued": [{ "jobId": 9123, "status": "pending" }],
  "previousProductListingsLeft": 1,
  "event": { "kind": "reassign", "at": "…", "actor": "Ana P." } }
```

Preview con `POST …/reassign-listing/preview` (mismo body, sin escritura) → `{ openLines: [{orderNumber, quantity}], targetAvailableAfter, previousProductListingsLeft, alreadyAppliedOnPrevious: 1 }`.

### 6.10 Incidencias

**Crear** con `POST /catalog/stock-jobs/jobs/:id/incident` (endpoint existente, payload ampliado y compatible hacia atrás porque `note` sigue siendo el único campo obligatorio):

```jsonc
{ "reasonCode": "no_physical_stock", "sentTo": "falabella_support", "ticketNumber": "FAL-558201",
  "note": "Se pidió cancelación al seller center." }
```

`incident` agrega `id`, `reasonCode`, `sentTo`, `ticketNumber` y `status: 'open'`. Hoy se guarda `'reported'`; se lee como alias de `open`.

**Cerrar o deshacer** con `POST /catalog/stock-jobs/jobs/:id/incident/close`:

```jsonc
// req
{ "resolution": "retry" | "reopen", "note": "Stock repuesto por conteo" }
// res
{ "job": { "id": 9123, "status": "pending" | "failed", … },
  "incident": { "id": "inc_…", "status": "closed", "resolution": "retry", "closedAt": "…", "closedBy": "usr_…", "closeNote": "…" } }
```

- `retry` lleva el job a `pending` con `attempts=0`. `reopen` lo lleva a `failed` con `attempts=MAX`, `last_error = incident.previousError`.
- 409 `incident_not_open` si ya está cerrada.
- La incidencia se mueve de `orders.metadata.stockIncident` a `stockIncidents[]` con su cierre. `stockIncident` queda `null`.
- Las resoluciones automáticas (`resolved_by_transfer`, `order_cancelled`) usan el mismo registro, con `closedBy = actor` o `'system'`.

### 6.11 Claves de React Query

| Key | Endpoint |
|---|---|
| `['stock-job-shortage', jobId, orderItemId]` | §6.2 |
| `['transfer-candidates', targetId, q, offset]` | §6.3 (`keepPreviousData`) |
| `['transfer-preview', src, tgt, qty]` | §6.4 (debounce) |
| `['stock-job-events', jobId]` | §6.7 |
| invalidar al mutar | `['stock-jobs']`, `['product-inventory', src/tgt]`, `['product-movements', src/tgt]`, `['stock-job-shortage', *]` |

Sin `useEffect` para cargar datos: el drawer se abre con el `jobId` en estado de la ruta y los datos salen de las queries. El reset del formulario se hace en `onOpenChange`.

## 7. Microcopy (resumen)

| Lugar | Texto |
|---|---|
| Botón fila | `Resolver` |
| Título drawer | `Resolver stock · Orden {n}` |
| Frase diagnóstico | `Faltan {x} u en {SKU} para este pedido · {y} u para todos los pedidos que esperan este producto.` |
| Sin candidatos | `No encontramos otro producto con stock para {SKU}.` |
| Botón principal | `Mover {n} u y reintentar` / `Mover {n} u` |
| Aviso comprometido | `{SELLER} tiene {k} pedido(s) esperando {SKU}. Si mueves {n} u, {quedará/quedarán} sin stock.` |
| Éxito | `Stock movido · {TRF}` |
| Seguro marketplace | `No cambia publicaciones ni stock en Falabella, Ripley o Mercado Libre.` |
| Incidencia ayuda | `La orden dejará de reintentarse sola. No cambia stock ni el estado del pedido en el marketplace.` |
| Cerrar incidencia | `Se resolvió: reintentar el descuento` / `Reabrir: volver a Requiere atención` |

## 8. Fuera de alcance

- Fusionar maestros duplicados en uno (merge de productos). El flujo lo deja preparado: el aviso "G1H0JAS quedará sin publicaciones" es el punto de entrada natural para una futura acción "Fusionar".
- Cualquier mutación en marketplaces (stock, publicación, cancelación).
- Ubicaciones físicas o almacenes.
- Transferencias masivas entre muchos productos.

## 9. Orden de implementación sugerido

1. Esquema (`inventory_transfers`, tipos de movimiento, `inventory_stock_job_events`) y `transferInventory()` en `inventory-service.js` con tests de atomicidad, idempotencia y deadlock.
2. Endpoints §6.2–6.5 y §6.8, más `requirePermission('productos')`.
3. Drawer con diagnóstico y tab Mover (incluye éxito con polling).
4. Incidencias §6.10 y tab Incidencia; quitar `window.confirm`.
5. Cambiar maestro §6.9.
6. Historial §6.7 y etiquetas `transfer_*` en el tab Inventario de Productos.
