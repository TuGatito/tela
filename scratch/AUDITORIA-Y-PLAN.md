# Auditoría de viabilidad y plan por fases — `tela`

**Fecha:** 2026-11-08  
**Repositorio de la librería:** `/home/tugatito/Documentos/GitHub/tela`  
**Compilador auditado:** `/home/tugatito/Documentos/GitHub/PenguScript` (`psc 0.54.0`, F13)  
**Alcance:** MVP de `tela` + ejemplos + documentación en inglés y español.  
**Estado:** auditoría y plan. **No se implementa nada hasta recibir el visto bueno.**

---

## 1. Resumen ejecutivo

**Veredicto: la idea es factible, pero el diseño tal como está escrito no compila ni es seguro en PenguScript/WASM.** No es un problema de concepto: la filosofía de `tela` encaja muy bien con Pengunic (estado explícito, sin eval, sin VDOM, HTML como estructura y PenguScript como comportamiento). El problema es que el diseño usa varios mecanismos que el lenguaje **no tiene** o que el compilador **implementa con bugs**:

1. **No hay closures capturantes.** Las lambdas de PenguScript son funciones C estáticas sin captura. El diseño usa `lambda into ...` capturando `count_global`, `cards`, `next_id`, etc. Eso no existe.
2. **No hay `var`/`let` de nivel de módulo.** El estado global mutable está prohibido (`E0002`). El ejemplo del contador declara `var count_global as tela.Signal of int` en el módulo; no compila. El patrón viable es un `static var` **dentro de una función** (singleton explícito) o un dueño explícito en un `rune`.
3. **`main` retorna y sus locales mueren.** En WASM, `main` termina y los listeners del DOM siguen vivos. Cualquier señal/efecto que viva en un local de `main` queda colgando. El `defer banish cards` del diseño es, directamente, un use-after-free en cuanto el DOM reaccione después de `main`.
4. **`std.functor` está roto en 0.54.0.** El compilador no sustituye parámetros de tipo dentro de tipos función (`TkFn`), así que `Fn1<int,int>` y `Fn1<string,bool>` en el mismo binario generan C incompatible. `std.functor` se anuncia como la respuesta a “necesito closures”, pero hoy no se puede usar en un build normal.
5. **`std.web.dom` no tiene traversal ni inserción.** No hay `attribute_names`, `children`, `parent`, `first/next`, `insert_before` ni `remove_child`. Sin `insert_before` no hay reconciliación keyed; sin `attribute_names` no se puede escanear `data-tela-*`.
6. **La formatación genérica tiene un bug silencioso.** `"{calling signal.get}"` dentro de una interpolación emite `pengu_string_format_ex("%s", "")`: cadena vacía, sin diagnóstico. En una librería de texto reactivo eso es crítico.
7. **Los callbacks del DOM no llevan contexto.** `dom.on` usa un puntero a función C sin `user_data`. `bind_value`, `data-tela-on-*`, filas de listas, etc. no pueden capturar la señal o el ítem. Hay que usar el DOM como contexto (`data-*`) o un registro global explícito.
8. **`derive Drop` no es la estrategia correcta para las señales.** El diseño asume que las señales se limpian solas al salir de `main`; justo lo contrario de lo que necesita una app WASM: las señales deben sobrevivir a `main` y ser propiedad del runtime.

Nada de esto invalida `tela`. Significa que hay que **rediseñar la propiedad de estado y la API de callbacks**, añadir tres primitivas a `std.web.dom`, y arreglar cuatro bugs del compilador antes de escribir la librería. Con esos cambios, el MVP es viable y puede quedar en el entorno de 2.000–2.800 LOC que planteaste, aunque el esfuerzo real es mayor que “un fin de semana”: cálculo honesto, **15–20 jornadas de trabajo concentrado**, repartidas en fases.

### Lo que se conserva del diseño

- `HTML` declara estructura; `PenguScript` declara comportamiento.
- Los `data-tela-*` contienen **nombres**, nunca expresiones. Sin eval, sin parser de expresiones.
- Reactividad de grano fino, sin VDOM, sin diff de árbol.
- Componentes = funciones que devuelven `dom.Element`.
- Sin router, sin SSR, sin CSS-in-JS, sin store global tipo Redux.
- Listas keyed y condicionales estructurales como primitivas.
- Nombres y API pequeños; documentación como parte de la API.

### Lo que hay que cambiar sí o sí

| Diseño original | Realidad | Cambio obligatorio |
|---|---|---|
| `lambda into ...` capturando locales | Lambdas sin captura | Funciones top-level + `ctx` opaco; `derived1/2/3`, `effect_with`, `batch_with` |
| `var` global de módulo | Prohibido (`E0002`) | `static var` dentro de una función `state()` / `runtime()`; estado explícito con dueño |
| `Signal`/`Derived`/`Effect` con `derive Drop` | `main` retorna antes que el DOM | Runtime con arena de celdas; handles copiables; `dispose`/`shutdown` explícitos |
| `Subscription` con `derive Drop` | Se destruiría al salir de `main` | `Subscription` = id de runtime; `dispose(sub)` explícito; `mount`/`shutdown` limpian |
| `self.value` | `self` es puntero | `self->value` |
| `x.get` | Se parsea como campo | `calling x.get` |
| `data-tela-html` | Riesgo XSS | `data-tela-html-unsafe`, explícito |
| `data-tela-if` y `data-tela-each` en v0.1 | El propio diseño los pasa a v0.2 | v0.1: `data-tela-show` + `tela.when` + `tela.each` |
| `std.tela` | `std/` es el stdlib del compilador; esta librería es externa | `import tela`; `std.tela` solo si se upstreama al compilador |

---

## 2. Cómo se auditó

No se leyó el diseño y se opinó: se probó contra el compilador real.

- `build/psc --version` → `0.54.0`.
- Se compilaron y ejecutaron prototipos en `/tmp/telaprobe` con `psc build`, `psc run`, `psc test`, `--target wasm`, `--browser`.
- Se inspeccionó el C generado con un wrapper de `--cc` para capturar `build/bundle.c`.
- Se leyeron `docs/LANGUAGE.es.md`, `docs/PENGUNIC.es.md`, `docs/LIBRARIES.es.md`, `docs/WASM.md`, `docs/EXTERNAL_MODULES.md`, `docs/STDLIB.es.md`, `docs/DEBUGGER.md`.
- Se probaron: señales, derivados, efectos, `static var`, `Drop`, `Forma`, conceptos, filas genéricas, `Rc`, listas COW, registros type-erased, `psc add`, `psc run --browser`.

Comandos representativos:

```bash
cd /home/tugatito/Documentos/GitHub/PenguScript
build/psc build /tmp/telaprobe/mini4.pengu
build/psc test  /tmp/telaprobe/mini2t.pengu
build/psc run examples/web/hello_app.pengu --target wasm --browser
```

`psc run --target wasm --browser` funciona de extremo a extremo: compila, levanta un servidor local, lanza Chromium headless, carga `.html`, `.wasm` y `.js`, y sale con código 0. Eso da un camino real de test de integración en navegador, no solo en Node.

---

## 3. Auditoría del diseño, sección por sección

### §1. Nombre `std.tela`

**Veredicto: el nombre `tela` es bueno; el prefijo `std.` no corresponde a este repo.**

`tela` es corto, real, evoca el telar y no choca con nada del stdlib. Pero `std/` es el árbol del compilador (`PenguScript/std/`). Esta librería vive en su propio repo, se instala con `psc add` y se importa por el nombre del paquete:

```pengu
import tela as tela
```

No `import std.tela`. Si algún día se upstreama al compilador, se puede renombrar a `std.tela`; para el MVP, `tela` es lo correcto y evita dos releases acoplados. Esto hay que decidirlo antes de escribir la documentación.

Alternativas: `trama`, `frons`, `ligamen`. Mi voto sigue siendo `tela`.

### §2. Los seis invariantes

**Veredicto: correctos y compatibles con Pengunic.** Se conservan todos. Dos matices:

- “Estado explícito y con dueño” no significa “cada señal es un `Drop` local”. En WASM el dueño natural es el runtime de la app, que vive hasta el final de la página. Un `Drop` local en `main` es un error de propiedad, no una virtud.
- “Pequeño, ~2000 LOC” es alcanzable, pero la reconciliación keyed y el runtime de efectos son la mayor parte. Cuenta 2.200–2.800 LOC con tests y documentación, no 2.000 exactas.

### §3. Modelo mental HTML ↔ PenguScript

**Veredicto: válido.** `mount` escanea y conecta; el HTML es scaffold. La única corrección es que el registro de nombres debe ser **tipado por categoría** (`text`, `bool`, `value`), no un `map of string to opaque` único. Si no, `data-tela-class-active="title"` intentaría usar una señal de texto como booleana y fallaría en runtime. El registro debe saber qué operación es válida para cada entrada.

