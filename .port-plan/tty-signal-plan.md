# TTY & Signal Translation Plan

_Last updated: 2025-11-14_

## Objectives
- Capture the canonical Bubble Tea `tty_*`, `signals_*`, and `inputreader_*` behaviours in executable Go specs so we can port them into Vitest before changing the TypeScript runtime.
- Enumerate the fake terminals, pseudo-console harnesses, and Node-specific shims we need so tty/raw-mode and signal handling can be tested deterministically on macOS/Linux and Windows.
- Provide an ordered backlog that unblocks Phase 4 of the port (input/tty/exec stack) once the current key/mouse suites are complete.

## Current Coverage Snapshot
- `packages/tests/src/tty/tty.test.ts` already covers basic raw-mode toggles, `WithInputTTY`, non-TTY safeguards, `WithoutRenderer`, and Windows VT enablement calls.
- `packages/tests/src/signals/resize.test.ts` exercises Unix-style resize propagation via Node’s `'resize'` event on writable TTY streams; `signals/windows-resize.test.ts` proves pseudo-console resize propagation and teardown through `FakeWindowsConsoleBinding`.
- Gaps: no specs for `openInputTTY` error surfaces, raw-mode failure propagation, Windows console mode restoration, pseudo-console resize/mouse record fan-out, signal ignore/restore semantics during `Program.releaseTerminal`, and no coverage for the Windows `coninput`-style cancel reader/cancelation edge cases (Go’s `inputreader_windows.go`).

## Reference Go Sources
| Go file | Behaviour to mirror | Target TS suites/modules |
| --- | --- | --- |
| `tty.go` | Program bootstrap resolves tty input/output, enters raw mode, restores renderer + tty state on shutdown, `suspend()` releases/restores terminal | `packages/tests/src/tty/*.test.ts`, `packages/tests/src/program/tea.test.ts` (release/suspend cases)
| `tty_unix.go` | `initInput` raw-mode negotiation, `/dev/tty` fallback via `openInputTTY`, `suspendProcess` SIGTSTP handling | `packages/tests/src/tty/tty.test.ts` (fallback/error paths), future `packages/tests/src/program/suspend.test.ts`
| `tty_windows.go` | Windows VT input/output enablement, console mode capture/restore, `CONIN$` fallback | `packages/tests/src/tty/windows-terminal.test.ts`, existing `FakeWindowsConsoleBinding` harness
| `signals_unix.go` | `listenForResize` uses `SIGWINCH` to call `checkResize` repeatedly | `packages/tests/src/signals/resize.test.ts` (extend with SIGWINCH mocks + `Program.checkResize` assertions)
| `signals_windows.go` | No SIGWINCH; rely on console records | `packages/tests/src/signals/windows-resize.test.ts`, `packages/tests/src/input/windows-console-input.test.ts`
| `inputreader_other.go` | Default cancelreader passthrough—covers cleanup/error propagation | `packages/tests/src/input/inputreader.test.ts`
| `inputreader_windows.go` | `coninput` handle acquisition, mouse-flag toggles, `CancelIoEx` cancel semantics, console mode restoration on close | `packages/tests/src/input/windows-console-input.test.ts`, upcoming `packages/tests/src/internal/windows/input-reader.test.ts`

Because upstream Bubble Tea does not ship dedicated `tty`/`signals` Go specs, we will author Go tests inside this repo (e.g., `tty_raw_mode_test.go`, `signals_unix_test.go`, `inputreader_windows_test.go`) to canonically describe the behaviour, run them via `go test ./...`, and then translate each file 1:1 into Vitest suites.

## Harness & Tooling Work
- **Fake tty devices:** extend `packages/tests/src/utils/fake-tty.ts` to track file descriptors, raw-mode failure injection, and `emit('resize')` helpers so we can assert raw-mode restoration and listener cleanup.
- **TTY opener shim:** expose `setOpenInputTTYForTests` (mirroring the Windows binding loader pattern) so Vitest cases can stub `/dev/tty`/`CONIN$` opens without touching the real filesystem.
- **Signal dispatcher mock:** add a lightweight helper that spies on `process.on('SIGWINCH')` / `process.off` to simulate Go’s `signal.Notify` lifecycle before we translate the Unix resize specs.
- **Windows console harness:** keep using `FakeWindowsConsoleBinding`, but add record helpers for synthetic `MOUSE_EVENT` and `KEY_EVENT` payloads plus size sanitization assertions so resize + input tests share the same instrumentation.
- **Cancelable reader helpers:** extend `packages/tests/src/utils/windows-terminal.ts` to expose `queueInputRecord`/`destroy` shortcuts for the upcoming `inputreader_windows` suites.

## Translation Plan
### 0. Author canonical Go specs
1. Add `tty_raw_mode_test.go` covering: raw-mode entry/restore, non-tty short-circuits, `WithoutRenderer`, `WithInputTTY`, and `/dev/tty` open failures surfacing as `ErrProgramPanic`.
2. Add `signals_unix_test.go` verifying that `Program.checkResize` is invoked on SIGWINCH and that `ReleaseTerminal` suppresses resize handling until `RestoreTerminal` runs.
3. Add `inputreader_windows_test.go` exercising `prepareConsole`, `Cancel`, and `Close` semantics using stubbed handles so we can prove Windows-specific mode toggles.
4. Commit + run `go test ./...` to freeze the behaviour before porting.

