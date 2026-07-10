# Revisión posterior — módulo de usuarios

Fecha: 2026-07-09  
Alcance: usuarios, roles, sesiones, CSRF de rutas protegidas y autorización de escritura por módulo.

## Resultado

Los problemas de escalamiento mediante el permiso `users`, el bootstrap automático, la carrera del último administrador, las sesiones tras reset de contraseña, CSRF de rutas personalizadas, las escrituras de `viewer` y el permiso de productos fueron corregidos en código. La revisión fue estática más pruebas unitarias de permisos; no se ejecutó una prueba HTTP integrada contra PostgreSQL/Better Auth.

| Hallazgo | Estado | Evidencia |
| --- | --- | --- |
| Permiso `users` permite escalar privilegios | Corregido | Solo `admin`/`superadmin` obtienen el permiso efectivo; servidor compara actor, objetivo y rol solicitado. |
| Cambiar/resetear cuentas administrativas | Corregido | Solo `superadmin` administra `admin` o `superadmin`; los administradores gestionan solo roles inferiores. |
| Bootstrap de cuenta más antigua | Corregido | Ya no existe promoción ni reactivación automática; bootstrap explícito por `AUTH_SUPERADMIN_EMAIL`. |
| Carrera del último admin | Corregido | Operaciones críticas se serializan con advisory lock y verifican último admin/superadmin en transacción. |
| Reset no revoca sesiones | Corregido | Reset, desactivación o cambio de privilegios elimina sesiones de la cuenta afectada. |
| CSRF en rutas personalizadas | Corregido | Mutaciones autenticadas requieren `Origin` confiable y token HMAC ligado a la sesión. |
| `viewer` con escrituras | Corregido | El middleware niega métodos POST/PUT/PATCH/DELETE para `viewer`. |
| Productos protegido solo por Falabella | Corregido | Las rutas de productos exigen además el permiso `productos`. |

## Controles implementados

- Roles: `viewer`, `operator`, `admin` y `superadmin` con jerarquía explícita.
- Contraseñas nuevas o reseteadas: mínimo 12 caracteres.
- CRUD de Better Auth realizado con Drizzle; SQL directo queda limitado a DDL de compatibilidad y al advisory lock de PostgreSQL.
- Tabla `user_audit_log` para altas, cambios, resets y eliminaciones; no guarda contraseñas.
- El seed no tiene credenciales por defecto y crea un `superadmin` solo con `ADMIN_EMAIL` y `ADMIN_PASSWORD` proporcionados por entorno.
- En producción se exige `BETTER_AUTH_SECRET`.
- La UI no permite a un admin normal editar cuentas administrativas ni seleccionar roles administrativos.

## Operación requerida

1. Elegir una cuenta activa de máxima confianza.
2. Configurar temporalmente `AUTH_SUPERADMIN_EMAIL` con su correo y reiniciar el servidor, o ejecutar el seed con variables de entorno seguras.
3. Confirmar que la cuenta figura como `superadmin`.
4. Eliminar `AUTH_SUPERADMIN_EMAIL` del entorno para que no se aplique en cada arranque.
5. Conservar por lo menos un superadmin activo y un administrador activo.

## Verificaciones ejecutadas

- `npm run test -w @zentofact/server`: 3 pruebas pasan.
- `node --check` de los módulos de servidor modificados: pasa.
- `npm run build`: pasa.
- `npm audit --json`: 0 vulnerabilidades.

## Riesgos que siguen pendientes fuera del módulo Usuarios

1. **Crítico:** `/companies` aún devuelve certificado, claves y contraseñas; sigue pendiente el plan de [SECRETS_MIGRATION_PLAN.md](SECRETS_MIGRATION_PLAN.md).
2. **Alto:** el webhook Falabella sigue aceptando solicitudes si `AUTO_EMIT_WEBHOOK_SECRET` no está definido. La nueva variable se documentó, pero el endpoint todavía debe fallar cerrado.
3. **Alto:** el workflow de emisión aún acepta certificado y clave SOL enviados desde el cliente. Debe pasar a recibir solo `companyId` y cargar secretos internamente.
4. Faltan pruebas de integración HTTP con base de datos para demostrar CSRF, revocación de sesión, actor–objetivo y último administrador en condiciones reales.

No se deben considerar resueltos los riesgos de secretos y webhook hasta implementar esas tareas.
