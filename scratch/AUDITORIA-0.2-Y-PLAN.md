# Auditoría y plan para `tela` 0.2

**Estado auditado:** `tela` 0.1.0 (`b5b7c6c`) sobre PenguScript `0.55.1` (`5e39fb4`).
**Fecha:** 2026-11-09.
**Alcance:** auditoría de viabilidad, huecos para proyectos web reales y plan por fases para `tela` 0.2.0. **No se implementa nada en este documento**; queda a la espera del visto bueno.

---

## 1. Veredicto ejecutivo

`tela` 0.1.0 es una base sólida y ya funciona en un caso real (contador, TodoMVC core y cards, con bindings declarativos, `each` keyed y `conditional`). Pero **no está lista para una web app de producción**. Los bloqueos no son de filosofía ni de compilador: son de **runtime, ciclo de vida, DOM y alcance**.

La versión 0.2 no debería ser solo “añadir `data-tela-each` y `data-tela-if`”. Esos dos atributos son la parte visible; detrás hacen falta:

1. **Anclas y fragmentos** para condicionales estructurales sin perder la posición original.
2. **Scopes** para listas, condicionales y componentes; sin scope, `data-tela-text="title"` dentro de una fila no puede resolver nada.
3. **Montaje por subárbol** y bindings para nodos creados dinámicamente; hoy `each`/`conditional` no montan los `data-tela-*` de sus nodos.
4. **Delegación real**: hoy un click en un hijo de un botón no encuentra el handler del botón.
5. **Ciclo de vida**: dependencias obsoletas, efectos que se fugan, `flush` sin límite y `unmount` que no libera todo.
6. **Formularios, routing, async y errores**, que son lo que separa una demo de una web app.

Mi recomendación es partir 0.2 en dos versiones de compilador:

- **PenguScript 0.55.2** — fixes leves que desbloquean la librería: poda C2, alias en tipos de función sin argumentos y method call genérico sobre campo. Documentación a `0.55.2`.
- **PenguScript 0.56.0** — cambio grande de `std.web.dom`: `closest`, `query_all_under`, fragmentos, comentarios/anclas y router con historial. Documentación a `0.56.0`.
- **`tela` 0.2.0** — depende de `0.56.0` y añade loops/condicionales declarativos + base de web app.

Sin el 0.56.0, `tela` puede simular `closest`/fragmentos con `dom.raw` y JS, pero sería deuda técnica y seguridad difusa. No lo recomiendo.

---

## 2. Qué hay hoy (evidencia)

### 2.1 API pública actual

- Señales: `signal<T>`, `Signal.get/set/update/dispose`, `set_int`, `set_bool`.
- Derivadas: `derived1<A,B>`, `Derived.get` (recalcula, no cachea).
- Efectos: `effect`, `effect_with`, `dispose_effect`, `batch`, `batch_with`.
- Registry: `register_text/int/float/bool_text`, `register_bool`, `register_value`, `register_handler`.
- Bindings: `bind_text/int/float/bool_text/show/class/attr/style/html_unsafe/value/checked`.
- Montaje: `mount(selector)`, `unmount()`, `shutdown()`.
- Listas: `each<T>(key, render, update, container, signal)`.
- Condicional: `conditional(then, else, container, signal)`.
- Atributos: `data-tela-text`, `-html-unsafe`, `-show`, `-value`, `-checked`, `-attr-*`, `-class-*`, `-style-*`, `-on-*`.
- Diferidos: `data-tela-if`, `data-tela-each`, `data-tela-scope`.

### 2.2 Estado de validación

- `tests/core`: 5 tests nativos.
- Ejemplos: counter, TodoMVC core y cards; compilan a wasm y se probaron con Chromium headless.
- No hay suite de navegador automatizada en el repo; las pruebas de DOM fueron manuales/asistidas.
- El compilador tiene suite nativa de 168 archivos, pero **no cubre DOM real**.

---

## 3. Hallazgos de auditoría

Severidad: **P0** = rompe una app real o pierde memoria; **P1** = limita el desarrollo web; **P2** = DX/rendimiento.

### 3.1 Runtime y reactividad