### §4. Señales

#### 4.1 Tipos

El diseño propone:

```pengu
rune Signal shard T derive Drop:
    id as u64
    _inner as ref to opaque
```

**No es viable tal cual.**

- `derive Drop` en un local de `main` destruye la señal al retornar `main`, pero los listeners del DOM siguen vivos. El ejemplo del diseño incluso hace `defer banish cards` antes de `tela.each(...)`: eso es un use-after-free.
- `ref to opaque` no existe como tipo del lenguaje; hay `ref to void`, pero un `ref to void` no sabe liberar `T` ni conoce sus suscriptores.
- `id as u64` + `_inner` obliga a un registro global para resolver id → celda; ese registro es exactamente el runtime que el diseño intenta evitar.

**Diseño corregido:** runtime con arena de celdas, propiedad explícita del runtime, handles copiables.

```pengu
# Interno, no público.
rune Cell shard T:
    value as T
    subs as list of ref to Observer
    live as bool

# Público: handle copiable, sin Drop.
rune Signal shard T:
    cell as ref to Cell of T
```

`tela.signal(initial)`:

1. Pide al runtime una celda `Cell<T>`.
2. La registra en la arena del runtime con un destructor monomorfizado (`destroy_cell of T`).
3. Devuelve un `Signal<T>` que apunta a la celda.

Ciclo de vida:

- Las celdas viven hasta `tela.shutdown()` (fin de app / fin de tests / desmontaje total de una SPA).
- `Signal` es un handle copiable; no tiene `Drop`; no se puede “liberar” una señal individual en v0.1. Es una decisión consciente: la app es dueña de su estado durante toda su vida, y el runtime es el dueño explícito.
- `tela.shutdown()` falla si hay un `mount` activo; primero `unmount`, luego `shutdown`. Así no se liberan celdas mientras hay bindings vivos.

Esto es más Pengunic que el `Drop` original: el dueño es explícito y conocido (el runtime), no un destructor implícito que depende de dónde se declaró la variable.

**Consecuencia:** `Signal<T>` no puede contener `T` que sea `derive Drop` y a la vez devolver `T` por valor en `get`. `get` devuelve una copia; por tanto `T` debe ser copiable (primitivos, `string`, listas COW, runes sin `Drop`) o `Rc<T>`. Documentarlo como restricción de la API. Para el MVP alcanza: `int`, `bool`, `string`, `list of Card`, `list of Todo`.

#### 4.2 API

La API propuesta es correcta en espíritu, pero las firmas con `lambda` no existen. Propuesta:

```pengu
weave signal shard T with initial as T into Signal of T

weave derived1 shard A, B with
    source as Signal of A,
    f as ref to weave with a as A into B
into Derived of B

weave derived2 shard A, B, C with
    sa as Signal of A,
    sb as Signal of B,
    f as ref to weave with a as A, b as B into C
into Derived of C

weave derived3 shard A, B, C, D with
    sa as Signal of A,
    sb as Signal of B,
    sc as Signal of C,
    f as ref to weave with a as A, b as B, c as C into D
into Derived of D

weave effect with
    run as ref to weave into void
into Subscription

weave effect_with shard C with
    run as ref to weave with ctx as ref to C into void,
    ctx as ref to C
into Subscription

weave batch with
    work as ref to weave into void
into void

weave batch_with shard C with
    work as ref to weave with ctx as ref to C into void,
    ctx as ref to C
into void

enchanting Signal shard T:
    weave get into T
    weave set with v as T into void
    weave update with f as ref to weave with v as T into T into void
    weave update_with shard C with
        f as ref to weave with v as T, ctx as ref to C into T,
        ctx as ref to C
    into void

enchanting Derived shard T:
    weave get into T
```

`derived1` construye un contexto interno `Derived1Ctx<A,B>` con la señal fuente y el puntero a `f`, y un thunk monomorfizado `derived1_run of A, B` que hace:

```pengu
var c as ref to Derived1Ctx of A, B is transmute ctx to ref to Derived1Ctx of A, B
var a as A is calling c->source.get
return calling c->f with a
```

No hay closure; hay un `ctx` explícito y un puntero a función monomorfizado. Es exactamente el patrón de `std.functor`, pero con tipos propios de `tela` para no depender de `std.functor` hasta que el compilador lo arregle.

#### 4.3 Semántica

- `set` escribe la celda, marca suscriptores dirty y agenda un flush.
- `get` devuelve el valor actual y, si hay un observer activo, registra la dependencia.
- `Derived.get` recalcula si está dirty; durante el cálculo se registra a sí mismo como observer, de modo que las dependencias se descubren dinámicamente.
- `effect` corre inmediatamente y se re-ejecuta cuando cambian sus dependencias.
- `batch` agrupa; dos `set` en el mismo turno ya se agrupan.
- El flush se agenda en **microtask** si `queueMicrotask` está disponible; si no, `set_timeout(0)` (macrotask) y se documenta la diferencia. `tela.flush()` es público para tests y para quien necesite sincronía.

**Por qué `queueMicrotask`:** el diseño acierta en que un flush sincrónico por `set` dispara renders de más. `set_timeout(0)` también agrupa, pero deja pasar tareas de layout/paint y puede producir un frame intermedio. `queueMicrotask` es el comportamiento correcto y está disponible en el navegador; `psc` no necesita `eval` para llamarlo: `js.call_method(js.global, "queueMicrotask", [cb])` con `js.make_callback`. Hay que probarlo en el navegador antes de fijarlo; si el bridge no lo expone, se usa `set_timeout(0)` y se documenta.

#### 4.4 Concurrencia

Correcto: single-thread, hilo principal, sin workers. Documentarlo como restricción, no como bug.

### §5. Binding declarativo

#### 5.1 Registro

El registro debe ser **tipado por categoría**, no un `map of string to Entry` donde todo cabe. Propuesta:

```pengu
enum EntryKind:
    Text
    Bool
    Value
    Checked

rune Entry:
    kind as EntryKind
    get_text as maybe (ref to weave with ctx as ref to void into string)
    get_bool as maybe (ref to weave with ctx as ref to void into bool)
    get_value as maybe (ref to weave with ctx as ref to void into string)
    set_value as maybe (ref to weave with ctx as ref to void, v as string into void)
    ctx as ref to void
```

- `register_text<T where T: Forma>(name, s Signal<T>)`
- `register_bool(name, s Signal<bool>)`
- `register_value(name, s Signal<string>)`
- `register_checked(name, s Signal<bool>)` (si se aprueba `data-tela-checked`)
- `register_handler(name, h Handler)`

Cada `register_*` crea un contexto concreto (`TextEntryCtx<T>`, `BoolEntryCtx`, `ValueEntryCtx`), lo registra en la arena y guarda en `Entry` los punteros monomorfizados. El runtime es dueño de los contextos; el usuario es dueño de la señal.

Nombres duplicados: `panic` con `tela: duplicate registration: <name>`. Es un error de programación, no un error de datos.

`register_signal` genérico del diseño se elimina: no se puede saber si una señal es texto, bool o valor sin reflexión. Tres funciones explícitas son más Pengunic y más seguras.

#### 5.2 Vocabulario de atributos

| Atributo | v0.1 | Semántica |
|---|---|---|
| `data-tela-text="name"` | sí | `textContent = text_of(signal)`; `T: Forma` |
| `data-tela-html-unsafe="name"` | sí | `innerHTML = value`; nombre explícito, documentado como XSS |
| `data-tela-show="name"` | sí | toggle del atributo `hidden` (no `style.display`) |
| `data-tela-if="name"` | **no** (v0.2) | estructural; v0.1 usa `tela.when` |
| `data-tela-attr-NAME="name"` | sí | `setAttribute(NAME, text)`; bloquear `on*` y `srcdoc` |
| `data-tela-class-NAME="name"` | sí | toggle de clase `NAME` según bool |
| `data-tela-style-PROP="name"` | sí | `style.PROP = text` |
| `data-tela-value="name"` | sí | two-way, **solo string** en v0.1 |
| `data-tela-checked="name"` | sí (propuesto) | two-way bool para checkbox; necesario para TodoMVC |
| `data-tela-on-EVENT="handler"` | sí | `addEventListener(EVENT, handler)` |
| `data-tela-each="name"` | **no** (v0.2) | v0.1 usa `tela.each` |

`data-tela-if` y `data-tela-each` aparecen en la tabla del diseño pero el propio §6.3 y §12 los mandan a v0.2. La tabla de v0.1 debe ser coherente: se quitan.

`data-tela-html` se renombra a `data-tela-html-unsafe`. No es burocracia: el nombre debe gritar el riesgo. Además, `data-tela-attr-*` debe rechazar atributos de evento (`onclick`, `onerror`, …) y `srcdoc`; si no, un nombre registrado puede inyectar JS sin pasar por `eval`. Para `href`/`src`, validar esquemas peligrosos (`javascript:`, `data:` cuando no corresponda) con `std.web.security` o una lista blanca propia.

