# tela — English manual (0.2.2)

`tela` is a reactive UI layer for PenguScript/WASM. It is deliberately small:
signals, derived values, effects, explicit DOM bindings, keyed lists,
structural conditionals, declarative templates and scopes. There is no router
inside `tela` (use `std.web.router`), no SSR, no CSS-in-JS and no virtual DOM.

## Install

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
    static var a as App is with count is (calling tela.signal with 0), zero is (calling tela.signal with true)
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
    weave update with f as (weave with v as T into T) into void
    weave dispose into void
```

`set` marks subscribers dirty and schedules a flush. Event handlers flush at
the end of the delegated dispatch; outside handlers call `tela.flush_now()` in
native tests. `batch` groups writes:

```pengu
calling tela.batch with write_pair
```

Signals registered with `register_*` are owned by the registry and freed by
`shutdown`; an unregistered signal is owned by the caller and freed with
`dispose` (which panics if it is registered).

## Derived values

```pengu
weave is_zero with n as int into bool:
    return n == 0

var d as tela.Derived of int, bool is calling tela.derived1 with is_zero, a->count
calling d.get
```

`derived1<A, B>(f, source)` returns `Derived of A, B`. `get` recomputes on
each read and registers the current observer's dependency; it is correct, not
cached.

## Effects and scopes

```pengu
weave tick with ctx as ref to void into void:
    ...

var e as tela.Effect is calling tela.effect with tick, (transmute 0 to ref to void)
calling tela.dispose_effect with e
```

Effects run immediately and again after any tracked signal changes. A
`Scope` groups subscriptions and cleanups:

```pengu
var sc as tela.Scope is calling tela.scope
calling tela.scope_add with sc, (calling tela.bind_int with node, a->count)
calling tela.on_cleanup with sc, cleanup_fn, ctx
calling tela.scope_dispose with sc
```

`tela.shutdown` disposes the mount, registered signals and scopes. Do not use
the runtime after it.

## Registry and declarative bindings

```pengu
calling tela.register_int with "count", a->count
calling tela.register_bool with "is_zero", a->zero
calling tela.register_handler with "inc", on_inc
calling tela.mount with "#app"
```

| Attribute | Meaning |
|---|---|
| `data-tela-text="name"` | `textContent` from a text entry |
| `data-tela-html-unsafe="name"` | raw `innerHTML`; the caller owns escaping |
| `data-tela-show="name"` | toggles the `hidden` attribute |
| `data-tela-if="name"` | keeps/rebuilds the element from a `Signal<bool>` |
| `data-tela-value="name"` | two-way string input |
| `data-tela-value-int="name"` | two-way int input (invalid text is ignored) |
| `data-tela-value-float="name"` | two-way float input |
| `data-tela-checked="name"` | two-way checkbox, `Signal<bool>` |
| `data-tela-attr-NAME="name"` | sets attribute `NAME` |
| `data-tela-class-NAME="name"` | toggles class `NAME` |
| `data-tela-style-PROP="name"` | sets `style.PROP` |
| `data-tela-on-EVENT="handler"` | delegated handler (`click`, `keydown`, `submit`, `input`, `change`) |
| `data-tela-each="name"` | declarative keyed list, see below |

Names are plain identifiers; there is no expression parser. Registration
borrows the signal. Duplicate names panic. Unknown `data-tela-*` attributes
panic at mount.

`data-tela-if` clones the template once and replaces it with a comment anchor.
By default (`keep`) the node is removed when the condition is false but kept
detached, so its DOM state and subscriptions survive; true reinserts the same
node. `data-tela-if-mode="rebuild"` disposes the node and its subscriptions on
false and builds a fresh clone on true. `data-tela-each` rebuilds row content
through an explicit binder, so there is no field reflection.

## Declarative lists

```pengu
weave key with item as ref to Task into string:
    return item->id

weave bind_row with item as ref to Task, node as tela.Elem into void:
    var r as result of list of tela.Elem to js.JsError is calling dom.query_all_under with node, "[data-field=title]"
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

`register_each` takes callbacks first (a parser limitation), then the name and
the source signal. The template is cloned per key; `bind_row` fills the clone
on creation and on every update. Removed keys are disposed and removed.
The binder owns keyed identity; `data-tela-key` is ignored.

## Programmatic lists and conditional

```pengu
var sub as tela.Subscription is calling tela.each with key, render, update, container, signal
var c as tela.Subscription is calling tela.conditional with then_view, else_view, container, cond
```

`each` reuses nodes by key and appends in source order. The callbacks take a
`dummy as int` parameter in `conditional` because this compiler loses the
`dom.Element` alias in zero-argument function types.

## Events

Common events (`click`, `keydown`, `submit`, `input`, `change`) are delegated:
one listener on `document`, `closest("[data-tela-on-EVENT]")` walks up from the
real target. Clicking a child of a button therefore works. Handlers receive
the `event.Event` and can read `event.target` with `dom.wrap`. Other event names
fall back to a listener on the node.

## Forms

```pengu
calling tela.register_value_int with "age", a->age
calling tela.register_value_float with "score", a->score
```

`data-tela-value-int` / `-float` parse on `input`; invalid input keeps the old
value. Checkboxes use `data-tela-checked`. Select elements use
`data-tela-value` with a string signal.

## Router

`std.web.router` now exposes both hash and History routing:

```pengu
calling router.navigate_history with "/board", false
calling router.on_history_change with on_route
calling router.off_history with listener
```

Hash routing uses `navigate`/`on_change`; History routing uses
`navigate_history`/`on_history_change`. `navigate_history` calls
`pushState`/`replaceState` and does not emit `popstate`; render after the call.
The listener must be disposed explicitly.

## Async resources

`tela.resource` is a small state holder, not an I/O runtime. It carries
`data: Signal<maybe T>`, `loading: Signal<bool>`, `error: Signal<maybe string>`
and a version token. Start a request with `begin`, attach the handle with
`attach_request`, then call `finish`/`fail` from the callback with the returned
token; stale responses are ignored and both return whether they applied.

```pengu
var r as tela.Resource of string is calling tela.resource with (maybe none of string)
var token as u64 is calling tela.begin of string with (sigil of r)
var h as result of http.RequestHandle to js.JsError is calling http.get_abortable with "/api", on_ok, on_err
if h.is_ok:
    calling tela.attach_request of string with (sigil of r), h.value
calling tela.cancel of string with (sigil of r)   # aborts and bumps the token
calling tela.dispose_resource of string with (sigil of r)
```

`begin` aborts the previous handle, `cancel` aborts the current one without
marking an error, and `dispose_resource` aborts before disposing the signals.
Use `http.get_abortable`/`http.request_abortable`; `resource` owns the handle,
not the response payload.

## Lifecycle

`mount(selector)` scans the root and descendants with `query_all_under`,
binds attributes, installs delegated listeners and stores node handles.
`unmount()` disposes mount subscriptions, listeners and node handles;
`shutdown()` also frees registered signals, scopes and each binders.

## Limits (0.2.2)

- No SSR, hydration, CSS-in-JS or virtual DOM.
- Signals are single-threaded and main-thread only.
- `Signal` values should be copyable (primitives, strings, lists, runes
  without `Drop`).
- `data-tela-each` uses a binder; there is no field-name registry.
- `resource` owns the abort handle, but it does not parse or free the response;
  pair it with `std.web.http` callbacks and a `Scope`.
- `data-tela-if` default `keep` keeps subscriptions alive while hidden; use
  `data-tela-if-mode="rebuild"` when hidden state must be released.
- Generic method calls inside string interpolation are a compiler limitation;
  assign to a local first.
