import { describe, expect, it, vi } from 'vitest';

import {
  Cmd,
  KeyMsg,
  Model,
  Msg,
  NewProgram,
  Program,
  Quit,
  WindowSizeMsg,
  WithAltScreen,
  WithInput,
  WithOutput,
  WithReportFocus,
  keyToString
} from '@bubbletea/tea';

import { createDeferred, waitFor, withTimeout } from '../utils/async';
import { FakeTtyInput, FakeTtyOutput } from '../utils/fake-tty';

type ResumeMsg = { type: 'bubbletea/resume' };

type SimpleRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is SimpleRecord =>
  typeof value === 'object' && value !== null;

const isKeyMsg = (msg: Msg): msg is KeyMsg =>
  isRecord(msg) && typeof (msg as KeyMsg).type === 'number';

const isResumeMsg = (msg: Msg): msg is ResumeMsg =>
  isRecord(msg) && (msg as ResumeMsg).type === 'bubbletea/resume';

const isWindowSizeMsg = (msg: Msg): msg is WindowSizeMsg =>
  isRecord(msg) && (msg as WindowSizeMsg).type === 'bubbletea/window-size';

const awaitRun = (program: Program, timeoutMs = 3000) => withTimeout(program.run(), timeoutMs);

const sendMessage = (program: Program, msg: Msg, timeoutMs = 1000) =>
  withTimeout(program.send(msg), timeoutMs);

class SuspendResumeModel implements Model {
  public resumeCount = 0;

  init(): Cmd {
    return null;
  }

  update(msg: Msg) {
    if (isResumeMsg(msg)) {
      this.resumeCount += 1;
      return [this, null] as const;
    }
    if (isKeyMsg(msg) && keyToString(msg) === 'q') {
      return [this, Quit] as const;
    }
    return [this, null] as const;
  }

  view(): string {
    return 'suspend-resume-test\n';
  }
}

class SuspendResumeWindowSizeModel extends SuspendResumeModel {
  public readonly windowSizes: Array<{ width: number; height: number }> = [];

  override update(msg: Msg) {
    if (isWindowSizeMsg(msg)) {
      this.windowSizes.push({ width: msg.width, height: msg.height });
    }
    return super.update(msg);
  }
}