#### 5.3 `mount`

Firma propuesta:

```pengu
weave mount with root_selector as string into result of void to Error
weave unmount into void
```

`mount`:

1. `dom.query(root_selector)`; si no existe → `error(RootNotFound)`.
2. Si ya hay un mount activo → `error(AlreadyMounted)`.
3. Escanea `root` y `dom.query_all_under(root, "*")`.
4. Para cada nodo, `dom.attribute_names`; por cada `data-tela-*`, despacha.
5. Si un nombre no está registrado, o el tipo no coincide (texto vs bool), → `error(MissingRegistration)` / `error(TypeMismatch)`, no un panic silencioso.
6. Guarda todas las suscripciones y listeners en un `MountScope` propiedad del runtime.
7. Marca `mounted = true`.

`unmount`:

1. Si no hay mount, no-op.
2. Toma el `MountScope`, lo saca del runtime y lo destruye: `dispose` de cada `Subscription`, `free_listener` de cada `dom.Listener`, `dom.free` del root si el scope lo posee (no en v0.1; el HTML es del usuario).
3. `mounted = false`.

`mount` devuelve `result` en vez de panic porque el root ausente y una registry incompleta son errores de integración, no bugs del lenguaje. El ejemplo puede hacer:

```pengu
let m as result of void to tela.Error is calling tela.mount with "#app"
if m is error:
    calling spark.panic with tela.error_message(m.error)
```

#### 5.4 `unmount`

Correcto en el diseño; se mantiene, con la salvedad de que las señales **no** se liberan en `unmount` (siguen siendo de la app). Solo se liberan bindings, efectos y listeners del mount.

### §6. Listas y condicionales

#### 6.1 `each` keyed

La forma canónica del diseño es correcta, pero la firma con `Signal of list of T` y `render_fn` que devuelve `Element` no permite actualizar una fila existente sin recrearla. Para TodoMVC eso es fatal: el input de edición pierde el foco y el estado. Propuesta con concepto `Row`:

```pengu
concept Row shard T:
    weave update with item as ref to T into void
    weave element into dom.Element

weave each shard T, R where R: Row of T with
    container as dom.Element,
    source as Signal of list of T,
    key_fn as ref to weave with item as ref to T into string,
    make_row as ref to weave with item as ref to T into R
into Subscription
```

`each` mantiene:

- `order as list of string` (keys en orden).
- `rows as map of string to RowEntry of T, R`.
- `RowEntry` con `item T`, `row R`, `element dom.Element`.

Al cambiar la lista:

1. Calcula las claves nuevas; clave duplicada → panic `tela: duplicate key`.
2. Elimina las filas cuya clave ya no está: `container.remove(el)`, `dom.free(el)`, `drop(row)`.
3. Recorre las claves nuevas en orden; para cada una:
   - Si existe: `row.update(ref item)`; mueve el nodo con `insert_before(container, el, next_ref)` si hace falta.
   - Si no existe: `make_row(ref item)`, inserta antes de `next_ref`, guarda.
4. Actualiza `order`.

`insert_before` es la pieza que falta en `std.web.dom`. Sin ella, el reconciliador solo puede append/remove y no puede reordenar. Es la adición más importante del compilador para `tela`.

**Actualización vs recreación:** `Row.update` recibe `ref to T` y actualiza solo los campos que cambiaron. Para `CardRow`, `set_text(title, item.title)`. Para `TodoRow`, alterna la clase `done`, actualiza el texto, etc. El DOM de la fila se conserva; los listeners de la fila se crean una vez.

**Ownership de la fila:** `RowEntry<T,R>` es dueño de `item` y `row`; al eliminar, se libera el elemento y se hace `drop` de la fila. `R` puede tener `Drop`; `each` lo respeta. `T` debe ser copiable para que `source.get` devuelva una lista COW; si `T` tiene `Drop`, el MVP no lo soporta y se documenta.

**Coste:** el mapa de claves da O(1) por lookup; el recorrido es O(n) más las mutaciones DOM. La primera versión puede usar una lista y búsqueda lineal O(n²) para simplificar; aun así, la API no cambia. Para el MVP, mapa + orden.

#### 6.2 `when`

```pengu
weave when with
    container as dom.Element,
    cond as Signal of bool,
    render_then as ref to weave into dom.Element,
    render_else as maybe (ref to weave into dom.Element)
into Subscription
```

`when` guarda el elemento actual y un efecto sobre `cond`. Al cambiar:

1. Si hay hijo actual, `container.remove(el)` y `dom.free(el)`.
2. Renderiza la rama correspondiente (o nada si no hay `else`).
3. `container.append(nuevo)`.

`data-tela-show` sigue siendo la vía barata para nodos pequeños; `when` es la vía estructural. La diferencia está bien explicada en el diseño y se conserva.

#### 6.3 Listas declarativas en HTML

Correcto: **v0.2**. Sin reflexión, `data-tela-each` exige registrar accessors por campo; no vale la pena en v0.1. `tela.each` con `Row` es tipado y suficiente.

### §7. Componentes

**Veredicto: válido, con una advertencia de ownership.**

Un componente es una función que devuelve `dom.Element`. No hay lifecycle ni props auto-bindeados. Pero si el componente crea bindings (`bind_text`, `effect`, `each`), esos bindings necesitan un dueño. Si el componente devuelve solo `Element` y el `Subscription` se descarta al salir de la función, el binding muere.

Dos patrones válidos:

1. **Componente sin estado reactivo interno:** devuelve `Element`; el llamador lo inserta y no hay bindings que sobrevivan.
2. **Componente con estado reactivo:** devuelve un rune con el elemento y la lista de suscripciones, y `derive Drop` (o `dispose` explícito) las libera:

```pengu
rune CardView:
    el as dom.Element
    subs as list of tela.Subscription

weave make_card_view with c as Card into CardView:
    var el as dom.Element is calling dom.create with "div"
    var subs as list of tela.Subscription is []
    # Añadir a `subs` la suscripción que devuelve bind_text.
    return with el is el, subs is subs
```

Para el MVP, los ejemplos usan `each` + `Row`, que ya resuelve el ownership. Documentar que `Subscription` no se debe ignorar si el componente puede desmontarse.

### §8. Edición directa de DOM

**Veredicto: válido.** `bind_*` programáticas son la escotilla de escape y las primitivas que `mount` usa. Se mantienen, con los cambios de firma y de ownership.

`bind_value` two-way programática necesita contexto para el listener. `dom.on` no lo tiene. Solución: el binding asigna un atributo interno `data-tela-bind="#N"`, registra el `Entry` en un mapa interno del runtime, y un handler global `on_input` lee ese atributo. Es el mismo mecanismo que el binding declarativo, sin closures y sin `eval`.

`bind_checked` se añade por la misma razón (TodoMVC). `bind_html_unsafe` se añade con nombre explícito.

### §9. Store global

**Veredicto: de acuerdo: no hay store global.** El patrón `rune AppState` con señales es el correcto, pero el ejemplo del diseño usa `var` de módulo y un `rune AppState` local en `main`; ambos mueren con `main`. El patrón corregido es un `static var` dentro de una función:

```pengu
rune AppState:
    user as tela.Signal of maybe User
    cards as tela.Signal of list of Card
    theme as tela.Signal of string

weave app into ref to AppState:
    static var s as AppState is with
        user is (calling tela.signal with none),
        cards is (calling tela.signal with []),
        theme is (calling tela.signal with "light")
    return sigil of s

weave on_add with ev as dom.Event into void:
    var s as ref to AppState is calling app
    calling s->cards.update with add_card
```

`app()` es un singleton explícito, tipado y con dueño. No es un store global implícito: es una función que devuelve el estado de la app, y los handlers la llaman por nombre. Esto sí compila y sobrevive a `main`.

### §10. Namespacing

**Veredicto: v0.1 plano con puntos es aceptable.** `"user.name"` es una clave literal; no hay resolución jerárquica. El parser de nombres no debe hacer `split(".")` para resolver nada; solo se usa como string. Documentarlo para que nadie espere scopes.

`data-tela-scope` es v0.2. Correcto.

### §11. Estructura y LOC

La estructura propuesta es razonable, pero cambia por el runtime y el `Row`:

```text
pengu/tela.pengu              # fachada, re-exports (~80)
pengu/tela/
  runtime.pengu               # arena, observers, flush, registry (~420)
  signal.pengu                # Signal, Derived, Effect, batch (~380)
  registry.pengu              # Entry, register_text/bool/value/checked/handler (~260)
  bind.pengu                  # bind_text/attr/class/style/value/checked (~420)
  each.pengu                  # Row, reconcile keyed (~480)
  when.pengu                  # when (~140)
  mount.pengu                 # scan, dispatch, MountScope (~420)
  dom.pengu                   # wrappers sobre std.web.dom (~160)
  types.pengu                 # Error, Subscription, Handler, EntryKind (~140)
  fmt.pengu                   # Forma helpers (~80)
```

