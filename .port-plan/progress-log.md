# Progress Log
Entries are reverse-chronological. Each session should append a new dated section describing: (1) what was done, (2) what to do next, (3) any blockers discovered.

## Loop Guardrails (sticky)

- Keep `.port-plan/plan.md`, `progress-log.md`, and `decision-log.md` in sync whenever scope shifts so later sessions inherit the right marching orders.
- Prioritize tasks that are achievable in this environment (translating Go tests, updating TypeScript runtime/tests, local documentation). If a task requires remote access—pushing to `origin/main`, triggering GitHub Actions, publishing packages—record it under **Blockers** rather than the top “What’s Next” slot, and explicitly note “OUT OF SCOPE FOR LOOP” so future sessions don’t re-promote it.
- This loop runs on macOS. Do **not** attempt Windows-native bindings, pseudo-console loaders, or WriteConsoleInput harness work here—log those items as blocked and move on.
- When fmt/renderer work reaches diminishing returns, advance to the next Go suites scheduled in the plan (input, key/mouse, tty, exec) so the loop keeps progressing through the roadmap.
- Before editing runtime code, confirm the corresponding Go/Vitest specs exist (read the plan + Test Parity checklist); if not, translate the specs first.
- End every session by refreshing the Test Parity checklist and restating “What’s Next” as actionable, locally doable steps.

- **Blockers/Risks:**

## 2025-11-15 (Session 60)
- **Completed:**
  - Ported `examples/spinner/main.go` into `packages/tests/src/integration/examples-spinner.test.ts`, creating a deterministic fake spinner that drives Tick/Update/View semantics plus the example’s `errMsg` branch without relying on the real Bubbles dependency.
  - Kept the new spinner spec and the prior tutorial suites green via `pnpm --filter @bubbletea/tests exec vitest run src/integration/examples-spinner.test.ts src/integration/tutorials-commands.test.ts src/integration/tutorials-basics.test.ts`.
- **What’s Next (priority order):**
  1. Translate `examples/send-msg/main.go` into `packages/tests/src/integration/examples-send-msg.test.ts`, stubbing spinner/timer helpers so the multi-step messaging flow stays deterministic under Vitest.
  2. After the send-msg suite is stable, continue marching through the remaining `examples/` targets (spinner gallery, package-manager, etc.), using each new spec to expose runtime/helper gaps before touching production code.
- **Blockers/Risks:**
  - No TypeScript spinner bubble exists yet, so integration suites must keep relying on fakes until the actual component port begins.

## 2025-11-15 (Session 59)
- **Completed:**
  - Translated `tutorials/commands/main.go` into `packages/tests/src/integration/tutorials-commands.test.ts`, replacing the HTTP call with a deterministic async command so the suite asserts success, error, and ctrl+c cancellation paths offline.
  - Ran `pnpm --filter @bubbletea/tests exec vitest run src/integration/tutorials-commands.test.ts src/integration/tutorials-basics.test.ts` to keep the new commands tutorial spec and the existing basics tutorial spec green together.
- **What’s Next (priority order):**
  1. Translate `examples/spinner/main.go` into a Vitest integration spec (e.g., `packages/tests/src/integration/examples-spinner.test.ts`) by stubbing the Bubbles spinner dependency with a deterministic fake that exercises ticker commands without real wall-clock time.
  2. Once the spinner example spec exists (and likely fails), fill any runtime or helper gaps it reveals—then choose the next example from `examples/` to continue expanding the integration suite checklist.
- **Blockers/Risks:**
  - Bubbles’ spinner component is not yet ported to TypeScript; tests must provide their own fake spinner until the actual component library is available.

## 2025-11-15 (Session 58)
- **Completed:**
  - Translated `tutorials/basics/main.go` into `packages/tests/src/integration/tutorials-basics.test.ts`, exercising window-title initialization, cursor movement, selection toggles, and quit behaviour via the fake TTY harness.
  - Added full `SetWindowTitle` runtime support (message type, exported command, and Program renderer hook) so the tutorial spec drives the renderer’s `setWindowTitle` implementation rather than relying on manual testing.
  - Re-ran `pnpm --filter @bubbletea/tests exec vitest run src/integration/tutorials-basics.test.ts src/program/tea.test.ts` to keep both the new integration suite and the broader program lifecycle coverage green.
- **What’s Next (priority order):**
  1. Translate `tutorials/commands/main.go` into a Vitest integration spec under `packages/tests/src/integration`, substituting the HTTP `checkServer` call with a fake client so the spec stays deterministic/offline while still asserting the async command flow.
  2. Once the commands tutorial spec is failing, implement the runtime/helpers it demands (status rendering, error propagation) until it passes, then advance to the next example on the tutorial/example checklist.
- **Blockers/Risks:**
  - The commands tutorial issues a live HTTP request in Go; keep network access OUT OF SCOPE FOR LOOP by stubbing the client inside the test harness so we don’t rely on real I/O.

## 2025-11-15 (Session 57)
- **Completed:**
  - Backfilled the lone missing `mouse_test.go` scenario by adding the explicit “left in motion” combination entry to `packages/tests/src/mouse/mouse.test.ts`, then reran `pnpm --filter @bubbletea/tests exec vitest run src/mouse/mouse.test.ts` to confirm the suite stays green.
  - Translated `exec_test.go` into `packages/tests/src/exec/exec.test.ts`, mirroring the invalid/true/false command table and instrumenting the renderer so unexpected failures assert that `resetLinesRendered` fires; captured the expected Vitest failure while the runtime lacked Exec support.
  - Implemented the Exec runtime bridge: introduced `ExecCommand`/`ExecProcess` wrappers that spawn child processes with the Program’s input/output streams, taught `Program` to handle `bubbletea/exec` messages (release terminal, run command, reset renderer, restore terminal, dispatch callback), and documented the approach in decision D-059.
  - Re-ran `pnpm --filter @bubbletea/tests exec vitest run src/exec/exec.test.ts` so the new spec and runtime changes are verified end-to-end.
- **What’s Next (priority order):**
  1. Pick the first Go tutorial/example (e.g., `examples/spinner` or `examples/typing`) to serve as an integration acceptance spec, translate it into a Vitest suite under `packages/tests/src/integration`, and outline any harness utilities (fake timers/PTYs) it needs.
  2. Once that integration spec is in place, fill in the remaining runtime gaps it exposes (e.g., scheduler hooks, renderer behaviours) until the example passes, then roll forward to the next example on the checklist.
- **Blockers/Risks:**
  - The integration suites will likely need a lightweight PTY/fake-terminal harness; keep the design macOS-friendly and log any Windows-only requirements as OUT OF SCOPE FOR LOOP.

## 2025-11-15 (Session 56)
- **Completed:**
  - Added a PTY-backed Go regression (`TestProgramSuspendRefreshesWindowSizeAfterResume`) plus a helper to wait for window-size messages so `RestoreTerminal()` is now required to call `checkResize` after each suspend cycle, and reran `go test ./...`.
  - Introduced `SuspendResumeWindowSizeModel` and a matching Vitest case in `packages/tests/src/program/suspend.test.ts` that mimics the new Go scenario and ensures `Program.restoreTerminal()` emits a `bubbletea/window-size` message whenever the terminal dimensions change while suspended.
  - Re-ran `pnpm --filter @bubbletea/tests exec vitest run src/program/suspend.test.ts src/signals/resize.test.ts` to confirm the expanded suspend + resize coverage stays green.
- **What’s Next (priority order):**
  1. Finish the `mouse_test.go` parity pass by translating any missing Go scenarios (stringer edge cases, motion toggles, error branches) into `packages/tests/src/mouse/mouse.test.ts`, then adjust the TypeScript mouse parser only after the specs fail.
  2. Start porting `exec_test.go` into a dedicated Vitest suite so the subprocess/command bridge work can remain tests-driven before touching `packages/tea/src/index.ts`.
- **Blockers/Risks:**
  - Manual SIGTSTP/SIGCONT QA still requires an interactive terminal session and remains OUT OF SCOPE FOR LOOP; rely on the automated suspend/resume tests instead.

## 2025-11-15 (Session 55)
- **Completed:**
  - Authored `suspend_unix_test.go` with a fake renderer harness so `Program.suspend()` now asserts `ReleaseTerminal` stops the renderer, snapshots alt-screen/bracketed-paste/focus flags, drops `ignoreSignals` only after `RestoreTerminal()`, and queues `ResumeMsg`; reran `go test ./...` (green).
  - Added `packages/tests/src/program/suspend.test.ts`, moved the suspend/resume specs out of `tea.test.ts`, rewired them to instantiate real programs via `NewProgram`, and kept the behaviour-driven helpers (`awaitRun`, `sendMessage`, `FakeTty*`).
  - Ran `pnpm --filter @bubbletea/tests exec vitest run src/program/suspend.test.ts` and `pnpm --filter @bubbletea/tests exec vitest run src/program/tea.test.ts` to ensure the relocated suite and existing lifecycle coverage stay green.
- **What’s Next (priority order):**
  1. Extend the Go suspend harness to assert `RestoreTerminal()` triggers a `checkResize` call (e.g., by wiring a fake `ttyOutput`) so the window-size refresh that Go performs after resume is explicitly covered.
  2. Translate that new Go scenario into Vitest (either in `program/suspend.test.ts` or `signals/resize.test.ts`) and adjust the TypeScript runtime if needed so a `WindowSizeMsg` is guaranteed after suspend → resume cycles.
- **Blockers/Risks:**
  - Manual SIGTSTP/SIGCONT QA still requires an interactive shell and remains OUT OF SCOPE FOR LOOP.

## 2025-11-15 (Session 54)
- **Completed:**
  - Authored `signals_unix_test.go` with a PTY-backed harness covering initial window-size emission, SIGWINCH propagation, non-TTY short-circuits, and `ignoreSignals` gating, pulled in `github.com/creack/pty`, and ran `go test ./...`.
  - Updated `signals_unix.go` so `listenForResize` skips `checkResize` whenever `ignoreSignals` is set, matching the new Go spec.
  - Extended `packages/tests/src/signals/resize.test.ts` with `WithoutRenderer`/`WithoutSignals` cases, taught `Program.setupResizeListener()` to bail out when the renderer is nil and to respect `ignoreSignals`, then reran `pnpm --filter @bubbletea/tests exec vitest run src/signals/resize.test.ts`.
