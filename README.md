# Boletas SUNAT — Monorepo

Genera boletas electronicas peruanas con SUNAT desde un JSON de ventas.

## Estructura

```
boletas-sunat/
├── packages/
│   ├── core/         ← @boletas/core — logica SUNAT, PDF, BD
│   ├── falabella-api/← @boletas/falabella-api — cliente oficial Seller API
│   ├── scraper/      ← @boletas/scraper — extrae ventas (placeholder)
│   └── desktop/      ← @boletas/desktop — Electron app 4 pantallas
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

# Desktop
cd packages/desktop && npx tsc --noEmit
```

## Ejecutar (desktop)

```bash
cd packages/desktop
npm run dev
```

## API — @boletas/core

```typescript
import { processWorkflow, validateConfig } from '@boletas/core';

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

## Desktop — pantallas

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

npm run --workspace @boletas/falabella-api build
npm run --workspace @boletas/falabella-api get-orders -- --updated-after 2026-05-01T00:00:00+00:00 --limit 10
```
