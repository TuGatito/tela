# Auditoría de las limitaciones documentadas de tela 0.2

> Documento de auditoría y plan. **No se implementa nada hasta recibir el visto bueno.**
>
> Repositorios:
> - `tela` — `/home/tugatito/Documentos/GitHub/tela`, versión `0.2.0`, commit `608e911`.
> - compilador — `/home/tugatito/Documentos/GitHub/PenguScript`, versión `0.56.0`, commits `3736011` y `591910f`.
>
> Fecha: 2026-11-09.

## 1. Resumen ejecutivo

| # | Limitación documentada | ¿Premisa verdadera? | Causa raíz | ¿Dónde se arregla? |
|---|---|---|---|---|
| A | `data-tela-if` reconstruye el clon al pasar de oculto a visible y no conserva estado | **Sí** | `if_clear` libera el nodo y sus suscripciones antes de volver a mostrar; `if_run` siempre clona la plantilla | `pengu/tela.pengu` (semántica de `if`) |
| B | `resource` no cancela la petición de red | **Sí** | El puente `pengu_js_fetch` crea un `AbortController` local y no expone handle; `js.fetch`/`http.get` devuelven solo `bool` | `runtime/pengu_js.js` + `std/web/js.pengu` + `std/web/http.pengu` + `tela` |
| C | El bloat de tipos test-only del compilador sigue pendiente | **Sí, con matiz** | Se emiten prototipos de **todas** las funciones del catálogo y, sin poda, todos los tipos; los tipos test-only quedan aunque sus cuerpos no se emitan | `src/psc/codegen/bundle.pengu` + `dce.pengu` (poda por defecto) |

Ninguna de las tres es una premisa falsa. Ninguna es un bug de corrección del compilador: A es una decisión de semántica de `tela`, B es un hueco de API del puente web, y C es un problema de emisión/DCE (tamaño, no comportamiento). Las tres tienen solución localizada y verificable.

**Lo que no son:**
- A no es un fallo de `dom.clone`: el clon funciona; el problema es que se destruye el nodo anterior antes de decidir si hacía falta.
- B no es un fallo de `Resource`: el token de versión ya ignora respuestas viejas; lo que falta es poder abortar la petición para no gastar red/CPU.
- C no es bloat de código ejecutable: los cuerpos de las funciones test-only ya no se emiten (C2); quedan typedefs, `clone`, `cleanup` y prototipos inertes.

---

## 2. Método

1. Leer el código actual de `tela` y del compilador, no solo la documentación.
2. Reproducir cada limitación con el compilador `0.56.0` y el runtime actual.
3. Distinguir:
   - comportamiento observable (¿el usuario lo ve?),
   - causa inmediata (qué línea lo produce),
   - causa raíz (qué decisión/diseño lo permite).
4. Proponer la solución de menor superficie que no rompa std ni la API 0.2.
5. Plan por fases, con criterios de aceptación y versiones.

Comandos base usados:

```bash
cd /home/tugatito/Documentos/GitHub/PenguScript
./tools/build.sh --no-wasm --no-bind --jobs 8
./tests/run.sh

cd /home/tugatito/Documentos/GitHub/tela
psc check pengu/tela.pengu
psc test tests/core
bash tests/browser/run-board.sh
```

---

## 3. Limitación A — `data-tela-if` no conserva estado

### 3.1 Veredicto

**Premisa verdadera.** No es una falsa alarma ni un efecto colateral de otro bug.

### 3.2 Evidencia

En `pengu/tela.pengu`:

```pengu
# :994-1002
weave if_clear with st as ref to IfState into void:
    var i as int is 0
    while i < st->subs.len:
        calling dispose with (st->subs at i)
        set i is i + 1
    st->subs.clear
    if st->has_current:
        calling dom.remove with st->current
        calling dom.free with st->current
        set st->has_current is false
```

```pengu
# :1005-1021
weave if_run with st as ref to IfState into void:
    calling if_clear with st
    ...
    var node as dom.Element is calling dom.clone with st->template
    calling remove_attr with node, "data-tela-if"
    calling apply_tree with node
    ...
```

