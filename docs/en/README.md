# tela — English manual

`tela` is a reactive UI layer for PenguScript/WASM. It is deliberately small:
signals, derived values, effects, explicit DOM bindings, keyed lists and a
structural conditional. There is no router, SSR, CSS-in-JS or virtual DOM.

## Install

In a PenguScript project:

```toml
[dependencies.tela]
path = "../tela"
```

```pengu
import tela
```

## Core model

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

`main` returns while the browser keeps the DOM alive, so state must live in a
function-local `static var` (or in memory owned by it). Module-level mutable
variables are forbidden by PenguScript.

## Signals

```pengu
weave signal shard T with initial as T into Signal of T
enchanting Signal shard T:
    weave get into T
    weave set with v as T into void
    weave dispose into void
```

`set` marks subscribers dirty and schedules a flush. A flush runs in a browser
macrotask; call `tela.flush_now` in native tests. `batch` groups writes:

```pengu
weave write_pair into void:
    var a as ref to App is calling app
    calling tela.set_int with a->count, 1
    calling tela.set_int with a->count, 2

calling tela.batch with write_pair
```

Use `tela.set_int` and `tela.set_bool` from event handlers when
the receiver is a field; this avoids a compiler specialization edge case in
method calls on generic fields. Direct `signal.set(v)` is used everywhere else.

## Derived values

```pengu
weave is_zero with n as int into bool:
    return n == 0

var d as tela.Derived of int, bool is calling tela.derived1 with is_zero, a->count
calling d.get
```

`derived1<A, B>(f, source)` returns a `Derived of A, B`. `get` recomputes and
tracks the current observer; it is correct, not cached.

## Effects

```pengu
weave on_change with ctx as ref to void into void:
    ...

var e as tela.Effect is calling tela.effect with on_change, (transmute 0 to ref to void)
calling tela.dispose_effect with e
```

Effects run immediately and again after any signal they read changes. They are
explicitly disposed; `Subscription.dispose` disposes the effect and runs its
cleanup.

## Registry and declarative bindings

```pengu
calling tela.register_int with "count", a->count
calling tela.register_bool with "is_zero", a->zero
calling tela.register_handler with "inc", on_inc
calling tela.mount with "#app"
```

| Attribute | Meaning |
|---|---|
| `data-tela-text="name"` | `textContent` from a string/int/float/bool text entry |
| `data-tela-html-unsafe="name"` | raw `innerHTML`; the caller owns escaping |
| `data-tela-show="name"` | toggles the `hidden` attribute |
| `data-tela-value="name"` | two-way string input |
| `data-tela-checked="name"` | two-way checkbox, `Signal<bool>` |
| `data-tela-attr-NAME="name"` | sets attribute `NAME` |
| `data-tela-class-NAME="name"` | toggles class `NAME` |
| `data-tela-style-PROP="name"` | sets `style.PROP` |
| `data-tela-on-EVENT="handler"` | delegated event handler |

Names are plain identifiers. There is no expression parser. Registration
borrows the signal; the app owns it. Duplicate names panic.

## Lists

```pengu
weave key with c as ref to Card into string:
    return c->id

weave render with c as ref to Card into tela.Elem:
    ...

weave update with c as ref to Card, el as tela.Elem into void:
    ...

var sub as tela.Subscription is calling tela.each with key, render, update, container, signal
```

`each` reuses nodes by key, calls `update` for existing keys, renders new keys,
removes missing keys and appends in source order. A `Subscription` is returned;
dispose it when the list is torn down.

## Structural conditional

```pengu
weave then_view with dummy as int into tela.Elem:
    ...

weave else_view with dummy as int into tela.Elem:
    ...

var sub as tela.Subscription is calling tela.conditional with then_view, else_view, container, cond
```

The dummy `int` parameter exists because this compiler loses the `dom.Element`
alias in zero-argument function types.

## Programmatic bindings

`bind_text`, `bind_int`, `bind_float`, `bind_bool_text`, `bind_show`,
`bind_class`, `bind_attr`, `bind_style`, `bind_html_unsafe`, `bind_value` and
`bind_checked` attach the same primitives to nodes you build yourself. They
return `Subscription` values.

## Lifecycle

`mount(selector)` scans the root and its descendants, binds every
`data-tela-*`, installs delegated `input`/`change` listeners and panics on
unknown attributes. `unmount()` releases mount subscriptions and listeners;
`shutdown()` also clears the registry and observers. Do not use `tela` after
`shutdown`.

## Limits (0.1.0)

- `data-tela-if` and declarative `data-tela-each` are not implemented.
- No SSR, hydration, router, CSS-in-JS or virtual DOM.
- Signals are single-threaded and main-thread only.
- Generic method calls inside string interpolation are a compiler limitation;
  assign to a local first.
- `Signal` values should be copyable (primitives, strings, lists, runes
  without `Drop`).