Total estimado: **2.500–2.900 LOC**, más tests y docs. La reconciliación keyed sigue siendo la parte más difícil (~450–500 LOC).

### §12. Roadmap

El roadmap del diseño es correcto en espíritu, pero el orden debe cambiar: **primero se arregla el compilador, luego el runtime, luego los bindings, luego `each`**. No se puede construir `each` sin `insert_before`.

### §13. Anti-objetivos

**Veredicto: correctos.** Se conservan todos. Añadir dos:

- No habrá “expresiones” en `data-tela-*`; si alguien necesita `count + 1`, se registra un `Derived<int>`.
- No habrá `eval` ni `new Function` para callbacks; el contexto se pasa por `ctx` o por el DOM.

### §14–§15. Ejemplos

Los ejemplos del contador y de cards no compilan tal cual por:

- `var count_global` de módulo.
- `lambda` capturando.
- `self.value`.
- `x.get` sin `calling`.
- `Signal` local en `main` con `defer banish`.
- `tela.each` sin `insert_before`.
- `Card` con `id as string` y `title as string`; `Card` es copiable, bien.
- `next_id` global; hay que moverlo a `AppState` o a un `static var`.

Se reescriben en la fase de ejemplos con el patrón `state()` + `Row` + handlers top-level.

### §16. Testing

**Veredicto: correcto, pero hay que separar niveles.**

- Tests de señales/derived/effects: nativos, sin DOM; `psc test`.
- Tests de bindings/reconciler: navegador; `psc build --target wasm` + `psc run --browser` o Chromium headless.
- Tests de paquete: `tests/consumer/` con `psc add ../.. --trust`.
- No usar `test` blocks dentro de los módulos de la librería si el compilador sigue emitiendo especializaciones de test en builds normales; usar proyectos externos. Esto evita el bug de contaminación y mantiene el binario limpio.

### §17. Decisiones abiertas

Se resuelven en §12 de este documento (decisiones para el visto bueno). Mi voto:

1. Nombre: `tela`, import `tela`.
2. Prefijo: `data-tela-*`.
3. `bind_value` two-way: sí, v0.1, solo string.
4. `html`: `data-tela-html-unsafe`, crudo y documentado.
5. `Subscription`: id de runtime, `dispose` explícito; sin `Drop`.
6. Dev server: no en v0.1; `psc run --browser` cubre el smoke test.

---

## 4. Bugs y carencias del compilador

### Tabla de severidad

| ID | Severidad | Qué | Bloquea `tela`? |
|---|---|---|---|
| C1 | **Crítica** | `subst_deep` no sustituye `TkFn`; genéricos con tipos función only no se materializan; `std.functor` roto | No si se evita `std.functor`, pero es deuda técnica grave |
| C2 | **Crítica** | Especializaciones de `test` se emiten en builds normales; un test puede romper `psc build` | Sí si `tela` usa `test` blocks; no con tests externos |
| C3 | **Alta** | Interpolación de llamada a método genérico emite `""` silenciosamente | No si se usa `var v T` + `"{v}"`; sí para la calidad del lenguaje |
| C4 | **Alta** | Método de concepto genérico con `essence of item` genera conversión `void*` inválida | No si se usan filas concretas; sí para `Row` genérico |
| C5 | **Media** | `Fn1<A, void>` genera C inválido (`void fallback`) | No si `Handler` no es genérico |
| C6 | **Alta** | `std.web.dom` sin `attribute_names`, `query_all_under`, `insert_before` | **Sí, bloquea `mount` y `each`** |
| C7 | **Media** | Docs desactualizadas: `assert`, `static var`, `Drop` genérico, `self->` | No compila mal, pero induce a error |

### C1. Genéricos con tipos función: `TkFn` no se sustituye

Repro mínimo (`/tmp/telaprobe/mini4.pengu`):

```pengu
rune Fn1 shard A, R:
    fn_ptr as ref to weave with ctx as ref to void, a as A into R
    ctx as ref to void
```

Con `Fn1 of int, int` y `Fn1 of string, bool` en el mismo `main`, `psc build` falla:

```text
mini4.pengu:10:28: error: initialization of ‘_Bool (*)(void *, PenguString)’
from incompatible pointer type ‘int32_t (*)(void *, int32_t)’
mini4.pengu:14:37: error: initialization of ‘int32_t (*)(void *, int32_t)’
from incompatible pointer type ‘_Bool (*)(void *, PenguString)’
```

El C generado contiene **una sola** struct base:

```c
struct Fn1 { bool (*fn_ptr)(void*, PenguString); void* ctx; };
```

y métodos con `Fn1*` y tipos de campo de la última instanciación. No hay `Fn1__int__int` ni `Fn1__string__bool`.

Causa localizada:

- `src/psc/sema/generics/instantiate.pengu:143` `subst_deep` no tiene rama `TkFn`; cae en `subst_type` y deja los parámetros dentro de la función sin sustituir.
- `has_param` (~línea 99–140) tampoco tiene `TkFn`.
- `type_mentions_param` sí lo tiene.
- `instantiate_nominal` (`:361`) crea la instancia y sustituye campos con `subst_deep`; si el campo función queda con `T`, la instancia no es concreta.
- `src/psc/codegen/generics.pengu:703`/`:739` materializan el receiver, pero si la instancia ya existe con campos no concretos, no se corrige.

**Fix:** añadir `TkFn` a `subst_deep` y `has_param`, construyendo un nuevo `SemaFnInfo` con params/return sustituidos e internando el `TkFn`. Añadir regresión: `Fn1<int,int>` + `Fn1<string,bool>` en un build; `std.functor` completo; `Fn1<string,bool>` en un test y en main.

**Workaround para `tela`:** todo genérico de `tela` debe tener un campo de datos directo o anidado que mencione `T` (`value T`, `items list of T`, `signal ref to Signal<T>`). `Signal<T>`, `Derived<T>`, `RowEntry<T,R>` lo cumplen. `std.functor` no. Aun así, el fix es obligatorio por el lema de cero deuda.

### C2. Especializaciones de test contaminan el build de producción

Repro (`/tmp/telaprobe/mini2t.pengu`): `Fn1<int,int>` en `main` + un `test` que instancia `Fn1<string,bool>`. `psc build` y `psc test` fallan con los mismos errores de C.

Causa:

- Los cuerpos `test` se comprueban semánticamente en **todos** los modos (documentado en `PENGUNIC.es.md` §24.1).
- `src/psc/codegen/bundle.pengu` emite toda especialización con `if calling dce.live with reach, i or pf.is_spec:` (~línea 318), sin mirar el origen.
- `src/psc/codegen/testgen.pengu:53` solo emite los tests bajo `is_test`, pero las especializaciones ya están en el catálogo.

**Fix:** marcar el origen de cada especialización (test vs producción) y no emitir las de test en builds normales; o hacer DCE real desde raíces no-test. Añadir test: `psc build mini2t` debe compilar y el C no debe contener `Fn1__string__bool`.

**Nota:** incluso con C1 arreglado, C2 infla binarios y puede romper builds. Es un bug independiente.

### C3. Interpolación de método genérico → cadena vacía

Repro (`pair.pengu`, `f.pengu`):

```pengu
var p as Pair of int, int is ...
calling spark.println with "{calling p.first}"
```

Genera `pengu_string_format_ex("%s", "")` y no avisa. Asignar a una variable primero funciona:

```pengu
var x as int is calling p.first
calling spark.println with "{x}"
```

**Fix:** en el lowering de interpolación, tratar `calling`/método como expresión normal; si no se puede, emitir un error explícito, nunca `""`. Añadir test de codegen/interpolación.

**Workaround para `tela`:** `text_of<T>` usa `var v as T is calling s.get; return "{v}"`, que funciona. No interpolar `calling s.get` directamente. Pero el bug debe arreglarse.

### C4. Método de concepto genérico: `essence of item` desde `ref to T`

Repro (`concept3.pengu`):

```pengu
rune PlainRow shard T:
    value as T

bind PlainRow with Row:
    weave update with item as ref to T into void:
        set self->value is essence of item
```

Falla C:

```text
error: la asignación a ‘int32_t’ ... desde ‘void *’
crea un entero desde un puntero sin una conversión [-Wint-conversion]
```

El método genérico del concepto pierde el tipo concreto de `T` y trata `item` como `void*`. **Fix:** conservar la sustitución de `T` en métodos de concepto genéricos, o rechazar la forma con un diagnóstico claro si no se va a soportar en 0.55.0.

**Workaround para `tela`:** filas concretas (`CardRow`, `TodoRow`) con `bind CardRow with Row of Card`; `concept2.pengu` demuestra que funciona. `Row` genérico queda para v0.2 o para después del fix.

