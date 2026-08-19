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
Compra recibida desde un canal o creada a mano, con productos, cliente y estado de entrega.
_Avoid_: Orden, boleta

**Listo para enviar**:
Estado de entrega en el que el pedido ya está preparado y sale del almacén. Es el momento en que se descuenta el stock del Producto.
_Avoid_: confirmed, pending

**Movimiento de inventario**:
Registro auditable de una entrada o salida del stock de un Producto. Si sale por un Pedido listo para enviar, queda ligado a ese pedido.
_Avoid_: Bitácora, kardex
