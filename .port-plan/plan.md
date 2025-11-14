# Bubble Tea → TypeScript Port Plan

_Last updated: 2025-11-14_

## 1. Repository Analysis Snapshot
- **Language & scope:** Original project is a single Go module (`github.com/charmbracelet/bubbletea`) containing ~30 core `.go` files plus large `examples/` and `tutorials/` trees.
- **Key subsystems:**
  - `tea.go`, `program`, `cmd`, `model` interfaces, lifecycle orchestration, concurrency primitives.
  - Terminal + renderer stack: `renderer.go`, `screen.go`, `standard_renderer.go`, `nil_renderer.go`, `logging.go` and options to switch render modes.
  - IO surfaces: key handling (`key.go`, `key_sequences.go`, `key_*`), mouse (`mouse.go`), focus handling (`focus.go`), input reader abstractions (`inputreader_*`, `tty_*`, `signals_*`).
  - Program options (`options.go`), command helpers (`commands.go`), exec integration (`exec.go`), environment bridging (`tea_init.go`).
  - Tests exist for nearly every subsystem (`*_test.go`) and encode the desired behaviour we must preserve.
- **Dependencies:** heavy use of Charmbracelet ecosystem packages (`lipgloss`, `x/term`, `x/ansi`, `termenv`, `cellbuf`) and low-level terminal control (`golang.org/x/sys`). None of these map 1:1 to Node, so we must select TypeScript analogues or re-implement minimal features.
- **Non-code assets:** README tutorial, numerous examples demonstrating module boundaries we can leverage as acceptance tests later.

## 2. Objectives & Scope
1. Deliver a faithful TypeScript implementation (Node 20+ target, ESM-first) that mirrors Bubble Tea’s API, behaviour, and ergonomics.
2. Preserve test coverage by **porting Go tests first** into a TypeScript harness so the port is driven by executable specifications (TDD scaffolding).
3. Provide compatibility shims for cross-platform terminal behaviour (Unix/macOS/Windows) with a consistent JS API.
4. Eventually port high-value examples/tutorials to serve as regression and documentation assets.

_Out of scope initially:_ re-imagining API ergonomics, hooking into browsers, or bundling UI component libraries (e.g., Bubbles). Such enhancements can follow once parity is achieved.

## 3. Guiding Principles
- **Spec-driven:** Start from the behaviour documented in Go tests, README, and tutorials; encode them as Vitest test suites before writing production code.
- **Parity before polish:** replicate semantics first (commands, concurrency, renderer quirks) before optimizing or “modernizing” the design.
- **Progressive enhancement:** implement the narrowest viable surfaces (e.g., renderer with ANSI writer) and layer optional capabilities (mouse, focus, report) afterwards.
- **Cross-platform discipline:** abstract terminal access behind injectable adapters so Unix and Windows specifics remain swappable/instrumentable.
- **Observability:** keep logging hooks, panic/interrupt safety, and error propagation transparent for debugging.
- **Iteration protocol:** every development session begins by re-reading `.port-plan/plan.md`, `progress-log.md`, and `decision-log.md`, then updating `progress-log.md` with “Done/Next” at the end.

## 4. Target Stack & Tooling
- **Runtime:** Node.js ≥ 20.11 (aligns with current LTS, enables Web Streams & AbortController parity).
- **Language:** TypeScript 5.x with `tsconfig` targeting ES2022, outputting ESM plus dual CJS via build (tsup).
- **Package manager:** pnpm (fast workspace support) unless conflicting user preference emerges.
- **Testing:** Vitest (Jest-compatible API, watch mode, good TS integration). Use `ttys` or `node-pty` based fakes for integration tests; rely on `pseudoterminal` polyfills for Windows coverage via CI.
- **Lint/format:** ESLint (typescript-eslint), Prettier, Biome optional. Enforce commit hooks via `lefthook` or `simple-git-hooks` later.
- **Continuous Integration:** GitHub Actions with matrix across macOS/Linux/Windows to mimic Go project coverage.

