# Exportación Excel de ventas Falabella

**Estado:** Mejora futura

## 1. Objetivo

Incorporar en ZentoFact una exportación Excel reproducible para analizar ventas Falabella por empresa y por seller, utilizando los filtros y datos ya disponibles en Dashboard, Bandeja de pedidos y Gestor de Sellers.

La implementación debe generar los archivos bajo demanda. No se deben conservar archivos Excel generados dentro del repositorio.

## 2. Experiencia de usuario

Agregar la acción **Exportar Excel** en el módulo Falabella o en Dashboard.

Filtros requeridos:

- Rango de fechas, por defecto el mes actual.
- Todas las empresas o una empresa.
- Todos los sellers o un seller.
- Tipo de reporte: por empresa o por seller.
- Incluir o no el detalle de pedidos.

La exportación debe respetar `America/Lima` para fechas y horas.

Nombres sugeridos:

- `ventas_falabella_YYYY_MM.xlsx`
- `ventas_falabella_por_seller_YYYY_MM.xlsx`

## 3. Reporte por empresa

Referencia funcional analizada: `ventas_falabella_julio_2026.xlsx`.

### Hoja `Resumen`

Tabla `ResumenEmpresas` con una fila por empresa y las columnas:

| Columna | Definición |
|---------|------------|
| Empresa | Nombre comercial o razón social |
| RUC | RUC de la empresa |
| Pedidos netos | Pedidos válidos después de excluir cancelaciones y devoluciones según la definición operativa |
| Ventas netas | Importe de pedidos válidos |
| Pedidos cancelados | Cantidad de pedidos clasificados como cancelados |
| Monto cancelado | Importe asociado a pedidos cancelados |
| Demanda bruta | Ventas netas + monto cancelado, antes de otras deducciones aplicables |
| Ticket promedio | Ventas netas / pedidos netos; cero cuando no existen pedidos netos |
| % de ventas | Participación de la empresa sobre la venta neta consolidada |

Elementos visuales:

- Tabla con filtros y filas alternadas.
- Formato monetario en PEN.
- Porcentajes con dos decimales.
- Gráfico horizontal **Ventas netas por empresa**.
- Encabezados repetidos al imprimir.

La referencia contenía una tabla `A5:I14`, correspondiente a nueve empresas más encabezado.

### Hoja `Ventas por día`

Tabla `VentasDiarias` con:

- Fecha.
- Una columna dinámica por empresa.
- Total del día.
- Pedidos netos.
- Cancelados.

La referencia utilizó `A4:M20`: dieciséis días con datos y nueve columnas dinámicas de empresa.

Las columnas de empresa no deben estar codificadas. Deben construirse a partir de las empresas incluidas en el filtro.

### Hoja `Detalle`

Tabla `DetallePedidos`, una fila por pedido:

| Columna |
|---------|
| Fecha |
| Hora |
| Empresa |
| RUC |
| N° pedido |
| Estado Falabella |
| Situación |
| Importe |
| Moneda |
| Requiere factura |
| Comprobante |
| N° comprobante |
| Estado SUNAT |

La referencia contenía 890 filas de detalle (`A4:M894`, descontando encabezados superiores).

## 4. Reporte por seller

Referencia funcional analizada: `ventas_falabella_por_seller_julio_2026.xlsx`.

### Hoja `Resumen por seller`

Tabla `ResumenSellers` con una fila por cuenta seller:

| Columna | Definición |
|---------|------------|
| Seller | Nombre de presentación del seller |
| Cuenta Seller | Identificador o cuenta utilizada en Falabella |
| Pedidos totales | Total recibido en el periodo |
| Pedidos válidos | Pedidos que forman parte de la venta neta |
| Venta neta | Importe válido después de exclusiones |
| Cancelados | Cantidad cancelada |
| Monto cancelado | Importe cancelado |
| Devueltos | Cantidad devuelta |
| Monto devuelto | Importe devuelto |
| Venta bruta | Venta neta + montos cancelados + montos devueltos |
| % venta neta | Participación del seller en la venta neta consolidada |