| # | Hallazgo | Evidencia | Impacto | Prioridad |
|---|---|---|---|---|
| R1 | Un observer nunca borra sus dependencias anteriores. Si un efecto lee `flag` y luego `a` o `b` según `flag`, al cambiar `flag` sigue suscrito a la rama vieja. | `pengu/tela.pengu:129-137` (`run_observer` solo fija `current`); las `Cell.subs` solo crecen. | Efectos de más, renders de más, bugs de orden; no es solo rendimiento. | P0 |
| R2 | `flush` no tiene límite de iteraciones. Un efecto que escribe una señal que él mismo lee deja el hilo colgado. | `pengu/tela.pengu:139-147`; el `while` no cuenta vueltas. | Cuelgue del navegador. | P0 |
| R3 | `dispose_effect` marca `alive=false` pero no quita el observer del mapa ni libera el `Observer`. | `pengu/tela.pengu:228-231`; `observer_at` sigue devolviéndolo. | Fuga de memoria por cada efecto/lista/condicional destruido. | P0 |
| R4 | `Signal.dispose` puede liberar una celda registrada; el registry queda con un `ctx` colgante. | `pengu/tela.pengu:215-217`; docs avisan “no llamar si fue registrada”, pero no hay comprobación. | UAF potencial. | P0 |
| R5 | `schedule` durante un flush vuelve a programar un timeout aunque el flush ya esté corriendo; no es incorrecto, pero añade latencia. | `pengu/tela.pengu:151-158`. | Latencia/orden. | P2 |
| R6 | `batch` no es reentrante ante panic: si `work` panica, `batch_depth` queda >0. | `pengu/tela.pengu:243-260`. | La app deja de flushear tras un error. | P1 |
| R7 | `Derived` no cachea; cada `get` recalcula y vuelve a suscribir. | `pengu/tela.pengu:271-283`. | Coste en listas grandes; aceptable para 0.1, no para 0.2. | P1 |
| R8 | `set_int`/`set_bool` son parches por un bug de especialización de método genérico sobre campo. | `pengu/tela.pengu:175-188`; docs lo explican. | API inconsistente y deuda. | P1 (compilador) |

**Conclusión R1–R4:** antes de añadir loops declarativos hay que arreglar el grafo de dependencias y el ciclo de vida. Si no, `data-tela-each` multiplicará los efectos y las fugas.

### 3.2 Montaje y DOM

| # | Hallazgo | Evidencia | Impacto | Prioridad |
|---|---|---|---|---|
| D1 | `mount` usa `dom.query_all("*")`, que busca en **todo el documento**, no bajo el root. Monta nodos fuera de `#app`. | `pengu/tela.pengu:924-939`; `std/web/dom.pengu:134` usa `document.querySelectorAll`. | Bindings fuera de la app; colisiones; difícil de razonar. | P0 |
| D2 | `mount` no libera la lista de `query_all` ni el `root`; `apply_node` no libera `attribute_names`. | `pengu/tela.pengu:902-908`, `:924-939`; `dom.query_all` documenta “owned”. | Fuga de handles JS en cada montaje. | P0 |
| D3 | La delegación lee `data-tela-on-*` del `event.target` exacto. Un click en un `<span>` dentro de un `<button data-tela-on-click>` no dispara. | `pengu/tela.pengu:802-816`. | Rompe botones con iconos/texto anidado, muy común. | P0 |
| D4 | `apply_attr` añade un listener por nodo para `data-tela-on-*`; no hay `closest` ni filtro por root. | `pengu/tela.pengu:857-900`, `:789-794`. | Muchos listeners y handlers que se disparan fuera del ámbito. | P1 |
| D5 | `each` no llama a `apply_node` sobre los nodos que renderiza; los `data-tela-*` dentro de una fila no se montan. | `pengu/tela.pengu:968-1006`. | `data-tela-each` declarativo no puede funcionar sin esto. | P0 |
| D6 | `each` hace `append` de todos los nodos en cada actualización; reordena moviendo todo, no con `insert_before` selectivo. | `pengu/tela.pengu:993-1005`; `dom.insert_before` ya existe. | Coste O(n) de mutaciones DOM por cambio; parpadeo y pérdida de foco. | P1 |
| D7 | `each` añade el nodo nuevo con `append` y luego lo vuelve a añadir en la pasada de orden. | `pengu/tela.pengu:985-1004`. | Mutaciones duplicadas; foco/estado de input se pierde. | P2 |
| D8 | `conditional` añade el nodo al final del contenedor, no en la posición original. Si el HTML tenía hermanos después, el condicional “salta” al final. | `pengu/tela.pengu:1044-1070`. | El HTML deja de ser estructura estable. | P0 |
| D9 | Al cambiar de rama, `conditional` quita el nodo pero no dispone efectos/señales creados por `then`/`else`. | `pengu/tela.pengu:1056-1068`. | Fugas y efectos zombies. | P0 |
| D10 | No hay fragmentos: un componente/condicional debe devolver un solo `Element`. | API `Elem`; `conditional` firma `-> Elem`. | Listas de hermanos, layouts y condicionales múltiples no se pueden expresar. | P1 |
| D11 | No hay ancla/comentario para inserción; `when` no conserva el lugar. | No existe `dom.create_comment`. | Bloquea D8 y `data-tela-if` robusto. | P0 |

