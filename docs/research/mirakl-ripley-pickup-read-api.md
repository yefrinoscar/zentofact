# Lectura del agendamiento de retiro de Ripley en Mirakl

Investigación realizada el 14 de septiembre de 2026 contra la especificación OpenAPI oficial de Mirakl MMP.

## Hallazgo

PL11, `GET /api/picklists`, es la API de lectura para el agendamiento de retiro. Acepta el filtro repetible `order_line_id` y devuelve, por picklist:

- `state`: estado de la lista de recojo.
- `pickup_date`: fecha de retiro asignada.
- `order_lines[].id`: líneas de pedido incluidas.

Por tanto, una orden OR11 cuyo shipment todavía aparece como `SHIPPING` debe tratarse como lista para recojo cuando **todas** sus líneas están en un picklist con `pickup_date`. Esto preserva ST11 como fuente primaria del shipment y usa PL11 para cubrir el desfase observado tras el agendamiento.

## APIs descartadas

- ST12, `GET /api/shipments/items_to_ship`, devuelve ítems pendientes de envío y fechas; su esquema no expone `state` ni `READY_FOR_PICK_UP`.
- ST26, `PUT /api/shipments/ready_for_pick_up`, es una mutación: confirma el recojo, no consulta su estado.

## Evidencia operativa

El 14 de septiembre se agendó `7942761001-A` en Seller Vendor Center. El portal la movió a “Listo para retiro”, pero la sincronización de ZentoFact siguió mostrando `SHIPPING`/Preparar. PL11 es el endpoint documentado que aporta la fecha de retiro ausente en ST11.

## Fuente primaria

- [OpenAPI oficial MMP Front](https://developer.mirakl.com/specs/content/product/mmp/rest/front/openapi3-download.json?download): define PL11, ST11, ST12 y ST26 con sus parámetros y esquemas de respuesta.
