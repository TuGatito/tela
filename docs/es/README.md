# tela — manual en español

`tela` es una capa reactiva pequeña y explícita para PenguScript/WASM. Tiene
señales, derivadas, efectos, bindings DOM explícitos, listas keyed y un
condicional estructural. No hay router, SSR, CSS-in-JS ni DOM virtual.

## Instalación

```toml
[dependencies.tela]
path = "../tela"
```

```pengu
import tela
```

## Modelo

```pengu
rune App:
    count as tela.Signal of int
    zero as tela.Signal of bool

weave app into ref to App:
    static var a as App is with
        count is (calling tela.signal with 0),
        zero is (calling tela.signal with true)
    return sigil of a
```

`main` termina pero el navegador conserva el DOM; por eso el estado vive en un
`static var` local de función (o en memoria que este posee). PenguScript prohíbe
variables mutables de módulo.

## Señales

```pengu
weave signal shard T with initial as T into Signal of T
enchanting Signal shard T:
    weave get into T
    weave set with v as T into void
    weave dispose into void
```

`set` marca suscriptores sucios y agenda un flush. En el navegador el flush
ocurre en una macrotarea; en tests nativos llama `tela.flush_now`. `batch`
agrupa escrituras:

```pengu
weave write_pair into void:
    var a as ref to App is calling app
    calling tela.set_int with a->count, 1
    calling tela.set_int with a->count, 2

calling tela.batch with write_pair
```

Desde handlers de evento usa `tela.set_int` y `tela.set_bool`
cuando el receptor sea un campo; evita una especialización errónea del método
genérico. En el resto, `signal.set(v)` es correcto.

## Derivadas

```pengu
weave is_zero with n as int into bool:
    return n == 0

var d as tela.Derived of int, bool is calling tela.derived1 with is_zero, a->count
calling d.get
```

`derived1<A, B>(f, source)` devuelve `Derived of A, B`; `get` recalcula y
registra el observador actual. Es correcto, no cachea.

## Efectos

```pengu
weave on_change with ctx as ref to void into void:
    ...

var e as tela.Effect is calling tela.effect with on_change, (transmute 0 to ref to void)
calling tela.dispose_effect with e
```

El efecto corre al crearse y de nuevo cuando cambia una señal que leyó. Se
libera explícitamente; `Subscription.dispose` libera el efecto y ejecuta su
cleanup.

## Registry y bindings declarativos

```pengu
calling tela.register_int with "count", a->count
calling tela.register_bool with "is_zero", a->zero
calling tela.register_handler with "inc", on_inc
calling tela.mount with "#app"
```

| Atributo | Efecto |
|---|---|
| `data-tela-text="name"` | `textContent` desde string/int/float/bool |
| `data-tela-html-unsafe="name"` | `innerHTML` crudo; escapar es responsabilidad tuya |
| `data-tela-show="name"` | alterna el atributo `hidden` |
| `data-tela-value="name"` | input string bidireccional |
| `data-tela-checked="name"` | checkbox bidireccional, `Signal<bool>` |
| `data-tela-attr-NAME="name"` | asigna el atributo `NAME` |
| `data-tela-class-NAME="name"` | alterna la clase `NAME` |
| `data-tela-style-PROP="name"` | asigna `style.PROP` |
| `data-tela-on-EVENT="handler"` | handler delegado |

Los nombres son identificadores planos: no hay parser de expresiones. El
registro presta la señal; la app es dueña. Nombres duplicados hacen panic.

## Listas

```pengu
weave key with c as ref to Card into string:
    return c->id

weave render with c as ref to Card into tela.Elem:
    ...

weave update with c as ref to Card, el as tela.Elem into void:
    ...

var sub as tela.Subscription is calling tela.each with key, render, update, container, signal
```

`each` reutiliza nodos por key, llama `update` en los existentes, renderiza los
nuevos, elimina los que faltan y respeta el orden de la fuente. Devuelve una
`Subscription`; libérala al desmontar la lista.

## Condicional estructural

```pengu
weave then_view with dummy as int into tela.Elem:
    ...

weave else_view with dummy as int into tela.Elem:
    ...

var sub as tela.Subscription is calling tela.conditional with then_view, else_view, container, cond
```

El parámetro `int` ficticio existe porque este compilador pierde el alias
`dom.Element` en tipos de función sin argumentos.

## Bindings programáticos

`bind_text`, `bind_int`, `bind_float`, `bind_bool_text`, `bind_show`,
`bind_class`, `bind_attr`, `bind_style`, `bind_html_unsafe`, `bind_value` y
`bind_checked` aplican las mismas primitivas a nodos creados a mano. Devuelven
`Subscription`.

## Ciclo de vida

`mount(selector)` recorre la raíz y sus descendientes, conecta cada
`data-tela-*`, instala listeners delegados de `input`/`change` y hace panic ante
atributos desconocidos. `unmount()` libera subscriptions y listeners del mount;
`shutdown()` además limpia el registry y los observers. No uses `tela` tras
`shutdown`.

## Límites (0.1.0)

- `data-tela-if` y `data-tela-each` declarativos no están implementados.
- Sin SSR, hidratación, router, CSS-in-JS ni DOM virtual.
- Señales single-thread, solo hilo principal.
- La interpolación de métodos genéricos es una limitación del compilador;
  asigna a una variable local primero.
- Los valores de `Signal` deben ser copiables (primitivos, strings, listas,
  runes sin `Drop`).
