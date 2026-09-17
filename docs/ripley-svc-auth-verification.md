# Verificación de autenticación Ripley

Verificado el 12 de septiembre de 2026.

Estado actual solicitado: SellerCenter pausado. La sincronización de pedidos consulta únicamente Mirakl. Las pruebas SVC que siguen son antecedentes y no deben repetirse mientras continúe la pausa.

## Conexiones

- Mirakl Perú: `https://ripleyperu-prod.mirakl.net`. La API key se envía directamente en `Authorization`, sin Basic ni Bearer.
- SellerCenter SVC: `https://sellercenter.ripleylabs.com`. `POST /api/current/auth/login/vendor` recibe `Authorization: Basic <base64(usuario:contraseña)>`, sin body. El `access_token` recibido se usa como Bearer en las consultas logísticas.
- SVC QA: `https://sellercenter.ripleyqa.com`, según la colección pública. No se cambia automáticamente de producción a QA tras un error.

La [ayuda oficial de Ripley](https://ripley.zendesk.com/hc/es-419/articles/360048823114--Co-mo-Configurar-la-Tienda-en-Mirakl-y-Registrarse-en-SVC) enlaza el host de SellerCenter y distingue sus credenciales de las de Mirakl. La [colección SVC v5](https://documenter.getpostman.com/view/19167846/2sA2rFRKas) documenta Basic → Bearer. Su introducción indica que la URL productiva se entrega de forma privada; no publica otro host productivo.

Se comprobó directamente, sin credenciales, que el endpoint de login en `sellercenter.ripleylabs.com` responde HTTP 401 con `WWW-Authenticate: Basic realm="kong"`. Esto verifica la existencia del endpoint y su mecanismo de autenticación, pero no acredita el acceso de un seller.

## Resultado local

Una consulta real con la API key almacenada para la empresa 1 devolvió OR11 y OF21 correctamente. Se solicitó una fila por operación; los totales informados fueron 8.397 pedidos y 317 ofertas. No se modificaron pedidos ni publicaciones.

La base local no tiene usuario ni contraseña SVC para ninguna empresa activa. No se verificó un login SVC autenticado, ni permisos reales de etiquetas o manifiestos. Las pruebas de esos flujos usan respuestas simuladas conforme a la colección. El login web actual utiliza NextAuth y selección de proveedor; no se incorpora como alternativa al contrato API Basic.

## Correcciones

- Conservar exactamente la contraseña SVC desde la empresa hasta Basic Auth.
- Permitir editar la URL SVC en Empresas; vacía usa el host productivo anterior.
- Rechazar una URL de Mirakl en el campo SVC, en vez de reemplazarla silenciosamente.
- Detectar respuestas HTML o vacías en consultas SVC, para que no aparenten listas sin registros.
- No seguir redirecciones de las llamadas autenticadas SVC. Conservar la renovación única tras HTTP 401.

## Comprobaciones

`npm test -w @zentofact/ripley-api`: 17 pruebas aprobadas, incluyendo Basic, Bearer, renovación, etiquetas, manifiestos y las regresiones anteriores.

Las pruebas de `ripley-logistics`, `ripley-orders` y `order-sync` del servidor aprobaron 34 casos. En este worktree los enlaces de dependencias apuntan al repositorio principal; para esta ejecución se resolvió explícitamente `@zentofact/ripley-api` al `dist` recién compilado de este worktree, sin modificar las dependencias compartidas.

La prueba de UI en vivo sigue pendiente: el servicio ya iniciado en el puerto 3011 sirve el worktree principal.

## Prueba SVC con la configuración de producción

Se consultó la configuración de empresas del entorno `production` de Railway en una transacción PostgreSQL `READ ONLY`. Solo LIMBO, empresa 1, tiene usuario y contraseña SVC guardados. Su campo `ripley_svc_base_url` contiene incorrectamente `https://ripleyperu-prod.mirakl.net`.

Sin modificar esa configuración, se probó el login contra el host SVC correcto, `https://sellercenter.ripleylabs.com/api/current/auth/login/vendor`, con las credenciales guardadas y sin recortar la contraseña:

| Prueba | Resultado |
| --- | --- |
| POST Basic, sin body, con `X-Country: PE` | HTTP 403, `Invalid authentication credentials`, sin token |
| POST Basic, sin body, sin `X-Country`, igual que Postman | HTTP 403, `Invalid authentication credentials`, sin token |
| Consulta del proveedor web del mismo usuario, país PE | HTTP 200, `main-provider-pe` |
| Catálogo público de proveedores web | `main-provider-pe` es OAuth; `custom-provider` es credentials |

El usuario y la contraseña almacenados no tienen espacios exteriores, por lo que el recorte corregido en el cliente no explica este rechazo concreto. Que el usuario tenga proveedor web OAuth no acredita una contraseña válida ni acceso Basic a la API SVC. No se probó un login OAuth ni se sustituyó el contrato API con un flujo web.

El bloqueo real observado está en la obtención del token SVC. No se ejecutaron consultas autenticadas de etiquetas, etiquetas elegibles ni manifiestos al no obtener token. No se agendaron despachos, no se modificó producción y no se cambió la conexión Mirakl.

## Prueba adicional en QA

A petición del usuario se repitió el login contra `https://sellercenter.ripleyqa.com/api/current/auth/login/vendor`, usando las mismas credenciales SVC guardadas de LIMBO. Se envió `Authorization: Basic <base64(usuario:contraseña)>` en UTF-8, sin body y sin `X-Country`.

Resultado: HTTP 403, `Invalid authentication credentials`, sin `access_token`. No se ejecutaron las consultas logísticas posteriores porque el login no entregó token. El resultado no demuestra si QA comparte usuarios con producción; demuestra que QA también rechazó las credenciales probadas.


## Pausa de SVC

Se retiraron las llamadas a SVC de la sincronización unificada y de la sincronización directa de Ripley, incluida la ruta donde el cursor ya está al día. El estado operativo se calcula desde el estado Mirakl y no desde metadata SVC histórica. `SHIPPING` permanece pendiente; no se interpreta como agendamiento confirmado.

Los endpoints SVC reales quedan bloqueados por defecto, aun cuando haya credenciales guardadas. `RIPLEY_SVC_ENABLED` debe ser exactamente `true` para permitir su cliente; no se habilitó. El sandbox local conserva sus respuestas simuladas. No se realizó ninguna conexión SVC para verificar este cambio: las pruebas son locales y comprueban que no se invoque el cliente.