- **What’s Next (priority order):**
  1. Backfill a Go suspend spec (e.g., `suspend_unix_test.go`) that asserts `Program.suspend()` releases the terminal, pauses resize/signals, and emits `ResumeMsg` upon restoration, then re-run `go test ./...`.
  2. Translate that suspend spec into a new Vitest suite (`packages/tests/src/program/suspend.test.ts`) and only adjust the TypeScript runtime’s suspend bridge once the tests exist and pass.
- **Blockers/Risks:**
  - Manual SIGTSTP/SIGCONT QA still requires an interactive shell and remains OUT OF SCOPE FOR LOOP.

## 2025-11-15 (Session 53)
- **Completed:**
  - Authored `packages/tests/src/tty/open-input-tty.test.ts`, mocking `node:fs` and `node:tty` to assert `/dev/tty` opens with `O_RDWR`, `ReadStream` instances auto-destroy, and file descriptors close when stream construction fails, then ran `pnpm --filter @bubbletea/tests exec vitest run src/tty/open-input-tty.test.ts`.
  - Extended `packages/tests/src/signals/resize.test.ts` with the SIGWINCH lifecycle + `ReleaseTerminal` gating scenarios, updated `Program.releaseTerminal()`/`restoreTerminal()` to tear down and reinstall resize listeners, and reran `pnpm --filter @bubbletea/tests exec vitest run src/signals/resize.test.ts src/tty/open-input-tty.test.ts` (both green).
- **What’s Next (priority order):**
  1. Backfill the canonical Go `signals_unix_test.go` suite covering SIGWINCH delivery and release/restore gating so the new Vitest cases have a Go oracle, then run `go test ./...` before re-running the translated suites.
  2. Use that Go spec to audit `packages/tests/src/signals/resize.test.ts` for any missing scenarios (`WithoutRenderer`, `ignoreSignals`, shutdown teardown) and ensure `Program.setupResizeListener()` matches the coverage before touching additional runtime code.
- **Blockers/Risks:**
  - Need the upstream Go `signals_unix_test.go` scaffold to keep parity with Bubble Tea before landing further runtime changes.
  - Manual SIGTSTP/SIGCONT QA remains OUT OF SCOPE FOR LOOP; interactive suspend verification still requires a dedicated shell later.

## 2025-11-15 (Session 52)
- **Completed:**
  - Mechanically diffed `mouse_test.go` against `packages/tests/src/mouse/mouse.test.ts`, confirmed every positive case already exists, and documented why Go's error-only suite stays unported in TypeScript before rerunning `vitest` on the mouse specs.
  - Renamed the tty suite to `packages/tests/src/tty/raw-mode.test.ts`, relabeled each test with the corresponding `tty_raw_mode_test.go` identifier, added the missing `TestReleaseTerminalTogglesIgnoreSignals` scenario, and reran the mouse + tty suites via `pnpm --filter @bubbletea/tests exec vitest run src/mouse/mouse.test.ts src/tty/raw-mode.test.ts` (82 passing).
- **What’s Next (priority order):**
  1. Author `packages/tests/src/tty/open-input-tty.test.ts` that stubs `openInputTTY`/`ReadStream` to cover device-path selection and fd cleanup per the tty spec so the helper is locked down before runtime changes.
  2. Extend the Unix resize coverage (either inside `packages/tests/src/signals/resize.test.ts` or a new `signals/sigwinch.test.ts`) with the forthcoming `signals_unix_test.go` cases—covering SIGWINCH listener lifecycle and `ReleaseTerminal` gating—so resize handling is fully specified before touching `Program.setupResizeListener`.
- **Blockers/Risks:**
  - Manual SIGTSTP/SIGCONT QA remains OUT OF SCOPE FOR LOOP; interactive suspend verification still requires a dedicated shell later.

## 2025-11-15 (Session 51)
- **Completed:**
  - Pulled the data-heavy Printf formatting specs out of `packages/tests/src/program/tea.test.ts`, moved them into the new `packages/tests/src/fmt/printf.test.ts`, and introduced `packages/tests/src/utils/go-values.ts` so Printf-focused suites can share the Go-like pointer/channel helpers instead of re-defining them inline.
  - Ran `pnpm --filter @bubbletea/tests exec vitest run src/fmt/printf.test.ts src/program/tea.test.ts` to make sure both the freshly split fmt suite and the leaner program suite still pass after the reshuffle.
  - Reviewed Go’s `mouse_test.go` alongside `packages/tests/src/mouse/mouse.test.ts` to confirm the TypeScript suite already mirrors the MouseEvent stringer plus the X10/SGR parsers, so we know the spec coverage is ready once we resume mouse runtime work.
- **What’s Next (priority order):**
  1. Do a mechanical diff between Go’s `mouse_test.go` cases and `packages/tests/src/mouse/mouse.test.ts`, backfilling any missing edge cases so we can stamp the mouse spec as complete and unblock future runtime changes.
  2. Kick off the next spec translation from the tty/signal roadmap (e.g., seed a `packages/tests/src/tty/raw-mode.test.ts` from `tty_raw_mode_test.go`) so we keep Phase 4 coverage moving once mouse/key inputs are locked down.
- **Blockers/Risks:**
  - Manual SIGTSTP/SIGCONT QA remains OUT OF SCOPE FOR LOOP; exercising the real suspend bridge inside Vitest would freeze the runner, so interactive verification has to wait for a dedicated shell later.

## 2025-11-15 (Session 50)
- **Completed:**
  - Added `packages/tests/src/program/suspend-bridge.test.ts` to lock down the `createSuspendBridge` helper (listener ordering, process-group fallbacks, cleanup semantics, and the Windows no-op path) before touching runtime code.
  - Implemented `packages/tea/src/internal/suspend.ts`, exported the helper via `@bubbletea/tea/internal`, and wired `Program.suspendProcess()` to the bound bridge so suspend now orchestrates a real SIGTSTP/SIGCONT cycle when supported.
  - Ran `pnpm --filter @bubbletea/tests exec vitest run src/program/suspend-bridge.test.ts src/program/tea.test.ts` to keep the new suite plus the existing program coverage green.
- **What’s Next (priority order):**
  1. Finish the remaining `%#v`/`%+v` formatter cases from Go’s `tea_printf_placeholders_test.go` inside `packages/tests/src/fmt/printf.test.ts`, then adjust the TypeScript formatter until the new specs pass.
  2. Start translating `mouse_test.go` into `packages/tests/src/mouse/mouse.test.ts` (port fixtures, helpers, and deterministic cases) so Phase 4’s input work can proceed tests-first before touching runtime code.
- **Blockers/Risks:**
  - Manual SIGTSTP/SIGCONT QA remains OUT OF SCOPE FOR LOOP; running the real suspend bridge inside Vitest would freeze the process, so verification must happen in a separate interactive shell later.

## 2025-11-15 (Session 49)
- **Completed:**
  - Captured the Unix-only suspend bridge strategy inside `.port-plan/tty-signal-strategy.md`, outlining the `createSuspendBridge` helper, signal flow, and TDD rollout, and logged it as decision D-054.
  - Expanded `packages/tests/src/signals/handlers.test.ts` with listener-teardown plus `WithContext`/`WithoutSignalHandler` coverage using `FakeProcessSignals`, then ran `pnpm --filter @bubbletea/tests exec vitest run src/signals/handlers.test.ts` (8 passing).
- **What’s Next (priority order):**
  1. Author `packages/tests/src/program/suspend-bridge.test.ts` to lock down the helper contract (listener ordering, PID vs. process-group kills, error cases) before touching runtime code.
  2. After the specs exist, implement `packages/tea/src/internal/suspend.ts` and wire `Program.suspendProcess()` to it while keeping the override hook available for tests/examples.
- **Blockers/Risks:**
  - Executing a real `SIGTSTP`/`SIGCONT` loop inside Vitest would freeze the runner; manual suspend QA remains OUT OF SCOPE FOR LOOP and must be done in a separate shell session once the helper lands.

## 2025-11-15 (Session 48)
- **Completed:**
  - Captured the tty/signal roadmap in `.port-plan/tty-signal-strategy.md`, listing the Go specs to author plus the FakeProcessSignals helper we need on the Vitest side.
  - Added `tea_signals_test.go` (SIGINT/SIGTERM + ignoreSignals coverage) and extended `tty_raw_mode_test.go` so the Go suite now defines the ReleaseTerminal/RestoreTerminal expectations we encoded in TypeScript.
  - Introduced `packages/tests/src/utils/fake-process-signals.ts` and the new `signals/handlers.test.ts` suite, then updated the TypeScript runtime with `ProgramInterruptedError`, `Interrupt` commands, and a pluggable signal source so the translated specs pass.
  - Verified the changes with `go test ./... -run TestHandleSignals` / `... -run TestReleaseTerminalTogglesIgnoreSignals` plus `pnpm --filter @bubbletea/tests exec vitest run src/signals/handlers.test.ts src/program/tea.test.ts`.
- **What’s Next (priority order):**
  1. Design and spec out a Node-safe `suspendProcess()` bridge (likely orchestrated via a helper child or pseudo terminal) so `Suspend` emits a real SIGTSTP/SIGCONT cycle instead of the current resolved promise.
  2. Extend the new signal suites to cover listener teardown (handlers removed on quit) and ensure external contexts + `WithoutSignalHandler` coexist with injected signal sources before touching more runtime code.
- **Blockers/Risks:**
  - Suspending the active Node process via SIGTSTP risks freezing the Vitest runner; we need a safe strategy (e.g., delegating to a helper) before implementing the real `suspendProcess()` logic.

## 2025-11-14 (Session 47)
- **Completed:**
  - Ported the remaining ReleaseTerminal/RestoreTerminal suspend flows from `tea.go` into Vitest by adding the `suspend / resume` specs in `packages/tests/src/program/tea.test.ts`, covering both the single-cycle release/restore + ResumeMsg emission and repeated suspend/resume cycles.
  - Extended the TypeScript runtime with `Suspend`/`ResumeMsg` support: `Program` now recognizes `bubbletea/suspend`, releases the terminal, awaits an overridable `suspendProcess`, restores the terminal, and queues a `ResumeMsg`, plus exports the new `Suspend` command for models.
  - Ran `pnpm vitest run src/program/tea.test.ts` from `packages/tests` (89 passing specs) to prove the new suspend/resume coverage and runtime changes stay green.
- **What’s Next (priority order):**
  1. Outline the tty/signal test strategy for release/resume scenarios (which Go specs to translate, what fake signal emitters are needed) so we can keep following tests-first before touching signal wiring.
  2. Once the strategy exists, begin translating the tty/signal behaviours (Suspend, Resume, Interrupt) into Vitest to unblock implementing a real `suspendProcess`/signal bridge in the runtime.
