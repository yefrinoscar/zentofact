# Sistema de diseño de ZentoFact

Este documento define el estilo visual obligatorio de la aplicación. La pantalla **Productos** marca la dirección visual y los componentes compartidos de `packages/web/src/components/ui` son la fuente de verdad para nuevas pantallas.

## Principios

1. La interfaz debe sentirse compacta, clara y operativa.
2. Una misma función debe verse y comportarse igual en todos los módulos.
3. Se usan componentes shadcn/Radix existentes antes de crear controles manuales.
4. Los radios son moderados. La aplicación no usa botones o paneles excesivamente redondeados.
5. Los filtros siempre están encima de la tabla que modifican.
6. La jerarquía visual proviene de espacio, tipografía, bordes y fondos suaves; no de tarjetas grandes dentro de tarjetas.
7. La interfaz nunca expone ni persiste secretos para facilitar una interacción.
8. Los divisores se usan solo para separar grupos que realmente necesitan una frontera; no se colocan líneas arriba y abajo de cada control.

## Estructura de página

`App.tsx` ya muestra el título y la descripción del módulo. Las rutas no deben repetirlos.

Composición estándar:

```tsx
<div className="space-y-4">
  <Toolbar />
  <Feedback />
  <TablePanel>
    <TablePanelHeader />
    <Table />
    <TablePanelFooter />
  </TablePanel>
</div>
```

- Separación vertical normal: `space-y-4`.
- El ancho máximo y padding pertenecen al layout principal, no a cada ruta.
- La acción principal se ubica a la derecha de la barra de herramientas.
- Un enlace de regreso solo aparece cuando existe un flujo jerárquico real; no sustituye la navegación principal.
- No colocar una segunda tarjeta exterior alrededor de `TablePanel`.

## Barra de herramientas y filtros

La barra está fuera y encima de la tabla.

Orden recomendado:

1. Selector de contexto, como empresa o seller.
2. Búsqueda.
3. Filtros de estado o rol.
4. Actualizar u otras acciones secundarias.
5. Acción primaria, alineada al extremo derecho.

Reglas:

- Altura estándar: `h-9` mediante los componentes compartidos.
- Usar `Input` para búsquedas y `Select` para opciones.
- No usar `<select>` nativo cuando ya existe el `Select` compartido.
- La búsqueda incluye icono `Search` dentro del campo.
- En móvil, los controles ocupan todo el ancho y se apilan.
- En escritorio, la búsqueda usa aproximadamente `20–24rem`; los filtros tienen un ancho acorde con su contenido.
- No es obligatorio colocar todo en una sola fila. Cuando los controles se comprimen, usar dos niveles: contexto + acción principal arriba, y búsqueda + filtros abajo.
- Una toolbar de dos niveles debe mantener alineación y separación constantes; no debe parecer que los controles saltaron de línea accidentalmente.
- Los filtros compactos conservan su ancho natural; nunca deben estirarse en columnas iguales solo para llenar el espacio disponible.
- Los controles segmentados usan contenedor `rounded-xl` y selección `rounded-lg`, manteniendo altura `h-9`.
- No mostrar un botón “Actualizar” cuando los cambios de contexto y filtros ya recargan los datos automáticamente.
- No mostrar selectores de cantidad por página salvo que exista una necesidad demostrable. La cantidad predeterminada de tablas administrativas es 10; las tablas operativas de catálogo y salidas usan 20.
- No mostrar chips como “2 resultados” en la barra. El conteo pertenece a la cabecera o pie del panel.
- En pantallas de un solo día, el selector de fecha va **encima** de la búsqueda y ocupa todo el ancho disponible. Usar `DayStrip`: días horizontales como botones, flechas para el día anterior/siguiente y un calendario para saltos largos. No usar `<input type="date">` nativo.
- La franja de días no se recentra al elegir un día ya visible. Si la fecha sale de la ventana, el carril se desliza hacia atrás o adelante; no remountar los días ni usar `scrollIntoView`.
- No poner una línea decorativa debajo de la toolbar. El siguiente bloque (tabla o feedback) ya marca la separación.

## Selectores

Usar exclusivamente:

