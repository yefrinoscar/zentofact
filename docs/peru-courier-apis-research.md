# APIs de courier y última milla en Perú

Investigación realizada el 5 de septiembre de 2026. Segunda pasada el mismo día: no solo portales de “developers”, sino los JS oficiales y los backends HTTP que esas webs ya llaman. Cada claim de endpoint first-party se contrastó con una llamada en vivo o con el bundle oficial.

ZentoFact ya trata tres couriers peruanos como carriers de envío con etiqueta manual y precio escrito por el vendedor: `marvisuar` → «Marvisuar», `shaloom` → «Shaloom», `dinsides` → «Dinsides» (`packages/web/src/lib/shipping-carrier.ts`). Express (`nosotros`) es flota propia. Esta nota no implementa conectores.

## Conclusión ejecutiva

**Sí hay API.** La primera lectura (“no publican portal de developers ⇒ no hay API ⇒ todo manual”) estaba mal. Los tres carriers de ZentoFact tienen backend HTTP first-party. Es la API de su propia web/app, no un SDK partner con Swagger.

| Courier | Backend first-party (oficial, sin docs) | Crear envío por HTTP | Tracking por HTTP | Cotizar / agencias |
| --- | --- | --- | --- | --- |
| **Shalom** | `*.shalomcontrol.com/api/v1/web/*` + rutas same-origin de `pro.shalom.pe` / `cliente.shalom.pe` | Sí, detrás de sesión Pro/Empresas (`/envia_ya/service_order/`, `/quote-service-order`) | Sí. Legacy abierto: `POST newwebservices.shalomcontrol.com/api/v1/web/rastrea/buscar`. Prod actual: mismo path en `serviceswebapi.shalomcontrol.com` con Bearer del front | 552 agencias en vivo. Tarifa pide origen |
| **Dinsides Courier** | Portal CodeIgniter en `dinsidescourier.com` (`ci_dinsides`) | Sí, detrás de login: `POST /login/validar` → `POST /pedido/registro` (está en `public/js/pedido.js`) | Sí, HTML público: `GET /seguimiento/pedido/{codigo}` | Tarifario en la home. Alta de usuario por WhatsApp |
| **Expreso Marvisur** | `https://marvicom.expresomarvisur.com/backend/api` (`apiBaseUrl` del JS de `expresomarvisur.com`) | **No** en la API pública. Solo formularios de cotización/reclamo | Sí, sin login: `POST /backend/api/WebApi` `{"modo":1,"serie","numero"}` | Sí: 193 sucursales (`Sucursales` modo 20). Tarifario Arequipa→Lima respondió S/7–20 |

Lo que **no** hay: portal de desarrolladores, API key de partner, OpenAPI, webhooks documentados, ni promesa de estabilidad. Los wrappers `shalom-api-peru.com` / `shalom-api.lat` no son Shalom: envuelven estos mismos hosts y, para crear guía, inician sesión en `pro.shalom.pe`.

**Implicación ZentoFact:** tracking de Shalom y Marvisur se puede hablar en JSON hoy, contra el mismo host que usa su web. Crear guía Shalom/Dinsides es HTTP con cuenta de vendedor (sesión), no tipear en un Excel. Crear guía Marvisur sigue fuera de esa API pública. Eso no es un conector partner; es un conector al backend de su web y se puede romper cuando cambien el JS.

Sí hay APIs oficiales, documentadas, útiles si se abre un segundo grupo de carriers:

| Encaje | Quién | Qué da la API oficial |
| --- | --- | --- |
| Última milla Lima / same-day | Urbaner, PedidosYa Envíos, Cabify Logistics, Chazki, 99minutos, Moova, Urbano | Crear envío, cotizar, tracking, a menudo webhooks y etiqueta |
| Nacional / cargo | Urbano (docs públicas). Olva: portal + posible API de contrato **sin docs públicas** | Urbano: envío + etiqueta PDF. Olva: registro web / zona clientes |
| Internacional | DHL Express MyDHL | Envío, tarifa, etiqueta, recojo, tracking |
| Multicourier | Envíame | Una API que envuelve varios couriers peruanos (Olva, Urbano, 99minutos, Sharf, Nirex, pickit, y otros que Envíame lista en marketing) |
| Flota propia | SimpliRoute | Ruteo y visitas; no es un courier |

AfterShip Tracking lista **99minutos** y **Chazki** (requieren conexión de cuenta). No lista Olva, Shalom, Marvisur ni Dinsides en la tabla oficial de slugs revisada.

**Recomendación de producto:** no tratar a Shalom / Dinsides / Marvisur como “sin API”. Hay dos caminos:

1. **Conector first-party (los que ya usamos):** tracking JSON contra Shalom `rastrea/buscar` y Marvisur `WebApi`; alta de envío Shalom Pro / Dinsides con la cuenta del seller. Pedir por escrito a cada comercial que ese uso esté permitido. No pasar por `shalom-api-peru.com`.
2. **Conector partner documentado (carriers nuevos):** Envíame, Urbano, Urbaner, PedidosYa Envíos, 99minutos, Chazki, Cabify.

Corregir las etiquetas de UI a **Shalom** y **Marvisur** cuando se toque ese código.

## Matriz de evidencia

