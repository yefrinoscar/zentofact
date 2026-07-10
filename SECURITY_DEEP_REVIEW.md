# Revisión de seguridad profunda

**Fecha:** 2026-07-10  
**Método:** revisión estática del código en `packages/server`, `packages/core`, `packages/web`, `packages/falabella-api`, `r2-proxy`; comprobación de configuración local (nombres de variables y permisos de `.env`); `npm audit`.  
**No se** explotó producción ni se leyeron valores de secretos.

## Resumen ejecutivo

El programa de **auth + secretos al navegador + inyección de credenciales en workflow** sigue **cerrado y verificado**. CSRF, jerarquía de usuarios, DTO público de empresas y carga de secretos en servidor para emisión están en buen estado.

La revisión a fondo encontró **hallazgos técnicos reales** que no son “membresías multi-usuario”: sobre todo **webhook público**, **lectura de archivos por path del cliente**, **control del directorio de storage desde el body del workflow**, y **influencia del cliente en notas de crédito / ambiente**.

Con **pocos usuarios de confianza**, el riesgo práctico baja (hace falta sesión o mala configuración). Aun así no son solo “mejoras de producto”: son **defectos de diseño defensivo**.

| Área | Estado |
| --- | --- |
| Dependencias npm | 0 vulnerabilidades (`npm audit`) |
| Secretos en HTTP de empresas | OK (DTO público) |
| Secretos en localStorage | OK (no se cachean; logout limpia) |
| Workflow sin secretos del cliente | OK |
| CSRF + origen confiable | OK |
| RBAC usuarios / viewer | OK |
| Webhook Falabella | **Riesgo alto** (fail-open + secreto en URL) |
| Filesystem (`pdfPath`, `outputDir`, series) | **Riesgo alto** |
| Notas de crédito (ambiente / identidad) | **Riesgo alto** |
| Rate limit / límites de body | **Riesgo alto / medio** |
| Membresía por empresa | Mejora de escala (aceptada) |

---

## Controles verificados como correctos

1. **Empresas por HTTP** usan `listPublicCompanies` / `getPublicCompany` / `toPublicCompany`; no serializan `claveSol`, certificado, passwords ni API keys.
2. **Updates de secretos** solo si el valor no vacío (`nonEmptySecret`).
3. **`/workflow/process`** arma config solo con `companyId`, sucursal/serie/output y modo forzado por env; no reenvía cert/SOL.
4. **`ensureSetup`** exige `companyId`, carga empresa de DB y rechaza sin cert/SOL en servidor.
5. **CSRF** en métodos inseguros de rutas protegidas: `Origin` en allowlist + `x-csrf-token` HMAC ligado a sesión, `timingSafeEqual`.
6. **Auth** recarga `role`/`permissions`/`active` en cada request protegida; viewer bloqueado en mutaciones.
7. **Signup** deshabilitado salvo `AUTH_ALLOW_SIGNUP=true` (solo seed).
8. **CRUD usuarios**: jerarquía, último admin/superadmin, revocación de sesiones, auditoría de usuarios.
9. **SQL** de app vía Drizzle / parámetros `$1` en auto-emission (sin concatenar input de usuario en queries revisadas).
10. **HTML de PDF/preview** usa `esc()` para textos de documento.
11. **npm audit:** 0 vulnerabilidades.

---

## Hallazgos activos (verificados en código)

### CRÍTICOS / ALTOS

#### DR-001 — Webhook Falabella fail-open, GET y secreto en query string
**Severidad:** alta  
**Estado:** **resuelto 2026-07-10** — secreto por empresa en DB; POST only; token en path; fail-closed; timing-safe; UI redactada. Ver implementación en `auto-emission.js` + `index.js`.

#### DR-002 — Lectura arbitraria de archivos vía `pdfPath`
**Severidad:** alta  
**Evidencia:** `packages/core/src/services/falabella.service.ts` (~1041–1044); rutas `POST /falabella/upload-invoice-pdf` y `upload-boleta-pdf`

```ts
if (!pdfBase64 && payload.pdfPath) pdfBase64 = readFileSync(payload.pdfPath, { encoding: 'base64' });
```

Cualquier usuario autenticado con permiso `falabella` puede pedir leer **cualquier path legible por el proceso** Node y subirlo (o intentar usarlo como PDF).

**Mitigación correcta:** eliminar `pdfPath` del contrato HTTP; solo `boletaId`/`facturaId` o `pdfBase64` con límites de tamaño y magic bytes PDF.

