# Arquitectura general del módulo de pedidos

## Estado del documento

Este documento reemplaza el planteamiento anterior de “pedidos multicanal”.
La decisión de producto es que **Pedidos sea un módulo comercial y operativo de
pedidos**, no una extensión del proceso de emisión de comprobantes ni una
pantalla para configurar canales.

El comprobante electrónico, cuando corresponda, pertenece al módulo de
documentos. Puede referenciar un pedido, pero no define el estado ni la
experiencia principal de Pedidos.

## Objetivo

Centralizar pedidos recibidos desde Falabella, Ripley, integraciones externas y
creación manual, conservando su origen, sus importes, sus productos y su
historial operacional.

El módulo debe permitir:

- Encontrar rápidamente un pedido.
- Ver el monto total y su situación actual.
- Crear pedidos manualmente.
- Consultar productos, cliente, pago y entrega.
- Seguir el historial completo del pedido.
- Recibir pedidos automáticos de Falabella sin intervención de un operador.
- Incorporar nuevos marketplaces mediante adaptadores, sin cambiar el dominio.

## Decisiones de alcance

### Pedidos sí incluye

- Listado general de pedidos.
- Búsqueda, filtros, ordenamiento y paginación.
- Creación manual y borradores.
- Detalle de productos, cliente, pago y entrega.
- Estados comercial, de pago y de entrega separados.
- Origen del pedido como dato y filtro.
- Auditoría de cambios e integraciones.
- Ingesta idempotente desde marketplaces y APIs externas.

### Pedidos no incluye

- Emisión de boletas o facturas.
- Bandeja “Por emitir”.
- Estados SUNAT.
- Políticas de comprobantes por canal.
- Configuración de canales o credenciales.
- Indicadores como “Pedidos encontrados” o “En operación”.

El conteo de resultados pertenece al pie de la tabla, por ejemplo
`1–10 de 126`; no es un indicador de negocio.

## Auditoría de lo que existe actualmente en `main`

La implementación actual es una base técnica parcial, no el módulo terminado.

### Implementado

- Migraciones para un modelo inicial de pedidos multicanal.
- Servicio genérico de ingesta con idempotencia.
- Adaptador inicial y dual-write de Falabella.
- Backfill desde `falabella_orders`.
- API para listar pedidos y obtener un detalle básico.
- Pantalla experimental `/orders` con filtros, tabla, paginación y diálogo de
  detalle.
- Pruebas de ingesta y sincronización.

### Incompleto o incorrecto respecto a esta arquitectura

- `/orders` está oculto en producción y redirige a otra pantalla.
- No existe creación manual desde la interfaz.
- No existen operaciones normales para editar, confirmar, duplicar o cancelar.
- Ripley está declarado, pero no tiene una integración real.
- Los marketplaces externos solo disponen de un endpoint genérico de ingesta.
- La pantalla presenta configuración de canales y comprobantes, que no forman
  parte de Pedidos.
- El detalle es un diálogo de consulta, no una pantalla operativa completa.
- No existen entidades completas para pagos, direcciones, envíos y paquetes.
- La identidad inicial `(channel_account_id, external_order_id)` no resuelve
  adecuadamente proveedores que entregan varios IDs o paquetes para un mismo
  número comercial.
- Conviven `/pedidos` (bandeja operativa Falabella) y `/orders` (prototipo
  multicanal); todavía no existe un único módulo general.

## Experiencia de usuario objetivo

### Navegación

El módulo definitivo usa rutas en español:

```text
/pedidos
/pedidos/nuevo
/pedidos/:id
```

Debe existir una sola entrada principal **Pedidos**. Las tareas de recepción,
preparación o escaneo pueden continuar como vistas o acciones relacionadas, sin
crear dos conceptos distintos de pedido.

## Listado general

La pantalla comienza con una barra operativa, sin tarjetas de métricas:

```text
[Empresa] [Buscar pedido, cliente o producto] [Estado] [Origen] [Fecha]
                                                               [+ Crear pedido]
```

