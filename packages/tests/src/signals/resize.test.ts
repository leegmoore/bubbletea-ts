import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';

import type { Cmd, Model, Msg, Program, WindowSizeMsg } from '@bubbletea/tea';
import { NewProgram, WithInput, WithOutput } from '@bubbletea/tea';

import { waitFor, withTimeout } from '../utils/async';

const WINDOW_SIZE_MSG = 'bubbletea/window-size';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isWindowSizeMsg = (msg: Msg): msg is WindowSizeMsg =>
  isRecord(msg) && (msg as { type?: unknown }).type === WINDOW_SIZE_MSG;

const awaitRun = (program: Program, timeoutMs = 3000) => withTimeout(program.run(), timeoutMs);

class WindowSizeRecorder implements Model {
  public readonly sizes: Array<{ width: number; height: number }> = [];

  init(): Cmd {
    return null;
  }

  update(msg: Msg) {
    if (isWindowSizeMsg(msg)) {
      this.sizes.push({ width: msg.width, height: msg.height });
    }
    if (isRecord(msg) && (msg as { type?: unknown }).type === WINDOW_SIZE_MSG) {
      return [this, null] as const;
    }
    return [this, null] as const;
  }

  view(): string {
    return '';
  }
}

class FakeTty extends PassThrough {
  public isTTY = true;
  public columns: number;
  public rows: number;

  constructor(columns = 80, rows = 24) {
    super();
    this.columns = columns;
    this.rows = rows;
  }

  setSize(columns: number, rows: number): void {
    this.columns = columns;
    this.rows = rows;
  }

  emitResize(): void {
    this.emit('resize');
  }
}

const createProgram = (
  output: NodeJS.WritableStream,
  overrides: { columns?: number; rows?: number } = {}
) => {
  const input = new PassThrough();
  const model = new WindowSizeRecorder();
  if (output instanceof FakeTty) {
    if (typeof overrides.columns === 'number') {
      output.columns = overrides.columns;
    }
    if (typeof overrides.rows === 'number') {
      output.rows = overrides.rows;
    }
  }
  const program = NewProgram(model, WithInput(input), WithOutput(output));
  return { program, model, input, output };
};

const expectGracefulExit = async (result: Awaited<ReturnType<Program['run']>>) => {
  expect(result.err).toBeNull();
};

describe('terminal resize propagation (signals)', () => {
  it('emits an initial WindowSizeMsg when output is a TTY', async () => {
    const output = new FakeTty(88, 33);
    const { program, model } = createProgram(output);
    const runPromise = awaitRun(program);

    await waitFor(() => model.sizes.length >= 1);

    program.quit();
    const result = await runPromise;
    expectGracefulExit(result);

    const [initial] = model.sizes;
    expect(initial).toEqual({ width: 88, height: 33 });
  });

  it('pushes new WindowSizeMsg entries when resize events fire', async () => {
    const output = new FakeTty(100, 40);
    const { program, model } = createProgram(output);
    const runPromise = awaitRun(program);

    await waitFor(() => model.sizes.length >= 1);

    output.setSize(120, 60);
    output.emitResize();

    await waitFor(() => model.sizes.length >= 2);

    program.quit();
    const result = await runPromise;
    expectGracefulExit(result);

    const [_first, second] = model.sizes;
    expect(second).toEqual({ width: 120, height: 60 });
  });

  it('ignores resize notifications for non-TTY outputs', async () => {
    const output = new PassThrough();
    const { program, model } = createProgram(output);
    const runPromise = awaitRun(program);

    await expect(waitFor(() => model.sizes.length > 0, { timeoutMs: 200 })).rejects.toThrow();

    program.quit();
    const result = await runPromise;
    expectGracefulExit(result);
    expect(model.sizes).toHaveLength(0);
  });
});