### 3.3 Formularios

| # | Hallazgo | Evidencia | Impacto | Prioridad |
|---|---|---|---|---|
| F1 | `data-tela-value` solo maneja `string`; no hay número, float, select múltiple ni radio. | `pengu/tela.pengu:483-489`, `:718-724`; `register_value` solo `Signal<string>`. | Formularios reales necesitan convertir/parsear. | P1 |
| F2 | `data-tela-checked` solo cubre checkbox booleano; no hay radio groups ni `Signal<string>` por `name`/`value`. | `pengu/tela.pengu:761-779` + `checked_binding_run` `:702-705`. | Formularios con radios quedan fuera. | P1 |
| F3 | No hay `submit` con `preventDefault` integrado ni validación; el handler recibe el evento y debe hacerlo a mano. | `data-tela-on-submit` funciona, pero es manual. | Fricción y errores. | P1 |
| F4 | No hay binding de `value` para `<select>`/`<textarea>` con actualización bidireccional robusta. | Solo `dom.value`/`set_value`. | Formularios incompletos. | P1 |
| F5 | No hay `focus`/`blur`/`aria-*` helpers; `data-tela-attr-aria-*` funciona, pero no hay ergonomía. | `std.web.dom` tiene `focus`/`blur`; tela no. | Accesibilidad y foco. | P1 |

### 3.4 Routing

| # | Hallazgo | Evidencia | Impacto | Prioridad |
|---|---|---|---|---|
| RT1 | `std.web.router` existe, pero es hash-only y no está integrado con `tela`. | `std/web/router.pengu`; `current_path`/`on_change` manuales. | Cada app reinventa el patrón; no hay rutas reactivas. | P1 |
| RT2 | No hay `location.pathname`/History API reactiva; solo hash. | `router.navigate` usa `location.hash`. | URLs limpias y back/forward real no cubiertos. | P1 |
| RT3 | No hay params reactivos (`/users/:id` → señal). | `router.match` devuelve `maybe list of Param`. | Render por ruta manual. | P2 |
| RT4 | No hay guardas/404/redirects. | No existe. | Apps medianas necesitan 404 y navegación. | P2 |

### 3.5 Async, datos y errores

| # | Hallazgo | Evidencia | Impacto | Prioridad |
|---|---|---|---|---|
| A1 | `std.web.http` usa callbacks sin contexto; el callback debe ser top-level y leer `app()`. | `std/web/http.pengu:60-90`. | Patrón verboso; fácil olvidar actualizar loading/error. | P1 |
| A2 | No hay `resource`/`query` que combine `data/loading/error` y cancelación. | No existe. | Cada app repite estado async. | P1 |
| A3 | Un panic dentro de un efecto/mount aborta el flush/mount; no hay error boundary ni reporte. | `pengu/tela.pengu:100` (`panic`), `flush` sin `try`. | Mala experiencia en producción. | P1 |
| A4 | No hay `on_mount`/`on_cleanup`; los componentes no tienen scope de limpieza. | `Subscription` manual; `mount_subs` solo para bindings. | Fugas al navegar entre vistas. | P0 |

### 3.6 Testing, DX y seguridad

| # | Hallazgo | Evidencia | Impacto | Prioridad |
|---|---|---|---|---|
| T1 | Tests nativos no cubren DOM; no hay runner de navegador en el repo. | `tests/core`; pruebas manuales. | Regresiones de bindings/loops no detectadas. | P0 |
| T2 | No hay `dump_registry`/`dump_signals` ni nombres de depuración. | Roadmap 0.1 los dejó para 0.2. | Difícil diagnosticar nombres/duplicados. | P2 |
| T3 | `data-tela-html-unsafe` es correcto pero peligroso; falta una guía de sanitización y un helper `escape_html`. | `pengu/tela.pengu:478-481`, docs. | XSS si el usuario lo usa con datos externos. | P1 |
| T4 | `data-tela-attr-*` usa `dom.set_attr` (con chequeo de URL), pero no hay política para `style`/`href`/`src` más allá del DOM. | `dom.set_attr`; docs. | Seguridad aceptable, pero incompleta. | P2 |
| T5 | No hay guía de CSP/wasm ni de carga del shell. | README/examples usan `var Module = {}` manual. | Fricción de despliegue. | P2 |
| T6 | `shutdown` no libera las celdas de señales registradas (los `free` de registry son `nop_free`). | `pengu/tela.pengu:349-362`, `:437-448`. | Fuga al desmontar una app completa. | P1 |