#### DR-003 — `outputDir` del cliente muta `process.env.STORAGE_PATH`
**Severidad:** alta  
**Evidencia:** `packages/server/src/index.js` (~308–313); `packages/core/src/workflow.ts` (~60)

```ts
process.env.STORAGE_PATH = config.outputDir || 'storage';
```

El body del workflow puede redirigir **todas** las escrituras de XML/PDF/CDR del proceso y genera **condición de carrera** entre requests concurrentes (variable de entorno global).

**Mitigación:** ignorar `outputDir` del cliente; fijar `STORAGE_PATH` solo por configuración de despliegue.

#### DR-004 — Segmentos de path poco saneados en archivos fiscales
**Severidad:** alta (en combinación con control de serie/nombre)  
**Evidencia:** `packages/core/src/services/file.service.ts`

- XML/CDR de boletas usan `document.serie` y `document.correlativo` en el path **sin** `sanitizeFilename`.
- Resumenes usan `companyRuc` y `numeroCompleto` en el filename.
- `path.join(STORAGE_PATH, relativeKey)` **no** comprueba contención con `path.resolve` dentro de `STORAGE_PATH`.

Si serie/correlativo/RUC contienen `../` o separadores, hay riesgo de escritura fuera del directorio (path traversal en write).

#### DR-005 — Notas de crédito: ambiente e identidad controlables por el cliente
**Severidad:** alta (fiscal / integridad)  
**Evidencia:** `packages/core/src/services/credit-note.service.ts` (~12–17, ~85, ~115); `POST /credit-notes`

- `options.modoProduccion` puede forzar beta vs producción por encima de la empresa.
- `options.usuarioCreacion` se persiste desde el body (falsificación de auditoría).

**Mitigación:** ambiente solo desde empresa / `SUNAT_FORCE_ENV`; identidad solo desde sesión (`c.get('user')`).

#### DR-006 — Registro de webhook Falabella con `callbackUrl` arbitrario
**Severidad:** alta  
**Estado:** **resuelto 2026-07-10** — el cliente ya no puede elegir `callbackUrl`; el servidor registra solo la URL interna por empresa.

#### DR-007 — Sin límites de body / colas / rate limit de mutaciones costosas
**Severidad:** alta (abuso / DoS)  
**Evidencia:** server Hono sin `bodyLimit`; `pdfBase64` ilimitado; `/auto-emit/run?limit=` sin tope; listados/jobs con `limit` libre; workflow con N ventas sin tope duro.

**Impacto:** agotamiento de memoria/CPU, muchas llamadas a Falabella/SUNAT, colapso del worker de auto-emisión.

#### DR-008 — Rate limit de autenticación no forzado de forma explícita
**Severidad:** alta si `NODE_ENV` ≠ `production` en el API  
**Evidencia:** `packages/server/src/auth.js` — no configura `rateLimit`; Better Auth lo activa por defecto en producción detectada; `BETTER_AUTH_SECRET` cae a `'dev-secret-change-me'` si falta y no es production.

**Mitigación:** `rateLimit.enabled: true` siempre; exigir `BETTER_AUTH_SECRET` siempre en deploy; `NODE_ENV=production` en Railway API.

---

### MEDIOS

#### DR-009 — URLs firmadas de Falabella devueltas al cliente
**Evidencia:** `falabella.service.ts` devuelve `url: response.url` en órdenes/productos/items (incluye `UserID` + `Signature` en query).  
Reduce la vida útil de la firma HMAC expuesta en red/browser/logs del front.

#### DR-010 — Cabeceras de seguridad HTTP ausentes
Sin CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, frame-ancestors en API/front revisados.

#### DR-011 — `srcDoc` sin sandbox en previews
- `Documentos.tsx`: `sandbox=""` (restrictivo) ✓  
- `IndividualInvoice.tsx` y `FalabellaApi.tsx`: **sin** sandbox  

El HTML lo genera el servidor con escape, pero el sandbox es defensa en profundidad si hay regresión XSS en plantillas.

#### DR-012 — Secretos fiscales en texto plano en PostgreSQL
Certificados, claves SOL, API keys de Falabella en columnas de `companies` sin cifrado de aplicación.

#### DR-013 — Bootstrap permanente `AUTH_SUPERADMIN_EMAIL`
Cada arranque puede re-promover el correo configurado a superadmin (`users.js` `ensureUserColumns`).

