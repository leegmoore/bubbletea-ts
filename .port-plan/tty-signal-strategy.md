# TTY & Signal Test Strategy

_Date: 2025-11-15_

## Objectives
- Codify the ReleaseTerminal/RestoreTerminal + signal-handling contract in Go **before** touching the TypeScript runtime so Vitest stays downstream of the source-of-truth.
- Cover how Bubble Tea responds to SIGINT/SIGTERM (plus the `WithoutSignals`/`WithoutSignalHandler` knobs) and how releasing the terminal during suspend temporarily disables signal delivery.
- Define the fake signal emitters we need on the TypeScript side so we can deterministically emit signals without touching the real `process` object during tests.

## Go Specs to Author (source of truth)
1. **`TestHandleSignalsDeliversInterruptAndQuit` (new `tea_signals_test.go`)**
   - Spin up a `Program`, call `handleSignals()`, and send the current PID `SIGINT` then `SIGTERM` using `syscall.Kill`.
   - Assert the first signal enqueues `InterruptMsg` and terminates the handler; a second handler invocation enqueues `QuitMsg`.
2. **`TestHandleSignalsHonorsIgnoreSignals` (same file)**
   - Force `ignoreSignals` to `1`, emit SIGINT, and assert that no message is sent and the handler keeps running until the context is canceled.
3. **`TestReleaseTerminalTogglesIgnoreSignals` (extends `tty_raw_mode_test.go` harness)**
   - After `ReleaseTerminal`, `atomic.LoadUint32(&p.ignoreSignals)` should be `1`; after `RestoreTerminal`, it should return to `0`.
4. **`TestSuspendReenablesSignalsAfterResume`**
   - Call `ReleaseTerminal` followed by `RestoreTerminal` to mimic the suspend flow and ensure the flag flips back plus the renderer/input mocks reinitialize.

These specs live alongside the existing TTY harness so we can reuse the fake renderer/input bits without touching the real terminal. Once green in Go, port them to Vitest verbatim.

## TypeScript Translation Plan
- **File structure:** add `packages/tests/src/signals/handlers.test.ts` mirroring the Go subtests; keep resize-specific coverage in `resize.test.ts`.
- **Scenarios:**
  1. `SIGINT` ⇒ emit `InterruptMsg`, surface `ProgramInterruptedError` from `run()`.
  2. `SIGTERM` ⇒ enqueue `QuitMsg` and finish cleanly.
  3. `ignoreSignals` true (via `WithoutSignals()` or after `releaseTerminal()`) ⇒ emitted signals are ignored until `restoreTerminal()` flips the flag.
  4. `WithoutSignalHandler()` ⇒ no listeners are ever registered.

## Fake Signal Infrastructure (TS)
- Introduce `TestProcessSignals` under `packages/tests/src/utils/fake-process-signals.ts` implementing a minimal subset of `process` (`on`, `off`, `emit`). It tracks active handlers per signal and exposes helpers to assert registration counts.
- Update `Program` to consume a pluggable `signalSource` (defaulting to the real `process`) so tests can inject `TestProcessSignals` without mutating globals.
- Provide a light wrapper (e.g., `withFakeSignals(program, fakeSignals, fn)`) so suites can swap the source before calling `program.start()` and restore afterwards.

## Open Questions
- Windows `SIGINT` semantics differ; macOS + Linux coverage is enough for this loop per guardrails, but note we’ll need follow-up specs when Windows support returns.
- `Suspend()` currently stubs `suspendProcess()` in TypeScript; once signal handling exists, we should revisit sending SIGTSTP/SIGCONT via a spawned child instead of the current no-op.

With these pieces in place we can continue TDD by: (1) landing the Go specs, (2) translating them to Vitest, (3) wiring the runtime so the new suites go green.