### 3.7 Compilador

| # | Hallazgo | Evidencia | Impacto | Prioridad |
|---|---|---|---|---|
| C2 | Especializaciones usadas solo por `test` se siguen emitiendo en builds normales. | CHANGELOG 0.55.1; `src/psc/codegen/dce.pengu`. | Bloat; no rompe. | P1 |
| C3 | Tipos de función sin argumentos pierden el alias (`dom.Element`), por eso `conditional` usa `dummy as int`. | `pengu/tela.pengu:1035-1081`; docs. | API fea y frágil. | P1 |
| C4 | `Signal.set` sobre un campo genérico se especializa a `void*`; por eso existen `set_int`/`set_bool`. | `pengu/tela.pengu:175-188`; auditoría 0.1. | Deuda de API. | P1 |
| C5 | `std.web.dom` no tiene `closest`, `query_all_under`, `create_fragment`, `create_comment`, `matches`, `parent`, `children`. | `std/web/dom.pengu`. | Bloquea delegación y condicionales correctos. | P0 |
| C6 | `dom.on` no acepta contexto; los handlers deben ser top-level. | `std/web/dom.pengu:505-532`. | Aceptable con registry, pero limita componentes. | P2 |
| C7 | No hay `Element.matches` para filtrar delegación. | No existe. | Alternativa a `closest`. | P1 |

---

## 4. Qué significa “web app” y qué falta

Una app web real, además de loops/condicionales, necesita esto. Lo ordeno por lo que 0.2 debe cubrir y lo que puede esperar.

### 4.1 P0 — sin esto 0.2 no es usable

1. **Ciclo de vida de efectos** (R1–R4, A4): dependencias limpias, dispose real, límite de flush, `Scope`/cleanup.
2. **Montaje correcto** (D1–D5, D11): subárbol, liberar handles, delegación con `closest`, ancla para condicionales, montar nodos dinámicos.
3. **Condicional estructural** (`data-tela-if`): ancla + fragmento + montaje/desmontaje de la rama.
4. **Listas declarativas o semideclarativas** (`data-tela-each`): template + key + binder explícito; reorder con `insert_before`.
5. **Formularios básicos** (F1–F3): string, int, float, checkbox, select, submit.
6. **Router mínimo** (RT1/RT2): hash + params como señal, integrado con `tela`.
7. **Tests de navegador** (T1): runner reproducible.

### 4.2 P1 — lo que convierte la librería en “para proyectos”

- `Scope` de componente y `on_cleanup`.
- `resource`/`async` con `loading/error/data` y cancelación.
- `data-tela-scope` y resolución de nombres por ámbito.
- Accesibilidad/foco: `bind_focus`, `aria-*` helpers, live regions.
- `data-tela-on-*` modifiers (`.prevent`, `.stop`, `.once`, `.self`) o una API equivalente.
- Devtools: `dump_registry`, `dump_signals`, nombres.
- Errores de mount con nombre de nodo/atributo, no solo panic genérico.

### 4.3 P2 — fuera de 0.2

- SSR/hidratación (WASM no es el camino; `portus`).
- VDOM, CSS-in-JS, animaciones, virtual scrolling.
- Store global tipo Redux (seguir con `rune AppState`).
- i18n completa (sí documentar formato/fechas).
- Router con guards/transiciones complejas (0.3).

---

## 5. Diseño propuesto para 0.2

### 5.1 Condicionales declarativos

Objetivo: `data-tela-if="cond"` sin mover el nodo de sitio y sin “recrear todo”.

Propuesta:

1. En `mount`, para cada nodo con `data-tela-if` (o `data-tela-show`), crear un **ancla** `Comment` antes del nodo y guardar `{anchor, node, cond}`.
2. Al cambiar la condición:
   - `false`: `dom.remove(node)`, dejar el ancla.
   - `true`: `dom.insert_before(parent, node, anchor)` (o `replace_with`).
3. El nodo se conserva entre ciclos (no se destruye al ocultar), salvo que se pida `data-tela-if` “destructivo” con `data-tela-if-mode="rebuild"`.
4. Al desmontar, restaurar/eliminar el ancla y disponer el scope de la rama.

