# Problemas de seguridad por solucionar

Fecha de revisión: 9 de julio de 2026  
Estado: pendiente de remediación  
Alcance: `packages/server`, `packages/core`, `packages/web`, `packages/falabella-api`, almacenamiento, base de datos, dependencias y configuración desplegada en Railway.

## Resumen ejecutivo

El CRUD de usuarios incorpora controles adecuados de jerarquía, revocación de sesiones y protección del último administrador. Sin embargo, todavía no es seguro incorporar más usuarios con roles porque varias APIs antiguas no aplican autorización al nivel de empresa o acción y exponen credenciales sensibles al navegador.

Los problemas P0 deben resolverse antes de ampliar el acceso a nuevos usuarios. Los P1 deberían corregirse antes de considerar estable la implementación de roles.

## P0 — Bloqueadores antes de agregar usuarios

### [ ] SEC-001 — Credenciales completas de empresas expuestas al navegador

**Riesgo:** crítico.

`GET /companies` y `GET /companies/:id` devuelven directamente las filas completas de `companies`, incluyendo:

- Usuario y clave SOL.
- Certificado digital y contraseña.
- Usuario y contraseña del seller.
- Falabella API User ID y API key.

El rol `operator` recibe el permiso `companies` por defecto, por lo que un operador nuevo podría obtener todos estos secretos.

**Evidencia:**

- `packages/core/src/db/schema/companies.ts:16`
- `packages/core/src/services/company.service.ts:49`
- `packages/server/src/index.js:137`
- `packages/server/src/permissions.js:28`

**Solución requerida:**

- Crear DTOs públicos de empresa que nunca incluyan secretos.
- Separar endpoints de lectura general y administración de credenciales.
- No devolver contraseñas, API keys, PFX ni claves SOL después de guardarlas.
- Representar secretos configurados con booleanos como `hasCertificate` o `hasFalabellaApiKey`.
- Exigir un permiso específico como `companies.manage_secrets` para reemplazar credenciales.

**Criterio de cierre:** ningún response HTTP normal contiene secretos de empresa, incluso para administradores. Los secretos solo pueden reemplazarse, nunca recuperarse en texto plano.

### [ ] SEC-002 — Secretos persistidos en `localStorage` y disponibles después del logout

**Riesgo:** crítico.

Falabella almacena el objeto completo de las empresas en `localStorage`. El tipo incluye credenciales SOL, certificado, contraseña y API key. El logout solo cierra la sesión y recarga la página; no elimina la caché.

En una computadora compartida, un usuario posterior puede recuperar secretos pertenecientes a una sesión anterior. También amplía el impacto de una extensión maliciosa o de un futuro XSS.

**Evidencia:**

- `packages/web/src/routes/FalabellaApi.tsx:166`
- `packages/web/src/routes/FalabellaApi.tsx:182`
- `packages/web/src/routes/FalabellaApi.tsx:195`
- `packages/web/src/routes/FalabellaApi.tsx:923`
- `packages/web/src/routes/FalabellaApi.tsx:1082`
- `packages/web/src/components/Sidebar.tsx:185`

**Solución requerida:**

- Eliminar la caché `boletas.falabellaApi.companies`.
- Mantener en memoria solamente empresas redactadas.
- Limpiar cualquier dato de sesión sensible durante logout.
- Ejecutar una migración frontend que elimine la clave antigua de `localStorage` para usuarios existentes.

**Criterio de cierre:** después de iniciar sesión, operar y cerrar sesión, no quedan credenciales ni datos sensibles de empresas en `localStorage`, `sessionStorage`, IndexedDB o cachés del navegador.

### [ ] SEC-003 — Bypass de autorización de empresas mediante `/workflow/process`

**Riesgo:** crítico.

Un usuario con permiso `falabella`, aunque no tenga permiso `companies`, puede enviar una configuración con RUC, clave SOL, certificado, contraseña y `modoProduccion`. El backend confía en esos campos y crea o sobrescribe la empresa correspondiente.

Esto permite modificar secretos y configuración fiscal fuera del módulo autorizado.

**Evidencia:**

- `packages/web/src/routes/FalabellaApi.tsx:1868`
- `packages/server/src/index.js:277`
- `packages/core/src/workflow.ts:8`

**Solución requerida:**

