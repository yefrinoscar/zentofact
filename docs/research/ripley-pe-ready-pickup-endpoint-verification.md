# Verificación de lectura: estado “Listo para retiro” en Ripley Perú

Fecha: 2026-09-14.

## Resultado verificable

No hay un endpoint **Mirakl público de lectura, habilitado en
`https://ripleyperu-prod.mirakl.net`**, que permita separar `TO_PREPARE` de
`TO_PICKUP` para esta cuenta.

La prueba contra el tenant fue `GET /api/picklists` (PL11) y respondió
**HTTP 404 Not Found**. Por tanto PL11, aunque aparezca en el OpenAPI genérico
de Mirakl, no está habilitado por Ripley Perú y no puede ser una dependencia de
la sincronización.

## APIs oficiales Mirakl revisadas

| API | Método y ruta | Campos de lectura relevantes | ¿Distingue listo para retiro en Ripley PE? |
| --- | --- | --- | --- |
| OR11 | `GET /api/orders` | `order_state`, `shipping_deadline`, `order_lines` | No. Las órdenes observadas mantienen `order_state: SHIPPING` tanto antes como después del agendamiento. |
| ST11 | `GET /api/shipments` | `id`, `order_id`, `status`, `shipment_lines`, `shipped_date` | No en las órdenes observadas: devuelve `status: SHIPPING` después de agendar. |
| ST12 | `GET /api/shipments/items_to_ship` | `order_id`, `shipment_lines`, `shipping_date`, `shipping_deadline` | No. Su esquema no contiene estado de recojo ni `pickup_date`. |
| PL11 | `GET /api/picklists` | `state`, `pickup_date`, `order_lines` | Sería suficiente en una plataforma que lo habilite, pero Ripley PE responde 404. |
| ST24 | `PUT /api/shipments/ship` | Escritura | No es una lectura; cambia el shipment a enviado. |
| ST26 | `PUT /api/shipments/ready_for_pick_up` | Escritura | No es una lectura; marca el shipment listo para retiro. |

El OpenAPI oficial define PL11 con `pickup_date` y `order_lines`, ST11 con
`status`, y ST12 sin ninguno de esos campos de estado de gestión. No garantiza
que todas las operaciones estén activadas por cada marketplace; el 404 del
tenant prevalece para Ripley Perú.

## Única fuente que sí expone el estado operativo de Ripley

El payload capturado del Seller Center de Ripley contiene el campo privado
`_status_management`:

| Valor | Significado en la bandeja |
| --- | --- |
| `TO_PREPARE` | Para preparar |
| `TO_PICKUP` | Listo para retiro / confirmado |
| `SHIPPED` | Enviado |

La documentación oficial de la API SVC de Ripley publica ese listado en
`GET /api/v3/orders/order/list?is_fast_management=true` y permite el filtro
`status_management`. Esa API usa credenciales distintas de Mirakl. Si SVC no
está autorizado, no existe una fuente Mirakl pública alternativa que reproduzca
ese estado con exactitud.

## Implicación para la sincronización

Se debe retirar PL11 de la ruta de sincronización para eliminar los 404. Con
solo Mirakl, la sincronización puede leer OR11/ST11 y clasificar `SHIPPED` y
estados terminales, pero debe mantener `SHIPPING` como **Preparar**: no hay
evidencia de lectura para elevarlo de forma confiable a **Confirmado**.

Para reflejar Confirmado exactamente como Seller Center se requiere que Ripley
habilite PL11 para el tenant o autorice la credencial/API SVC de solo lectura.

## Fuentes primarias

- [OpenAPI Mirakl Marketplace Front](https://developer.mirakl.com/specs/content/product/mmp/rest/front/openapi3-download.json?download): define OR11, ST11, ST12, PL11, ST24 y ST26, sus rutas y esquemas.
- [OpenAPI Mirakl Marketplace Seller](https://developer.mirakl.com/specs/content/product/mmp/rest/seller/openapi3-download.json?download): confirma las mismas operaciones del lado seller.
- [API SVC v5 de Ripley — Generación automática](https://documenter.getpostman.com/view/19167846/2sA2rFRKas): documenta el listado Fast Management y `status_management`.