- **Blockers/Risks:**
  - `suspendProcess` currently resolves immediately; designing a Node-safe way to trigger SIGTSTP/SIGCONT without freezing the process still needs research and should follow the upcoming tty/signal plan.

## 2025-11-14 (Session 46)
- **Completed:**
  - Extended the Vitest release/restore suite with `\"re-emits the latest window size when the terminal changes while released\"` in `packages/tests/src/program/tea.test.ts`, mirroring `tea.go::RestoreTerminal`'s `checkResize` call to ensure a `WindowSizeMsg` is emitted after regaining control.
  - Ran `pnpm vitest run src/program/tea.test.ts` from `packages/tests` so the updated Program specs stay green (87 passing tests).
- **What’s Next (priority order):**
  1. Translate the remaining ReleaseTerminal/RestoreTerminal behaviour around `suspend()`/`ResumeMsg` so Vitest codifies the Go suspend flow before touching runtime code.
  2. Outline the tty/signal test strategy for release/resume scenarios (identify the Go specs and required fakes) so signal handling can piggyback on the new lifecycle coverage.
- **Blockers/Risks:**
  - Go upstream still lacks dedicated ReleaseTerminal specs, so translation depends on auditing `tea.go`; keep cross-checking behaviours against the source to avoid drift.

## 2025-11-14 (Session 45)
- **Completed:**
  - Ran `pnpm vitest run packages/tests/src/tty/tty.test.ts` to keep the upgraded suite green after the runtime changes.
- **What’s Next (priority order):**
  2. Translate the Go `ReleaseTerminal`/`RestoreTerminal` behaviour into Vitest (Program-level specs) now that input cancellation + TTY helpers exist.
- **Blockers/Risks:**

## 2025-11-14 (Session 44)
- **Completed:**
  - Added `"cancels the input reader when the program shuts down"` to `packages/tests/src/program/tea.test.ts`, waiting for the input stream to be hooked up and then asserting that `Program.quit()` forces the underlying stream to emit `InputReaderCanceledError`.
  - Replaced the ad-hoc chunk queue inside `Program.setupInput` with `createCancelableInputReader`, tracked the reader on the Program instance, and updated the cleanup flow to cancel + close the reader while ignoring the expected `InputReaderCanceledError` from `readAnsiInputs`.
  - Ran `pnpm vitest run packages/tests/src/program/tea.test.ts packages/tests/src/input/inputreader.test.ts packages/tests/src/tty/tty.test.ts` to confirm the new spec and the existing input/tty suites stay green after the refactor.
- **What’s Next (priority order):**
  3. Begin outlining `ReleaseTerminal`/`RestoreTerminal` specs now that the cancelable reader is plumbed, ensuring those lifecycle toggles can be implemented tests-first next.
- **Blockers/Risks:**

## 2025-11-14 (Session 43)
- **Session Goals:** Translate the Go `inputreader_*` semantics into Vitest and stand up the cancellable reader abstraction that the runtime can consume next.
- **Completed:**
  - Added `packages/tests/src/input/inputreader.test.ts` to assert FIFO chunk delivery, cancellation idempotency, graceful closes, and error propagation so cancel-reader behaviour is now codified.
  - Introduced `createCancelableInputReader`/`InputReaderCanceledError` plus a shared `ansi-input-queue` helper, then pointed `Program.setupInput` at the shared queue so future refactors can swap in the new reader without duplicating plumbing.
  - Ran `pnpm vitest run packages/tests/src/input/inputreader.test.ts` and `pnpm vitest run packages/tests/src/program/tea.test.ts` to keep the freshly added suite and the existing Program specs green after the refactor.
- **What’s Next (priority order):**
  1. Wire `Program.setupInput` through `createCancelableInputReader` end-to-end (including shutdown/ReleaseTerminal flows) and extend the Vitest suite to assert cancellation during program teardown.
- **Blockers/Risks:**
  - The new reader isn’t yet hooked into Program shutdown/restart paths, so cancel semantics remain unexercised at the Program level until that refactor lands.

## 2025-11-14 (Session 42)
- **Session Goals:** Port the tty/raw-mode behaviour into Vitest and wire the Program runtime to honor it before moving to the rest of the input stack.
- **Completed:**
  - Added `packages/tests/src/tty/tty.test.ts` covering raw-mode enable/restore, non-TTY safeguards, and the nil-renderer short-circuit so we finally have specs for `tty.go` semantics.
  - Updated `Program` to call a new `setupTerminalInput`/`restoreRawInput` pair that toggles Node's `setRawMode` only when a TTY input + renderer are present, capturing the initial raw flag and restoring it during shutdown.
  - Ran `pnpm vitest run packages/tests/src/tty/tty.test.ts packages/tests/src/signals/resize.test.ts packages/tests/src/program/tea.test.ts packages/tests/src/key/key.test.ts` to keep the new suites and the existing parser/program/signals coverage green.
- **What’s Next (priority order):**
  1. Translate the Go `inputreader_*` behaviour into Vitest (queued as `packages/tests/src/input/inputreader.test.ts`) so we can lock down cancel-reader semantics before touching that TypeScript code.
- **Blockers/Risks:**

## 2025-11-14 (Session 41)
- **Session Goals:** Begin Phase 4’s input-stack work by standing up a signals/resize spec in Vitest and wiring the Node runtime to mirror Go’s `SIGWINCH` behaviour.
- **Completed:**
  - Implemented `Program.setupResizeListener`/`cleanupResizeListener` plus helper utilities in `packages/tea/src/index.ts` so Node TTY outputs subscribe to `'resize'` events, emit sanitized width/height pairs, and unhook listeners during shutdown (parity with Go’s `handleResize` + `checkResize` flow).
  - Ran `pnpm vitest run packages/tests/src/signals/resize.test.ts packages/tests/src/program/tea.test.ts packages/tests/src/key/key.test.ts` (754 specs) to keep the suite green with the new signals coverage.
- **What’s Next (priority order):**
  1. Translate the remaining tty/raw-mode semantics into Vitest (`packages/tests/src/tty/tty.test.ts`) so we can drive the Node raw-mode adapter via tests before touching production code.
  2. Port the input reader cancellation semantics (Go `inputreader_*`) into a dedicated Vitest suite that exercises the async chunk queue/abort controller wiring, then refactor `Program.setupInput` accordingly.
- **Blockers/Risks:**

## 2025-11-14 (Session 40)
- **Session Goals:** Wire the Program input loop to the new key parser while keeping the phase-4 work tests-first.
- **Completed:**
  - Reworked `packages/tests/src/program/tea.test.ts` to treat inbound keys as real `KeyMsg`s and added regression cases for rune input, CSI arrows, and bracketed paste so the runtime must exercise `readAnsiInputs`.
  - Implemented a cancellable async chunk queue plus `Program.setupInput` plumbing that drives `readAnsiInputs` directly, ensuring stdin/custom streams emit the same key/focus/mouse messages the parser tests cover.
  - Ran `pnpm vitest run packages/tests/src/program/tea.test.ts packages/tests/src/key/key.test.ts` (754 tests) to confirm the parser + program suites stay green.
- **What’s Next (priority order):**
  1. Translate the Go `tty_*`, `signals_*`, and `inputreader_*` suites into Vitest (`packages/tests/src/tty`, etc.) to lock down the remaining input-layer specs before touching their TypeScript implementations.
  2. Stand up fake Unix TTY/input reader adapters plus the associated TypeScript runtime stubs so the translated tests can execute without native handles.
- **Blockers/Risks:**
  - No tty/signal/input reader specs exist in TypeScript yet, so the new Program wiring still lacks end-to-end coverage for signal/tty cancellation semantics.

## 2025-11-14 (Session 39)
- **Session Goals:** Implement the key parser/reader runtime so the previously ported `key_test.go` suites can pass in TypeScript before touching tty adapters.
- **Completed:**
  - Extended `scripts/generate-key-sequences.mjs` to emit a runtime-friendly copy of Go’s `sequences` map (`packages/tea/src/internal/generated/goSequences.ts`) and pointed `detectSequence` at the generated data so tests/runtime now share a single source of truth.
  - Fully ported `detectSequence`, `detectOneMsg`, the mouse/focus/bracketed-paste helpers, and `readAnsiInputs` in `packages/tea/src/internal/key-input.ts`, mirroring Go’s control-flow (short-read handling, bracketed paste buffering, mouse SGR/X10 parsing, focus detection, and unknown CSI reporting).
  - Fixed `KeyType`’s enum values to match Go’s negative `KeyRunes`/`KeyUp` block so control characters no longer collide with navigation keys, restoring `keyToString` parity for Ctrl/Alt cases.
  - Verified everything end-to-end with `BUBBLETEA_TS_KEY_TEST_SEED=1 pnpm vitest run packages/tests/src/key/key.test.ts` (all 671 specs now green).
- **What’s Next (priority order):**
  1. Thread the new `readAnsiInputs`/parser surface into the actual `Program` input loop and add regression tests around the runtime wiring.
  2. Begin translating the next Go input-layer suites (`tty_*`, `signals_*`, `inputreader_*`) so mouse/tty plumbing can stay tests-first.
- **Blockers/Risks:**
  - `Program` still references the old placeholder input parser; until the new helpers are wired in, end-to-end examples can’t exercise the fresh parser.
  - OUT OF SCOPE FOR LOOP: pushing the regenerated artifacts (workspace manifests, generated sequences file) to `origin/main` or triggering CI still requires a user with network/publish access.

## 2025-11-14 (Session 38)
- **Session Goals:** Finish translating the remaining `key_test.go` suites (read-input stress and random detectors) so the parser work stays spec-driven.
- **Completed:**
  - Added the `readAnsiInputs` stub plus supporting harness utilities (`testReadInputs`, message title formatter, mouse-string helpers, random data generator) so upcoming runtime work has a stable contract to target.
  - Ported Go’s `TestReadLongInput`, `TestReadInput`, and both random-sequence detector suites into `packages/tests/src/key/key.test.ts`, including bracketed-paste fixtures, mouse/focus expectations, and sequence fixtures sourced from the auto-generated table.
  - Exercised the expanded suite via `pnpm vitest run packages/tests/src/key/key.test.ts`; the run now reports **666 failures** (expected) because `detectSequence`, `detectOneMsg`, and `readAnsiInputs` are still unimplemented.
