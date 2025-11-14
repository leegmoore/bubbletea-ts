# Windows Console Guide (TypeScript)

_Last updated: 2025-11-14_

Bubble Tea’s Go runtime leans on Win32 console APIs for resize events,
mouse/key input, and VT capability toggles. The TypeScript port mirrors that
behaviour by routing every Windows-only operation through the
`WindowsConsoleBinding` shim and by keeping the tests in
`packages/tests/src/input/windows-console-input.test.ts` and
`packages/tests/src/signals/windows-resize.test.ts` as the executable spec.

## ReleaseTerminal / RestoreTerminal

- `Program.releaseTerminal()` pauses the ANSI reader, stops the renderer, and
  calls `restoreTerminalState()` to undo alt-screen, bracketed paste, focus, and
  mouse toggles before handing control back to the user. (Mouse motion itself
  must be re-enabled manually after a restore, matching Go’s behaviour.)
- During release we remember which terminal capabilities were enabled so
  `Program.restoreTerminal()` can re-run `setupTerminalInput()`, reattach the
  reader, and reapply the renderer settings (alt screen, bracketed paste,
  focus) without restarting the program.
- Tests in `packages/tests/src/program/tea.test.ts:1574` assert that release
  never stops the program, properly restores raw mode, and only re-enables the
  modes that were active beforehand.
- Any failure while tearing down (for example, VT enable flags failing to flip)
  bubbles through `handlePanic(...)`, causing the program to kill itself just
  like the Go runtime—so treat release/restore as best-effort but fatal on
  inconsistent state.

## Pseudo-console lifecycle

- `setupWindowsResizeListener()` requests a pseudo console from the binding the
  first time a Windows TTY output is detected. The binding exposes synthetic
  input handles, letting us await `readConsoleInput()` for
  `WINDOW_BUFFER_SIZE`, `KEY_EVENT`, and `MOUSE_EVENT` records.
- Records are fed straight into `translateWindowsKeyRecord(...)` and
  `translateWindowsMouseRecord(...)`, which emit Bubble Tea `KeyMsg` or
  `MouseMsg` objects. The fakes in
  `packages/tests/src/utils/windows-console-harness.ts` queue these records so
  the Vitest suites can force every edge case (repeat counts, modifier masks,
  wheel deltas, etc.).
- When the program stops (or when you call `releaseTerminal()`), we cancel the
  pending `readConsoleInput()` stream and call `closePseudoConsole(...)` so
  handles don’t leak. Tests in
  `packages/tests/src/signals/windows-resize.test.ts` assert that tear-down is
  deterministic.

## VT + mouse toggles

- Before the input reader goes into raw mode we flip both
  `ENABLE_VIRTUAL_TERMINAL_INPUT` and
  `ENABLE_VIRTUAL_TERMINAL_PROCESSING` by calling
  `enableWindowsVirtualTerminalInput/Output(...)`. Every Windows render path
  and `Program.Printf` payload runs through a CRLF normalizer so ANSI output is
  console-safe.
- The runtime (next step in this loop) will also set
  `ENABLE_WINDOW_INPUT` + `ENABLE_EXTENDED_FLAGS` whenever a Windows TTY input
  handle is present, mirroring Go’s `prepareConsole(...)` helper. When mouse
  tracking is enabled (`WithMouseCellMotion`, `WithMouseAllMotion`,
  `EnableMouseCellMotion()`, `EnableMouseAllMotion()`), we additionally set the
  `ENABLE_MOUSE_INPUT` flag. `DisableMouse()` clears it.
- Mode updates happen in tandem with renderer commands so the binding always
  reflects the active Bubble Tea configuration. If the native binding throws
  while mutating console modes we panic immediately—the program can’t safely
  continue because Windows will continue to deliver stale events.
- `packages/tests/src/program/windows-console-mode.test.ts` guards these
  invariants by seeding fake console modes, toggling mouse commands, and
  asserting that the Win32 flags change exactly when the Go tests say they
  should.

## Troubleshooting

- `BubbleTeaWindowsBindingError` during startup means the loader exhausted every
  resolution path (path override, addon, FFI). Review
  [`docs/windows-console-binding-loader.md`](./windows-console-binding-loader.md)
  for the full env matrix (`BUBBLETEA_WINDOWS_BINDING_PATH`,
  `BUBBLETEA_WINDOWS_BINDING_MODE`, `BUBBLETEA_WINDOWS_BINDING_ALLOW_FFI`) and for
  a checklist of common fixes.
- When Vitest suites need deterministic bindings, prefer
  `setWindowsConsoleBindingForTests()` or
  `setWindowsBindingModuleLoaderForTests()` instead of monkey-patching runtime
  internals; both helpers clean themselves up via
  `resetWindowsConsoleBindingLoaderForTests()`.
- If mouse toggles or pseudo console resizes silently stop working, confirm the
  loader actually returned a binding (log the result of
  `ensureWindowsConsoleBindingLoaded()` in development) and verify your process
  truly runs on `win32`—non-Windows platforms will always skip the binding and
  swallow those commands.

## Takeaways for future Windows work

- All Windows-only behaviour flows through the binding, so new features (TTY
  suspension, exec integration, Clipboard APIs, etc.) should add binding
  methods first, then reference them from the runtime, and finally lock them
  down with Vitest harnesses.
- When extending release/resume or suspend/interrupt handling, make sure the
  pseudo-console reader and the console mode flags are released first—leaking a
  pending `readConsoleInput()` call will block exiting on Windows.
- Treat any failure from the binding as fatal in the runtime to avoid leaving
  the real console in a partially-configured state.
