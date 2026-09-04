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
  devoluciones. Un pedido `pending` o `preparing` reserva stock
  (`quantity_reserved`). Al pasar a `ready_to_ship` la reserva se
  confirma y se descuenta el almacén.
- Cada movimiento de venta cita el número de pedido y el seller. El
  descuento aplica al producto maestro asociado, no a cada publicación.
- Cola operativa para `skipped_unmapped` y `skipped_insufficient`.
- Acción explícita para aplicar stock a pedidos abiertos después de vincular o
  reabastecer. Vincular un listing por sí solo no modifica pedidos históricos.
- Publicar o despublicar Falabella permanece visual-only hasta
  `MARKETPLACE_PUBLICATION_MUTATION_ENABLED=true`. El catálogo solo simula
  el flujo y no llama al Seller API.

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

El flag operativo vive en la tabla `system_settings` y se controla desde el
panel **Configuración del sistema** (`/#/system-config`), visible solo para
superadministradores. **Cola de descuentos** (`/#/descuentos-stock`) muestra
ese mismo interruptor: Encendido o Apagado. No hay un segundo switch. La
variable de entorno `CATALOG_INVENTORY_ENABLED`
ya no enciende la funcionalidad: actúa únicamente como **kill-switch** —
si está explícitamente en `false` apaga el flag aunque la base de datos lo
tenga prendido. El panel muestra un checklist con los pasos 2–4; el servidor
rechaza encender mientras no exista al menos un listing activo.

```dotenv
CATALOG_INVENTORY_ENABLED=false
CATALOG_ALLOW_NEGATIVE_MARKETPLACE=false
CATALOG_ALLOW_NEGATIVE_MANUAL=false
```

1. Desplegar las migraciones y la UI con el flag apagado.
2. Importar listings de cada seller.
3. Registrar stock inicial mediante ajustes absolutos con motivo.
4. Validar en staging un pedido nuevo, re-sync idéntico, cambios `2→1→2→1`,
   eliminación de línea, cancelación y devolución.
5. Encender `Descuento de inventario` desde el panel superadmin (o dejar la
   env en `true` como valor inicial del ambiente antes del primer arranque;
   después manda la BD).

### Preparar un ambiente de producción

Sigue este orden cuando un ambiente ya tiene pedidos o publicaciones:

1. Despliega la versión que separa `product_inventory.quantity_on_hand` de
   `product_listings.marketplace_quantity`. Una sincronización de catálogo no
   debe cambiar el stock físico.
2. Abre **Configuración del sistema** y pulsa **Revisar catálogo Ripley**. La
   vista previa muestra las publicaciones que se asociarán, los productos
   maestros que se crearán y las publicaciones desasociadas que no se tocarán.
3. Revisa la vista previa y pulsa **Aplicar cambios**. El proceso importa solo
   ofertas activas. Compara título, SKU, marca, categoría, precio, color, talla
   y la huella del archivo de imagen. Una coincidencia ambigua crea un producto
   maestro separado.
4. Fija el stock físico actual con un ajuste absoluto para cada producto que
   aparezca en **Saldos auditables**. Usa un conteo del almacén, no la suma del
   stock publicado por los sellers.
5. Elige cómo cerrar las ventas anteriores al conteo físico:
   - Si el conteo representa el stock actual, no vuelvas a descontar esas
     ventas. El conteo ya incluye las unidades que salieron del almacén.
   - Si el saldo corresponde a una fecha anterior a esas ventas, concilia las
     ventas para aplicar sus movimientos en orden.

No concilies ventas históricas sobre un saldo copiado del marketplace. Esa
operación puede descontar dos veces una venta o conservar un saldo inflado.

**Saldos auditables** no significa que el producto esté negativo. El aviso
indica que `quantity_on_hand` cambió sin un registro equivalente en
`inventory_movements`. Un ajuste absoluto establece un punto de partida
auditable: registra el saldo contado, la diferencia aplicada, el motivo y el
usuario que hizo el cambio.

Desactivar el flag detiene reservas y descuentos en re-sync e hidratación
histórica; no borra saldos ni movimientos. El webhook o la bandeja encolan
el pedido desde pendiente.