- **What’s Next (priority order):**
  1. Implement `detectSequence` and `detectOneMsg` in `packages/tea/src/internal/key-input.ts`, driving the 600+ deterministic specs green before touching the reader.
  2. Implement `readAnsiInputs` (buffering, `canHaveMoreData`, mouse/focus/bracketed paste dispatch) and thread it into the `Program` input loop so `TestReadInput`/`TestReadLongInput` can pass end-to-end.
  3. Once the parser/reader suites are green, continue Phase 4 by translating the next Go input stacks (`tty_*`, signal handlers) so future runtime work remains tests-first.
- **Blockers/Risks:**
  - Parser/reader functions are still stubs, leaving 666 specs failing until those implementations land.
  - Random-seed driven detector suites now rely on the logged `BUBBLETEA_TS_KEY_TEST_SEED` (defaults to `Date.now()`), so capturing the emitted seed is required to reproduce future failures.

## 2025-11-14 (Session 37)
- **Session Goals:** Port the remaining deterministic `key_test.go` suites (`buildBaseSeqTests`, `TestDetectSequence`, `TestDetectOneMsg`) into Vitest before touching the key parser implementation.
- **Completed:**
  - Added `scripts/generate-key-sequences.mjs` to scrape the upstream Go `sequences` map and emit a canonical `packages/tests/src/key/fixtures/goSequences.ts`, keeping the TypeScript specs in lockstep with Go without hand-copying the table.
  - Introduced `FocusMsg`/`BlurMsg`, a dedicated `mouse.ts` (MouseAction/Button/EventType/MouseMsg), and an `@bubbletea/tea/internal` surface (`packages/tea/src/internal/key-input.ts`) that exposes placeholder `detectSequence`/`detectOneMsg` plus helper constructors for `unknownInputByteMsg`/`unknownCSISequenceMsg` so specs can target the future runtime APIs.
  - Translated Go’s `buildBaseSeqTests`, `TestDetectSequence`, and `TestDetectOneMsg` into `packages/tests/src/key/key.test.ts` (619 specs) using the generated fixture, terminal control character loops, mouse/focus cases, and invalid-byte coverage; ran `pnpm vitest run packages/tests/src/key/key.test.ts` to red (614 failures) since the new detection functions are still stubs.
- **What’s Next (priority order):**
  1. Continue translating the remaining `key_test.go` suites (`TestReadLongInput`, `TestReadInput`, random sequence generators, bracketed paste cases) into Vitest so every parser behaviour is specified before runtime work starts.
  2. Once the full test surface exists, implement `detectSequence`, `detectOneMsg`, and the supporting helpers (`unknown*`, bracketed paste, focus/mouse parsing) in TypeScript to drive the new specs green.
  3. Wire the new parser into the `Program` input loop and prep follow-up tests for tty/inputreader plumbing.
- **Blockers/Risks:**
  - Key parser implementation is pending; 614 of 619 specs in `packages/tests/src/key/key.test.ts` fail until `detectSequence`/`detectOneMsg` are ported.
  - OUT OF SCOPE FOR LOOP: publishing packages, pushing to `origin/main`, triggering CI remains deferred until a human session with network access handles it.

## 2025-11-14 (Session 36)
- **Session Goals:** Confirm the pointer placeholder helper is the sole path for deterministic addresses and kick off the `key_test.go` translation with a tests-first workflow.
- **Completed:**
  - Ran `rg -n "unsafe.Pointer"` (and broader `rg -n "unsafe"`) across the repo to verify no Go suite still embeds manual `unsafe.Pointer` literals—`tea_printf_placeholders_test.go` now owns the deterministic pointer registry for all specs.
  - Ported `TestKeyString`/`TestKeyTypeString` into `packages/tests/src/key/key.test.ts`, exercised them to red, and documented the spec coverage they provide for `Key.String`/`KeyType.String` semantics.
  - Added `packages/tea/src/key.ts` exporting a Go-parity `KeyType` enum, new `Key`/`KeyMsg` interfaces, and `keyToString`/`keyTypeToString` helpers, re-exported through `packages/tea/src/index.ts` so the Vitest suite targets the real runtime surface.
  - `pnpm vitest run packages/tests/src/key/key.test.ts` is now green (5 specs) and establishes the baseline for subsequent key parsing work.
- **What’s Next (priority order):**
  1. Translate the remaining deterministic sections of `key_test.go` (sequence tables, `detectSequence`, `detectOneMsg`, focus + bracketed paste cases) into Vitest before touching runtime parsing logic.
  2. Port `TestReadLongInput`, `TestReadInput`, and the random-sequence harness, adding any necessary fake reader utilities so we can eventually drive a TypeScript `readAnsiInputs` implementation under test.
  3. Once those specs exist, begin implementing the key parser (`detectSequence`, `detectOneMsg`, `readAnsiInputs`) and hook it into `Program`’s input loop to replace the current single-character placeholder pipeline.
- **Blockers/Risks:**
  - OUT OF SCOPE FOR LOOP: publishing pnpm artifacts, pushing to `origin/main`, or triggering CI (needs remote access).
  - Key parser work will require terminal/TTY fakes; scope that utility surface next session so tests stay hermetic.

## 2025-11-14 (Session 35)
- **Session Goals:** Finish the remaining `%#v` interface-container permutations called out in Session 34 (“maps-of-maps” pointer slices and interface slices that mix pointer maps with channel/function refs) while keeping TS runtime parity via tests-first updates.
- **Completed:**
  - Added two new `%#v` cases to `TestPrintfFormattingVariants` (`iface pointer map of map slice`, `iface pointer slice map refs`) capturing nested pointer slices inside interface maps-of-maps plus channel/function-rich slices; confirmed via `go test ./... -run TestPrintfFormattingVariants -count=1`.
  - Mirrored those specs in `packages/tests/src/program/tea.test.ts`, registering the same pointer/channel placeholders so Vitest enforces the new shapes.
  - Raised the TypeScript formatter’s `MAX_DETAILED_VALUE_DEPTH` to 16 so deeply nested interface containers keep their Go type context instead of collapsing to `interface{}`; `pnpm test packages/tests/src/program/tea.test.ts` is green (80 specs).
- **What’s Next (priority order):**
  1. Propagate the pointer placeholder helper into any remaining Go suites that still rely on `unsafe.Pointer` literals so fmt coverage can keep expanding without GC-panic risk.
  2. Begin translating `key_test.go` (commands + key parsing suites) to Vitest to unblock the input/TTY phase once the formatter backlog stays quiet.
  3. Keep extending `%#v` coverage opportunistically for other interface-heavy shapes encountered while porting pointer helpers/key tests so TS fmt parity never lags the Go oracle.
- **Blockers/Risks:**
  - OUT OF SCOPE FOR LOOP: publishing pnpm workspace artifacts / pushing to `origin/main` / triggering CI (requires remote access).
  - Newly increased formatter depth should remain monitored; if more complex shapes appear, we may need targeted perf profiling to ensure recursion depth growth doesn’t regress renders.

## 2025-11-14 (Session 34)
- **Session Goals:** Keep broadening the `%#v` oracle for interface containers by covering the nested pointer-map/slice cases called out in Session 33’s priorities before touching runtime code.
- **Completed:**
  - Added `interfacePointerMapNestedSliceStruct` and `interfacePointerSliceNestedMapPointer` cases to `TestPrintfFormattingVariants`, registered deterministic placeholders for the struct pointer fixture, and re-ran `go test ./... -run TestPrintfFormattingVariants -count=1` (pass).
  - Mirrored the new specs in `packages/tests/src/program/tea.test.ts` with matching pointer metadata and confirmed `pnpm test packages/tests/src/program/tea.test.ts` stays green (78 specs).
- **What’s Next (priority order):**
  1. Extend the `%#v` matrix to cover the remaining interface-container mixes (pointer-bearing slices nested inside interface maps-of-maps, interface slices that mix pointer maps with channel/function references) and port them to Vitest.
  2. Push the pointer placeholder helper into any other Go tests that still depend on `unsafe.Pointer` so `go test ./...` stays stable when fmt coverage expands again.
  3. Begin translating `key_test.go` so we can pivot into Phase 4 (input/tty) once the fmt backlog winds down.
- **Blockers/Risks:**
  - OUT OF SCOPE FOR LOOP: publishing pnpm workspace artifacts / pushing to `origin/main` / triggering CI—needs a human session with remote access.
  - Additional `%#v` pointer combos (channels/functions inside the same interface containers) still lack specs, so formatter regressions could slip in until those cases are encoded.

## 2025-11-14 (Session 33)
- **Session Goals:** Advance the fmt parity plan by covering the remaining high-priority `%#v` interface container scenarios (pointer-bearing maps combined with nested structs) while the pnpm manifest publication remains blocked from this environment.
- **Completed:**
  - Expanded `TestPrintfFormattingVariants` with `iface pointer map struct` and `iface pointer slice struct` cases so the Go oracle now captures interface maps/slices that mix pointer-heavy maps with nested structs; verified with `go test ./... -run TestPrintfFormattingVariants -count=1`.
  - Ported those specs into `packages/tests/src/program/tea.test.ts` and confirmed the existing TypeScript formatter already satisfies them by running `pnpm test packages/tests/src/program/tea.test.ts`.
- **What’s Next (priority order):**
  1. Continue broadening the `%#v` matrix for interface containers—next up are combos that mix pointer-bearing maps with nested pointer slices/struct pointers and other composite values—then translate them to Vitest.
  2. Push the pointer placeholder helper into any remaining Go tests that still rely on `unsafe.Pointer` literals so `go test ./...` never panics.
  3. Begin translating `key_test.go` so the upcoming TypeScript input work remains tests-first (blockers around publishing manifests stay noted below).
- **Blockers/Risks:**
  - OUT OF SCOPE FOR LOOP: publishing the pnpm workspace files / pushing to `origin/main` / triggering CI. This environment cannot perform those actions, so leave them parked here until a human session can handle them.
  - Additional `%#v` cases (struct pointer containers, pointer slices nested multiple levels deep) still need specs or the TypeScript formatter could drift once those shapes appear in real models.

## 2025-11-14 (Session 32)
- **Session Goals:** Stop the `%#v` work from being blocked on unsafe pointer literals by introducing a safe placeholder system, then finish the nested interface pointer specs before porting them to Vitest.
- **Completed:**
  - Added `tea_printf_placeholders_test.go` with a pointer placeholder registry/normalizer so `TestPrintfFormattingVariants` can deterministically map real pointer addresses to friendly placeholders without upsetting the GC.
  - Replaced every `unsafe.Pointer(uintptr(...))` usage in `tea_test.go` with real allocations wrapped by the new helpers, and expanded the Go suite with the missing `%#v` cases for interface maps/slices that contain pointer-valued maps or slices; ran `go test ./... -run TestPrintfFormattingVariants -count=1` and the full `go test ./...` to verify the panic is gone.
  - Translated the new specs to `packages/tests/src/program/tea.test.ts`, aligned the existing interface pointer slice case with the Go expectation, and re-ran `pnpm test packages/tests/src/program/tea.test.ts` (pass, 74 specs).