#### DR-014 — Política de contraseñas inconsistente
CRUD exige 12 caracteres; Better Auth no fija `minPasswordLength` explícito (default típico 8) en flujos directos de auth.

#### DR-015 — Frontend en producción con Vite Preview
`packages/web/railway.json`: `vite preview --host 0.0.0.0`; `vite.config.ts` `preview.allowedHosts: true`.  
No es un servidor estático endurecido (headers, caché, superficie extra).

#### DR-016 — Payloads de webhook sin retención
`webhook_events.raw` guarda JSON completo sin TTL/redacción.

#### DR-017 — Puppeteer con `--no-sandbox`
`pdf.service.ts` — esperado en muchos contenedores, aumenta impacto si hay RCE en render HTML.

#### DR-018 — `.env` local con permisos `0644`
Comprobado en workspace: legible por otros usuarios del sistema. No está en git.

#### DR-019 — Proxy R2: clave arbitraria y comparación de bearer no timing-safe
`r2-proxy/src/index.js`: con el secret se puede PUT/GET/DELETE cualquier key del bucket; sin allowlist de prefijos (`boletas/`, `facturas/`, …).

#### DR-020 — Auditoría incompleta fuera de usuarios
No hay audit trail confiable de cambios de credenciales, emisiones, NC, webhooks (solo `user_audit_log`).

#### DR-021 — Mensajes de error internos al cliente
`fail()` devuelve `String(e.message)` — puede filtrar detalles de stack de negocio/paths.

#### DR-022 — Orígenes localhost siempre en allowlist CORS/CSRF
Aunque el deploy sea producción, `http://localhost:3011` (y similares) permanecen trusted. Riesgo bajo salvo malware local.

---

### BAJOS / MEJORAS DE ESCALA (no incidentes con el modelo actual)

#### DR-023 — Sin membresía usuario–empresa
Permisos solo por módulo. Aceptado con pocos usuarios de confianza. Implementar al crecer operadores por seller.

#### DR-024 — Preset `operator` amplio
Incluye casi todos los módulos excepto `users`. Suficiente hoy; recortar cuando haya perfiles reales.

#### DR-025 — Validación fiscal poco estricta
`validateVentas` mínimo; montos/series/RUC no validados con schema rígido en todos los endpoints.

#### DR-026 — Limpieza de sesiones expiradas
Higiene de tabla `session`, no bypass de auth.

#### DR-027 — Pruebas de seguridad automatizadas incompletas
Hay tests de permisos unitarios; faltan tests HTTP de CSRF, webhook, path traversal, DTO de secretos, etc.

---

## Superficie de ataque mapeada

| Entrada | Auth | Notas |
| --- | --- | --- |
| `/api/auth/*` | Público | Login Better Auth |
| `/webhooks/falabella/:companyId` | Secreto compartido (o abierto) | Emisión automática |
| `/health` | Público | OK |
| Resto API de negocio | Sesión + CSRF en mutaciones + permiso de módulo | |
| `r2-proxy` Worker | Bearer `PROXY_SECRET` | Bucket R2 |
| Front Vite preview | Público estático + API cookies | |

---

## Prioridad de remediación recomendada

1. **DR-001, DR-006** — webhook fail-closed, solo POST, header/HMAC, URL fija sin secret en query.  
2. **DR-002, DR-003, DR-004** — filesystem: quitar `pdfPath`, fijar `STORAGE_PATH`, sanear y contener paths.  
3. **DR-005** — NC: ambiente e identidad solo servidor/sesión.  
4. **DR-007, DR-008** — límites y rate limit explícitos.  
5. Medios (DR-009–022) según esfuerzo.  
6. Escala (DR-023–027) cuando crezca el equipo de usuarios.

---

## Conclusión

No es cierto que “no quede nada de seguridad por revisar”. Lo **cerrado bien** es auth/RBAC de usuarios, CSRF y **no filtrar secretos de empresa al browser ni reinyectarlos por workflow**.

Lo **abierto y verificable** hoy se concentra en:

1. Webhook y su URL con secreto  
2. Filesystem controlado por el cliente (`pdfPath`, `outputDir`, series)  
3. Controles fiscales de NC (ambiente/identidad)  
4. Abuso por falta de límites y rate limiting  

La lista operativa renumerada está en [SECURITY_ISSUES_TO_FIX.md](SECURITY_ISSUES_TO_FIX.md).
