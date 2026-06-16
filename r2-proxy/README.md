# R2 Proxy (Cloudflare Worker)

Proxy mínimo para subir/leer XML/CDR en el bucket R2 `zunat` **cuando la red bloquea
el endpoint S3 de R2** (`*.r2.cloudflarestorage.com`). El Worker vive en
`*.workers.dev`, que sí es alcanzable, y accede a R2 internamente por *binding*.

## Desplegar (una sola vez)

Necesitas tu cuenta de Cloudflare. Desde esta carpeta:

```bash
cd r2-proxy

# 1) Instalar wrangler (CLI de Cloudflare) y autenticarte con TU cuenta
npm install -g wrangler
wrangler login          # abre el navegador para autorizar

# 2) Definir el secreto de autenticación del proxy (inventa uno largo y guárdalo)
wrangler secret put PROXY_SECRET
#   -> pega un valor random, ej: openssl rand -hex 32

# 3) Desplegar
wrangler deploy
```

Al terminar, `wrangler` imprime la URL pública, algo como:

```
https://boletas-r2-proxy.TU-SUBDOMINIO.workers.dev
```

## Conectar la app

En el `.env` de la raíz del proyecto:

```
R2_PROXY_URL=https://boletas-r2-proxy.TU-SUBDOMINIO.workers.dev
R2_PROXY_SECRET=el-mismo-valor-que-pusiste-en-PROXY_SECRET
```

A partir de ahí la app guarda los XML/CDR en R2 a través del Worker.

## Subir los archivos ya existentes (mayo, etc.)

```
npm run r2:backfill:proxy
```

## Probar manualmente

```bash
# subir
curl -X PUT -H "Authorization: Bearer $R2_PROXY_SECRET" --data-binary @archivo.xml \
  https://boletas-r2-proxy.TU-SUBDOMINIO.workers.dev/boletas/xml/13052026/B001-000123.xml
# leer
curl -H "Authorization: Bearer $R2_PROXY_SECRET" \
  https://boletas-r2-proxy.TU-SUBDOMINIO.workers.dev/boletas/xml/13052026/B001-000123.xml
```
