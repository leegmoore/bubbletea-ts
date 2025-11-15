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

## Suspend Process Bridge (2025-11-15)

### Goals
- Mirror Go’s `suspendProcess()` semantics: release the terminal, send `SIGTSTP` to the foreground process group, block until `SIGCONT`, then resume rendering/input and queue a `ResumeMsg`.
- Keep the behaviour opt-in on Unix/macOS (`process.platform !== 'win32'`) and fall back to a fast resolve on unsupported platforms so CI on Windows doesn’t deadlock.
- Preserve the tests-first workflow: define deterministic specs around the suspend bridge before wiring the runtime so we can validate listener cleanup and error handling without actually stopping the Vitest runner.

### Constraints & Environment Notes
- `process.kill(process.pid, 'SIGTSTP')` suspends the active Node process immediately, meaning `Program.handleSuspend` must register the `SIGCONT` handler **before** sending the signal.
- Go sends the signal to the whole process group (`kill(0, SIGTSTP)`); in Node we can approximate this with `process.kill(-process.pid, 'SIGTSTP')`, but that requires the current process to be the group leader. We need a safe fallback to the direct PID.
- Tests cannot deliver a real `SIGTSTP`/`SIGCONT` cycle or Vitest will freeze. We need an injectable adapter around the kill/listen primitives so unit tests can verify ordering without touching the real process.

### Proposed Implementation
1. **Internal helper:** add `packages/tea/src/internal/suspend.ts` exporting `createSuspendBridge(processLike)`.
   - `processLike` implements `{ pid: number; platform: NodeJS.Platform; kill(targetPid: number, signal: NodeJS.Signals): void; once(event, listener); off(event, listener); }`.
   - `createSuspendBridge` returns `() => Promise<void>` that:
     1. Resolves immediately when `platform === 'win32'` or when `kill`/`once` isn’t available.
     2. Registers a one-shot `SIGCONT` listener before attempting to send any signals.
     3. Tries `kill(-pid, 'SIGTSTP')` first (process group) and falls back to `kill(pid, 'SIGTSTP')` when the first call throws `ESRCH`/`EPERM`/`EINVAL`.
     4. Cleans up the `SIGCONT` listener on resolve/reject to avoid stacking handlers.
     5. Rejects with a tagged error (`SuspendProcessError`) when both kill attempts fail so `Program.handleSuspend` can translate it into a panic path.
2. **Program integration:** replace the current `protected suspendProcess()` stub with a call to the helper, passing the real `process` object by default. Expose a `setSuspendBridgeForTests` helper (or keep overriding `program.suspendProcess`) so Vitest specs can stub the behaviour.
3. **Signal source separation:** continue to let `ProgramWithSignalSource` cover SIGINT/SIGTERM; the suspend helper talks directly to `process` so we don’t force the fake signal emitter to implement `kill`.

### TDD Plan
1. **Unit specs (TypeScript first):** add `packages/tests/src/program/suspend-bridge.test.ts` that imports the helper via `@bubbletea/tea/internal`. Use a fake `processLike` to assert:
   - Registers a `SIGCONT` listener before invoking `kill`.
   - Prefers process-group kill but falls back to PID when the group call throws `ESRCH`.
   - Rejects when both kill attempts fail.
   - Cleans up listeners when the promise resolves or rejects.
2. **Runtime specs:** extend `packages/tests/src/program/tea.test.ts` suspend cases to assert `program.suspendProcess` defaults to the helper (via spying on `process.kill`). Keep overriding the method in behaviour-driven specs to avoid actually suspending the Node process.
3. **Manual verification:** once the helper + tests are green, perform a manual `Suspend` run from an example to verify the actual shell integration (documented under Blockers because it can’t run inside CI).

### Follow-ups / Open Questions
- Should we gate suspend support behind an explicit option (e.g., `WithSuspendProcess`) so CLI authors can opt out? For now, default-on matches Go but we may revisit after user feedback.
- We need to decide whether to expose the helper for downstream consumers (e.g., integrators embedding Bubble Tea inside larger Node apps) or keep it internal.
- Manual QA instructions should spell out how to recover a suspended Vitest run if someone accidentally executes the real helper locally.

With these pieces in place we can continue TDD by: (1) landing the Go specs, (2) translating them to Vitest, (3) wiring the runtime so the new suites go green.