### Tabla

| Columna | Contenido |
| --- | --- |
| Pedido | Número interno y referencia externa secundaria |
| Fecha | Fecha real de compra |
| Cliente | Nombre y documento o contacto secundario |
| Origen | Manual, Falabella, Ripley o integración externa |
| Productos | Cantidad de líneas o unidades |
| Total | Importe total y moneda, siempre visible |
| Pago | Pendiente, parcial, pagado, reembolsado o fallido |
| Entrega | Por preparar, preparando, listo, enviado o entregado |
| Acciones | Ver, editar cuando corresponda, duplicar o cancelar |

Reglas:

- Orden inicial por fecha de compra descendente.
- El total se alinea a la derecha y usa formato monetario.
- La fila completa abre `/pedidos/:id`.
- La búsqueda cubre número interno, referencia externa, cliente, documento,
  correo, teléfono, SKU y nombre de producto.
- Los filtros y el orden se guardan en la URL.
- Búsqueda, filtros, ordenamiento y paginación se ejecutan en el servidor.
- El pie muestra `X–Y de Z` y controles Anterior/Siguiente.
- No se muestran checkboxes hasta que exista una acción masiva real.
- En móvil se priorizan Pedido, Cliente, Total y Entrega.

No debe existir una columna genérica que mezcle estados. El estado comercial,
el pago y la entrega avanzan de forma independiente.

## Creación manual

`/pedidos/nuevo` debe ser una página, no un diálogo pequeño.

### Flujo

```text
Datos generales
      ↓
Cliente
      ↓
Productos y cantidades
      ↓
Entrega y pago
      ↓
Revisión de totales
      ↓
Guardar borrador o Crear pedido
```

### Datos del formulario

- Empresa.
- Fecha del pedido.
- Cliente existente o cliente nuevo.
- Productos del catálogo.
- Ítem libre para casos excepcionales.
- Cantidad y precio unitario.
- Descuento por línea o por pedido.
- Costo de envío.
- Dirección y método de entrega.
- Estado inicial del pago.
- Nota interna.
- Resumen de subtotal, descuentos, envío, impuestos y total.

El origen se asigna automáticamente como `manual`. La interfaz puede calcular
un preview, pero el servidor siempre valida y vuelve a calcular los totales
antes de guardar.

Acciones:

- **Guardar borrador:** permite continuar después.
- **Crear pedido:** confirma el pedido y fija su fotografía comercial.

## Detalle del pedido

`/pedidos/:id` contiene:

1. Cabecera con número, origen, fecha, total y estado comercial.
2. Productos con SKU, descripción, cantidad, precio, descuento y total.
3. Cliente con nombre, documento, correo y teléfono.
4. Entrega con dirección, método, fecha prometida y tracking.
5. Pago con estado, medio, monto pagado y saldo.
6. Historial con fecha, actor y descripción de cada cambio.

La pantalla no muestra estados fiscales, políticas de comprobantes ni una cola
“Por emitir”.

## Arquitectura general

Se mantiene un monolito modular dentro del repositorio actual:

```text
Falabella webhook/polling ─▶ Adaptador Falabella ─┐
Ripley/API futura ─────────▶ Adaptador Ripley ────┤
Marketplace externo ──────▶ Adaptador externo ───┤
Usuario ──────────────────▶ API de Pedidos ───────┤
                                                  ▼
                                         Servicio de pedidos
                                                  │
                         ┌────────────────────────┼─────────────────────┐
                         ▼                        ▼                     ▼
                  Modelo canónico          Eventos/auditoría     Consulta tabla
                         │
                         ▼
                     PostgreSQL
```

### Capas

```text
packages/web/src/
  routes/Pedidos.tsx
  routes/PedidoNuevo.tsx
  routes/PedidoDetalle.tsx
  components/orders/

packages/server/src/orders/
  order-controller.js
  order-service.js
  order-repository.js
  order-validator.js
  order-totals.js
  adapters/falabella.js
  adapters/external.js

packages/core/src/
  dominio, migraciones y tipos compartidos
```

