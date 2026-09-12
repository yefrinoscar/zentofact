# Estados logísticos de Ripley disponibles en Mirakl

Investigación realizada el 12 de septiembre de 2026 contra fuentes oficiales de Mirakl y mediante consultas `GET` al tenant `ripleyperu-prod.mirakl.net`.

## Hallazgo

OR11 (`GET /api/orders`) no basta para separar preparación de listo para recojo: en las órdenes observadas devuelve `order_state: SHIPPING` para ambas etapas del flujo. La API que modela esa transición es ST11 (`GET /api/shipments`), que devuelve un `status` por shipment y permite filtrar por `order_id` y `shipment_state_code`.

La misma especificación seller incluye ST26 (`PUT /api/shipments/ready_for_pick_up`), llamada oficialmente “Validate shipments as ready to pick up”. Esto demuestra que la condición “listo para recojo” pertenece al shipment, no al estado general de OR11.

Fuentes primarias:

- [Mirakl MMP](https://developer.mirakl.com/content/product/mmp) describe la separación entre APIs Front, Operator y Seller.
- [OpenAPI oficial Seller de Mirakl](https://developer.mirakl.com/specs/content/product/mmp/rest/seller/openapi3-download.json?download) define ST11, sus filtros, el campo `status`, la autenticación Shop API Key y ST26.
- [SDK oficial de Mirakl: `ShipmentStatus`](https://github.com/mirakl/sdk-php-shop/blob/master/src/Mirakl/MMP/Common/Domain/Shipment/ShipmentStatus.php) define `SHIPPING` como estado inicial y `READY_FOR_PICK_UP` como listo para recojo por el operador.
- [OR13 oficial](https://developer.mirakl.com/content/product/mmp/rest/seller/openapi3/orders/or13) confirma que los filtros de exportación de pedidos siguen basándose en los estados generales de orden y no sustituyen el estado de shipment.

## Evidencia del tenant Ripley

Con la API key Mirakl configurada:

- `GET /api/shipments?order_id=7942121801-A` respondió `200` con un shipment `status: SHIPPING`.
- `GET /api/shipments?order_id=7942236901-A` respondió `200` con un shipment `status: SHIPPING`.
- `GET /api/shipments?shipment_state_code=SHIPPING` devolvió ambas órdenes.
- `GET /api/shipments?shipment_state_code=SHIPPED` devolvió, entre otras, `7941712001-A`, ya retirada por el transportista.
- `GET /api/shipments?shipment_state_code=READY_FOR_PICK_UP` no devolvió filas en ese momento; no había una orden actual en esa etapa para observarla sin ejecutar una mutación.

Los dos pedidos usados para la comparación están por preparar, por lo que es correcto que ST11 devuelva el mismo estado para ambos. La integración debe leer ST11 periódicamente y mapear la transición de listo para recojo cuando aparezca, conservando OR11 para datos comerciales y `shipping_deadline`.

## Campos descartados como separadores

- `commiteddate`: fecha comercial adicional; no representa el estado logístico.
- `shipping_deadline`: vencimiento operativo; no separa etapas.
- `shipping_tracking`: ya existe en pedidos todavía en preparación.
- `can_shop_ship`: fue `false` en ambas órdenes.
- Documentos: ambas tenían `SYSTEM_DELIVERY_BILL`.
- ST12 (`/api/shipments/items_to_ship`): devolvió una lista vacía para ambas porque su shipment ya estaba creado.
