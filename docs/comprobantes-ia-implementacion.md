# Comprobantes — Documento de implementación

**Producto:** ZentoFact
**Estado:** Implementado (pendiente smoke manual por rol)
**Fecha:** 2026-07-21

---

## 1. Objetivo

Reorganizar la IA de comprobantes electrónicos (CPE) para que:

1. **Boletas**, **facturas** y **notas de crédito** se consulten como listados hermanos bajo **Comprobantes**.
2. Cada tipo tenga **pantalla propia** (sin tabs B/F).
3. La **anulación masiva** sea un **menú propio** (feature especial), no el home de NC.
4. Las rutas estén en **inglés**.
5. El sidebar use **grupos visuales**.

---

## 2. Decisiones cerradas

| # | Decisión | Valor |
|---|----------|--------|
| D1 | Boletas y facturas | Menús y pantallas **separadas** |
| D2 | Notas de crédito en Comprobantes | **Sí**, como **listado** igual a B/F |
| D3 | Anulación masiva | **Menú propio**, no anidado como única entrada a NC |
| D4 | Tabs B/F en una sola pantalla | **Eliminar** |
| D5 | Toggle B/F al crear | **Eliminar** — tipo fijo por ruta |
| D6 | Rutas | **Inglés** |
| D7 | Grupo visual sidebar | **Sí** — Comprobantes (+ Operación / Configuración) |
| D8 | Operator hace batch | **Sí** |
| D9 | Viewer ve listados B/F/NC | **Sí** |
| D10 | Viewer hace anulación masiva | **No** |
| D11 | Emitir NC unitaria | Desde **listado de boletas** (preferido) + Falabella (ya existe) |
| D12 | NC de facturas | **Fuera de alcance** (schema solo `affectedBoletaId`) |
| D13 | Crear NC “en blanco” | **No** — solo desde boleta aceptada o batch |
| D14 | Periodo de consulta | Date range de shadcn; por defecto desde el primer día del mes hasta hoy en Lima |
| D15 | Viewer | Controles de mutación ocultos y POST bloqueado en API |
| D16 | Empresas para selectores | `GET /companies` para usuarios autenticados; mutaciones conservan `companies` |

---

## 3. Menú objetivo (UI)

```
── (sin label o “Operación”) ──────────────
Dashboard
Bandeja de pedidos
Falabella
Productos                          ← oculto en prod (como hoy)

── Comprobantes ───────────────────────────
Boletas
Facturas
Notas de crédito                   ← LISTADO
Automatización

Anulación masiva                   ← menú propio (feature)

── Configuración ──────────────────────────
Empresas
Usuarios
Ajustes
```

### Labels exactos (español UI)

| Ítem | Label menú | Subtítulo header |
|------|------------|------------------|
| Boletas | Boletas | Gestiona las boletas emitidas y su estado en SUNAT. |
| Facturas | Facturas | Gestiona las facturas emitidas y su estado en SUNAT. |
| Notas de crédito | Notas de crédito | Consulta notas de crédito emitidas (anulación de boletas). |
| Anulación masiva | Anulación masiva | Anula boletas por mes y empresa emitiendo NC en lote. |

### Grupo “Comprobantes”

- Solo visible si el usuario tiene al menos un permiso de los ítems del grupo.
- En sidebar colapsado: solo iconos (sin título de grupo).
- “Anulación masiva” puede ir **fuera** del bloque Comprobantes (debajo) o **dentro** como último ítem del grupo.
  **Recomendación de implementación:** dentro del grupo Comprobantes, al final, para no perderse; visualmente igual de “menú propio” (ítem hermano, no submenú).

---

## 4. Rutas (inglés)

| Ruta | Pantalla | Permiso SPA |
|------|----------|-------------|
| `/boletas` | Listado boletas | `documentos` |
| `/boletas/new` | Crear boleta (tipo fijo `03`) | `documentos` |
| `/facturas` | Listado facturas | `documentos` |
| `/facturas/new` | Crear factura (tipo fijo `01`) | `documentos` |
| `/credit-notes` | **Listado** NC | `documentos` |
| `/credit-notes/bulk` | Anulación masiva (wizard actual) | `credit_notes` |

