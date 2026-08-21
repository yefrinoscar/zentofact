# Pedidos y logística de Ripley mediante Mirakl y Seller Vendor Center

Investigado el 2026-08-20. Alcance: bandeja de pedidos de un seller de Ripley,
detalle de la orden, estados, bultos, etiquetas, agendamiento y manifiestos. Solo
se usaron fuentes de Ripley, Mirakl y la colección pública de API que Ripley
enlaza como documentación oficial.

## Decisión

La integración necesita **dos conexiones distintas**:

1. **Mirakl** es la fuente comercial de la orden: líneas, importes, cliente,
   direcciones, pago, estado de la orden, documentos y postventa. Ripley declara
   `OR11` como el endpoint crítico para consultar órdenes en preparación.
2. **Seller Vendor Center (SVC)** es la fuente logística: bandeja de preparación,
   cantidad de bultos, etiquetas, tracking, agendamiento, manifiestos y estados
   físicos del despacho.

Ripley describe expresamente esa división y publica la colección de SVC que
contiene los endpoints de etiquetas, manifiestos y agendamiento. Por tanto, no
se debe intentar reproducir una bandeja tipo Falabella usando solo Mirakl ni
tratar los documentos genéricos de Mirakl como etiquetas de transporte.
[Plan de integración para partners, Ripley](https://ripley.zendesk.com/hc/es-419/articles/38019940071575--Convi%C3%A9rtete-en-partner-integrador-oficial-de-ripley-com)
[API SVC v5, Ripley](https://documenter.getpostman.com/view/19167846/2sA2rFRKas)

## Cómo nace una orden

La orden no la crea el seller. Nace cuando el consumidor compra uno o más
productos en el Marketplace de Ripley. La plataforma recibe la compra y avisa
al seller con producto o servicio, cantidad, precio pagado y datos del cliente;
Ripley recibe el mismo detalle para dar seguimiento. En Perú, el seller recibe
además una notificación en el correo registrado en Mirakl.
[Condiciones generales del Marketplace Ripley Perú, cláusulas 3.4.1–3.4.2](https://ripleyperu.zendesk.com/hc/es/article_attachments/43659420044301)
[Cómo identificar un pedido, Ripley Perú](https://ripleyperu.zendesk.com/hc/es/articles/22578459676685--C%C3%B3mo-identifico-en-el-sistema-que-debo-atender-un-pedido-y-cu%C3%A1ndo-tengo-que-despacharlo)

Ripley resume el encadenamiento como **venta notificada por Mirakl y luego
procesada por SVC**. La API Seller de Mirakl no expone una operación para que el
seller cree una venta de Ripley: `PUT /api/orders` (`OR04`) actualiza campos de
órdenes existentes. Las órdenes manuales de ZentoFact deben seguir siendo
órdenes locales con origen `manual`, no enviarse a Ripley.
[Proceso de despacho, Ripley](https://ripley.zendesk.com/hc/es-419/articles/360048824154--C%C3%B3mo-es-el-Proceso-de-Despacho-en-el-Marketplace-de-Ripley-com)
[Órdenes Seller API, Mirakl](https://developer.mirakl.com/content/product/mmp/rest/seller/openapi3/orders)

## Bandeja y detalle comercial: Mirakl

### Listado y sincronización

`GET /api/orders` (`OR11`) devuelve `orders` y `total_count`, con las líneas,
cliente, direcciones, referencias, importes, moneda, pago, promesa de entrega,
envío, incidencias y estado necesarios para poblar el modelo canónico. Permite
filtrar, entre otros, por:

- `order_ids`, referencia para cliente o seller y SKU;
- estados de orden y canal;
- fecha de creación o de última actualización;
- orden pagada (`customer_debited`), flujo de pago e incidencias;
- `shop_id` cuando la credencial accede a varias tiendas.

La consulta es paginada con `max` y `offset`: el valor por defecto de `max` es
10 y el máximo 100; la cabecera `Link` puede anunciar página anterior o
siguiente. Para el detalle, `OR12` está deprecado: Mirakl indica usar `OR11` con
`order_ids`, hasta 100 IDs separados por coma.
[OR11, Mirakl](https://developer.mirakl.com/content/product/mmp/rest/seller/openapi3/orders/or11)
[OR12, Mirakl](https://developer.mirakl.com/content/product/mmp/rest/seller/openapi3/orders/or12)

Para una bandeja normal conviene sincronizar incrementalmente por
`start_update_date` y guardar las órdenes en ZentoFact; Mirakl resta un pequeño
margen temporal a ese filtro para evitar pérdidas por latencia. `OR11` recomienda
una lectura asíncrona cada cinco minutos y permite una frecuencia máxima de una
por minuto para ese uso. Para volúmenes grandes, usar `OR13`–`OR15`: crear una
exportación con rango de creación o actualización, consultar su `tracking_id` y
descargar los fragmentos cuando esté `COMPLETED`.
[OR11, Mirakl](https://developer.mirakl.com/content/product/mmp/rest/seller/openapi3/orders/or11)
[OR13, Mirakl](https://developer.mirakl.com/content/product/mmp/rest/seller/openapi3-download/orders/or13)

### Estados y mutaciones

Mirakl puede devolver `STAGING`, `WAITING_ACCEPTANCE`, `WAITING_DEBIT`,
`WAITING_DEBIT_PAYMENT`, `SHIPPING`, `SHIPPED`, `TO_COLLECT`, `RECEIVED`,
`CLOSED`, `REFUSED` y `CANCELED`. La integración debe conservar el valor bruto
y tolerar valores nuevos, tal como exige la política de compatibilidad de
Mirakl.
[Órdenes Seller API, Mirakl](https://developer.mirakl.com/content/product/mmp/rest/seller/openapi3/orders)

La API genérica de Mirakl ofrece estas operaciones:

- `OR21 PUT /api/orders/{order_id}/accept`: aceptar o rechazar cada línea cuando
  la orden está en `WAITING_ACCEPTANCE`;
- `OR23 PUT /api/orders/{order_id}/tracking`: registrar transportista y tracking;
- `OR24 PUT /api/orders/{order_id}/ship`: validar el envío cuando la orden está
  en `SHIPPING`;
- `OR28`: reembolsar líneas, que Ripley identifica como crítico para quiebres de
  stock.

Sin embargo, el plan público específico de Ripley solo exige `OR11` y `OR28`
para órdenes; la logística normal se opera en SVC. No se debe habilitar
aceptación, tracking o despacho por Mirakl hasta comprobar en el sandbox de la
tienda que Ripley habilitó esos permisos y que no duplican las transiciones de
SVC.
[Órdenes Seller API, Mirakl](https://developer.mirakl.com/content/product/mmp/rest/seller/openapi3/orders)
[Plan de integración para partners, Ripley](https://ripley.zendesk.com/hc/es-419/articles/38019940071575--Convi%C3%A9rtete-en-partner-integrador-oficial-de-ripley-com)

### Documentos de la orden

Mirakl permite listar documentos de hasta 100 órdenes (`OR72`), descargarlos por
orden, documento o código (`OR73`) y adjuntar documentos (`OR74`). Ripley usa
`OR74` para boletas y exige cargar la boleta digitalizada en Mirakl. Estos son
documentos comerciales o de postventa; las etiquetas y el manifiesto logístico
se obtienen de SVC.
[OR72–OR73, Mirakl](https://developer.mirakl.com/content/product/mmp/rest/seller/openapi3/orders/or72)
[OR74, Mirakl](https://developer.mirakl.com/content/product/mmp/rest/seller/openapi3/orders/or74)
[Postventa, Ripley](https://ripley.zendesk.com/hc/es-419/articles/14118538783255-Post-Venta-en-el-Marketplace-de-Ripley-com)

## Bandeja y operación logística: SVC

### Autenticación y ambientes

SVC usa credenciales distintas de Mirakl. Se llama
`POST /api/current/auth/login/vendor` con Basic Auth (`username:password` en
Base64); el token recibido se envía después como `Authorization: Bearer ...`.
La introducción de la colección declara `https://sellercenter.ripleyqa.com`
como ambiente de pruebas y dice que las credenciales y URL productiva se
entregan de manera privada.
[API SVC v5, autenticación, Ripley](https://documenter.getpostman.com/view/19167846/2sA2rFRKas)

### Listado logístico

La bandeja Fast Management se consulta con:

```http
GET /api/v3/orders/order/list?is_fast_management=true&page=1&limit=25
Authorization: Bearer <SVC_TOKEN>
```

Acepta `page`, `limit`, `vendor_ids` y proyección de campos. Puede filtrar por un
estado o varios mediante `status_management` y `status_management_contains`:

| Estado SVC | Significado operativo |
| --- | --- |
| `TO_PREPARE` | Etiquetas pendientes de agendar |
| `TO_PICKUP` | Etiquetas agendadas, esperando recolección del courier |
| `SHIPPED` | En camino al destino |
| `RECEIVED` | Recibida por el cliente |
| `WITH_ERROR` | Error al generar automáticamente la etiqueta |
| `RETURN` | Flujo de devolución |

La respuesta incluye `total`, `offset`, `limit` y `orders`. Cada orden puede
incluir el `_id` interno de SVC, `order_id`, fecha, tienda, líneas, promesa y
tipo de envío, `packages_number`, estado Mirakl (`order_state`) y estado de
gestión SVC. Una orden `TO_PREPARE` del ejemplo oficial ya tiene
`order_state: SHIPPING`; son dos ejes distintos y no deben colapsarse en una
sola columna o campo.
[API SVC v5, “Generación automática”, Ripley](https://documenter.getpostman.com/view/19167846/2sA2rFRKas)

La ayuda de Ripley confirma que la UI de SVC muestra pendientes en **Para
preparar**, permite filtrar por orden, tienda, producto o cliente y abre un
detalle con productos, envío y facturación. La API pública no documenta un
endpoint separado de detalle; el detalle comercial debe provenir de `OR11` y
el complemento logístico de los listados de órdenes, etiquetas y manifiestos.
[Proceso de despacho, Ripley](https://ripley.zendesk.com/hc/es-419/articles/360048824154--C%C3%B3mo-es-el-Proceso-de-Despacho-en-el-Marketplace-de-Ripley-com)
[API SVC v5, Ripley](https://documenter.getpostman.com/view/19167846/2sA2rFRKas)

### Bultos y etiquetas

Fast Management crea automáticamente una etiqueta con un bulto. Si el seller
necesita otro número de bultos, llama:

```http
POST /api/v7/label/label/generate/edit/packages

{
  "label": { "packages": 2 },
  "order": { "_id": "<SVC_ORDER_ID>" }
}
```

La operación es asíncrona: responde `202` y puede tardar segundos o minutos.
La generación manual `/api/v7/label/label/generate` está deprecada salvo
mantenimiento o sellers integrados que operen con el parámetro `unlabeled`.
[API SVC v5, edición de bultos y generación manual, Ripley](https://documenter.getpostman.com/view/19167846/2sA2rFRKas)

`GET /api/v7/label/labels` lista etiquetas `printable`, `printed` o `error` y
admite filtros por orden, courier, tienda, producto, cliente y promesa. Devuelve
`total`, `offset`, `limit` y datos como `_id`, orden, `packages`, courier,
tracking, error y registro de impresión. Para descargar una o varias etiquetas,
`POST /api/v7/label/label/download/` recibe los `document_id`; la respuesta trae
el PDF en Base64 en `labels_generated` y los fallos por orden en
`orders_without_labels`.
[API SVC v5, listado y descarga de etiquetas, Ripley](https://documenter.getpostman.com/view/19167846/2sA2rFRKas)

La cardinalidad es física: **un bulto requiere una etiqueta**. Dos paquetes de
una misma orden requieren dos etiquetas distintas y el manifiesto debe reflejar
los dos bultos. Nunca se debe reutilizar una etiqueta en más de un paquete.
[Proceso de despacho, Ripley](https://ripley.zendesk.com/hc/es-419/articles/360048824154--C%C3%B3mo-es-el-Proceso-de-Despacho-en-el-Marketplace-de-Ripley-com)

### Agendamiento y manifiesto

El flujo de API es:

1. Listar etiquetas elegibles con
   `GET /bff/v1/manifest/label/list?hasManifest=false&active=true`. Solo son
   elegibles si están activas, sin error y aún sin manifiesto. Hay paginación
   `page`/`limit` (50 por defecto) y filtros por orden, tienda, fechas, courier,
   cliente, producto y tipo de envío.
2. Enviar los `_id` **de las etiquetas**, `order_id`, courier, fecha de retiro y
   bodega a `POST /api/v1/manifest/schedule/generate`. Un request puede separar
   etiquetas agendables hoy de las agendables mañana; crea los manifiestos y
   agenda el retiro en una sola operación.
3. Consultar `GET /bff/v1/manifest/history/list`, con paginación y filtros, y
   abrir `GET /bff/v1/manifest/{manifestId}` para ver etiquetas, tracking,
   órdenes, bultos y datos de retiro.
4. Descargar el PDF Base64 desde
   `GET /bff/v1/manifest/{manifestId}/download`. El PDF resume las etiquetas y
   sus códigos de barras.

SVC también permite desvincular etiquetas mediante
`PATCH /bff/v1/manifest/{manifestId}` antes del despacho. La ayuda de Ripley
describe el mismo resultado: al agendar, la orden pasa a **Listo para retiro**;
desde **Manifiestos** se puede excluir una orden e imprimir el documento.
[API SVC v5, servicios de manifiestos, Ripley](https://documenter.getpostman.com/view/19167846/2sA2rFRKas)
[Proceso de despacho, Ripley](https://ripley.zendesk.com/hc/es-419/articles/360048824154--C%C3%B3mo-es-el-Proceso-de-Despacho-en-el-Marketplace-de-Ripley-com)

Para flota propia, SVC publica endpoints específicos que cambian una orden a
`SHIPPED` y `RECEIVED`. También publica
`PUT /api/v7/logistics/state/generic_update` para esos dos cambios, tanto en
flujo normal como devolución, usando tracking y courier. No debe exponerse esa
mutación hasta validar modalidad logística, rol y certificación del seller.
[API SVC v5, cambios de estado, Ripley](https://documenter.getpostman.com/view/19167846/2sA2rFRKas)

## Sincronización, webhooks y límites

Mirakl autentica la API Seller con la clave de tienda en `Authorization`; SVC
usa su propio token Bearer. Son secretos, ciclos de renovación y errores de
autorización independientes.
[Órdenes Seller API, Mirakl](https://developer.mirakl.com/content/product/mmp/rest/seller/openapi3/orders)
[API SVC v5, autenticación, Ripley](https://documenter.getpostman.com/view/19167846/2sA2rFRKas)

Los webhooks y Cloud Events de Mirakl Marketplace están disponibles para el
operador, no para usuarios seller. La colección pública de SVC tampoco
documenta webhooks. La primera versión debe hacer polling incremental e
idempotente de Mirakl y polling paginado de los estados logísticos de SVC.
[Disponibilidad de webhooks, Mirakl](https://developer.mirakl.com/content/product/mmp)
[API SVC v5, Ripley](https://documenter.getpostman.com/view/19167846/2sA2rFRKas)

Mirakl protege cada recurso con límites propios; un `429` incluye `Retry-After`
con los segundos que hay que esperar. SVC no publica límites de frecuencia,
expiración del token ni política de reintentos en su colección. Esos valores se
deben obtener durante la habilitación y certificación de Ripley; hasta entonces,
usar backoff, jitter y una concurrencia conservadora.
[Límites de API, Mirakl](https://developer.mirakl.com/content/product/mmp/rest/seller/openapi3/orders)
[Plan de certificación, Ripley](https://ripley.zendesk.com/hc/es-419/articles/38019940071575--Convi%C3%A9rtete-en-partner-integrador-oficial-de-ripley-com)

## Implicancias para ZentoFact

La primera implementación debería:

- sincronizar la orden completa desde Mirakl hacia el modelo canónico y servir
  la bandeja desde PostgreSQL con filtros y paginación del servidor;
- enriquecerla desde SVC enlazando por `order_id`, pero conservar también
  `Mirakl order_id`, `_id` de orden SVC, `_id` de etiqueta y `manifestId`;
- guardar por separado `order_state` de Mirakl y `status_management` de SVC;
- modelar `order -> packages -> label -> manifest`, porque una orden puede tener
  varios bultos y un manifiesto agrupa etiquetas, no órdenes directamente;
- tratar generación/edición de etiqueta como un job asíncrono y mostrar estados
  `generando`, `imprimible`, `impresa` y `error`;
- pedir confirmación explícita de cantidad de bultos antes de regenerar
  etiquetas y no agendar una etiqueta con error o ya vinculada;
- guardar PDFs Base64 de etiquetas y manifiestos como artefactos temporales o
  descargarlos bajo demanda, sin incorporarlos al JSON de la orden;
- registrar cada sincronización y mutación con plataforma, endpoint, ID externo,
  respuesta y actor para resolver desalineaciones entre Mirakl y SVC.

## Bloqueos antes de implementar mutaciones

Falta obtener de Ripley, por país y seller:

- clave API, host y `shop_id` de Mirakl;
- usuario, contraseña, URL productiva y duración del token de SVC;
- acceso al sandbox SVC y datos de prueba representativos de cada modalidad;
- límites de frecuencia y política de idempotencia de SVC;
- confirmación de qué transiciones ejecuta el seller, el courier o Ripley;
- autorización para etiquetas, manifiestos, agendamiento, flota propia y
  devoluciones;
- certificación de Ripley antes de operar órdenes reales.

La colección pública contiene ejemplos de Chile y Perú, pero su introducción
indica que la URL productiva se entrega en privado. No se debe fijar
`sellercenter.ripleylabs.com` como host de producción de Perú ni asumir que los
roles de una cuenta chilena aplican a una peruana.
[API SVC v5, Ripley](https://documenter.getpostman.com/view/19167846/2sA2rFRKas)
