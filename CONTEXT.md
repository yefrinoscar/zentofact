# ZentoFact

Operación de catálogo, pedidos, comprobantes e inventario de una bodega multi-seller.

## Language

**Insumo**:
Material de empaque que se consume al operar: fill grande, fill pequeño o cinta scotch. Tiene cantidad propia y no se vende.
_Avoid_: Producto, SKU, listing, stock de catálogo

**Producto**:
Artículo vendible del catálogo canónico, identificado por SKU interno.
_Avoid_: Insumo

**Pedido**:
Compra recibida desde un canal o creada a mano, con productos, cliente y estado de entrega. Dos pedidos con identidades externas distintas nunca se fusionan.
_Avoid_: Orden, boleta

**ID interno de Pedido**:
Identificador único asignado por ZentoFact a un Pedido sin importar su seller o canal.
_Avoid_: ID del seller, número del marketplace

**ID externo de Pedido**:
Identificador asignado por el canal dentro de un Seller. Puede repetirse en otro Seller sin representar el mismo Pedido.
_Avoid_: ID interno

**Seller**:
Presencia de una Empresa en un canal de venta, con identidad y credenciales propias dentro de ese canal.
_Avoid_: Empresa, canal

**Seller conectado**:
Seller que tiene configuradas todas las credenciales API requeridas por su canal.
_Avoid_: Empresa activa

**Sincronización de pedidos**:
Proceso que incorpora Pedidos de un Seller conectado y actualiza los que ya conserva ZentoFact.
_Avoid_: Emisión automática, facturación

**Emisión automática**:
Proceso de facturación que genera comprobantes para Pedidos elegibles. Es independiente de la Sincronización de pedidos.
_Avoid_: Sincronización, importación de pedidos

**Estado del canal**:
Estado original que un canal asigna a un Pedido. Se conserva aunque ZentoFact todavía no conozca su significado operativo.
_Avoid_: Estado operativo

**Estado operativo**:
Estado común con el que ZentoFact representa el avance de un Pedido sin depender del vocabulario de su canal.
_Avoid_: Estado del canal

**Pedido con artículos pendientes**:
Pedido cuya identidad y cabecera ya fueron recibidas, pero cuyos artículos todavía no están completos. No está listo para inventario, facturación ni acciones operativas.
_Avoid_: Pedido sincronizado

**Listo para enviar**:
Estado de entrega en el que el pedido ya está preparado y sale del almacén. Es el momento en que se descuenta el stock del Producto.
_Avoid_: confirmed, pending

**Movimiento de inventario**:
Registro auditable de una entrada o salida del stock de un Producto. Si sale por un Pedido listo para enviar, queda ligado a ese pedido.
_Avoid_: Bitácora, kardex

**Comisión**:
Monto fijo configurado en el Producto para calcular la ganancia al venderlo.
_Avoid_: Margen, fee, comisión del marketplace

**Beneficiario**:
Persona a la que se atribuye la ganancia del Producto al filtrar o exportar reportes.
_Avoid_: Flag, tag, dueño, owner, seller

**Envío propio**:
Entrega con movilidad de la bodega. Se muestra como el repartidor Express y se guarda como `nosotros`.
_Avoid_: Movilidad propia as stored id, Nosotros as label

**Zona de envío**:
Grupo de distritos de Lima Metropolitana con un solo precio. El admin la nombra, le pone precio y le asigna distritos en Envío propio. Por defecto son tres, repartidas por distancia a la bodega: Cerca, Media y Lejos.
_Avoid_: tarifa zonal, tramo, rango de km

**Precio de envío**:
Monto que cobra un Envío propio: el precio de la Zona de envío del destino, cobrado una sola vez.
_Avoid_: recargo, precio por distrito, suma de distrito más distancia

**Almacén**:
Punto del que sale el reparto y al que el cliente va cuando elige Recojo. Guarda dirección, pin y horario de recojo, y se edita en Envío propio. Mover el pin regenera la distancia de todos los distritos.
_Avoid_: bodega, origen, depósito

**Distancia al almacén**:
Kilómetros entre el Almacén y el destino. Sirve para agrupar distritos en zonas y se muestra al vendedor. No se cobra.
_Avoid_: recargo km, precio por distancia
