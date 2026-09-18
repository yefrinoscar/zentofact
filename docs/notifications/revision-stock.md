# Revisión de avisos de stock

## Caso G-8

La captura muestra una zapatera con una unidad disponible, nueve unidades vendidas en 30 días y aproximadamente cuatro días de cobertura. La regla anterior exigía disponible <= 0 y ventas en los últimos siete días. Con una unidad, el producto quedaba excluido tanto en SQL como en la política de avisos.

Se reprodujo con un producto equivalente en pruebas locales. No se consultó el historial de producción ni el estado leído/descartado del usuario. Las dos ventas de la última semana usadas en la prueba son un dato de prueba, no un dato comprobado de G-8.

## Funcionamiento actual

| Aviso | Condición |
| --- | --- |
| Comprobantes sin emitir | Trabajos fallidos o pendientes que alcanzaron el umbral de intentos |
| Insumos por reponer | Saldo igual o inferior al mínimo configurado |
| Pedidos vencidos | Pedidos abiertos cuyo plazo de envío pasó |
| Productos agotados | Producto activo sin disponible y con ventas recientes |
| Productos por reponer, añadido aquí | Producto activo con disponible positivo y hasta siete días estimados de cobertura |

La campana consulta cada 30 segundos. Muestra hasta ocho avisos y permite abrir el listado completo. Los permisos del usuario determinan qué avisos puede ver. Leído y descartado se guardan por usuario. Los avisos se calculan a partir del estado actual; no constituyen un historial de eventos.

## Cambio implementado

- Calcula el ritmo con el mayor promedio diario entre siete y 30 días. Así contempla aumentos recientes de venta y productos que no vendieron esta semana.
- Usa disponible: almacén menos reservas y devoluciones pendientes de aprobación.
- Avisa con hasta siete días de cobertura; con tres o menos, marca urgencia crítica. Son valores iniciales del código, no plazos de reposición confirmados por el negocio.
- Muestra SKU, unidades disponibles, cobertura estimada y una indicación de revisar reposición. Redondea los días hacia arriba y los identifica como estimación.
- Un descenso de disponible o cambio de urgencia produce un nuevo identificador y permite volver a avisar después de un descarte.
- Mantiene el aviso al agotarse incluso si las ventas fueron entre ocho y 30 días atrás.
- Amplía los candidatos de productos de diez a 50 y los ordena por cobertura antes de aplicar el estado por usuario.

## Qué conviene mejorar después

1. Unificar la fuente de ventas con el catálogo. El catálogo también resuelve asociaciones por publicaciones y filtra estados de artículos; los avisos usan `order_items.product_id` y estados de pedido. Pueden diferir con artículos aún sin asociación o devoluciones parciales.
2. Guardar episodios de riesgo. Hoy reponer y volver exactamente al mismo saldo y urgencia puede reutilizar un aviso descartado. El identificador de agotados también depende del número de ventas, por lo que puede repetirse un aviso al cambiar la ventana.
3. Mostrar fallos de actualización. Si una fuente falla, el servidor registra el error y omite esa fuente; la campana puede parecer completa.
4. Definir avisos fuera de la aplicación. Este cambio incorpora reposición en la campana. El sonido existente sigue reservado a agotados; no se añadió correo, WhatsApp ni notificación del sistema.
5. Paginar candidatos antes de escalar el catálogo. El límite de 50 se aplica antes de excluir descartados; todavía puede dejar otros productos fuera.

## Validación

- `node --test packages/server/src/notifications.test.js`: 16 pruebas aprobadas, incluida la reproducción que fallaba antes del cambio.
- `node --test --experimental-strip-types packages/web/src/lib/notifications-presentation.test.js`: seis pruebas aprobadas.
- `npm run typecheck -w @zentofact/web`: aprobado.
- Consulta real de productos y servicio de notificaciones ejecutados con PGlite temporal, fuera de las dependencias del proyecto: cobertura, reservas, cancelaciones, agotados de venta lenta, marcado leído, descarte y transición posterior a agotado aprobados. Las otras fuentes de avisos se sustituyeron por resultados vacíos.
- Prueba visual pendiente: `scripts/cloud-agent-start.sh` no pudo arrancar en este Mac porque faltan `pg_isready` y las herramientas Linux de Postgres. No se desplegó a producción.
