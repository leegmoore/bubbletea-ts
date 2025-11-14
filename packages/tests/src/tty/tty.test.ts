import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  NewProgram,
  Program,
  ProgramOption,
  WithInput,
  WithInputTTY,
  WithOutput,
  WithoutRenderer
} from '@bubbletea/tea';
import * as ttyInternals from '@bubbletea/tea/internal';

import { waitFor, withTimeout } from '../utils/async';

class FakeTtyInput extends PassThrough {
  public isTTY = true;
  public isRaw: boolean;
  public readonly rawModeCalls: boolean[] = [];

  constructor(initialRaw = false) {
    super();
    this.isRaw = initialRaw;
  }

  setRawMode(next: boolean): this {
    this.isRaw = next;
    this.rawModeCalls.push(next);
    return this;
  }
}

class NonTtyInput extends PassThrough {
  public isTTY = false;
  public readonly rawModeCalls: boolean[] = [];

  setRawMode(next: boolean): this {
    this.rawModeCalls.push(next);
    return this;
  }
}

class FakeTtyOutput extends PassThrough {
  public isTTY = true;
  public columns = 80;
  public rows = 24;
}

const awaitRun = (program: Program, timeoutMs = 3000) => withTimeout(program.run(), timeoutMs);

const expectGracefulExit = (result: Awaited<ReturnType<Program['run']>>) => {
  expect(result.err).toBeNull();
};

const createProgram = (input: PassThrough, ...options: ProgramOption[]) => {
  const output = new PassThrough();
  const program = NewProgram(null, WithInput(input), WithOutput(output), ...options);
  return { program, input, output };
};