### C5. `void` como argumento genérico

`Fn1 of int, void` genera:

```c
void Fn1_call_or_inst117(Fn1* self, int32_t a, void fallback);
```

y errores de `void (*)`. **Fix:** o soportar `void` como tipo de retorno en instancias (con `Unit` interno), o rechazarlo con `E__` claro. Para el MVP, `tela.Handler` es un alias no genérico que devuelve `void`; no se usa `Fn1<_, void>`.

### C6. Falta de primitivas DOM

`std/web/dom.pengu` es un bridge JS puro (no hay `std_c/web`); añadir funciones es cambio de `.pengu`, no de C. Faltan:

```pengu
weave attribute_names with el as Element into list of string
weave query_all_under with root as Element, selector as string into list of Element
weave insert_before with
    parent as Element,
    child as Element,
    reference as maybe Element
into result of void to js.JsError
```

- `attribute_names`: `el.attributes` → `length`, `item(i).name`.
- `query_all_under`: `root.querySelectorAll(selector)` → lista de `Element`.
- `insert_before`: `parent.insertBefore(child, reference)`; `js.NULL` para “append”.

Cada una necesita su rama `when wasm:` y `when not wasm:` (stub que panic). Documentar en `docs/WASM.md`.

`remove` ya existe; no hace falta `remove_child`. `create_fragment` es opcional para `when` multi-nodo; no en v0.1.

### C7. Documentación desactualizada

- `docs/LIBRARIES.es.md:275-307` usa `assert got == 5`; `assert` no es keyword. El ejemplo debe usar `import std.ward` + `calling ward.assert_eq_int`.
- `docs/PENGUNIC.es.md:2635` dice “Un `static var` de nivel de módulo vive todo el programa”; el parser solo acepta `static var` dentro de una `weave`. Corregir a “un `static var` local de una función vive todo el programa”.
- `docs/LANGUAGE.es.md` §13.9 dice que `derive Drop` genérico y campos `maybe`/`result` están prohibidos; el compilador acepta `derive Drop` genérico con `value T` y genera cleanup. Verificar la regla real y alinear docs/chequeo.
- `self.field` no está documentado como error; añadir “`self` es puntero, usa `self->field`”.
- `std.functor` se documenta como solución a closures, pero está roto por C1; o se arregla antes de la 0.55.0, o se marca como experimental.
- `Forma` y llamadas genéricas con `where` necesitan argumentos de tipo explícitos en algunos casos (`calling reg of int`); documentarlo.

### Versión y alcance del cambio

El conjunto C1–C7 es un cambio **grande** de compilador: sema, codegen, stdlib y docs. Propuesta: **`0.54.0` → `0.55.0`** (no `0.54.1`), con:

- `VERSION` = `0.55.0`.
- `CHANGELOG.md` con sección `0.55.0`.
- `docs/LANGUAGE.es.md` y `docs/LANGUAGE.md`.
- `docs/PENGUNIC.es.md` y `docs/PENGUNIC.md`.
- `docs/LIBRARIES.es.md` y `docs/LIBRARIES.md`.
- `docs/WASM.md`.
- `docs/STDLIB.es.md` / `docs/STDLIB.md` si se añaden funciones DOM.
- `std/web/dom.pengu` con doc comments `##`.
- `std/functor.pengu` con tests (si C1 se arregla).

Si por tiempo se decide no arreglar C1/C2/C3/C4 en la primera entrega, entonces **no se puede decir que `tela` tenga cero deuda**: se estaría construyendo sobre bugs conocidos. Mi recomendación es arreglarlos antes de la fase 2.

---

## 5. Arquitectura propuesta para `tela` v0.1

### 5.1 Diagrama de capas

```text
HTML (data-tela-*)
        │ mount escanea
        ▼
┌──────────────────────────────────────┐
│ mount / registry / bind              │
│  - Entry tipada (text/bool/value)    │
│  - Subscription = id de runtime      │
│  - MountScope                        │
└──────────────────────────────────────┘
        │ efectos
        ▼
┌──────────────────────────────────────┐
│ runtime (static var singleton)        │
│  - arena de Cell<T> / DerivedCell<T>  │
│  - observers, dirty, flush            │
│  - registry, handlers, subscriptions  │
│  - current_observer                   │
└──────────────────────────────────────┘
        │ get/set
        ▼
┌──────────────────────────────────────┐
│ signal / derived / effect / batch     │
│  - sin closures; fn + ctx             │
└──────────────────────────────────────┘
```

### 5.2 Runtime

```pengu
rune Runtime:
    cells as list of CellRecord
    derived as list of DerivedRecord
    effects as map of u64 to EffectRecord
    entries as map of string to Entry
    handlers as map of string to Handler
    current_observer as maybe (ref to Observer)
    flush_scheduled as bool
    batch_depth as int
    next_id as u64
    mount_scope as maybe MountScope
    mounted as bool
```

`runtime()`:

```pengu
weave runtime into ref to Runtime:
    static var r as Runtime is with ...
    return sigil of r
```

Es el único singleton global, privado y con nombre; no es estado de usuario. `tela.shutdown()` lo limpia y lo deja reutilizable en tests.

`Observer`:

```pengu
rune Observer:
    run as ref to weave with ctx as ref to void into void
    ctx as ref to void
    deps as list of ref to void
    subs as list of ref to Observer
    dirty as bool
    live as bool
    kind as ObserverKind   # Effect o Derived
```

`Signal.get`:

1. Lee `cell->value`.
2. Si `current_observer` está presente y `cell` no está en `obs->deps`, añade `obs` a `cell->subs` y `cell` a `obs->deps`.
3. Devuelve una copia.

`set`:

1. Escribe `cell->value`.
2. Para cada `obs` en `cell->subs`: `mark_dirty(obs)`.
3. `schedule_flush()`.

`mark_dirty(obs)`:

- Si ya dirty, no hace nada.
- Marca dirty.
- Si `obs.kind == Derived`, propaga a `obs.subs`.
- Si es Effect, no propaga.

`flush`:

1. Si `batch_depth > 0`, no hace nada.
2. `flush_scheduled = false`.
3. Recorre los efectos en orden de creación; si `live && dirty`, limpia deps, marca `current_observer`, corre `run(ctx)`, restaura, `dirty = false`.
4. Si un efecto hace `set`, se agenda otro flush; limitar a N iteraciones (p. ej. 100) y panic `tela: flush loop` para no colgarse.

`Derived.get`:

- Si dirty: limpia deps, se pone como observer, corre `compute(ctx)`, guarda value, restaura, dirty = false.
- Devuelve copia.

`batch`:

- `batch_depth += 1`; ejecuta; `batch_depth -= 1`; si 0 y hay dirty, `schedule_flush()`.

`schedule_flush`:

- Si ya agendado, no-op.
- `queueMicrotask(flush)` si está disponible; si no, `set_timeout(flush, 0.0, null)`.
- `flush_scheduled = true`.

### 5.3 API pública propuesta

```pengu
# tela.pengu (fachada)
alias Signal as tela.Signal
alias Derived as tela.Derived
alias Subscription as tela.Subscription
alias Handler as tela.Handler
alias Error as tela.Error
alias Row as tela.Row

weave signal shard T with initial as T into Signal of T
weave derived1 ...
weave derived2 ...
weave derived3 ...
weave effect ...
weave effect_with ...
weave batch ...
weave batch_with ...
weave flush into void
weave shutdown into void

weave register_text shard T where T: Forma with name as string, s as Signal of T into void
weave register_bool with name as string, s as Signal of bool into void
weave register_value with name as string, s as Signal of string into void
weave register_checked with name as string, s as Signal of bool into void
weave register_handler with name as string, h as Handler into void

weave mount with root_selector as string into result of void to Error
weave unmount into void

weave bind_text shard T where T: Forma with node as dom.Element, s as Signal of T into Subscription
weave bind_bool with node as dom.Element, s as Signal of bool into Subscription
weave bind_class with node as dom.Element, name as string, s as Signal of bool into Subscription
weave bind_attr with node as dom.Element, name as string, s as Signal of string into Subscription
weave bind_style with node as dom.Element, prop as string, s as Signal of string into Subscription
weave bind_show with node as dom.Element, s as Signal of bool into Subscription
weave bind_value with node as dom.Element, s as Signal of string into Subscription
weave bind_checked with node as dom.Element, s as Signal of bool into Subscription
weave bind_html_unsafe with node as dom.Element, s as Signal of string into Subscription

weave each shard T, R where R: Row of T with
    container as dom.Element,
    source as Signal of list of T,
    key_fn as ref to weave with item as ref to T into string,
    make_row as ref to weave with item as ref to T into R
into Subscription

weave when with
    container as dom.Element,
    cond as Signal of bool,
    render_then as ref to weave into dom.Element,
    render_else as maybe (ref to weave into dom.Element)
into Subscription
```

