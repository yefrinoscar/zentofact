# APIs de courier y última milla en Perú

Investigación realizada el 5 de septiembre de 2026. El alcance son fuentes primarias: sitios oficiales, portales de desarrolladores, OpenAPI/Swagger, Play Store de la empresa, LinkedIn de la empresa, términos y portales de clientes. Los blogs de agencias (por ejemplo `kom.pe`) se citan solo como rumor de mercado y **no** como prueba de que exista una API.

ZentoFact ya trata tres couriers peruanos como carriers de envío con etiqueta manual y precio escrito por el vendedor: `marvisuar` → «Marvisuar», `shaloom` → «Shaloom», `dinsides` → «Dinsides» (`packages/web/src/lib/shipping-carrier.ts`). Express (`nosotros`) es flota propia. Esta nota no implementa conectores.

## Conclusión ejecutiva

Los tres carriers que ZentoFact usa hoy **no publican una API oficial** para crear envíos, generar etiquetas ni hacer tracking programático.

- **Dinsides Courier** opera un portal web de clientes (login a pedido) más WhatsApp/teléfono. No hay portal de desarrolladores.
- **Shalom** (nombre comercial oficial; el producto escribe «Shaloom») opera **Shalom App** y **Shalom Pro** (web + registros masivos). El rastreo público ahora exige login. Existe un wrapper de terceros (`shalom-api-peru.com`) que inicia sesión en `pro.shalom.pe` con email/password del cliente. No es de Shalom.
- **Expreso Marvisur** (nombre comercial oficial; el producto escribe «Marvisuar») ofrece tracking por número de GRTE en la web, cotización por WhatsApp y sucursales. No hay docs de API.

Sí hay APIs oficiales, documentadas, útiles para ZentoFact si se abre un segundo grupo de carriers:

| Encaje | Quién | Qué da la API oficial |
| --- | --- | --- |
| Última milla Lima / same-day | Urbaner, PedidosYa Envíos, Cabify Logistics, Chazki, 99minutos, Moova, Urbano | Crear envío, cotizar, tracking, a menudo webhooks y etiqueta |
| Nacional / cargo | Urbano (docs públicas). Olva: portal + posible API de contrato **sin docs públicas** | Urbano: envío + etiqueta PDF. Olva: registro web / zona clientes |
| Internacional | DHL Express MyDHL | Envío, tarifa, etiqueta, recojo, tracking |
| Multicourier | Envíame | Una API que envuelve varios couriers peruanos (Olva, Urbano, 99minutos, Sharf, Nirex, pickit, y otros que Envíame lista en marketing) |
| Flota propia | SimpliRoute | Ruteo y visitas; no es un courier |

AfterShip Tracking lista **99minutos** y **Chazki** (requieren conexión de cuenta). No lista Olva, Shalom, Marvisur ni Dinsides en la tabla oficial de slugs revisada.

**Recomendación de producto:** no scrapear ni usar wrappers no oficiales para Shalom/Marvisur/Dinsides. Si se quiere automatizar etiquetas, el camino más corto es (1) Envíame u otro agregador con contrato, o (2) un conector directo a Urbaner / PedidosYa Envíos / Urbano / 99minutos / Chazki / Cabify, y dejar los tres carriers actuales en modo manual. Corregir las etiquetas de UI a **Shalom** y **Marvisur** cuando se toque ese código.

## Matriz de evidencia

