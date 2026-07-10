# Revisión integral posterior

Fecha: 2026-07-09  
Método: revisión estática de rutas y servicios, pruebas unitarias de permisos, compilación, auditoría npm y consulta de confirmación de rol.

## Estado general

| Área | Estado | Resultado |
| --- | --- | --- |
| Dependencias | Corregido | `npm audit --json`: 0 vulnerabilidades. |
| Superadmin | Configurado | La cuenta indicada por `AUTH_SUPERADMIN_EMAIL` está activa y tiene rol `superadmin`. |
| Usuarios, jerarquía y sesiones | Corregido | Autoridad actor–objetivo, auditoría, revocación de sesiones y bloqueo transaccional. |
| CSRF de rutas protegidas | Corregido en código | Token ligado a sesión y `Origin` confiable requeridos para mutaciones. |
| Viewer y productos | Corregido | Viewer no puede mutar; productos exige permiso específico. |
| Secretos de empresas | Pendiente crítico | Aún se envían al navegador desde `/companies`. |
| Webhook Falabella | Pendiente alto | Aún falla abierto si no existe secreto. |
| Workflow de emisión | Pendiente alto | Aún acepta certificado y clave SOL desde cliente. |

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

## Verificaciones ejecutadas

- Confirmación de que el superadmin configurado está activo: correcta.
- `npm run test -w @zentofact/server`: 3 de 3 pruebas pasan.
- `node --check` de `auth.js`, `index.js` y `users.js`: pasa.
- `npm run build`: pasa.
- `npm audit --json`: 0 vulnerabilidades.
- `git diff --check`: pasa.

## Riesgos pendientes

1. **Crítico — secretos de empresas.** `listCompanies()` y `getCompany()` siguen seleccionando la fila completa de `companies`; `/companies` aún devuelve PFX/Base64, claves SOL, contraseñas y API keys. Está documentado en [SECRETS_MIGRATION_PLAN.md](SECRETS_MIGRATION_PLAN.md).
2. **Alto — webhook fail-open.** `/webhooks/falabella/:companyId` continúa aceptando solicitudes cuando `AUTO_EMIT_WEBHOOK_SECRET` no está configurado. La variable existe en `.env`, pero falta rechazar siempre el webhook en ese estado.
3. **Alto — secretos enviados al workflow.** El frontend aún construye `certificadoBase64` y `claveSol` para el workflow. Debe enviar solo `companyId`; el backend debe cargar secretos internamente.
4. **Medio — permisos personalizados no son aún acciones granulares.** El bloqueo garantiza viewer de solo lectura, pero operadores con permisos personalizados siguen teniendo permisos por módulo. Implementar `:read`, `:write` y `:send` permanece como mejora de defensa en profundidad.
5. **Pruebas de integración.** Las pruebas actuales cubren utilitarios de permiso; faltan pruebas HTTP contra Better Auth/PostgreSQL para CSRF, revocación de sesión, autoridad actor–objetivo y carrera del último admin.

Conclusión: la superficie de Usuarios está significativamente endurecida y las dependencias están limpias. No debe considerarse cerrado el programa de seguridad hasta resolver los secretos de empresas, el webhook y el workflow.