`if_run` se ejecuta en cada cambio de la señal de condición. Cuando la condición pasa de `false` a `true`, `if_clear` ya liberó el nodo anterior y `dom.clone(st->template)` crea un nodo nuevo desde la plantilla original. Es un `destroy/recreate` deliberado, no un clon que reutiliza el nodo existente.

`free_if` (`:1041-1045`) usa el mismo `if_clear`, así que el camino de liberación también destruye.

### 3.3 Por qué ocurre

La semántica implementada es “la rama visible es un clon efímero de la plantilla”. Es una decisión válida y sencilla, pero tiene dos consecuencias:

1. **Estado DOM perdido:** un `<input>` dentro de la rama vuelve a su `value` de plantilla; un `<details>` se cierra; scroll/foco se pierden.
2. **Suscripciones y efectos recreados:** cada `show` vuelve a montar bindings, listeners y efectos; el coste crece con la frecuencia de toggle.

No hay ningún mecanismo de “guardar el nodo” en `IfState`; el campo `template` es la plantilla original y `current` es el nodo visible actual.

### 3.4 Opciones de solución

| Opción | Comportamiento | Coste | Riesgo |
|---|---|---|---|
| **A1. Keep (recomendada)** | Al ocultar, `dom.remove` pero **no** `dispose`/`free`; al mostrar, reinsertar el mismo nodo | Bajo | Efectos siguen vivos mientras está oculto; el DOM oculto sigue actualizándose |
| A2. Freeze | Al ocultar, desuscribir efectos y guardar el nodo; al mostrar, re-suscribir | Medio | Re-suscripción compleja; los efectos con estado interno no se pueden “pausar” sin soporte |
| A3. Rebuild opt-in | Mantener el comportamiento actual y añadir `data-tela-if-mode="rebuild"` | Muy bajo | No resuelve la limitación por defecto; solo da una salida |
| A4. Cache de N nodos | Mantener el último nodo y reconstruir si cambia la plantilla | Medio | Gestión de memoria y claves; no aporta sobre A1 |

**Recomendación: A1 + A3 como escape.**

- `data-tela-if="cond"` conserva el nodo por defecto (A1).
- `data-tela-if-mode="rebuild"` reconstruye como hoy (A3), para componentes pesados o con estado que se quiera resetear.
- `data-tela-if` sin `mode` se comporta como `keep`.

### 3.5 Diseño propuesto (sin implementar)

`IfState` gana:

```pengu
rune IfState:
    anchor as dom.Element
    template as dom.Element
    cond as ref to Cell of bool
    current as dom.Element
    has_current as bool
    visible as bool
    rebuild as bool
    subs as list of Subscription
```

Funciones:

- `if_build(st)` — clona/crea el nodo y lo monta (solo si `rebuild`, o si aún no existe).
- `if_show(st)` — si `rebuild`, `if_clear` + `if_build`; si no, inserta `st->current` antes del ancla.
- `if_hide(st)` — `dom.remove(st->current)`; **no** dispose/free en modo keep; marca `visible=false`.
- `if_dispose(st)` — dispose de `subs`, `dom.free(current)`, libera `template`, marca `has_current=false`.
- `if_run(st)` — lee `cond.get()`; si cambia `visible`, llama `if_show`/`if_hide`; si es la primera vez, `if_build` + `if_show`.
- `free_if(st)` — `if_dispose` + libera `st`.

Puntos finos:

- **Ancla:** ya existe un comentario ancla; se reutiliza para insertar sin depender de `parent`/`children`.
- **Orden:** al reinsertar, usar `insert_before(anchor_parent, current, anchor)`; no `append`, para no moverlo al final.
- **Suscripciones:** `mount_subs` se recorta en `if_build`; en keep no se vuelven a crear. Hay que evitar que `apply_tree` vuelva a montar el mismo nodo al reinsertarlo; `if_show` no llama `apply_tree`.
- **Unmount:** `free_if` debe liberar el nodo oculto y sus suscripciones. Si `visible=false`, no está en el DOM pero sigue siendo propiedad de `IfState`.
- **Modo rebuild:** se lee `data-tela-if-mode`; se elimina del clon para que no se reaplique.
- **Memoria:** el nodo oculto no se libera hasta `unmount` o hasta que el `IfState` se libere. Es el precio de conservar estado; documentarlo.

