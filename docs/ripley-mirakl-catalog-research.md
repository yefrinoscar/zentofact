# Catálogo de Ripley mediante Mirakl

Investigado el 2026-08-20. Alcance: primera importación de las publicaciones de un seller de Ripley, sin crear, actualizar ni despublicar nada.

## Decisión

Para traer el catálogo de un seller se debe usar la API de **ofertas**, no `GET /api/products`.

`GET /api/products` es P31. Exige `product_references`, devuelve como máximo 100 coincidencias y no acepta `SHOP_SKU` ni `SKU` como tipo de referencia. Es una consulta puntual de productos del catálogo de Mirakl, no un listado completo de lo que el seller publica. [P31, Mirakl](https://developer.mirakl.com/content/product/mmp/rest/seller/openapi3/products)

Cada oferta contiene los datos que necesita el catálogo local: `offer_id`, `active`, `product_sku`, `shop_sku`, `product_title`, marca, descripción, referencias, precio, cantidad y estado. [OF21, Mirakl](https://developer.mirakl.com/content/product/mmp/rest/seller/openapi3/offers/of21)

## Lecturas necesarias

Para una pantalla paginada o un refresco pequeño, llamar:

```http
GET https://ripleyperu-prod.mirakl.net/api/offers?max=100&offset=0
Authorization: <SHOP_API_KEY>
Accept: application/json
```

OF21 devuelve `offers` y `total_count`. Avanzar `offset` hasta que se hayan procesado todas las ofertas. `max` tiene máximo 100 y valor por defecto 10. Mirakl puede incluir URLs de página siguiente o anterior en la cabecera `Link`. Si responde `429`, respetar los segundos de `Retry-After`. [Paginación y límites, Mirakl](https://developer.mirakl.com/content/product/mmp/rest/seller/openapi3/products)

Para la primera carga masiva, usar la exportación asíncrona OF52 y guardar el resultado antes de mostrarlo en la aplicación:

1. `POST /api/offers/export/async` con `export_type: "application/json"` e `include_inactive_offers: true`.
2. Consultar `GET /api/offers/export/async/status/{tracking_id}` hasta `COMPLETED`.
3. Descargar todos los archivos indicados por `urls`.

Mirakl recomienda una exportación completa diaria y una diferencial cada cinco minutos. Una exportación sin `last_request_date` devuelve solo ofertas activas salvo que se soliciten inactivas. Una exportación diferencial incluye cambios, eliminaciones e inactivas. [OF52 a OF54, Mirakl](https://developer.mirakl.com/content/product/mmp/rest/seller/openapi3/offers)

## Acceso de Ripley

Ripley Perú identifica su instancia productiva como `https://ripleyperu-prod.mirakl.net`. El seller genera la clave en Mirakl, en **Ajustes personales > Clave API**. [Guía de configuración de Ripley Perú](https://ripleyperu.zendesk.com/hc/es/articles/32669080905101-Integradores)

La referencia Seller de Mirakl documenta la clave en `Authorization`. Su documentación actual también ofrece OAuth 2.0 para algunos flujos. Para la primera conexión, usar una clave de API por tienda proporcionada por Ripley y confirmar el host exacto si la cuenta pertenece a otro país. [Autenticación, Mirakl](https://developer.mirakl.com/content/product/mmp/rest/seller/openapi3)

El `shop_id` es opcional cuando la clave tiene una tienda predeterminada. Si la cuenta controla varias tiendas, debe enviarse explícitamente en cada llamada. [OF21, Mirakl](https://developer.mirakl.com/content/product/mmp/rest/seller/openapi3/offers/of21)

Ripley confirma que Mirakl gestiona productos, precios, stock, documentos y postventa. SellerCenter queda para etiquetas, manifiestos y agenda logística, por lo que no hace falta para esta primera importación de catálogo. [Plan de integración de Ripley](https://ripley.zendesk.com/hc/es-419/articles/38019940071575--Convi%C3%A9rtete-en-partner-integrador-oficial-de-ripley-com)

## Límite antes de implementar

No hay credenciales ni Seller ID de Ripley en el repositorio. La conexión real debe esperar a que se proporcione una clave de API y se confirme la tienda. No reutilizar el cliente de Falabella para hacer peticiones a Ripley: Falabella y Ripley son canales distintos, aunque ambos se integren en el mismo catálogo local.
