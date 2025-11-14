# Renderer Guide (TypeScript)

_Last updated: 2025-11-14_

Bubble Tea’s default renderer (`StandardRenderer`) ships as part of the
TypeScript runtime and mirrors Go’s behaviour: buffered frames, diff-based
updates, cursor/alt-screen state tracking, and support for mouse, bracketed
paste, and focus reporting toggles.

## What the renderer does for you

- Buffers the latest `view` output and flushes it on a ticker (default 60 FPS).
- Detects unchanged lines and emits the minimal cursor movements necessary to
  repaint the terminal.
- Tracks the cursor/alt-screen/focus/mouse state so shutdown sequences restore
  the user’s terminal, even across panics.
- Queues `bubbletea/print-line` messages so `Program.Printf` output is flushed
  ahead of the next frame.

You rarely need to instantiate `StandardRenderer` yourself—the default
`NewProgram` call wires it up automatically. Use `WithOutput(customStream)` if
you want to capture frames (for example, when snapshot-testing views).

## Windows newline guarantees

Windows consoles expect `\r\n` for every newline, including cursor-relative
sequences. The renderer now handles this automatically:

- Every write that hits `process.stdout` or a custom output runs through a
  Windows-aware normalizer when `process.platform === 'win32'`.
- Partial frame renders and ignored-line scroll regions emit CRLF even when
  the diff skips unchanged rows.
- `bubbletea/print-line` payloads are normalized the same way so logging output
  never produces stray `\n` on Windows terminals.

The end result: anything you print through the renderer (frames, scroll
commands, `Program.Printf`) respects Windows console expectations without
requiring any conditional logic in your models.

## Example

`examples-ts/rendering/windows-crlf.ts` shows how to wire a fake terminal to the
renderer via `WithOutput`, emit a couple of frames, and inspect the CRLF output.
Run it with a TS runner (for example `pnpm dlx tsx examples-ts/rendering/windows-crlf.ts`)
to see the escaped transcripts printed to stdout.