`Subscription`:

```pengu
rune Subscription:
    id as u64
```

No tiene `Drop`. `dispose(sub)` es explícito. `mount`/`unmount`/`shutdown` also dispose.

`Handler`:

```pengu
alias Handler as weave with ev as dom.Event into void
```

No genérico, no `void` genérico.

`Error`:

```pengu
enum ErrorKind:
    RootNotFound
    AlreadyMounted
    NotMounted
    UnknownAttribute
    MissingRegistration
    TypeMismatch
    DuplicateKey

rune Error:
    kind as ErrorKind
    message as string

weave error_message with e as ref to Error into string
```

### 5.4 Flujo de un contador

`app.html`:

```html
<div id="app">
  <h1>Count: <span data-tela-text="count"></span></h1>
  <button data-tela-on-click="inc">+1</button>
  <button data-tela-on-click="dec">-1</button>
  <button data-tela-on-click="reset">reset</button>
  <p data-tela-show="is_zero">the counter is zero</p>
</div>
```

`src/main.pengu`:

```pengu
import tela as tela
import std.web.dom as dom
import std.spark

rune Counter:
    count as tela.Signal of int

weave is_zero_fn with n as int into bool:
    return n == 0

weave inc with n as int into int:
    return n + 1

weave dec with n as int into int:
    return n - 1

weave state into ref to Counter:
    static var s as Counter is with
        count is (calling tela.signal with 0)
    return sigil of s

weave on_inc with ev as dom.Event into void:
    var s as ref to Counter is calling state
    calling s->count.update with inc

weave on_dec with ev as dom.Event into void:
    var s as ref to Counter is calling state
    calling s->count.update with dec

weave on_reset with ev as dom.Event into void:
    var s as ref to Counter is calling state
    calling s->count.set with 0

weave main into int:
    var s as ref to Counter is calling state
    var is_zero as tela.Derived of bool is calling tela.derived1 of int, bool with s->count, is_zero_fn
    calling tela.register_text of int with "count", s->count
    calling tela.register_bool with "is_zero", is_zero
    calling tela.register_handler with "inc", on_inc
    calling tela.register_handler with "dec", on_dec
    calling tela.register_handler with "reset", on_reset
    let m as result of void to tela.Error is calling tela.mount with "#app"
    if not m.is_ok:
        calling spark.panic with tela.error_message(m.error)
    return 0
```

`is_zero` es un handle de runtime; sobrevive a `main`; no necesita estar en `Counter`. El estado guarda solo lo que los handlers necesitan; los derivados de presentación se crean en `main`. Si se quiere que `is_zero` viva en el estado, hay que construirlo en dos fases (crear `Counter` con `count` y luego asignar el derivado); no vale la pena en v0.1.

### 5.5 Flujo de listas

`TodoRow`:

```pengu
rune TodoRow:
    el as dom.Element
    title as dom.Element
    done as dom.Element

weave make_todo_row with t as ref to Todo into TodoRow:
    var el as dom.Element is calling dom.create with "li"
    calling dom.set_attr with el, "data-id", t.id
    var cb as dom.Element is calling dom.create with "input"
    calling dom.set_attr with cb, "type", "checkbox"
    var title as dom.Element is calling dom.create with "span"
    calling dom.set_text with title, t.title
    calling dom.append with el, cb
    calling dom.append with el, title
    return with el is el, title is title, done is cb

bind TodoRow with Row of Todo:
    weave update with t as ref to Todo into void:
        calling dom.set_text with self->title, t.title
        calling dom.set_checked with self->done, t.done
    weave element into dom.Element:
        return self->el
```

`each` en `main`:

```pengu
var list_el as dom.Element is (calling dom.query_required with "#todo-list")
var sub as tela.Subscription is calling tela.each of Todo, TodoRow with
    list_el,
    s->todos,
    todo_key,
    make_todo_row
```

`todo_key` y `make_todo_row` son top-level; no capturan.

Handlers de la fila (toggle, delete) se registran una vez en `make_todo_row` con `dom.on` y leen `data-id` del `event.target`; usan `state()` para mutar la lista. No hay closures.

### 5.6 Seguridad

- Nombres, no expresiones: no hay `eval`, no hay `new Function`, no hay parser de expresiones.
- `data-tela-html-unsafe` explícito; `data-tela-text` usa `textContent`.
- `data-tela-attr-*` bloquea `on*` y `srcdoc`; valida `href`/`src` contra `javascript:` y `data:` no permitidos.
- `data-tela-style-*` documenta que un valor de estilo puede cargar URLs; no se aceptan valores de usuario sin sanear.
- `mount` devuelve error si un binding no existe; no falla en silencio.
- `register_*` duplicado = panic; es un bug de programación.
- `each` clave duplicada = panic; evita corrupción del DOM.
- `dispose`/`shutdown` explícitos; no hay destructores que dependan del scope de `main`.

### 5.7 Límites conocidos (v0.1)

- Single-thread.
- `Signal<T>` copiable; `T` sin `Drop` o `Rc<T>`.
- Una sola app/mount por página.
- Sin `data-tela-each` ni `data-tela-if` declarativos.
- Sin scoping `data-tela-scope`.
- Sin SSR/hydration.
- Sin devtools; `dump_registry`/`dump_signals` en v0.2.
- `unmount` no libera señales; `shutdown` sí (solo sin mount).
- Sin `unregister`; la registry se configura al arrancar. v0.2.

---

## 6. Plan por fases

### Fase 0 — Auditoría y plan (esta entrega)

**Objetivo:** documento de auditoría, veredicto y plan; commit en `tela`.

**Entregables:**

- `scratch/AUDITORIA-Y-PLAN.md` (este archivo).
- Commit `docs: add feasibility audit and MVP plan` en `tela/main`. Sin push.

**Criterio de salida:** el usuario lee y aprueba o pide cambios. **No se toca el compilador todavía.**

### Fase 1 — Compilador 0.55.0 (bloqueantes y deuda grave)

**Objetivo:** dejar el compilador en un estado en el que `tela` se pueda construir sin workarounds y sin deuda conocida.

**Tareas:**

1. **C1 — `TkFn` en `subst_deep`/`has_param`.** Construir `SemaFnInfo` sustituido, internar `TkFn`; tests:
   - `Fn1<int,int>` + `Fn1<string,bool>` en un `main`.
   - `std.functor` completo.
   - `Fn1` en un campo de rune y en un `alias`.
2. **C2 — Especializaciones de test.** Marcar origen; no emitir en builds no-test; test `mini2t` y `psc test`.
3. **C3 — Interpolación de métodos genéricos.** Lowering correcto o diagnóstico; test de `"{calling p.first}"`.
4. **C4 — Métodos de concepto genéricos.** Corregir `essence of item`/`ref to T` o rechazar con diagnóstico; test `concept3`.
5. **C5 — `void` genérico.** Diagnóstico claro o soporte; actualizar `std.functor`/docs.
6. **C6 — DOM.** `attribute_names`, `query_all_under`, `insert_before` en wasm + stub nativo; doc comments; `docs/WASM.md`.
7. **C7 — Docs.** `assert`, `static var`, `Drop` genérico, `self->`, `Forma`, `std.functor`; `LIBRARIES.es.md` y `.md`.
8. **Versión:** `VERSION` 0.55.0; `CHANGELOG.md`.

**Tests de salida:**

- `psc build --target wasm examples/web/hello_app.pengu`.
- `psc test` del compilador (suite existente) sin regresiones.
- Nuevos tests de C1–C5.
- `psc build` de un proyecto que importa `std.functor` y usa `Fn1<int,int>` + `Fn1<string,bool>`.
- `psc run examples/web/hello_app.pengu --target wasm --browser` exit 0.

**Commits (main, sin push):**

1. `fix(generics): substitute type params inside function types`
2. `fix(codegen): exclude test-only specializations from production builds`
3. `fix(sema): lower generic method calls in interpolation`
4. `fix(codegen): preserve concrete types in generic concept methods`
5. `fix(sema): diagnose void generic arguments`
6. `feat(web): add dom attribute/traversal/insertion primitives`
7. `docs: correct static var, drop, assert and functor guidance`
8. `chore(release): bump version to 0.55.0`

Si algún fix resulta ser un cambio de otra magnitud, se ajusta el número de versión y se documenta; no se fuerza el mismo release.

### Fase 2 — Núcleo de `tela` (señales, runtime, registry)

**Objetivo:** señales/derived/effects/batch funcionando sin DOM, con tests nativos.

**Tareas:**

