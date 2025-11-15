import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import {
  Batch,
  BatchMsg,
  Cmd,
  KeyMsg,
  KeyType,
  Model,
  Msg,
  NewProgram,
  PrintLineMsg,
  Printf,
  Println,
  Program,
  ProgramKilledError,
  ProgramPanicError,
  ProgramOption,
  Quit,
  QuitMsg,
  Sequence,
  SequenceMsg,
  WithContext,
  WithFilter,
  WithInput,
  WithAltScreen,
  WithOutput,
  WithReportFocus,
  WindowSizeMsg,
  keyToString
} from '@bubbletea/tea';
import { InputReaderCanceledError } from '@bubbletea/tea/internal';

import { controllerWithTimeout, createDeferred, sleep, waitFor, withTimeout } from '../utils/async';
import { FakeTtyInput, FakeTtyOutput } from '../utils/fake-tty';
import { goChannel, goFunc, goPointer, goStruct, withPointerAddress } from '../utils/go-values';

type CtxImplodeMsg = { type: 'ctxImplode'; cancel: () => void };
type IncrementMsg = { type: 'increment' };
type PanicMsg = { type: 'panic' };
type ResumeMsg = { type: 'bubbletea/resume' };
type MsgWithType = { type?: string };

const PANIC_MSG = 'testing panic behavior';
const GOROUTINE_PANIC_MSG = 'testing goroutine panic behavior';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isQuitMsg = (msg: Msg): msg is QuitMsg =>
  isRecord(msg) && (msg as MsgWithType).type === 'bubbletea/quit';

const isKeyMsg = (msg: Msg): msg is KeyMsg =>
  isRecord(msg) && typeof (msg as KeyMsg).type === 'number';

const isWindowSizeMsg = (msg: Msg): msg is WindowSizeMsg =>
  isRecord(msg) && (msg as MsgWithType).type === 'bubbletea/window-size';

const isIncrementMsg = (msg: Msg): msg is IncrementMsg =>
  isRecord(msg) && (msg as MsgWithType).type === 'increment';

const isCtxImplodeMsg = (msg: Msg): msg is CtxImplodeMsg =>
  isRecord(msg) && (msg as MsgWithType).type === 'ctxImplode';

const isPanicMsg = (msg: Msg): msg is PanicMsg =>
  isRecord(msg) && (msg as MsgWithType).type === 'panic';

const isResumeMsg = (msg: Msg): msg is ResumeMsg =>
  isRecord(msg) && (msg as MsgWithType).type === 'bubbletea/resume';

class TestModel implements Model {
  public executed = false;
  public counter = 0;
  public lastKeyMsg?: KeyMsg;

  init(): Cmd {
    return null;
  }

  update(msg: Msg) {
    if (isCtxImplodeMsg(msg)) {
      msg.cancel();
      return [this, null] as const;
    }

    if (isIncrementMsg(msg)) {
      this.counter += 1;
      return [this, null] as const;
    }

    if (isKeyMsg(msg)) {
      this.lastKeyMsg = msg;
      return [this, Quit] as const;
    }

    if (isPanicMsg(msg)) {
      throw new Error(PANIC_MSG);
    }

    return [this, null] as const;
  }

  view(): string {
    this.executed = true;
    return 'success\n';
  }
}

const createIO = () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let outputBuffer = '';

  output.on('data', (chunk) => {
    outputBuffer += chunk.toString('utf8');
  });

  return {
    input,
    output,
    readOutput: () => outputBuffer
  };
};

const createProgram = (
  model = new TestModel(),
  ...opts: Array<ProgramOption | null | undefined>
): { program: Program; model: TestModel; input: PassThrough; output: PassThrough; readOutput: () => string } => {
  const io = createIO();
  const program = NewProgram(model, WithInput(io.input), WithOutput(io.output), ...opts);
  return {
    program,
    model,
    ...io
  };
};

const expectKilledError = (err: unknown) => {
  expect(err).toBeInstanceOf(ProgramKilledError);
};