## 5. High-Level Phases & Deliverables
### Phase 0 – Discovery & Infrastructure (complete)
1. Analyse Go sources, map subsystems (this document).
2. Decide runtime/tooling, logging protocol, file layout (`packages/tea`, `packages/examples`, etc.).
3. Create `.port-plan` scaffolding for multi-session continuity.
4. Draft module-by-module migration mapping.

### Phase 1 – Test Harness & Specification Port (complete)
1. Stand up pnpm workspace + TypeScript config (`packages/tea`, `packages/tests`).
2. Implement shared test utilities: fake clock, fake terminal streams, message scheduler.
3. Port Go test files to TS incrementally:
   - Start with pure logic suites (e.g., `commands_test.go`, `options_test.go`).
   - Capture behaviour-specific fixtures as data-driven tests.
4. For each Go test, stub the corresponding production module with TODOs so TypeScript compilation fails/passes in sync with test progress.
5. Configure Vitest watch + coverage gating so unimplemented features remain visible.

### Phase 2 – Core Runtime & Message Loop (complete)
1. Implement `Program`, `Model`, `Msg`, and `Cmd` abstractions mirroring Go semantics (including `Batch`, `Sequence`, `Every`, etc.).
2. Ensure concurrency semantics via `async`/`await`, `AbortController`, and event queues; replicate `tea.Run` options.
3. Achieve green status on runtime-focused tests (converted from `tea_test.go`, `commands_test.go`).
4. Provide TypeScript-friendly builder API while keeping API names aligned.

### Phase 3 – Renderer & Screen Management _(current phase, entering wrap-up)_
1. Renderer, screen, logging, and fmt parity work is largely complete (TypeScript runtime + translated specs are in place).
2. Remaining Phase 3 focus: finish the outstanding `%#v`/`%+v` formatter coverage and keep Window/renderer docs/examples synced with the latest behaviour.
3. Ensure newly added renderer/logging features land under translated Go specs before touching production code.
4. Use this phase to stage the transition into input/tty work (Phase 4) by lining up the relevant Go tests.

### Phase 4 – Input, Signals, and Environment
1. Translate the remaining Go specs (`key_test.go`, `mouse_test.go`, `tty_*`, `signals_*`) before shipping new TypeScript code so the tests continue to be the oracle.
2. Build the Unix/macOS input reader using `readline` and `process.stdin.setRawMode`. Windows-specific fallbacks are **out of scope** for this loop; defer them until a Windows toolchain is available.
3. Implement key/mouse parsing logic (mirroring `key_*.go`, `mouse.go`). Use deterministic fixtures for tests.
4. Implement signal handling wrappers for SIGINT, SIGWINCH, focus events.
5. Ensure all the translated tests pass on Node (Vitest) and Go remains green.

### Phase 5 – Options, Exec, and Advanced Features
1. Port program options API (`WithAltScreen`, `WithEventFilter`, etc.) and ensure TypeScript ergonomics.
2. Build subprocess support analogous to `exec.Cmd` integration (likely `child_process.spawn` wrappers with message bridging).
3. Recreate `tea.Batch`, `tea.Sequence`, timers, tickers, focus reporting, bracketed paste toggles.
4. Fill any gaps noted in decision log.

### Phase 6 – Documentation, Examples, Tutorials
1. Port selected Go examples to TS (prioritize `simple`, `list-default`, `progress`, `mouse`).
2. Update README to describe TypeScript usage, include quick-start.
3. Provide migration notes for Go users moving to TS.

### Phase 7 – Hardening & Release Prep
1. Audit performance (profiling render loop, memory), benchmark vs Go reference on sample apps.
2. Add CI, versioning strategy, semantic-release or changesets.
3. Final QA: run full example suite, manual cross-platform verification.