### Redirects legacy (compat bookmarks / deep-links)

| Desde | Hacia |
|-------|--------|
| `/documentos` | `/boletas` |
| `/documentos?tab=boletas&days=N` | `/boletas?from=YYYY-MM-DD&to=YYYY-MM-DD` |
| `/documentos?tab=facturas&days=N` | `/facturas?from=YYYY-MM-DD&to=YYYY-MM-DD` |
| `/documentos/nuevo` | `/boletas/new` |
| `/documentos/nuevo?tipo=boleta` | `/boletas/new` |
| `/documentos/nuevo?tipo=factura` | `/facturas/new` |
| `/individual-invoice` | `/boletas/new` |
| `/credit-notes` **si hoy era bulk** | El **listado** pasa a ser `/credit-notes`; el bulk viejo se mueve a `/credit-notes/bulk`. Quien tenía bookmark al batch debe actualizar a `/credit-notes/bulk`. Opcional: detectar query legacy y redirigir. |

### Query params listados (comunes)

| Param | Valores | Default |
|-------|---------|---------|
| `from` | Fecha `YYYY-MM-DD` | Primer día del mes actual |
| `to` | Fecha `YYYY-MM-DD` | Hoy en `America/Lima` |

Sin `tab` (ya no hay tabs).

### Deep-links a actualizar en código existente

| Archivo / origen | Hoy | Nuevo |
|------------------|-----|--------|
| `FalabellaApi.tsx` | `navigate('/documentos?tab=facturas&days=7')` | `navigate('/facturas')` |
| `IndividualInvoice` post-emit | `/documentos` | `/boletas` o `/facturas` según tipo |
| Cualquier link a “Documentos” | `/documentos` | ruta del tipo |

---

## 5. Permisos

### Keys (sin renombrar keys en DB por ahora)

| Key | Label en Users (nuevo) | Descripción (nuevo) | Path default |
|-----|------------------------|---------------------|--------------|
| `documentos` | Comprobantes | Ver y emitir boletas/facturas; ver notas de crédito | `/boletas` |
| `credit_notes` | Anulación masiva | Anular boletas en lote con notas de crédito | `/credit-notes/bulk` |

**No** se crean keys nuevas en v1 (`boletas`, `facturas` separados) para no migrar roles guardados.

### Matriz por rol

| Rol | `documentos` | `credit_notes` | Efecto UI |
|-----|--------------|----------------|-----------|
| viewer | ✅ | ❌ | Ve B, F, NC listado. No ve Anulación masiva ni controles de emisión/reintento; los POST están bloqueados en API. |
| operator | ✅ | ✅ | Todo operación + bulk |
| admin / superadmin | ✅ | ✅ | Todo |

### SPA `pathPermission`

```
/boletas*            → documentos
/facturas*           → documentos
/credit-notes/bulk*  → credit_notes     // más específico primero
/credit-notes*       → documentos       // listado NC
/documentos*         → documentos       // legacy hasta redirect
/individual-invoice* → documentos
```

### API server (crítico)

Hoy todo `/credit-notes` exige `credit_notes` → **viewer no puede listar NC**.

**Cambio requerido:**

| Método / ruta API | Permiso |
|-------------------|---------|
| `GET /credit-notes` | `documentos` **o** `credit_notes` |
| `GET /credit-notes/:id/preview` | `documentos` **o** `credit_notes` |
| `POST /credit-notes` | `credit_notes` |
| `POST /credit-notes/batch` | `credit_notes` |

Implementación sugerida: middleware custom en prefijo `/credit-notes` que ramifica por método (GET vs POST), en lugar del `moduleGuards` único actual.

Implementación final: guards explícitos por endpoint con `requireAnyPermission`. El prefijo `/credit-notes` se retiró de `moduleGuards` para que una regla amplia no invalide los permisos específicos.

