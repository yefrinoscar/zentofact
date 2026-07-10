# Revisión de seguridad — RBAC, sesiones y dependencias

Fecha de revisión: 2026-07-09  
Alcance: revisión estática del servidor, core y UI; `npm run build`; y `npm audit --omit=dev`.

## Resultado

Los siete hallazgos reportados están **confirmados**. Hay una ruta de escalamiento remoto a administrador mediante CSRF y una exposición de secretos de producción a operadores. Deben tratarse como incidentes de seguridad: rotar las credenciales de empresa que hayan estado disponibles para operadores, configurar el webhook con un secreto y corregir los controles del servidor antes de volver a conceder acceso de operador.

| Prioridad | Hallazgo | Estado |
| --- | --- | --- |
| Crítica | Operadores pueden leer y recibir secretos de empresas | Confirmado |
| Alta | CSRF permite crear un administrador | Confirmado |
| Alta | El permiso `users` permite escalar privilegios | Confirmado |
| Alta | El rol `viewer` puede modificar y emitir | Confirmado |
| Media | `productos` no se exige en la API | Confirmado |
| Media | Bootstrap de administrador inseguro y con carrera | Confirmado |
| Media | Restablecer contraseña no revoca sesiones | Confirmado |
| Alta | Webhook público acepta solicitudes sin secreto configurado | Confirmado |

## 1. Secretos de empresas expuestos a operadores — Crítica

`operator` recibe todos los permisos salvo `users`, incluido `companies` (`packages/server/src/permissions.js:23-26`). El guard de `/companies` permite a ese rol llamar todos los verbos del módulo (`packages/server/src/index.js:79-92`). `listCompanies()` y `getCompany()` usan `select()` sin proyección (`packages/core/src/services/company.service.ts:49-56`), y las rutas devuelven el resultado directamente (`packages/server/src/index.js:136-141`).

La tabla incluye clave SOL, certificado, contraseña del certificado, contraseña Seller y clave API de Falabella (`packages/core/src/db/schema/companies.ts:16-23`). El mismo problema afecta las respuestas de `POST /companies` y `PATCH /companies/:id`: `createCompany`/`updateCompany` devuelven la fila completa.

**Impacto.** Cualquier operador autenticado puede extraer credenciales para SUNAT y Falabella, certificados y sus contraseñas. Una vez leídas, esas credenciales no vuelven a ser confidenciales.

**Corrección.** Crear un DTO público de empresa con campos operativos no secretos y usarlo en todas las respuestas HTTP. No enviar el certificado ni ninguna contraseña o API key al navegador. Separar lectura/actualización de secretos en endpoints explícitos y auditados, protegidos por un permiso administrativo exclusivo (por ejemplo, `company_secrets`); no otorgarlo a `operator`. Cifrar secretos en reposo con una clave gestionada fuera de la base de datos si la arquitectura lo permite. Rotar inmediatamente las credenciales y certificados de las empresas accesibles a operadores, y revisar los logs de acceso.

## 2. CSRF para crear un administrador — Alta

Con HTTPS, Better Auth configura las cookies como `SameSite=None; Secure` (`packages/server/src/auth.js:66-70`). Las mutaciones personalizadas de usuarios solo comprueban `requirePermission('users')` (`packages/server/src/index.js:119-126`); no validan `Origin`/`Referer` ni exigen un token CSRF. La configuración CORS (`packages/server/src/index.js:31-40`) no protege contra el envío de una solicitud: únicamente impide que un origen no permitido lea la respuesta.

Un sitio atacante puede enviar un `POST` de tipo simple (`text/plain`) con JSON a `/users`. El navegador adjuntará la cookie de la víctima cuando esta sea `SameSite=None`; `c.req.json()` procesa el cuerpo y `createUser` acepta `role: 'admin'` (`packages/server/src/users.js:76-121`). Por tanto, basta que visite el sitio un usuario que tenga el permiso `users`.

**Corrección.** Para todas las rutas autenticadas que cambian estado, exigir un `Origin` permitido (y rechazar solicitudes sin `Origin` cuando no haya una excepción bien definida) y un token CSRF ligado a la sesión, validado en tiempo constante. Aplicarlo como middleware antes de las rutas, no solo a `/users`. Si la topología lo permite, usar `SameSite=Lax` o `Strict`; si el frontend es realmente cross-site, mantener `None` solo junto con la protección CSRF. Añadir pruebas con una solicitud cross-origin de `Content-Type: text/plain`.

