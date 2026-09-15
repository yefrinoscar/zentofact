# Ripley: confirmación Mirakl y etiqueta Seller Center

Fecha: 2026-09-15.

## Pregunta

¿Qué operación puede ejecutar ZentoFact desde Bandeja con la conexión
Mirakl de Ripley y dónde se obtiene la etiqueta de transporte?

## Conclusión

Son dos integraciones distintas:

- Mirakl permite consultar los shipments con ST11 y confirmarlos como listos
  para recojo con ST26.
- Seller Vendor Center genera la etiqueta de transporte, el manifiesto y la
  cita de recojo con fecha y almacén.

OR72 y OR73 no reemplazan Seller Center. Para el pedido `7942151801-A`, OR72
listó un `SYSTEM_DELIVERY_BILL` y OR73 descargó un PDF A4 titulado
"Albarán". La inspección visual confirmó que no contiene la etiqueta de
transporte ni su código de barras.

La acción que ZentoFact puede habilitar con la API key Mirakl es "Marcar
listo". No debe llamarse "Agendar recojo" si la interfaz promete elegir fecha,
dirección o generar un manifiesto, porque ST26 no recibe esos datos.

## Evidencia del pedido comprobado

Las lecturas de producción fueron de solo consulta:

- OR11 encontró el pedido `7942151801-A` en estado `SHIPPING`.
- ST11 devolvió el shipment
  `42af50a8-2446-4fdb-87e1-e75ee8a29bb2` en
  `READY_FOR_PICK_UP`.
- OR72 devolvió un solo documento `SYSTEM_DELIVERY_BILL`.
- OR73 devolvió el albarán A4 correspondiente.

No se ejecutó ST26 contra ese pedido porque ya estaba listo. Tampoco se
ejecutó una mutación de Seller Center.

## Contrato Mirakl

El OpenAPI seller oficial define:

```http
GET /api/shipments
PUT /api/shipments/ready_for_pick_up
```

ST26 recibe de 1 a 1000 elementos `shipments: [{ id }]`. La respuesta separa
`shipment_success` de `shipment_errors`. Un id presente en
`shipment_success` es la confirmación autoritativa del comando. No hace falta
esperar que una lectura ST11 inmediata replique el cambio.

El flujo idempotente queda así:

1. ST11 resuelve los shipments del pedido.
2. Si todos ya están `READY_FOR_PICK_UP`, ZentoFact actualiza su estado local
   sin volver a llamar ST26.
3. Si alguno está `SHIPPING`, ZentoFact envía solo esos ids a ST26.
4. Solo los ids de `shipment_success` cuentan como confirmados.
5. Un error o un id ausente impide declarar el pedido listo.

ZentoFact guarda el origen de la evidencia, `st11` o `st26`, la hora y los ids
de shipment. Una sincronización posterior con el estado ambiguo `SHIPPING` no
puede bajar un pedido confirmado a preparación. Los estados terminales sí
pueden avanzar el pedido a enviado, entregado, cancelado o devuelto.

## Etiqueta, manifiesto y cita

La documentación oficial de Ripley separa la operación logística en Seller
Vendor Center. Sus rutas publicadas incluyen:

```http
GET  /api/v7/label/labels
POST /api/v7/label/label/download/
GET  /bff/v1/manifest/label/list
POST /api/v1/manifest/schedule/generate
GET  /bff/v1/manifest/{manifestId}/download
```

Seller Center usa credenciales distintas de la API key Mirakl. La base local
no tiene credenciales SVC válidas para descargar la etiqueta del pedido
comprobado. Por eso Bandeja mantiene deshabilitada la impresión Ripley y dice
que la etiqueta se obtiene en Seller Center.

## Cambio aplicado en ZentoFact

- Bandeja ofrece "Marcar listo" para pedidos Ripley pendientes o en
  preparación que tengan seller e id externo.
- El servidor carga la API key y el shop id del seller, consulta ST11 y usa
  ST26 cuando corresponde.
- Un shipment ya `READY_FOR_PICK_UP` produce éxito sin mutación repetida.
- La respuesta `shipment_success` basta para guardar `ready_to_ship`; no se
  exige una segunda lectura inmediata.
- La sincronización reconoce `READY_FOR_PICK_UP` y conserva la evidencia
  confirmada frente a una lectura posterior `SHIPPING`.
- La impresión Ripley sigue bloqueada para no entregar el albarán como si
  fuera una etiqueta.

## Fuentes primarias

- [OpenAPI seller oficial de Mirakl MMP](https://developer.mirakl.com/specs/content/product/mmp/rest/seller/openapi3-download.json?download), operaciones ST11, ST26, OR72 y OR73.
- [API SVC v5 de Ripley](https://documenter.getpostman.com/view/19167846/2sA2rFRKas), etiquetas, manifiestos y agendamiento.
- [Proceso de despacho de Ripley](https://ripley.zendesk.com/hc/es-419/articles/360048824154--C%C3%B3mo-es-el-Proceso-de-Despacho-en-el-Marketplace-de-Ripley-com).