### 3.6 Pruebas de aceptación

1. **Estado de formulario:** input dentro de `data-tela-if`; escribir “abc”; ocultar; mostrar; `input.value == "abc"`.
2. **Rebuild:** mismo test con `data-tela-if-mode="rebuild"`; `input.value == ""` (comportamiento explícito).
3. **Toggle repetido:** 100 ciclos show/hide; el número de nodos bajo el contenedor no crece; no se disparan efectos duplicados.
4. **Unmount:** oculto y luego `unmount`; no quedan nodos ni suscripciones; el cleanup de `Scope` corre una vez.
5. **Ancla:** insertar antes de un hermano posterior; el orden se conserva.
6. **Regresión:** board/counter/TodoMVC siguen pasando.

### 3.7 Versión

`tela 0.2.1` (fix leve, sin cambio de compilador).

---

## 4. Limitación B — `resource` no cancela la petición

### 4.1 Veredicto

**Premisa verdadera.** `Resource<T>` ignora respuestas viejas, pero no puede abortar la petición en curso.

### 4.2 Evidencia

`std/web/js.pengu:376-390`:

```pengu
weave fetch with method as string, url as string, headers as JsValue, body as JsValue,
                 on_ok as weave with res as JsValue into void,
                 on_err as weave with e as JsValue into void,
                 timeout_ms as int is 0 into result of bool to JsError:
    ...
    var rc as i32 is calling pengu_js_fetch with ...
    return rc != 0
```

No hay handle de petición. `std/web/http.pengu:60-75` `request`/`get` también devuelven `result of bool`.

`runtime/pengu_js.js:460-466`:

```js
var controller = new AbortController();
var init = { signal: controller.signal, ... };
```

El `controller` es local. Solo el `timer` de timeout lo aborta; el llamador no tiene forma de hacerlo.

`Resource<T>` (`pengu/tela.pengu`) solo guarda `version`/`loading`/`error` y descarta respuestas viejas por token. Eso evita aplicar datos obsoletos, pero **no** cancela la petición: la red, el servidor y la decodificación siguen.

### 4.3 Por qué ocurre

Es un hueco de API del puente, no un olvido de `Resource`:

- `pengu_js_fetch` no devuelve un identificador.
- `std.web.js` no tiene `abort`.
- `std.web.http` no tiene una variante abortable.
- `tela.Resource` no tiene un campo para el handle.

### 4.4 Opciones

| Opción | Qué hace | Coste | Riesgo |
|---|---|---|---|
| B1. `AbortController` en `tela` con `js` raw | Crear controller desde PenguScript y pasarlo a `fetch` | Medio | Hay que reconstruir `fetch` entero (headers/body/JSON) en `tela`; duplica el puente |
| **B2. Puente abortable (recomendada)** | `pengu_js_fetch` devuelve handle; `pengu_js_abort(id)` aborta | Medio | Cambio de API en `js`/`http`; hay que limpiar el mapa de peticiones |
| B3. Solo `http` | `http.get_abortable` con handle | Bajo | No sirve para `js.fetch` directo; deja dos APIs |
| B4. No cancelar, solo ignorar | Estado actual | Cero | No resuelve la limitación |

**Recomendación: B2.** Una sola API para `js.fetch` y `http`, y `tela.Resource` la usa.

### 4.5 Diseño propuesto (sin implementar)

#### 4.5.1 Puente JS

`runtime/pengu_js.js`:

- Añadir `PENGU_JS.requests = new Map()` y `PENGU_JS.nextRequest = 1`.
- `pengu_js_fetch` crea `id`, guarda `{controller, timer, done:false}` y devuelve `id` (en vez de `0/1`).
- En `ok`, `err` y timeout: `requests.delete(id)`, limpiar timer, marcar `done`.
- `pengu_js_abort(id)`:
  - si no existe o `done`, devuelve `0`;
  - `controller.abort()`;
  - `requests.delete(id)`;
  - devuelve `1`.