Los adaptadores transforman formatos externos al modelo canónico. Las reglas de
pedido no deben conocer detalles de Falabella, Ripley u otro proveedor.

## Modelo de datos objetivo

### `orders`

Cabecera comercial:

```text
id
company_id
number
source_code
external_order_number
customer_id
customer_snapshot
currency
subtotal
discount_total
shipping_total
tax_total
grand_total
order_status
payment_status
fulfillment_status
ordered_at
promised_at
confirmed_at
cancelled_at
created_by
created_at
updated_at
version
```

`number` es el identificador interno único. `external_order_number` es la
referencia comercial mostrada por el proveedor y puede ser nula en pedidos
manuales.

Los importes deben almacenarse en `numeric`, no en punto flotante.

### `order_items`

> Este bloque describe el modelo objetivo de la épica de pedidos manuales. El
> esquema multicanal que existe hoy conserva `description`, `provider_sku` y
> los importes actuales. El catálogo ya agrega `product_id`, `listing_id`,
> `main_sku`, `stock_state`, `stock_applied_quantity` y `stock_revision`; ver
> [Catálogo e inventario multi-seller](catalog-inventory.md). La futura
> migración de pedidos no debe reemplazar ni reinicializar esas columnas.

```text
id
order_id
product_id
external_item_id
sku
name
quantity
unit_price
discount_total
tax_total
line_total
product_snapshot
```

Nombre, SKU, precio e impuestos se guardan como fotografía histórica. Cambiar
el producto del catálogo no modifica pedidos ya confirmados.

### `order_source_refs`

```text
order_id
source_code
reference_type
reference_value
```

Permite asociar varios identificadores a un pedido, por ejemplo `order_id`,
`package_id`, `shipment_id` y `seller_id`. Esto evita duplicados cuando un
marketplace divide una misma compra en paquetes.

Restricción recomendada:

```text
unique(source_code, reference_type, reference_value, company_id)
```

### `order_addresses`

Fotografías de las direcciones de entrega y facturación. No deben depender de
que el cliente edite posteriormente su dirección principal.

### `order_payments`

```text
order_id
provider
method
external_reference
amount
currency
status
paid_at
created_at
updated_at
```

### `order_shipments`

```text
order_id
external_reference
carrier
service
tracking_number
status
promised_at
shipped_at
delivered_at
```

Una tabla relacionada `order_shipment_items` identifica qué cantidades viajan
en cada paquete.

### `order_events`

Historial append-only:

```text
id
order_id
event_type
source
actor_user_id
idempotency_key
old_values
new_values
occurred_at
created_at
```

Eventos principales:

```text
order.created
order.updated
order.confirmed
order.cancelled
payment.updated
fulfillment.preparing
fulfillment.ready
shipment.created
shipment.shipped
shipment.delivered
integration.received
integration.rejected
```

### `order_ingestions`

Controla la recepción e idempotencia de integraciones:

```text
source_code
company_id
idempotency_key
external_reference
payload_hash
received_at
processed_at
status
error
```

## Estados

### Comercial

```text
draft | confirmed | completed | cancelled
```

### Pago

```text
pending | partial | paid | refunded | failed
```

### Entrega

```text
unfulfilled | preparing | ready | partially_shipped | shipped | delivered | cancelled
```

Los estados originales del proveedor se conservan como datos de integración,
pero no se muestran como si fueran el estado canónico.

## Orígenes e integraciones

El origen es un atributo del pedido y un filtro, no una entidad que el operador
deba configurar dentro de Pedidos:

```text
manual | falabella | ripley | external_api | other
```

Las credenciales permanecen en la configuración técnica existente.

### Falabella

```text
Webhook o polling
      ↓
Validar autenticidad y payload
      ↓
Comprobar idempotencia
      ↓
Normalizar pedido, referencias, cliente, productos, total y entrega
      ↓
Crear o actualizar el pedido en una transacción
      ↓
Registrar snapshot y evento
```