- `Select`
- `SelectTrigger`
- `SelectValue`
- `SelectContent`
- `SelectItem`

Directrices visuales:

- Trigger compacto, altura `h-9`.
- Radio moderado del componente compartido; nunca `rounded-full`.
- Menú alineado con el trigger y con el mismo ancho mínimo.
- Items compactos con selección indicada mediante check.
- El menú puede tener scroll, pero no debe crecer fuera del viewport.
- Evitar sobrescribir el radio con valores mayores que `rounded-xl`.

## Tabs

Usar exclusivamente `Tabs`, `TabsList`, `TabsTrigger` y `TabsContent` compartidos.

- El patrón estándar de ZentoFact es segmentado: `TabsList` con fondo muted y cada selección dentro de un trigger compacto.
- No usar tabs subrayados (`variant="line"`) para drawers o diálogos operativos.
- En drawers, alinear el grupo a la izquierda con `className="w-full sm:w-auto"`; no repartir los tabs en columnas iguales ni forzar que ocupen todo el ancho en escritorio.
- El contenido del tab usa la misma superficie del drawer o diálogo, separado mediante espacio o un borde simple. No envolver cada tab en una tarjeta nueva.
- Los contadores cortos pueden aparecer dentro del trigger, junto a la etiqueta.
- Cuando un diálogo modal está abierto sobre un drawer, los tabs del fondo quedan bloqueados y no deben responder a clics ni recibir foco.

### Resumen de publicaciones en el drawer

- Agrupar primero por canal y representar cada canal con una sola superficie secundaria sobria.
- Dentro del canal, mostrar los sellers como una lista o cuadrícula compacta de elementos sin bordes individuales.
- Cada seller muestra el nombre comercial corto y un dato secundario útil, como el SKU del seller o la cantidad de publicaciones.
- No concatenar todos los sellers en una sola línea separada por puntos, ni crear una tarjeta dentro de otra por cada seller.
- Reservar la tabla detallada, precios, stock y controles de publicación para el tab `Publicaciones`.

### Detalle de publicaciones y producto

- El tab `Publicaciones` separa cada seller con una franja de espacio o fondo perceptible; un borde fino entre bloques altos no es suficiente.
- Dentro de cada publicación, etiquetar explícitamente `SKU del seller` y `Shop SKU`; no mostrarlos como una cadena ambigua.
- En la cabecera del drawer, anteponer `SKU interno` al código canónico para diferenciarlo de los códigos de marketplace.
- La navegación entre registros del drawer es secundaria: usar un único control segmentado compacto `‹ N / total ›` a la derecha de la identidad y debajo de ella en móvil. No añadir otra franja, botones grandes ni texto que compita con el título o el cierre.
- La foto principal se edita desde la miniatura de la cabecera. Las fotos preparadas para una publicación pertenecen al formulario de ese seller y no modifican otras publicaciones.
- Al seleccionar un seller para una nueva publicación, sugerir un SKU basado en su nombre corto, ID de empresa y SKU interno. El operador siempre puede editar SKU y precio antes de continuar.

## Botones

Usar `Button` y sus variantes.

- Primario: `variant="default"`.
- Secundario: `variant="outline"`.
- Acciones discretas: `variant="ghost"`.
- Destructivo: `variant="destructive"` o item destructivo dentro de menú.
- Altura normal: `h-9`.
- Radio: `rounded-md`, definido por el componente.
- Los botones principales llevan icono y texto.
- Los botones solo con icono requieren `aria-label` y tooltip o título.
- No crear botones grandes tipo píldora.
- En filas, preferir un menú `MoreHorizontal` cuando existen varias acciones.

## Tablas

Toda tabla operativa o administrativa nueva debe ser un **data table de shadcn**, no una lista custom ni un `<table>` suelto.

Usar:

- `DataTable` y `DataTablePagination` de `components/ui/data-table.tsx` para el modelo de filas, pie y estados.
- `DataTableColumnHeader` en cada columna ordenable.
- Debajo, los primitivos compartidos: `TablePanel`, `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`, `TablePanelFooter`.
- React Table (`useReactTable`) para columnas, paginación y orden.
- React Query para fetch, caché e invalidación. Nunca cargar un catálogo ilimitado en estado del navegador.