- No liberar callbacks desde `abort`; el callback de error del fetch (ya registrado) se encarga; si el navegador no lo llama, el handle se elimina igual y los slots quedan owned por `js.JsCallback` (verificar).
- El timeout sigue funcionando; `abort` y timeout no deben liberar dos veces.

#### 4.5.2 API PenguScript

`std/web/js.pengu`:

```pengu
rune FetchHandle:
    id as int

weave fetch_request with method as string, url as string, headers as JsValue, body as JsValue,
                       on_ok as weave with res as JsValue into void,
                       on_err as weave with e as JsValue into void,
                       timeout_ms as int is 0 into result of FetchHandle to JsError

weave abort_request with h as FetchHandle into result of bool to JsError
```

`fetch` actual se mantiene como wrapper que llama `fetch_request` y descarta el handle (compatibilidad).

`std/web/http.pengu`:

```pengu
rune RequestHandle:
    inner as js.FetchHandle

weave request_abortable ... into result of RequestHandle to JsError
weave get_abortable ... into result of RequestHandle to JsError
weave abort with h as RequestHandle into result of bool to JsError
```

`request`/`get` actuales se mantienen.

#### 4.5.3 `tela.Resource`

```pengu
rune Resource shard T:
    data as Signal of maybe T
    loading as Signal of bool
    error as Signal of maybe string
    version as u64
    handle as maybe js.FetchHandle
```

- `begin(r)` incrementa `version`, `loading=true`, limpia error, **no** aborta por sí solo (el usuario decide).
- `set_handle(r, h)` guarda el handle.
- `cancel(r)`:
  - incrementa `version` (invalida callbacks pendientes);
  - si `handle` existe, `js.abort_request(handle)`;
  - `loading=false`;
  - `handle=none`;
  - **no** setea `error` (cancelar no es error).
- `finish/fail` limpian `handle` si el token coincide.
- `dispose_resource` aborta si hay handle y libera señales.

#### 4.5.4 Semántica

- Cancelar antes de que llegue la respuesta: `data` queda como estaba, `loading=false`, `error=none`.
- Cancelar después de `finish`: no-op.
- Timeout: `fail` con mensaje de timeout; `handle` limpio.
- `abort` puede provocar `on_err` con `AbortError`; el token viejo lo ignora. Documentar que el callback de error puede ejecutarse.
- Dos `cancel` seguidos: el segundo no-op.
- `dispose` con petición en vuelo: aborta.

### 4.6 Pruebas de aceptación

1. Servidor de prueba con `/slow` (retraso 500 ms) y `/fast`.
2. `get_abortable("/slow")`; `cancel` a los 50 ms; a los 700 ms: `data` sigue `none`, `loading=false`, `error=none`.
3. Sin cancelar: `/slow` llega y `data` se setea.
4. Carrera: `t1` slow, `t2` fast; `t2` aplica, `t1` se descarta; con abort de `t1`, no hay error visible.
5. Timeout: `timeout_ms=50`; `error` contiene timeout; `loading=false`.
6. Abort después de completar: no-op.
7. `dispose_resource` con petición en vuelo: no hay callbacks después de liberar.
8. `http.get`/`js.fetch` clásicos siguen funcionando.

### 4.7 Versión

- Compilador `0.57.0` (nueva API pública del puente; cambio grande).
- `tela 0.2.2` (usa la API; mantiene compatibilidad).

---

## 5. Limitación C — bloat de tipos test-only

### 5.1 Veredicto

**Premisa verdadera, con matiz.** No quedan cuerpos ejecutables de test en el binario normal (C2 ya lo evita), pero sí quedan tipos, `clone`/`cleanup` y prototipos inertes.

### 5.2 Evidencia

Repro `/tmp/telaprobe/mini2t.pengu`:

