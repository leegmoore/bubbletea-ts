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

## Example

`examples-ts/rendering/basic-capture.ts` (coming soon) will show how to wire a
fake terminal to the renderer via `WithOutput`, emit frames, and inspect the
output for testing purposes.
