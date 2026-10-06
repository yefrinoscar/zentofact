# Consolidación de cuentas duplicadas (`user.merge`)

Mantenimiento puntual para unificar una cuenta duplicada de Better Auth dentro de
una cuenta conservada, trasladar la atribución de ventas
(`orders.created_by`) y **eliminar** la cuenta duplicada dentro de la misma
transacción. Pensado para el caso de Julio Alfaro (admin + vendedor duplicado).

Script: `packages/server/src/merge-duplicate-user.js`
Script npm: `users:merge-duplicate` (`@zentofact/server`)
Pruebas: `merge-duplicate-user.test.js` (unitaria) y
`merge-duplicate-user.integration.test.js` (Postgres desechable local).

## Antes de ejecutar (bloqueante)

1. El release multi-perfil debe estar **autorizado, mergeado en `main` y
   desplegado en Railway producción**. El script aborta si no existe la tabla
   `user_roles` (estado monoperfil actual de producción).
2. No ejecutar la consolidación antes de ese release. No hay consolidación
   parcial.
3. La cadena de conexión viene del entorno (`DATABASE_URL_POSTGRES`, o
   `DATABASE_URL` no sqlite). Nunca se embeben credenciales ni se imprimen.
   La salida solo muestra host y nombre de base de datos.

## Caso verificado

| Rol | id | email |
|---|---|---|
| Conservar (admin) | `lv4GATBWIJ7j6dPLIEDEIL8aIcDjpD67` | `jcalfarosanchez@gmail.com` |
| Duplicada (vendedor, se elimina) | `z1d1D7R2qGFTVxGzkt8NcBd0PGdQ8CSi` | `jcalfarosanchz@gmail.com` |

El caso está embebido en `DUPLICATE_USER_CASES.julio` y se puede sobreescribir
con `--keep-id/--keep-email/--dup-id/--dup-email`.

## Comandos

Dry-run (por defecto; abre la transacción, valida el plan exacto y revierte, sin
persistir nada):

```bash
DATABASE_URL_POSTGRES="<prod-url>" \
  npm run users:merge-duplicate -w @zentofact/server -- --case julio
```

Aplicar (opt-in explícito; confirma la transacción):

```bash
DATABASE_URL_POSTGRES="<prod-url>" \
  npm run users:merge-duplicate -w @zentofact/server -- --case julio --apply
```

Argumentos explícitos equivalentes:

```bash
DATABASE_URL_POSTGRES="<prod-url>" \
  npm run users:merge-duplicate -w @zentofact/server -- \
    --keep-id lv4GATBWIJ7j6dPLIEDEIL8aIcDjpD67 --keep-email jcalfarosanchez@gmail.com \
    --dup-id z1d1D7R2qGFTVxGzkt8NcBd0PGdQ8CSi --dup-email jcalfarosanchz@gmail.com --apply
```

## Garantías dentro de una única transacción

- Advisory lock de administración `917204` (mismo que `users.js`) y
  `SELECT ... FOR UPDATE` sobre las filas de usuario.
- Confirmación de identidad: email exacto de ambas cuentas; la cuenta conservada
  debe estar activa y pertenecer a `admin`/`superadmin`; la duplicada debe ser
  `vendedor` y no tener perfiles administrativos ni perfiles extra.
- Agrega `vendedor` a la cuenta conservada con
  `INSERT ... ON CONFLICT (user_id, role) DO NOTHING`, preservando sus roles,
  grants, contraseña, email y `user.role` (admin). Solo la membresía nueva se
  inserta.
- Reasigna `orders.created_by` de la duplicada a la conservada. No toca
  `updated_at`, estado, importes ni `order_events`.
- Elimina la cuenta duplicada: `session`, `account`, `user_roles` y `user`. La
  autenticación y las membresías de la identidad borrada no sobreviven.
- Revoca las sesiones de la cuenta conservada solo si sus grants cambiaron.
- Audita `user.merge` (actor `NULL`) con `source`, `target`, emails, ids y
  números de ventas movidas, membresías antes/después, referencias conservadas y
  sesiones revocadas. Nunca registra contraseñas ni hashes.
- Valida dentro de la transacción y hace postread: la conservada queda
  admin+vendedor y activa, la duplicada ya no existe, hay 0 ventas bajo la
  duplicada, todas las ventas quedaron bajo la conservada y
  `listActiveSalespeople` incluye a la conservada (admin+vendedor) y ya no a la
  duplicada.
- Idempotente: si la duplicada ya fue consolidada y borrada, una nueva corrida
  es no-op, no inserta auditoría y no modifica nada. Si algo falla, `ROLLBACK`
  total.

## Referencias a `user.id` (estrategia explícita)

La revisión es dinámica: se descubren las FK reales hacia `"user"(id)` y todas
las columnas candidatas (`user_id`, `created_by`, `updated_by`, `actor_id`,
`actor_user_id`, `target_id`, `owner_id`, `assigned_to`, `created_by_user`).

| Columna | Estrategia |
|---|---|
| `orders.created_by` | reassign → cuenta conservada |
| `user_roles.user_id`, `operator_notifications.user_id`, `operator_notification_state.user_id` | delete |
| `order_events.actor_user_id`, `inventory_movements.actor_user_id`, `inventory_transfers.actor_user_id`, `product_return_incidents.actor_user_id`, `products.created_by/updated_by`, `insumos.created_by/updated_by`, `insumo_movements.actor_user_id`, `system_settings.updated_by`, `user_audit_log.actor_id/target_id` | preserve (hecho histórico intacto) |
| FK real `account.userId`, `session.userId` | `ON DELETE CASCADE` (estado de auth) |

Reglas de aborto: cualquier FK real hacia `"user"(id)` que no sea `CASCADE` o
`SET NULL`, o cualquier columna blanda con filas y sin política, **bloquea** el
borrado y se reporta. Los hechos históricos nunca se borran ni se reescriben:
las referencias blandas se conservan como procedencia (no se anulan con
`SET NULL`, que perdería actor) y las FK que pudieran borrar historia se
detienen.