```pengu
import std.functor as functor
import std.spark
import std.ward

rune Ctx:
    base as int

weave add_base with c as ref to Ctx, a as int into int:
    return a + c->base

weave is_long with c as ref to Ctx, a as string into bool:
    return a.len > c->base

test "fn1 string bool":
    var c as Ctx is with base is 3
    var g as functor.Fn1 of string, bool is calling functor.make_fn1 with is_long, (sigil of c)
    var y as bool is calling g.call with "pengu"
    calling ward.assert_eq_bool with y, true

weave main into int:
    var c as Ctx is with base is 40
    var f as functor.Fn1 of int, int is calling functor.make_fn1 with add_base, (sigil of c)
    var x as int is calling f.call with 2
    calling spark.println with "{x}"
    return 0
```

En el C generado por un build **normal** aparecen:

```c
struct Fn1__string__bool;
typedef struct Fn1__string__bool Fn1__string__bool;

struct Fn1__string__bool {
    bool (*fn_ptr)(void*, PenguString);
    void* ctx;
};

static inline void _pengu_clone_Fn1__string__bool(...);
static inline void _pengu_cleanup_Fn1__string__bool(...);

bool Fn1_call_inst330(Fn1__string__bool* self, PenguString a);
bool Fn1_is_null_inst331(Fn1__string__bool* self);
bool Fn1_call_or_inst332(Fn1__string__bool* self, PenguString a, bool fallback);
```

No hay cuerpo de `Fn1_call_inst330` en el build normal; solo el prototipo. Igual ocurre con `Fn1__ref__Multiplier__int` y `_Multiplier` de los tests de `std/functor`.

### 5.3 Causa raíz

Hay dos capas:

1. **Prototipos de todo el catálogo.** `src/psc/codegen/bundle.pengu:354-370` emite un prototipo para **cada** función del catálogo, sin filtrar por `dce.live` ni `late_specs`. Esos prototipos mencionan tipos como `Fn1__string__bool`, así que el tipo debe existir aunque su cuerpo no se emita.
2. **Tipos de todo el catálogo.** Sin `--prune-types`, `bundle.pengu:178-179` (forward), `:223` (definición), `:265-290` (clone/deepclone/cleanup) emiten **todos** los `catalog.types`. `CgType` no tiene flag de uso; la lista se pobló durante el sema, incluidos los cuerpos de `test` (que se comprueban en todos los modos).

`--prune-types` ya existe (`src/psc/cmd/build.pengu:139`, `options.prune_types`), y `dce.type_live` consulta `r->types` (`dce.pengu:319-324`), pero al podar tipos los prototipos de todas las funciones siguen referenciando tipos podados; por eso falla con:

```text
std/functor.pengu:305:59: error: nombre de tipo ‘_Multiplier’ desconocido
```

No es que `type_live` sea inútil: es que la poda de tipos y la poda de prototipos no están coordinadas.

### 5.4 Solución propuesta

Dos cambios coordinados, en este orden:

#### C1. Prototipos solo de funciones vivas/tardías

En `bundle.pengu`, sustituir el bucle de prototipos de todo el catálogo por el mismo criterio que los cuerpos:

```pengu
if (not f.is_generic or f.is_spec)
   and not f.is_antiquus and not f.is_generated
   and not skip_decl_proto
   and (not f.is_declare or not is_libc_name(c, f))
   and ((dce.live(reach, i)) or c->catalog.late_specs.has(i)):
    emitir prototipo
```

Pero hay que hacerlo **después** de estabilizar el worklist de cuerpos, porque un cuerpo puede crear una spec nueva cuyo prototipo hay que emitir. El worklist actual ya itera cuerpos hasta que no aparecen specs; los prototipos deben emitirse después de ese cierre. Si un prototipo se necesita antes (por una llamada en un cuerpo), C permite una declaración implícita solo en C89; mejor emitir prototipos de todo lo live/late tras el cierre y antes de concatenar cuerpos.

Riesgo: funciones `declare`/`antiquus` y helpers de `std` que se usan desde cuerpos pero no están en `late_specs`; el criterio debe incluir `is_declare` no libc y las funciones de runtime.

#### C2. Poda de tipos por defecto

