import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  NewProgram,
  Program,
  ProgramKilledError,
  ProgramOption,
  ProgramPanicError,
  WithInput,
  WithInputTTY,
  WithOutput,
  WithoutRenderer
} from '@bubbletea/tea';
import * as ttyInternals from '@bubbletea/tea/internal';

import { waitFor, withTimeout } from '../utils/async';
import { FakeTtyInput, FakeTtyOutput, NonTtyInput } from '../utils/fake-tty';

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

const expectKilledWithPanic = (err: unknown) => {
  expect(err).toBeInstanceOf(ProgramKilledError);
  const panic = (err as ProgramKilledError).cause;
  expect(panic).toBeInstanceOf(ProgramPanicError);
  return panic as ProgramPanicError;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('setupTerminalInput (tty_raw_mode_test.go)', () => {
  it('TestTTYRawModeEnablesAndRestores - enables raw mode on tty inputs and restores the original state on shutdown', async () => {
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

  it('TestTTYRawModeRestoresInitialState - restores tty inputs to their prior raw-mode state when exiting', async () => {
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

  it('TestTTYRawModeSkipsNonTTYInputs - does not touch raw mode when the input stream is not a tty', async () => {
    const input = new NonTtyInput();
    const { program } = createProgram(input);
    const runPromise = awaitRun(program);

    program.quit();
    const result = await runPromise;
    expectGracefulExit(result);

    expect(input.rawModeCalls).toHaveLength(0);
  });

  it('TestTTYRawModeSkipsWhenRendererDisabled - skips raw-mode toggles entirely when rendering is disabled', async () => {
    const input = new FakeTtyInput();
    const { program } = createProgram(input, WithoutRenderer());
    const runPromise = awaitRun(program);

    program.quit();
    const result = await runPromise;
    expectGracefulExit(result);

    expect(input.rawModeCalls).toHaveLength(0);
  });

  it('TestTTYRawModeFailuresSurfaceAsProgramPanic - surfaces raw-mode enable failures as program panics', async () => {
    const failure = new Error('raw-mode failed');
    const input = new FakeTtyInput(false, {
      beforeSetRawMode: (next) => (next ? failure : null)
    });
    const { program } = createProgram(input);

    const err = await awaitRun(program).then((res) => res.err);
    const panic = expectKilledWithPanic(err);
    expect(panic.cause).toBe(failure);
    expect(input.rawModeCalls).toEqual([true]);
  });
});

describe('resolveInputSource (tty_raw_mode_test.go)', () => {
  it('TestTTYInputFallbackOpensNewTTY - opens a dedicated tty when the default input is not a tty', async () => {
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

  it('TestTTYInputForcedFallbackIgnoresExistingTTY - forces a new tty when WithInputTTY is provided', async () => {
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

  it('TestTTYInputFallbackErrorsSurfaceAsProgramPanic - surfaces fallback tty open errors as program panics when default input is not a tty', async () => {
    const openError = new Error('fallback failed');
    const openSpy = vi.spyOn(ttyInternals, 'openInputTTY').mockImplementation(() => {
      throw openError;
    });

    const { program } = createDefaultInputProgram(new NonTtyInput());
    const err = await awaitRun(program).then((res) => res.err);

    expect(openSpy).toHaveBeenCalledTimes(1);
    const panic = expectKilledWithPanic(err);
    expect(panic.cause).toBe(openError);
  });

  it('TS-specific - surfaces fallback tty open errors as program panics when WithInputTTY is set', async () => {
    const openError = new Error('forced open failed');
    const openSpy = vi.spyOn(ttyInternals, 'openInputTTY').mockImplementation(() => {
      throw openError;
    });

    const manualInput = new FakeTtyInput(true);
    const { program } = createProgram(manualInput, WithInputTTY());
    const err = await awaitRun(program).then((res) => res.err);

    expect(openSpy).toHaveBeenCalledTimes(1);
    const panic = expectKilledWithPanic(err);
    expect(panic.cause).toBe(openError);
    expect(manualInput.rawModeCalls).toHaveLength(0);
  });
});

describe('releaseTerminal / restoreTerminal (tty_raw_mode_test.go::TestReleaseTerminalTogglesIgnoreSignals)', () => {
  it('toggles ignoreSignals while keeping the program running', async () => {
    const input = new FakeTtyInput(false);
    const { program } = createProgram(input, WithoutRenderer());
    const runPromise = awaitRun(program);

    const stateRef = program as unknown as { state: string };
    await waitFor(() => stateRef.state === 'running', {
      timeoutMs: 500,
      errorMessage: 'program never transitioned to running'
    });

    expect(program.ignoreSignals).toBe(false);

    program.releaseTerminal();
    expect(program.ignoreSignals).toBe(true);

    program.restoreTerminal();
    expect(program.ignoreSignals).toBe(false);

    program.quit();
    const result = await runPromise;
    expectGracefulExit(result);
  });
});
