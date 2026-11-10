# Changelog

## [0.2.0] — 2026-11-09

- Runtime: dependency tracking per observer with cleanup, cycle guard, real
  observer disposal and registered-signal ownership.
- `data-tela-if` structural conditional with comment anchor.
- Declarative keyed `data-tela-each` over `<template>` with an explicit
  `register_each` binder (creation and update).
- Event delegation with `closest` for `click`, `keydown`, `submit`, `input`
  and `change`.
- `Scope`, `scope_add`, `on_cleanup`, `scope_dispose`.
- `Resource<T>` async state holder with `begin`/`finish`/`fail` tokens and
  explicit `dispose_resource`.
- Typed two-way inputs: `data-tela-value-int`, `data-tela-value-float`.
- History API helpers in `std.web.router` (`navigate_history`,
  `on_history_change`, `off_history`).
- New `examples/board` and `tests/browser/run-board.sh`.
- Requires `psc` 0.56.0 (DOM traversal/templates) and documents 0.2 limits.

## [0.1.0] — 2026-11-09

- Signals, `derived1`, effects, `batch`, typed registry.
- Declarative bindings, delegated events, `mount`/`unmount`.
- Keyed `each` and `conditional`; counter, TodoMVC and cards examples.
- English/Spanish manuals and MIT license.
