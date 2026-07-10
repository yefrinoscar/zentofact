# Plan de protección de certificados y secretos

Objetivo: conservar las credenciales actuales, dejar de exponerlas al navegador y a operadores, y mantener las operaciones de Falabella y SUNAT disponibles mediante `companyId`.

## Fase 1 — Cortar exposición sin cambiar credenciales

1. Crear un DTO público para `/companies` que devuelva solo datos operativos y estados de configuración:

   ```json
   {
     "id": 42,
     "ruc": "…",
     "razonSocial": "…",
     "hasCertificate": true,
     "hasSolCredentials": true,
     "hasFalabellaCredentials": true
   }
   ```

2. Excluir siempre `certificado`, `certificadoPassword`, `claveSol`, `sellerPassword` y `falabellaApiKey`, incluso de respuestas `POST` y `PATCH`.
3. Eliminar la caché `boletas.falabellaApi.companies` de `localStorage` y cualquier otro almacenamiento del navegador que contenga respuestas de empresas.
4. Permitir a operadores ver solo los datos públicos; restringir la carga o reemplazo de secretos a administradores.

## Fase 2 — Separar archivo y credenciales

1. Mover el PFX/P12 actual desde `companies.certificado` a un bucket privado, cifrado y sin acceso público.
2. Guardar el archivo con una referencia versionada, por ejemplo:

   ```text
   companies/42/certificates/v1.p12
   ```

3. Guardar en PostgreSQL solo `certificate_object_key`, versión, hash SHA-256, fecha de carga y estado.
4. Mover clave SOL, contraseña PFX, Seller y API key a un gestor de secretos o a una tabla cifrada mediante una clave maestra fuera de PostgreSQL.
5. No cambiar los valores de las credenciales durante esta fase: la migración únicamente cambia su ubicación y protección.

## Fase 3 — Cargador interno del backend

Crear una función interna equivalente a:

```ts
getCompanySigningConfig(companyId)
```

La función debe reunir datos públicos de PostgreSQL, el PFX desde el bucket y contraseñas/API keys desde el almacén seguro. Solo procesos internos del backend pueden invocarla; nunca debe ser parte de una respuesta HTTP.

## Fase 4 — Mantener Falabella y SUNAT operativos

Las acciones se ejecutarán por empresa y no por secretos entregados por el cliente:

```text
Consulta Falabella: companyId + orden → backend obtiene API key internamente → Falabella
Emisión SUNAT: companyId + venta → backend obtiene PFX y SOL internamente → SUNAT
```

El workflow de emisión debe dejar de aceptar `certificadoBase64` y `claveSol` desde frontend/chat. Debe aceptar solo `companyId` y los datos de la venta.

## Fase 5 — Endpoints administrativos

```text
GET   /companies/:id/secrets/status
PATCH /companies/:id/secrets
POST  /companies/:id/certificate
DELETE /companies/:id/certificate
```

Reglas:

- Solo `admin` o `superadmin`, con un permiso exclusivo `company_secrets`.
- Validación CSRF y de `Origin`.
- No exponer valores ya guardados ni permitir descargar certificados.
- Permitir reemplazar secretos o archivos, no recuperarlos.
- Registrar actor, empresa, tipo de secreto, fecha y resultado, sin registrar valores.

## Fase 6 — Migración sin rotación

Para cada empresa:

1. Leer PFX Base64 existente desde PostgreSQL.
2. Validarlo internamente.
3. Subir el mismo archivo al bucket privado.
4. Guardar hash y referencia.
5. Mover textos al almacén cifrado.
6. Probar Falabella y SUNAT usando solo `companyId`.
7. Marcar la empresa como migrada.
8. Eliminar los valores antiguos de `companies` solo después de validación operativa.

No se rota ni se sustituye ninguna credencial en esta migración.

## Fase 7 — Pruebas obligatorias

- Un operador no recibe secretos desde `/companies`.
- El navegador no guarda secretos en `localStorage`.
- Un admin ve estados de configuración, no valores existentes.
- Falabella funciona usando solo `companyId`.
- La emisión SUNAT funciona usando solo `companyId` y venta.
- El certificado nunca vuelve al frontend.
- Logs y errores no incluyen Base64, contraseñas ni API keys.
- La migración conserva operaciones de SUNAT y Falabella.

## Fase 8 — Despliegue

1. Desplegar DTO redactado y limpieza de caché.
2. Desplegar almacenamiento y cargador interno de secretos.
3. Migrar una empresa de prueba.
4. Validar emisión SUNAT y acciones Falabella.
5. Migrar el resto de empresas.
6. Retirar columnas de texto plano tras verificar todas las migraciones.
7. Mantener auditoría de cambios y accesos.

Resultado esperado: las operaciones siguen ejecutándose por empresa y acción, mientras el backend usa los secretos internamente sin entregarlos a operadores, navegador o chat.