const createDefaultInputProgram = (input: PassThrough, ...options: ProgramOption[]) => {
  const output = new PassThrough();
  const program = NewProgram(null, WithOutput(output), ...options);
  program.input = input;
  return { program, input, output };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('tty raw-mode semantics', () => {
  it('enables raw mode on tty inputs and restores the original state on shutdown', async () => {
    const input = new FakeTtyInput(false);
    const { program } = createProgram(input);
    const runPromise = awaitRun(program);

    await waitFor(() => input.rawModeCalls.includes(true), {
      timeoutMs: 500,
      errorMessage: 'program never entered raw mode'
    });

    program.quit();
    const result = await runPromise;
    expectGracefulExit(result);

    expect(input.rawModeCalls).toEqual([true, false]);
    expect(input.isRaw).toBe(false);
  });

  it('restores tty inputs to their prior raw-mode state when exiting', async () => {
    const input = new FakeTtyInput(true);
    const { program } = createProgram(input);
    const runPromise = awaitRun(program);

    await waitFor(() => input.rawModeCalls.length > 0, {
      timeoutMs: 500,
      errorMessage: 'raw-mode toggles never triggered'
    });

    program.quit();
    const result = await runPromise;
    expectGracefulExit(result);

    expect(input.rawModeCalls).not.toContain(false);
    expect(input.isRaw).toBe(true);
  });

  it('does not touch raw mode when the input stream is not a tty', async () => {
    const input = new NonTtyInput();
    const { program } = createProgram(input);
    const runPromise = awaitRun(program);

    program.quit();
    const result = await runPromise;
    expectGracefulExit(result);

    expect(input.rawModeCalls).toHaveLength(0);
  });

  it('skips raw-mode toggles entirely when rendering is disabled', async () => {
    const input = new FakeTtyInput();
    const { program } = createProgram(input, WithoutRenderer());
    const runPromise = awaitRun(program);

    program.quit();
    const result = await runPromise;
    expectGracefulExit(result);

    expect(input.rawModeCalls).toHaveLength(0);
  });
});

describe('tty input fallback semantics', () => {
  it('opens a dedicated tty when the default input is not a tty', async () => {
    const fallback = new FakeTtyInput(false);
    const openSpy = vi
      .spyOn(ttyInternals, 'openInputTTY')
      .mockReturnValue(fallback as unknown as NodeJS.ReadStream);

    const { program } = createDefaultInputProgram(new NonTtyInput());
    const runPromise = awaitRun(program);

    await waitFor(() => openSpy.mock.calls.length > 0, {
      timeoutMs: 500,
      errorMessage: 'openInputTTY was never invoked'
    });

    program.quit();
    const result = await runPromise;
    expectGracefulExit(result);

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(program.input).toBe(fallback);
    expect(fallback.rawModeCalls).toEqual([true, false]);
  });

  it('forces a new tty when WithInputTTY is provided', async () => {
    const fallback = new FakeTtyInput(false);
    const openSpy = vi
      .spyOn(ttyInternals, 'openInputTTY')
      .mockReturnValue(fallback as unknown as NodeJS.ReadStream);

    const manualInput = new FakeTtyInput(true);
    const { program } = createProgram(manualInput, WithInputTTY());
    const runPromise = awaitRun(program);

    await waitFor(() => openSpy.mock.calls.length > 0, {
      timeoutMs: 500,
      errorMessage: 'WithInputTTY never triggered openInputTTY'
    });

    program.quit();
    const result = await runPromise;
    expectGracefulExit(result);

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(program.input).toBe(fallback);
    expect(manualInput.rawModeCalls).toHaveLength(0);
    expect(fallback.rawModeCalls).toEqual([true, false]);
  });
});

const mockWindowsPlatform = () => vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');

describe('Windows virtual terminal enablement', () => {
  it('enables VT input and output when running on Windows with tty streams', async () => {
    mockWindowsPlatform();
    const enableInputSpy = vi.spyOn(ttyInternals, 'enableWindowsVirtualTerminalInput');
    const enableOutputSpy = vi.spyOn(ttyInternals, 'enableWindowsVirtualTerminalOutput');

    const input = new FakeTtyInput(false);
    const output = new FakeTtyOutput();
    const program = NewProgram(null, WithInput(input), WithOutput(output));
    const runPromise = awaitRun(program);

    await waitFor(() => enableInputSpy.mock.calls.length > 0, {
      timeoutMs: 500,
      errorMessage: 'Windows VT input enablement never triggered'
    });

    program.quit();
    const result = await runPromise;
    expectGracefulExit(result);

    expect(enableInputSpy).toHaveBeenCalledWith(input);
    expect(enableOutputSpy).toHaveBeenCalledWith(output);
  });

  it('skips VT enablement when not running on Windows', async () => {
    const enableInputSpy = vi.spyOn(ttyInternals, 'enableWindowsVirtualTerminalInput');
    const enableOutputSpy = vi.spyOn(ttyInternals, 'enableWindowsVirtualTerminalOutput');

    const input = new FakeTtyInput(false);
    const output = new FakeTtyOutput();
    const program = NewProgram(null, WithInput(input), WithOutput(output));
    const runPromise = awaitRun(program);

    program.quit();
    const result = await runPromise;
    expectGracefulExit(result);

    expect(enableInputSpy).not.toHaveBeenCalled();
    expect(enableOutputSpy).not.toHaveBeenCalled();
  });

  it('skips VT enablement when streams are not ttys even on Windows', async () => {
    mockWindowsPlatform();
    const enableInputSpy = vi.spyOn(ttyInternals, 'enableWindowsVirtualTerminalInput');
    const enableOutputSpy = vi.spyOn(ttyInternals, 'enableWindowsVirtualTerminalOutput');

    const program = NewProgram(null, WithInput(new NonTtyInput()), WithOutput(new PassThrough()));
    const runPromise = awaitRun(program);

    program.quit();
    const result = await runPromise;
    expectGracefulExit(result);

    expect(enableInputSpy).not.toHaveBeenCalled();
    expect(enableOutputSpy).not.toHaveBeenCalled();
  });
});
