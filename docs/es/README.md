# tela — manual en español (0.2.0)

`tela` es una capa reactiva para PenguScript/WASM. Es deliberadamente pequeña:
señales, valores derivados, efectos, bindings explícitos al DOM, listas con
clave, condicionales estructurales, plantillas declarativas y scopes. No hay
router dentro de `tela` (usa `std.web.router`), ni SSR, ni CSS-in-JS, ni DOM
virtual.

## Instalación

```toml
[dependencies.tela]
path = "../tela"
```

```pengu
import tela
```

## Modelo base

```pengu
rune App:
    count as tela.Signal of int
    zero as tela.Signal of bool

weave app into ref to App:
    static var a as App is with count is (calling tela.signal with 0), zero is (calling tela.signal with true)
    return sigil of a
```

`main` termina mientras el navegador mantiene vivo el DOM; por eso el estado
vive en un `static var` local de función (o en memoria poseída por él). El
lenguaje prohíbe variables mutables de módulo.

## Señales

```pengu
weave signal shard T with initial as T into Signal of T
enchanting Signal shard T:
    weave get into T
    weave set with v as T into void
    weave update with f as (weave with v as T into T) into void
    weave dispose into void
```

`set` marca a los suscriptores y agenda un flush. Los handlers de eventos
hacen flush al final del despacho; fuera de un handler llama a
`tela.flush_now()` en tests nativos. `batch` agrupa escrituras.

Las señales registradas con `register_*` son propiedad del registry y se
liberan con `shutdown`; una señal sin registrar es del llamador y se libera con
`dispose` (que panic si está registrada).

## Derivados

```pengu
weave is_zero with n as int into bool:
    return n == 0

var d as tela.Derived of int, bool is calling tela.derived1 with is_zero, a->count
calling d.get
```

`derived1<A, B>(f, source)` devuelve `Derived of A, B`. `get` recalcula en cada
lectura y registra la dependencia del observer actual; es correcto, no cachea.

## Efectos y scopes

```pengu
var e as tela.Effect is calling tela.effect with tick, (transmute 0 to ref to void)
calling tela.dispose_effect with e
```

Los efectos corren al crearse y de nuevo cuando cambia una señal leída. Un
`Scope` agrupa suscripciones y limpiezas:

```pengu
var sc as tela.Scope is calling tela.scope
calling tela.scope_add with sc, (calling tela.bind_int with node, a->count)
calling tela.on_cleanup with sc, cleanup_fn, ctx
calling tela.scope_dispose with sc
```

`tela.shutdown` libera el montaje, las señales registradas y los scopes. No
uses el runtime después.

## Registry y bindings declarativos

```pengu
calling tela.register_int with "count", a->count
calling tela.register_bool with "is_zero", a->zero
calling tela.register_handler with "inc", on_inc
calling tela.mount with "#app"
```

| Atributo | Efecto |
|---|---|
| `data-tela-text="name"` | `textContent` desde una entrada de texto |
| `data-tela-html-unsafe="name"` | `innerHTML` crudo; el usuario escapa |
| `data-tela-show="name"` | alterna el atributo `hidden` |
| `data-tela-if="name"` | conserva/reconstruye el nodo según `Signal<bool>` |
| `data-tela-value="name"` | input two-way string |
| `data-tela-value-int="name"` | input two-way int (texto inválido se ignora) |
| `data-tela-value-float="name"` | input two-way float |
| `data-tela-checked="name"` | checkbox two-way, `Signal<bool>` |
| `data-tela-attr-NAME="name"` | asigna el atributo `NAME` |
| `data-tela-class-NAME="name"` | alterna la clase `NAME` |
| `data-tela-style-PROP="name"` | asigna `style.PROP` |
| `data-tela-on-EVENT="handler"` | handler delegado (`click`, `keydown`, `submit`, `input`, `change`) |
| `data-tela-each="name"` | lista declarativa con clave |

Los nombres son identificadores planos; no hay parser de expresiones. El
registro presta la señal. Los nombres duplicados panic. Un `data-tela-*`
desconocido panic al montar.

`data-tela-if` clona la plantilla una vez y la sustituye por un comentario
ancla. Mientras la condición es verdadera el clon permanece; al pasar a falsa se
liberan el clon y sus suscripciones, y se vuelve a clonar en el siguiente true.
`data-tela-each` reconstruye cada fila mediante un binder explícito, sin
reflexión de campos.

## Listas declarativas

```pengu
weave key with item as ref to Task into string:
    return item->id

weave bind_row with item as ref to Task, node as tela.Elem into void:
    ...

calling tela.register_each of Task with key, bind_row, "tasks", a->tasks
```

```html
<ul>
  <template data-tela-each="tasks">
    <li><span data-field="title"></span></li>
  </template>
</ul>
```

`register_each` recibe primero los callbacks (limitación del parser), luego el
nombre y la señal. La plantilla se clona por clave; `bind_row` rellena el clon
al crearlo y en cada actualización. Las claves eliminadas se liberan y se
quitan. El binder posee la identidad; `data-tela-key` se ignora.

## Listas y condicionales programáticos

```pengu
var sub as tela.Subscription is calling tela.each with key, render, update, container, signal
var c as tela.Subscription is calling tela.conditional with then_view, else_view, container, cond
```

`each` reutiliza nodos por clave y los ordena según la fuente. Los callbacks de
`conditional` llevan un `dummy as int` porque este compilador pierde el alias
`dom.Element` en tipos de función sin argumentos.

## Eventos

Los eventos comunes (`click`, `keydown`, `submit`, `input`, `change`) se
delegan: un listener en `document` y `closest("[data-tela-on-EVENT]")` sube
desde el target real. Un click en un hijo de un botón funciona. El handler
recibe `event.Event`; para el target usa `event.target` + `dom.wrap`. Otros
eventos usan un listener por nodo.

## Formularios

```pengu
calling tela.register_value_int with "age", a->age
calling tela.register_value_float with "score", a->score
```

`data-tela-value-int` / `-float` parsean en `input`; un valor inválido conserva
el anterior. Los checkboxes usan `data-tela-checked`. Los `<select>` usan
`data-tela-value` con una señal string.

## Router

`std.web.router` expone hash e History:

```pengu
calling router.navigate_history with "/board", false
calling router.on_history_change with on_route
calling router.off_history with listener
```

`navigate_history` llama a `pushState`/`replaceState` y no emite `popstate`;
renderiza después. El listener se libera explícitamente.

## Ciclo de vida

`mount(selector)` recorre el root y sus descendientes con `query_all_under`,
conecta atributos, instala listeners delegados y guarda handles de nodos.
`unmount()` libera suscripciones, listeners y handles; `shutdown()` además
libera señales registradas, scopes y binders `each`.

## Límites (0.2.0)

- Sin SSR, hidratación, CSS-in-JS ni DOM virtual.
- Señales single-thread y solo en el hilo principal.
- Los valores de `Signal` deben ser copiables (primitivos, strings, listas,
  runes sin `Drop`).
- `data-tela-each` usa binder; no hay registry de nombres de campo.
- No hay recursos async integrados; usa `std.web.js.fetch` con callbacks
  explícitos y limpieza con `Scope`.
- La interpolación de métodos genéricos es una limitación del compilador:
  asigna a una variable local primero.