1. `types.pengu`: `Error`, `ErrorKind`, `Subscription`, `Handler`, `EntryKind`, `Entry`.
2. `runtime.pengu`: arena, `runtime()`, observers, dirty, flush, batch, `shutdown`.
3. `signal.pengu`: `Signal<T>`, `Cell<T>`, `derived1/2/3`, `effect`, `effect_with`, `batch`, `flush`.
4. `registry.pengu`: `register_text<T: Forma>`, `register_bool`, `register_value`, `register_checked`, `register_handler`; entry contexts; duplicate panic.
5. `fmt.pengu`: helpers `Forma` (`text_of`, `bool_text`).
6. Tests nativos: get/set, derived, effect order, batch, dependency tracking, derived chain, duplicate registration, dispose effect.

**Criterio de salida:** `psc test` nativo pasa; no hay `eval`; no hay `var` de módulo; no hay closures capturantes.

### Fase 3 — Bindings + mount + contador

**Objetivo:** primer ejemplo real en navegador.

**Tareas:**

1. `bind.pengu`: `bind_text`, `bind_bool`, `bind_class`, `bind_attr`, `bind_style`, `bind_show`, `bind_value`, `bind_checked`, `bind_html_unsafe`; `Subscription` ids; handlers globales `on_input`/`on_change` con `data-tela-bind`.
2. `mount.pengu`: scan con `attribute_names` + `query_all_under`; dispatch; `MountScope`; `mount`/`unmount`; errores.
3. `dom.pengu`: wrappers y utilidades (`query_required` sin panic?).
4. `examples/counter`: HTML + main + README.
5. Tests de bindings en navegador (contador, show, class, value, checked, attr, style).

**Criterio de salida:** el contador funciona en Chromium headless; `mount` detecta root ausente y registry incompleta; `unmount` no deja listeners.

### Fase 4 — `each` keyed + `when` + cards

**Objetivo:** listas y condicionales estructurales.

**Tareas:**

1. `each.pengu`: `Row`, `RowEntry`, `each`, reconciliación; `insert_before`; remove/free; duplicate key; updates; Subscription.
2. `when.pengu`: efecto, render, remove/free, `maybe` else.
3. `examples/cards`: card list con add; `CardRow`.
4. Tests de each: insertar, quitar, reordenar, actualizar; contar mutaciones con stats internos; no recrear nodos existentes.

**Criterio de salida:** cards funciona; reordenar no recrea filas; un update no pierde el foco del input.

### Fase 5 — TodoMVC + ejemplos finales

**Objetivo:** demostrar que el diseño sirve para una app real.

**Tareas:**

1. `examples/todos`: add, toggle, delete, toggle all, filters, clear completed, editing; `TodoRow`; filtros con `derived1/2`; persistencia opcional con `std.web.storage`.
2. `examples/counter` y `examples/cards` pulidos: HTML accesible, CSS mínimo, README.
3. `examples/index.html` o página de enlaces a las demos.
4. Tests de integración de TodoMVC.

**Criterio de salida:** TodoMVC funciona en navegador; los tres ejemplos compilan con `psc build --target wasm`; sin warnings de C.

### Fase 6 — Documentación en/es + API

**Objetivo:** documentación de uso real, no solo README.

**Tareas:**

1. `docs/en/` y `docs/es/`:
   - `index.md`: qué es, instalación (`psc add`), quickstart.
   - `signals.md`: Signal, Derived, Effect, batch, flush, ciclo de vida.
   - `bindings.md`: tabla completa, ejemplos, seguridad.
   - `lists.md`: `each`, `Row`, keyed, cuándo usar `when` vs `show`.
   - `components.md`: funciones, ownership de `Subscription`, patrones.
   - `testing.md`: nativo, navegador, consumer.
   - `api.md`: referencia de cada símbolo público.
   - `design.md`: arquitectura, decisiones, límites, diferencias con el diseño original.
2. README raíz en inglés + enlace a español.
3. `CHANGELOG.md` de `tela` 0.1.0.
4. Doc comments `##` en todos los símbolos públicos; `psc doc` sin errores.
5. Ejemplos con README propio.

**Criterio de salida:** un usuario nuevo puede instalar, montar un contador y entender las listas leyendo solo `docs/en/index.md` + `docs/es/index.md`.

### Fase 7 — Release 0.1.0 y revisión final

**Tareas:**

1. `tests/consumer/`: proyecto que hace `psc add ../.. --trust`, compila y ejecuta.
2. `scripts/test.sh` (nativo + wasm + browser + consumer).
3. Revisión de seguridad: `html-unsafe`, `attr-*`, `style-*`, URLs.
4. Revisión de fugas: `unmount`/`shutdown`, subscriptions, listeners.
5. `pengu.toml` versión 0.1.0; tag local (sin push).
6. Commits en `tela/main`; el usuario hace push.

**Criterio de salida:** suite completa en verde; ejemplos funcionando; docs en/es; sin TODOs bloqueantes.

---

## 7. Estrategia de testing

### 7.1 Niveles

| Nivel | Dónde | Qué |
|---|---|---|
| Unit signals | `tests/unit/signals_test.pengu` (nativo) | set/get, derived, effect, batch, orden, dependencias, dispose |
| Unit registry | `tests/unit/registry_test.pengu` | text/bool/value/checked, duplicados, tipos |
| Unit reconciler | `tests/unit/each_test.pengu` con DOM fake o navegador | insertar/quitar/reordenar/actualizar, claves duplicadas |
| Integración DOM | `tests/browser/` (wasm) | bindings, mount/unmount, show, class, value, checked |
| Ejemplos | `examples/*` | contador, cards, TodoMVC |
| Paquete | `tests/consumer/` | `psc add`, build, run |

### 7.2 Cómo testear DOM sin Node

- `psc test` nativo no tiene DOM. Los tests de señales van nativos.
- Para DOM: `psc build --target wasm` + `psc run --browser` para smoke; para aserciones, una página de test que escriba `PASS`/`FAIL` en `document.title` o `body`, servida con `python3 -m http.server`, y `chromium --headless --dump-dom` para leer el resultado.
- Alternativa: un test runner mínimo en JS que llame a `wasm` y exponga resultados; no añadir dependencias npm.
- `psc run --browser` ya valida que la página carga y que no hay errores de carga; no valida aserciones. Se complementa con `--dump-dom`.

### 7.3 Mutation counting

Para verificar que `each` no recrea nodos:

- `tela` mantiene contadores internos (`stats.creates`, `stats.moves`, `stats.removes`) en el runtime.
- `tela.stats()` devuelve una copia; solo para tests/dev.
- Test: reordenar 3 filas → `creates == 0`, `removes == 0`, `moves > 0`; actualizar un título → `creates == 0`, `removes == 0`.
- No es API pública estable; documentar como debug.

### 7.4 CI local

`scripts/test.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
psc test tests/unit
psc build examples/counter --target wasm
psc run examples/counter --target wasm --browser
# browser assertions
./scripts/browser_test.sh
# consumer
( cd tests/consumer && psc build )
```

Sin GitHub Actions en v0.1 salvo que se pida; el script es la fuente de verdad.

---

## 8. Documentación

### 8.1 Idioma y estructura

- `docs/en/` y `docs/es/` con la misma estructura y los mismos ejemplos.
- El README raíz puede estar en inglés (público) con enlace destacado a `docs/es/`.
- Cada ejemplo tiene su README en ambos idiomas o uno con enlace.
- `api.md` se mantiene a mano en v0.1; los `##` del código son la fuente de verdad y `psc doc` debe generar sin errores.

### 8.2 Contenido mínimo

- Qué es y qué no es (anti-objetivos).
- Instalación con `psc add`.
- Contador paso a paso.
- Señales, derivados, efectos, batch, flush.
- Tabla de `data-tela-*` con tipos y seguridad.
- Listas keyed con `Row`.
- Condicionales `when` vs `show`.
- Componentes y ownership de `Subscription`.
- Testing.
- Límites y migración desde el diseño original.
- Errores comunes: `calling`, `self->`, `Subscription` ignorada, señal local en `main`, `T` no copiable.

### 8.3 Documentación del compilador

- Actualizar docs en/es del compilador en la misma release 0.55.0.
- Añadir ejemplos de `dom.attribute_names`, `query_all_under`, `insert_before`.
- Corregir `assert` y `static var`.
- Documentar la restricción de `Signal<T>` copiable en la doc de `tela`, no en el compilador.

---

## 9. Commits y versiones

### 9.1 `tela`

- Fase 0: `docs: add feasibility audit and MVP plan` (este commit).
- Fase 2: `feat(core): add runtime-owned signals, derived values and effects`.
- Fase 3: `feat(dom): add typed bindings and mount/unmount`.
- Fase 4: `feat(lists): add keyed each and structural when`.
- Fase 5: `feat(examples): add counter, cards and TodoMVC`.
- Fase 6: `docs: add English and Spanish manuals`.
- Fase 7: `chore(release): prepare 0.1.0`.

Sin push; el usuario hace `git push`.

### 9.2 Compilador

- Fase 1, commits listados arriba.
- `VERSION` 0.55.0; `CHANGELOG.md`.
- Sin push.

### 9.3 Regla de versión