- `/workflow/process` debe aceptar únicamente `companyId`, datos de ventas y opciones operativas permitidas.
- Cargar empresa, sucursal, credenciales y ambiente exclusivamente en el servidor.
- Prohibir que el workflow cree o actualice empresas.
- Validar que el usuario tenga acceso a la empresa solicitada.
- Fijar el ambiente SUNAT desde configuración confiable del servidor.

**Criterio de cierre:** un usuario con `falabella` pero sin administración de empresas no puede crear, modificar ni reemplazar ningún secreto o atributo fiscal de una empresa.

### [ ] SEC-004 — No existe aislamiento de empresas por usuario

**Riesgo:** crítico si los usuarios deben atender empresas o sellers específicos.

Los permisos actuales son solamente por módulo. No existe una relación usuario–empresa ni filtros por empresa autorizada. Un usuario con acceso a documentos, notas de crédito o Falabella puede operar recursos de cualquier empresa conociendo o modificando un ID.

**Evidencia:**

- `packages/server/src/auth.js:157`
- `packages/server/src/index.js:153`
- `packages/server/src/index.js:199`
- `packages/server/src/index.js:229`

**Solución requerida:**

- Crear una relación `user_company_memberships` o equivalente.
- Resolver las empresas permitidas desde la identidad autenticada, nunca desde el frontend.
- Añadir `companyId` autorizado a todas las consultas por ID.
- Verificar pertenencia en listados, previews, PDFs, emisiones, reemisiones, notas de crédito, productos y automatización.
- Definir explícitamente si superadmin puede acceder a todas las empresas.

**Criterio de cierre:** pruebas automatizadas demuestran que un usuario asignado a empresa A recibe `403` al intentar leer o modificar cualquier recurso de empresa B.

## P1 — Riesgos altos

### [ ] SEC-005 — El preset `operator` concede demasiados permisos

**Riesgo:** alto.

Un operador nuevo recibe todos los módulos excepto usuarios. Esto incluye credenciales de empresas, emisión SUNAT, notas de crédito, automatización y escrituras de productos.

**Evidencia:** `packages/server/src/permissions.js:28`.

**Solución requerida:** aplicar mínimo privilegio. Separar permisos por acción, por ejemplo:

- `documents.read`
- `documents.create`
- `documents.emit`
- `credit_notes.create`
- `falabella.read`
- `products.write`
- `companies.read`
- `companies.manage_secrets`
- `automation.manage`
- `users.manage`

**Criterio de cierre:** el rol operador por defecto solo incluye las operaciones diarias explícitamente necesarias y no administra secretos, usuarios, automatización ni ambiente fiscal.

### [ ] SEC-006 — Lectura arbitraria de archivos mediante `pdfPath`

**Riesgo:** alto.

`POST /falabella/upload-invoice-pdf` acepta un `pdfPath` enviado por el cliente. El servidor usa `readFileSync(payload.pdfPath)` y luego sube el contenido a Falabella si parece un PDF.

**Evidencia:**

- `packages/server/src/index.js:274`
- `packages/core/src/services/falabella.service.ts:1030`
- `packages/core/src/services/falabella.service.ts:1044`

**Solución requerida:** eliminar `pdfPath` del contrato HTTP. Recibir un ID de documento, consultar el documento autorizado y resolver la ruta internamente con contención estricta.

**Criterio de cierre:** ninguna ruta proporcionada por el cliente llega a `readFileSync`, `writeFileSync` u otra API del filesystem.

### [ ] SEC-007 — Webhook con autenticación fail-open y secreto en query string

**Riesgo:** alto.

Si `AUTO_EMIT_WEBHOOK_SECRET` no existe, el webhook acepta cualquier solicitud. También acepta GET y permite enviar el secreto como `?secret=`, exponiéndolo en logs, historial y proxies.

En Railway el secreto está configurado actualmente, pero el diseño sigue siendo inseguro ante errores de configuración.

**Evidencia:**

- `packages/server/src/index.js:57`
- `packages/server/src/index.js:60`
- `packages/server/src/index.js:337`

**Solución requerida:**

- Fallar al iniciar producción si falta el secreto.
- Aceptar solo POST.
- Usar header o firma HMAC del body con timestamp.
- Comparar secretos con `timingSafeEqual`.
- Añadir protección contra replay y rate limiting.
- No incluir secretos en URLs registradas en Falabella.