describe('Program suspend / resume (suspend_unix_test.go parity)', () => {
  it('releases the terminal while suspended and restores it before emitting ResumeMsg', async () => {
    const input = new FakeTtyInput(false);
    const output = new FakeTtyOutput();
    const model = new SuspendResumeModel();
    const program = NewProgram(
      model,
      WithInput(input),
      WithOutput(output),
      WithAltScreen(),
      WithReportFocus()
    );
    const runPromise = awaitRun(program);

    await waitFor(() => input.rawModeCalls.includes(true), {
      timeoutMs: 500,
      errorMessage: 'program never entered raw mode'
    });
    await waitFor(() => input.listenerCount('data') > 0, {
      timeoutMs: 500,
      errorMessage: 'input listeners were not attached before suspending'
    });
    await waitFor(() => program.renderer.altScreen(), {
      timeoutMs: 500,
      errorMessage: 'alt screen never activated before suspending'
    });
    await waitFor(() => program.renderer.reportFocus(), {
      timeoutMs: 500,
      errorMessage: 'focus reporting never enabled before suspending'
    });

    const suspendDeferred = createDeferred<void>();
    const programWithSuspend = program as Program & { suspendProcess(): Promise<void> };
    const suspendProcessSpy = vi.fn(async () => {
      await suspendDeferred.promise;
    });
    programWithSuspend.suspendProcess = suspendProcessSpy;

    const stopSpy = vi.spyOn(program.renderer, 'stop');
    const startSpy = vi.spyOn(program.renderer, 'start');
    const initialStartCalls = startSpy.mock.calls.length;
    const initialStopCalls = stopSpy.mock.calls.length;

    await sendMessage(program, { type: 'bubbletea/suspend' });

    await waitFor(() => input.rawModeCalls.at(-1) === false, {
      timeoutMs: 500,
      errorMessage: 'raw mode was not disabled while suspended'
    });
    await waitFor(() => input.listenerCount('data') === 0, {
      timeoutMs: 500,
      errorMessage: 'input listeners were not removed while suspended'
    });

    expect(program.ignoreSignals).toBe(true);
    expect(program.renderer.altScreen()).toBe(false);
    expect(program.renderer.reportFocus()).toBe(false);
    expect(stopSpy.mock.calls.length).toBe(initialStopCalls + 1);
    expect(suspendProcessSpy).toHaveBeenCalledTimes(1);
    expect(model.resumeCount).toBe(0);

    suspendDeferred.resolve();

    await waitFor(() => input.listenerCount('data') > 0, {
      timeoutMs: 500,
      errorMessage: 'input listeners were not restored after resuming'
    });
    await waitFor(() => input.rawModeCalls.at(-1) === true, {
      timeoutMs: 500,
      errorMessage: 'raw mode was not restored after resuming'
    });
    await waitFor(() => program.renderer.altScreen(), {
      timeoutMs: 500,
      errorMessage: 'alt screen was not re-enabled after resuming'
    });
    await waitFor(() => program.renderer.reportFocus(), {
      timeoutMs: 500,
      errorMessage: 'focus reporting was not re-enabled after resuming'
    });
    await waitFor(() => model.resumeCount === 1, {
      timeoutMs: 500,
      errorMessage: 'ResumeMsg was not emitted after suspension completed'
    });

    expect(program.ignoreSignals).toBe(false);
    expect(startSpy.mock.calls.length).toBe(initialStartCalls + 1);

    input.end('q');
    const result = await runPromise;
    expect(result.err).toBeNull();
  });

  it('emits a ResumeMsg for each suspend / resume cycle', async () => {
    const input = new FakeTtyInput(false);
    const output = new FakeTtyOutput();
    const model = new SuspendResumeModel();
    const program = NewProgram(model, WithInput(input), WithOutput(output), WithAltScreen());
    const runPromise = awaitRun(program);

    await waitFor(() => input.rawModeCalls.includes(true), {
      timeoutMs: 500,
      errorMessage: 'program never entered raw mode'
    });

    const suspendResolvers: Array<() => void> = [];
    const programWithSuspend = program as Program & { suspendProcess(): Promise<void> };
    const suspendProcessSpy = vi.fn(() => {
      const deferred = createDeferred<void>();
      suspendResolvers.push(() => deferred.resolve());
      return deferred.promise;
    });
    programWithSuspend.suspendProcess = suspendProcessSpy;

    const runCycle = async (expectedResumeCount: number) => {
      await sendMessage(program, { type: 'bubbletea/suspend' });
      await waitFor(() => input.rawModeCalls.at(-1) === false, {
        timeoutMs: 500,
        errorMessage: 'raw mode was not disabled during suspend'
      });
      expect(program.ignoreSignals).toBe(true);
      const resolver = suspendResolvers.shift();
      expect(resolver).toBeDefined();
      resolver?.();
      await waitFor(() => input.rawModeCalls.at(-1) === true, {
        timeoutMs: 500,
        errorMessage: 'raw mode was not restored after suspend'
      });
      await waitFor(() => model.resumeCount === expectedResumeCount, {
        timeoutMs: 500,
        errorMessage: `ResumeMsg #${expectedResumeCount} was not emitted`
      });
      expect(program.ignoreSignals).toBe(false);
    };

    await runCycle(1);
    await runCycle(2);

    input.end('q');
    const result = await runPromise;
    expect(result.err).toBeNull();
    expect(suspendProcessSpy).toHaveBeenCalledTimes(2);
  });

  it('emits a WindowSizeMsg after resuming when the terminal size changed while suspended', async () => {
    const input = new FakeTtyInput(false);
    const output = new FakeTtyOutput();
    output.columns = 90;
    output.rows = 30;
    const model = new SuspendResumeWindowSizeModel();
    const program = NewProgram(
      model,
      WithInput(input),
      WithOutput(output),
      WithAltScreen(),
      WithReportFocus()
    );
    const runPromise = awaitRun(program);

    await waitFor(() => model.windowSizes.length >= 1, {
      timeoutMs: 500,
      errorMessage: 'initial WindowSizeMsg never arrived'
    });

    const suspendDeferred = createDeferred<void>();
    const programWithSuspend = program as Program & { suspendProcess(): Promise<void> };
    programWithSuspend.suspendProcess = vi.fn(() => suspendDeferred.promise);

    await sendMessage(program, { type: 'bubbletea/suspend' });

    await waitFor(() => input.rawModeCalls.at(-1) === false, {
      timeoutMs: 500,
      errorMessage: 'raw mode was not disabled during suspend'
    });

    output.columns = 140;
    output.rows = 51;

    suspendDeferred.resolve();

    await waitFor(() => input.rawModeCalls.at(-1) === true, {
      timeoutMs: 500,
      errorMessage: 'raw mode was not restored after resume'
    });
    await waitFor(() => model.resumeCount === 1, {
      timeoutMs: 500,
      errorMessage: 'ResumeMsg was not emitted after resuming'
    });

    await waitFor(() => model.windowSizes.length >= 2, {
      timeoutMs: 500,
      errorMessage: 'WindowSizeMsg was not emitted after resuming'
    });

    const [, resized] = model.windowSizes;
    expect(resized).toEqual({ width: 140, height: 51 });

    input.end('q');
    const result = await runPromise;
    expect(result.err).toBeNull();
  });
});