Las mutaciones de boletas y todas las rutas de facturas siguen con `documentos`; el listado de boletas admite además `credit_notes` para soportar el batch.

### Lecturas auxiliares para los flujos

| Método / ruta API | Permiso |
|-------------------|---------|
| `GET /companies` | Cualquier usuario autenticado (DTO público sin secretos) |
| `GET /companies/:id/branches` | `documentos` o `companies` |
| `GET /branches/:id/correlatives` | `documentos` o `companies` |
| `GET /boletas` | `documentos` o `credit_notes` |
| Mutaciones de empresas/sucursales | `companies` |

### Catálogo Users (web + server)

Actualizar labels/descriptions en:

- `packages/web/src/lib/permissions.ts`
- `packages/server/src/permissions.js`

---

## 6. Pantallas

### 6.1 Listado compartido B / F (`Documentos` refactor)

**Componente:** reutilizar `packages/web/src/routes/Documentos.tsx` como listado parametrizado:

```ts
type DocumentKind = 'boletas' | 'facturas'
export default function Documentos({ kind }: { kind: DocumentKind })
```

**Rutas App:**

```tsx
<Route path="/boletas" element={<Documentos kind="boletas" />} />
<Route path="/facturas" element={<Documentos kind="facturas" />} />
```

**UI listado (paridad):**

- Select empresa con **Todas las empresas** como valor inicial
- Búsqueda: número, orden, cliente
- Presets **Este mes / 30 días / 90 días** + date range shadcn de dos meses; por defecto **Este mes**
- Botón primario: **Nueva boleta** | **Nueva factura** → `/boletas/new` | `/facturas/new`
- Tabla: Número | Fecha | Cliente | Total | Estado | Acciones
- Resumen consolidado: barras monetarias apiladas por empresa en vista global y por fecha en vista individual (aceptado, no aceptado y anulado), emitidas, no aceptadas, monto aceptado y empresas con movimiento
- Acciones:
  - `ACEPTADO`: Ver (preview) + PDF
  - `RECHAZADO`: Reintentar (reemit)
  - Boleta `ACEPTADO` **sin** NC y user con `credit_notes`: **Emitir NC** (ver §7)
- Empty / loading / sin empresa: mismos patrones actuales
- **Sin tabs** de tipo

**APIs:** `listBoletas` / `listFacturas`, preview, pdf, reemit. Los listados traducen `from`/`to` a `fechaDesde`/`fechaHasta` para filtrar antes de aplicar el límite de 500 registros.

---

### 6.2 Listado NC (`CreditNotesList` nuevo)

**Archivo nuevo:** `packages/web/src/routes/CreditNotesList.tsx`
**Ruta:** `/credit-notes`
**Permiso:** `documentos`

**Misma UX que B/F:**

- Select empresa con **Todas las empresas** como valor inicial
- Búsqueda
- Presets **Este mes / 30 días / 90 días** + date range shadcn de dos meses; por defecto **Este mes**
- **Sin** botón “Nueva NC” (no aplica)
- **Sin** botón de anulación masiva en toolbar (eso es menú propio)
- Resumen consolidado: barras monetarias apiladas por empresa en vista global y por fecha en vista individual (aceptado, no aceptado y anulado), NC emitidas, no aceptadas, monto anulado aceptado y empresas con anulaciones
- Tabla:

| Columna | Fuente |
|---------|--------|
| Número NC | `numeroCompleto` |
| Fecha | `fechaEmision` |
| Doc. afectado | `affectedBoletaNumeroCompleto` / `numDocAfectado` + orden si hay |
| Motivo | `codMotivo` · `desMotivo` (puede ir bajo doc. afectado) |
| Cliente | `clientRazonSocial` / `clientNumeroDocumento` |
| Total | `mtoImpVenta` |
| Estado | `estadoSunat` |
| Acciones | Ver preview si hay HTML |

