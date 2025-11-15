import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';

import {
  Model,
  Msg,
  NewProgram,
  Program,
  ProgramInterruptedError,
  ProgramKilledError,
  ProgramOption,
  WithContext,
  WithInput,
  WithOutput,
  WithSignalSource,
  WithoutSignalHandler,
  WithoutSignals
} from '@bubbletea/tea';

import { sleep, waitFor, withTimeout } from '../utils/async';
import { FakeProcessSignals } from '../utils/fake-process-signals';

class SignalTestModel implements Model {
  init() {
    return null;
  }

  update(msg: Msg) {
    void msg;
    return [this, null] as const;
  }

  view(): string {
    return '';
  }
}

const awaitRun = (program: Program, timeoutMs = 3000) => withTimeout(program.run(), timeoutMs);

const createSignalProgram = (...options: ProgramOption[]) => {
  const input = new PassThrough();
  const output = new PassThrough();
  const fakeSignals = new FakeProcessSignals();
  const model = new SignalTestModel();
  const program = NewProgram(
    model,
    WithInput(input),
    WithOutput(output),
    WithSignalSource(fakeSignals),
    ...options
  );
  return { program, fakeSignals, input, output };
};

describe('signal handling', () => {
  it('exits with ProgramInterruptedError when SIGINT is received', async () => {
    const { program, fakeSignals } = createSignalProgram();
    const runPromise = awaitRun(program);

    await waitFor(() => fakeSignals.listenerCount('SIGINT') > 0);
    fakeSignals.emit('SIGINT');

    const result = await runPromise;
    expect(result.err).toBeInstanceOf(ProgramInterruptedError);
  });

  it('quits gracefully when SIGTERM is received', async () => {
    const { program, fakeSignals } = createSignalProgram();
    const runPromise = awaitRun(program);

    await waitFor(() => fakeSignals.listenerCount('SIGTERM') > 0);
    fakeSignals.emit('SIGTERM');

    const result = await runPromise;
    expect(result.err).toBeNull();
  });

  it('ignores signals while the terminal is released', async () => {
    const { program, fakeSignals } = createSignalProgram();
    const runPromise = awaitRun(program);

    await waitFor(() => fakeSignals.listenerCount('SIGINT') > 0);

    program.releaseTerminal();
    expect(program.ignoreSignals).toBe(true);

    fakeSignals.emit('SIGINT');

    await expect(
      withTimeout(runPromise, 200, 'program should remain running while suspended')
    ).rejects.toThrow('program should remain running while suspended');

    program.restoreTerminal();
    program.quit();
    const result = await runPromise;
    expect(result.err).toBeNull();
  });

  it('respects the WithoutSignals option', async () => {
    const { program, fakeSignals } = createSignalProgram(WithoutSignals());
    const runPromise = awaitRun(program);

    expect(program.ignoreSignals).toBe(true);
    await waitFor(() => fakeSignals.listenerCount('SIGINT') > 0);

    fakeSignals.emit('SIGINT');
    await expect(
      withTimeout(runPromise, 200, 'program should still be running when signals are ignored')
    ).rejects.toThrow('program should still be running when signals are ignored');

    program.quit();
    const result = await runPromise;
    expect(result.err).toBeNull();
  });

  it('does not attach handlers when WithoutSignalHandler is provided', async () => {
    const { program, fakeSignals } = createSignalProgram(WithoutSignalHandler());
    const runPromise = awaitRun(program);

    await sleep(20);
    expect(fakeSignals.listenerCount('SIGINT')).toBe(0);
    expect(fakeSignals.listenerCount('SIGTERM')).toBe(0);

    fakeSignals.emit('SIGINT');
    await expect(
      withTimeout(runPromise, 200, 'program should remain running without handlers')
    ).rejects.toThrow('program should remain running without handlers');

    program.quit();
    const result = await runPromise;
    expect(result.err).toBeNull();
  });

  it('removes signal listeners once the program stops', async () => {
    const { program, fakeSignals } = createSignalProgram();
    const runPromise = awaitRun(program);

    await waitFor(() => fakeSignals.listenerCount('SIGINT') > 0);
    await waitFor(() => fakeSignals.listenerCount('SIGTERM') > 0);

    program.quit();
    const result = await runPromise;
    expect(result.err).toBeNull();
    expect(fakeSignals.listenerCount('SIGINT')).toBe(0);
    expect(fakeSignals.listenerCount('SIGTERM')).toBe(0);
  });

  it('cleans up listeners when an external context cancels the program', async () => {
    const external = new AbortController();
    const { program, fakeSignals } = createSignalProgram(WithContext(external));
    const runPromise = awaitRun(program);

    await waitFor(() => fakeSignals.listenerCount('SIGINT') > 0);
    external.abort(new Error('context canceled'));

    const result = await runPromise;
    expect(result.err).toBeInstanceOf(ProgramKilledError);
    expect(fakeSignals.listenerCount('SIGINT')).toBe(0);
    expect(fakeSignals.listenerCount('SIGTERM')).toBe(0);
  });

  it('allows WithoutSignalHandler to coexist with custom signal sources and external contexts', async () => {
    const external = new AbortController();
    const { program, fakeSignals } = createSignalProgram(WithContext(external), WithoutSignalHandler());
    const runPromise = awaitRun(program);

    await sleep(20);
    expect(fakeSignals.listenerCount('SIGINT')).toBe(0);
    expect(fakeSignals.listenerCount('SIGTERM')).toBe(0);

    external.abort(new Error('context canceled'));

    const result = await runPromise;
    expect(result.err).toBeInstanceOf(ProgramKilledError);
    expect(fakeSignals.listenerCount('SIGINT')).toBe(0);
    expect(fakeSignals.listenerCount('SIGTERM')).toBe(0);
  });
});