- **What’s Next (priority order):**
  1. Keep broadening the fmt matrix by tackling the remaining `%#v` edge cases (e.g., interface containers that mix pointer-bearing maps with other composite values such as nested structs) now that the placeholder helper is in place.
  2. Push the placeholder tooling down into any other Go tests that still depend on `unsafe.Pointer` once we discover them, so future fmt/spec work can run under `go test ./...` without tripping the runtime.
  3. Start translating the next IO-centric Go suites (e.g., `key_test.go`, `mouse_test.go`) so the upcoming TypeScript work on input/tty adapters remains tests-first.
- **Blockers/Risks:**
  - Still no way to push pnpm workspace changes upstream from here, leaving CI red until someone with access publishes the manifests.
  - The new placeholder helper relies on string rewriting; if additional verb/width combos appear (especially zero-padded pointers in novel contexts) we may need to extend the normalizer again.

## 2025-11-14 (Session 31)
- **Session Goals:** Close the `%T`/`%+v` fmt gaps for channel/func values and their interface containers before touching runtime logic.
- **Completed:**
  - Added Go specs in `tea_test.go` that cover `%T` for channel/function values plus interface maps/slices containing them, and `%+v` expectations for the same surfaces, so the Go suite defines the required behaviour.
  - Ported those specs to `packages/tests/src/program/tea.test.ts` with deterministic `goChannel`/`goFunc` fixtures and the associated type expectations (`[]interface {}` spacing, pointer-only `%+v` output).
  - Taught `formatVerboseValue` and `getValueTypeName` in `packages/tea/src/index.ts` to drop channel type names for `%+v` output and to normalize slice type names (`[]interface {}`), then reran `pnpm test` (pass, 138 specs) to verify parity.
  - Attempted `go test ./... -run TestPrintfFormattingVariants -count=1`; it still dies with the known `runtime: bad pointer in frame fmt.(*pp).printValue` panic triggered by the deterministic unsafe pointer fixtures.
- **What’s Next (priority order):**
  1. Publish the pnpm workspace manifests/config on `origin/main` so GitHub Actions can install dependencies instead of failing on missing files (still blocked from this environment).
  2. Keep expanding the fmt matrix—next up is to express the remaining `%#v` combos (e.g., nested interface containers that mix pointer-valued maps/slices) in Go first so the TypeScript formatter stops relying on handwritten expectations.
  3. Carve out time to replace the unsafe pointer literals in `TestPrintfFormattingVariants` with safe, address-stable helpers so `go test ./...` no longer panics (unblocks CI confidence in the Go oracle).
- **Blockers/Risks:**
  - No ability to push the workspace manifests upstream from here, so CI stays red until someone with remote access publishes the files.
  - `go test ./...` remains unusable because of the invalid pointer fixtures, so fmt regressions must be caught via the Go subtests that don’t trigger the panic plus the Vitest suite.

## 2025-11-14 (Session 30)
- **Session Goals:** Keep executing the tests-first fmt parity plan by covering `%T`/`%+v` plus interface containers that hold channel/func references before touching runtime code.
- **Completed:**
  - Extended `TestPrintfFormattingVariants` in `tea_test.go` with reusable struct fixtures plus fresh cases for `%T`, `%+v`, and interface maps/slices that include channel/func references so the Go suite keeps serving as the oracle for these edge cases.
  - Ported the new specs into `packages/tests/src/program/tea.test.ts`, adding deterministic `goChannel`/`goFunc` fixtures for the map/slice cases and new assertions for the `%T`/`%+v` permutations so Vitest now fails before the runtime drifts.
  - Implemented a Go-style `%+v` formatter path (`formatVerboseValue`) inside `packages/tea/src/index.ts`, taught it to render structs/maps/slices without type qualifiers, and confirmed `pnpm test` (130 specs) is green; `go test ./...` still panics in `TestPrintfFormattingVariants` because of the long-standing invalid pointer fixtures.
- **What’s Next (priority order):**
  1. Publish the pnpm workspace manifests/configuration to `origin/main` so CI runners can make it past `pnpm install --frozen-lockfile`.
  2. Continue filling the fmt matrix—next targets are `%T`/`%+v` behaviour for channels, funcs, and nested interface containers plus any `%#v` combinations that still rely on handwritten expectations.
  3. Investigate how to keep `go test ./...` green despite the deterministic pointer fixtures (e.g., move unsafe pointers into scoped subtests or adopt alternative address-stubbing) so we regain confidence in the Go oracle.
- **Blockers/Risks:**
  - Cannot push workspace manifests from this environment, leaving CI red on every run until someone with remote access publishes the pnpm workspace state.
  - `go test ./...` currently aborts with `runtime: bad pointer in frame fmt.(*pp).printValue` whenever the full `TestPrintfFormattingVariants` suite runs, which appears to be triggered by the existing unsafe pointer literals; the new tests inherit the same limitation.

## 2025-11-14 (Session 29)
- **Session Goals:** Verify the pnpm workspace artifacts are ready for CI, then extend the `%#v` Printf specs (channel/func references plus pointer-heavy slices) before updating the TypeScript formatter.
- **Completed:**
  - Ran `pnpm install --frozen-lockfile` to prove the workspace manifests/lockfile install cleanly (CI still needs them published to `origin/main`).
  - Added new Go specs in `tea_test.go` for pointer-valued slices, interface pointer slices, and channel/function `%#v` coverage to keep the Go test suite as the oracle.
  - Ported the new specs into `packages/tests/src/program/tea.test.ts`, introducing `goFunc` and `goChannel` helpers so Vitest can express deterministic pointer addresses for reference types.
  - Updated `packages/tea/src/index.ts` to emit Go-accurate pointer literals for slice elements, represent channels via `GO_CHANNEL_SYMBOL`, and format functions as `(func()...)(0xaddr)`; `pnpm test` (125 cases) and `go test ./...` both pass.
- **What’s Next (priority order):**
  1. Actually publish the pnpm workspace manifests (`package.json`, `pnpm-*.yaml`, `packages/*`, configs) to `origin/main` so GitHub Actions can make it past `pnpm install --frozen-lockfile`.
  2. Keep driving fmt parity—next up are `%#v` permutations that mix channel/func references inside interface maps/slices plus any remaining `%T`/`%+v` gaps—before touching renderer/runtime behaviour again.
- **Blockers/Risks:**
  - Still no way (from this environment) to push the workspace manifests to `origin/main`, so CI continues to fail during `pnpm install` despite local validation.

## 2025-11-14 (Session 28)
- **Session Goals:** Finish the `%#v` / `%p` backlog item by adding pointer-valued map + object-reference `%p` coverage in Go first, then bring the TypeScript formatter up to parity.
- **Completed:**
  - Extended `TestPrintfFormattingVariants` in `tea_test.go` with helper-based assertions plus new cases for pointer-valued maps (including nil entries), interface-pointer maps, and `%p` formatting for real map/slice/func references; `go test ./...` stays green.
  - Ported the specs into `packages/tests/src/program/tea.test.ts`, introduced `withPointerAddress` for deterministic reference addresses, and added Vitest cases for pointer maps and `%p` map/slice/func coverage.
  - Updated `packages/tea/src/index.ts` so map values that carry Go pointer markers now render as `(*pkg.Type)(0xaddr)` (or `(nil)`), treated `<nil>` as a wildcard during map type inference, and reran `pnpm test` (121 tests) to confirm the formatter matches Go’s new expectations.
- **What’s Next (priority order):**
  1. Still need to publish the pnpm workspace manifests/config on `origin/main` so CI can make it past `pnpm install --frozen-lockfile`; until then the fresh workflow remains red.
  2. Keep broadening the formatter specs toward the remaining fmt edge cases (e.g., channel/func `%#v`, pointer-valued interface slices) before touching renderer/runtime code.
- **Blockers/Risks:**

## 2025-11-14 (Session 27)
- **Session Goals:** Get the GitHub Actions workflow live on `origin/main` and keep driving `%#v` / `%p` parity (interface-valued maps plus pointer/struct key coverage) before touching renderer/runtime behavior again.
- **Completed:**
  - Extended `TestPrintfFormattingVariants` in `tea_test.go` with interface-valued map cases, pointer/struct map-key permutations, and `%p` width/zero-padding specs, keeping the Go reference suite green via `go test ./...`.
  - Ported the new specs to `packages/tests/src/program/tea.test.ts`, taught `goPointer` to carry deterministic addresses, and updated the TypeScript formatter to (a) infer pointer type names, (b) render pointer map keys as `(*pkg.Type)(0xaddr)` with fmtsort ordering, (c) treat `map[string]interface{}]` nils as `interface {}(nil)`, and (d) zero-pad `%p` the way Go does; `pnpm test` now passes 116/116 cases.
- **What’s Next (priority order):**
  1. Publish the pnpm workspace essentials (`package.json`, `pnpm-lock.yaml`, `packages/*`, config) or otherwise stub them so GitHub Actions can run `pnpm install --frozen-lockfile`; until they exist remotely every workflow run halts before the test steps.
  2. Keep broadening the `%#v` / `%p` suites toward pointer-valued maps and object/reference `%p` cases (plus any remaining fmt edge cases) before resuming renderer/runtime work.
- **Blockers/Risks:**

## 2025-11-14 (Session 26)
- **Completed:**
  - Added float-map-value and interface-key permutations to `TestPrintfFormattingVariants` in `tea_test.go`, then re-ran `go test ./...` to keep the Go reference suite green before touching TypeScript.
  - Ported the new cases to `packages/tests/src/program/tea.test.ts` and taught the TypeScript `%#v` formatter to (a) pretty-print `interface {}` type names, (b) sort typed maps using their declared key type (preserving Go’s NaN ordering for floats) while interface-keyed maps fall back to dynamic type ordering, restoring `pnpm test` to 111/111 passing.
- **What’s Next (priority order):**
  2. Keep expanding the `%#v` coverage toward interface-valued maps and pointer/struct key cases (plus `%p` edge cases) before touching renderer/runtime behaviour again.
- **Blockers/Risks:**

