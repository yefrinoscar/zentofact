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
- No mostrar selectores de cantidad por página salvo que exista una necesidad demostrable. La cantidad predeterminada de tablas administrativas es 10.
- No mostrar chips como “2 resultados” en la barra. El conteo pertenece a la cabecera o pie del panel.

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

Toda tabla nueva debe usar:

- `TablePanel`
- `TablePanelHeader` cuando exista información contextual útil.
- `Table`
- `TableHeader`
- `TableBody`
- `TableRow`
- `TableHead`
- `TableCell`
- `TablePanelFooter` para conteo o paginación.

### Panel

- Borde `border-border`.
- Fondo `bg-card`.
- Radio `rounded-md`.
- Sin sombras grandes.
- `overflow-hidden` para que cabecera y filas respeten el radio.

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
- Una columna ordenable muestra el indicador junto al nombre.

### Filas

- Separador fino `border-border/70`.
- Hover suave `hover:bg-muted/30`.
- Padding proporcionado por `TableCell`.
- El contenido principal usa `font-medium`; el dato secundario usa `text-sm text-muted-foreground`.
- Usar `font-mono tabular-nums` para RUC, correlativos y códigos cuando facilite la lectura.
- No usar checkbox si la pantalla no ofrece una acción masiva.

### Paginación

- Las tablas administrativas muestran 10 filas por defecto.
- El pie indica “Mostrando X de Y”.
- `Anterior` y `Siguiente` usan botones compactos.
- No renderizar paginación falsa cuando todos los resultados caben en una página.

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
- La carga usa `Loader2` y texto corto.
- Los errores usan un bloque compacto con borde y fondo destructivo suave.
- Una actualización con datos existentes puede usar overlay sin borrar la tabla.

## Formularios y diálogos

- Usar `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle` y `DialogFooter`.
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
- [ ] Usa componentes de `components/ui`.
- [ ] Filtros encima de la tabla.
- [ ] Acción principal a la derecha.
- [ ] `TablePanel` con radio moderado.
- [ ] Cabecera de columnas con fondo muted.
- [ ] Estados con texto y color semántico.
- [ ] Conteo en cabecera o pie, no como chip suelto.
- [ ] Estado vacío compacto.
- [ ] Loading, error y sin resultados contemplados.
- [ ] Responsive y scroll horizontal.
- [ ] Acciones accesibles.
- [ ] Sin secretos en estado persistente del navegador.