## Invariantes de stock

- Desde el 3 set 2026 a las 12:00 America/Lima, webhook, cron y la
  escucha de la cola toman un pedido `pending` o `preparing` y reservan
  el producto maestro. `quantity_on_hand` no cambia. El primer arranque
  de esta versión borra la cola de descuentos, suelta reservas y
  deshace solo ventas con `metadata.reserved=true`. Los descuentos
  viejos de listo para enviar no se tocan.
  `available` baja porque `available = on_hand - reserved`. El número
  que el catálogo, el resumen, Inventario y las ventas llaman Stock es
  `available`. `quantity_on_hand` solo aparece como En almacén. Al
  pasar a `ready_to_ship` la reserva se confirma: baja `quantity_on_hand`
  y `quantity_reserved`. `shipped` y `delivered` confirman si todavía
  faltaba. Pedidos anteriores a esa hora no reservan ni descuentan.
- El webhook y la bandeja no escriben el saldo en el request: encolan un
  job en `inventory_stock_jobs`. El worker escucha pedidos pendientes
  posteriores al corte, reserva, y al listo para enviar confirma. La cola
  de boletas sigue siendo otra y se alimenta al listo para enviar. Un
  backfill por fecha operativa (`POST /catalog/inventory/apply-ready-orders`)
  encola el día listo para enviar y drena la cola.
- En `pending`, `stock_applied_quantity` es la cantidad reservada. En
  `applied`, es la cantidad ya descontada del almacén. `stock_revision`
  solo aumenta cuando se inserta un movement real.
- Las claves usan la revisión monotónica (`...:rev:N`), no la cantidad final.
- Un re-sync idéntico no llama al ledger.
- Una línea se revierte antes del `DELETE`; las FKs del ledger pasan a `NULL`
  después del borrado y la auditoría permanece.
- Un hit idempotente inesperado nunca adelanta `stock_applied_quantity`.
- Cancelación y devolución seleccionan toda línea con
  `stock_applied_quantity > 0`, aunque su estado actual sea
  `skipped_insufficient`. Esto es importante cuando una subida de cantidad no
  pudo aplicar el delta nuevo: las unidades aplicadas anteriormente todavía
  deben devolverse. Un sync posterior de un pedido ya cancelado o devuelto
  reintegra el saldo residual una sola vez.
- El reconcile de `GetOrderItems` incluye pedidos `pending`/`ready_to_ship` y
  también pedidos ya enviados o entregados que todavía tienen stock aplicado,
  para reintegrar una cancelación o devolución tardía.
- El movimiento queda en el ledger con motivo visible
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

La base local es la fuente de lectura para el histórico de ventas del
producto. Falabella solo se consulta como ventana corta de 2 días: cabeceras
incrementales con `UpdatedAfter = cursor_updated_at - 10 minutos` y, si el
seller aún no tiene cursor, un bootstrap de esos mismos 2 días. No se vuelve a
pedir el periodo 30/90/365. Después solo se solicita `GetOrderItems` para las
órdenes recientes cuyos detalles todavía no existen localmente.

La UI no presenta “caché” como prueba suficiente. Indica que Falabella fue
consultado, cuántas cabeceras del periodo local tienen detalle revisado y cuánto
tomó. Solo afirma que no existen ventas o devoluciones cuando la consulta live
de la ventana corta terminó para todos los sellers y `coverage.complete` es
verdadero; de lo contrario muestra que la consulta está incompleta.

### Agregación por plazo de envío

`GET /catalog/sales/today` agrega desde `orders` y `order_items` los productos
cuyo `PromisedShippingTime` (o `promised_shipping_at`) cae en el día de Lima,
no la fecha de compra. No hay pantalla de “Salidas de hoy”: esa ruta redirige
a Todos los pedidos. Quienes tienen `productos` o `order_management` pueden
consultar la API. El POST refresca solo los últimos 2 días de cabeceras e
hidrata las líneas faltantes.

```http
GET /catalog/sales/today?date=2026-08-12
POST /catalog/sales/today/refresh
```

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