Elementos visuales:

- Tabla con filtros y filas alternadas.
- Gráfico horizontal **Venta neta por seller**.
- Formatos monetarios y porcentuales.
- Encabezados repetidos al imprimir.

La referencia utilizó `A5:K14`, nueve sellers más encabezado.

### Hoja `Ventas por día`

Tabla `VentasSellerDiarias` con:

- Fecha.
- Una columna dinámica por seller.
- Total neto.
- Pedidos válidos.
- Monto cancelado.
- Monto devuelto.
- Cancelados.
- Devueltos.

La referencia utilizó `A4:P20`: dieciséis días con datos y nueve columnas dinámicas de seller.

### Hoja `Detalle Seller`

Tabla `DetalleSeller`, una fila por pedido y seller:

| Columna |
|---------|
| Fecha |
| Hora |
| Seller |
| Cuenta Seller |
| N° pedido |
| Estado Seller |
| Clasificación |
| Importe |
| Moneda |

La referencia contenía 891 filas de detalle (`A4:I895`, descontando encabezados superiores).

## 5. Reglas de negocio pendientes de cerrar

Antes de implementar se debe aprobar una única clasificación compartida con Dashboard:

- Qué estados forman `válido` o `neto`.
- Qué estados forman `cancelado`.
- Qué estados forman `devuelto`.
- Tratamiento de pedidos parcialmente cancelados o devueltos.
- Tratamiento de pedidos con múltiples monedas.
- Si los montos incluyen descuentos, envío y comisiones.
- Si el periodo usa fecha de creación, pago, actualización o despacho.

Las fórmulas del Excel deben usar la misma fuente de verdad que las métricas visibles en la aplicación.

## 6. Diseño técnico sugerido

Endpoint:

```text
GET /reports/falabella-sales.xlsx
```

Query params sugeridos:

| Param | Valores |
|-------|---------|
| `from` | `YYYY-MM-DD` |
| `to` | `YYYY-MM-DD` |
| `groupBy` | `company` o `seller` |
| `companyId` | Opcional |
| `sellerId` | Opcional |
| `includeDetail` | `true` o `false` |

Requisitos:

- Permiso `falabella`.
- Generación server-side y respuesta por streaming.
- No escribir credenciales ni información sensible en logs.
- Consultar pedidos en páginas o mediante cursor para evitar límites silenciosos.
- Aplicar un límite de periodo razonable para proteger memoria y tiempo de respuesta.
- Escapar celdas que comiencen con `=`, `+`, `-` o `@` para evitar formula injection.
- Usar formatos nativos de Excel para fecha, hora, moneda y porcentaje.
- Congelar paneles y activar autofiltros.
- Ajustar anchos de columna y altura de encabezados.
- Mantener columnas dinámicas por empresa/seller ordenadas por venta neta descendente.

Biblioteca sugerida: `exceljs`, agregada solo al implementar esta mejora.

## 7. Criterios de aceptación

- El total consolidado coincide con Dashboard para el mismo rango y filtros.
- La suma diaria coincide con el resumen del archivo.
- La suma del detalle coincide con los agregados según clasificación.
- Empresas y sellers sin ventas pueden incluirse con cero si el usuario lo solicita.
- Cancelaciones y devoluciones no se mezclan con venta neta.
- El archivo abre sin advertencias en Excel, Numbers y LibreOffice.
- Los gráficos actualizan sus rangos al variar la cantidad de empresas o sellers.
- La exportación funciona con una empresa/seller y con el consolidado completo.
- Ningún archivo generado queda versionado en Git.

## 8. Fuera de alcance inicial

- Macros VBA.
- Plantillas editables por usuario.
- Envío automático del archivo por correo.
- Programación recurrente de reportes.