## 6. Module Mapping Matrix
| Go Component | Port Target | Notes |
| --- | --- | --- |
| `tea.Program`, `Model`, `Cmd`, `Msg` | `src/program.ts`, `src/types.ts` | Mirror public API; maintain functional signatures.
| `commands.go` helpers | `src/commands/*.ts` | Provide typed combinators; ensure `Batch`, `Sequence`, `Every` semantics match tests.
| `options.go` | `src/options.ts` | Use builder/factory functions returning `ProgramOptions` objects.
| `renderer.go`, `standard_renderer.go`, `screen.go` | `src/renderer/*.ts`, `src/screen/*.ts` | Need diffing & throttling; rely on ANSI escape utilities.
| `logging.go` | `src/renderer/logging.ts` | Provide deterministic output sink for tests.
| `key.go`, `key_sequences.go`, platform-specific key files | `src/input/key/*.ts` | Parse escape sequences, map to semantic keys.
| `mouse.go` | `src/input/mouse.ts` | Support cell/all motion using ANSI/SGR mouse reporting.
| `tty_*.go`, `inputreader_*.go`, `signals_*.go` | `src/tty/*.ts`, `src/os/*.ts` | Wrap Node’s TTY APIs; provide Unix/macOS abstractions for tests. (Windows-specific adapters deferred.)
| `exec.go`, `exec_test.go` | `src/commands/exec.ts` | Wrap `child_process.spawn` with message bridging.
| `tea_init.go` | `src/runtime/init.ts` | Provide CLI entry to bootstrap Model & Program.
| Tests (`*_test.go`) | `tests/*.test.ts` | Port first; keep file-per-module mapping.
| Examples & tutorials | `examples-ts/*` | Use ESM entrypoints runnable via `pnpm tsx`.

## 7. Testing-First Workflow
1. **Inventory tests:** create checklist mirroring existing Go test files (appendix in progress log).
2. **Translate semantics:** for each Go test, rephrase assertions using Vitest; rely on fake timers & stubbed streams.
3. **Implement harness utilities** (`TestRenderer`, `FakeTerminal`, `MessageRecorder`) early to keep tests simple.
4. **Drive implementation:** write minimal TS code to satisfy translated tests; avoid writing production code before tests exist.
5. **Traceability:** maintain mapping table (Go test → TS test) inside `progress-log.md` so we know when parity is achieved.

## 8. Risks & Mitigations
- **Terminal behaviour drift:** Node lacks native termios; implement wrappers/fakes that keep `setRawMode`/resize logic hermetic under tests.
- **Timing/concurrency differences:** Use `async` constructs carefully; rely on deterministic scheduler for tests; consider `p-limit` or custom queue for commands.
- **Windows-specific work:** Deferred. Log anything requiring Windows as a blocker and move on.
- **Large scope:** enforce incremental milestones per phase, update decision/progress logs diligently.

## 9. Tracking & Next Actions
- **Logs:**
  - `progress-log.md` – “What happened this session / what’s next”.
  - `decision-log.md` – permanent record of major choices (ID, date, rationale).
  - `standard-prompt.md` – canonical restart instructions.
- **Loop guardrail:** this environment cannot push to remotes or trigger GitHub Actions; when such tasks arise, log them under Blockers and immediately continue with the next locally executable spec translation or implementation task.
- **Immediate next steps (for the autonomous loop):**
  1. Finish the outstanding `%#v` formatter combos called out in the latest progress-log entries so the fmt oracle is complete.
  2. Translate `key_test.go` (then `mouse_test.go`) into `packages/tests` while stubbing any required runtime placeholders.
  3. Draft the tty/signal test translation plan (identify which Go files come next and what fakes are needed) so Phase 4 can start immediately after key/mouse coverage lands.
  4. OUT OF SCOPE FOR LOOP: publishing pnpm manifests, pushing to `origin/main`, or triggering CI. Leave these in the progress-log Blockers for a human session.
