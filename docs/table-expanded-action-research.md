# Acción para asociar productos en la tabla expandida

## Decisión

Mostrar `Asociar producto` como la última fila accionable del bloque expandido.

La fila debe usar el mismo ancho, fondo y retícula que las publicaciones seller. El contenido empieza en la columna Producto, alineado con los datos de esas filas. No debe verse como un botón redondeado dentro de un pie independiente.

Tratamiento recomendado:

- altura de 40 a 48 px;
- un solo divisor superior de 1 px;
- fondo transparente en reposo;
- icono de enlace o suma de 16 px y texto `Asociar producto`;
- área clicable de al menos 40 a 44 px de alto;
- hover con el mismo fondo suave que una fila de tabla;
- foco visible;
- sin pill, borde propio ni fondo gris permanente.

El drawer sigue siendo el lugar donde se buscan y seleccionan productos. La fila solo abre ese flujo.

## Por qué encaja

Carbon separa las acciones globales, que van en la toolbar de la tabla, de las acciones relacionadas con una fila, que deben vivir dentro de esa fila. También reserva la expansión para información suplementaria y recomienda mover las tareas que necesitan más espacio a una página o panel lateral. En este caso, `Asociar producto` pertenece al grupo expandido y abre un drawer, así que no corresponde a la toolbar global ni necesita un CTA independiente. [Carbon, uso de data tables](https://carbondesignsystem.com/components/data-table/usage/)

La especificación visual de Carbon mantiene los paneles expandidos en la misma capa de la tabla, con indentación interna, y ofrece alturas de fila de 32, 40 y 48 px. Eso respalda una pseudo-fila compacta alineada con los hijos, no un footer alto con un botón flotando dentro. [Carbon, estilo de data tables](https://carbondesignsystem.com/components/data-table/style/)

Material mantiene las acciones que controlan una tabla directamente arriba o abajo de ella. Sus tablas conservan continuidad entre filas, sin elevación por fila. El mismo principio favorece una acción integrada al borde inferior del grupo. [Material Design 2, data tables](https://m2.material.io/components/data-tables)

Shopify trata las listas tabulares como superficies de escaneo. Las acciones masivas aparecen después de seleccionar elementos y las acciones de una fila permanecen ligadas a esa fila. `Asociar producto` no es una acción masiva sobre toda la tabla, sino una acción contextual sobre las publicaciones del master abierto. [Shopify, Index table composition](https://shopify.dev/docs/api/app-home/patterns/compositions/index-table), [Shopify, Table](https://shopify.dev/docs/api/app-home/web-components/layout-and-structure/table)

Atlassian define Table Tree como una tabla expandible para jerarquías. Su guía de botones advierte que el estilo sutil funciona cuando el contexto ya comunica interacción, por ejemplo en una toolbar o grupo. El pill gris actual queda fuera de esa gramática. Una fila completa con hover y foco conserva la baja prominencia sin perder la señal de que se puede pulsar. [Atlassian, Table Tree](https://atlassian.design/components/table-tree), [Atlassian, buttons](https://atlassian.design/guidelines/product/components/buttons)

## Patrón propuesto

```text
┌ publicación Falabella ──────────────────────────────────────────┐
│ datos del seller                         switch       ⋯          │
├──────────────────────────────────────────────────────────────────┤
│      ⛓  Asociar producto                                        │
└──────────────────────────────────────────────────────────────────┘
```

La fila debe compartir la indentación izquierda de la publicación seller. No debe ocupar una celda visual bajo Precio, Stock o Estado. Es una acción del conjunto de asociaciones, aunque su etiqueta viva en la primera columna para mantener el patrón de lectura.

## Alternativas descartadas

- **Botón pill en un footer.** Parece un control de otra sección y añade una superficie dentro de otra superficie.
- **Botón primario.** Compite con las acciones principales de la página aunque solo abre un flujo contextual.
- **Toolbar de la tabla.** Carbon reserva ese lugar para acciones que afectan la tabla completa.
- **Acción en el menú de cada seller.** Asociar agrega una publicación al master; no opera sobre un seller existente.