Esto resuelve D8/D11 y es más barato que reconstruir.

**Compilador necesario:** `dom.create_comment`, `dom.parent` (o `dom.raw`), `dom.insert_before` (ya existe).

Alternativa sin compilador: guardar `nextSibling` antes de quitar y reinsertar con `insert_before(parent, node, nextSibling)` usando `dom.raw` para `nextSibling`. Es factible, pero añade JS crudo a tela. Prefiero `create_comment`/`parent` en 0.56.0.

### 5.2 Bucles declarativos

El problema de fondo: sin reflexión, `data-tela-text="title"` dentro de una fila no sabe de qué `T` es `title`. Hay tres opciones.

#### Opción A — template + binder explícito (recomendada para 0.2)

```html
<ul data-tela-each="cards" data-tela-key="id">
  <template>
    <li class="card">
      <h2 data-tela-text="title"></h2>
      <button data-tela-on-click="remove_card">x</button>
    </li>
  </template>
</ul>
```

En PenguScript:

```pengu
calling tela.register_each of Card with
    "cards",
    card_key,
    bind_card_row
```

`bind_card_row(item as ref to Card, root as Elem, scope as ref to RowScope)`:

- el binder declara los campos de la fila (`scope.text("title", c->title)`, `scope.bool("done", c->done)`).
- `data-tela-text="title"` dentro de la fila resuelve primero el `RowScope`, luego el registry global.
- `data-tela-key` usa `card_key`; no hay parser de expresiones.

Ventajas: tipado, sin evaluación, sin reflexión, HTML = estructura, PenguScript = comportamiento.
Coste: el binder es código; no es “magia Alpine”, pero es honesto con Pengunic.

#### Opción B — field registry por tipo

```pengu
calling tela.register_field_text of Card with "title", card_title
calling tela.register_field_bool of Card with "done", card_done
```

`data-tela-each` crea un scope por fila con esos getters y los bindings resuelven `title`/`done` automáticamente. Es más ergonómico, pero exige registrar cada campo y un `RowState<T>` que actualice los valores al cambiar el item; ~400–600 LOC y más superficie pública. **No la recomiendo para 0.2**; sí para 0.3 si hay usuarios.

#### Opción C — mantener solo `tela.each` programático

No cumple el objetivo de 0.2 (loops declarativos) y obliga a construir toda fila a mano. Válida como fallback, no como plan.

**Recomendación:** Opción A. `data-tela-each` aporta estructura/keying/reorder; el binder aporta tipado y campos. Documentar claramente que no hay `data-tela-text="item.title"` ni expresiones.

### 5.3 `RowScope` y resolución de nombres

Propuesta:

- `RowScope` es un mapa `string -> Entry` (text/bool/value) + `string -> Handler` opcional.
- `resolve_text(node, name)` sube por ancestros hasta el root montado:
  1. scope de fila más cercano;
  2. `data-tela-scope="prefix"` (si existe);
  3. registry global.
- `data-tela-each` crea un `RowScope` por fila y lo asocia al nodo raíz de la fila; `apply_node` con `scope` lo usa.
- Los bindings de fila se montan con `apply_node_scoped(root, row_scope)` y se registran en el `MountScope` para disponerlos al borrar la fila.

Esto también resuelve componentes reutilizables y `data-tela-scope`.

### 5.4 Fragments y componentes

- `dom.create_fragment()` y `dom.append_fragment(parent, fragment)`; o `create_document_fragment` + `append` acepta fragment.
- `tela.fragment()` devuelve `Elem` con varios hijos; `mount`/`conditional` aceptan fragment.
- Componente = función `-> Elem` (sigue igual), pero puede devolver fragment.
- `Scope` de componente:

```pengu
rune Scope:
    subs as list of Subscription
    effects as list of Effect
    signals as list of ...
```

`mount` crea un `MountScope` raíz; cada `each`/`if` crea un hijo. `scope.dispose()` dispone en orden inverso. `on_cleanup(fn, ctx)` registra un cleanup en el scope actual.

### 5.5 Delegación de eventos

- Un solo listener por tipo de evento en el root montado (no por nodo).
- En `dispatch_event`, desde `event.target` subir con `closest("[data-tela-on-"+kind+"]")` hasta el root; si no se encuentra, ignorar.
- Respetar `data-tela-on-*` del ancestro más cercano; no disparar handlers fuera del root.
- Añadir modificadores sin parser:
  - `data-tela-on-click.prevent="handler"`
  - `data-tela-on-submit.prevent="handler"`
  - `data-tela-on-click.stop`, `.once`, `.self`.
  - El atributo se parsea por nombre (sufijo), no por expresión.