| Carrier / plataforma | API pública documentada | Tipo | Crear envío | Cotizar | Tracking | Etiqueta | Webhooks | Recojo | Calidad de evidencia |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Dinsides Courier | No documentada; sí hay HTTP de portal | CodeIgniter + jQuery | `POST /pedido/registro` (sesión) | Tarifario web | `GET /seguimiento/pedido/{codigo}` HTML | No | No | Recojo como servicio | Sitio + `pedido.js` + llamadas en vivo |
| Shalom | No documentada; sí hay REST first-party | `*.shalomcontrol.com` + Pro/Empresas | Sesión Pro/Empresas | `tarifa/mostrar` + Pro `/quote-service-order` | `POST /api/v1/web/rastrea/buscar` | PDF/GRT por `ose_id` (Pro / fileserver) | No oficial | Agencia / recojo | JS oficial + 552 agencias 200 |
| Expreso Marvisur | No documentada; sí hay API IIS | `marvicom…/backend/api` | No en API pública | `POST Tarifario` modo 5 | `POST WebApi` modo 1 | Descarga guía modo 3 | No | Agencia | `apiBaseUrl` en JS + 193 sucursales 200 |
| Olva | No pública | Registro web + zona clientes + app | No documentado | Cotizador web | Web + app | Rótulo en registro web | No documentado | Zona clientes | Sitio oficial; API de contrato solo en fuentes secundarias |
| Urbano Perú | Sí | REST partner | Sí | No listado como endpoint separado en las páginas de envío | Sí | PDF | Notificaciones anunciadas | Sí (pickup / inversa) | Docs oficiales `urbano.com.pe` |
| Chazki | Sí | REST partner | Sí | Cobertura | Sí | PDF (Tonny) | Sí | Pickup en flujo de entrega | `docs.chazki.com` |
| Urbaner | Sí | REST | Sí | Sí | Sí | No destacado | No destacado en la intro | Ventanas de entrega | `developers.urbaner.com` |
| PedidosYa Envíos | Sí | REST OpenAPI 3 | Sí | Estimate | Sí + GPS | `/v3/shippings/labels` en la OpenAPI | Sí | Pickup waypoint | `developers.pedidosya.com` |
| 99minutos | Sí | REST OpenAPI 3 | Sí | Implícito en orden | Sí | Guías | Sí | Operación propia | `developers.99minutos.com` |
| Cabify Logistics | Sí | REST | Sí | Estimate | Sí | Tipos que usan almacén | Sí | Pickup | `developers.cabify.com` + `cabifylogistics.com/pe` |
| DHL Express | Sí | REST + SOAP | Sí | Rating | Sí | PDF | — | Sí | `developer.dhl.com` |
| inDrive Entregas | No | App + WhatsApp | No | Precio ofertado en app | In-app | No | No | App | `indrive.com/es-pe/business` |
| Rappi | Marketplace, no courier genérico | Partner/restaurantes | Pedidos Rappi | — | Pedidos Rappi | — | Pedidos | — | `dev-portal.rappi.com` |
| Serpost | No pública | Web + clientes empresariales | No | Calculadora web | Seguimiento en línea | No | No | Oficinas | `serpost.com.pe` + gob.pe |
| Nirex | No pública | Shopify + Excel + panel | Shopify / carga | Cotizador web | Panel + WhatsApp al comprador | No documentado | No | Recojo Next Day | `nirex.la` |
| pickit | Integración a medida / apps | Contacto + Shopify | Vía integración | — | Anunciado | — | — | Drop-off / domicilio | `pickit.com.pe` |
| Sharf (ex Scharff) | No encontrada | Web + puntos | Registro web | Tarifas web | Web / app | — | — | Punto / puerta a puerta | `holasharf.com` |
| Envíame | Sí | REST v2/v3 multicourier | Sí | Carriers de la cuenta | Sí | PDF/ZPL | Sí | Retiros | `docs.enviame.io` |
| Moova | Sí | REST B2B | Sí | Sí | Sí | — | Sí | Flujos B2B | `ayuda.moova.io` |
| Melonn | REST a pedido | 3PL (CO/MX en las páginas revisadas) | Pedidos a Melonn | — | Webhooks | — | Sí | Fulfillment | `melonn.com` — Perú no confirmado |
| Envíopack | Sí | REST (AR) | Sí | — | Sí | — | — | — | `developers.enviopack.com.ar` — Perú no listado |
| SimpliRoute | Sí | TMS / ruteo | Visitas | — | Checkout de visita | — | Sí | Flota propia | `documentation.simpliroute.com` |
| AfterShip Tracking | Sí | Tracking multi-carrier | No (labels = otro producto, otro set de carriers) | — | Sí | Shipping API: DHL y carriers no peruanos | Sí | — | `aftership.com/docs` |

---

## 1. Carriers que ZentoFact ya usa (prioridad)

Segunda pasada: se bajó el JS oficial y se llamó a los hosts que ese JS declara. No se usaron cuentas de cliente. No se enviaron altas de envío.

### 1.1 Dinsides Courier

