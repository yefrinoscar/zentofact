# Catálogo e inventario multi-seller

Estado: implementado detrás de feature flag (2026-08-08).

## Alcance implementado

- Catálogo canónico global por `main_sku`.
- Listings aislados por canal, empresa y `seller_sku`.
- Stock físico compartido entre todos los sellers de la instancia.
- Ledger append-only y saldo materializado.
- Ajustes manuales delta/absoluto con motivo obligatorio.
- Importación Falabella que reutiliza un `main_sku` sanitizado existente.
- Reconciliación de pedidos listos para enviar, enviados o entregados,
  cambios de cantidad, líneas eliminadas, cancelaciones, fallos y
  devoluciones. Un pedido `pending` no descuenta stock.
- Cada movimiento de venta cita el número de pedido y el seller. El
  descuento aplica al producto maestro asociado, no a cada publicación.
- Cola operativa para `skipped_unmapped` y `skipped_insufficient`.
- Acción explícita para aplicar stock a pedidos abiertos después de vincular o
  reabastecer. Vincular un listing por sí solo no modifica pedidos históricos.
- La publicación directa a Falabella sigue disponible como acción secundaria.

### Asociación de publicaciones al producto maestro

La sincronización completa no usa igualdad literal de título. Construye un perfil
normalizado por publicación con familia comercial, marca, categoría, color, talla,
modelo numérico, precio, SKU externo e imagen primaria. La sincronización calcula
una huella del contenido de la imagen; así reconoce archivos idénticos aunque sus
URLs sean distintas. Color y talla se obtienen primero
de los atributos del seller y, si faltan, se infieren del título. Solo se autoasocia
una publicación cuando el resultado supera el umbral de alta confianza y no existe
otra familia candidata prácticamente empatada.

- Colores, tallas o modelos numéricos incompatibles nunca se mezclan.
- Variantes como `Blanco M`, `Blanco L` y `Negro XL` conservan productos maestros distintos.
- Un SKU externo idéntico entre sellers es una señal fuerte, pero todavía exige una familia de producto compatible.
- Dos títulos parecidos del mismo seller no se fusionan por una coincidencia débil. Se admite un duplicado cuando comparte imagen binaria o cuando tres sellers ya corroboran la misma identidad con alta confianza.
- El listado permite filtrar por cobertura (`Solo 1 seller` o `2 o más sellers`) y ejecuta el conteo en SQL junto con la paginación del servidor.
- Cada listing conserva `associationMethod`, `associationConfidence` y `associationSignals` en metadata para explicar la decisión.
- Los casos ambiguos permanecen separados; es preferible revisarlos que contaminar stock y pedidos de otro producto.

Las rutas HTTP se montan sin prefijo dentro del servidor (`/products`,
`/catalog/...`). El proxy de despliegue puede exponerlas bajo `/api`; el cliente
web usa las rutas internas del servidor, igual que los módulos existentes.

## Activación segura

```dotenv
CATALOG_INVENTORY_ENABLED=false
CATALOG_ALLOW_NEGATIVE_MARKETPLACE=false
CATALOG_ALLOW_NEGATIVE_MANUAL=false
```

1. Desplegar las migraciones y la UI con el hook apagado.
2. Importar listings de cada seller.
3. Registrar stock inicial mediante ajustes absolutos con motivo.
4. Validar en staging un pedido nuevo, re-sync idéntico, cambios `2→1→2→1`,
   eliminación de línea, cancelación y devolución.
5. Cambiar `CATALOG_INVENTORY_ENABLED=true` y reiniciar el servicio.

Desactivar el flag detiene el descuento en re-sync e hidratación histórica;
no borra saldos ni movimientos. El paso a listo para enviar (webhook o
bandeja) sigue aplicando el movimiento.

## Invariantes de stock

- El stock interno se descuenta cuando el pedido pasa a `ready_to_ship`
  (el mismo momento que habilita la boleta), no al confirmarlo ni al
  recibirlo como `pending`. `shipped` y `delivered` también son elegibles
  si el descuento todavía no se aplicó.
- El webhook y la bandeja no descuentan en el request: encolan un job en
  `inventory_stock_jobs`. Un worker aparte (lotes de 8, reintento) escribe
  el movimiento. La cola de boletas sigue siendo otra; el mismo evento
  `listo para enviar` alimenta las dos. Un backfill por fecha operativa
  (`POST /catalog/inventory/apply-ready-orders`) encola el día y drena la cola.
- `stock_applied_quantity` indica cuántas unidades de una línea ya están en el
  ledger. `stock_revision` solo aumenta cuando se inserta un movement real.
- Las claves usan la revisión monotónica (`...:rev:N`), no la cantidad final.
- Un re-sync idéntico no llama al ledger.
- Una línea se revierte antes del `DELETE`; las FKs del ledger pasan a `NULL`
  después del borrado y la auditoría permanece.
- Un hit idempotente inesperado nunca adelanta `stock_applied_quantity`.
- Cancelación y devolución seleccionan toda línea con
  `stock_applied_quantity > 0`, aunque su estado actual sea
  `skipped_insufficient`. Esto es importante cuando una subida de cantidad no
  pudo aplicar el delta nuevo: las unidades aplicadas anteriormente todavía
  deben devolverse. El movimiento queda en el ledger con motivo visible
  (`Cancelación del pedido …` o `Devolución del pedido …`).
