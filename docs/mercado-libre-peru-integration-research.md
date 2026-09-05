# Integración con Mercado Libre Perú: API, pedidos, estados y productos

Investigación realizada el 4 de septiembre de 2026. El alcance está limitado a fuentes oficiales del portal de desarrolladores de **Mercado Libre Perú** (`developers.mercadolibre.com.pe`) y a las páginas hermanas del mismo sitio que documentan el mismo host `https://api.mercadolibre.com`. No se usaron blogs, SDKs de terceros ni documentación de integradores.

ZentoFact ya declara el canal `mercado_libre` en `order_channels` y asocia publicaciones con `product_listings` (`channel_code`, `company_id`, `seller_sku`) hacia un producto maestro (`products.main_sku`). Esta nota describe qué publica Mercado Libre y cómo encaja en ese modelo. No implementa el conector.

## Conclusión ejecutiva

Mercado Libre no tiene un Seller Center con API key como Falabella o Mirakl. La integración es **OAuth 2.0 Authorization Code** contra una aplicación creada en DevCenter: cada Empresa (LIMBO, MANTA RAYA, YAKURUNA) otorga un grant con la cuenta **administrador** del seller. El host de API es único: `https://api.mercadolibre.com`. El sitio peruano es `site_id=MPE` y la moneda de los ejemplos peruanos es `PEN`.

Una **orden** es la compra de un solo ítem (varias unidades del mismo). Un carrito con tres productos distintos produce **tres órdenes** y, en Perú, un **pack** que las agrupa. ZentoFact no debe fusionar esas órdenes: cada `order.id` es un Pedido. El estado que mueve la bodega es el del **shipment**, no el `status` comercial de la orden (`paid` cubre casi toda la vida útil operativa).

El identificador para asociar publicaciones al maestro es el atributo **`SELLER_SKU`**. El campo `seller_custom_field` es uso interno del vendedor y Mercado Libre declara que no tiene relación con el SKU. En la orden, `order_items[].item.seller_sku` se llena desde `SELLER_SKU`.

No hay sandbox: las pruebas se hacen en producción con **usuarios de test**. Los SDK oficiales de GitHub están fuera de mantenimiento desde abril de 2021. Hay que llamar REST.

## Matriz de evidencia

| Área | Confirmado en docs oficiales | No publicado o incompleto |
| --- | --- | --- |
| Crear app, APP ID, secret, HTTPS redirect, scopes, tópicos | Confirmado | — |
| OAuth Authorization Code, refresh de un solo uso, `user_id`, PKCE opcional | Confirmado | Host de authorize de Perú como string literal (solo “cambiar `.com.ar` por el dominio del país”) |
| Host de API | `https://api.mercadolibre.com` | Un segundo host `api.mercadolibre.com.pe` |
| `site_id` MPE | Ejemplos de envíos, facturación, categorías usadas y auto-pausa de stock | Tabla oficial completa de todos los `site_id` en las páginas consultadas |
| Listar y leer órdenes, packs, ítems de orden | Confirmado | — |
| Estados de orden y de pack | Confirmado | Enum completo de estados de pago de Mercado Pago en las páginas de seller |
| Estados de envío | `GET /shipment_statuses` + mapeo front | — |
| Etiqueta ME2 PDF/ZPL | `GET /shipment_labels` en la guía PE de ME2 | Disponibilidad de Full en Perú para imprimir (Full no imprime etiqueta de venta) |
| `POST .../process/ready_to_ship` | Documentado para ME2 + `manufacturing_time` | `manufacturing_time` no está listado para Perú; no se afirma que el POST funcione en MPE |
| Notificaciones `orders_v2`, `items`, `shipments` | Confirmado | — |
| `SELLER_SKU` vs `seller_custom_field` | Confirmado | — |
| User Products (`user_product_id`) | Confirmado; afecta stock y variaciones | Endpoint para listar todas las familias de un seller |
| Catálogo ML en Perú | Confirmado | — |
| Facturación MPE boleta/factura | Confirmado (DNI/CE → boleta, RUC → factura) | Facturador ML (`topic invoices`) para Perú |
| Full / fulfillment stock API | Documentado para AR, BR, MX, CL, CO | Perú no aparece en esa lista |
| Sandbox | Confirmado que **no existe** | — |
| SDK oficiales | Confirmado deprecados | — |

## 1. Cómo se crea la integración