Esto elimina D3/D4 y reduce listeners.

### 5.6 Formularios

- `data-tela-value="name"` sigue string.
- `data-tela-value-int="name"` / `data-tela-value-float="name"`: leen `input.value`, parsean, actualizan `Signal<int/float>`; en error, no escriben y opcionalmente marcan `data-tela-invalid`.
- `data-tela-checked="name"` para checkbox/radio; radio groups requieren `name` + `value` y un `Signal<string>` (o `register_choice`).
- `data-tela-select="name"` para `<select>`; multiple → `Signal<list of string>`.
- `data-tela-submit="handler"` azúcar de `data-tela-on-submit` con `prevent_default` automático.
- `data-tela-focus` / `bind_focus` para foco declarativo (una señal booleana).
- Validación: no meter un motor; permitir `data-tela-invalid` por signal y `set_custom_validity` si se añade al DOM.

### 5.7 Routing

Dos niveles:

1. **0.2 mínimo (tela)**: `tela.route(pattern, render)` sobre `std.web.router`:
   - `route_signal` con path actual;
   - `route(pattern)` devuelve `Signal<bool>` + params;
   - `outlet(container, routes)` monta/desmonta la vista;
   - hash-only, documentado.
2. **0.56.0 (compilador)**: History API + `popstate` en `std.web.router`; `navigate(path, replace)`, `current_path` con pathname, `on_change` con `popstate` + `hashchange`.
3. **0.3**: guards, 404, layouts anidados.

Para 0.2, el mínimo hash es suficiente para demos y muchas apps; el plan debe dejar claro que URLs limpias llegan con 0.56.0.

### 5.8 Async y errores

- `tela.resource<T>`:
  - `data: Signal<maybe T>`, `loading: Signal<bool>`, `error: Signal<maybe string>`, `reload`.
  - `load(url, decode)` usa `http.get` y actualiza las señales; callback top-level.
  - Cancelación: token/version; si llega una respuesta vieja, ignorar.
- `tela.guard(fn)` o `try_effect`: captura errores de un efecto y los escribe en `tela.last_error`; no silenciar.
- `flush` con límite y mensaje `tela: flush loop after N iterations`.
- `mount` con `try` por nodo: un binding roto no debe tumbar toda la app; reportar nodo/atributo.

No implementar un runtime async completo; usar `std.web.http` + señales.

### 5.9 Devtools y testing

- `tela.dump_registry() -> string`, `tela.dump_signals() -> string` (nombres, ids, subs).
- `tela.debug_name(signal, name)` para errores.
- Runner de navegador:
  - `tests/browser/` con un shell y un script Node/Chromium (`--headless --dump-dom` o CDP) que monta una página, hace clicks/inputs y comprueba DOM.
  - Casos: counter, each add/remove/reorder, if toggle, form, router, unmount leak.
  - Integrarlo en `tests/run.sh` o un script separado `tests/browser/run.sh` (no bloquear tests nativos).
- Tests nativos para runtime puro (deps, flush loop, dispose) sin DOM.

### 5.10 Seguridad

- `data-tela-html-unsafe` se mantiene, con advertencia y helper `tela.escape_html`.
- No eval, no expresiones; los nombres siguen siendo identificadores.
- `data-tela-attr-*` usa `dom.set_attr` con chequeo de URL; documentar que `href`/`src` externos pasan por esa validación.
- Eventos: solo handlers registrados; no strings de código.
- CSP: documentar `wasm-unsafe-eval`/`script-src` y el shell `Module`.
- Formularios: no enviar datos a URLs no confiables; `fetch` con `http`.

---

## 6. Cambios de compilador y versiones

### 6.1 PenguScript 0.55.2 (fix leve; docs a 0.55.2)

1. **C2**: poda de especializaciones originadas solo en `test` (multi-pass o tracking de origen). Es la deuda pendiente de 0.55.1.
2. **Tipos de función sin argumentos**: preservar alias (`dom.Element`) en `weave into Elem`; elimina el `dummy as int` de `conditional`.
3. **Método genérico sobre campo**: `Signal.set` a través de `App.count` no debe especializarse a `void*`; elimina `set_int`/`set_bool` como parche.
4. **Docs**: `LANGUAGE`, `PENGUNIC`, `LIBRARIES`, `STDLIB`, `CHANGELOG`, README; versión `0.55.2`.
5. **Regresiones**: C2, zero-arg alias, generic field set.

