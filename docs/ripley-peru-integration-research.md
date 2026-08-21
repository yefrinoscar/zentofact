# Integración con Ripley Perú: plataformas, APIs y ambientes

Investigación realizada el 20 de agosto de 2026. El alcance está limitado a fuentes oficiales de **Ripley Perú** y **Mirakl**. No se utilizó documentación de Ripley Chile.

## Conclusión ejecutiva

Ripley Perú utiliza al menos dos plataformas distintas:

1. **Mirakl**, para catálogo, productos, ofertas, precios, stock, pedidos comerciales, mensajería y documentos asociados a pedidos. La instancia oficial publicada por Ripley Perú es `https://ripleyperu-prod.mirakl.net`. Ripley Perú sí publica instrucciones para generar una clave API en esta plataforma y presenta la integración por API como una vía soportada.
2. **Seller Center (SC/SVC)**, para la operación logística y otras funciones auxiliares: imprimir etiquetas y manifiestos, agendar retiros, gestionar tickets, incidencias, imágenes y reposiciones de Fulfillment. Ripley Perú enlaza públicamente el acceso vigente `https://sellercenter.ripleylabs.com`, pero **no publica una especificación API de Seller Center para Perú**. La palabra `labs` en el dominio no demuestra que sea un sandbox; las guías peruanas lo enlazan para la operación normal del seller.

No se encontró una URL oficial de sandbox, QA o desarrollo para Ripley Perú, ni credenciales de prueba públicas para Mirakl o Seller Center. Esto no demuestra que Ripley Perú carezca de ambientes privados; demuestra que **no están publicados y deben solicitarse a Ripley Perú**. El nombre `ripleyperu-prod` y la documentación oficial confirman la URL productiva, pero no autorizan a deducir una URL QA.

## Matriz de evidencia

| Área | Confirmado para Perú | No publicado para Perú |
| --- | --- | --- |
| Mirakl | Instancia productiva, generación de API key e integración para productos, stock y ventas | URL QA/dev, tienda de prueba, datos de prueba y lista exacta de APIs habilitadas por Ripley Perú |
| Seller Center | Acceso web vigente y uso operativo para etiquetas, manifiestos, agendamiento, tickets, incidencias y reposiciones | Clasificación pública del ambiente, documentación API, autenticación API, endpoints, URL QA/dev y credenciales de integración |
| Integradores | Integración propia o mediante integradores listados por Ripley Perú | Programa público de certificación técnica, checklist de homologación o credenciales especiales para partners |

## 1. Mirakl en Ripley Perú

### URL comprobada

Ripley Perú dirige repetidamente a los sellers a:

- Interfaz: `https://ripleyperu-prod.mirakl.net/login`
- Base inferida para la API REST: `https://ripleyperu-prod.mirakl.net`