## 2025-11-14 (Session 25)
- **Completed:**
  - Extended `TestPrintfFormattingVariants` with bool/int/float map `%#v` coverage (including NaN/±Inf cases) and re-ran `go test ./...` to lock the canonical behaviour in Go.
  - Ported the new specs to `packages/tests/src/program/tea.test.ts` and updated the formatter’s map type inference so mixed int/float key sets are coerced to `map[float64]...`, restoring `pnpm test` (109 specs) to green.
- **What’s Next (priority order):**
  2. Keep expanding the `%#v` suites toward additional numeric/boolean permutations (e.g., maps with numeric values or interface-typed keys) so every fmtsort branch is enforced before further renderer/runtime work.
- **Blockers/Risks:**

## 2025-11-14 (Session 24)
- **Session Goals:** Finish the `%#v` formatter spec expansion (nested maps + struct tags) under tests-first discipline before touching renderer/runtime code.
- **Completed:**
  - Augmented `TestPrintfFormattingVariants` with multi-key nested map and struct tags cases, then re-ran `go test ./...` to keep the Go reference suite green.
  - Ported the new specs into `packages/tests/src/program/tea.test.ts`, inserting unsorted map entries so Vitest highlighted the ordering gap prior to any runtime changes.
  - Updated `packages/tea/src/index.ts` so `%#v` map formatting sorts keys via a type-aware comparator (mirroring Go’s `fmtsort`), bringing `pnpm test` back to green across all 106 specs.
- **What’s Next (priority order):**
  2. Keep broadening the `%#v` formatter specs toward heterogeneous/numeric map keys so the new sorting logic is exercised across Go’s other comparable key kinds.
- **Blockers/Risks:**
  - The map comparator now handles common primitives but still lacks end-to-end specs for numeric/bool keys, so regressions could slip in without the planned tests.

## 2025-11-14 (Session 23)
- **Completed:**
  - Authored `docs/logging.md` and `docs/rendering.md`, capturing the StandardRenderer newline normalization and `LogToFile` fan-out behaviour plus instructions for running the scripts.
- **What’s Next (priority order):**
  1. Resume expanding the `%#v`/`%p` formatter specs (nested maps + struct tags) in Go and Vitest so Printf parity stays locked ahead of renderer work.
- **Blockers/Risks:**

## 2025-11-14 (Session 22)
- **Completed:**
- **What’s Next (priority order):**
  2. Resume expanding the `%#v`/`%p` formatter specs (nested maps, struct tags) in Go + Vitest so Printf parity stays locked ahead of additional renderer changes.
- **Blockers/Risks:**

## 2025-11-14 (Session 21)
- **Completed:**
- **What’s Next (priority order):**
  3. Resume expanding the `%#v`/`%p` formatter specs (nested structs/maps, tagged fields) in Go + Vitest so Program.Printf remains fully covered ahead of deeper runtime refactors.
- **Blockers/Risks:**

## 2025-11-14 (Session 20)
- **Completed:**
  - Extended `TestPrintfFormattingVariants` in `tea_test.go` with nested struct/map cases plus `%p` nil coverage, keeping `go test ./...` green to preserve the Go reference.
  - Translated the new specs into `packages/tests/src/program/tea.test.ts`, introduced helpers for Go-type metadata/pointer wrappers, and updated `packages/tea/src/index.ts` to format maps/pointers with deeper depth limits before re-running `pnpm test`.
- **What’s Next (priority order):**
  2. Refresh structured logging docs/examples so the new append-only + stderr fan-out guarantees are discoverable before runtime integration.
  3. Continue broadening `%#v` formatter coverage (maps with multiple keys, struct tags) in Go/Vitest to catch edge cases before larger runtime refactors.
- **Blockers/Risks:**
  - Go-type metadata is currently internal; we must document/expose a supported helper before external consumers rely on `%#v` parity outside the tests.

## 2025-11-14 (Session 19)
- **Completed:**
  - Authored Go tests `TestLogToFileAppendsExistingContents`, `TestLogToFileSupportsMultipleWriters`, and `TestLogToFileWithMultiWriterLoggerToPipe` to pin append-only semantics and fan-out behaviour, then kept `go test ./...` green.
  - Translated the new specs into `packages/tests/src/logging/logging.test.ts`, covering append safety, sequential LogToFile sessions, and stderr-style fan-out without closing extra streams; re-ran `pnpm test` (93 specs) for parity.
  - Verified no TypeScript runtime changes were needed—the existing `createMultiWriterLogOptions`/`FanOutWritable` behaviour already satisfied the new tests.
- **What’s Next (priority order):**
  2. Extend the `%#v`/`%p` formatter specs toward nested structs/maps and pointer edge cases in Go + Vitest so Program.Printf reaches full parity.
  3. Identify any remaining structured logging documentation/examples that should reflect the new fan-out + append guarantees before hardening runtime APIs.
- **Blockers/Risks:**
  - Formatter coverage for complex values remains shallow; without deeper `%#v` specs we risk regressions once richer models exercise the formatter.

## 2025-11-14 (Session 18)
- **Session Goals:** Flesh out the remaining `Program.Printf` formatter specs (Go + Vitest) for `%#v`, `%p`, and Unicode rune verbs so runtime changes stay tests-first.
- **Completed:**
  - Expanded `TestPrintfFormattingVariants` in `tea_test.go` with slice `%#v`, pointer `%p`, and `%c`/`%U`/`%#U` coverage, then re-ran `go test ./...` to keep the Go reference suite green.
  - Translated the new cases into `packages/tests/src/program/tea.test.ts`, verifying they failed prior to implementation so the Vitest suite continued driving the TypeScript work.
  - Implemented richer formatter helpers (`formatDetailedValue`, `formatUnicodeValue`, updated `%p` handling) so `%#v` slices render as Go-style literals and `%U`/`%#U` emit `U+` code points; re-ran `pnpm test` (90 specs) and `go test ./...` to confirm everything passes.
- **What’s Next (priority order):**
  3. Continue broadening the `%#v` coverage toward structs/maps and `%p` edge cases so the formatter reaches parity beyond slices/numeric pointers.
- **Blockers/Risks:**
  - The new `%#v` heuristics currently cover slices/arrays and shallow objects but still need deeper parity for maps/structs; additional specs will be required before touching other formatter paths.

## 2025-11-14 (Session 17)
- **Session Goals:** Port the outstanding `Program.Println/Printf` coverage (Go → Vitest) and wire equivalent runtime helpers so public print APIs remain specified before further runtime work.
- **Completed:**
  - Added `TestProgramPrintln`/`TestProgramPrintf` to `tea_test.go` ensuring the Go suite codifies that program-level print helpers flush above the view before continuing, then kept `go test ./...` green.
  - Translated the new cases into `packages/tests/src/program/tea.test.ts`, covering `program.println`/`program.printf` flows and keeping tests red until runtime support landed.
  - Implemented `Program.println`/`Program.printf` in `packages/tea/src/index.ts` via a shared print-line dispatcher and re-ran `pnpm test` to verify the Vitest suite (85 specs) alongside the Go suite.
- **What’s Next (priority order):**
  1. Continue broadening the `Program.Printf` formatter specs toward `%#v`, `%p`, and Unicode rune verbs (Go + Vitest) before touching the formatter implementation again.
- **Blockers/Risks:**

## 2025-11-14 (Session 16)
- **Session Goals:** Finish the structured logging follow-ups (multi-writer adapters plus scoped console patching) so logging parity is no longer blocking upstream runtime work.
- **Completed:**
  - Added `TestLogToFileWithMultiWriterLogger` and helper adapters in `logging_test.go` to codify fan-out behaviour, then re-ran `go test ./...` to keep the Go reference suite green.
  - Expanded `packages/tests/src/logging/logging.test.ts` with the translated multi-writer case along with Vitest-only coverage for `createMultiWriterLogOptions` and the console patch lifecycle (automatic restoration once streams close).
  - Implemented `FanOutWritable` plus the exported `createMultiWriterLogOptions` helper and taught `ConsoleLogOptions` to track active outputs/restore the original console methods, scoping logging side-effects to the lifespan of each log file.
  - Verified `pnpm test` and `go test ./...` so the new Go/Vitest specifications pass end-to-end.
- **What’s Next (priority order):**
  1. Translate and port the outstanding `Program.Println/Printf` API coverage so the public print helpers stay specified before any runtime tweaks.
  2. Continue broadening the `tea.Printf` formatter specs toward `%#v`, `%p`, and Unicode rune verbs to declare the formatter feature-complete.
- **Blockers/Risks:**

## 2025-11-14 (Session 15)
- **Session Goals:** Unblock the top “logging/program toggle” item by codifying focus-report + mouse startup behaviour in Go/Vitest before touching the TypeScript runtime.
- **Completed:**
  - Extended `screen_test.go` with new helper-driven specs that assert focus-report commands/options and mouse startup options emit the correct ANSI sequences (including SGR) and verified with `go test ./...`.
  - Ported the new cases into `packages/tests/src/renderer/screen.test.ts`, adding Vitest coverage for `EnableReportFocus`/`DisableReportFocus`, `WithReportFocus`, and the mouse startup options so TypeScript stayed red prior to implementation.
  - Added exported `EnableReportFocus`/`DisableReportFocus` commands plus a `Program.applyStartupOptions` hook that now enforces `WithAltScreen`, bracketed paste opt-outs, mouse modes, and focus reporting immediately after `renderer.start()`, then ran `pnpm test` to confirm all 80 specs pass.
- **What’s Next (priority order):**
  1. Finish the remaining structured logging follow-ups (multi-writer adapters, ensuring console patching is scoped) now that focus/mouse toggles are in place.
  2. Add Vitest coverage for the higher-level `Program.Println/Printf` helpers to exercise the public API paths through filters/options before any runtime tweaks.
  3. Continue broadening the Printf spec (`%#v`, `%p`, `%c/%U`, positional args) so the formatter can be declared feature-complete.
- **Blockers/Risks:**
  - Structured logging still lacks end-to-end specs; until those Go/Vitest suites exist we can’t safely refactor the console/file adapters or expose richer logging APIs.

## 2025-11-14 (Session 14)
- **Session Goals:** Execute the top What’s Next item by broadening the Printf specification (Go + Vitest) before touching runtime code, keeping the tests-first rule intact.
- **Completed:**
  - Added `TestPrintfFormattingVariants` in `tea_test.go` to pin width/precision combinations (alternate hex, left-justified strings, quoted strings, dynamic `*` width, literal percents, bools) and re-ran `go test ./...`.
  - Ported the new table-driven cases into `packages/tests/src/program/tea.test.ts` so Vitest now asserts the Printf contract directly via `Cmd` execution and reproduced the expected failures.
  - Updated the formatter inside `packages/tea/src/index.ts` so integer verbs treat the zero flag as implicit precision (matching Go’s `%#08x` semantics) and float verbs honor zero padding even with explicit precisions, then re-ran `pnpm test` to get the suite green again.