**API:** `GET /credit-notes?companyId=&fechaDesde=&fechaHasta=&limit=500` → `listCreditNotes`
**Preview:** `GET /credit-notes/:id/preview`

**Empty state copy:**
“No hay notas de crédito para mostrar. Se emiten al anular boletas aceptadas o con Anulación masiva.”

---

### 6.3 Crear boleta / factura (`IndividualInvoice`)

**Archivo:** `packages/web/src/routes/IndividualInvoice.tsx`

**Cambio:**

```ts
export default function IndividualInvoice({ fixedDocType }: { fixedDocType: '03' | '01' })
```

- Eliminar toggle Boleta/Factura
- Badge fijo: `Boleta B03` | `Factura F01`
- Back: → `/boletas` | `/facturas`
- Post-emit navigate: → `/boletas` | `/facturas`

**Rutas:**

```tsx
/boletas/new  → <IndividualInvoice fixedDocType="03" />
/facturas/new → <IndividualInvoice fixedDocType="01" />
```

---

### 6.4 Anulación masiva (`CreditNotes` actual)

**Archivo:** `packages/web/src/routes/CreditNotes.tsx` (sin reescribir lógica)
**Nueva ruta:** `/credit-notes/bulk`
**Permiso:** `credit_notes`
**Menú:** “Anulación masiva”

Incluye flujo Shared RUC si ya está embebido.

**Opcional UX v1.1:** link “Ver notas emitidas” → `/credit-notes`.

---

## 7. Emitir NC desde listado de boletas

### Condiciones del botón “Emitir NC”

- Fila boleta con `estadoSunat === 'ACEPTADO'`
- No tiene NC asociada (`!creditNoteId` — ya viene en `listBoletas` join)
- Usuario `can('credit_notes')`
- No mostrar a viewer

### Flujo

1. Click **Emitir NC**
2. Confirmación simple (dialog):
   “Se emitirá una nota de crédito que anula la boleta {numero}. ¿Continuar?”
3. `POST /credit-notes` con `{ boletaId }` (`api.createAndSendCreditNote`)
4. Toast / mensaje éxito o error
5. Refresh listado boletas
6. Opcional: link “Ver NC” → `/credit-notes`

La UI deshabilita la acción durante el envío. Si otro proceso ya creó la NC, la API responde `409 Conflict`; el listado se refresca para mostrar el estado real. Una respuesta HTTP exitosa con `success: false` se trata como rechazo de SUNAT, no como éxito visual.

**Motivo default:** el del backend actual (`01` / anulación de la operación).

**Fuera de v1:** modal de motivo editable (puede copiarse de Falabella después).

---

## 8. Sidebar

**Archivo:** `packages/web/src/components/Sidebar.tsx`

### Estructura de datos sugerida

```ts
type NavItem = {
  to: string
  icon: LucideIcon
  img?: string
  label: string
  permission: PermissionKey
}

type NavGroup = {
  id: string
  label?: string          // undefined = sin título
  items: NavItem[]
}

const navGroups: NavGroup[] = [
  {
    id: 'ops',
    items: [
      { to: '/dashboard', label: 'Dashboard', permission: 'dashboard', ... },
      { to: '/pedidos', label: 'Bandeja de pedidos', permission: 'falabella', ... },
      { to: '/falabella-api', label: 'Falabella', permission: 'falabella', ... },
      { to: '/productos', label: 'Productos', permission: 'productos', ... },
    ],
  },
  {
    id: 'comprobantes',
    label: 'Comprobantes',
    items: [
      { to: '/boletas', label: 'Boletas', permission: 'documentos', icon: ReceiptText },
      { to: '/facturas', label: 'Facturas', permission: 'documentos', icon: FileText },
      { to: '/credit-notes', label: 'Notas de crédito', permission: 'documentos', icon: FileMinus2 },
      { to: '/auto-emision', label: 'Automatización', permission: 'auto_emision', icon: Zap },
      { to: '/credit-notes/bulk', label: 'Anulación masiva', permission: 'credit_notes', icon: Shuffle },
    ],
  },
  {
    id: 'config',
    label: 'Configuración',
    items: [
      { to: '/companies', label: 'Empresas', permission: 'companies', ... },
      { to: '/users', label: 'Usuarios', permission: 'users', ... },
      { to: '/settings', label: 'Ajustes', permission: 'settings', ... },
    ],
  },
]
```

