# Revisión integral posterior

Fecha original: 2026-07-09  
Actualización de estado: 2026-07-10  
Método: revisión estática de rutas y servicios, pruebas unitarias de permisos, compilación, auditoría npm y consulta de confirmación de rol.

## Estado general

| Área | Estado | Resultado |
| --- | --- | --- |
| Dependencias | Corregido | `npm audit --json`: 0 vulnerabilidades. |
| Superadmin | Configurado | La cuenta indicada por `AUTH_SUPERADMIN_EMAIL` está activa y tiene rol `superadmin`. |
| Usuarios, jerarquía y sesiones | Corregido | Autoridad actor–objetivo, auditoría, revocación de sesiones y bloqueo transaccional. |
| CSRF de rutas protegidas | Corregido | Token ligado a sesión y `Origin` confiable requeridos para mutaciones. |
| Viewer y productos | Corregido | Viewer no puede mutar; productos exige permiso específico. |
| Secretos de empresas | **Corregido** | DTO público; sin cert/SOL/API keys en respuestas HTTP. |
| Workflow de emisión | **Corregido** | Solo `companyId` + ventas; secretos desde DB en el servidor. |
| Aislamiento por empresa / permisos finos | Mejora diferida | Aceptable con pocos usuarios y permisos básicos por módulo (SEC-004, SEC-005). |
| Hardening adicional (webhook, FS, rate limit, etc.) | Backlog | Documentado en [SECURITY_ISSUES_TO_FIX.md](SECURITY_ISSUES_TO_FIX.md); no tratado como incidente abierto. |

## Cambios comprobados

### Usuarios y autorización

- `superadmin` administra administradores; `admin` solo administra operadores y viewers.
- El permiso `users` solo es efectivo para roles administrativos.
- El servidor recibe actor y objetivo antes de crear, actualizar o borrar una cuenta.
- No hay promoción automática de la cuenta más antigua.
- `AUTH_SUPERADMIN_EMAIL` promueve únicamente una cuenta activa identificada de forma explícita.
- Las operaciones de cambio de rol, desactivación, password reset y borrado se serializan con advisory lock de PostgreSQL.
- Se protege el último administrador y el último superadmin activos.
- Reset de contraseña, desactivación y cambios de privilegios eliminan todas las sesiones de la cuenta afectada.
- `user_audit_log` registra las operaciones administrativas sin almacenar contraseñas.
- El CRUD de usuarios usa Drizzle; SQL directo queda limitado al DDL de compatibilidad y al advisory lock transaccional.

### CSRF y permisos de acciones

- Todas las rutas protegidas con métodos POST/PUT/PATCH/DELETE exigen `Origin` permitido y `x-csrf-token` ligado a la sesión.
- El cliente web obtiene el token desde `/me` y lo adjunta a sus mutaciones, incluido el workflow streaming.
- El middleware impide métodos de escritura a `viewer`.
- `GET` y `POST /falabella/:companyId/products` exigen `productos`, además del guard de Falabella.

### Secretos y workflow (cierre 2026-07-10)

- Listado y detalle de empresas no serializan secretos; solo flags de presencia.
- Updates de empresa no pisan secretos con strings vacíos del cliente.
- `/workflow/process` construye config operativa sin cert/SOL del body.
- `processWorkflow` / `ensureSetup` cargan empresa y credenciales desde PostgreSQL por `companyId`.

## Verificaciones ejecutadas

- Confirmación de que el superadmin configurado está activo: correcta.
- `npm run test -w @zentofact/server`: 3 de 3 pruebas pasan.
- `node --check` de `auth.js`, `index.js` y `users.js`: pasa.
- `npm run build`: pasa.
- `npm audit --json`: 0 vulnerabilidades.
- `git diff --check`: pasa.

## Mejoras diferidas (no pendientes de seguridad)

1. **Membresías usuario–empresa (SEC-004)** — cuando haya más operadores por seller.
2. **Permisos granulares por acción (SEC-005)** — si los presets por módulo dejan de bastar.
3. **Hardening extra** — webhook fail-closed, validación fiscal estricta, contención de paths, rate limits, cabeceras HTTP, etc. (SEC-006+). Ver catálogo completo en [SECURITY_ISSUES_TO_FIX.md](SECURITY_ISSUES_TO_FIX.md).

## Conclusión

La superficie de **usuarios, CSRF, secretos en el cliente y workflow** está endurecida y se considera **cerrada** para el modelo actual (pocos usuarios, permisos básicos por módulo).

El catálogo SEC se conserva como **memoria técnica y backlog de mejoras**, no como lista de incidentes pendientes. Reabrir SEC-004 (y endurecimientos relacionados) al escalar el número de usuarios o al aislar sellers entre operadores.