## 3. `users` equivale a administrador — Alta

El permiso personalizado `users` autoriza crear, editar y borrar cualquier cuenta (`packages/server/src/index.js:115-130`). `createUser` acepta el rol solicitado, incluido `admin` (`packages/server/src/users.js:76-90`), y `updateUser` permite cambiar rol, permisos, estado y contraseña de cualquier objetivo (`packages/server/src/users.js:123-165`). Ninguna función recibe ni evalúa el actor. La interfaz también permite seleccionar el rol administrador a quien alcance esa pantalla (`packages/web/src/routes/Users.tsx:176-191`, `412-443`).

**Impacto.** Un usuario con el permiso `users` puede promoverse, crear un administrador, restablecer la contraseña de un administrador existente o desactivarlo.

**Corrección.** En el servidor, separar `manage_users` de `manage_admins` y verificar siempre `actor` y `target`. Solo `admin`/`superadmin` deben crear o modificar cuentas admin, asignar roles/permisos privilegiados, desactivar/eliminar admins o restablecer contraseñas de terceros. Limitar a los demás administradores de usuarios a objetivos de menor jerarquía y eliminar el campo de contraseña de la actualización general; usar un endpoint de reset con la misma política. La UI debe reflejar esas reglas, pero nunca ser el control de seguridad.

## 4. `viewer` no es de solo lectura — Alta

El preset `viewer` incluye `documentos`, `falabella` y `productos` (`packages/server/src/permissions.js:28-31`). Los guards por módulo se aplican sin distinguir el método HTTP (`packages/server/src/index.js:79-92`). Por ello el mismo permiso que permite leer autoriza `POST /boletas`, envío/reemisión a SUNAT, creación de facturas y el procesamiento de workflows (`packages/server/src/index.js:164-184`, `276-302`). También permite mutaciones Falabella, como subir PDFs o crear productos (`packages/server/src/index.js:236`, `272-273`).

**Corrección.** Modelar permisos de acción en el servidor, como `documentos:read`, `documentos:write`, `documentos:send`, `falabella:read`, `falabella:write` y `productos:write`, y asociar cada ruta y verbo a la acción mínima necesaria. El rol `viewer` debe tener exclusivamente acciones `:read`; denegar por defecto cualquier método no seguro. Separar los endpoints de vista previa que no tengan efecto de los que emiten o envían documentos.

## 5. Permiso `productos` solo existe en la UI — Media

No hay endpoints `/productos`. Los endpoints de producto son `GET/POST /falabella/:companyId/products` (`packages/server/src/index.js:232-239`) y todo `/falabella` está protegido exclusivamente por `falabella` (`packages/server/src/index.js:83-92`). Así, un usuario con `falabella` y sin `productos` puede crear productos mediante la API.

**Corrección.** Proteger esas rutas concretas con el permiso/acción `productos` (lectura y escritura según corresponda), antes o en lugar del guard genérico `falabella`. Mantener una matriz ruta–método–permiso como prueba de regresión.

## 6. Bootstrap de administrador inseguro y condición de carrera — Media

En cada arranque, `ensureUserColumns()` consulta si existe un admin activo y, de no haberlo, reactiva y asciende a administrador a la cuenta más antigua sin filtrar por `active` (`packages/server/src/users.js:39-57`). Dos demociones o borrados concurrentes pueden pasar el conteo de “otro admin” antes de sus respectivos cambios (`packages/server/src/users.js:137-176`), dejar cero admins activos y disparar ese bootstrap en el próximo inicio. El script de seed contiene credenciales de fallback conocidas (`packages/server/src/seed-admin.js:12`).

**Corrección.** Eliminar la promoción automática al arrancar. Fallar de forma visible y requerir un procedimiento de recuperación con una identidad/secret externo verificado. El seed debe exigir `ADMIN_EMAIL` y un secreto fuerte entregado por entorno o gestor de secretos; nunca proveer valores por defecto. Para proteger el último admin, hacer la verificación y la actualización/borrado en una transacción serializable con bloqueo de filas/advisory lock, o imponer una restricción transaccional equivalente.

## 7. Un reset de contraseña conserva las sesiones robadas — Media