- **What’s Next (priority order):**
  2. Add Vitest coverage for the higher-level Print helpers (`Program.Println/Printf` wrappers) to ensure the public API paths remain wired through options/filters.
  3. Continue expanding the Printf spec toward the remaining fmt verbs (`%#v`, `%p`, unicode `%c/%U`, etc.) so the formatter can be considered feature-complete.
- **Blockers/Risks:**
  - The formatter still lacks coverage for reflection-heavy verbs (`%#v`, `%T`, `%p`) and unicode rune cases, so regressions could slip in until we translate those Go specs.

## 2025-11-14 (Session 13)
- **Session Goals:** Satisfy the top What’s Next item by exercising `tea.Println/Printf` through `Program.Send` (Go + Vitest) and keep the renderer changes tests-first-compliant.
- **Completed:**
  - Added Go lifecycle specs in `tea_test.go` covering `Program.Send(Println(...))` and `Program.Send(Printf(...))`, ensuring queued print-line output renders ahead of the view and keeping `go test ./...` green.
  - Translated the new cases into `packages/tests/src/program/tea.test.ts`, wiring `program.send` to the print commands, waiting on terminal output, and documenting the expected behaviour before touching runtime code.
  - Replaced the Node `util.format` shortcut inside `packages/tea/src/index.ts` with a Go-like formatter that understands width/precision/flag handling (e.g., `%03d`), then reran `pnpm test` so the new coverage passes end-to-end.
- **What’s Next (priority order):**
  1. Broaden the Printf spec (Go + Vitest) to cover additional verbs/flags/precision modes so the new formatter fully mirrors `fmt.Sprintf` beyond the `%d` cases exercised today.
  3. Add coverage for the higher-level Print helpers once they land (e.g., `Program.Println/Printf` wrappers) to ensure the public API paths stay wired through filters/options.
- **Blockers/Risks:**
  - The formatter currently targets the most common verbs; without more exhaustive specs it may still diverge from Go for `%#v`, float verbs, positional arguments, or locale-specific flags, so continued test authoring is required before declaring parity.

## 2025-11-14 (Session 12)
- **Session Goals:** Finish the top renderer What’s Next item by pinning ignored-line/scroll-area behaviour in Go + Vitest before touching the TypeScript renderer.
- **Completed:**
  - Extended `renderer_standard_test.go` with new specs for `setIgnoredLines`, `SyncScrollArea`, and `ScrollUp/ScrollDown`, then re-ran `go test ./...` to keep the Go reference green.
  - Ported the new cases into `packages/tests/src/renderer/standard-renderer.test.ts`, capturing the expected Vitest failures (missing commands + renderer methods) to stay aligned with the tests-first directive.
  - Implemented ignored-line tracking plus the scroll-area helpers in `packages/tea/src/index.ts` (new TS commands, renderer handleMessage branches, ANSI helpers) until `pnpm test` passed all 66 specs.
- **What’s Next (priority order):**
  1. Add the pending end-to-end Vitest coverage for `Println`/`Printf` via `Program.send` so queued print-line behaviour is exercised through the public API, not just direct renderer calls.
  3. Audit the `Printf` implementation vs Go’s `fmt.Sprintf` (verb/width parity) so we can close the previously noted compatibility risk.
- **Blockers/Risks:**
  - Scroll-area helpers still rely on raw ANSI margin control; we’ll need integration coverage (potentially via future example ports) to confirm the sequences behave consistently across terminals/platforms.

## 2025-11-14 (Session 11)
- **Session Goals:** Close the top renderer work item by writing the missing StandardRenderer spec, porting it to Vitest, and unblocking production code changes via the agreed tests-first flow.
- **Completed:**
  - Authored `renderer_standard_test.go` covering frame deduping, queued print lines, window-size repainting, and alt-screen toggles, then verified the upstream Go implementation with `go test ./...`.
  - Translated the new spec into `packages/tests/src/renderer/standard-renderer.test.ts`, building a renderer harness that can exercise flush/alt-screen behaviour directly and capturing the expected Vitest failure.
  - Updated `packages/tea/src/index.ts` to add queued print-line buffering, align the flush logic with Go’s width semantics, and expose `Println`/`Printf` commands, then re-ran `pnpm test` to confirm all 63 specs pass.
- **What’s Next (priority order):**
  1. Extend the renderer spec to cover ignored line ranges and scroll-area helpers (`setIgnoredLines`, `SyncScrollArea`, `ScrollUp/Down`) so the TypeScript renderer keeps parity with Go’s high-performance paths.
  2. Add end-to-end Vitest coverage for the new `Println`/`Printf` commands (via `Program.send`) to ensure queued messages behave correctly from the public API, not just through direct renderer access.
- **Blockers/Risks:**
  - `Printf` currently relies on Node’s `util.format`, which is close but not identical to Go’s `fmt.Sprintf`; we still need a compatibility audit to catch discrepant verbs/width flags before calling the feature done.

## 2025-11-14 (Session 10)
- **Session Goals:** Resolve the top renderer work item by locating or reconstructing the missing StandardRenderer Go spec so we can resume the tests-first workflow.
- **Completed:**
  - Cloned `github.com/charmbracelet/bubbletea` into `../bubbletea-upstream`, fetched full history, and searched both the working tree and full git log (`rg --files -g 'renderer_test.go'`, `git rev-list --all -- renderer_test.go`) to verify the test suite never existed upstream.
  - Queried the GitHub tree API to double-check that only `nil_renderer_test.go` is present in `main`, ruling out a renamed subdirectory or CI-only fixture.
  - Selected a fallback approach: author a dedicated Go renderer spec (`renderer_standard_test.go`) that captures StandardRenderer flush/handleMessage/alt-screen semantics before translating it to TypeScript.
- **What’s Next (priority order):**
  1. Draft the new Go StandardRenderer spec (flush, queued messages, window-size handling, alt-screen toggles) and run `go test ./...` to ensure it passes against upstream Go code.
  2. Translate those freshly authored tests into `packages/tests/src/renderer/renderer.test.ts`, expanding the fake terminal helpers as needed.
  3. Address any behavioural deltas surfaced by the new spec inside the TypeScript `StandardRenderer` and dependent runtime paths.
- **Blockers/Risks:**
  - With no upstream renderer tests to translate, the newly authored Go suite becomes the canonical spec; it must stay tightly aligned with `standard_renderer.go` to avoid diverging semantics.

## 2025-11-14 (Session 9)
- **Session Goals:** Start the top-priority renderer work item by translating `renderer_test.go` before touching runtime code.
- **Completed:**
  - Searched the workspace (`rg --files -g 'renderer_test.go'`, `find .. -name 'renderer_test.go'`) and upstream history (`git ls-tree -r --name-only HEAD | rg 'renderer_test.go'`) to confirm the Go suite is absent in both the local tree and the canonical Charmbracelet history.
  - Queried GitHub’s tree API for `renderer_test.go` and verified only `nil_renderer_test.go` exists today, so there is no Go spec to translate for StandardRenderer behaviour.
- **What’s Next (priority order):**
  1. Obtain the missing Go renderer spec (expected `renderer_test.go` covering StandardRenderer flush/handleMessage semantics) so the TypeScript translation can proceed under the tests-first workflow.
  2. Once the Go suite is available, translate it into `packages/tests/src/renderer/renderer.test.ts`, expanding fake terminal helpers for ignored lines/scroll regions as needed.
  3. Resume the pending logging follow-ups and Program/runtime toggles once the renderer specs land, since those features depend on the same behaviour guarantees.
- **Blockers/Risks:**
  - Without the upstream `renderer_test.go` (or equivalent), the renderer What’s Next items are fully blocked and implementing production code would violate the agreed tests-first methodology.

## 2025-11-14 (Session 8)
- **Session Goals:** Knock out the top renderer What’s Next item by porting `nil_renderer_test.go` so NilRenderer behaviour stays pinned by translated specs.
- **Completed:**
  - Translated `nil_renderer_test.go` into `packages/tests/src/renderer/nil-renderer.test.ts`, exercising every NilRenderer control method (alt screen, mouse modes, bracketed paste, focus reporting) to guarantee they remain pure no-ops that always report inactive state.
  - Ran `pnpm test` (Vitest run) and verified all 58 specs, including the new renderer suite, pass so no production changes were necessary after the translation.
- **What’s Next (priority order):**
  1. Translate the remaining renderer suites—starting with `renderer_test.go`—to capture StandardRenderer flushing/handleMessage semantics before touching runtime internals again.
  2. Port the outstanding logging follow-ups (structured logging, multi-writer cases) so the console/file adapter keeps parity with Go.
- **Blockers/Risks:**
  - Upcoming `renderer_test.go` translation will need richer fake terminal primitives (ignored lines, scroll regions); design decisions there could influence StandardRenderer structure, so expect iteration once the tests land.

## 2025-11-14 (Session 7)
- **Session Goals:** Translate the Go renderer/logging suites and stand up the corresponding TypeScript implementations so the next wave of runtime features stays test-driven.
- **Completed:**
  - Ported `logging_test.go` → `packages/tests/src/logging/logging.test.ts` and `screen_test.go` → `packages/tests/src/renderer/screen.test.ts`, mirroring the table-driven cases used in Go.
  - Implemented a real `LogToFile` helper that opens/permissions the target file, normalizes prefixes, and installs a console-backed logger adapter so `console.log` traffic mirrors Go’s `log.Default()` semantics.
  - Rebuilt the renderer core: expanded the `Renderer` interface, added a NilRenderer with full no-op coverage, and implemented a spec-driven `StandardRenderer` that buffers frames and flushes via a ticker (mirroring Go’s FPS throttling, alt-screen/mouse/bracketed-paste behavior, and cleanup sequences).
  - Integrated the new renderer with `Program` (start/stop lifecycle, message interceptors, `restoreTerminalState`, mouse-mode handling) so the translated tests drive the runtime rather than direct writes to `stdout`.
  - Ran `pnpm test` (Vitest) to ensure all 57 specs, including the new logging/renderer suites, pass end-to-end.
- **What’s Next (priority order):**
  1. Continue porting the remaining renderer-related suites (`nil_renderer_test.go`, `logging_test.go` follow-ups, `renderer_handleMessages`, etc.) so edge cases (ignored lines, scroll regions, focus reporting) stay specified.
  3. Start mapping the logging/renderer integration tests (e.g., `logging_test.go` variations, structured logging) to confirm the new console adapter works across different node environments.