Fuente: [Crea una aplicación](https://developers.mercadolibre.com.pe/es_ar/crea-una-aplicacion-en-mercado-libre-es), [Autenticación y autorización](https://developers.mercadolibre.com.pe/es_ar/autenticacion-y-autorizacion), [Realiza pruebas](https://developers.mercadolibre.com.pe/es_ar/realiza-pruebas).

### 1.1 Aplicación en DevCenter

1. Entrar a **Mis aplicaciones / DevCenter** con la cuenta dueña de la integración (entidad legal). El listado de países de esa página incluye **Perú**.
2. Completar nombre único, descripción (≤ 150 caracteres, se muestra al seller al otorgar permiso) y logo.
3. **Redirect URI en HTTPS**, exacta, sin query variable.
4. Opcional: activar **PKCE**. Si está activo, el challenge es obligatorio.
5. Scopes: **Lectura** (GET), **Escritura** (PUT/POST/DELETE) y acceso **offline** para refresh mientras el seller no está logueado.
6. Callback de notificaciones + tópicos (Orders, Messages, Items, Catalog, Shipments, Promotions en el formulario; la guía de notificaciones lista más).
7. Guardar. Quedan **APP ID** (`client_id`) y **Secret Key** (`client_secret`).

A partir del **30/08/2026** las apps deben separarse entre Mercado Libre y Mercado Pago. `GET /applications/$APP_ID` no debe devolver scopes `urn:mp:…`.

Solo el **administrador** del seller puede otorgar el grant. Un operador/colaborador produce `invalid_operator_user_id`.

Rotar el secret invalida tokens. Se puede programar la renovación hasta 7 días; durante esa ventana conviven dos secrets.

El Developer Partner Program (certificación) en Perú pide un piso de GMV; **no es requisito para llamar la API**.

### 1.2 OAuth 2.0

Flujo: Authorization Code (server side).

1. Redirigir al seller:

```
https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=$APP_ID&redirect_uri=$YOUR_URL
```

La guía usa Argentina como ejemplo y pide **cambiar `.com.ar` por el dominio del país**. No publica la URL peruana como string. El dominio público de Perú es `mercadolibre.com.pe`; la URL de authorize peruana se infiere como `https://auth.mercadolibre.com.pe/authorization` y debe validarse en el primer grant real. Parámetros opcionales: `state` (CSRF; ML no lo valida), `code_challenge` + `code_challenge_method` (`S256` o `plain`).

2. El seller vuelve a `redirect_uri?code=…`.
3. Intercambiar el code (parámetros **en el body**, no en query):

```http
POST https://api.mercadolibre.com/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&client_id=$APP_ID
&client_secret=$SECRET_KEY
&code=$CODE
&redirect_uri=$REDIRECT_URI
```

Respuesta oficial:

```json
{
  "access_token": "APP_USR-…",
  "token_type": "bearer",
  "expires_in": 10800,
  "scope": "offline_access read write",
  "user_id": 1234567,
  "refresh_token": "TG-…"
}
```

`expires_in` es 10800 segundos; el texto de la guía dice **6 horas**. El `refresh_token` dura **6 meses**, es de **un solo uso** y solo vale el último. Cada refresh devuelve uno nuevo. Guardar `user_id`: es el seller.

4. Llamadas posteriores:

```http
Authorization: Bearer $ACCESS_TOKEN
```

No enviar el token en query.

El token se invalida antes de tiempo si el seller cambia la contraseña, se rota el secret, revoca la app, o la app no llama `api.mercadolibre.com` durante **4 meses**.

Errores OAuth publicados: `invalid_client`, `invalid_grant`, `invalid_scope`, `invalid_request`, `unsupported_grant_type`, `forbidden` (403), `local_rate_limited` (429), `unauthorized_client`, `unauthorized_application`.

### 1.3 Pruebas

No hay sandbox. `POST /users/test_user` con `{ "site_id": "MPE" }` (el ejemplo oficial usa `MLA`; la guía manda consultar Sites para el id del país). Máximo **10** usuarios de test por cuenta; las credenciales se muestran **una vez**. Sin actividad 60 días se borran. Solo operan entre usuarios y publicaciones de test. Título: `Item de Prueba - Por favor, NO OFERTAR`. No usar `gold` / `gold_premium`. Tarjetas de prueba con titular `APRO APRO` para pago aprobado. **No usar cuentas seller reales.**

### 1.4 Rate limit

No hay tabla global de QPS. Señales publicadas:

- `GET /applications/$APP_ID` incluye `max_requests_per_hour` (ejemplo 18000).
- OAuth y APIs responden **429**.
- Paginación por defecto: `offset=0`, `limit=50`.

## 2. Listar pedidos

Fuentes: [Gestiona ventas](https://developers.mercadolibre.com.pe/es_ar/gestiona-ventas), [Gestión de packs](https://developers.mercadolibre.com.pe/es_ar/gestion-packs).

### 2.1 Identidad: orden ≠ pack ≠ envío

| Entidad | Qué es | Relación |
| --- | --- | --- |
| Orden | Compra de **un** ítem (N unidades de ese ítem) | 1 orden → N pagos; 1 orden → 0..1 shipping.id |
| Pack | Carrito. Disponible en Perú | 1 pack → N órdenes; 1 pack → 0..1 shipment |
| Shipment | El paquete físico | Se lee por `shipping.id` o `GET /packs/$PACK_ID` |

Durante 2024 ML anunció que todas las órdenes quedarían atadas a un `pack_id`. Un pack puede mezclar órdenes de distintos sellers; la API solo muestra las órdenes de sellers que otorgaron grant a la app.

ZentoFact: `orders.external_order_id` = `order.id`. El `pack_id` y el `shipment.id` van en metadata/shipping. **No fusionar** dos `order.id` del mismo pack (el glosario prohíbe fusionar Pedidos con identidades externas distintas). La etiqueta y el manifiesto logístico sí se operan por shipment/pack.

### 2.2 Endpoints

| Método | Ruta | Uso |
| --- | --- | --- |
| GET | `/orders/search?seller=$USER_ID&…` | Listar. **No hace nada sin filtro.** Obligatorio `seller` o `buyer`. El token debe ser de ese seller. |
| GET | `/orders/$ORDER_ID` | Detalle: `order_items`, pagos, `shipping.id`, `pack_id`, tags, buyer/seller |
| GET | `/packs/$PACK_ID` | Órdenes del carrito + `shipment.id` + status del pack |
| GET | `/orders/$ORDER_ID/shipments` | Envíos de la orden (`forward` / `return` / `return_to_buyer`) |
| GET | `/orders/$ORDER_ID/discounts` | Cupones y campañas |
| GET | `/orders/$ORDER_ID/product` | Atributos extra (p. ej. IMEI) |
| GET | `/orders/billing-info/$SITE_ID/$BILLING_INFO_ID` | Datos fiscales. En Perú: `MPE` |

Retención: **12 meses**. La búsqueda como **seller oculta órdenes canceladas**. Como buyer no.

Filtros de search (oficiales): `seller` / `buyer`, `order.status` (varios separados por coma), `item`, `tags` / `tags.not`, `q` (no busca nombre ni email), `order.date_created.from` / `.to`, `order.date_closed.from` / `.to`, `order.date_last_updated.from` / `.to`, mediations, feedback, `sort=date_asc|date_desc`. Fechas: precisión de hora; descartar minutos/segundos/ms. Paging: `paging.total`, `offset`, `limit` (ejemplo 50). Sellers ordenan por `date_closed`; default `date_asc`.

HTTP **206**: orden parcial. Header `X-Content-Missing` puede listar `buyer`, `feedback`, `mediations`, `seller`, `shipping`. El `shipping.id` puede llegar `null` unos instantes; llega notificación cuando se crea el envío.

Tag `fraud_risk_detected` + notificación `orders_v2`: **no despachar**; cancelar. Si ya se envió, acreditar el envío ante ML/MP.

### 2.3 Cómo sincronizaría ZentoFact

El ADR de sincronización por cuenta de canal aplica igual: un cursor por `order_channel_accounts` (un grant = un `user_id` = `external_account_id`).

1. Poll: `GET /orders/search?seller=$USER_ID&order.date_created.from=…&order.date_last_updated.from=…&sort=date_desc`.
2. Para cada id: `GET /orders/$ID`. Si hay `pack_id`, `GET /packs/$PACK_ID`. Si hay `shipping.id`, `GET /shipments/$ID` con header `x-format-new: true` (obligatorio desde el 12/10/2025 en la guía de envíos).
3. Complementar con webhook `orders_v2` (y `shipments`) para no depender solo del poll.
4. La primera corrida automática del ADR lee cinco días Lima; ML permite hasta 12 meses si se necesita un backfill explícito.

## 3. Estados

Hay **tres** máquinas de estado. Mezclarlas es el error habitual.

### 3.1 Estado de la orden (comercial / pago)

Fuente: [Gestiona ventas — Estado de la orden](https://developers.mercadolibre.com.pe/es_ar/gestiona-ventas).

| `status` | Significado oficial |
| --- | --- |
| `confirmed` | Inicial; aún no pagada. También: si el seller marca la operación como no concretada en el front, la API puede quedar `confirmed` (el front muestra Cancelada) y se devuelve el pago |
| `payment_required` | Hay que confirmar el pago antes de mostrar datos del comprador |
| `payment_in_process` | Hay pago, todavía no acreditado |
| `partially_paid` | El pago acreditado no alcanza |
| `paid` | Pago acreditado. En México (y luego AR/BR) algunas ventas canceladas con devolución a dinero en cuenta quedan `paid` + tag `unfulfilled` |
| `partially_refunded` | Devoluciones parciales de pagos |
| `pending_cancel` | Se quiere cancelar y cuesta devolver el pago |
| `cancelled` | La orden no se completó |

`date_closed`: primera vez que pasa a `confirmed` o `paid`. **Ahí se descuenta el stock del ítem en ML.**

Motivos de cancelación publicados: pago tardío y el ítem se pausó por stock; no se pagó a tiempo; seller prohibido; seller califica como no concretada.

Con `buying_mode=buy_it_now` el seller **solo ve la orden cuando el pago está aprobado**.

### 3.2 Estado del pack

| Status | Significado |
| --- | --- |
| `released` | Órdenes y envío pagados |
| `error` | Falla recuperable |
| `pending_cancel` | Error no recuperable |
| `cancelled` | Órdenes y envío cancelados |

### 3.3 Estado del envío (el que opera la bodega)

Catálogo: `GET /shipment_statuses`. La vista hosted de órdenes lista: `pending`, `handling`, `ready_to_ship`, `shipped`, `delivered`, `not_delivered`, `not_verified`, `cancelled`. El catálogo completo también incluye `to_be_agreed`, `closed`, `error`, `active`, `not_specified`, `stale_ready_to_ship`, `stale_shipped`.

Mapeo front ↔ API (oficial):

| Front | API |
| --- | --- |
| En preparación | `handling` |
| En camino (cross docking) | `ready_to_ship` + substatus `picked_up` / `authorized_by_carrier` / `in_hub` |
| En camino (fulfillment) | `shipped` |
| Entregado | `delivered` |

Substatus útiles: `waiting_for_label_generation`, `ready_to_print`, `printed`, `ready_for_pickup`, `ready_for_dropoff`, `picked_up`, `dropped_off`, `in_hub`, `out_for_delivery`, `label_expired`, `buffered`.

### 3.4 Mapeo propuesto a estados operativos de ZentoFact

ZentoFact ya separa `orderStatus`, `paymentStatus` y `fulfillmentStatus` (`order-management.js`). El estado del canal se guarda en `provider_status`.

| Condición ML | `orderStatus` | `paymentStatus` | `fulfillmentStatus` |
| --- | --- | --- | --- |
| `confirmed` / `payment_required` / `payment_in_process` / `partially_paid` | `new` | `pending` | `pending` |
| `paid` + shipment `pending` / `handling` / sin shipment aún | `confirmed` | `paid` | `pending` o `preparing` |
| `paid` + shipment `ready_to_ship` | `confirmed` | `paid` | `ready_to_ship` |
| shipment `shipped` / `stale_shipped` | `confirmed` | `paid` | `shipped` |
| shipment `delivered` | `completed` | `paid` | `delivered` |
| shipment `not_delivered` | `confirmed` | `paid` | `failed` (o conservar `unmapped` hasta definir la cola) |
| `partially_refunded` | `confirmed` o `completed` | `partially_refunded` | según shipment |
| `cancelled` / `pending_cancel` / pack `cancelled` | `cancelled` | según pagos | `cancelled` |
| tag `fraud_risk_detected` | no despachar | — | no pasar a `ready_to_ship` |
| status de orden o shipment no listado | `confirmed` | `unknown` | **`unmapped`** (el ADR: visible, sin inventario ni facturación) |

No usar `order.status=paid` como “listo para enviar”. Una venta pagada puede seguir en `handling`.

Tags de orden publicados: `pack_order`, `not_delivered`, `not_paid`, `high_concurrency`, `catalog`, `unfulfilled`, `test_order`. Los tags `delivered` / `not_delivered` **ya no se agregan solos**; si se necesitan, el integrador hace PUT.

### 3.5 Acciones del seller por API

| Acción | Endpoint | Notas |
| --- | --- | --- |
| Imprimir etiqueta ME2 | `GET /shipment_labels?shipment_ids=…&response_type=pdf\|zpl2` | Status `ready_to_ship` + substatus `ready_to_print` (o `printed` para reimprimir). Máx. 50 ids. Mode `me2`. No sirve para Full. |
| “Ya tengo el producto” | `POST /shipments/$ID/process/ready_to_ship` | Solo ME2 en países con `manufacturing_time`. **Perú no está en la lista de manufacturing_time** de products-sync-listings. No cablear sin probar un seller MPE. |
| Partir un envío multi-ítem | `POST /shipments/$ID/split` | Cancela pack/orden/shipment con `pack_splitted` |
| Preguntas | `POST /answers` | Preventa |
| Mensajes postventa | `/messages/packs/…` | La lectura marca leído salvo `mark_as_read=false` |

No está publicado en las páginas consultadas un `POST /orders/$ID/cancel`. La guía de fraude dice que hay que cancelar, sin documentar la ruta.

## 4. Envíos (Mercado Envíos)

Fuentes: [Mercado Envíos](https://developers.mercadolibre.com.pe/es_ar/mercado-envios), [Envíos](https://developers.mercadolibre.com.pe/es_ar/envios), [ME2](https://developers.mercadolibre.com.pe/es_ar/mercadoenvios-modo-2). ME está **disponible en Perú**.

| Modo | Definición |
| --- | --- |
| **ME1** | Logística propia o de terceros |
| **ME2** | Logística ML: `drop_off`, colecta `cross_docking`, Places `xd_drop_off`, Flex `self_service`, Turbo `turbo`, Full `fulfillment` |
| **custom** | Tabla de precios por región; el seller envía |
| **not_specified** | Sin precio; coordinar con el comprador |

Consultas: `GET /users/$USER_ID/shipping_preferences`, `GET /sites/$SITE_ID/shipping_methods`, `GET /categories/$CATEGORY_ID/shipping_preferences`, `GET /shipments/$ID` (`x-format-new: true`), `/history`, `/items`, `/carrier`, `/payments`.

Perú: **ML no entrega `zip_code`**. `receiver_phone` solo en ME1. Dirección del comprador oculta hasta el pago. Desde el 12/10/2025, `order_id` y `external_reference` dejan de ir en el shipment.

**Etiqueta (PE, ME2):** `GET /shipment_labels?shipment_ids=$ID&response_type=pdf` o `zpl2`. Medida estándar 10×15 cm (México es 10×20). Reimprimir = el mismo GET. No hay etiquetas personalizadas. Full: el seller **no** imprime la etiqueta de venta.

La misma página de ME2 dice que el “carrito de compras” (consulta de envíos de carrito) está en AR, BR, MX, CL, CO y próximamente UY. Eso **no contradice** packs en Perú (la guía de packs lista Perú); es otro recurso. Validar con un seller MPE si un pack de varias órdenes comparte un solo `shipment_id`.

**Full:** el ingreso a depósito es Seller Center, no API. Las APIs de stock fulfillment se documentan para AR, BR, MX, CL y CO. **No asumir Full por API en MPE.**

## 5. Productos y asociación a maestros

### 5.1 Qué es una publicación

Una publicación es un **item** (`item_id`, en Perú típico `MPE…`). Se crea con `POST /items`, se lee con `GET /items/$ITEM_ID` (el stock `available_quantity` solo con el token del dueño) y se cambia con `PUT /items/$ITEM_ID`.

Listar las del seller:

```http
GET /users/$USER_ID/items/search?status=active
```

Más de 1000: `search_type=scan` (sin `offset`) y seguir el `scroll_id` (expira en 5 minutos). Multiget: `GET /items?ids=ID1,ID2`.

Fuente: [Ítems y búsquedas](https://developers.mercadolibre.com.pe/es_ar/items-y-busquedas), [Publica productos](https://developers.mercadolibre.com.pe/es_ar/publica-productos), [Sincroniza publicaciones](https://developers.mercadolibre.com.pe/en_us/products-sync-listings).

Mientras está activa se pueden cambiar stock, precio, video, fotos, descripción y shipping. Con ventas no se cambian título, condición ni buying mode. El título solo si `sold_quantity = 0`.

Estados de publicación: active; payment required; under review (`warning`, `waiting_for_patch`, `held`, `pending_documentation`, `forbidden`); paused (`out_of_stock`, `paused_by_seller`); closed; inactive. Cerrar no se reactiva: hay que relistar.

### 5.2 Identificadores (cuál usar para el maestro)

| Identificador | Qué es | ¿Clave de asociación? |
| --- | --- | --- |
| **`SELLER_SKU`** (atributo del ítem o de la variación) | Código de stock del seller. Oficialmente **el lugar correcto** | **Sí.** Es `product_listings.seller_sku` |
| `order_items[].item.seller_sku` | Copia de `SELLER_SKU` en la venta | Join de líneas de pedido |
| `item_id` | Id de la publicación (`MPE…`) | `shop_sku` o `external_product_id`. Único por listing, no es el SKU de bodega |
| `variation_id` | Variante del modelo viejo | `metadata`. Cada talla/color debe ser su propio maestro si el catálogo ZentoFact ya separa variantes |
| `user_product_id` | Producto físico (User Product). Un UP puede tener varios `item_id` (distinto precio/cuotas) | `metadata`. Tras UP, el stock se piensa a este nivel |
| `family_id` / `family_name` | Familia de UPs (pickers) | No es SKU |
| `catalog_product_id` | Ficha de Catálogo ML (compartida entre sellers) | No es SKU de bodega. Varios sellers venden el mismo `catalog_product_id` |
| `seller_custom_field` | Uso interno. **Sin relación** con `SELLER_SKU` | No asociar al maestro salvo un seller que ya lo haya usado históricamente como SKU |
| GTIN / EAN / UPC / ISBN | Identificador comercial global | Señal secundaria en `metadata`, nunca sola |
| `inventory_id` | SKU de depósito Full | No listado para Perú |

Fallback oficial de SKU en la orden ([packs](https://developers.mercadolibre.com.pe/es_ar/gestion-packs)):

1. `seller_sku` de la variación
2. `seller_custom_field` de la variación
3. `seller_sku` del ítem
4. `seller_custom_field` del ítem

Hay que **cargar siempre `SELLER_SKU`** para que aparezca en `/items` y `/orders`.

### 5.3 Variaciones vs User Products vs Catálogo

**Modelo clásico (variaciones):** un `item_id` con `variations[]`. SKU por variación en `SELLER_SKU`. Precio distinto por variación: la API lo acepta, la ficha muestra el más alto. Máximo 100 variaciones (moda/accesorios/autopartes 250).

**User Products:** el seller con tag `user_product_seller` ya no envía `variations[]`. Cada variante física es un `user_product_id`; cada condición de venta (precio, cuotas) es un `item_id`. Un PUT que toca título, fotos, atributos o `available_quantity` se replica a los ítems del mismo UP. No existe endpoint para listar todas las familias. Ítems de un UP: `GET /users/$SELLER_ID/items/search?user_product_id=$UP_ID`. Catálogo **no** lleva `user_product_listing=true`.

**Catálogo ML:** disponible en Perú. ML pone título, fotos, descripción y ficha. El seller compite en la página de producto. Flag `catalog_listing` + `catalog_product_id`. La orden puede traer tag `catalog`.

### 5.4 Cómo asociar a `products.main_sku`

ZentoFact ya tiene el hueco: `product_listings` es único por `(channel_code, company_id, seller_sku)` y apunta a `products.id`. Falabella ya hace `seller_sku` de la línea → listing → maestro. El descuento de stock pega al maestro, no a cada publicación.

Regla recomendada para Mercado Libre:

1. Importar publicaciones de cada `user_id` (cada Empresa).
2. Exigir `SELLER_SKU` en ítem o variación. Si falta, la fila entra a la cola de no mapeados (`skipped_unmapped`), igual que Falabella.
3. `product_listings.seller_sku` = valor de `SELLER_SKU`.
4. `shop_sku` o `external_product_id` = `item_id` (elegir uno y no mezclar).
5. `channel_code` = `mercado_libre`. `company_id` = LIMBO / MANTA RAYA / YAKURUNA. `channel_account_id` = la cuenta cuyo `external_account_id` es el `user_id`.
6. Un mismo `main_sku` vendido por tres empresas = **tres** listings (igual que `LIMBO-AG301` / `MR-AG301`).
7. Blanco M y Blanco L son maestros distintos si el catálogo ya separa talla (la sync de catálogo no mezcla color/talla incompatibles).
8. No usar `catalog_product_id` como llave: es la ficha de ML, no el SKU interno.
9. Tras User Products, seguir joineando la venta por `SELLER_SKU` / `item_id`, y empujar stock por `user_product_id` si el seller es multi-origen.

La asociación automática que ya existe (familia, marca, color, talla, huella de imagen) sirve como red de seguridad cuando el `SELLER_SKU` no coincide con `main_sku`. La vía feliz es que el seller ponga en `SELLER_SKU` el SKU interno o el alias por empresa (`LIMBO-AG301`).

### 5.5 Stock y precio hacia ML

Hasta que `MARKETPLACE_PUBLICATION_MUTATION_ENABLED` no se encienda para este canal, los controles de publicación deben seguir siendo visuales. Cuando se habilite:

```http
PUT /items/$ITEM_ID
{ "available_quantity": 6 }
```

`available_quantity = 0` pausa con `out_of_stock` (ítems nuevos, no `listing_type=free`). Reponer reactiva salvo `paused_by_seller`. Auto-pausa en 0 **incluye MPE**. Precio: `PUT` con `{ "price": … }`. La guía también menciona una prices API; en las páginas consultadas solo aparece `GET /items/$ID/sale_price`.

User Products multi-origen: `GET /user-products/$UP_ID/stock` y PUT a `seller_warehouse` con header `x-version` (optimistic lock, 409). Stock Full (`meli_facility`) no se edita por API.

### 5.6 Categorías, fotos, calidad

- Categorías: `GET /sites/MPE/categories`, `GET /categories/$ID/attributes`, predictor `GET /sites/MPE/domain_discovery/search?q=…`.
- Fotos: JPG/PNG, máx. 10 MB, 500×500 mínimo, 1200×1200 recomendado. `POST /pictures/items/upload` y adjuntar al ítem.
- GTIN puede ser `required` o `conditional_required`; si no hay, a veces `EMPTY_GTIN_REASON`. Validador: `/product-identifier/validator`.

## 6. Notificaciones

Fuente: [Notificaciones](https://developers.mercadolibre.com.pe/es_ar/productos-recibe-notificaciones) (actualizada 02/09/2026).

POST al callback. Responder **HTTP 200 en 500 ms** o ML desactiva el tópico y **no guarda** esos eventos. Reintentos durante **1 hora**, luego se descartan. Trabajar con cola: ack inmediato, GET del recurso después. Zona horaria UTC. IPs de origen publicadas en esa página (allowlist).

Tópicos mínimos para un ERP: `orders_v2` (recomendado para ventas), `shipments`, `items`, `questions`, `payments`, `messages`. Si hay User Products: `user_products`, `stock-location`.

Payload típico: `{ resource, user_id, topic, application_id, attempts, sent, received }`. Después, GET a `https://api.mercadolibre.com{resource}`.

Huecos: `GET /missed_feeds?app_id=$APP_ID` (últimos **2 días**). El tópico `items` exige `site_id` (usar `MPE`).

## 7. Facturación en Perú

Fuente: [Datos de facturación](https://developers.mercadolibre.com.pe/es_ar/facturacion). ML **no emite** la boleta/factura SUNAT del seller.

1. `GET /orders/$ORDER_ID` → `buyer.billing_info.id`
2. `GET /orders/billing-info/MPE/$BILLING_INFO_ID`

| Comprobante | `identification.type` | `cust_type` |
| --- | --- | --- |
| Boleta | `DNI` o `CE` | `CO` |
| Factura | `RUC` | `BU` |

`invoice_type` fue **eliminado**. El integrador elige el documento por el tipo de ID. Eso encaja con `document_type_policy: automatic` de `order_channel_accounts`.

## 8. Preguntas y mensajes

Preventa: `GET /questions/search`, `GET /my/received_questions/search`, `POST /answers`. Estados: `UNANSWERED`, `ANSWERED`, `BANNED`, `CLOSED_UNANSWERED`, `DELETED`, `DISABLED`, `UNDER_REVIEW`.

Postventa: notificación `messages`; `GET /messages/unread?tag=post_sale&role=seller`; hilo en `/messages/packs/$PACK_ID/sellers/$SELLER_ID`.

## 9. Encaje con lo que ZentoFact ya tiene

| Pieza ZentoFact | Encaje ML |
| --- | --- |
| `order_channels.code = mercado_libre` | Ya insertado. Capacidades actuales: `ingestion: api, webhook`. Falta `actions: ready_to_ship, shipping_label` hasta cablear ME2 |
| `order_channel_accounts` | Una fila por Empresa + `external_account_id = user_id` |
| ADR sync por cuenta | Un cursor por grant; ids de orden únicos dentro del seller |
| `orders.external_order_id` | `order.id` (no el pack) |
| `product_listings` | `SELLER_SKU` + `item_id` |
| Bandeja operativa | Stages desde **shipment**: `handling` → Pendientes, `ready_to_ship` → Listos, `shipped` → Enviados |
| Stock | Reserva al `paid`+pendiente; confirma al `ready_to_ship` (misma regla que Falabella) |
| Emisión | Independiente de la sync. Billing-info MPE alimenta boleta/factura |
| Flag de mutación de publicación | No hacer PUT de stock/precio a ML hasta habilitarlo |

La UI ya menciona Mercado Libre en `#/productos` y en el prototipo multicanal. Eso no implica conector: hoy no hay adaptador `order-adapters/mercadolibre.js` ni paquete tipo `@zentofact/falabella-api`.

## 10. Secuencia recomendada de implementación

1. **App** — Una aplicación ZentoFact, redirect HTTPS, scopes `read write offline_access`, tópicos `orders_v2`, `shipments`, `items`, `questions`, `payments`, `messages`. Sin scopes MP.
2. **Grant por Empresa** — Admin de cada seller. Guardar `user_id`, refresh rotativo, `site_id` (esperar `MPE`).
3. **Usuarios de test MPE** — Publicar, comprar, pagar con `APRO APRO`. Nada de catálogo real.
4. **Importar ítems** — Scan de `/users/$ID/items/search`, `GET /items` con token dueño, persistir `item_id`, `SELLER_SKU`, variación/UP, status, qty, precio, permalink.
5. **Mapear maestros** — `SELLER_SKU` → `product_listings` → `main_sku`. Cola de no mapeados. No asociar por `seller_custom_field` ni solo por GTIN.
6. **Ingesta de pedidos** — Poll + `orders_v2`. Adaptador que normalice a `ingestOrder`. Pack y shipment en metadata. Billing-info MPE.
7. **Webhook** — 200 en 500 ms + cola + `missed_feeds`.
8. **Bandeja** — Stages por shipment. Etiqueta ME2 cuando `ready_to_print`. No mutar publicación hasta el flag.
9. **Stock hacia ML** — Solo con mapeo limpio y flag encendido. Respetar 429 y 409 de `x-version`.
10. **Preguntas** — Segunda fase.

## 11. Errores frecuentes

Cuerpo estándar: `{ "message", "error", "status", "cause": [] }`.

Órdenes: `order_not_found`, `empty_order_id`, `invalid_order_id`, `not_identified_user`, `not_owned_order`, `caller.id.invalid`, HTTP 206.

Ítems: atributos faltantes (147), GTIN (7810, 7710–7714), fotos (173, 3703), categoría no hoja (126), ME2 obligatorio (4029), marca no acreditada (3250), 409 optimistic lock.

Etiquetas: `not_printable_status`, `invalid_shipment_mode`, `invalid_shipment_ff_public`, máximo 50 ids.

## 12. SDK

Los repos `mercadolibre/*-sdk` (Node, PHP, Python, Java, .NET, Ruby, Go) declaran mantenimiento apagado desde la primera semana de abril de 2021. Un conector nuevo debe ser HTTP propio, al estilo `@zentofact/falabella-api` / Ripley.

## Fuentes

- https://developers.mercadolibre.com.pe/
- https://developers.mercadolibre.com.pe/es_ar/crea-una-aplicacion-en-mercado-libre-es
- https://developers.mercadolibre.com.pe/es_ar/autenticacion-y-autorizacion
- https://developers.mercadolibre.com.pe/es_ar/recomendaciones-de-autorizacion-y-token
- https://developers.mercadolibre.com.pe/es_ar/realiza-pruebas
- https://developers.mercadolibre.com.pe/es_ar/gestiona-ventas
- https://developers.mercadolibre.com.pe/es_ar/gestion-packs
- https://developers.mercadolibre.com.pe/es_ar/facturacion
- https://developers.mercadolibre.com.pe/es_ar/mercado-envios
- https://developers.mercadolibre.com.pe/es_ar/envios
- https://developers.mercadolibre.com.pe/es_ar/mercadoenvios-modo-2
- https://developers.mercadolibre.com.pe/es_ar/productos-recibe-notificaciones
- https://developers.mercadolibre.com.pe/es_ar/items-y-busquedas
- https://developers.mercadolibre.com.pe/es_ar/publica-productos
- https://developers.mercadolibre.com.pe/en_us/products-sync-listings
- https://developers.mercadolibre.com.pe/es_ar/variaciones
- https://developers.mercadolibre.com.pe/es_ar/user-products
- https://developers.mercadolibre.com.pe/es_ar/que-es-catalogo
- https://developers.mercadolibre.com.pe/es_ar/preguntas-y-respuestas
- https://developers.mercadolibre.com.pe/es_ar/errores
- https://developers.mercadolibre.com.pe/es_ar/consideraciones-de-diseno