| Carrier / plataforma | API pública documentada | Tipo | Crear envío | Cotizar | Tracking | Etiqueta | Webhooks | Recojo | Calidad de evidencia |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Dinsides Courier | No | Portal + WhatsApp | No | Tarifario web | Portal de cliente | No | No | Recojo anunciado como servicio | Sitio oficial |
| Shalom | No (oficial) | App + Shalom Pro + agencia | No oficial | Calculadora en Pro | Web/app con login | PDF vía Pro / wrapper no oficial | No oficial | Agencia / recojo anunciado | Sitio + Play Store + LinkedIn oficial |
| Expreso Marvisur | No | Web tracking + sucursal + WhatsApp | No | Formulario / WhatsApp | GRTE en web | Descarga de guía en web | No | Agencia | Sitio oficial |
| Olva | No pública | Registro web + zona clientes + app | No documentado | Cotizador web | Web + app | Rótulo en registro web | No documentado | Zona clientes | Sitio oficial; API de contrato solo en fuentes secundarias |
| Urbano Perú | Sí | REST partner | Sí | No listado como endpoint separado en las páginas de envío | Sí | PDF | Notificaciones anunciadas | Sí (pickup / inversa) | Docs oficiales `urbano.com.pe` |
| Chazki | Sí | REST partner | Sí | Cobertura | Sí | PDF (Tonny) | Sí | Pickup en flujo de entrega | `docs.chazki.com` |
| Urbaner | Sí | REST | Sí | Sí | Sí | No destacado | No destacado en la intro | Ventanas de entrega | `developers.urbaner.com` |
| PedidosYa Envíos | Sí | REST OpenAPI 3 | Sí | Estimate | Sí + GPS | No (red de riders) | Sí | Pickup waypoint | `developers.pedidosya.com` |
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

### 1.1 Dinsides Courier

