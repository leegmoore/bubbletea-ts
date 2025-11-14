# Windows Renderer & Logging Validation Plan

_Last updated: 2025-11-14_

## Objectives
- Guarantee the TypeScript port matches Bubble Tea's renderer and structured logging behaviour on Windows consoles before we merge additional runtime work.
- Describe how we will simulate Windows terminals (no ANSI by default, CRLF quirks, alt-screen limits) while keeping the Go suite authoritative.
- Define stderr mirroring and multi-writer log fan-out expectations for Windows where descriptor duplication behaves differently.
- Capture CI actions so Windows coverage runs continuously (Go + Vitest).

## Validation Surfaces
### 1. Renderer lifecycle & escape sequences
- **Go reference:** add `renderer_windows_test.go` (`//go:build windows`) mirroring `renderer_standard_test.go`, focusing on:
  - `enable/disable alt screen` producing the Windows-friendly `\x1b[?1049h/l` sequences and fallbacks when `TERM=dumb`.
  - Bracketed paste, mouse SGR toggles, focus reporting, and `print-line` queue behaviour with CRLF normalization.
  - Screen resize behaviour: redraw on `window-size` messages while respecting Windows console width detection.
- **TS/Vitest port:** new suites under `packages/tests/src/renderer/windows-standard.test.ts` using a fake Windows terminal adapter that:
  - Forces CRLF newlines, strips unsupported ANSI sequences (so we can verify the renderer re-emits them), and exposes raw write buffers.
  - Injects `process.platform='win32'` via Vitest `vi.spyOn` so renderer paths choose Windows-specific code.
- **Harness work:** build `createWindowsRendererHarness()` in `packages/tests/src/utils/windows-terminal.ts` sharing code between renderer/logging suites.

### 2. Structured logging behaviour
- **Go reference:** extend `logging_test.go` with Windows-only cases verifying `LogToFile` when `stderr` is redirected, including:
  - Multi-process append semantics when multiple programs open the same logfile sequentially on Windows.
  - Fan-out to both `logFile` and `stderr` pipe without closing the pipe even if `LogToFile` finishes first.
  - Handling of Windows-specific newline conversions when log entries contain `\n` vs `\r\n`.
- **TS/Vitest port:** add `packages/tests/src/logging/windows-logging.test.ts` that replays the Go tests using Node streams that mimic Windows descriptors.
  - Introduce a `WindowsWritable` helper that enforces CRLF translation and tracks `end()` calls to ensure we do not close injected stderr streams.
  - Verify `FanOutWritable` replicates Windows fan-out semantics (auto-flush order + error propagation).

## Fake Terminal Strategy
- Implement a `FakeWindowsTerminal` that wraps `PassThrough` streams and exposes:
  - `write(chunk)` to capture writes while automatically translating `\n` → `\r\n` so renderer tests can observe Windows newline expectations.
  - Hooks for `enterAltScreen`, `exitAltScreen`, `enableMouse`, etc., to record sequences even though Windows consoles often ignore them; we assert that the sequences are still sent so Windows Terminal/WSL behave correctly.
  - A `resize(width, height)` method to emit synthetic `bubbletea/window-size` messages in both Go and TS tests.
- Share fixtures between Go/TS by codifying message transcripts (JSON) that both suites can read, ensuring specs stay aligned.

## Stderr Mirroring Strategy
- Treat `stderr` as an injected writable stream rather than duping descriptors (since `dup2` semantics differ on Windows).
- Go tests: use a `bytes.Buffer` pretending to be `stderr` and ensure `LogToFile` writes to both the logfile and the buffer while leaving the buffer open.
- TS tests: leverage `FanOutWritable` + `PassThrough` to assert the fan-out path never closes the mocked `stderr`; also check that we flush file writes before mirroring to stderr to maintain ordering.
- Add documentation snippet (`docs/logging.md`) once the suites pass, clarifying how developers enable stderr mirroring on Windows and why we avoid touching the underlying descriptor.

## Windows CI Matrix
- **GitHub Actions job (`windows-latest`):**
  1. `pnpm install --frozen-lockfile` (Node 20.11).
  2. `pnpm lint` + `pnpm test -- --runInBand` (ensures Windows fake terminal tests run serially).
  3. `go test ./...` (leveraging `GOOS=windows` implicit because runner is Windows).
  4. Optional: `pnpm test:windows-emulated` to run renderer/logging suites with `WINPTY` polyfills on Linux/macOS runners (fast feedback).
- Keep Linux/macOS jobs unchanged but add a `matrix.os` entry for Windows to guarantee each PR exercises the new suites.

## Actionable Next Steps
1. Implement `FakeWindowsTerminal` + `WindowsWritable` helpers in TS tests.
2. Write the new Go tests under `renderer_windows_test.go` / `logging_windows_test.go` with `//go:build windows` guards and run them locally via `GOOS=windows go test ./...`.
3. Translate the specs into Vitest suites and keep them failing until the renderer/logging runtime paths are implemented.
4. Update CI (`.github/workflows/ci.yml`) with a Windows matrix entry referencing `pnpm test --filter windows` once the suites exist.
5. Document stderr mirroring instructions in `docs/logging.md` and link from README.
