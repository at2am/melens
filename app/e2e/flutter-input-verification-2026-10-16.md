# Flutter Web input verification, 2026-10-16

Tested main: `2f0374a52a0ff56bb460b5257dabc2f46f32e63c`.
App source: `32c674bc8576984a1ab847a06960b4ab2be4fbe7b5fade49e0de16117975485e`.
Pinned Flutter: `3.47.5`.

## Application correction

Showing a Tooltip could create a new ModalRoute sort-key semantics node. The browser then moved the whole route DOM subtree and blurred the input. This also happened without a map and with direct keyboard input.

`app/lib/app/app.dart` now puts `Semantics(container: true, explicitChildNodes: true)` above the Navigator. The route node exists from the first frame. Tooltip appearance and removal no longer change the input's ancestry. Visual tooltips, accessible names and existing focus behavior remain in place.

The real `MelensApp` widget regressions cover Chat and Feed editing. Browser tests also type while a Tooltip appears and disappears, then change tabs and close and reopen Chat. These tests retain exact full-text assertions.

## Separate SDK race, unresolved

The semantics text-input strategy receives native focus before it installs input listeners. A later semantics frame activates the strategy and writes its cached initial value. Characters entered in that interval can be lost. This is separate from route reparenting. The same input element can remain focused throughout the failure.

One captured New Feed failure had this sequence, relative to the probe's start marker:

| Time | Event |
| --- | --- |
| 272.3 ms | The native Name input gains focus. |
| 284.9 ms | The first `E` key reaches the native input. |
| 291.1 ms | Flutter installs its input listener. The native value is `E`. |
| 291.3 ms | Flutter writes its initial empty value. |
| 408.1 ms | The final value is `2E planning b04b08dc`, missing the first character. |

The pinned engine's `semantics/text_field.dart` sends `SemanticsAction.focus` from the DOM focus handler, then activates `SemanticsTextEditingStrategy` in a later update. `text_editing/text_editing.dart` installs listeners and applies `lastEditingState` during activation. The ordinary strategy used with semantics disabled follows a different initialization path.

Direct keyboard input reproduced the failure. Locator refocusing is not required. An extra diagnostic call between tap and typing changed the timing and hid the failure. Neither that call nor `autofocus` was accepted as a product fix. No SDK cache, global DOM method or input value was patched.

## Browser driver synchronization

The functional suites use `tests/flutter-focus.ts` where this initial handoff is required. It performs a real tap, waits for two animation frames with a timeout, and checks that the same editable DOM element remains connected and focused. It then sends the text once with the real keyboard and checks the whole value. It does not refill a lost prefix, request focus again or replay a business action.

This is framework focus settling. It is not a public editing-ready signal or a repair of the SDK race. The no-wait negative evidence remains under `.e2e/feed-prefix-probe-evidence/`, including `root-cause.md` and `keyboard-first-1792083626661.json`. Diagnostic reports remain separate from the selected functional acceptance counts.