La URL aparece en las guías peruanas para [configurar la tienda](https://ripleyperu.zendesk.com/hc/es/articles/4404129730957-Configura-tu-tienda-desde-cero), [crear productos manualmente](https://ripleyperu.zendesk.com/hc/es/articles/20043324867725--C%C3%B3mo-crear-productos-de-manera-manual), [cargar productos por plantilla](https://ripleyperu.zendesk.com/hc/es/articles/4404565345549--C%C3%B3mo-subir-mi-plantilla-y-validar-si-carg%C3%B3-correctamente) y [actualizar precios y stock](https://ripleyperu.zendesk.com/hc/es/articles/4404552332557--C%C3%B3mo-actualizo-la-oferta-de-mis-productos-Precio-stock-descuentos). Mirakl documenta sus rutas bajo `https://your-instance.mirakl.net/api/...`; reemplazar esa instancia por la URL publicada de Perú produce la base `https://ripleyperu-prod.mirakl.net/api`. Es una inferencia técnica respaldada por ambas fuentes, no una base rotulada expresamente por Ripley Perú en una página pública.

### Autenticación

La guía peruana [Intégrate y gestiona tu tienda](https://ripleyperu.zendesk.com/hc/es/articles/32669080905101-Int%C3%A9grate-y-gestiona-tu-tienda) indica este flujo:

1. Ingresar al perfil de usuario de Mirakl.
2. Abrir **Ajustes personales**.
3. Entrar en **Clave API** y generar la clave; la misma página indica que puede actualizarse.

La [documentación oficial de la API Seller de Mirakl](https://developer.mirakl.com/content/product/mmp/rest/seller/openapi3) especifica que la API key se envía directamente en el encabezado HTTP:

```http
Authorization: <API_KEY_DE_MIRAKL>
```

No lleva el prefijo `Bearer`. Mirakl exige HTTPS. La clave pertenece al usuario/tienda de Mirakl y debe tratarse como un secreto.

### APIs relevantes

Ripley Perú no publica una tabla propia de códigos de endpoint. Los siguientes son endpoints de la **API Seller estándar de Mirakl** y son los candidatos técnicos coherentes con las funciones que Ripley Perú sí anuncia. Su disponibilidad y configuración exactas en la instancia peruana deben validarse con la API key de una tienda autorizada y con Ripley Perú.

#### Productos y catálogo

| Código Mirakl | Método y ruta | Función |
| --- | --- | --- |
| P41 | `POST /api/products/imports` | Importar productos mediante CSV, XML o XLSX |
| P51 | `GET /api/products/imports` | Consultar estados de importaciones de productos |
| P42 | `GET /api/products/imports/{import}` | Consultar una importación concreta |
| P31 | `GET /api/products` | Consultar productos por referencias |
| H11 | `GET /api/hierarchies` | Consultar categorías del catálogo |

Fuente: [Mirakl Seller API — Products](https://developer.mirakl.com/content/product/mmp/rest/seller/openapi3/products).

La documentación peruana confirma funcionalmente la creación manual y masiva de productos, plantillas separadas por categoría y la aprobación de publicaciones; no confirma que todos los endpoints anteriores estén habilitados con idéntica configuración para cada seller.

#### Ofertas, precios y stock

| Código Mirakl | Método y ruta | Función |
| --- | --- | --- |
| OF01 | `POST /api/offers/imports` | Importar ofertas; opcionalmente puede incluir información de productos |
| OF24 | `POST /api/offers` | Crear, actualizar o eliminar ofertas mediante JSON |
| OF21 | `GET /api/offers` | Listar ofertas de la tienda |
| OF22 | `GET /api/offers/{offer}` | Consultar una oferta concreta |
| P11 | `GET /api/products/offers` | Consultar ofertas relacionadas con productos |
| PRI01 | `POST /api/offers/pricing/imports` | Importar precios |
| STO01 | `POST /api/offers/stock/imports` | Importar stock |

Fuentes: [Mirakl Seller API — Offers](https://developer.mirakl.com/content/product/mmp/rest/seller/openapi3/offers), [OF01](https://developer.mirakl.com/content/product/mmp/rest/seller/openapi3/offers/of01), [OF24](https://developer.mirakl.com/content/product/mmp/rest/seller/openapi3/offers/of24) y [STO01](https://developer.mirakl.com/content/product/mmp/rest/seller/openapi3/offers/sto01).

La guía peruana de [actualización de ofertas](https://ripleyperu.zendesk.com/hc/es/articles/4404552332557--C%C3%B3mo-actualizo-la-oferta-de-mis-productos-Precio-stock-descuentos) confirma que Mirakl Perú administra precio, descuento, stock, disponibilidad y clase logística. La guía de integraciones afirma que una integración puede crear productos masivamente y automatizar stock.

#### Pedidos y postventa comercial

| Código Mirakl | Método y ruta | Función |
| --- | --- | --- |
| OR11 | `GET /api/orders` | Listar pedidos con filtros y paginación |
| OR21 | `PUT /api/orders/{order_id}/accept` | Aceptar o rechazar líneas de un pedido |
| OR23 | `PUT /api/orders/{order_id}/tracking` | Actualizar información de seguimiento |
| OR24 | `PUT /api/orders/{order_id}/ship` | Validar el despacho de un pedido |
| OR28 | `PUT /api/orders/refund` | Ejecutar reembolsos sobre líneas de pedidos |
| OR72 | `GET /api/orders/documents` | Listar documentos de pedidos |
| OR73 | `GET /api/orders/documents/download` | Descargar documentos de pedidos |
| OR74 | `POST /api/orders/{order_id}/documents` | Adjuntar documentos a un pedido |

Fuente: [Mirakl Seller API — Orders](https://developer.mirakl.com/content/product/mmp/rest/seller/openapi3/orders), [OR11](https://developer.mirakl.com/content/product/mmp/rest/seller/openapi3/orders/or11), [OR28](https://developer.mirakl.com/content/product/mmp/rest/seller/openapi3/orders/or28) y [OR74](https://developer.mirakl.com/content/product/mmp/rest/seller/openapi3/orders/or74).

Ripley Perú confirma que la venta genera una notificación en el correo asociado a Mirakl y que la boleta se adjunta en los documentos del pedido. Sin embargo, su guía peruana actual dice que la [carga automatizada de boletas](https://ripleyperu.zendesk.com/hc/es/articles/34462926483213--C%C3%B3mo-Enviar-la-Boleta-Electr%C3%B3nica-al-cliente-en-el-Marketplace-de-Ripley-com) debe ser evaluada mediante una reunión con Ripley. Por ello, OR74 no debe habilitarse como mutación productiva basándose únicamente en que existe en Mirakl; primero debe confirmarse el flujo acordado para la tienda peruana.

#### Mensajería

La API Seller de Mirakl incluye lectura, creación y respuesta de hilos mediante `/api/inbox/threads` y `/api/orders/{order_id}/threads`. Ripley Perú utiliza la mensajería de Mirakl para gestionar consultas sobre pedidos y boletas. Fuente: [Mirakl Seller API — Messages](https://developer.mirakl.com/content/product/mmp/rest/seller/openapi3/messages) y [guía peruana de boletas](https://ripleyperu.zendesk.com/hc/es/articles/34462926483213--C%C3%B3mo-Enviar-la-Boleta-Electr%C3%B3nica-al-cliente-en-el-Marketplace-de-Ripley-com).

## 2. Seller Center de Ripley Perú

### URL y funciones comprobadas

Ripley Perú enlaza desde su documentación oficial a:

- `https://sellercenter.ripleylabs.com/login`
- `https://sellercenter.ripleylabs.com/`

El enlace aparece, entre otras, en la guía peruana de [Fulfillment](https://ripleyperu.zendesk.com/hc/es/articles/20442558429453--C%C3%B3mo-hacer-el-env%C3%ADo-de-tus-productos-a-Fulfillment) y en la guía para [crear y seguir tickets](https://ripleyperu.zendesk.com/hc/es/articles/24377587654157--C%C3%B3mo-crear-y-dar-seguimiento-a-un-ticket-desde-la-plataforma-SC).

Las funciones que Ripley Perú documenta para Seller Center incluyen:

- imprimir la etiqueta logística;
- imprimir el manifiesto;
- agendar el retiro de pedidos;
- gestionar tickets e incidencias;
- generar y alojar enlaces de imágenes;
- solicitar reposiciones de Fulfillment.

La separación operativa está expresada claramente por Ripley Perú: la nueva venta se notifica mediante Mirakl y luego el seller entra a Seller Center para [imprimir etiqueta y manifiesto y agendar el retiro](https://ripleyperu.zendesk.com/hc/es/articles/22578459676685--C%C3%B3mo-identifico-en-el-sistema-que-debo-atender-un-pedido-y-cu%C3%A1ndo-tengo-que-despacharlo).

### API de Seller Center

No se encontró en las fuentes oficiales públicas de Ripley Perú:

- documentación REST o colección Postman de Seller Center;
- base URL de una API peruana de Seller Center;
- esquema de autenticación API;
- endpoints para pedidos logísticos, etiquetas, manifiestos o agendamiento;
- URL de sandbox/QA/dev;
- credenciales de prueba.

Por tanto, `sellercenter.ripleylabs.com` puede afirmarse como el acceso web vigente enlazado por Ripley Perú, pero **no puede afirmarse, solo con la documentación peruana pública, que sus rutas internas sean una API soportada para integradores ni que el dominio sea un sandbox**.

## 3. Ambientes de pruebas

### Lo comprobado

- Mirakl productivo Perú: `https://ripleyperu-prod.mirakl.net`.
- Seller Center operativo enlazado por Ripley Perú: `https://sellercenter.ripleylabs.com`.

### Lo que no está publicado

No se halló una dirección de Mirakl Perú con sufijo o dominio de QA, sandbox, test o dev. Tampoco se halló una dirección de pruebas de Seller Center para Perú. La documentación estándar de Mirakl contempla que una instalación de Mirakl puede tener ambientes TEST o DEV, pero eso **no prueba que Ripley Perú haya provisionado uno para sellers o integradores**.

Consecuencia: ejecutar ZentoFact localmente no convierte una conexión a `ripleyperu-prod.mirakl.net` en sandbox. Con esa URL y una clave real se está llamando a producción.

Hasta recibir información privada de Ripley Perú, las pruebas locales deben realizarse con mocks o fixtures propios y sin mutaciones contra la instancia productiva.

## 4. Alta, accesos e integración

### Alta como seller

El proceso público de Ripley Perú es:

1. Completar el formulario de postulación.
2. Esperar la evaluación del equipo comercial.
3. Recibir por correo el enlace de SVC para subir los documentos.
4. Obtener la aprobación documental y firmar el contrato.
5. Completar capacitaciones e información logística.
6. Recibir el correo de bienvenida con los accesos a las plataformas.

Fuente: [¡Únete a nuestro Marketplace! — Ripley Perú](https://ripleyperu.zendesk.com/hc/es/articles/20295257478285--%C3%9Anete-a-nuestro-Marketplace).

### Integración propia o mediante un tercero

Ripley Perú permite dos rutas: integración por cuenta propia con un equipo técnico, o uso de un integrador. La página peruana lista a Yuju, Multivende, Centry, Producteca y Bsale, y señala que Ripley facilita guía para acceder y comprender la documentación de Mirakl, pero no brinda soporte de programación. Fuente: [Intégrate y gestiona tu tienda](https://ripleyperu.zendesk.com/hc/es/articles/32669080905101-Int%C3%A9grate-y-gestiona-tu-tienda).

No se encontró en la documentación pública peruana un proceso separado para certificarse como “partner integrador oficial”, ni un formulario técnico de homologación. Tampoco se publican credenciales de integración antes del alta del seller.

## 5. Información que debe solicitarse a Ripley Perú

Antes de implementar etiquetas, manifiestos o agendamiento por API, se necesita una respuesta explícita de Ripley Perú sobre:

1. Si existe una instancia QA de Mirakl Perú y cómo se provisiona una tienda de prueba.
2. Si Seller Center Perú ofrece una API soportada a integradores.
3. Las URLs base productiva y de pruebas de esa API, si existe.
4. El esquema de autenticación, scopes y rotación de credenciales de Seller Center.
5. Los endpoints y contratos de datos para pedidos logísticos, etiquetas, manifiestos, agendamiento e incidencias.
6. Qué endpoints Seller de Mirakl están habilitados y aprobados para la tienda peruana.
7. El procedimiento para generar pedidos de prueba y validar documentos sin afectar producción.
8. Si existe homologación o certificación técnica para integradores de Perú.

La propia guía peruana de boletas ofrece una reunión para evaluar automatización, y Seller Center dispone de ticketera. Esos son los canales oficiales publicados para solicitar la información privada que falta.

## Decisión recomendada para ZentoFact

- Mantener una sola variable neutral para Mirakl, por ejemplo `RIPLEY_API_URL`, con el valor del ambiente que Ripley Perú entregue. Hoy solo está comprobado el valor productivo.
- No crear ni usar una supuesta URL de sandbox de Perú.
- Implementar primero las consultas de Mirakl que puedan validarse con una tienda real y conservar deshabilitadas las mutaciones hasta contar con autorización y casos de prueba.
- Tratar Seller Center como una integración separada de Mirakl, pero no implementar su API hasta que Ripley Perú entregue documentación y credenciales oficiales.
- Probar localmente mediante un servidor mock que reproduzca los contratos oficiales de Mirakl; no mediante llamadas de escritura a producción.