| Campo | Hallazgo |
| --- | --- |
| Nombre comercial | **Dinsides Courier** |
| Sitio | [https://dinsidescourier.com/](https://dinsidescourier.com/) · login [dinsidescourier.com/login](https://dinsidescourier.com/login) · staging [test.dinsidescourier.com](https://test.dinsidescourier.com/) |
| ¿Hay API HTTP? | **Sí.** Portal CodeIgniter 3. Cookie `ci_dinsides`. El front llama rutas same-origin con jQuery, no un `/api/v1` con API key. `/swagger` y `/api` son 404. |
| Crear envío | `POST /pedido/registro` — URL hardcodeada en [public/js/pedido.js](https://dinsidescourier.com/public/js/pedido.js) (línea ~653). Después de éxito redirige a `pedido/listado_cliente`. Login: `POST /login/validar` en [public/js/login.js](https://dinsidescourier.com/public/js/login.js); roles 2/3 van a `pedido/nuevo`. |
| Tracking | Público HTML: `GET /seguimiento/pedido/{codigo}`. Home hace `location.href = base_url + 'seguimiento/pedido/' + pedido`. Verificado 200 `text/html` con filas `REGISTRADO` / `EN RUTA` para `TEST123`. No es JSON. |
| Auth | Teléfono + clave del portal. Usuario se pide por WhatsApp (`992 565 076`). No hay self-serve HTTP de alta. |
| Mobile / chat | Flutter [jhonLapa/movil-dinsides](https://github.com/jhonLapa/movil-dinsides) pega a `test.dinsidescourier.com/*.php` (chat). El repo C# `conning-backv2` es planillas, no envíos. |

Servicios de la home: contraentrega, recojo, cambio de prenda/producto, fulfillment. Tarifario Lima/Callao incluye **Envío Agencia Marvisur / Olva / Shalom** a S/5. Oficinas Av. Arica 1702 y Jr. Antonio Bazo 1284.

**Implicación ZentoFact:** un conector Dinsides es automatizar el mismo HTTP del portal (sesión + `pedido/registro`) y leer `/seguimiento/pedido/{codigo}`. No es “manual porque no hay API”; es “API de portal, sin contrato publicado”.

### 1.2 Shalom (el producto escribe «Shaloom»)

| Campo | Hallazgo |
| --- | --- |
| Nombre comercial | **Shalom**. Sitios [shalom.com.pe](https://shalom.com.pe/), Pro [pro.shalom.pe](https://pro.shalom.pe/), Empresas [corp.shalom.pe](https://corp.shalom.pe/) + [cliente.shalom.pe/login](https://cliente.shalom.pe/login). App Play Store `pe.com.shalom.overskull`. |
| ¿Hay API HTTP? | **Sí, first-party.** El SPA de [shalom.com.pe/assets/index-e49ef0f2.js](https://shalom.com.pe/assets/index-e49ef0f2.js) declara `web: "https://serviceswebapi.shalomcontrol.com"` y arma `host + "/api/v1/web" + path`. Paths de rastreo en ese JS: `/rastrea/buscar`, `/rastrea/estados`, `/rastrea/comprobante`, `/rastrea/grt`. También `servicespayment`, `fileserver`, `pro.shalom.pe`, `newwebservices.shalomcontrol.com` (PDFs). |
| Hosts | Prod web: `serviceswebapi.shalomcontrol.com` (Bearer del front; sin token responde 403 cifrado). Legacy abierto: `newwebservices.shalomcontrol.com`. PREPROD `servicesweb.shalomcontrol.com` (el gist de sucursales ya da 404 ahí). Pro/Empresas: JSON same-origin. |
| Tracking en vivo | `POST https://newwebservices.shalomcontrol.com/api/v1/web/rastrea/buscar` → 200 JSON. Vacío: `"Ingrese un número de orden."` Solo número: `"Ingrese un código de orden."` Cuerpo: `numero`, `codigo`, `ose_id`. |
| Agencias en vivo | `POST https://newwebservices.shalomcontrol.com/api/v1/web/agencias/listar` → **200**, `"Lista de agencias."`, **552** filas, ~2.7 MB. Campos `ter_id`, `ter_abrebiatura`, `departamento`, `latitud`, `longitud`. |
| Tarifa | `POST …/tarifa/mostrar` → 200 `"Envíe un origen."` |
| Crear envío | No está en `/api/v1/web`. Está en Pro/Empresas: `/envia_ya/service_order/`, `/quote-service-order`, `/import-excel`. Esas rutas piden sesión. |
| Wrappers de terceros | [shalom-api-peru.com](https://shalom-api-peru.com/docs/) y [shalom-api.lat](https://shalom-api.lat/) envuelven tracking/agencias y, para crear, hacen login en `pro.shalom.pe`. No son Shalom. `n8n-nodes-shalom` solo habla con `api.shalom-api.lat`. |

El gist [TJhon](https://gist.github.com/TJhon/0db45e83d2fdd6cae9ece4b4dddda641) apuntaba a `servicesweb.shalomcontrol.com/api/v1/web/agencias/listar` (muerto). El mismo contrato vive en `newwebservices.shalomcontrol.com`.

**Implicación ZentoFact:** tracking + catálogo de agencias ya son JSON first-party. Crear guía es la API de Shalom Pro con la cuenta del seller, no un portal de partners. No meter el wrapper de terceros en producción.

### 1.3 Expreso Marvisur (el producto escribe «Marvisuar»)

| Campo | Hallazgo |
| --- | --- |
| Nombre comercial | **Expreso Marvisur**. RUC **20498189637**. Sitio [expresomarvisur.com](https://www.expresomarvisur.com/). |
| ¿Hay API HTTP? | **Sí.** El chunk [chunk-LFVYSD7X.js](https://www.expresomarvisur.com/chunk-LFVYSD7X.js) fija `apiBaseUrl:"https://marvicom.expresomarvisur.com/backend/api"`. Angular `HttpClient`. Sin `Authorization`. CORS: origin `https://www.expresomarvisur.com`. IIS/ASP.NET. Errores nombran procs `Web.PRC_Tarifario`, `[Auditoria].[dbo].[PRC_Seguimiento]`. |
| Tracking en vivo | Home publica el ejemplo `V001-0000001`. `POST /backend/api/WebApi` `{"modo":1,"serie":"V001","numero":"0000001"}` → **200** `"TRANSACCION REALIZADA CON EXITO"`, **4 eventos** (RECEPCION / EN RUTA / ENTREGADO, Lima→Huancayo 2023). Parser del JS: `^(V(?!000)\d{3})-?(\d{1,7})$`. |
| Sucursales en vivo | `POST /backend/api/Sucursales` `{"modo":20}` → **200**, **193** filas (dirección, teléfonos, correo). Modo 21 = orígenes (153). Modo 22 = destinos (128). |
| Tarifario en vivo | `POST /backend/api/Tarifario` `{"modo":5,"ori_tar":"AREQUIPA","des_tar":"LIMA"}` → **200**, sobre S/7, min paq S/12, paq S/15, max S/20. |
| Crear envío | **No hay path de alta de guía** en el JS público. Writes: cotización (`Cotizacion/GuardarCotizacionArchivo`), reclamos, postulaciones. `Seguimiento` existe (POST 200 con proc vacío) pero el body no está en el JS de marketing. |
| Terceros | El mismo `Sucursales` modo 20 está en el gist TJhon. [ky1ar/soporte scrapMarvisur.php](https://github.com/ky1ar/soporte/blob/master/routes/scrapMarvisur.php) proxea `WebApi` modo 1. |

**Implicación ZentoFact:** tracking y tarifa Marvisur ya son JSON sin login. Crear la GRTE no está en esa API pública: eso sí sigue agencia / WhatsApp / lo que el comercial habilite aparte.

---

## 2. Otros couriers peruanos / last-mile

### 2.1 Olva (Olva Courier)

| Campo | Hallazgo |
| --- | --- |
| Nombre | **Olva** / Olva Courier. Sitio [olvacourier.com](https://www.olvacourier.com/). |
| API pública | **No.** `site:olvacourier.com` API / desarrolladores / web service: vacío. Corporativo es un **formulario** ([/corporativo](https://www.olvacourier.com/corporativo/)). |
| Cómo operan | [Registro de envíos en línea](https://www.olvacourier.com/preguntas-frecuentes/) + tutorial ([guía](https://www.olvacourier.com/como-registrar-un-envio-en-la-web-de-olva-paso-a-paso-guia/)). Recojo en **Zona de clientes**. Tracking web + app Play Store + Facebook + (01) 714 0909. WhatsApp 964 771 829. Clientes corporativos: usuario/contraseña para reportes (FAQ). Envíos masivos (>20) en tienda. |
| Etiqueta | El flujo de registro pide imprimir y pegar el rótulo. |
| Integración tecnológica (oficial, sin docs) | El home de Olva ofrece a empresas «infraestructura para grandes volúmenes de envío, pago al crédito, **integración tecnológica** y reportes detallados» ([olvacourier.com](https://www.olvacourier.com/)). Esa frase es de Olva. El canal para pedirla es el formulario corporativo, no un portal de developers. El FAQ corporativo solo documenta usuario/contraseña para **reportes** de envíos. |
| API de contrato | Agencias (Vexsoluciones WooCommerce, `kom.pe`) afirman token + docs privadas tras contrato. **No hay PDF ni OpenAPI de Olva.** Tratarlo como «posible API partner no publicada; hay que pedírsela al comercial». |
| Evidencia | Oficial: portal, FAQ y copy de «integración tecnológica». Contrato API: solo secundario. |

### 2.2 Urbano Perú (Urbano Express)

| Campo | Hallazgo |
| --- | --- |
| Nombre | **Urbano** / Urbano Express Perú. [urbano.com.pe](https://www.urbano.com.pe/). |
| API | **Sí, oficial.** [Developers](https://www.urbano.com.pe/developer/) y [API envío](https://www.urbano.com.pe/apideveloper/envio/). Host prod `https://api.urbanoexpress.com.pe/`, test `https://cxu.pe.urbanoexpress.net/`. |
| Operaciones | Generación de envíos (`/api/ws/Autorizacion`, `/api/ws/nshipment`), seguimiento, logística inversa, courier internacional, cancel, manifiesto (`/api/ws/eser_manifest`). Respuesta incluye URL de etiqueta PDF. |
| Auth | Header `x-api-key` (token del sistema de cliente). `service_id` de contrato. |
| Docs | Páginas oficiales con parámetros JSON. Calidad: **oficial, usable**. Acceso: equipo tecnológico / contrato. |

Mejor candidato nacional con docs públicas entre los couriers «clásicos» (Olva/Shalom/Marvisur/Urbano).

### 2.3 Chazki

| Campo | Hallazgo |
| --- | --- |
| Nombre | **Chazki**. [chazki.com](https://www.chazki.com/). Docs [docs.chazki.com](https://docs.chazki.com/), [Perú Legacy](https://docs.chazki.com/peru), [Tonny](https://docs.chazki.com/tonny). |
| API | REST oficial. Perú: create/cancel/status/tracking/images/coverage. Tonny: upload orders, cancel, track, historial, imágenes, PDF. |
| Auth | `Enterprise-Key` / API Key. |
| Webhooks | POST a URL HTTPS del cliente con `delivery_code` + `delivery_status`. |
| Perú | FAQ: opera Transporte + SaaS en Perú. Integraciones nativas + API ([FAQ](https://www.chazki.com/preguntas-frecuentes)). Bsale documenta Store / Branch / Api Key. |
| Evidencia | **Oficial alta.** |

Same-day / next-day / Flex, no reemplazo de Marvisur nacional.

### 2.4 Urbaner

| Campo | Hallazgo |
| --- | --- |
| Nombre | **Urbaner**. [urbaner.com](https://www.urbaner.com/). Docs [developers.urbaner.com](https://developers.urbaner.com/). Ayuda: [integración](https://ayuda.urbaner.com/es/article/como-me-puedo-integrar-con-urbaner-114fgxw/). |
| API | REST. Sandbox `https://api.sandbox.urbaner.com/api/`, prod `https://middleware.urbaner.com/api/`. |
| Auth | Token en `Authorization` (cuenta → Mi Cuenta / Integración) o `POST /client/authenticate/` con email/password → `auth_token`. |
| Operaciones | Crear orden (EXPRESS / SAMEDAY / NEXTDAY), precio, ventanas, disponibilidad de courier. Ejemplos con `city.iso_code: PE`, Lima. |
| Acceso | Cuenta corporativa (`oscar.rosales@urbaner.com` / `tecnologia@urbaner.com`). App Shopify oficial (developer Lima). |
| Evidencia | **Oficial alta.** Lima. |

### 2.5 PedidosYa Envíos (Courier API)

| Campo | Hallazgo |
| --- | --- |
| Nombre | **PedidosYa Envíos**. PE: [envios.pedidosya.com.pe](https://envios.pedidosya.com.pe/). Docs [developers.pedidosya.com](https://developers.pedidosya.com/), OpenAPI [v3.json](https://developers.pedidosya.com/courier-api/v3.json), guía [courier-doc](https://developers.pedidosya.com/courier-doc/introduction). |
| API | REST. Host `https://courier-api.pedidosya.com`. Estimate, confirm, create, list, details, tracking GPS, coverage, working zones, cancel, cash collection, PIN, proof of delivery, **labels** (`/v3/shippings/labels` en la OpenAPI 3.0.0), webhooks. |
| Auth | Token en `Authorization` (credenciales de cuenta PedidosYa Envíos). |
| Perú | Sitio `.com.pe` y copy «Estamos entregando en Perú». La OpenAPI usa ejemplos UY; la cobertura real se valida con `/working-zones` o estimate. |
| No confundir | [Partner API](https://developer.pedidosya.com/api-specifications) = catálogo/órdenes de restaurante (OAuth client credentials), no courier. |
| Evidencia | **Oficial alta.** |

### 2.6 99minutos

| Campo | Hallazgo |
| --- | --- |
| Nombre | **99minutos**. [99minutos.com](https://www.99minutos.com/) — cobertura **México · Chile · Colombia · PERÚ**. Docs [developers.99minutos.com](https://developers.99minutos.com/). |
| API | REST v3. Prod `https://delivery.99minutos.com`, sandbox `https://sandbox.99minutos.com`. `POST /api/v3/oauth/token` → JWT. `POST /api/v3/orders` (country `PER` en ejemplos). Webhooks. Guías. Fulfill99 aparte (`api.fulfill99.com`) tras contrato. |
| Auth | `client_id` + `client_secret` (Developers en el panel) → Bearer. |
| Acceso | Cuenta en `envios.99minutos.com` + comercial (`comercial@99minutos.com`). BigCommerce: «Disponible para México, Colombia, Peru y Chile». |
| AfterShip | Slug `99minutos` (requiere conexión). |
| Evidencia | **Oficial alta.** |

### 2.7 DHL Express

| Campo | Hallazgo |
| --- | --- |
| Nombre | **DHL Express**. Portal [developer.dhl.com](https://developer.dhl.com/api-reference/dhl-express-mydhl-api). SOAP guide PDF en el mismo portal. |
| API | MyDHL REST (`https://express.api.dhl.com/mydhlapi`) y SOAP. Rating, shipment (label + AWB), pickup, tracking, address capability. |
| Auth | Cuenta DHL Express + credenciales del portal (Basic en Express). Tracking unificado aparte (`api.dhl.com/track/shipments`). |
| Perú | País `PE` en el modelo global. Envíame lista 129 agentes DHL en Perú (marketing). |
| Evidencia | **Oficial alta.** Encaje: internacional / outbound, no Gamarra–provincia. |

### 2.8 Cabify Logistics (Cabify Envíos)

| Campo | Hallazgo |
| --- | --- |
| Nombre | **Cabify Logistics**. PE empresas: [cabifylogistics.com/pe/empresas](https://cabifylogistics.com/pe/empresas). Docs [developers.cabify.com/docs/introduction](https://developers.cabify.com/docs/introduction). |
| API | REST Logistics: parcels, ship, cancel, coverage, proofs, webhooks. Host `https://logistics.api.cabify.com`. |
| Auth | API key de admin (Integración) → access token Bearer. Getting started: no exige partnership previo para empezar. |
| Perú | FAQ oficial: **Perú: Lima**. Integración API o DMS (plantilla masiva). Plugins Magento, Mercado Libre, PrestaShop, Shopify, VTEX, WooCommerce. |
| Evidencia | **Oficial alta.** Lima express/programado. |

### 2.9 inDrive Entregas

| Campo | Hallazgo |
| --- | --- |
| Nombre | **inDrive Entregas**. [indrive.com/es-pe/business](https://indrive.com/es-pe/business). |
| API | **No.** Flujo: app → ofrecer precio → elegir repartidor. Alternativa: **asistente WhatsApp**. Tracking in-app. |
| Delivery Pro | Prensa (Gestión) describe software de multi-órdenes en test; no hay portal de desarrolladores. |
| Evidencia | Oficial para app/WhatsApp. Cero API. |

### 2.10 Rappi

| Campo | Hallazgo |
| --- | --- |
| Nombre | **Rappi**. Docs [dev-portal.rappi.com](https://dev-portal.rappi.com/es/api-reference/content/). Host PE `https://api.rappi.pe` / `https://services.rappi.pe`. |
| API | Partner/restaurantes: menú, órdenes, horarios. OAuth client credentials, onboarding manual. **No es API de courier para despachar un paquete ZentoFact por un rider Rappi.** |
| Evidencia | Oficial, pero otro producto. |

### 2.11 Serpost

| Campo | Hallazgo |
| --- | --- |
| Nombre | **SERPOST S.A.** [serpost.com.pe](https://www.serpost.com.pe/). Tracking [clientes.serpost.com.pe/Cliente/SegumientoLinea](https://clientes.serpost.com.pe/Cliente/SegumientoLinea). Empresas [ftp.serpost.com.pe/Cliente/ServicioEmpresas](https://ftp.serpost.com.pe/Cliente/ServicioEmpresas). Acceso web empresarial ([gob.pe](https://www.gob.pe/institucion/serpost/pages/34777-acceso-web-a-clientes-empresariales)): usuario/contraseña, ver gestiones. |
| API | **No pública.** Host `webservice.serpost.com.pe` es transparencia (PDF de procedimientos), no un API de envíos. Wrappers GitHub (`Wesitos/py-serpost`) scrapean. |
| Cómo operan | Oficinas, calculadora, clientes@serpost.com.pe para masivos. |
| Evidencia | Oficial: web + gob.pe. |

### 2.12 Nirex

| Campo | Hallazgo |
| --- | --- |
| Nombre | **Nirex**. [nirex.la](https://www.nirex.la/). Next Day Lima/Callao. |
| API | **No publicada.** Integra **Shopify oficial**, carga Excel, panel `nirex.app`. Formulario para volumen alto. |
| Evidencia | Oficial para Shopify/Excel. Sin OpenAPI. |

### 2.13 pickit

| Campo | Hallazgo |
| --- | --- |
| Nombre | **pickit**. [pickit.com.pe](https://pickit.com.pe/). Domicilio + puntos + devoluciones. |
| API | Sitio PE: «Adaptamos tu integración». App Shopify `pickitenvios`. Credenciales API Key + token aparecen en integradores (Billowshop, AR/MX). **No hay portal de docs en pickit.com.pe.** |
| Envíame | Lista pickit como courier PE. |
| Evidencia | Oficial de producto; API = partner / a medida. |

### 2.14 Sharf (antes Scharff)

| Campo | Hallazgo |
| --- | --- |
| Nombre | **Sharf** (rebrand de Scharff). [holasharf.com](https://holasharf.com/servicios/personas-y-emprendedores/envios-puerta-a-puerta/). Representante FedEx en Perú (copy Envíame; validar con Sharf). |
| API | No encontrada. Registro web, puntos, tracking web/app. |
| Evidencia | Sitio de servicios. Sin developers. |

### 2.15 Motorizado / «APIs de motorizado»

No hay un estándar peruano «Motorizado API». El equivalente documentado es Urbaner, PedidosYa Envíos, Cabify Logistics, Chazki Tonny, 99minutos, Moova, inDrive (sin API).

### 2.16 Fuera de alcance (aparecen en búsquedas, no sirven aquí)

| Nombre | Por qué no entra |
| --- | --- |
| Envíoclick | API real, pero es **México** (`envioclick.com/mx`). |
| Servientrega SOAP `web.servientrega.com:8081/GeneracionGuias.asmx` | Web service **Colombia**. Envíame mencionó Servientrega como operador PE en 2022; no hay portal PE de desarrolladores. |
| Qayarix | Last-mile PE histórico (`qayarix.com`). Sin docs de API. LinkedIn lo muestra como empresa muy chica. |
| Halcourier / Klimber | No son couriers peruanos de paquetería (Halcourier es otro mercado; Klimber es insurtech). |

---

## 3. Agregadores y plataformas

### 3.1 Envíame

| Campo | Hallazgo |
| --- | --- |
| Nombre | **Envíame**. [enviame.io](https://enviame.io/), marketing PE [enviame.io/courier-peru](https://enviame.io/courier-peru/). Docs [docs.enviame.io/docs/v2](https://docs.enviame.io/docs/v2), [v3](https://docs.enviame.io/docs/v3), [webhooks](https://docs.enviame.io/docs/webhooks/). |
| API | REST. v2: `api-key` + `id_seller`. Stage `https://stage.api.enviame.io`, prod `https://api.enviame.io`. v3: Auth0 Bearer (setup por soporte). Crear envío, tracking, retiros, PUDOs (Perú = distrito + provincia), devoluciones, tickets, labels PDF/ZPL, listar carriers de la cuenta. |
| Couriers PE (marketing oficial) | «más de 12»: **Olva Courier, Urbano, Scharff/Sharf, Nirex, 99 minutos, pickit** «y 13 paqueterías más». También menciona Shalom y Moova en el artículo, no como lista contractual. |
| Evidencia | **Oficial alta** para la API. La lista exacta de `carrier_code` PE no está en los ejemplos públicos (ejemplos Chile: SKN, BLUEXPRESS). Hay que pedir la cuenta PE. |

Camino más realista para «una integración, varios couriers» incluyendo Olva.

### 3.2 Moova

| Campo | Hallazgo |
| --- | --- |
| Nombre | **Moova**. [moova.io](https://moova.io/) — países incluyen **Perú**. Docs [ayuda.moova.io autenticación](https://ayuda.moova.io/es/articles/9892208-autenticacion-y-acceso-a-la-api), [crear envío](https://ayuda.moova.io/es/articles/11425314-creacion-de-un-envio). |
| API | REST B2B. Prod `https://api-prod.moova.io/b2b`, test `https://api-dev.moova.io/b2b`. Auth: `appId` query + `Authorization: APP_KEY` (sin Bearer). Alta comercial primero (hasta 72 h). Webhooks. |
| Evidencia | **Oficial alta.** Operación last-mile, no red de agencias tipo Shalom. |

### 3.3 Melonn

[melonn.com/integraciones/melonn-api](https://www.melonn.com/integraciones/melonn-api/): REST + webhooks a pedido (credenciales por asesoría). Canales nativos listados: Shopify, VTEX, ML, Rappi Mall **Colombia**, Liverpool/Walmart/Coppel **México**. **Perú no aparece** en esas páginas. No tratarlo como courier PE hasta que Melonn lo declare.

### 3.4 Envíopack

[developers.enviopack.com.ar](https://developers.enviopack.com.ar/): REST `https://api.enviopack.com`, token, sucursales/envíos. Dominio **.com.ar**. Sin mención de Perú en la página de intro.

### 3.5 Packlink

Sin portal PE ni lista de Olva/Shalom en fuentes primarias revisadas. No usar como agregador Perú.

### 3.6 AfterShip

- **Tracking:** [supported couriers](https://www.aftership.com/docs/tracking/others/supported-couriers) incluye **99minutos** y **Chazki** (must connect). No aparecen Olva, Shalom, Marvisur, Dinsides, Urbano PE.
- **Shipping (labels):** [carrier guide](https://www.aftership.com/docs/shipping/carrier-guide-supported-couriers) es DHL/UPS/FedEx/EU — no Olva/Shalom.
- Signia Logistics (PE) sí tiene ficha AfterShip; no es el stack de ZentoFact.

Útil para unificar tracking de 99minutos/Chazki/DHL, no para los tres carriers actuales.

### 3.7 SimpliRoute

[documentation.simpliroute.com](https://documentation.simpliroute.com/): REST `https://api.simpliroute.com`, token `Authorization`. Visitas, rutas, vehículos, webhooks. **TMS para flota propia** (Express de ZentoFact), no crea guías Marvisur/Shalom.

### 3.8 Bsale (courier webhooks)

[apiperu.bsalelab.com/shippings](https://apiperu.bsalelab.com/shippings): API para que **un courier** se conecte a Bsale (órdenes, labels, webhooks). Es el lado Bsale, no un agregador que ZentoFact pueda usar para emitir Olva/Shalom.

---

## 4. Qué existe vs qué no (para ZentoFact)

### Existe y está documentado (se puede diseñar un conector)

1. **Urbaner** — Lima, REST, sandbox, token.
2. **PedidosYa Envíos** — last-mile PE, OpenAPI, estimate + create + track + webhook.
3. **Urbano** — nacional, REST, `x-api-key`, etiqueta PDF.
4. **99minutos** — PE en FAQ y country `PER`, OAuth, órdenes, webhooks.
5. **Chazki** — PE Legacy + Tonny, webhooks, PDF.
6. **Cabify Logistics** — Lima, parcels API, webhooks.
7. **DHL Express MyDHL** — internacional.
8. **Envíame** — multicourier PE + labels + tracking + webhooks.
9. **Moova** — last-mile, B2B REST, webhooks.
10. **SimpliRoute** — solo si se rutea Express propio.

### Existe como HTTP first-party (sin portal de developers)

- **Shalom:** REST `*.shalomcontrol.com/api/v1/web` (tracking + 552 agencias verificados) + alta en Pro/Empresas con sesión.
- **Dinsides:** `POST /login/validar` + `POST /pedido/registro` + tracking HTML `/seguimiento/pedido/{codigo}`.
- **Marvisur:** `marvicom…/backend/api` — tracking, tarifario, 193 sucursales. **Sin create-shipment** en esa API.
- **Olva:** portal + copy de «integración tecnológica». API de contrato no publicada. Home 2026-09-05 no expuso un `apiBaseUrl` en HTML estático (SPA/WAF).

### Existe como producto, no como API pública usable

- **inDrive:** app + WhatsApp.
- **Nirex:** Shopify + Excel.
- **pickit / Sharf:** web + integraciones a medida / marketplace apps.
- **Serpost:** tracking web + login empresarial.

### No sirve para el inbox de envíos de ZentoFact

- **Rappi Partner API** (marketplace).
- **Melonn / Envíopack** (sin PE confirmado en docs primarias).
- **AfterShip Shipping** (sin Olva/Shalom/Marvisur).
- Scrapers y `shalom-api-peru.com`.

### Nombres a corregir en producto

| Valor actual | Nombre comercial oficial | Fuente |
| --- | --- | --- |
| `shaloom` / «Shaloom» | **Shalom** (Shalom Empresarial; sitios shalom.com.pe / pro.shalom.pe) | Sitio + Play Store + LinkedIn |
| `marvisuar` / «Marvisuar» | **Expreso Marvisur** (Arequipa Expreso Marvisur E.I.R.L.) | FAQ + schema.org del sitio |
| `dinsides` / «Dinsides» | **Dinsides Courier** | dinsidescourier.com |

### Qué pedirle al comercial si se quiere insistir con los tres actuales

No hay portal. La única vía es contrato. Preguntas concretas, para no perder la llamada:

1. ¿Existe API o SFTP/Excel de alta de envíos, o solo portal/WhatsApp?
2. ¿Pueden crear guía, devolver PDF/ZPL y un tracking id estable?
3. ¿Hay webhook de estado o solo consulta?
4. ¿Auth: API key, usuario/clave, o login de humano?
5. ¿Sandbox?
6. Dinsides: el tarifario ya deja paquetes en agencia Olva/Shalom/Marvisur. ¿Eso es drop-off propio o solo un servicio de “llevar a la agencia”?

Ya hay contra qué integrar (los backends de su web). La llamada al comercial sirve para **autorizar** ese uso y, en Marvisur, para pedir el alta de GRTE que la API pública no tiene.

---

## 5. Fuentes (todas las URLs usadas)

### Oficiales — Dinsides, Shalom, Marvisur

- https://dinsidescourier.com/
- https://dinsidescourier.com/login
- https://dinsidescourier.com/public/js/login.js
- https://dinsidescourier.com/public/js/pedido.js
- https://dinsidescourier.com/seguimiento/pedido/TEST123
- https://www.dinsidescourier.com/registro
- https://www.linkedin.com/company/dinsides-courier/
- https://shalom.com.pe/
- https://shalom.com.pe/assets/index-e49ef0f2.js
- https://newwebservices.shalomcontrol.com/api/v1/web/agencias/listar
- https://newwebservices.shalomcontrol.com/api/v1/web/rastrea/buscar
- https://serviceswebapi.shalomcontrol.com/
- https://shalom.com.pe/proweb
- https://shalom.com.pe/faq/envios_preguntas
- https://pro.shalom.pe/
- https://corp.shalom.pe/
- https://cliente.shalom.pe/login
- https://wordpress.shalom.com.pe/conoce-mas-de-shalom-pro/
- https://play.google.com/store/apps/details?id=pe.com.shalom.overskull
- https://www.linkedin.com/company/shalom-empresarial
- https://es.linkedin.com/pulse/refuerzo-en-la-plataforma-de-rastreo-env%C3%ADos-nueva-medida-jye8e
- https://www.expresomarvisur.com/
- https://www.expresomarvisur.com/chunk-LFVYSD7X.js
- https://marvicom.expresomarvisur.com/backend/api/Sucursales
- https://marvicom.expresomarvisur.com/backend/api/WebApi
- https://marvicom.expresomarvisur.com/backend/api/Tarifario
- https://expresomarvisur.com/seccion/preguntas-frecuentes
- https://expresomarvisur.com/seccion/consulta-gret
- https://expresomarvisur.com/contacto
- https://pe.linkedin.com/company/expreso-marvisur-e-i-r-l

### Oficiales — otros carriers

- https://www.olvacourier.com/
- https://www.olvacourier.com/preguntas-frecuentes/
- https://www.olvacourier.com/corporativo/
- https://www.olvacourier.com/como-registrar-un-envio-en-la-web-de-olva-paso-a-paso-guia/
- https://www.urbano.com.pe/developer/
- https://www.urbano.com.pe/apideveloper/envio/
- https://www.urbanoexpress.pe/apideveloper/globalapi/manifest/
- https://docs.chazki.com/
- https://docs.chazki.com/peru
- https://docs.chazki.com/tonny
- https://www.chazki.com/preguntas-frecuentes
- https://developers.urbaner.com/
- https://ayuda.urbaner.com/es/article/como-me-puedo-integrar-con-urbaner-114fgxw/
- https://ayuda.urbaner.com/es/article/donde-encuentro-mi-api-key-16t3ftw/
- https://developers.pedidosya.com/courier-api/v3
- https://developers.pedidosya.com/courier-api/v3.json
- https://developers.pedidosya.com/courier-doc/introduction
- https://developers.pedidosya.com/courier-doc/first-steps
- https://envios.pedidosya.com.pe/
- https://www.99minutos.com/
- https://developers.99minutos.com/docs/getting-started
- https://developers.99minutos.com/reference/first-steps
- https://developers.99minutos.com/reference/orders_create
- https://developer.dhl.com/api-reference/dhl-express-mydhl-api
- https://cabifylogistics.com/pe/empresas
- https://developers.cabify.com/docs/getting-started
- https://developers.cabify.com/docs/introduction
- https://developers.cabify.com/docs/get-your-api-key
- https://indrive.com/es-pe/business
- https://dev-portal.rappi.com/es/api-reference/content/
- https://www.serpost.com.pe/
- https://www.gob.pe/institucion/serpost/pages/34777-acceso-web-a-clientes-empresariales
- https://clientes.serpost.com.pe/Cliente/SegumientoLinea
- https://www.nirex.la/
- https://pickit.com.pe/
- https://holasharf.com/servicios/personas-y-emprendedores/envios-puerta-a-puerta/

### Oficiales — agregadores

- https://enviame.io/courier-peru/
- https://docs.enviame.io/docs/v2
- https://docs.enviame.io/docs/v3
- https://docs.enviame.io/docs/webhooks/
- https://moova.io/
- https://ayuda.moova.io/es/articles/9892208-autenticacion-y-acceso-a-la-api
- https://ayuda.moova.io/es/articles/11425314-creacion-de-un-envio
- https://www.melonn.com/integraciones/melonn-api/
- https://developers.enviopack.com.ar/
- https://documentation.simpliroute.com/
- https://www.aftership.com/docs/tracking/others/supported-couriers
- https://www.aftership.com/docs/shipping/carrier-guide-supported-couriers

### No oficiales (solo para delimitar)

- https://shalom-api-peru.com/ y https://shalom-api-peru.com/docs/ — wrapper de terceros.
- https://gist.github.com/TJhon/0db45e83d2fdd6cae9ece4b4dddda641 — sucursales Shalom/Marvisur.
- https://kom.pe/envios-woocommerce-peru/ — afirma API Olva no pública; no es fuente de Olva.
- https://github.com/Wesitos/py-serpost — scraper Serpost.

---

## 6. Método y límites

Consultado el 5 de septiembre de 2026. Segunda pasada el mismo día: JS oficial + POST/GET a los hosts que ese JS declara. Shalom `newwebservices` devolvió 552 agencias y JSON de rastrea. Marvisur `WebApi`/`Sucursales`/`Tarifario` devolvieron JSON. Dinsides `pedido.js` + página de seguimiento HTML 200. No se firmaron contratos ni se usaron cuentas de cliente. No se creó ningún envío.

La API partner “oficial con PDF” de Olva/Shalom Empresas **sigue sin docs públicas**. Eso ya no implica “no hay HTTP”.

No se implementó ningún conector.