- El sync de Falabella reingesta un pedido listo para enviar cuando
  GetOrderItems reporta cancelación, fallo o devolución, para reintegrar el
  stock ya descontado. Una línea cancelada o devuelta se revierte aunque el
  pedido siga en `ready_to_ship`.
- Con stock insuficiente marketplace se guarda el pedido y se marca la línea;
  el saldo no se vuelve negativo. Ajustes manuales insuficientes hacen rollback.

## Resolución de SKU

1. Match exacto activo por `(channel_code, company_id, seller_sku)`.
2. Fallback activo por `shop_sku` solo si devuelve exactamente una fila.
3. Cero o múltiples coincidencias quedan sin mapping.
4. Las futuras líneas manuales deben informar `product_id` directamente.

El scanner Falabella continúa usando `falabella_product_variants`; no depende
del catálogo canónico.

## Operación

La pantalla `/productos` muestra siempre el stock interno. El stock del canal se
muestra solo como referencia en cada listing. El permiso `productos` otorga
acceso global al catálogo y permite vincular cualquier empresa activa, de
acuerdo con el modelo actual de la instancia.

### Ventas y devoluciones bajo demanda

El drawer no carga analítica comercial junto con el catálogo. Al abrir las
pestañas `Ventas` o `Devoluciones`, React Query llama únicamente entonces a:

```http
POST /products/:id/activity
Content-Type: application/json

{ "kind": "sales", "range": "30" }
```

`kind` acepta `sales` o `returns`; `range` acepta `30`, `90`, `365` o `all`.
La respuesta incluye el resumen, las operaciones recientes, `durationMs`, la
fuente y una cobertura explícita (`orderHeaders`, `orderDetails`,
`dataUpdatedThrough`, `complete`). El servidor limita la búsqueda a las
empresas que tienen listings activos del producto, consulta hasta ocho pedidos
en paralelo y omite pedidos que ya tienen líneas cacheadas.

La base local es la fuente de lectura para el histórico y para el módulo
`/salidas`. Falabella solo se consulta como ventana corta de 2 días: cabeceras
incrementales con `UpdatedAfter = cursor_updated_at - 10 minutos` y, si el
seller aún no tiene cursor, un bootstrap de esos mismos 2 días. No se vuelve a
pedir el periodo 30/90/365. Después solo se solicita `GetOrderItems` para las
órdenes recientes cuyos detalles todavía no existen localmente.

La UI no presenta “caché” como prueba suficiente. Indica que Falabella fue
consultado, cuántas cabeceras del periodo local tienen detalle revisado y cuánto
tomó. Solo afirma que no existen ventas o devoluciones cuando la consulta live
de la ventana corta terminó para todos los sellers y `coverage.complete` es
verdadero; de lo contrario muestra que la consulta está incompleta.

### Salidas de hoy

`/salidas` agrega desde `orders` y `order_items` los productos que salen el
día de Lima. La fecha operativa es `PromisedShippingTime` (o
`promised_shipping_at`), no la fecha de compra. Muestra la cantidad de cada
producto y el saldo de almacén cuando el SKU ya está en el catálogo. La
lectura inicial no llama a Falabella.

```http
GET /catalog/sales/today?date=2026-08-12
POST /catalog/sales/today/refresh
```

El POST refresca solo los últimos 2 días de cabeceras e hidrata las líneas
faltantes; luego vuelve a agregar desde la base local. Incluye líneas todavía
no asociadas a un producto maestro. El permiso `salidas` abre el módulo;
quienes ya tienen `productos` también pueden consultar la API.

Los títulos de Falabella cambian por seller. La agregación no agrupa por ese
nombre: usa la relación `order_items.listing_id → product_listings.product_id`,
luego `order_items.product_id` y, si ambos faltan, el listing activo de la
empresa por seller SKU, shop SKU o título. Varias publicaciones del mismo
producto maestro cuentan como una sola fila; cada seller conserva su título
propio en el desglose. No hay una tabla aparte de “product relations”; el
vínculo canónico es `product_listings`.

El sync periódico también usa el cursor con diez minutos de solapamiento y un
minuto de margen de seguridad: normalmente descarga únicamente pedidos creados
o modificados desde la ejecución anterior. El histórico ya persistido no se
vuelve a solicitar. Además hidrata, de forma acotada, hasta 100 pedidos del
delta actual que todavía no tienen líneas, con seis solicitudes de detalle en
paralelo; los pedidos ya guardados y los históricos ausentes del delta se
omiten en el camino crítico. Un backfill mensual explícito puede completar la
historia anterior sin agrandar el sync incremental. Los históricos se asocian
para analítica con
`stock_state=skipped_policy`, sin movimientos retroactivos; el tab sigue haciendo
la comprobación live para detectar cambios ocurridos desde el último sync.

Falabella entrega varias unidades como varios `OrderItem` y puede omitir
`Quantity`; cada línea sin cantidad explícita representa una unidad. Las líneas
recuperadas para analítica se asocian por seller SKU y empresa, se marcan como
`skipped_policy` y nunca generan stock retroactivo. Ventas excluye cancelaciones,
fallos y devoluciones; Devoluciones usa el estado devuelto de la orden o de la
línea. Ninguna consulta modifica publicaciones, precios o stock del seller.

Para investigar drift:

```sql
select * from product_inventory where quantity_on_hand < 0;

select oi.*, o.external_order_number
from order_items oi
join orders o on o.id = oi.order_id
where oi.stock_state in ('skipped_unmapped', 'skipped_insufficient')
order by oi.updated_at desc;
```