- Cambiar `prune_types` a `true` por defecto en `src/psc/codegen/options.pengu` / `src/psc/driver/build.pengu`.
- Añadir `--no-prune-types` como escape.
- Mantener `--prune-types` como no-op aceptado por compatibilidad.
- Revisar `dce.compute` para marcar tipos de specs tardías: hoy `compute` corre antes de emitir cuerpos; una spec creada durante la emisión puede introducir un tipo que `r->types` no conoce. Dos opciones:
  - **C2a:** después del worklist de cuerpos, recorrer las funciones late y llamar `mark_node_types`/`mark_type` sobre sus firmas y AST; recalcular antes de emitir tipos.
  - **C2b:** emitir tipos en dos pasadas: primero una pasada “seca” de cuerpos a buffer para descubrir tipos, luego emitir solo los usados. Más caro y más complejo.
- Recomendación: **C2a**, porque el worklist ya tiene el conjunto cerrado de funciones; marcar sus firmas y cuerpos antes de la emisión de tipos.

#### C3. Verificación

- `mini2t` normal: el C no debe contener `Fn1__string__bool`, `Fn1__ref__Multiplier__int`, `_Multiplier`, `Fn1_call_inst330` ni `Fn1__string__bool`.
- `psc test mini2t` sí debe contenerlos y ejecutar el test.
- Suite 168 + regresiones.
- Medir `bundle.c`/binario antes/después; adjuntar delta.
- `--no-prune-types` debe reproducir el comportamiento actual para diagnosticar.

### 5.5 Riesgos

- **Tipo usado solo en un local de función viva:** si `mark_node_types` no lo ve, la poda lo elimina y el C falla. Mitigación: tests + escape `--no-prune-types`; el plan incluye un test de tipo local genérico.
- **Prototipo needed antes del cierre:** el worklist debe emitir prototipos después del cierre; si una función usa otra definida después, C permite prototipo previo; el orden de prototipos no importa.
- **`std` con `declare`:** no podar prototipos de `declare`/`antiquus` que no sean libc.
- **Tipos de `const`/globales:** `dce.compute` ya marca `consts`; conservar.

### 5.6 Versión

Compilador `0.57.1` (fix leve sobre `0.57.0`; cambio interno de emisión).

---

## 6. Plan por fases

### Fase 0 — Baseline y tests que fallan (0.5 día)

- Añadir `tests/browser/if-state/`:
  - input dentro de `data-tela-if`, escribir, ocultar/mostrar, assert `value`.
  - `data-tela-if-mode="rebuild"` assert reset.
- Añadir `tests/browser/abort/`:
  - servidor `/slow` y `/fast`; cancelar y assert no data.
- Añadir `tests/compiler/type-bloat.sh`:
  - build normal de `mini2t`; grep de tipos test-only; debe fallar antes del fix.
- Añadir medición de tamaño de `bundle.c`/binario.

**Salida:** tests rojos que describen las tres limitaciones.

### Fase 1 — `data-tela-if` conserva estado (1–2 días)

- Implementar `IfState.rebuild`, `if_build`, `if_show`, `if_hide`, `if_dispose`.
- `data-tela-if-mode="rebuild"` opt-in.
- Tests de Fase 0 en verde.
- Docs en/es: semántica keep/rebuild, ciclo de vida, memoria.
- `tela 0.2.1`.
- Commit tela.

**Aceptación:** input conserva valor; rebuild lo resetea; 100 toggles sin crecimiento; unmount limpia.

### Fase 2 — Cancelación de red (3–5 días)

- Puente `pengu_js_fetch` con id + mapa + `pengu_js_abort`.
- `js.FetchHandle`, `fetch_request`, `abort_request`; `fetch` compat.
- `http.RequestHandle`, `request_abortable`, `get_abortable`, `abort`.
- `Resource.handle`, `set_handle`, `cancel`, `dispose_resource` aborta.
- Tests de Fase 0 en verde.
- Docs en/es de cancelación, semántica de `AbortError`, timeout.
- Compilador `0.57.0`; tela `0.2.2`.
- Commits ambos repos.

**Aceptación:** cancelar no aplica datos ni error; sin cancelar llega; timeout; doble cancel; dispose en vuelo.

### Fase 3 — Poda de tipos test-only (3–4 días)