**Criterio de cierre:** secreto ausente implica que el servicio no arranca; requests sin firma, expiradas o repetidas reciben rechazo.

### [ ] SEC-008 — `NODE_ENV` no está configurado como producción en Railway

**Riesgo:** alto.

El entorno Railway se llama `production`, pero el servicio API no tiene `NODE_ENV=production`. Better Auth habilita por defecto su rate limiter solamente cuando detecta producción, por lo que actualmente el limitador de intentos de autenticación queda desactivado.

**Evidencia:**

- Comprobación de variables Railway realizada sin exponer valores.
- `packages/server/src/auth.js:23`
- `packages/server/node_modules/better-auth/dist/context/create-context.mjs:169`

**Solución requerida:**

- Configurar `NODE_ENV=production` en el API.
- Configurar `rateLimit.enabled`, ventana y máximo explícitamente.
- Aplicar límites más estrictos a login y recuperación de contraseña.
- No depender únicamente de `NODE_ENV` para controles obligatorios.

**Criterio de cierre:** pruebas contra el despliegue demuestran respuestas `429` después del límite configurado.

### [ ] SEC-009 — Validación insuficiente de documentos fiscales

**Riesgo:** alto.

Los endpoints aceptan objetos casi directamente. No hay schemas estrictos para series, RUC, fechas, moneda, cantidades, importes, porcentajes, número de ítems o longitudes. `validateVentas` solo verifica tres campos y no se ejecuta obligatoriamente dentro de `/workflow/process`.

**Evidencia:**

- `packages/server/src/index.js:166`
- `packages/server/src/index.js:178`
- `packages/server/src/index.js:282`
- `packages/core/src/index.ts:123`
- `packages/core/src/utils/tax-calculator.ts:38`

**Solución requerida:** usar schemas del servidor para cada request y rechazar números negativos, `NaN`, infinitos, formatos inválidos, ítems excesivos y campos desconocidos.

**Criterio de cierre:** todos los endpoints fiscales validan el body antes de tocar la base de datos o SUNAT y cuentan con pruebas de entradas maliciosas.

### [ ] SEC-010 — El cliente puede influir en el ambiente de notas de crédito

**Riesgo:** alto.

Las opciones de nota de crédito admiten `modoProduccion`; el servicio utiliza ese valor por encima del configurado en la empresa. También se acepta `usuarioCreacion` desde opciones, lo que permite falsificar la identidad registrada.

**Evidencia:**

- `packages/core/src/services/credit-note.service.ts:12`
- `packages/core/src/services/credit-note.service.ts:85`
- `packages/core/src/services/credit-note.service.ts:93`

**Solución requerida:** resolver ambiente e identidad exclusivamente desde configuración del servidor y usuario autenticado.

**Criterio de cierre:** ninguna request puede escoger beta/producción ni indicar quién ejecutó la acción.

### [ ] SEC-011 — Posible escape del directorio de almacenamiento

**Riesgo:** alto.

Varias rutas de archivo se construyen con serie, correlativo, fecha, número completo o RUC sin normalización uniforme. El fallback local usa `path.join` sin comprobar que el resultado permanezca dentro de `STORAGE_PATH`.

**Evidencia:** `packages/core/src/services/file.service.ts:23`.

**Solución requerida:** validar formatos, sanear todos los segmentos y comprobar contención con `path.resolve` antes de leer o escribir.

**Criterio de cierre:** entradas con `../`, separadores, caracteres Unicode equivalentes o rutas absolutas son rechazadas y están cubiertas por pruebas.

### [ ] SEC-012 — Sin límites globales de body ni protección de operaciones costosas

**Riesgo:** alto.

No se encontró un límite global para cuerpos JSON/base64 ni rate limiting en rutas personalizadas. Certificados, PDFs y lotes podrían consumir memoria. Consultas de productos y resúmenes pueden provocar miles de requests externas. `/auto-emit/run?limit=` acepta un límite no acotado.

**Evidencia:**

- `packages/server/src/index.js:27`
- `packages/server/src/index.js:274`
- `packages/server/src/index.js:330`
- `packages/core/src/services/falabella.service.ts:345`