| Campo | Hallazgo |
| --- | --- |
| Nombre comercial | **Dinsides Courier** |
| Sitio | [https://dinsidescourier.com/](https://dinsidescourier.com/) (también [www.dinsidescourier.com/registro](https://www.dinsidescourier.com/registro)) |
| API pública | **No.** No hay `/developer`, Swagger, ni mención de API/integración/webhooks en el sitio. |
| Modelo | B2B informal: portal de clientes + teléfono/WhatsApp. Login en [dinsidescourier.com/login](https://dinsidescourier.com/login) («Solicita tu usuario»). |
| Operaciones documentadas | Ninguna programática. |
| Auth | Usuario/contraseña del portal (no documentado como API). |
| Docs | No existen. |
| Cómo toman pedidos hoy | Registro/login web, «Solicita tu plan Premium», teléfonos 922 509 459 y 992 565 076, email `contacto@dinsidescourier.com`. LinkedIn de la empresa pide WhatsApp 992 565 076 para fulfillment. |
| Evidencia | Oficial: sitio y [LinkedIn company](https://www.linkedin.com/company/dinsides-courier/). No se encontró app en Play Store ni docs de rastreo público sin cuenta. |

Servicios que el sitio declara: contraentrega (efectivo, transferencia, Yape, Plin, POS), recojo a domicilio, cambio de prenda/producto, fulfillment, reutilizado. Cobertura: tarifario de distritos de Lima/Callao. El tarifario incluye líneas **«Envío Agencia Marvisur»**, **«Envío Agencia Olva Courier»** y **«Envío Agencia Shalom»** a S/5: Dinsides también deja paquetes en agencias de esos tres. Oficinas: Av. Arica 1702 (Cercado) y Jirón Antonio Bazo 1284 (La Victoria / Gamarra). Se presentan como «operador logístico oficial de Gamarra».

Búsquedas de «Dinsides API», «Dinsides integración», «Dinsides rastreo desarrolladores», «Dinsides webhooks» no devolvieron portal técnico. `test.dinsidescourier.com` muestra un campo «Número de seguimiento de tu pedido» (staging, no documentado).

**Implicación ZentoFact:** seguir con etiqueta manual. Un conector exigiría negociación directa; no hay contrato de API publicado.

### 1.2 Shalom (el producto escribe «Shaloom»)

| Campo | Hallazgo |
| --- | --- |
| Nombre comercial | **Shalom**. LinkedIn oficial: [Shalom Empresarial](https://www.linkedin.com/company/shalom-empresarial). Homepage [shalom.com.pe](https://shalom.com.pe/). No hay empresa «Shaloom». |
| Sitios | Público: [shalom.com.pe](https://shalom.com.pe/). Pro: [pro.shalom.pe](https://pro.shalom.pe/) y [shalom.com.pe/proweb](https://shalom.com.pe/proweb). FAQ: [shalom.com.pe/faq/envios_preguntas](https://shalom.com.pe/faq/envios_preguntas). Rastreo: `shalom.com.pe/rastrea` (anunciado por la empresa en LinkedIn). |
| App | Play Store **SHALOM**, id `pe.com.shalom.overskull`, developer OVERSKULL, 1 M+ descargas, sitio `shalom.com.pe/app`. Registra, rastrea, paga, cambia destino. |
| API oficial | **No publicada.** El FAQ oficial dice que se envía por Shalom App, Shalom Pro o agencia. Shalom Pro ofrece registros **manuales y masivos**, pago online, calculadora, historial y rastreo compartible. |
| API no oficial | [shalom-api-peru.com](https://shalom-api-peru.com/) + [docs](https://shalom-api-peru.com/docs/). REST de terceros: `X-API-Key` pedida por WhatsApp + credenciales de `pro.shalom.pe`. Crea preguías reales, tracking, PDF por `ose_id`. El propio docs admite que hace «un login real» (90 s–2 min). **No es Shalom.** Riesgo de ToS, phishing y rotura. |
| Auth oficial | Cuenta Shalom Pro / App (email + password). Desde 2026 la empresa exige login para rastrear ([comunicado LinkedIn](https://es.linkedin.com/pulse/refuerzo-en-la-plataforma-de-rastreo-env%C3%ADos-nueva-medida-jye8e)). |
| Cómo toman pedidos | Agencia; pre-registro en Pro (24 h para dejar el bulto); Excel/formato masivo (tutorial oficial en LinkedIn); app. |
| Evidencia | Oficial alta para el modelo de negocio. Cero docs oficiales de API. Wrapper de terceros bien documentado pero no autorizable para producción de ZentoFact. |

Endpoints internos del front de Shalom (no documentados, no usar): `https://servicesweb.shalomcontrol.com/api/v1/web/agencias/listar` aparece en un gist de sucursales. Un post de LinkedIn de un tercero describe dos URLs de tracking no oficiales.

**Implicación ZentoFact:** el nombre de UI debería ser **Shalom**. Integración automática oficial = pedirle a Shalom Empresas un contrato de API (no hay portal). No usar `shalom-api-peru.com` ni scrapear `pro.shalom.pe`.

### 1.3 Expreso Marvisur (el producto escribe «Marvisuar»)

| Campo | Hallazgo |
| --- | --- |
| Nombre comercial | **Expreso Marvisur**. Razón social **Arequipa Expreso Marvisur E.I.R.L.**, RUC **20498189637** ([FAQ](https://expresomarvisur.com/seccion/preguntas-frecuentes)). No existe «Marvisuar» como marca. |
| Sitio | [https://www.expresomarvisur.com/](https://www.expresomarvisur.com/) |
| API pública | **No.** Búsqueda `site:expresomarvisur.com` API / integración / desarrolladores / webhooks: sin hits. |
| Tracking | Home: «seguimiento con el número de GRTE», ejemplo `V001-0000001`. [Descargar guía](https://expresomarvisur.com/seccion/consulta-gret) pide n° de documento del remitente + serie. |
| Cotizar / crear | [Cotiza](https://www.expresomarvisur.com/cotizacion), [contacto](https://expresomarvisur.com/contacto). WhatsApp cotizaciones 959 177 150, consultas 974 210 358, call center 054-206733. Emails `ventas@expresomarvisur.com`, `cotizaciones@expresomarvisur.com`. |
| Empresas | Home: asesor exclusivo, seguimiento, línea de crédito, flota. No menciona API. Agencia Lima para envíos simultáneos: Jr. Sebastián Lorente 453-495, Barrios Altos (FAQ). |
| Backend no oficial | Gist de terceros llama `POST https://marvicom.expresomarvisur.com/backend/api/Sucursales` (sucursales del front). No es API de clientes. |
| Evidencia | Oficial para web/WhatsApp/sucursal. Cero docs de desarrolladores. |

**Implicación ZentoFact:** el nombre de UI debería ser **Marvisur** o **Expreso Marvisur**. Seguir manual. Un conector exigiría negociación comercial; no hay portal.

---

## 2. Otros couriers peruanos / last-mile

### 2.1 Olva (Olva Courier)

| Campo | Hallazgo |
| --- | --- |
| Nombre | **Olva** / Olva Courier. Sitio [olvacourier.com](https://www.olvacourier.com/). |
| API pública | **No.** `site:olvacourier.com` API / desarrolladores / web service: vacío. Corporativo es un **formulario** ([/corporativo](https://www.olvacourier.com/corporativo/)). |
| Cómo operan | [Registro de envíos en línea](https://www.olvacourier.com/preguntas-frecuentes/) + tutorial ([guía](https://www.olvacourier.com/como-registrar-un-envio-en-la-web-de-olva-paso-a-paso-guia/)). Recojo en **Zona de clientes**. Tracking web + app Play Store + Facebook + (01) 714 0909. WhatsApp 964 771 829. Clientes corporativos: usuario/contraseña para reportes (FAQ). Envíos masivos (>20) en tienda. |
| Etiqueta | El flujo de registro pide imprimir y pegar el rótulo. |
| API de contrato | Agencias (Vexsoluciones, `kom.pe`) afirman token + docs privadas tras contrato. **No hay PDF ni OpenAPI de Olva.** Tratarlo como «posible API partner no publicada». |
| Evidencia | Oficial: portal y FAQ. API: solo secundario. |

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
| API | REST. Host `https://courier-api.pedidosya.com`. Estimate, confirm, create, list, details, tracking GPS, coverage, working zones, cancel, cash collection, PIN, proof of delivery, webhooks. |
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

### Existe como producto, no como API pública

- **Olva:** portal, Excel/masivos, app, tracking. API de contrato no publicada.
- **Shalom:** Pro + App + Excel masivo + agencias. Wrapper de terceros (no usar).
- **Marvisur:** GRTE web + WhatsApp + sucursal.
- **Dinsides:** portal + WhatsApp. Tarifario Lima + drop en agencias Olva/Shalom/Marvisur.
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

---

## 5. Fuentes (todas las URLs usadas)

### Oficiales — Dinsides, Shalom, Marvisur

- https://dinsidescourier.com/
- https://dinsidescourier.com/login
- https://www.dinsidescourier.com/registro
- https://www.linkedin.com/company/dinsides-courier/
- https://shalom.com.pe/
- https://shalom.com.pe/proweb
- https://shalom.com.pe/faq/envios_preguntas
- https://pro.shalom.pe/
- https://wordpress.shalom.com.pe/conoce-mas-de-shalom-pro/
- https://play.google.com/store/apps/details?id=pe.com.shalom.overskull
- https://www.linkedin.com/company/shalom-empresarial
- https://es.linkedin.com/pulse/refuerzo-en-la-plataforma-de-rastreo-env%C3%ADos-nueva-medida-jye8e
- https://www.expresomarvisur.com/
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

Consultado el 5 de septiembre de 2026. Varios sitios (Shalom, Marvisur, Urbano Nuxt, PedidosYa PE) son SPA: el texto de marketing/FAQ se tomó de páginas que sí hidratan o de FAQ/LinkedIn oficiales. No se firmaron contratos ni se pidieron tokens. La existencia de una API partner no publicada (Olva, Shalom Empresas) **no se puede afirmar** más allá de «el comercial puede tener algo»; las docs públicas no la muestran.

No se implementó ningún conector.
