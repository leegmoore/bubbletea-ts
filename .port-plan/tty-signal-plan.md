# TTY & Signal Translation Plan

_Last updated: 2025-11-14_

## Objectives
- Capture the canonical Bubble Tea `tty_*`, `signals_*`, and `inputreader_*` behaviours in executable Go specs so we can port them into Vitest before changing the TypeScript runtime.
- Focus exclusively on the Unix/macOS workflow available in this environment. Windows-specific bindings, pseudo consoles, and coninput shims remain **out of scope** until a Windows toolchain exists.
- Provide an ordered backlog that unblocks the remaining Phase 4 work (input/tty/exec stack) once the current key/mouse suites are complete.

## Current Coverage Snapshot
- `packages/tests/src/tty/tty.test.ts` covers raw-mode toggles, `WithInputTTY`, non-TTY safeguards, and the nil-renderer short-circuit.
- `packages/tests/src/signals/resize.test.ts` exercises Unix-style resize propagation via Node’s `'resize'` event on writable TTY streams.
- `packages/tests/src/input/inputreader.test.ts` codifies cancel-reader behaviour (FIFO delivery, cancellation idempotency, close semantics).
- Gaps: no specs for `openInputTTY` error surfaces, raw-mode failure propagation, `/dev/tty` fallbacks, signal ignore/restore semantics during `Program.releaseTerminal`, or suspend/resume flows.

## Reference Go Sources
| Go file | Behaviour to mirror | Target TS suites/modules |
| --- | --- | --- |
| `tty.go` | Program bootstrap resolves tty input/output, enters raw mode, restores renderer + tty state on shutdown, `suspend()` releases/restores terminal | `packages/tests/src/tty/*.test.ts`, `packages/tests/src/program/tea.test.ts` (release/suspend cases)
| `tty_unix.go` | `initInput` raw-mode negotiation, `/dev/tty` fallback via `openInputTTY`, `suspendProcess` SIGTSTP handling | `packages/tests/src/tty/tty.test.ts` (fallback/error paths), future `packages/tests/src/program/suspend.test.ts`
| `signals_unix.go` | `listenForResize` uses `SIGWINCH` to call `checkResize` repeatedly | `packages/tests/src/signals/resize.test.ts` (extend with SIGWINCH mocks + `Program.checkResize` assertions)
| `inputreader_other.go` | Default cancelreader passthrough—covers cleanup/error propagation | `packages/tests/src/input/inputreader.test.ts`

Because upstream Bubble Tea does not ship dedicated `tty`/`signals` Go specs, we will author Go tests inside this repo (e.g., `tty_raw_mode_test.go`, `signals_unix_test.go`) to canonically describe the behaviour, run them via `go test ./...`, and then translate each file 1:1 into Vitest suites.

## Harness & Tooling Work (Unix only)
- **Fake tty devices:** extend `packages/tests/src/utils/fake-tty.ts` to track file descriptors, raw-mode failure injection, and `emit('resize')` helpers so we can assert raw-mode restoration and listener cleanup.
- **TTY opener shim:** export `setOpenInputTTYForTests` so Vitest cases can stub `/dev/tty` opens without touching the real filesystem.
- **Signal dispatcher mock:** add a lightweight helper that spies on `process.on('SIGWINCH')` / `process.off` to simulate Go’s `signal.Notify` lifecycle before we translate the Unix resize specs.

## Translation Plan
### 0. Author canonical Go specs
1. Add `tty_raw_mode_test.go` covering: raw-mode entry/restore, non-tty short-circuits, `WithoutRenderer`, `WithInputTTY`, and `/dev/tty` open failures surfacing as `ErrProgramPanic`.
2. Add `signals_unix_test.go` verifying that `Program.checkResize` is invoked on SIGWINCH and that `ReleaseTerminal` suppresses resize handling until `RestoreTerminal` runs.
3. Commit + run `go test ./...` to freeze the behaviour before porting.

### 1. Expand TTY Vitest suites
- Split `packages/tests/src/tty/tty.test.ts` into focused describes (`raw-mode`, `input resolution`) and port each Go test: raw-mode enable/restore, non-tty guard, `WithoutRenderer`, fallback via `/dev/tty` or `WithInputTTY`, and error propagation when `openInputTTY` throws.
- Add a dedicated `packages/tests/src/tty/open-input-tty.test.ts` that stubs the exported `openInputTTY` helper to assert device paths, file descriptor cleanup on `ReadStream` constructor failures, and error cosmetics.

### 2. Unix SIGWINCH & release/suspend handling
- Update `packages/tests/src/signals/resize.test.ts` to mirror the forthcoming Go SIGWINCH spec: assert that `Program.setupResizeListener` emits an initial `WindowSizeMsg`, reacts to multiple `resize` events, and stops listening after `Program.finish()` or `ReleaseTerminal`.
- Add regression specs proving `WithoutRenderer` (and programs with `ignoreSignals=true`) skip installing resize listeners, matching Go’s `listenForResize` guard.
- Once the Go `suspend` test lands, add `packages/tests/src/program/suspend.test.ts` verifying that `Program.releaseTerminal()` + `Program.restoreTerminal()` mirror the raw-mode/renderer toggles, and that a `Suspend` command emits `ResumeMsg` after the mocked `suspendProcess()` resolves.

### 3. Input reader cancelation semantics
- Reuse the Go `inputreader_other.go` cases to assert that canceling the reader closes the underlying stream exactly once, that `Close()` resolves outstanding reads, and that double-cancel behaves like Go’s `cancelreader` (returns false).

## Platform Constraints & Mitigations
- **/dev/tty availability:** macOS runners expose `/dev/tty`, but CI containers may not; Vitest specs must stub `openSync`/`ReadStream` instead of touching the real device.
- **Signal delivery:** Node’s `'resize'` events already proxy SIGWINCH, but we can’t rely on real OS signals inside Vitest. Tests will trigger `output.emit('resize')` manually and assert listener cleanup via spies on `output.off/removeListener`.
- **Raw-mode toggles on shared stdin:** We never call `setRawMode` on the real `process.stdin` during tests; fakes implement `setRawMode`/`isRaw` so we can assert state transitions deterministically.

## Execution Order / Next Actions
1. Land the Go-spec scaffolding (`tty_raw_mode_test.go`, `signals_unix_test.go`), prove `go test ./...` passes.
2. Mirror each Go file into Vitest suites (`packages/tests/src/tty/*.test.ts`, `packages/tests/src/signals/*.test.ts`, `packages/tests/src/input/*.test.ts`) using the harness upgrades above.
3. Only after the translated tests are green should we touch the TypeScript runtime (e.g., implementing suspend hooks). Document each completed suite in `.port-plan/progress-log.md` under the Test Parity checklist.