Al actualizar una contraseña, `updateUser` cambia solo la fila `account` (`packages/server/src/users.js:154-161`). No elimina ni invalida las filas de sesión. Una cookie de sesión robada sigue siendo aceptada mientras la cuenta continúe activa.

**Corrección.** En la misma transacción del restablecimiento, borrar o revocar todas las sesiones del usuario (incluida la actual), registrar el evento y forzar un nuevo inicio de sesión. Hacer lo mismo al desactivar una cuenta o reducir privilegios críticos. Añadir un contador/versión de sesión si Better Auth permite validarlo en cada solicitud.

## Webhook Falabella sin secreto — Alta

El webhook solo rechaza la solicitud cuando `AUTO_EMIT_WEBHOOK_SECRET` no está vacío **y** no coincide (`packages/server/src/index.js:58-74`). Si la variable no se define, `expected` queda vacío y cualquier llamada a `POST` o `GET /webhooks/falabella/:companyId` llega a `handleWebhook`.

**Corrección.** Fallar al inicio si falta el secreto en entornos no locales y responder `401`/`503` siempre que no esté configurado. Aceptar solo `POST`, comparar un secreto o firma en tiempo constante y preferir una firma criptográfica del proveedor si Falabella la ofrece. No colocar secretos en query strings: quedan expuestos en logs, historial y referers; use un header de firma/autorización.

## Dependencias y verificación

`npm run build` terminó correctamente el 2026-07-09. No se encontraron pruebas automatizadas de RBAC o CSRF en el repositorio.

Antes de la remediación, `npm audit --omit=dev --json` informó 7 vulnerabilidades de dependencias de producción: 2 altas, 2 moderadas y 3 bajas. Las altas son:

- `drizzle-orm` 0.41.0, inyección SQL por identificadores mal escapados ([GHSA-gpj5-g38j-94v9](https://github.com/advisories/GHSA-gpj5-g38j-94v9)); el informe indica corregido desde 0.45.2. Revisar la migración como cambio mayor y las consultas que construyan identificadores dinámicos.
- `ws` 8.20.0, agotamiento de memoria por fragmentos/chunks pequeños ([GHSA-96hv-2xvq-fx4p](https://github.com/advisories/GHSA-96hv-2xvq-fx4p)); llega de `puppeteer-core`. Actualizar Puppeteer o forzar una versión segura compatible de `ws` (>= 8.21.0), verificando el lockfile.

La remediación de dependencias se completó el 2026-07-09:

- `drizzle-orm` se actualizó a 0.45.2.
- `puppeteer` se actualizó a 25.3.0, que trae `ws` 8.21.0; la configuración de PDF se adaptó a su API actual.
- `xmlbuilder2` se actualizó a 4.0.3 y `js-yaml` se resolvió a 4.3.0.
- `react-router-dom` y `react-router` se fijaron a 7.15.1.
- Vite se actualizó a 8.1.4 con `@vitejs/plugin-react` 6.0.3. Se retiró la dependencia de la CLI `shadcn` y se conservaron localmente sus variantes CSS usadas por los componentes.

Al finalizar, tanto `npm audit --json` como `npm audit --omit=dev --json` informan **0 vulnerabilidades**. `npm run build` también terminó correctamente.

## Plan de remediación recomendado

1. Rotar los secretos expuestos y definir `AUTO_EMIT_WEBHOOK_SECRET`; deshabilitar temporalmente acceso de operadores a empresas si no se puede desplegar el DTO seguro de inmediato.
2. Corregir CSRF y revocar/recrear sesiones; restringir de inmediato las mutaciones de `/users` a administradores en el servidor.
3. Cambiar RBAC de permisos de módulo a permisos de acción y endurecer productos/Falabella y el rol `viewer`.
4. Eliminar el bootstrap/seed inseguro y hacer transaccionales las operaciones sobre el último administrador.
5. Añadir pruebas automatizadas de matriz RBAC, escalamiento de rol, CSRF, redacción de secretos, webhook sin secreto y revocación de sesiones.

Las conclusiones de autorización son estáticas; no se enviaron solicitudes a producción ni se usaron credenciales. La actualización de dependencias y sus ajustes de compatibilidad sí fueron aplicados, pero los hallazgos de autorización, secretos, sesiones y webhook siguen pendientes.