- Prototipos solo live/late tras cierre del worklist.
- `prune_types` por defecto; `--no-prune-types`.
- Marcar tipos de specs tardías (`C2a`).
- Test de bloat en verde; suite; medición.
- Docs/CHANGELOG; compilador `0.57.1`.
- Commit compilador.

**Aceptación:** C normal sin tipos test-only; `psc test` sí; suite 168; `--no-prune-types` reproduce el comportamiento viejo.

### Fase 4 — Cierre y documentación (1 día)

- Actualizar `README`, docs en/es, `CHANGELOG`, auditorías.
- Ejemplos: `examples/if-state` (formulario) y `examples/abort` (búsqueda cancelable).
- Verificar counter/TodoMVC/cards/board.
- Commits en main en ambos repos; sin push.
- Revisar versiones: tela `0.2.2`, compilador `0.57.1`.

**Total estimado:** 8–12 días de trabajo de agente, con tests de navegador.

---

## 7. Matriz de versiones

| Cambio | Repo | Versión | Tipo |
|---|---|---|---|
| `data-tela-if` keep + mode | tela | `0.2.1` | fix leve `x.x.+1` |
| Fetch abortable + Resource.cancel | compilador | `0.57.0` | cambio grande `x.+1.x` |
| Fetch abortable + Resource.cancel | tela | `0.2.2` | fix leve |
| Type pruning / prototipos | compilador | `0.57.1` | fix leve |
| Docs/CHANGELOG | ambos | mismas | — |

> Nota: si se prefiere no introducir `0.57.0`, la API abortable se puede considerar “fix leve” y publicar `0.56.1`. La recomendación es `0.57.0` porque añade API pública nueva y toca el puente JS.

---

## 8. Criterios de aceptación globales

1. Las tres limitaciones tienen test que falla antes y pasa después.
2. No se rompe la suite del compilador: `OK 168 PSC test file(s)`.
3. No se rompen counter, TodoMVC, cards, board.
4. `data-tela-if` conserva estado por defecto y `rebuild` es explícito.
5. `cancel` no aplica datos ni error; `dispose` aborta.
6. El C normal no contiene tipos test-only; `psc test` sí.
7. Docs en/es y CHANGELOG actualizados; versiones correctas.
8. Commits en `main` en ambos repos, sin push.

---

## 9. Decisiones que necesito del usuario

1. **A:** ¿`data-tela-if` conserva por defecto (`keep`) con `mode="rebuild"` opt-in? Recomiendo sí.
2. **B:** ¿La cancelación se expone en `js` + `http` + `Resource` (B2), o solo en `http`? Recomiendo B2.
3. **C:** ¿Poda de tipos por defecto con `--no-prune-types` de escape? Recomiendo sí.
4. **Versiones:** ¿`0.57.0` para abort y `0.57.1` para poda, o ambos como `0.56.1`/`0.56.2`? Recomiendo `0.57.0`/`0.57.1`.

Con el visto bueno, implemento en el orden de las fases.

---

## 10. Estado de implementación (2026-11-09)

- **A — `data-tela-if`:** implementado `keep` por defecto y
  `data-tela-if-mode="rebuild"`; `tests/browser/run-if-state.sh` pasa.
- **B — cancelación:** implementada API abortable en `std.web.js`,
  `std.web.http` y `Resource.cancel`/`attach_request`; `tests/browser/run-abort.sh`
  pasa. `finish`/`fail` devuelven `bool`.
- **C — poda:** los prototipos ya solo se emiten para funciones vivas/late
  (el cuerpo de una spec test-only no se emite) y la poda de tipos está activa
  en wasm. Limitación residual: el DCE no puede probar que una instancia
  genérica usada solo en un bloque `test` está muerta, así que algunos typedefs
  test-only de `std` siguen apareciendo (`Fn1__string__bool`); no hay cuerpos
  ejecutables. Se documenta como limitación conocida de 0.57.1.
- Compilador: `0.57.0` (abort) y `0.57.1` (poda); suite `OK 168`.
- Tela: `0.2.2`; core 5 tests y navegador board/if/abort en verde.