**Solución requerida:** límites por ruta, máximo de registros, timeouts, cancelación, colas y rate limits por usuario/IP/empresa.

**Criterio de cierre:** requests excesivas reciben `413`, `422` o `429` sin elevar significativamente memoria, CPU o consumo externo.

## P2 — Riesgos medios

### [ ] SEC-013 — Secretos almacenados en texto plano en PostgreSQL

**Solución requerida:** cifrado de aplicación con envelope encryption/KMS, rotación documentada y separación de claves respecto de la base de datos.

### [ ] SEC-014 — URLs firmadas de Falabella regresan al navegador

El cliente genera URLs con UserID, timestamp y firma HMAC, y el core devuelve `response.url` en varias respuestas.

**Evidencia:**

- `packages/falabella-api/src/client.ts:43`
- `packages/falabella-api/src/client.ts:60`
- `packages/core/src/services/falabella.service.ts:286`
- `packages/core/src/services/falabella.service.ts:301`

**Solución requerida:** eliminar la URL firmada de los DTOs o redactar completamente sus parámetros.

### [ ] SEC-015 — Cabeceras HTTP de seguridad ausentes

La comprobación del API y frontend desplegados no encontró:

- Content-Security-Policy.
- Strict-Transport-Security.
- X-Content-Type-Options.
- Referrer-Policy.
- Permissions-Policy.
- Protección contra framing.

**Solución requerida:** agregar middleware de cabeceras en el API y configurar el servidor estático/frontend.

### [ ] SEC-016 — Iframes `srcDoc` sin `sandbox`

**Evidencia:**

- `packages/web/src/routes/Documentos.tsx:328`
- `packages/web/src/routes/IndividualInvoice.tsx:360`
- `packages/web/src/routes/FalabellaApi.tsx:3535`

**Solución requerida:** aplicar un `sandbox` mínimo y mantener el contenido generado estrictamente escapado.

### [ ] SEC-017 — Puppeteer ejecutado con `--no-sandbox`

**Evidencia:** `packages/core/src/services/pdf.service.ts:17`.

**Solución requerida:** ejecutar Chrome con sandbox en una imagen/infraestructura compatible y mantener aislamiento adicional del proceso PDF.

### [ ] SEC-018 — Auditoría incompleta

Solo la administración de usuarios cuenta con auditoría confiable. Faltan eventos para:

- Cambios de empresa y credenciales.
- Emisión y reemisión.
- Notas de crédito.
- Descargas de PDF/XML/CDR.
- Cambios de ambiente.
- Automatización y webhooks.

La identidad debe venir de la sesión autenticada, no del body.

### [ ] SEC-019 — Payloads de webhook almacenados sin retención

`webhook_events.raw` conserva el payload completo sin política de expiración, posiblemente con datos personales.

**Evidencia:**

- `packages/server/src/auto-emission.js:142`
- `packages/server/src/auto-emission.js:459`

**Solución requerida:** minimización de datos, redacción, TTL/retención y job de eliminación.

### [ ] SEC-020 — Contraseñas con políticas inconsistentes

El CRUD de usuarios exige 12 caracteres, pero Better Auth conserva el mínimo predeterminado de 8 para cualquier flujo de signup o seed que utilice directamente su endpoint.

**Evidencia:**

- `packages/server/src/users.js:19`
- `packages/server/src/auth.js:32`

**Solución requerida:** configurar explícitamente `minPasswordLength: 12`, un máximo razonable y protección contra contraseñas comprometidas si el producto lo requiere.

### [ ] SEC-021 — Bootstrap permanente mediante `AUTH_SUPERADMIN_EMAIL`

Si la variable queda configurada, cada arranque intenta promover la cuenta activa que coincida con ese correo.

**Evidencia:** `packages/server/src/users.js:160`.

**Solución requerida:** reemplazar por un comando de recuperación de una sola ejecución, con auditoría, confirmación y eliminación automática del mecanismo temporal.

### [ ] SEC-022 — Sesiones expiradas sin limpieza periódica

La revisión encontró sesiones expiradas almacenadas. No permiten acceso, pero aumentan datos residuales y dificultan gestión operativa.

**Solución requerida:** job periódico de eliminación y una pantalla/endpoint para revisar y revocar sesiones activas.

### [ ] SEC-023 — `.env` local legible por otros usuarios del sistema