Estimación: 2–4 días.

### 6.2 PenguScript 0.56.0 (cambio grande; docs a 0.56.0)

1. `std.web.dom`:
   - `closest(e, selector) -> maybe Element` (o `result`).
   - `query_all_under(root, selector)`.
   - `create_fragment`, `append_fragment`, `template_content` (o acceso seguro a `<template>.content`).
   - `create_comment`, `parent`, `children`, `matches`.
   - `insert_before` ya existe; revisar ownership.
2. `std.web.router`:
   - History API (`pushState`/`replaceState`, `popstate`).
   - `navigate(path, replace)`, `current_path` con pathname.
3. Tests de DOM/C en `tests/pengu` o scripts.
4. Docs en/es y CHANGELOG; versión `0.56.0`.

Estimación: 4–6 días.

**Alternativa:** hacer todo en 0.55.2 si se considera “fix leve”. No lo recomiendo: `closest`/fragments/router son features nuevas y merecen 0.56.0.

---

## 7. Plan por fases para `tela` 0.2.0

### Fase 0 — Baseline y fixes de runtime (P0)

**Objetivo:** que 0.1 sea seguro antes de añadir superficie.

- R1: grafo de dependencias con limpieza por observer.
- R2: límite de flush + error claro.
- R3: dispose real de observers.
- R4: estado de señal registrada / no doble dispose.
- D1/D2: montaje por subárbol + liberar handles.
- T5: `shutdown` y ownership de celdas documentado.
- Tests nativos de R1–R4.

**Salida:** suite nativa verde; sin fugas en un test de 1.000 ciclos de mount/unmount.

### Fase 1 — Condicionales estructurales (P0)

- `dom.create_comment`/`parent` (0.56.0).
- Ancla para `data-tela-if` y `conditional`.
- `conditional_at(anchor, ...)` y compatibilidad con `conditional(container, ...)`.
- Montaje/desmontaje del scope de rama; cleanup.
- `data-tela-if` con `data-tela-if-mode` (`keep`/`rebuild`).
- Tests de posición, cambio repetido, unmount.

**Salida:** `data-tela-if` no mueve nodos; `conditional` conserva el lugar.

### Fase 2 — Listas declarativas (P0)

- `<template>` cloning y `RowScope`.
- `data-tela-each`, `data-tela-key`, `data-tela-row`.
- `register_each<T>(name, key_fn, bind_fn)`.
- `apply_node_scoped` para filas; bindings de fila.
- Reorder con `insert_before` (no append-all).
- Dispose de filas y sus bindings.
- Tests: insertar, quitar, reordenar, cambiar item, foco preservado.

**Salida:** TodoMVC/cards reescritos con `data-tela-each`; DOM final correcto; mutaciones mínimas.

### Fase 3 — Web app essentials (P1)

- Delegación con `closest` + modificadores.
- Formularios: int/float/checkbox/radio/select/submit.
- Router mínimo (`tela.route` hash) + ejemplo.
- `Scope`/`on_cleanup`.
- `resource` básico + ejemplo async.
- `escape_html` y guía de seguridad.
- Tests de navegador.

**Salida:** ejemplo “dashboard” con ruta, formulario, lista async y cleanup.

### Fase 4 — DX, docs y cierre (P1/P2)

- `dump_registry`/`dump_signals`.
- Errores con nodo/atributo/nombre.
- Manuales en/es actualizados + guía de migración 0.1→0.2.
- Benchmarks de reorder/render (medidos, no prometidos).
- CHANGELOG, versión `0.2.0`, commits.

**Salida:** docs completas, ejemplos, suite verde.

---

## 8. Matriz de pruebas

| Área | Test | Tipo |
|---|---|---|
| Señales/derived/effects | set/get, dependencias dinámicas, dispose, batch | nativo |
| Flush | límite de iteraciones, reentrada, orden | nativo |
| Mount | subárbol, handles, doble mount, unmount | navegador |
| Bindings | text/html/show/attr/class/style/value/checked | navegador |
| Eventos | target hijo, closest, stop/prevent/once | navegador |
| `data-tela-if` | posición, cambio repetido, cleanup | navegador |
| `data-tela-each` | add/remove/reorder/update/focus | navegador |
| Formularios | int/float/checkbox/radio/select/submit | navegador |
| Router | match, params, navegación, back | navegador |
| Async | loading/error/data, respuesta vieja | navegador |
| Memoria | mount/unmount 1.000 ciclos, observers | nativo + navegador |
| Seguridad | html-unsafe, href/src, sin eval | revisión + tests |

