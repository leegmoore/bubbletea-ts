# Windows Pseudo-Console, Signals, and Input Harness Plan

_Last updated: 2025-11-14_

## Objectives
- Provide a deterministic Windows console harness so we can translate the Go `signals_*`, `tty_windows.go`, and `inputreader_windows.go` behaviours into Vitest suites _before_ touching the TypeScript runtime.
- Define the production abstraction that will eventually talk to real Win32 APIs (`GetConsoleMode`, `SetConsoleMode`, `CreatePseudoConsole`, `ReadConsoleInput`, `CancelIoEx`) without binding those calls directly into the core program loop.
- Document how resize notifications, pseudo-console input, and VT enablement interact so future contributors can implement and test the shim incrementally.

## Current State
- `enableWindowsVirtualTerminalInput`/`enableWindowsVirtualTerminalOutput` are TODO stubs inside `packages/tea/src/internal/tty.ts`; they only ensure the functions are invoked when `process.platform === 'win32'`.
- `Program.setupResizeListener` currently relies on Node’s `'resize'` event on `stdout`, which is sufficient on Unix-like systems but untested for Windows and cannot exercise `WINDOW_BUFFER_SIZE_EVENT` semantics from the Go reference implementation.
- The cancelable input reader consumes Node streams directly; on Windows the Go runtime instead creates a dedicated console handle via `coninput`, toggles window/mouse input flags, and cancels blocking reads with `CancelIoEx`.
- No Vitest suites cover Windows console state, pseudo-console behaviour, or resize/input lifecycles—the only Windows-focused tests today are renderer/logging parity checks that mock `process.platform`.

## Go Reference Behaviour
- **`tty_windows.go`**
  - Opens `CONIN$` when a dedicated TTY is requested.
  - Saves stdin state via `term.MakeRaw`, enables `ENABLE_VIRTUAL_TERMINAL_INPUT`, and flips the output console mode to `ENABLE_VIRTUAL_TERMINAL_PROCESSING`.
  - Restores both the input raw state and the original console output mode during shutdown.
- **`inputreader_windows.go`**
  - Builds a `coninput` reader when stdin is an actual console, enabling `WINDOW_INPUT`, `EXTENDED_FLAGS`, and conditionally `MOUSE_INPUT` depending on mouse options.
  - Cancels blocking reads via `CancelIoEx`/`CancelIo` and resets console modes when the reader is closed.
- **`signals_windows.go`**
  - No direct resize handling because Windows lacks `SIGWINCH`; resize handling is delegated to console events rather than Unix signals.
- **`signals_unix.go` (contrast)**
  - Uses `SIGWINCH` to push `WindowSizeMsg` onto the message queue whenever the terminal resizes.

These files define the canonical behaviour that the TypeScript harness must emulate so the port stays faithful to Bubble Tea.

## Proposed Architecture
### 1. Injectable Windows Console Binding
- Introduce `WindowsConsoleBinding` in `packages/tea/src/internal/windows/binding.ts` exposing the minimal surface we need:
  - `getConsoleMode(handle: number): Promise<number>`
  - `setConsoleMode(handle: number, mode: number): Promise<void>`
  - `openConsoleInput(kind: 'stdin' | 'tty'): Promise<WindowsHandle>`
  - `enableVirtualTerminal(handle: WindowsHandle, flags: number): Promise<number>` (returns previous mode)
  - `readConsoleInput(handle: WindowsHandle, options): AsyncIterable<InputRecord>`
  - `cancelIo(handle: WindowsHandle): Promise<void>`
  - `closeHandle(handle: WindowsHandle): Promise<void>`
  - `createPseudoConsole(size, pipes): Promise<PseudoConsoleHandle>`
  - `resizePseudoConsole(pseudoConsole, size): Promise<void>`
- Export `setWindowsConsoleBindingForTests(binding)` so Vitest suites can swap in a fake implementation without monkey patching global modules. Production builds will lazily load a native binding (likely via `node-addon-api` or `ffi-napi`) only when `process.platform === 'win32'`.

### 2. Pseudo-Console Session Abstraction
- Create `PseudoConsoleSession` (TypeScript) that wraps the binding and exposes high-level helpers the runtime can call:
  - `prepareInput(options)` toggles VT/mouse bits and returns a cleanup function that restores the previous mode.
  - `prepareOutput(options)` toggles `ENABLE_VIRTUAL_TERMINAL_PROCESSING`.
  - `streamInput(options)` returns an async iterator that yields ANSI strings derived from `INPUT_RECORD`s, mimicking what Go’s `coninput` emits.
  - `watchResize(options)` converts `WINDOW_BUFFER_SIZE_EVENT`s into `WindowSizeMsg` payloads.
- This abstraction keeps Win32 details isolated from `Program` while still allowing deterministic tests through dependency injection.

### 3. Deterministic Fake Harness for Tests
- Add `packages/tests/src/utils/windows-console-harness.ts` implementing `FakeWindowsConsoleBinding`:
  - Keeps in-memory registers for console modes, window size, and pending `INPUT_RECORD`s (represented as POJOs).
  - Exposes helpers like `queueKeyRecord(sequence)`, `queueMouseRecord(...)`, and `queueResize(width, height)` so tests can script the console behaviour.
  - Tracks every `setConsoleMode`/`readConsoleInput` call, which Vitest assertions can inspect to guarantee we toggle the right flags.
  - Emits deterministic async iterables—no timers or platform dependencies—so suites can run everywhere (macOS/Linux CI included).