const expectKilledWithPanic = (err: unknown) => {
  expect(err).toBeInstanceOf(ProgramKilledError);
  const panic = (err as ProgramKilledError).cause;
  expect(panic).toBeInstanceOf(ProgramPanicError);
};

const panicCmd: Cmd = () => {
  throw new Error(GOROUTINE_PANIC_MSG);
};

const incrementCmd: Cmd = () => ({ type: 'increment' });

const writeKeyToInput = (input: PassThrough, key = 'q') => {
  input.end(key);
};

const awaitRun = async (program: Program, timeoutMs = 3000) =>
  withTimeout(program.run(), timeoutMs);

const awaitStart = async (program: Program, timeoutMs = 1000) =>
  withTimeout(program.start(), timeoutMs);

const awaitWait = async (program: Program, timeoutMs = 1000) =>
  withTimeout(program.wait(), timeoutMs);

const sendMessage = async (program: Program, msg: Msg, timeoutMs = 1000) =>
  withTimeout(program.send(msg), timeoutMs);

describe('Program lifecycle (tea_test.go parity)', () => {
  it('runs the model and produces output', async () => {
    const ctx = controllerWithTimeout(3000);
    const { program, input, readOutput } = createProgram(new TestModel(), WithContext(ctx));
    writeKeyToInput(input);

    const result = await awaitRun(program);
    expect(result.err).toBeNull();
    expect(readOutput()).not.toHaveLength(0);
  });

  it('delivers KeyMsg payloads parsed from the input stream', async () => {
    const { program, model, input } = createProgram();
    const runPromise = awaitRun(program);
    input.end('q');

    const result = await runPromise;
    expect(result.err).toBeNull();
    expect(model.lastKeyMsg).toBeDefined();
    expect(model.lastKeyMsg?.type).toBe(KeyType.KeyRunes);
    expect(model.lastKeyMsg?.runes).toEqual(['q']);
    expect(keyToString(model.lastKeyMsg!)).toBe('q');
  });

  it('routes CSI arrow sequences through readAnsiInputs', async () => {
    const { program, model, input } = createProgram();
    const runPromise = awaitRun(program);
    input.end('\x1b[A');

    const result = await runPromise;
    expect(result.err).toBeNull();
    expect(model.lastKeyMsg?.type).toBe(KeyType.KeyUp);
  });

  it('preserves bracketed paste payloads from the input stream', async () => {
    const { program, model, input } = createProgram();
    const payload = 'hello world';
    const runPromise = awaitRun(program);
    input.end(`\x1b[200~${payload}\x1b[201~`);

    const result = await runPromise;
    expect(result.err).toBeNull();
    expect(model.lastKeyMsg?.type).toBe(KeyType.KeyRunes);
    expect(model.lastKeyMsg?.paste).toBe(true);
    expect(model.lastKeyMsg?.runes).toEqual(payload.split(''));
  });

  it('cancels the input reader when the program shuts down', async () => {
    const { program, input } = createProgram();
    const runPromise = awaitRun(program);
    await waitFor(() => input.listenerCount('data') > 0, { timeoutMs: 500 });

    const cancelErrors: unknown[] = [];
    input.once('error', (err) => cancelErrors.push(err));

    program.quit();

    const result = await runPromise;
    expect(result.err).toBeNull();
    await waitFor(() => cancelErrors.length === 1, { timeoutMs: 500 });
    expect(cancelErrors[0]).toBeInstanceOf(InputReaderCanceledError);
  });

  it('quits when Quit is requested', async () => {
    const { program, model } = createProgram();
    const runPromise = awaitRun(program);

    await waitFor(() => model.executed);
    program.quit();

    const result = await runPromise;
    expect(result.err).toBeNull();
  });

  it('waits for Quit via Wait()', async () => {
    const { program, model } = createProgram();
    const errPromise = awaitRun(program).then((res) => res.err);

    const progStarted = createDeferred<void>();
    const waitStarted = createDeferred<void>();

    (async () => {
      await waitFor(() => model.executed);
      progStarted.resolve();
      await waitStarted.promise;
      await sleep(50);
      program.quit();
    })();

    await progStarted.promise;
    const waiters = Array.from({ length: 5 }, () => awaitWait(program));
    waitStarted.resolve();
    await Promise.all(waiters);

    const err = await errPromise;
    expect(err).toBeNull();
  });

  it('waits for Kill via Wait()', async () => {
    const { program, model } = createProgram();
    const errPromise = awaitRun(program).then((res) => res.err);

    const progStarted = createDeferred<void>();
    const waitStarted = createDeferred<void>();

    (async () => {
      await waitFor(() => model.executed);
      progStarted.resolve();
      await waitStarted.promise;
      await sleep(50);
      program.kill();
    })();

    await progStarted.promise;
    const waiters = Array.from({ length: 5 }, () => awaitWait(program));
    waitStarted.resolve();
    await Promise.all(waiters);

    const err = await errPromise;
    expectKilledError(err);
  });

  it('supports filters preventing shutdowns', async () => {
    const preventCounts = [0, 1, 2] as const;

    for (const preventCount of preventCounts) {
      const tracker = { prevented: 0 };
      const { program } = createProgram(
        new TestModel(),
        WithFilter((_model, msg) => {
          if (!isQuitMsg(msg)) {
            return msg;
          }
          if (tracker.prevented < preventCount) {
            tracker.prevented += 1;
            return null;
          }
          return msg;
        })
      );

      await awaitStart(program);

      const quitLoop = (async () => {
        for (let attempts = 0; attempts <= preventCount; attempts += 1) {
          program.quit();
          await sleep(1);
        }
      })();

      const err = await awaitWait(program).then(() => null).catch((error) => error);
      await quitLoop;

      expect(err).toBeNull();
      expect(tracker.prevented).toBe(preventCount);
    }
  });

  it('kills the program without leaking internal context state', async () => {
    const { program, model } = createProgram();
    const errPromise = awaitRun(program).then((res) => res.err);

    (async () => {
      await waitFor(() => model.executed);
      program.kill();
    })();

    const err = await errPromise;
    expectKilledError(err);
    expect((err as ProgramKilledError).cause).toBeUndefined();
  });

  it('propagates external context cancellations', async () => {
    const controller = new AbortController();
    const contextErr = new Error('context canceled');
    const { program, model } = createProgram(new TestModel(), WithContext(controller));
    const errPromise = awaitRun(program).then((res) => res.err);

    (async () => {
      await waitFor(() => model.executed);
      controller.abort(contextErr);
    })();

    const err = await errPromise;
    expectKilledError(err);
    expect((err as ProgramKilledError).cause).toBe(contextErr);
  });

  it('avoids deadlocks when cancellation occurs inside update', async () => {
    const controller = new AbortController();
    const { program, model } = createProgram(new TestModel(), WithContext(controller));
    const errPromise = awaitRun(program).then((res) => res.err);

    (async () => {
      await waitFor(() => model.executed);
      await sendMessage(program, { type: 'ctxImplode', cancel: () => controller.abort() });
    })();

    const err = await errPromise;
    expectKilledError(err);
  });

  it('avoids deadlocks when cancellation occurs inside a BatchMsg', async () => {
    const controller = new AbortController();
    const { program, model } = createProgram(new TestModel(), WithContext(controller));
    const errPromise = awaitRun(program).then((res) => res.err);

    (async () => {
      await waitFor(() => model.executed);
      const batch: BatchMsg = Array.from({ length: 100 }, () => () => {
        controller.abort();
        return { type: 'increment' };
      });
      await sendMessage(program, batch);
    })();

    const err = await errPromise;
    expectKilledError(err);
  });

  it('processes BatchMsg payloads', async () => {
    const { program, model } = createProgram();
    const runPromise = awaitRun(program);

    (async () => {
      const batch: BatchMsg = [incrementCmd, incrementCmd];
      await sendMessage(program, batch);
      await waitFor(() => model.counter >= 2);
      program.quit();
    })();

    const result = await runPromise;
    expect(result.err).toBeNull();
    expect(model.counter).toBe(2);
  });

  it('processes SequenceMsg payloads', async () => {
    const { program, model } = createProgram();
    const runPromise = awaitRun(program);

    (async () => {
      const seq: SequenceMsg = [incrementCmd, incrementCmd, Quit];
      await sendMessage(program, seq);
    })();

    const result = await runPromise;
    expect(result.err).toBeNull();
    expect(model.counter).toBe(2);
  });

  it('handles SequenceMsg that emits BatchMsg entries', async () => {
    const { program, model } = createProgram();
    const runPromise = awaitRun(program);

    const batchCmd: Cmd = () => [incrementCmd, incrementCmd];

    (async () => {
      const seq: SequenceMsg = [batchCmd, incrementCmd, Quit];
      await sendMessage(program, seq);
    })();

    const result = await runPromise;
    expect(result.err).toBeNull();
    expect(model.counter).toBe(3);
  });

  it('handles nested Sequence/Batches', async () => {
    const { program, model } = createProgram();
    const runPromise = awaitRun(program);

    (async () => {
      const seq: SequenceMsg = [
        incrementCmd,
        Sequence(incrementCmd, incrementCmd, Batch(incrementCmd, incrementCmd)),
        Quit
      ];
      await sendMessage(program, seq);
    })();

    const result = await runPromise;
    expect(result.err).toBeNull();
    expect(model.counter).toBe(5);
  });

  it('blocks sends before start and no-ops after shutdown', async () => {
    const { program } = createProgram();
    const sendPromise = sendMessage(program, Quit());
    await awaitRun(program);
    await sendPromise;
    await sendMessage(program, Quit());
  });

  it('allows creating a program without running it', () => {
    const { program } = createProgram();
    expect(program).toBeInstanceOf(Program);
  });

  it('reports panics triggered inside update handlers', async () => {
    const { program, model } = createProgram();
    const errPromise = awaitRun(program).then((res) => res.err);

    (async () => {
      await waitFor(() => model.executed);
      await sendMessage(program, { type: 'panic' });
    })();

    const err = await errPromise;
    expectKilledWithPanic(err);
  });

  it('reports panics triggered inside commands', async () => {
    const { program, model } = createProgram();
    const errPromise = awaitRun(program).then((res) => res.err);

    (async () => {
      await waitFor(() => model.executed);
      const cmds: BatchMsg = Array.from({ length: 10 }, (_, idx) =>
        idx % 2 === 0 ? Sequence(panicCmd) : Batch(panicCmd)
      );
      await sendMessage(program, cmds);
    })();

    const err = await errPromise;
    expectKilledWithPanic(err);
  });

  it('flushes Println commands sent through program.send()', async () => {
    const { program, model, readOutput } = createProgram();
    const runPromise = awaitRun(program);

    await waitFor(() => model.executed);

    const printCmd = Println('queued-one\nqueued-two');
    const msg = (await printCmd?.()) as Msg | null | undefined;
    expect(msg).toBeTruthy();
    await sendMessage(program, msg as Msg);

    await waitFor(() => readOutput().includes('queued-two'));
    program.quit();

    const result = await runPromise;
    expect(result.err).toBeNull();

    const output = readOutput();
    expect(output).toContain('queued-one\r\nqueued-two');
    const printIdx = output.indexOf('queued-one');
    const viewIdx = output.indexOf('success');
    expect(printIdx).toBeGreaterThanOrEqual(0);
    expect(viewIdx).toBeGreaterThanOrEqual(0);
    expect(printIdx).toBeLessThan(viewIdx);
  });

  it('flushes Printf commands sent through program.send()', async () => {
    const { program, model, readOutput } = createProgram();
    const runPromise = awaitRun(program);

    await waitFor(() => model.executed);

    const printfCmd = Printf('milliseconds: %03d', 7);
    const msg = (await printfCmd?.()) as Msg | null | undefined;
    expect(msg).toBeTruthy();
    await sendMessage(program, msg as Msg);

    await waitFor(() => readOutput().includes('milliseconds: 007'));
    program.quit();

    const result = await runPromise;
    expect(result.err).toBeNull();

    const output = readOutput();
    expect(output).toContain('milliseconds: 007');
    const printIdx = output.indexOf('milliseconds: 007');
    const viewIdx = output.indexOf('success');
    expect(printIdx).toBeGreaterThanOrEqual(0);
    expect(viewIdx).toBeGreaterThanOrEqual(0);
    expect(printIdx).toBeLessThan(viewIdx);
  });

  it('flushes program.println output before the next view', async () => {
    const { program, model, readOutput } = createProgram();
    const runPromise = awaitRun(program);

    await waitFor(() => model.executed);
    program.println('queued-one\nqueued-two');

    await waitFor(() => readOutput().includes('queued-two'));
    program.quit();

    const result = await runPromise;
    expect(result.err).toBeNull();

    const output = readOutput();
    expect(output).toContain('queued-one\r\nqueued-two');
    const printIdx = output.indexOf('queued-one');
    const viewIdx = output.indexOf('success');
    expect(printIdx).toBeGreaterThanOrEqual(0);
    expect(viewIdx).toBeGreaterThanOrEqual(0);
    expect(printIdx).toBeLessThan(viewIdx);
  });

  it('flushes program.printf output before the next view', async () => {
    const { program, model, readOutput } = createProgram();
    const runPromise = awaitRun(program);

    await waitFor(() => model.executed);
    program.printf('milliseconds: %03d', 7);

    await waitFor(() => readOutput().includes('milliseconds: 007'));
    program.quit();

    const result = await runPromise;
    expect(result.err).toBeNull();

    const output = readOutput();
    expect(output).toContain('milliseconds: 007');
    const printIdx = output.indexOf('milliseconds: 007');
    const viewIdx = output.indexOf('success');
    expect(printIdx).toBeGreaterThanOrEqual(0);
    expect(viewIdx).toBeGreaterThanOrEqual(0);
    expect(printIdx).toBeLessThan(viewIdx);
  });


  describe('releaseTerminal / restoreTerminal', () => {
    it('releases and restores the tty/renderer state without stopping the program', async () => {
      const input = new FakeTtyInput(false);
      const output = new FakeTtyOutput();
      const { program } = createProgram(
        new TestModel(),
        WithInput(input),
        WithOutput(output),
        WithAltScreen(),
        WithReportFocus()
      );

      const startSpy = vi.spyOn(program.renderer, 'start');
      const stopSpy = vi.spyOn(program.renderer, 'stop');
      const runPromise = awaitRun(program);

      await waitFor(() => input.rawModeCalls.includes(true), {
        timeoutMs: 500,
        errorMessage: 'program never entered raw mode'
      });
      await waitFor(() => program.renderer.altScreen(), {
        timeoutMs: 500,
        errorMessage: 'renderer never entered alt screen'
      });
      await waitFor(() => program.renderer.reportFocus(), {
        timeoutMs: 500,
        errorMessage: 'renderer never enabled focus reporting'
      });

      const initialStartCalls = startSpy.mock.calls.length;

      program.releaseTerminal();

      expect(stopSpy).toHaveBeenCalledTimes(1);
      expect(program.ignoreSignals).toBe(true);
      expect(program.renderer.altScreen()).toBe(false);
      expect(program.renderer.bracketedPasteActive()).toBe(false);
      expect(program.renderer.reportFocus()).toBe(false);
      expect(input.rawModeCalls.at(-1)).toBe(false);

      program.restoreTerminal();

      await waitFor(() => input.rawModeCalls.at(-1) === true, {
        timeoutMs: 500,
        errorMessage: 'raw mode was not re-enabled after restore'
      });

      expect(program.ignoreSignals).toBe(false);
      expect(program.renderer.altScreen()).toBe(true);
      expect(program.renderer.bracketedPasteActive()).toBe(true);
      expect(program.renderer.reportFocus()).toBe(true);
      expect(startSpy.mock.calls.length).toBe(initialStartCalls + 1);

      input.end('q');
      const result = await runPromise;
      expect(result.err).toBeNull();
    });

    it('keeps disabled renderer modes off and resumes the input reader after restoring the terminal', async () => {
      const input = new FakeTtyInput(false);
      const output = new FakeTtyOutput();
      const { program } = createProgram(new TestModel(), WithInput(input), WithOutput(output));
      const runPromise = awaitRun(program);

      await waitFor(() => input.rawModeCalls.includes(true), {
        timeoutMs: 500,
        errorMessage: 'program never entered raw mode'
      });
      await waitFor(() => input.listenerCount('data') > 0, {
        timeoutMs: 500,
        errorMessage: 'input listeners were never attached'
      });

      await sendMessage(program, { type: 'bubbletea/disable-bracketed-paste' });
      await sendMessage(program, { type: 'bubbletea/enable-report-focus' });
      await waitFor(() => program.renderer.reportFocus(), {
        timeoutMs: 500,
        errorMessage: 'focus reporting never enabled'
      });
      await sendMessage(program, { type: 'bubbletea/disable-report-focus' });
      await waitFor(() => !program.renderer.reportFocus(), {
        timeoutMs: 500,
        errorMessage: 'focus reporting never disabled'
      });

      program.releaseTerminal();

      await waitFor(() => input.listenerCount('data') === 0, {
        timeoutMs: 500,
        errorMessage: 'input listeners were not removed when releasing the terminal'
      });
      expect(program.renderer.bracketedPasteActive()).toBe(false);
      expect(program.renderer.reportFocus()).toBe(false);

      program.restoreTerminal();

      await waitFor(() => input.listenerCount('data') > 0, {
        timeoutMs: 500,
        errorMessage: 'input listeners were not reattached after restoring the terminal'
      });
      expect(program.renderer.bracketedPasteActive()).toBe(false);
      expect(program.renderer.reportFocus()).toBe(false);

      input.end('q');
      const result = await runPromise;
      expect(result.err).toBeNull();
    });

    it('re-emits the latest window size when the terminal changes while released', async () => {
      class WindowSizeModel implements Model {
        public windowSizes: Array<{ width: number; height: number }> = [];

        init(): Cmd {
          return null;
        }

        update(msg: Msg) {
          if (isWindowSizeMsg(msg)) {
            this.windowSizes.push({ width: msg.width, height: msg.height });
            return [this, null] as const;
          }
          if (isKeyMsg(msg) && keyToString(msg) === 'q') {
            return [this, Quit] as const;
          }
          return [this, null] as const;
        }

        view(): string {
          return 'window-size-test\n';
        }
      }

      const input = new FakeTtyInput(false);
      const output = new FakeTtyOutput();
      output.columns = 90;
      output.rows = 20;
      const model = new WindowSizeModel();
      const { program } = createProgram(model, WithInput(input), WithOutput(output));
      const runPromise = awaitRun(program);

      await waitFor(() => input.rawModeCalls.includes(true), {
        timeoutMs: 500,
        errorMessage: 'program never entered raw mode'
      });
      await waitFor(() => model.windowSizes.length > 0, {
        timeoutMs: 500,
        errorMessage: 'initial window size was never emitted'
      });

      program.releaseTerminal();
      model.windowSizes = [];

      const width = 132;
      const height = 40;
      output.columns = width;
      output.rows = height;

      program.restoreTerminal();

      await waitFor(
        () => model.windowSizes.some((entry) => entry.width === width && entry.height === height),
        {
          timeoutMs: 500,
          errorMessage: 'window size change was not emitted after restoring the terminal'
        }
      );

      input.end('q');
      const result = await runPromise;
      expect(result.err).toBeNull();
    });
  });

});