Runner: `tests/browser/run.sh` con Chromium headless; no añadir Playwright si no está disponible. Usar CDP mínimo o `--dump-dom` con una página de prueba.

---

## 9. Riesgos y decisiones abiertas

1. **`data-tela-each` con binder vs field registry.** Recomiendo binder (Opción A). Si el usuario quiere `data-tela-text="title"` “mágico”, hay que aceptar el registro de campos y ~400 LOC extra. **Decisión necesaria antes de Fase 2.**
2. **`data-tela-if` destructivo vs conservar nodo.** Conservar es más rápido y preserva foco; reconstruir es más limpio para componentes con estado. Propongo `keep` por defecto, `rebuild` opt-in.
3. **Scope global vs múltiples apps.** La 0.1 tiene singleton; para SPAs con vistas múltiples hace falta `MountScope`. Mantener `mount` global por compatibilidad y añadir `mount_scoped` en 0.2.
4. **Router hash vs History API.** Hash en 0.2; History en 0.56.0. Si el usuario necesita URLs limpias ya, adelantar 0.56.0.
5. **Async**: `resource` es útil pero puede crecer. Limitar a `loading/error/data/reload` y documentar el resto.
6. **C2**: si se aplaza otra vez, documentarlo como limitación; no bloquea 0.2.
7. **SSR/hidratación**: fuera de alcance; `portus` es la vía.

---

## 10. Criterios de aceptación de 0.2.0

- [ ] `data-tela-if` funciona sin mover el nodo y limpia la rama.
- [ ] `data-tela-each` con template, key y binder; add/remove/reorder/update correctos.
- [ ] Delegación con `closest`; clicks en hijos funcionan.
- [ ] Formularios string/int/float/checkbox/select/submit.
- [ ] Router hash mínimo con params.
- [ ] `Scope`/`on_cleanup`; sin fugas en mount/unmount repetido.
- [ ] Tests de navegador automatizados en el repo.
- [ ] Manuales en/es y migración 0.1→0.2.
- [ ] Ejemplos: counter, TodoMVC, cards, dashboard con router/form/async.
- [ ] Sin `panic` por atributos desconocidos en nodos fuera del root.
- [ ] Benchmarks de reorder documentados (no promesas sin medir).
- [ ] Commits en main, sin push.

---

## 11. Estimación honesta

- Fase 0: 2–3 días.
- Fase 1: 2–3 días.
- Fase 2: 4–5 días.
- Fase 3: 4–6 días.
- Fase 4: 2–3 días.
- Compilador 0.55.2: 2–4 días.
- Compilador 0.56.0: 4–6 días.

Total: **20–30 días de trabajo concentrado**, no un fin de semana. La parte más arriesgada es el `RowScope`/`data-tela-each` y el ciclo de vida; el resto es incremental.

---

## 12. Referencias internas

- `pengu/tela.pengu` — runtime, registry, bindings, mount, each, conditional.
- `docs/en/README.md`, `docs/es/README.md` — manual 0.1.
- `scratch/AUDITORIA-Y-PLAN.md` — auditoría 0.1 y decisiones originales.
- `std/web/dom.pengu` — `query_all`, `attribute_names`, `insert_before`, `on`.
- `std/web/router.pengu` — router hash actual.
- `std/web/http.pengu` — callbacks async.
- Compilador: `src/psc/codegen/dce.pengu`, `decl_types.pengu`, `generics.pengu`, `bundle.pengu`.

---

## 13. Recomendación final

Aprobar 0.2 con este orden:

1. **0.55.2** (fixes leves) y **0.56.0** (DOM/router) antes de tocar `tela`.
2. Fase 0 (runtime) antes de Fase 1/2; no construir loops sobre un grafo de dependencias roto.
3. `data-tela-if` y `data-tela-each` con **ancla + template + binder explícito**; sin eval y sin field registry en 0.2.
4. Formularios/router/async como “web app essentials”, no como extras.
5. Tests de navegador desde la Fase 0; sin ellos, los loops declarativos son una apuesta.

Si el usuario prefiere un 0.2 más pequeño, el corte mínimo es: Fase 0 + Fase 1 + Fase 2 + tests. Router/forms/async pasarían a 0.3, pero entonces no lo llamaría “para proyectos web”.