El `.env` local tiene permisos `0644`. No se encontró comprometido en el historial Git.

**Solución requerida:** usar `chmod 600 .env`, gestores de secretos y validaciones pre-commit que impidan agregar archivos sensibles.

### [ ] SEC-024 — Frontend productivo servido con Vite Preview y hosts abiertos

**Evidencia:**

- `packages/web/src/vite.config.ts:41`
- `packages/web/railway.json:8`

**Solución requerida:** servir los assets con un servidor de producción/CDN, restringir hosts y configurar correctamente caché y cabeceras.

## Controles existentes que deben conservarse

- Registro público deshabilitado por defecto.
- Roles admin y superadmin con jerarquía.
- Solo superadmin puede crear o administrar cuentas administrativas.
- Un administrador no puede cambiar sus propios privilegios desde el CRUD.
- Protección transaccional contra eliminar/desactivar el último admin o superadmin.
- Revocación de sesiones al cambiar contraseña, rol, permisos o estado.
- Autorización recargada desde PostgreSQL en cada petición protegida.
- Protección CSRF con origen permitido y token ligado a sesión.
- Comparación timing-safe del token CSRF.
- Consultas SQL inspeccionadas parametrizadas.
- No se encontró ejecución de comandos controlada por usuarios.
- `npm audit` reportó cero vulnerabilidades conocidas al momento de la revisión.

## Pruebas de seguridad faltantes

### [ ] RBAC HTTP

- Viewer puede leer únicamente los recursos permitidos.
- Viewer recibe `403` en cada POST, PUT, PATCH y DELETE.
- Operador no obtiene administración de usuarios ni secretos.
- Admin no puede administrar superadmins.
- Sesiones anteriores dejan de funcionar inmediatamente después de un cambio de permisos.

### [ ] Aislamiento por empresa

- Usuario de empresa A no puede listar, descargar, previsualizar o modificar recursos de empresa B.
- IDs secuenciales manipulados no permiten acceso cruzado.
- Los listados nunca aceptan un `companyId` fuera de las membresías del usuario.

### [ ] Secretos

- Responses de empresas no contienen claves, passwords, PFX ni API keys.
- Logout elimina cachés antiguas.
- Logs y errores no contienen secretos.
- URLs Falabella entregadas al navegador no contienen firma ni UserID.

### [ ] Webhook y abuso

- El servicio no inicia en producción sin secreto de webhook o auth.
- Firmas incorrectas, expiradas y repetidas son rechazadas.
- Login y endpoints costosos responden `429` al superar límites.
- Bodies excesivos responden `413`.

### [ ] Filesystem

- Path traversal y rutas absolutas son rechazados.
- Ningún path enviado por cliente se usa directamente.
- Lecturas y escrituras permanecen dentro del directorio configurado.

## Estado de validación de la revisión

- Pruebas existentes del servidor: 3 de 3 aprobadas.
- Build de `@zentofact/falabella-api`: aprobado.
- Build de `@zentofact/core`: aprobado.
- Build de `@zentofact/web`: aprobado.
- Comprobaciones sintácticas del servidor: aprobadas.
- `npm audit`: 0 vulnerabilidades conocidas.
- Variables Railway sensibles: comprobadas únicamente por presencia/longitud; ningún valor fue mostrado o modificado.
- Cabeceras del API y frontend públicos: comprobadas mediante requests de solo lectura.
- No se modificaron datos ni infraestructura durante la auditoría.

## Orden recomendado de implementación

1. Resolver SEC-001 y SEC-002: retirar secretos del navegador y limpiar almacenamiento local.
2. Resolver SEC-003: hacer que workflow utilice configuración exclusivamente del servidor.
3. Resolver SEC-004: implementar membresías y autorización por empresa/recurso.
4. Resolver SEC-005: rediseñar permisos por acción y reducir el preset operador.
5. Resolver SEC-006, SEC-009, SEC-010 y SEC-011: archivos, schemas y ambiente fiscal.
6. Resolver SEC-007, SEC-008 y SEC-012: webhook, rate limiting y límites operativos.
7. Resolver P2: cifrado, cabeceras, auditoría, retención y hardening.
8. Completar todas las pruebas de seguridad antes de habilitar nuevos usuarios.