### 1. Expand TTY Vitest suites
- Split `packages/tests/src/tty/tty.test.ts` into focused describes (`raw-mode`, `input resolution`, `windows vt`) and port each Go test: raw-mode enable/restore, non-tty guard, `WithoutRenderer`, fallback via `/dev/tty` or `WithInputTTY`, error propagation when `openInputTTY` throws, and Windows VT flag toggles (including mouse flag differences based on startup options).
- Add a dedicated `packages/tests/src/tty/open-input-tty.test.ts` that stubs the exported `openInputTTY` helper to assert device paths (`/dev/tty` vs `CONIN$`), file descriptor cleanup on `ReadStream` constructor failures, and error cosmetics.
- Introduce `packages/tests/src/tty/windows-console-mode.test.ts` (or extend the existing program suite) to ensure `restoreWindowsConsoleMode` is called exactly once, even if `getWindowsConsoleBinding` fails during teardown.

### 2. Windows pseudo-console & input reader suites
- Extend `packages/tests/src/signals/windows-resize.test.ts` with cases where `readConsoleInput` streams key/mouse records before resize messages to ensure `setupWindowsResizeListener` fans them out via `handleWindowsConsoleRecord` without dropping resize events.
- Add `packages/tests/src/input/windows-coninput.test.ts` that uses `FakeWindowsConsoleBinding` to emulate the Go `coninput` reader: enabling `WINDOW_INPUT`/`EXTENDED_FLAGS`, toggling `ENABLE_MOUSE_INPUT` when mouse options demand it, and verifying `cancelIo` is invoked when the reader is canceled.
- Port Go’s console teardown expectations: pseudo console handles must be closed and `cancelIo` must run even when `Program.quit()` races with pending records.

### 3. Unix resize & signal handling
- Update `packages/tests/src/signals/resize.test.ts` to mirror the forthcoming Go SIGWINCH spec: assert that `Program.setupResizeListener` emits an initial `WindowSizeMsg`, reacts to multiple `resize` events, and stops listening after `Program.finish()` or `ReleaseTerminal`.
- Add a regression spec proving `WithoutRenderer` (and programs with `ignoreSignals=true`) skip installing resize listeners, matching Go’s `listenForResize` guard.

### 4. Release/suspend lifecycle
- Once the Go `suspend` test lands, add `packages/tests/src/program/suspend.test.ts` verifying that `Program.releaseTerminal()` + `Program.restoreTerminal()` mirror the raw-mode/renderer toggles, and that a `Suspend` command emits `ResumeMsg` after the mocked `suspendProcess()` resolves.
- Ensure windows console mode capture/restoration tests live here so release/suspend coverage stays centralized.

### 5. Input reader cancelation semantics
- Reuse the Go `inputreader_windows_test.go` cases to assert that canceling the reader triggers `CancelIo` exactly once, that `Close()` restores the saved console mode, and that double-cancel behaves like Go’s `cancelreader` (returns false).
- Keep the cross-platform `inputreader.test.ts` suite for the non-Windows path, but add negative tests where the underlying stream emits errors or closes mid-read to guarantee parity with Go’s `cancelreader.NewReader`.

## Platform Constraints & Mitigations
- **/dev/tty availability:** macOS runners expose `/dev/tty`, but CI containers may not; Vitest specs must stub `openSync`/`ReadStream` instead of touching the real device. Export an override hook (`setOpenInputTTYImplementationForTests`) so we can inject fake descriptors.
- **Windows-only APIs:** Until a real Node-API binding ships, all Windows console tests will rely on `FakeWindowsConsoleBinding`. Production code must guard all binding access with `try/catch` and treat missing bindings as opt-outs; tests will assert these guards via simulated loader failures.
- **Signal delivery:** Node’s `'resize'` events already proxy SIGWINCH, but we can’t rely on real OS signals inside Vitest. Tests will trigger `output.emit('resize')` manually and assert listener cleanup via spies on `output.off/removeListener`.
- **Raw-mode toggles on shared stdin:** We never call `setRawMode` on the real `process.stdin` during tests; fakes implement `setRawMode`/`isRaw` so we can assert state transitions deterministically.

## Execution Order / Next Actions
1. Land the Go-spec scaffolding (`tty_raw_mode_test.go`, `signals_unix_test.go`, `inputreader_windows_test.go`), prove `go test ./...` passes.
2. Mirror each Go file into Vitest suites (`packages/tests/src/tty/*.test.ts`, `packages/tests/src/signals/*.test.ts`, `packages/tests/src/input/*.test.ts`) using the harness upgrades above.
3. Only after the translated tests are green should we touch the TypeScript runtime (e.g., implementing suspend hooks or refining `setupWindowsResizeListener`). Document each completed suite in `.port-plan/progress-log.md` under the Test Parity checklist.

With this plan in place, the next concrete task is to translate the Go tty specs (Raw mode + `/dev/tty` fallback) into Vitest using the fake TTY/open hooks above, then proceed to the signal/input reader suites.