Falabella crea y actualiza pedidos automáticamente. El operador no aprueba cada
ingreso.

### Pedido manual

```text
Formulario
   ↓
Validación
   ↓
Cálculo autoritativo de totales
   ↓
Transacción
   ↓
Pedido + productos + direcciones + evento
```

### API o marketplace externo

La ingesta exige una clave de idempotencia:

```http
POST /api/orders/import
Idempotency-Key: marketplace-x:12345
```

Repetir una solicitud equivalente devuelve el pedido existente y no duplica
productos ni eventos.

## API objetivo

```text
GET    /api/orders
POST   /api/orders
GET    /api/orders/:id
PATCH  /api/orders/:id
POST   /api/orders/:id/confirm
POST   /api/orders/:id/cancel
POST   /api/orders/:id/duplicate

POST   /api/orders/import
POST   /api/integrations/falabella/orders/sync
POST   /api/integrations/falabella/webhook
```

Ejemplo de consulta:

```http
GET /api/orders
  ?companyId=1
  &search=juan
  &source=falabella
  &orderStatus=confirmed
  &paymentStatus=paid
  &fulfillmentStatus=preparing
  &dateFrom=2026-07-01
  &dateTo=2026-07-30
  &sort=orderedAt
  &direction=desc
  &limit=10
  &cursor=...
```

## Relación con documentos electrónicos

La dirección de dependencia es:

```text
Documento ── puede referenciar ──▶ Pedido
```

Pedidos no depende de la emisión. El módulo de documentos puede usar
`order_id` para precargar información o asociar una boleta o factura, sin
agregar estados fiscales a la tabla ni al flujo de Pedidos.

## Estrategia de migración

1. Mantener `main` estable y desarrollar la reformulación en una rama nueva
   creada desde el `main` actualizado.
2. Crear el modelo objetivo y migrar/backfillear Falabella de forma idempotente.
3. Implementar primero `GET /api/orders`, `GET /api/orders/:id` y
   `POST /api/orders`.
4. Construir la tabla general, la creación manual y el detalle.
5. Conectar Falabella al servicio canónico y verificar paridad con
   `falabella_orders`.
6. Incorporar edición, confirmación, cancelación y duplicación.
7. Mover recepción y preparación existentes a vistas del pedido canónico.
8. Habilitar el módulo en producción solo después de pruebas de migración,
   permisos, paginación, idempotencia y concurrencia.
9. Retirar `/orders`, las políticas de comprobantes y las tablas iniciales que
   queden obsoletas únicamente después de validar la nueva ruta `/pedidos`.

## Criterios de aceptación de la primera versión

- Existe una sola entrada visible llamada **Pedidos**.
- La tabla muestra número, fecha, cliente, origen, productos, total, pago y
  entrega.
- El monto total siempre es visible.
- Se puede buscar y filtrar sin cargar todos los pedidos en el navegador.
- Se puede crear un pedido manual con uno o más productos.
- Los totales son recalculados por el servidor.
- El detalle muestra cliente, productos, pago, entrega e historial.
- Falabella crea pedidos automáticamente sin duplicarlos.
- No se muestran comprobantes, estados SUNAT ni configuración de canales.
- Las pantallas actuales continúan funcionando durante la migración.
- Confirmar o cancelar un pedido debe reutilizar el hook transaccional de stock
  del catálogo; no debe implementar un segundo descuento de inventario.

## Referencias de diseño investigadas

- [Shopify: búsqueda y vistas de pedidos](https://help.shopify.com/en/manual/fulfillment/managing-orders/viewing-orders/searching-orders)
- [Shopify: creación de pedidos manuales](https://help.shopify.com/en/manual/fulfillment/managing-orders/create-orders/create-draft)
- [commercetools: estados comercial, de pago y envío](https://docs.commercetools.com/api/projects/orders)
- [Material Design: tablas de datos](https://m2.material.io/design/components/data-tables.html)
- [Carbon Design System: data table](https://v10.carbondesignsystem.com/components/data-table/usage/)
