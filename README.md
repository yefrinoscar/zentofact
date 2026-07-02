# ZentoFact — Monorepo

Emite documentos electronicos peruanos con SUNAT y cruza ordenes de Falabella desde una web desacoplada.

## Estructura

```
zentofact/
├── packages/
│   ├── core/         ← @zentofact/core — logica SUNAT, PDF, BD
│   ├── falabella-api/← @zentofact/falabella-api — cliente oficial Seller API
│   ├── scraper/      ← @zentofact/scraper — extrae ventas (placeholder)
│   ├── server/       ← @zentofact/server — API HTTP
│   ├── web/          ← @zentofact/web — frontend React web
│   └── desktop/      ← @zentofact/desktop — shell Electron que monta @zentofact/web
└── package.json
```

## Requisitos

- Node.js >= 18
- npm >= 9

## Instalar

```bash
npm install
```

## Compilar

```bash
# Core
cd packages/core && npx tsc --noEmit   # verifica tipos

# Scraper
cd packages/scraper && npx tsc --noEmit

# Falabella API
cd packages/falabella-api && npx tsc --noEmit

# Web
cd packages/web && npm run build

# Electron
cd packages/desktop && npx tsc --noEmit
```

## Ejecutar (desktop)

```bash
cd packages/desktop
npm run dev
```

## Ejecutar (web desacoplado)

En desarrollo, el API y el frontend corren separados:

```bash
# Terminal 1: API HTTP
npm run dev:api

# Terminal 2: frontend web con HMR
npm run dev:web
```

- API: `http://localhost:3010`
- Web: `http://localhost:3011`

El servidor API no sirve el frontend por defecto. Para un despliegue monolitico
con assets estaticos, primero genera el build web y luego activa `SERVE_WEB=true`:

```bash
npm run build:web
SERVE_WEB=true npm run dev:api
```

## API — @zentofact/core

```typescript
import { processWorkflow, validateConfig } from '@zentofact/core';

const config = {
  ruc: '20123456789',
  razonSocial: 'MI EMPRESA SAC',
  direccion: 'Av. Principal 123',
  ubigeo: '150101',
  usuarioSol: 'MODDATOS',
  claveSol: 'MODDATOS',
  certificadoBase64: '<archivo .pfx en base64>',
  certificadoPassword: '123456',
  modoProduccion: false,   // true = produccion, false = beta
  outputDir: './output',
};

const ventas = [
  {
    fechaEmision: '2026-05-06',
    client: {
      tipoDocumento: '1',
      numeroDocumento: '12345678',
      razonSocial: 'Juan Perez',
    },
    detalles: [{
      codigo: 'PROD001',
      descripcion: 'Laptop HP 15.6"',
      unidad: 'NIU',
      cantidad: 1,
      mtoValorUnitario: 2542.37,
      porcentajeIgv: 18,
      tipAfeIgv: '10',
    }],
  },
];

const result = await processWorkflow(config, ventas, (current, total, status) => {
  console.log(`${current}/${total}: ${status}`);
});

// result = {
//   total: 1,
//   exitosas: 1,
//   rechazadas: 0,
//   boletas: [{ numeroCompleto: 'B001-000001', estadoSunat: 'ACEPTADO', pdfPath: '...' }],
//   outputDir: './output',
// }
```

## Electron — pantallas

1. **Configuracion** — RUC, certificado .pfx, credenciales SOL, carpeta salida
2. **Datos** — cargar JSON de ventas, vista previa
3. **Procesando** — barra de progreso, estado por boleta
4. **Resultados** — exitos/rechazos, abrir carpeta PDFs

## Stack

| Capa | Libreria |
|------|----------|
| Monorepo | npm workspaces |
| Lenguaje | TypeScript 5.8 |
| Desktop | Electron 33 |
| BD | SQLite (better-sqlite3) |
| ORM | Drizzle ORM |
| SUNAT XML | xmlbuilder2 |
| SUNAT firma | xml-crypto + node-forge |
| SUNAT SOAP | strong-soap |
| PDF | pdfmake |
| QR | qrcode |
| ZIP | adm-zip |

## Falabella API

La integracion oficial de Seller API vive aparte de `scraper`, en `packages/falabella-api`.

Requiere estas credenciales oficiales de Falabella:

- `FALABELLA_API_USER_ID`
- `FALABELLA_API_KEY`

Segun la documentacion oficial, ambas se obtienen en `Settings > Integration Management > API`, y para `GetOrders` el usuario debe tener rol `Seller API Order Access` o `Seller API Access`.

Prueba minima de `GetOrders`:

```bash
export FALABELLA_API_USER_ID="tu-user-id"
export FALABELLA_API_KEY="tu-api-key"
export FALABELLA_API_VERSION="1.0"

npm run --workspace @zentofact/falabella-api build
npm run --workspace @zentofact/falabella-api get-orders -- --updated-after 2026-05-01T00:00:00+00:00 --limit 10
```