- Fix leve: `0.54.0 → 0.54.1`.
- Cambio grande (sema/codegen/stdlib/docs): `0.54.0 → 0.55.0`.
- Este conjunto es grande: **0.55.0**. Si se parte en dos entregas, la primera puede ser 0.54.1 solo si no cambia API; no es el caso de C6.

---

## 10. Riesgos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| C1 (TkFn) resulta más profundo que un branch | Media | Alto | Timebox de diagnóstico; tests mínimos; si no se arregla, no usar `std.functor` y documentar deuda (pero el lema es cero deuda) |
| C2 (test specs) requiere tocar DCE | Media | Alto | Empezar por marcar origen; tests `mini2t`; no bloquear el MVP si los tests son externos |
| `queueMicrotask` no funciona vía bridge | Media | Bajo | Fallback `set_timeout(0)` documentado |
| `insert_before` con `maybe Element` y `js.NULL` | Baja | Medio | Probe wasm antes de `each`; test de reorder |
| Genéricos anidados (`Signal<T>` dentro de `TextEntryCtx<T>`) | Media | Alto | Probes tempranos; si falla, usar `Rc`/campos directos; test de dos instancias |
| `Row` con `T` no copiable | Media | Medio | v0.1 solo T copiable; documentar; `Rc<T>` para el resto |
| Fuga de listeners en `unmount` | Media | Medio | `MountScope` con listas; test de doble mount/unmount |
| `data-tela-value` sin contexto | Alta | Medio | Atributo interno + handler global; test input |
| TodoMVC editing pierde foco | Media | Medio | `Row.update` conserva DOM; test de foco |
| Seguridad `html-unsafe`/URLs | Media | Alto | Nombre explícito; denylist `on*`/`srcdoc`; validar URLs; docs |
| Esfuerzo subestimado | Alta | Medio | Fases con criterios de salida; no prometer “finde” |

---

## 11. Decisiones que necesito de ti antes de implementar

1. **Nombre/import:** ¿`import tela` (recomendado) o quieres mover la librería a `std/tela` dentro del compilador? La segunda opción cambia el repo y el release.
2. **`data-tela-html-unsafe`:** ¿aceptas el renombre? Es la única forma honesta de mantener `innerHTML`.
3. **`data-tela-if`/`data-tela-each`:** ¿confirmas que quedan fuera de v0.1 y se usan `when`/`each` programáticos?
4. **Señales runtime-owned:** ¿aceptas que `Signal`/`Derived` no tengan `Drop` y que el runtime sea el dueño hasta `shutdown`? Es el cambio más importante respecto a tu diseño.
5. **`Subscription` sin `Drop`:** ¿aceptas `dispose(sub)` explícito y que ignorar una suscripción la mantenga viva hasta `unmount`/`shutdown`?
6. **`data-tela-checked`:** ¿lo añadimos a v0.1 para TodoMVC? Sin él, el checkbox se hace con `data-tela-on-change` y lectura manual.
7. **Compilador 0.55.0:** ¿confirmas el salto y que se actualicen docs en/es?
8. **TodoMVC:** ¿alcance completo (editing, toggle all, filters, clear, persistencia) o núcleo (add/toggle/delete/filters/clear) en 0.1.0 y editing/persistencia en 0.1.1?
9. **Licencia:** el repo no tiene LICENSE; ¿MIT, Apache-2.0, otra? No la invento.

---

## 12. Checklist de aprobación

- [ ] Veredicto aceptado: factible con rediseño, no tal cual.
- [ ] C1–C7 aceptados como trabajo de compilador 0.55.0.
- [ ] Runtime-owned signals / `Subscription` por id aceptados.
- [ ] `data-tela-html-unsafe`, `data-tela-checked`, fuera `data-tela-if`/`each` en v0.1.
- [ ] `import tela` aceptado (o decisión de upstream).
- [ ] Alcance de TodoMVC decidido.
- [ ] Licencia decidida.
- [ ] Visto bueno para empezar Fase 1.

---

## 13. Referencias internas

- `docs/LANGUAGE.es.md` §6.5 (lambdas sin captura), §13.9 (`Drop`).
- `docs/PENGUNIC.es.md` §0.2 (orden safety > clarity > performance), §17 (memoria), §20 (estado), §24 (tests), §2635 (`static var`).
- `docs/LIBRARIES.es.md` (layout, `pengu.toml`, tests, docs).
- `docs/WASM.md` (target, artefactos, `JsValue`, callbacks).
- `docs/EXTERNAL_MODULES.md` (C).
- `std/web/dom.pengu`, `std/web/js.pengu`, `std/web/event.pengu`, `std/functor.pengu`, `std/consortium.pengu`, `std/memoria.pengu`.
- `src/psc/sema/generics/instantiate.pengu`, `src/psc/codegen/bundle.pengu`, `src/psc/codegen/generics.pengu`, `src/psc/sema/types/convert.pengu`, `src/psc/codegen/type_ast.pengu`.

---

**Fin de la auditoría.** Si apruebas, empiezo por la Fase 1 (compilador) y no toco `tela` hasta que el compilador esté en verde.

---

## 14. Estado de implementación (0.1.0 / psc 0.55.1)

> Actualización 0.2.0 / psc 0.56.0 al final de este documento.

Implementado y validado:

- `tela` 0.1.0: señales, `derived1`, efectos, `batch`, registro tipado
  (string/int/float/bool), bindings declarativos y programáticos, `mount`,
  `unmount`, `each` keyed, `conditional`, delegación de eventos.
- Compilador 0.55.1: C1 (`TkFn`), C3 (interpolación de métodos genéricos),
  C4 (métodos de concepto con receptor concreto), C5 (`void` como argumento
  genérico rechazado), C6 (`attribute_names`, `insert_before`), plantillas C
  válidas (`Rc<T>`/`WeakRc<T>`/`OrderedMap<T>`) y `std.web.event.kind`.
- Ejemplos: contador, TodoMVC (add/toggle/filtros/clear/left) y tarjetas con
  `each` + `conditional`, compilando a wasm y verificados en Chromium headless.
- Tests: `tests/core` (4 tests nativos), `tests/regress_generic_method_interp.sh`,
  `tests/regress_generic_concept_method.sh`, `tests/regress_fn_only_rune.sh`,
  `tests/regress_void_generic_arg.sh`.
- Documentación en `docs/en/` y `docs/es/`, README bilingüe, LICENSE MIT.

Limitaciones conocidas:

- C2 sigue parcial: las especializaciones que solo aparecen en bloques `test`
  todavía se emiten en builds normales (aumentan el tamaño, no rompen C).
- `Signal.set` sobre un campo genérico puede especializarse a `void*`; los
  ejemplos usan `tela.set_int`/`tela.set_bool` en handlers.
- `data-tela-if` y `data-tela-each` declarativos quedan para 0.2.

Comandos de verificación usados:

```sh
# compilador
cd /home/tugatito/Documentos/GitHub/PenguScript
./tools/build.sh --no-wasm --no-bind --jobs 8
build/psc version                      # psc 0.55.1 (F13)
./tests/regress_generic_method_interp.sh
./tests/regress_generic_concept_method.sh
./tests/regress_fn_only_rune.sh
./tests/regress_void_generic_arg.sh
./tests/run.sh

# tela
cd /home/tugatito/Documentos/GitHub/tela
(cd tests/core && psc test)             # All 4 test(s) passed
(cd examples/counter && psc build)
(cd examples/todomvc && psc build)
(cd examples/cards && psc build)
```

---

## 15. Estado de implementación (0.2.0 / psc 0.56.0)

Implementado y validado:

- Runtime: dependencias por observer con limpieza (`track_cell`), guard de
  ciclos en `flush`, liberación real de observers y señales registradas.
- `data-tela-if` estructural con ancla de comentario y clon conservado.
- `data-tela-each` declarativo sobre `<template>` con binder explícito
  (`register_each`), reutilización por clave, actualización y liberación.
- Delegación con `closest` para `click/keydown/submit/input/change`.
- `Scope`, `scope_add`, `on_cleanup`, `scope_dispose`.
- Inputs numéricos two-way (`data-tela-value-int/-float`), checkbox booleano.
- Router History API (`navigate_history`, `on_history_change`, `off_history`)
  en `std.web.router`.
- `std.web.dom` 0.56: `closest`, `query_all_under`, fragmentos, comentarios,
  `template_content`, `parent`, `children`, `matches`.
- Ejemplo nuevo `examples/board` (if + each declarativos + delegación).
- Test de navegador `tests/browser/run-board.sh`.

Comandos:

```sh
cd /home/tugatito/Documentos/GitHub/PenguScript
build/psc version                      # psc 0.56.0 (F13)
./tests/run.sh                         # OK 168
cd /home/tugatito/Documentos/GitHub/tela
(cd tests/core && psc test)             # 4 tests
tests/browser/run-board.sh              # OK tela browser
```
