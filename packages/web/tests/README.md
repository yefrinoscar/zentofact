# Prueba de interacción de Pagos

Ejecuta Vite desde este worktree en `http://127.0.0.1:3011`:

```sh
npm run dev -w @zentofact/web
```

En otra terminal, con Playwright y Chromium disponibles:

```sh
node --test packages/web/tests/pagos-interactions.mjs
```

Si Playwright está instalado fuera del proyecto, indica su módulo con
`PLAYWRIGHT_MODULE=/ruta/a/playwright/index.mjs`. Para usar un Chrome instalado,
indica su ejecutable en `CHROME_PATH`. `ZENTOFACT_WEB_URL` permite cambiar el puerto.

La prueba monta el componente real con React Query y React Table. Intercepta
las peticiones con 4.608 ventas de prueba. Recorre las 58 páginas de 80 filas,
comprueba que solo se montan las filas visibles, cambia meses, busca un resultado
vacío y cambia el estado de pago. Comprueba que los controles responden y que React
deja de renderizar en reposo. No necesita base de datos ni credenciales.
El HTML temporal se elimina al terminar.

Para repetir la prueba con una copia local de datos reales, usa
`PAGOS_REPLAY_FILE=/ruta/privada/ventas.json`. El archivo debe tener una propiedad
`items` con las ventas completas en el formato de `/pagos/sales`. El filtro y
los resúmenes se calculan con las funciones del servidor. El archivo se lee
solo desde el proceso de prueba; no se incorpora al repositorio.
