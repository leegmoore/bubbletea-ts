# Decision Log
Capture durable architectural/process choices. Use the table below for quick reference; elaborate beneath if necessary.

| ID | Date | Title | Decision | Status |
| --- | --- | --- | --- | --- |
| D-001 | 2025-11-14 | Target runtime/tooling | Port targets Node.js ≥ 20.11, TypeScript 5.x, ESM-first output bundled with tsup; pnpm manages the workspace. | Final |
| D-002 | 2025-11-14 | Tests-first methodology | All Go tests are translated to Vitest suites _before_ implementing production code so specs remain the oracle. | Final |
| D-003 | 2025-11-14 | Session ritual & logging | Every session reads `.port-plan/plan.md`, `progress-log.md`, `decision-log.md`, then updates the logs before ending to keep the loop stateless. | Final |
| D-004 | 2025-11-14 | Cmd async contract | TypeScript `Cmd` functions may return synchronously or via `Promise`, matching Go semantics while remaining non-blocking. | Final |
| D-005 | 2025-11-14 | Timer scheduling semantics | `Tick` and `Every` spin up timers upon command creation and resolve via promises so they align with the system clock and work with fake timers. | Final |
| D-006 | 2025-11-14 | Program scaffold & options | `Program` exposes Go-parity startup options (`WithOutput`, `WithMouse*`, etc.) with Node stream defaults and test-friendly bitsets. | Final |
| D-007 | 2025-11-14 | Runtime error taxonomy | Adopted `ProgramKilledError`/`ProgramPanicError` subclasses mirroring Go’s error contract so callers can rely on `instanceof`. | Final |
| D-008 | 2025-11-14 | Program runtime architecture | Single-threaded state machine with async queue, filter-first dispatch, key-input synthesis, and AbortController teardown mirrors Go’s lifecycle. | Final |
| D-009 | 2025-11-14 | Renderer flushing strategy | `StandardRenderer` buffers frames, flushes on an FPS ticker, and tracks cursor/alt-screen state to restore terminals after panics. | Final |
| D-010 | 2025-11-14 | Logging adapter strategy | `LogToFile` wires console-backed adapters with normalized prefixes and stream fan-out matching Go’s `log.Default()`. | Final |
| D-011 | 2025-11-14 | Renderer spec dependency | Renderer/runtime changes remain blocked until a translated Go spec exists, preventing speculative edits. | Superseded (see D-012) |
| D-012 | 2025-11-14 | Renderer spec synthesis | Authored a Go renderer spec (`renderer_standard_test.go`) to serve as the canonical reference before porting to TypeScript. | Final |
| D-013 | 2025-11-14 | Renderer print-line contract | Added `bubbletea/print-line` messages plus queued flush semantics so `Program.Printf` output renders ahead of frames. | Final |
| D-014 | 2025-11-14 | Scroll-area helper parity | Ported ignored-line tracking plus `SyncScrollArea`/`ScrollUp`/`ScrollDown` commands so ANSI scroll regions behave like Go. | Final |
| D-015 | 2025-11-14 | Printf formatting strategy | Replaced `util.format` with a Go-parity formatter honoring flags/width/precision so `tea.Printf` matches `fmt.Sprintf`. | Final |
| D-016 | 2025-11-14 | Printf zero-flag parity | Integer verbs treat the zero flag as implicit precision and float verbs keep zero padding, matching Go’s formatter semantics. | Final |
| D-017 | 2025-11-14 | Startup toggle enforcement | Startup flags (alt screen, bracketed paste opt-out, mouse SGR, focus reporting) now apply immediately after `renderer.start()`. | Final |
| D-018 | 2025-11-14 | Logging fan-out helper | `FanOutWritable`/`createMultiWriterLogOptions` mirror Go’s `io.MultiWriter`, allowing console/file fan-out without double-closing streams. | Final |
| D-019 | 2025-11-14 | Console patch lifecycle | `ConsoleLogOptions` reference-count active outputs and restore the original `console` methods once all log streams close. | Final |
| D-052 | 2025-11-14 | Mouse string helper parity | Added `mouseEventToString` plus parser exports so translated mouse specs exercise the real formatter/parsers before runtime changes. | Final |
| D-053 | 2025-11-15 | Signal handling injection | Program installs SIGINT/SIGTERM listeners through a pluggable `SignalSource` (defaults to `process`) so tests can inject fakes while `WithoutSignals`/`WithoutSignalHandler` mirror Go semantics. | Final |
| D-054 | 2025-11-15 | Suspend process bridge strategy | Implemented the Unix-only `createSuspendBridge` helper that signals the process group, falls back to the PID, and exposes an injectable bridge so the runtime’s `suspendProcess` uses the real flow under test control. | Final |
| D-055 | 2025-11-15 | Formatter spec extraction | Moved the Printf `%#v`/`%+v` parity suite into `packages/tests/src/fmt/printf.test.ts` and centralized the Go-like pointer/channel helpers in `packages/tests/src/utils/go-values.ts` for reuse. | Final |
| D-056 | 2025-11-15 | Resize listener gating | `Program.releaseTerminal()` now tears down the resize listener and `Program.restoreTerminal()` reinstalls it so WindowSize events pause while the terminal is released. | Final |

**Windows-specific decisions (D-020, D-047, D-048, D-049, D-050, D-051)** were removed on 2025-11-14 after scoping Windows work out of this macOS-only loop.
