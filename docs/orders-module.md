# Módulo de pedidos multicanal

## Objetivo

Incorporar pedidos de Falabella, Ripley y fuentes externas sin acoplar el dominio
de pedidos a un marketplace. El módulo se agrega en paralelo al flujo actual:
las pantallas existentes continúan leyendo `falabella_orders` y los endpoints
legacy no cambian.

Falabella hace dual-write durante su sincronización y sus webhooks:

1. Actualiza las tablas legacy usadas por las pantallas actuales.
2. Normaliza el pedido.
3. Lo ingresa en `orders`.
4. Guarda un snapshot del payload y un evento auditable.

## Límites del módulo

El módulo es dueño de:

- Canales y cuentas de venta.
- Configuración de creación automática.
- Política de comprobantes por cuenta.
- Identidad canónica del pedido.
- Items, estados normalizados y datos actuales.
- Timeline inmutable y snapshots del proveedor.
- Asociación con boletas, facturas y notas de crédito.
- Comandos idempotentes hacia los canales.
- Ejecuciones de sincronización de adaptadores nuevos.

El módulo no es dueño de:

- Credenciales en texto plano.
- La emisión SUNAT.
- El cliente HTTP específico de cada marketplace.
- Las pantallas actuales de Falabella.

## Modelo

```text
order_channels
  └── order_channel_accounts
        ├── orders
        │     ├── order_items
        │     ├── order_events
        │     ├── order_snapshots
        │     ├── order_documents
        │     └── order_commands
        └── order_sync_runs
```

La identidad externa es:

```text
(channel_account_id, external_order_id)
```

El número visible del pedido no se usa como identidad porque puede repetirse
entre sellers o marketplaces.

## Configuración de comprobantes

La configuración vive en `order_channel_accounts` y tiene dos dimensiones.

### Obligatoriedad

| Valor | Comportamiento |
| --- | --- |
| `disabled` | El canal no permite ni requiere comprobante desde este módulo. |
| `optional` | El pedido puede terminar sin comprobante. |
| `required` | El pedido queda pendiente hasta asociar un comprobante. |

### Selección de tipo

| Valor | Comportamiento |
| --- | --- |
| `automatic` | Usa la solicitud del pedido; si no existe, propone boleta. |
| `boleta` | Solo propone boleta. |
| `factura` | Solo propone factura. |
| `customer_choice` | Espera que el pedido o el operador elijan. |

La política se copia al pedido al momento de crearlo. Cambiar la cuenta afecta
pedidos futuros, pero no modifica silenciosamente la regla histórica de pedidos
ya recibidos.

En Falabella, `InvoiceRequired=true` se normaliza como una solicitud de factura.
Si es falso y la política es `automatic`, el tipo propuesto es boleta, pero la
emisión sigue siendo opcional mientras `document_requirement=optional`.

## Estados

No existe un único estado que mezcle conceptos distintos:

- `order_status`: vida comercial del pedido.
- `payment_status`: cobro y devolución.
- `fulfillment_status`: preparación y entrega.
- `document_status`: emisión y respuesta SUNAT.
- `provider_status`: valor original del marketplace.

Cada adaptador traduce el estado externo a los estados canónicos y conserva
siempre `provider_status` y el payload original.

## Auditoría e idempotencia

`order_events` es append-only. Cada cambio registra:

- Fuente: API, webhook, sincronización, usuario o sistema.
- Valores anteriores y nuevos.
- Usuario, correlación y fecha reportada por el proveedor.
- Idempotency key cuando existe.

`order_snapshots` conserva una versión del payload únicamente cuando cambia su
SHA-256. El backfill inicial identifica sus snapshots con `legacy-md5:` porque
PostgreSQL ofrece MD5 sin extensiones; la ingesta normal usa SHA-256. Esto evita
duplicar payloads idénticos sin perder evidencia.

El endpoint de ingreso exige `Idempotency-Key`. Repetir la misma solicitud
devuelve el pedido existente sin crear otro evento.

Actualizaciones con `provider_updated_at` anterior al dato actual no hacen
retroceder el pedido. El payload se conserva y se registra
`order.stale_observed`.

## Adaptadores

Un adaptador debe:

1. Obtener o recibir datos externos.
2. Normalizar identidad, estados, cliente, montos, despacho e items.
3. Llamar a `ingestOrder`.
4. Implementar solamente las acciones soportadas por el canal.

Falabella tiene un adaptador inicial en
`packages/server/src/order-adapters/falabella.js`. Ripley queda registrado como
canal, pero su integración API se implementará como un adaptador separado cuando
se definan sus credenciales, contrato y mecanismo de sincronización.

`auto_create_orders` se configura por cuenta. Falabella lo activa por defecto;
un canal manual o externo lo mantiene apagado salvo configuración explícita.

## API backend

Todas las rutas nuevas usan el prefijo `/order-management` y conservan
temporalmente el permiso `falabella` para no modificar roles o pantallas.

```text
GET    /order-management/channels
POST   /order-management/channels
GET    /order-management/accounts
POST   /order-management/accounts
PATCH  /order-management/accounts/:id
GET    /order-management/orders
GET    /order-management/orders/:id
POST   /order-management/orders/ingest
```

Crear o modificar canales/cuentas también requiere el permiso `companies`.

Ejemplo de cuenta:

```json
{
  "companyId": 7,
  "channelCode": "external",
  "externalAccountId": "tienda-web",
  "displayName": "Tienda web",
  "autoCreateOrders": false,
  "documentRequirement": "optional",
  "documentTypePolicy": "customer_choice"
}
```

Ejemplo de ingreso:

```http
POST /order-management/orders/ingest
Idempotency-Key: tienda-web:pedido-100
```

```json
{
  "companyId": 7,
  "channelAccountId": 25,
  "externalOrderId": "pedido-100",
  "externalOrderNumber": "WEB-100",
  "orderStatus": "confirmed",
  "fulfillmentStatus": "pending",
  "requestedDocumentType": "factura",
  "currency": "PEN",
  "total": 149.9,
  "customer": {
    "name": "Cliente"
  },
  "items": [
    {
      "externalItemId": "linea-1",
      "sku": "SKU-1",
      "description": "Producto",
      "quantity": 1,
      "unitPrice": 149.9,
      "total": 149.9
    }
  ],
  "itemsComplete": true
}
```

## Evolución prevista

1. Mantener dual-write de Falabella y comparar conteos/estados.
2. Implementar el adaptador Ripley sin modificar el dominio.
3. Asociar la emisión SUNAT mediante `order_documents`.
4. Crear una pantalla nueva que lea exclusivamente `/order-management`.
5. Migrar acciones Falabella a `order_commands`.
6. Retirar el modelo legacy solo después de verificar paridad.