La pantalla **Salidas de hoy** es la referencia de una tabla operativa bien hecha.

### Panel

- Borde `border-border`.
- Fondo `bg-card`.
- Radio `rounded-md`.
- Sin sombras grandes.
- `overflow-hidden` para que cabecera y filas respeten el radio.
- Ancho mínimo de tabla (`min-w-[720px]`) y scroll horizontal en móvil. No aplastar columnas.

### Cabecera informativa

La franja `TablePanelHeader` usa `bg-muted/30` y contiene información relevante, por ejemplo:

- Total de registros.
- Cantidad lista o pendiente.
- Página actual.
- Filtro activo.
- Contexto seleccionado.

No debe repetir el título y descripción de la página.

### Encabezados de columnas

- Fondo `bg-muted/40`.
- Texto `text-muted-foreground` y `font-medium`.
- Altura consistente mediante `TableHead`.
- Las columnas numéricas y de acciones se alinean a la derecha.
- Toda columna con dato comparable debe poder ordenarse. El encabezado es un botón con `DataTableColumnHeader` e indicador `↑` / `↓` / `↕`.
- El orden de tablas paginadas en servidor es **manual** (`manualSorting`) y se envía a la API (`sortBy`, `sortDir`). No ordenar solo la página visible.

### Filas

- Separador fino `border-border/70`.
- Hover suave `hover:bg-muted/30`.
- Padding proporcionado por `TableCell`.
- El contenido principal usa `font-medium`; el dato secundario usa `text-sm text-muted-foreground`.
- Usar `font-mono tabular-nums` para RUC, correlativos y códigos cuando facilite la lectura.
- Si el producto tiene foto, mostrarla en la primera columna. No dejar un icono genérico cuando la URL o el Shop SKU existen.
- No usar checkbox si la pantalla no ofrece una acción masiva.

### Paginación

- Las tablas administrativas muestran 10 filas por defecto.
- El catálogo y las salidas muestran 20 filas por página.
- El pie usa `DataTablePagination`: “Mostrando X a Y de Z” y números de página, no solo Anterior/Siguiente.
- No renderizar paginación cuando todos los resultados caben en una página.

### Expansión compacta por fila

- La fila maestra puede incluir un chevron para mostrar un resumen operativo directamente debajo del producto.
- El nombre del producto se muestra completo; no se trunca en la fila maestra ni en el encabezado del drawer.
- En la tabla del catálogo, `Stock` suma el stock API de todas las publicaciones activas y aprobadas; el inventario interno se muestra por separado en el tab `Inventario`.
- En catálogo, la expansión carga bajo demanda las publicaciones por seller con canal, SKU, precio y stock.
- La expansión no replica el detalle completo, formularios ni acciones sensibles; esas funciones permanecen en el drawer.
- El chevron no abre el drawer y el clic sobre el resto de la fila sí lo abre.
- Cambiar búsqueda, filtros o página contrae las filas abiertas.

## Estados y etiquetas

Los estados se representan con `Badge` o una etiqueta compacta, no únicamente mediante color o un icono sin texto.

- Éxito/configurado/activo: esmeralda.
- Pendiente/advertencia/incompleto: ámbar.
- Error/rechazado/destructivo: rojo.
- Informativo/admin: azul.
- Superadmin: violeta.
- Neutral/inactivo/viewer: slate o muted.

Reglas:

- Radio `rounded-md`, no píldora exagerada.
- Borde y fondo suaves.
- Texto explícito: “Configurado”, “Pendiente”, “Activo”, “Rechazado”.
- Los roles deben tener colores diferentes y estables.
- Un tooltip puede ampliar el significado, pero no reemplaza la etiqueta visible.

## Estado vacío, carga y error

Estado vacío estándar:

```tsx
<div className="flex flex-col items-center gap-2 py-14 text-center">
  <Icon className="size-8 text-muted-foreground/50" />
  <p className="text-sm font-medium">Mensaje principal</p>
  <p className="text-sm text-muted-foreground">Explicación o siguiente paso.</p>
</div>
```