- Provide higher-level helpers (`createWindowsProgramHarness`) that create a Program wired to the fake binding, letting us assert end-to-end behaviour (raw mode setup, resize propagation, mouse enablement).

### 4. Signal/Resize Pump
- On Windows, resize events originate from `WINDOW_BUFFER_SIZE_EVENT`. The harness will map those events to `WindowSizeMsg`s.
- Implementation plan:
  - Extend the pseudo-console session with a `windowsResizePump` that consumes resize records and pushes sanitized sizes into the Program queue.
  - When `WithoutSignalHandler` is set, skip attaching the pump to mimic Go’s `WithoutSignalHandler` option.
  - Surface a fallback path that still listens to Node’s `'resize'` event on `stdout` so developers running inside Windows Terminal (which already emits ANSI) continue to work even if the binding is unavailable.

### 5. Input Reader Integration
- Replace the current `createCancelableInputReader` → `readAnsiInputs` stack with a Windows-aware adapter when the binding is available:
  - `WindowsInputReader` consumes `readConsoleInput` output, converts `KEY_EVENT_RECORD`s and `MOUSE_EVENT_RECORD`s into the same ANSI byte sequences we already parse, and writes them into the shared ANSI queue.
  - Cancellation flows call `cancelIo` on the active handle and rely on `FakeWindowsConsoleBinding` to simulate completion.
  - Mouse enablement decisions hook into `StartupOptions` (`WithMouseCellMotion`, `WithMouseAllMotion`) so we only add `ENABLE_MOUSE_INPUT` when needed.

### 6. Process Suspend Semantics
- `suspendProcess()` is a no-op on Windows today; retain that behaviour but cover it with a unit test to ensure we don’t accidentally send Unix-specific signals when `process.platform === 'win32'`.

## Test Translation & Coverage Plan
| Surface | Go Reference | Planned Vitest Suite | Notes |
| --- | --- | --- | --- |
| Raw mode & VT enablement | `tty_windows.go` | `packages/tests/src/tty/windows-tty.test.ts` | Verify we call `enableVirtualTerminal*`, toggle raw modes, and restore original console states. |
| Input reader cancellation + mouse flags | `inputreader_windows.go` | `packages/tests/src/input/windows-inputreader.test.ts` | Script fake records to ensure `CancelIoEx` equivalents fire, and that enabling mouse options toggles `ENABLE_MOUSE_INPUT`. |
| Resize handling | `signals_windows.go` + inferred behaviour from Go runtime | `packages/tests/src/signals/windows-resize.test.ts` | Queue `WINDOW_BUFFER_SIZE_EVENT`s and assert `WindowSizeMsg`s emit only when the signal handler is enabled. |
| Program lifecycle (ReleaseTerminal/RestoreTerminal) | `tea.go` behaviour around `ReleaseTerminal` | `packages/tests/src/program/windows-program.test.ts` | Assert cleanup calls the binding’s restore hooks and closes pseudo-console handles. |
| Mouse/focus command integration | `key.go` + runtime behaviour | extend `packages/tests/src/key/key.test.ts` | Use fake binding to confirm Windows mouse events become the same `MouseMsg`s as Unix. |

Each suite will import the fake binding helper and set `process.platform` to `'win32'` so we exercise the Windows code paths deterministically.

## Implementation Steps
1. **Scaffold the binding interface** (`windows/binding.ts`) and add a simple “null” implementation so non-Windows platforms continue to work without extra dependencies.
2. **Introduce test-only injection points** (`setWindowsConsoleBindingForTests`) and wire `enableWindowsVirtualTerminal*`/`openInputTTY` to consult the binding when `process.platform === 'win32'`.
3. **Build `FakeWindowsConsoleBinding` + harness utils** under `packages/tests/src/utils` with helpers for queuing records and inspecting state.
4. **Author the Vitest suites** listed above (initially focusing on raw mode + resize) and keep them skipped/xfail-free by stubbing the runtime adaptations behind the binding.
5. **Refactor the runtime** to consume the binding:
   - Update `setupTerminalInput` to call `prepareInput`/`prepareOutput`.
   - Extend the input reader stack with a Windows-specific branch.
   - Add the resize pump that listens to pseudo-console events.
6. **Implement the real binding** using `node-addon-api` (preferred) or `ffi-napi`, ensuring we only load it when `process.platform === 'win32'`.
7. **CI work**: add a `windows-latest` job executing both Vitest (`--runInBand --testNamePattern windows`) and `go test ./...` with `GOOS=windows`.

## Open Questions & Risks
- **Native binding footprint:** Shipping a Node addon increases install complexity. We need to evaluate whether `ffi-napi` can cover all required Win32 calls (including ConPTY APIs) without compiling C++.
- **Pseudo-console availability:** Windows versions prior to 10 1809 lack ConPTY; we should detect support and fall back to legacy behaviour (no mouse, no resize events) with clear warnings.
- **Test determinism:** The fake binding must guarantee deterministic ordering of queued records so Vitest suites don’t flake.
- **Performance:** Translating `INPUT_RECORD`s into ANSI sequences in JavaScript could be expensive; micro-benchmarks should accompany the implementation once the tests pass.
- **Developer ergonomics:** Need documentation to help contributors install the Windows prerequisites (build tools for node-addon-api) if they want to run the real binding locally.
