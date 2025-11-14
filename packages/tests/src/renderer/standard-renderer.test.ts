import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';

import {
  ClearScrollArea,
  Msg,
  NewProgram,
  Renderer,
  ScrollDown,
  ScrollUp,
  SyncScrollArea,
  WithOutput
} from '@bubbletea/tea';

interface StandardRendererHarness extends Renderer {
  flush(): void;
  running: boolean;
  setIgnoredLines(from: number, to: number): void;
  clearIgnoredLines(): void;
}

const PRINT_LINE_MSG = 'bubbletea/print-line';

const createRendererHarness = () => {
  const output = new PassThrough();
  let buffer = '';
  output.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
  });

  const program = NewProgram(null, WithOutput(output));
  const renderer = program.renderer as unknown as StandardRendererHarness;
  renderer.running = true;

  return {
    renderer,
    readOutput: () => buffer,
    consumeOutput: () => {
      const value = buffer;
      buffer = '';
      return value;
    }
  };
};

describe('StandardRenderer (renderer_standard_test.go parity)', () => {
  it('skips duplicate frames on flush', () => {
    const { renderer, consumeOutput } = createRendererHarness();

    renderer.write('first frame');
    renderer.flush();
    const first = consumeOutput();
    expect(first).toContain('first frame');

    renderer.write('first frame');
    renderer.flush();
    expect(consumeOutput()).toBe('');

    renderer.write('second frame');
    renderer.flush();
    expect(consumeOutput()).toContain('second frame');
  });

  it('flushes queued print lines before the next frame', () => {
    const { renderer, consumeOutput } = createRendererHarness();

    renderer.handleMessage?.({ type: PRINT_LINE_MSG, body: 'queued-one\nqueued-two' });
    renderer.write('view-line');
    renderer.flush();

    const output = consumeOutput();
    expect(output.startsWith('queued-one\r\nqueued-two\r\n')).toBe(true);
    expect(output).toContain('view-line');

    renderer.write('view-line');
    renderer.flush();
    expect(consumeOutput()).not.toContain('queued');
  });

  it('ignores queued print lines while the alt screen is active', () => {
    const { renderer, consumeOutput } = createRendererHarness();

    renderer.enterAltScreen();
    consumeOutput();

    renderer.handleMessage?.({ type: PRINT_LINE_MSG, body: 'hidden' });
    renderer.write('frame');
    renderer.flush();

    expect(consumeOutput()).not.toContain('hidden');
  });

  it('repaints after window-size messages and truncates per width', () => {
    const { renderer, consumeOutput } = createRendererHarness();
    const content = 'repaint me now';

    renderer.write(content);
    renderer.flush();
    consumeOutput();

    renderer.write(content);
    renderer.flush();
    expect(consumeOutput()).toBe('');

    renderer.handleMessage?.({ type: 'bubbletea/window-size', width: 4, height: 2 });
    renderer.write(content);
    renderer.flush();

    const output = consumeOutput();
    expect(output).not.toBe('');
    expect(output).toContain('repa');
    expect(output).not.toContain('repai');
  });

  it('writes the expected alt-screen sequences', () => {
    const { renderer, consumeOutput } = createRendererHarness();

    renderer.enterAltScreen();
    const enter = consumeOutput();
    expect(enter).toContain('\x1b[?1049h');
    expect(enter).toContain('\x1b[2J');
    expect(enter).toContain('\x1b[H');

    renderer.enterAltScreen();
    expect(consumeOutput()).toBe('');

    renderer.exitAltScreen();
    const exit = consumeOutput();
    expect(exit).toContain('\x1b[?1049l');

    renderer.exitAltScreen();
    expect(consumeOutput()).toBe('');
  });

  it('skips ignored line ranges during flush', () => {
    const { renderer, consumeOutput } = createRendererHarness();

    renderer.write('line0\nline1\nline2');
    renderer.flush();
    consumeOutput();

    renderer.setIgnoredLines(1, 3);
    const seq = consumeOutput();
    expect(seq).toContain('\x1b[2K');

    renderer.write('line0-new\nline1-new\nline2-new');
    renderer.flush();
    const skipped = consumeOutput();
    expect(skipped).toContain('line0-new');
    expect(skipped).not.toContain('line1-new');
    expect(skipped).not.toContain('line2-new');

    renderer.clearIgnoredLines();
    renderer.write('line0-final\nline1-final\nline2-final');
    renderer.flush();
    const finalOut = consumeOutput();
    expect(finalOut).toContain('line1-final');
  });

  it('syncs scroll areas via commands', () => {
    const { renderer, consumeOutput } = createRendererHarness();

    renderer.write('one\ntwo\nthree');
    renderer.flush();
    consumeOutput();

    renderer.handleMessage?.({ type: 'bubbletea/window-size', width: 80, height: 24 });

    const cmd = SyncScrollArea(['alpha', 'beta'], 3, 6);
    const msg = cmd?.();
    if (msg) {
      renderer.handleMessage?.(msg as Msg);
    }

    const output = consumeOutput();
    expect(output).toContain('\x1b[3;6r');
    expect(output).toContain('\x1b[3;H');
    expect(output).toContain('\x1b[2L');
    expect(output).toContain('alpha\r\nbeta');
    expect(output).toContain('\x1b[;24r');

    renderer.handleMessage?.(ClearScrollArea());
  });

  it('handles scroll up/down commands for high-performance rendering', () => {
    const { renderer, consumeOutput } = createRendererHarness();

    renderer.handleMessage?.({ type: 'bubbletea/window-size', width: 100, height: 20 });
    renderer.write('a\nb\nc\nd');
    renderer.flush();
    consumeOutput();

    const scrollUp = ScrollUp(['top-1', 'top-2'], 2, 6);
    const upMsg = scrollUp?.();
    if (upMsg) {
      renderer.handleMessage?.(upMsg as Msg);
    }
    const upOutput = consumeOutput();
    expect(upOutput).toContain('\x1b[2;6r');
    expect(upOutput).toContain('\x1b[2;H');
    expect(upOutput).toContain('\x1b[2L');
    expect(upOutput).toContain('top-1\r\ntop-2');

    const scrollDown = ScrollDown(['bottom'], 2, 6);
    const downMsg = scrollDown?.();
    if (downMsg) {
      renderer.handleMessage?.(downMsg as Msg);
    }
    const downOutput = consumeOutput();
    expect(downOutput).toContain('\x1b[2;6r');
    expect(downOutput).toContain('\x1b[6;H');
    expect(downOutput).toContain('\r\nbottom');
    expect(downOutput).toContain('\x1b[;20r');
  });
});