- **Blockers/Risks:**
  - The StandardRenderer still lacks advanced optimizations from Go (ignored lines, ANSI compression); future suites may surface performance or parity gaps that will require additional ports.

## 2025-11-14 (Session 6)
- **Session Goals:** Activate the TypeScript `Program` runtime so the translated `tea.test.ts` lifecycle specs execute and turn the suite green without violating the tests-first workflow.
- **Completed:**
  - Implemented the asynchronous Program state machine (`packages/tea/src/index.ts`) covering start/run/wait, message queueing, filter application, command execution, renderer writes, key-input ingestion, and AbortController-driven shutdown so Go’s semantics are mirrored.
  - Ensured panics from `update`, commands, and `view` map to `ProgramPanicError → ProgramKilledError` causes and propagate through `kill()`/external context cancellation consistently.
  - Fixed the translated filter-shutdown test to send the Go-equivalent `preventCount + 1` quit attempts instead of livelocking forever, keeping the behavioural assertion intact (`packages/tests/src/program/tea.test.ts`).
  - Ran `pnpm test` (Vitest); all 47 current specs now pass end-to-end.
- **What’s Next (priority order):**
  1. Map renderer/logging touchpoints from the Go suites (`renderer_test.go`, `logging_test.go`) and translate those specs so upcoming renderer work stays test-driven.
  2. Flesh out the renderer/logging infrastructure inside `packages/tea` (standard vs nil renderer, buffered output, logging hooks) until the new specs compile, then implement enough behaviour for parity.
  3. Extend the Program runtime with interrupt/mouse/signal toggles surfaced by those tests (alt screen, bracketed paste, report focus) while keeping the context/filter semantics intact.
- **Blockers/Risks:**
  - Upcoming renderer/logging work will require credible terminal/mouse fakes; need to pick an approach (pure Node streams vs. helper libs) before translating the IO-heavy suites.

## 2025-11-14 (Session 5)
- **Session Goals:** Keep the tests-first momentum by preparing support utilities and porting `tea_test.go` so upcoming runtime work is fully spec-driven.
- **Completed:**
  - Added shared async/concurrency helpers (`packages/tests/src/utils/async.ts`) covering `sleep`, `waitFor`, deferred signals, and timeout-aware AbortController creation for lifecycle specs.
  - Fully translated the Go `tea_test.go` suite into `packages/tests/src/program/tea.test.ts`, recreating the `testModel`, context cancellation scenarios, batch/sequence message sending, and panic/kill semantics.
  - Introduced ergonomic runtime placeholders (`Program.run/start/wait/send/quit/kill`) plus typed error classes (`ProgramKilledError`, `ProgramPanicError`) so the new tests compile while still flagging unimplemented behaviour.
  - Ran `pnpm test` (Vitest) to capture the expected 16 failures in the new suite, confirming commands/options suites remain green (30 passing tests total so far).
- **What’s Next (priority order):**
  1. Design the TypeScript `Program` event loop/runtime to satisfy the newly translated lifecycle specs (message queue, command scheduling, context propagation, renderer hooks).
  2. Incrementally implement `Program.run/start/send/wait/quit/kill` along with minimal renderer/logging shims until the `tea.test.ts` cases move toward green.
  3. Map any renderer/logging touchpoints surfaced by those tests so subsequent commits can flesh out terminal output handling without breaking TDD cadence.
- **Blockers/Risks:**
  - All lifecycle specs currently fail because the runtime is still a stub; careful design is needed to replicate Go’s concurrency semantics on Node’s event loop.
  - Context cancellation and panic propagation must mirror Go’s nested error wrapping to keep downstream callers informed without leaking internal details.

## 2025-11-14 (Session 4)
- **Session Goals:** Port `options_test.go` to Vitest and expose the Program option surfaces before touching runtime code, keeping the tests-first contract intact.
- **Completed:**
  - Added `packages/tests/src/options/options.test.ts`, mirroring the Go suite’s coverage of input/output overrides, renderer toggles, startup flag helpers, and mouse-mode precedence; captured the expected Vitest failures against the missing implementations.
  - Introduced the initial `Program` scaffolding inside `packages/tea/src/index.ts` (InputType enum, StartupOptions bitset helper, renderer stubs, Node stream defaults) plus concrete implementations for the option helpers (`WithOutput`, `WithInput`, `WithMouse*`, `WithoutRenderer`, `WithoutSignals`, etc.).
  - Ran `pnpm test` to ensure both the existing commands specs and the new options specs pass (30 total tests).
- **What’s Next (priority order):**
  1. Flesh out the shared Vitest utilities/fakes required for the upcoming `tea_test.go` lifecycle translation so we can continue stubbing behaviour without production changes first.
  2. Translate the next Go suite (`tea_test.go`) to keep driving Program-loop requirements from executable specs.
  3. Identify renderer/logging touchpoints surfaced by those tests and plan the next wave of stubs accordingly.
- **Blockers/Risks:**
  - The actual Program event loop and renderer remain skeletal; lifecycle tests will require asynchronous scheduling + terminal fakes, so we must design those abstractions carefully before implementation.

## 2025-11-14 (Session 3)
- **Session Goals:** Drive the translated `commands` Vitest suite to green by implementing the underlying command primitives in `packages/tea` while keeping the tests-first contract intact.
- **Completed:**
  - Implemented the core command helpers (`Quit`, `Batch`, `Sequence`, `Sequentially`, `Every`, `Tick`) with Go-parity semantics inside `packages/tea/src/index.ts`, including nil filtering, sequential execution, and timer alignment helpers.
  - Added shared utilities (`compactCmds`, timer normalization/alignment helpers) to keep future command variants and renderer work DRY.
  - Ran `pnpm test` (Vitest workspace) to confirm the 14 translated `commands` specs now pass end-to-end.
- **What’s Next (priority order):**
  1. Translate `options_test.go` into `packages/tests` and stub any new runtime surfaces it references before touching production code.
  2. Implement the corresponding options-related production code in `packages/tea` until the new Vitest suite passes.
  3. Flesh out shared test utilities (e.g., deterministic option builders, common fixtures) to reduce duplication when additional suites join.
- **Blockers/Risks:**
  - Need to validate the async `Cmd` execution contract against the forthcoming `Program` loop to ensure `Batch`/`Sequence` message fan-out integrates cleanly once the runtime exists.

## 2025-11-14
- **Session Goals:** Understand upstream Go repo, capture migration strategy, and set up logging/process scaffolding.
- **Completed:**
  - Audited top-level Go files, dependencies (`go.mod`), README/tutorials, and identified major subsystems (runtime, renderer, IO, input, options, examples).
  - Authored `.port-plan/plan.md` covering guiding principles, phased roadmap, tooling choices, module mapping, and risk mitigation, with explicit “tests-first” directive.
  - Decided on baseline TypeScript stack (Node 20+, pnpm, Vitest, tsup) and documented in decision log.
  - Created logging scaffolding (`progress-log.md`, `decision-log.md`, `standard-prompt.md` placeholder) per user requirements.
- **What’s Next (priority order):**
  1. Bootstrap pnpm workspace (`package.json`, `pnpm-workspace.yaml`) plus `packages/tea` and `packages/tests` directories with basic tsconfig + lint setup.
  2. Implement Vitest configuration and foundational test utilities (fake terminal streams, clock helpers) before porting any production code.
  3. Begin translating logic-only Go tests (e.g., `commands_test.go`, `options_test.go`) into TypeScript to drive the first slices of runtime implementation.
  4. Update progress & decision logs as architecture choices solidify (e.g., terminal adapter strategy).
- **Open Questions/Notes:**
  - Need to evaluate existing Node terminal libraries (e.g., `node-pty`, `ansi-escapes`, `blessed-contrib`) and decide whether to depend on them or build minimal wrappers.
  - Confirm licensing compatibility for reusing Charmbracelet assets/documentation.

### Test Parity Checklist (to update as suites are ported)
- [x] `commands_test.go`
- [x] `options_test.go`
- [x] `tea_test.go`
- [x] `screen_test.go`
- [x] `key_test.go`
- [x] `mouse_test.go`
- [x] `signals` (`SIGWINCH` resize handling)
- [x] `exec_test.go`
- [ ] Integration tests derived from tutorials/examples (tutorials/basics done, tutorials/commands done; next: examples/spinner)

## 2025-11-14 (Session 2)
- **Session Goals:** Stand up the pnpm/TypeScript workspace, configure Vitest + linting, and port the first Go test suite (`commands_test.go`) before implementing runtime code.
- **Completed:**
  - Bootstrapped pnpm workspace scaffolding (`package.json`, `pnpm-workspace.yaml`, root/base tsconfigs) and created `packages/tea` + `packages/tests` with initial `tsconfig`s and package manifests.
  - Added ESLint flat config + `tsconfig.eslint.json`, wired scripts (`lint`, `typecheck`, `test`) and dev dependencies (`typescript`, `vitest`, `eslint`, etc.).
  - Authored Vitest configuration (root `vitest.config.ts` + package config) plus shared test utilities (`utils/cmd.ts`, `utils/fakeTimers.ts`, `setupTests.ts`) to enforce fake-timer discipline.
  - Defined initial TypeScript runtime surface in `packages/tea/src/index.ts` (types + stubbed `Cmd`, `Batch`, `Sequence`, `Sequentially`, `Every`, `Tick`, `Quit`) so tests can compile while still failing at runtime.
  - Fully translated `commands_test.go` into `packages/tests/src/commands/commands.test.ts`, preserving table-driven cases and wrapping timer tests with fake timers; captured failing Vitest run (14 failing tests) that will drive the upcoming implementation work.
- **What’s Next (priority order):**
  1. Implement the `commands` primitives in `packages/tea` (`Cmd` executor semantics, `Batch`/`Sequence` compaction, `Sequentially`, `Every`, `Tick`, `QuitMsg`) until the translated `commands` Vitest suite passes.
  2. Once the commands tests are green, continue translating the next pure-logic Go suites (e.g., `options_test.go`) to keep building out executable specifications.
  3. Expand the shared test utilities as needed (e.g., deterministic channels/queues) to support upcoming suites without touching production code first.
- **Blockers/Risks:**
  - Newly added tests currently fail because runtime functions are stubs; implementing non-blocking timer semantics that still satisfy the Go API will require careful design.
  - Need to ensure the async `Cmd` contract (commands return `Promise<Msg> | Msg`) meshes with the eventual `Program` event loop; further architectural validation pending.