- Evitar paneles vacíos con alturas enormes.
- Si hay una acción natural, mostrar un `Button` compacto.
- La **primera carga** de una tabla usa `DataTableSkeleton` (`components/ui/skeleton.tsx`), no un spinner centrado. El esqueleto replica foto + texto + columnas numéricas.
- Cambiar la **fecha** (u otro contexto que sustituye el conjunto de trabajo) también muestra skeleton en indicadores y tabla. No dejar visibles las filas del día anterior.
- Paginar, buscar o reordenar el mismo conjunto puede conservar las filas previas con `keepPreviousData` y un indicador discreto de fetching.
- `Loader2` queda para botones y acciones puntuales, no para reemplazar el cuerpo de una tabla.
- Los errores usan un bloque compacto con borde y fondo destructivo suave.

## Formularios y diálogos

- Usar `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle` y `DialogFooter`.
- No implementar overlays con `div` fijos manuales. El `Dialog` compartido debe controlar portal, foco, Escape, cierre y bloqueo del contenido de fondo.
- Un diálogo abierto desde un `Sheet` se renderiza por encima del drawer; su overlay debe cubrir y bloquear también el drawer.
- La X del componente compartido siempre cierra el diálogo mediante `DialogClose`. Verificar también cierre con Escape y que el fondo no acepte interacción.
- Usar `Input`, `Label`, `Select`, `Switch` y `Checkbox` compartidos.
- Radio de campos y diálogo moderado.
- Formularios extensos pueden usar grid de dos columnas en escritorio y una en móvil.
- Acciones: cancelar a la izquierda del grupo y guardar como primaria.
- No cerrar un diálogo mientras una operación está guardando.
- Los errores se muestran dentro del diálogo, encima de los campos.

## Seguridad en la interfaz

- Nunca guardar credenciales, certificados, claves SOL, contraseñas o API keys en `localStorage` o `sessionStorage`.
- Las respuestas de empresa para selección solo deben incluir ID, nombre, razón social, RUC y booleanos de configuración.
- Un secreto guardado se representa como “Configurado”; no se vuelve a rellenar en un formulario.
- El logout elimina cualquier caché asociada con la sesión.
- Los previews HTML usan iframe con `sandbox`.
- No mostrar URLs firmadas ni datos de autenticación en mensajes de depuración.

## Accesibilidad

- Todos los controles son alcanzables por teclado.
- Icon buttons llevan `aria-label`.
- Los labels están asociados a sus inputs.
- El foco visible no se elimina.
- La información no depende únicamente del color.
- Tablas con acciones incluyen nombres accesibles específicos.

## Responsive

- La toolbar se apila antes de comprimir controles hasta hacerlos ilegibles.
- Las tablas conservan un ancho mínimo y permiten scroll horizontal.
- Columnas secundarias pueden ocultarse progresivamente con `hidden md:table-cell` o `hidden lg:table-cell`.
- La acción primaria permanece visible.
- Evitar anchos calculados con viewport cuando `w-full` y breakpoints son suficientes.

## Checklist para una tabla nueva

- [ ] No repite título ni descripción del layout.
- [ ] Usa `DataTable` / `DataTablePagination` de `components/ui`.
- [ ] Filtros encima de la tabla; selector de día a ancho completo si aplica.
- [ ] Acción principal a la derecha.
- [ ] `TablePanel` con radio moderado y sin tarjeta extra alrededor.
- [ ] Cabecera de columnas con fondo muted.
- [ ] Columnas ordenables con `DataTableColumnHeader` y sort en servidor si hay paginación.
- [ ] 10 filas (admin) o 20 (catálogo/salidas), nunca un listado ilimitado.
- [ ] Estados con texto y color semántico.
- [ ] Conteo en cabecera o pie, no como chip suelto.
- [ ] Estado vacío compacto.
- [ ] Skeleton en primera carga y al cambiar de fecha/contexto; error y sin resultados contemplados.
- [ ] Responsive y scroll horizontal.
- [ ] Acciones accesibles.
- [ ] Sin secretos en estado persistente del navegador.
