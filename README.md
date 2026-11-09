# tela

[English](docs/en/README.md) · [Español](docs/es/README.md)

`tela` is a small, explicit reactive UI layer for PenguScript compiled to
WebAssembly. HTML declares structure; PenguScript owns state and behaviour.
No eval, no expression DSL, no virtual DOM.

```pengu
import tela
import std.web.dom as dom

rune App:
    count as tela.Signal of int

weave app into ref to App:
    static var a as App is with count is (calling tela.signal with 0)
    return sigil of a

weave on_inc with ev as event.Event into void:
    var a as ref to App is calling app
    calling tela.set_int with a->count, (calling a->count.get) + 1

weave main into int:
    var a as ref to App is calling app
    calling tela.register_int with "count", a->count
    calling tela.register_handler with "inc", on_inc
    calling tela.mount with "#app"
    return 0
```

```html
<div id="app">
  <h1 data-tela-text="count"></h1>
  <button data-tela-on-click="inc">+1</button>
</div>
```

Build with `psc build --target wasm`. See the counter, TodoMVC and card-list
examples under `examples/`.

- License: MIT.
- Scope: MVP 0.1.0. `data-tela-if` and declarative `data-tela-each` are
  deliberately deferred; use `tela.conditional` and `tela.each`.
