# Catálogo de seguridad (post revisión profunda 2026-07-10)

Fuente: [SECURITY_DEEP_REVIEW.md](SECURITY_DEEP_REVIEW.md).  
Los IDs **DR-*** son de la revisión profunda. Se mantienen referencias a SEC antiguos donde aplica.

## Estado global

| Bloque | Estado |
| --- | --- |
| Auth, CSRF, jerarquía usuarios, secretos fuera del browser, workflow sin cert/SOL del cliente | **Cerrado** |
| Hallazgos DR-001 … DR-008 | **Activos — prioridad** |
| DR-009 … DR-022 | **Activos — hardening** |
| DR-023 … DR-027 | **Mejoras de escala / calidad** (no bloquean el modelo actual de pocos usuarios) |

---

## Cerrado (verificado 2026-07-10)

| ID | Tema |
| --- | --- |
| ~~SEC-001~~ | DTO público de empresas; sin secretos en HTTP |
| ~~SEC-002~~ | Sin secretos en localStorage; limpieza en logout |
| ~~SEC-003~~ | Workflow no acepta/persiste cert ni clave SOL del cliente |
| — | CSRF (Origin + token HMAC timing-safe) |
| — | Viewer solo lectura; permiso `users` solo admin |
| — | Revocación de sesiones al cambiar privilegios/password |
| — | `npm audit`: 0 vulnerabilidades |

---

## Activos — prioridad alta

### [x] DR-001 — Webhook Falabella inseguro (ex SEC-007)
**Estado:** resuelto (2026-07-10).

- Secreto **por empresa** en `auto_emission_config.webhook_secret` (DB), no env global.
- Fail-closed: sin secret de esa empresa → 401.
- Solo POST; GET → 405.
- Token en path: `/webhooks/falabella/:companyId/:token` (comparación timing-safe).
- Legacy: header `x-webhook-secret` o `?secret=` solo si coincide con el secret de **esa** empresa.
- UI no muestra el token; listados de Falabella se redactan.

**Migración:** recrear webhooks en Falabella por empresa (Crear en Automatización). Se puede borrar `AUTO_EMIT_WEBHOOK_SECRET` del env.

### [ ] DR-002 — Lectura arbitraria por `pdfPath` (ex SEC-006)
`readFileSync(payload.pdfPath)` en upload de PDF a Falabella.  
**Archivos:** `packages/core/src/services/falabella.service.ts`

### [ ] DR-003 — `outputDir` del cliente pisa `STORAGE_PATH` global
`process.env.STORAGE_PATH = config.outputDir` en workflow → path de escritura y race entre requests.  
**Archivos:** `packages/core/src/workflow.ts`, `packages/server/src/index.js`

### [ ] DR-004 — Path traversal / segmentos sin contención (ex SEC-011)
Serie, correlativo, RUC, numeroCompleto en keys de archivo sin sanitizado uniforme ni `resolve` dentro de `STORAGE_PATH`.  
**Archivos:** `packages/core/src/services/file.service.ts`

### [ ] DR-005 — NC: `modoProduccion` y `usuarioCreacion` del cliente (ex SEC-010)
Puede forzar ambiente SUNAT y falsificar identidad de auditoría.  
**Archivos:** `packages/core/src/services/credit-note.service.ts`

### [x] DR-006 — `callbackUrl` arbitrario al crear webhook Falabella
**Estado:** resuelto (2026-07-10). El servidor ignora `callbackUrl` del cliente y registra siempre la URL interna con token de la empresa.

### [ ] DR-007 — Sin límites de body / lotes / `auto-emit` limit (ex SEC-012)
DoS y abuso de recursos (CPU, memoria, APIs externas).  
**Archivos:** `packages/server/src/index.js`, workflow, auto-emission

### [ ] DR-008 — Rate limit de login / secret de auth no endurecidos (ex SEC-008)
Rate limit de Better Auth no forzado explícitamente; fallback `dev-secret-change-me` si no hay secret fuera de `NODE_ENV=production`.  
**Archivos:** `packages/server/src/auth.js`, config Railway

---

## Activos — hardening medio

| ID | Tema | Ex |
| --- | --- | --- |
| [ ] DR-009 | URLs firmadas Falabella (`UserID`+`Signature`) al navegador | SEC-014 |
| [ ] DR-010 | Cabeceras HTTP (CSP, HSTS, …) | SEC-015 |
| [ ] DR-011 | `srcDoc` sin sandbox (IndividualInvoice, FalabellaApi) | SEC-016 |
| [ ] DR-012 | Secretos en texto plano en PostgreSQL | SEC-013 |
| [ ] DR-013 | Bootstrap permanente `AUTH_SUPERADMIN_EMAIL` | SEC-021 |
| [ ] DR-014 | min password Better Auth vs CRUD (8 vs 12) | SEC-020 |
| [ ] DR-015 | Vite Preview + `allowedHosts: true` en prod | SEC-024 |
| [ ] DR-016 | Retención de `webhook_events.raw` | SEC-019 |
| [ ] DR-017 | Puppeteer `--no-sandbox` | SEC-017 |
| [ ] DR-018 | `.env` local `0644` | SEC-023 |
| [ ] DR-019 | R2 proxy: keys arbitrarias; bearer no timing-safe | — |
| [ ] DR-020 | Auditoría incompleta (solo usuarios) | SEC-018 |
| [ ] DR-021 | `e.message` crudo al cliente | — |
| [ ] DR-022 | localhost siempre en orígenes trusted | — |

---

## Mejoras de escala (no pendientes de seguridad del modelo actual)

| ID | Tema | Ex |
| --- | --- | --- |
| DR-023 | Membresías usuario–empresa | SEC-004 |
| DR-024 | Permisos granulares / preset operator | SEC-005 |
| DR-025 | Schemas estrictos de documentos fiscales | SEC-009 |
| DR-026 | Limpieza de sesiones expiradas | SEC-022 |
| DR-027 | Suite de pruebas de seguridad HTTP | — |

**Decisión de producto (vigente):** con pocos usuarios de confianza bastan permisos por módulo; membresías (DR-023) se implementan al crecer operadores por seller.

---

## Orden de implementación sugerido

1. DR-001 + DR-006 (webhook)  
2. DR-002 + DR-003 + DR-004 (filesystem)  
3. DR-005 (notas de crédito)  
4. DR-007 + DR-008 (límites y auth rate limit)  
5. DR-009 … DR-022 según esfuerzo  
6. DR-023+ solo con necesidad de multi-usuario por empresa  

---

## Mapa rápido ID antiguo → nuevo

| Antiguo | Nuevo / estado |
| --- | --- |
| SEC-001 | Cerrado |
| SEC-002 | Cerrado |
| SEC-003 | Cerrado |
| SEC-004 | DR-023 (mejora escala) |
| SEC-005 | DR-024 (mejora escala) |
| SEC-006 | DR-002 |
| SEC-007 | DR-001 |
| SEC-008 | DR-008 |
| SEC-009 | DR-025 |
| SEC-010 | DR-005 |
| SEC-011 | DR-004 |
| SEC-012 | DR-007 |
| SEC-013 | DR-012 |
| SEC-014 | DR-009 |
| SEC-015 | DR-010 |
| SEC-016 | DR-011 |
| SEC-017 | DR-017 |
| SEC-018 | DR-020 |
| SEC-019 | DR-016 |
| SEC-020 | DR-014 |
| SEC-021 | DR-013 |
| SEC-022 | DR-026 |
| SEC-023 | DR-018 |
| SEC-024 | DR-015 |
| — | DR-003, DR-006, DR-019, DR-021, DR-022 (nuevos en revisión profunda) |