### Active state

- Match exacto o `pathname.startsWith(to + '/')`.
- **Cuidado:** `/credit-notes` no debe activar cuando estás en `/credit-notes/bulk`.
- Para el listado usar `pathname === '/credit-notes'`; `pathname` no contiene query params.
- Para bulk usar `pathname.startsWith('/credit-notes/bulk')`.

### Visibilidad

- Filtrar ítems por `can(permission)`
- Ocultar grupo si `items` visibles = 0
- Productos: ocultar en `PROD` (como hoy)

---

## 9. App.tsx — rutas y meta

### `routeMeta`

| path | title | subtitle |
|------|-------|----------|
| `/boletas` | Boletas | Gestiona las boletas emitidas y su estado en SUNAT. |
| `/boletas/new` | Nueva boleta | Emite una boleta electrónica a SUNAT. |
| `/facturas` | Facturas | Gestiona las facturas emitidas y su estado en SUNAT. |
| `/facturas/new` | Nueva factura | Emite una factura electrónica a SUNAT. |
| `/credit-notes` | Notas de crédito | Consulta notas de crédito emitidas. |
| `/credit-notes/bulk` | Anulación masiva | Anula boletas por mes y empresa emitiendo NC en lote. |

Header: resolver meta con match del path más específico (`/credit-notes/bulk` antes que `/credit-notes`).

### Routes (orden sugerido)

```
/ → HomeRedirect
/dashboard
/pedidos
/companies
/workflow → /falabella-api
/falabella-api
/productos
/auto-emision
/boletas
/boletas/new
/facturas
/facturas/new
/credit-notes                    → CreditNotesList + documentos
/credit-notes/bulk               → CreditNotes + credit_notes
/documentos → Navigate boletas (o helper que lea tab)
/documentos/nuevo → helper tipo
/individual-invoice → /boletas/new
/users
/settings
```

---

## 10. Archivos a tocar

| Archivo | Acción |
|---------|--------|
| `packages/web/src/components/Sidebar.tsx` | Grupos + 4 ítems comprobantes |
| `packages/web/src/App.tsx` | Rutas, meta, redirects |
| `packages/web/src/lib/permissions.ts` | labels, pathPermission, first path `/boletas` |
| `packages/server/src/permissions.js` | labels, pathPermission (si aplica SPA no; alinear catálogo) |
| `packages/server/src/index.js` | Guard GET/POST credit-notes |
| `packages/web/src/routes/Documentos.tsx` | `kind` fijo, sin tabs, rutas new, Emitir NC en boletas |
| `packages/web/src/routes/CreditNotesList.tsx` | **Crear** listado NC |
| `packages/web/src/routes/CreditNotes.tsx` | Solo cambiar de ruta (bulk); copy header vía App |
| `packages/web/src/routes/IndividualInvoice.tsx` | `fixedDocType`, sin toggle |
| `packages/web/src/routes/FalabellaApi.tsx` | deep-link facturas |
| `docs/comprobantes-ia-implementacion.md` | Este documento |

**No tocar en v1:** schema DB, servicios core de emisión, batch logic, Shared RUC.

---

## 11. Plan de implementación (orden)

### Fase 0 — Documento (este) ✅

### Fase 1 — Rutas y shell

1. Actualizar `permissions` web + server (labels + `pathPermission`).
2. Actualizar guard API credit-notes (GET vs POST).
3. Cablear `App.tsx` rutas + redirects + `routeMeta`.
4. Sidebar con grupos.

**Criterio done:** navegar menú sin 403; viewer ve listados; operator ve bulk.

### Fase 2 — Listados B y F

1. Refactor `Documentos` con `kind`.
2. Quitar tabs.
3. Botones y create paths `/boletas/new`, `/facturas/new`.

**Criterio done:** listar/filtrar/PDF/reemit en rutas nuevas.

### Fase 3 — Create fijo

1. `IndividualInvoice` con `fixedDocType`.
2. Redirects legacy create.

**Criterio done:** emitir boleta y factura sin poder cambiar tipo en UI.

### Fase 4 — Listado NC

1. Crear `CreditNotesList`.
2. Mover bulk a `/credit-notes/bulk`.
3. `/credit-notes` = listado.

**Criterio done:** ver NC emitidas con preview; bulk sigue funcionando en nueva ruta.

### Fase 5 — Emitir NC desde boletas

1. Botón + confirm + API + refresh.
2. Solo `credit_notes` + boleta aceptada sin NC.

**Criterio done:** anular una boleta desde su listado.

### Fase 6 — Limpieza

1. Falabella deep-links.
2. Smoke manual roles viewer / operator.
3. Revisar copy Users.

---

## 12. Criterios de aceptación (checklist QA)

- [x] Menú muestra grupo **Comprobantes** con Boletas, Facturas, Notas de crédito.
- [x] **Anulación masiva** es ítem de menú propio (permiso `credit_notes`).
- [x] No existen tabs Boletas|Facturas en una sola pantalla.
- [x] `/boletas` solo muestra boletas; `/facturas` solo facturas.
- [x] `/credit-notes` lista NC (no el wizard de batch).
- [x] `/credit-notes/bulk` es el wizard actual.
- [x] Crear boleta no permite cambiar a factura (y viceversa).
- [x] Viewer: ve B/F/NC; no ve Anulación masiva; POST bloqueado.
- [x] Operator: bulk + Emitir NC en boleta aceptada.
- [x] Legacy `/documentos` redirige sin romper bookmarks básicos.
- [x] Falabella link a facturas usa `/facturas`.
- [x] Preview NC funciona en listado.
- [ ] Smoke manual con usuarios reales viewer/operator/admin.

---

## 13. Fuera de alcance (explícito)

- NC que afecte **facturas**
- Notas de débito / guías de remisión
- Unificar tablas en un `documents` polimórfico
- Permisos separados `boletas` | `facturas` | `notas_credito` (keys)
- PDF download NC (si no hay endpoint listo; preview sí)
- Stats/KPIs de NC en dashboard
- Rediseño visual del wizard de anulación masiva
- i18n

---

## 14. Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|------------|
| Viewer 403 al listar NC (API) | Guard GET con `documentos` \| `credit_notes` |
| Active nav confunde list vs bulk | Match path estricto para `/credit-notes` |
| Bookmarks al batch viejo en `/credit-notes` | Doc + opcional redirect si hay query legacy; comunicar `/credit-notes/bulk` |
| Doble NC en misma boleta | Backend unique `affectedBoletaId`; UI oculta botón si `creditNoteId` |
| Operator sin `credit_notes` custom | Preset operator incluye la key; users custom hay que revisar |

---

## 15. Resumen ejecutivo

| Antes | Después |
|-------|---------|
| Un menú “Boletas y facturas” con tabs | **Boletas** y **Facturas** separados |
| “Notas de crédito” = batch | **Notas de crédito** = listado en Comprobantes |
| Batch escondido como si fuera el módulo NC | **Anulación masiva** = menú propio |
| Rutas `/documentos`, mixto | `/boletas`, `/facturas`, `/credit-notes`, `/credit-notes/bulk` |
| NC solo visible en batch/Falabella | NC consultable como cualquier CPE |

---

## 16. Estado de implementación

Implementación realizada como cambio atómico de IA para evitar estados intermedios incompatibles entre frontend y backend.

Validaciones automatizadas requeridas:

1. Typecheck web antes de cada build de producción.
2. Pruebas de catálogo, resolución de paths y guards con permisos alternativos.
3. Build web de producción.
4. Smoke manual final con viewer, operator y admin antes de desplegar.
