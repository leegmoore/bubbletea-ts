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
  keyToString
} from '@bubbletea/tea';
import { InputReaderCanceledError } from '@bubbletea/tea/internal';

import { controllerWithTimeout, createDeferred, sleep, waitFor, withTimeout } from '../utils/async';
import { FakeTtyInput, FakeTtyOutput } from '../utils/fake-tty';

type CtxImplodeMsg = { type: 'ctxImplode'; cancel: () => void };
type IncrementMsg = { type: 'increment' };
type PanicMsg = { type: 'panic' };
type MsgWithType = { type?: string };

const PANIC_MSG = 'testing panic behavior';
const GOROUTINE_PANIC_MSG = 'testing goroutine panic behavior';

const GO_TYPE_SYMBOL = Symbol.for('bubbletea.goType');
const GO_POINTER_SYMBOL = Symbol.for('bubbletea.goPointer');
const GO_POINTER_ADDRESS_SYMBOL = Symbol.for('bubbletea.goPointerAddress');
const GO_CHANNEL_SYMBOL = Symbol.for('bubbletea.goChannel');

const goStruct = <T extends Record<string, unknown>>(typeName: string, fields: T): T =>
  Object.defineProperty(fields, GO_TYPE_SYMBOL, { value: typeName, enumerable: false });

const goPointer = <T>(value: T, address?: number) => {
  const pointer = Object.defineProperty({}, GO_POINTER_SYMBOL, { value, enumerable: false });
  if (typeof address === 'number') {
    Object.defineProperty(pointer, GO_POINTER_ADDRESS_SYMBOL, { value: address, enumerable: false });
  }
  return pointer;
};

const goFunc = <T extends (...args: unknown[]) => unknown>(
  fn: T,
  typeName: string,
  address: number
): T => {
  Object.defineProperty(fn, GO_TYPE_SYMBOL, { value: typeName, enumerable: false });
  return withPointerAddress(fn, address);
};

const goChannel = (typeName: string, address: number) => {
  const chan = Object.create(null);
  Object.defineProperty(chan, GO_TYPE_SYMBOL, { value: typeName, enumerable: false });
  Object.defineProperty(chan, GO_CHANNEL_SYMBOL, { value: true, enumerable: false });
  Object.defineProperty(chan, GO_POINTER_ADDRESS_SYMBOL, { value: address, enumerable: false });
  return chan;
};

const withPointerAddress = <T extends object>(value: T, address: number): T => {
  Object.defineProperty(value, GO_POINTER_ADDRESS_SYMBOL, { value: address, enumerable: false });
  return value;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isQuitMsg = (msg: Msg): msg is QuitMsg =>
  isRecord(msg) && (msg as MsgWithType).type === 'bubbletea/quit';

const isKeyMsg = (msg: Msg): msg is KeyMsg =>
  isRecord(msg) && typeof (msg as KeyMsg).type === 'number';

const isIncrementMsg = (msg: Msg): msg is IncrementMsg =>
  isRecord(msg) && (msg as MsgWithType).type === 'increment';

const isCtxImplodeMsg = (msg: Msg): msg is CtxImplodeMsg =>
  isRecord(msg) && (msg as MsgWithType).type === 'ctxImplode';

const isPanicMsg = (msg: Msg): msg is PanicMsg =>
  isRecord(msg) && (msg as MsgWithType).type === 'panic';

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

  describe('Printf formatting parity', () => {
    const formattingCases = [
      {
        name: 'hex with alternate + zero padding',
        template: 'hex padded: %#08x',
        args: [48879],
        expected: 'hex padded: 0x0000beef'
      },
      {
        name: 'left-aligned string',
        template: 'left aligned: |%-8s|',
        args: ['tea'],
        expected: 'left aligned: |tea     |'
      },
      {
        name: 'string precision',
        template: 'precision: %.5s',
        args: ['bubbletea'],
        expected: 'precision: bubbl'
      },
      {
        name: 'float with sign/zero padding',
        template: 'float: %+08.2f',
        args: [3.5],
        expected: 'float: +0003.50'
      },
      {
        name: 'dynamic width/precision',
        template: 'dynamic: %*.*f',
        args: [8, 3, 1.25],
        expected: 'dynamic:    1.250'
      },
      {
        name: 'quoted string',
        template: 'quoted: %q',
        args: ['tea & crumpets'],
        expected: 'quoted: "tea & crumpets"'
      },
      {
        name: 'percent literal',
        template: 'percent: %d%%',
        args: [42],
        expected: 'percent: 42%'
      },
      {
        name: 'bool conversion',
        template: 'bool: %t',
        args: [false],
        expected: 'bool: false'
      },
      {
        name: 'rich slice %#v',
        template: 'slice: %#v',
        args: [['tea', 'milk']],
        expected: 'slice: []string{"tea", "milk"}'
      },
      {
        name: 'pointer literal',
        template: 'pointer: %p',
        args: [0xdeadbeef],
        expected: 'pointer: 0xdeadbeef'
      },
      {
        name: 'pointer slice %#v',
        template: 'pointer slice: %#v',
        args: [
          [
            goPointer(goStruct('tea.printfKeyStruct', { Code: 1, Label: 'hot' }), 0x1),
            goPointer(goStruct('tea.printfKeyStruct', { Code: 2, Label: 'iced' }), 0x2),
            null
          ]
        ],
        expected:
          'pointer slice: []*tea.printfKeyStruct{(*tea.printfKeyStruct)(0x1), (*tea.printfKeyStruct)(0x2), (*tea.printfKeyStruct)(nil)}'
      },
      {
        name: 'interface pointer slice %#v',
        template: 'iface slice: %#v',
        args: [
          [
            goPointer(goStruct('tea.printfKeyStruct', { Code: 3, Label: 'steep' }), 0x1),
            'chai',
            null
          ]
        ],
        expected:
          'iface slice: []interface {}{(*tea.printfKeyStruct)(0x1), "chai", interface {}(nil)}'
      },
      {
        name: 'map iface nested pointer %#v',
        template: 'iface nested pointer map: %#v',
        args: [
          new Map<string, unknown>([
            ['note', 'chai'],
            [
              'ptrs',
              new Map<string, unknown>([
                [
                  'hot',
                  goPointer(
                    goStruct('tea.printfKeyStruct', { Code: 1, Label: 'hot' }),
                    0x1
                  )
                ],
                [
                  'iced',
                  goPointer(
                    goStruct('tea.printfKeyStruct', { Code: 2, Label: 'iced' }),
                    0x2
                  )
                ]
              ])
            ]
          ])
        ],
        expected:
          'iface nested pointer map: map[string]interface {}{"note":"chai", "ptrs":map[string]*tea.printfKeyStruct{"hot":(*tea.printfKeyStruct)(0x1), "iced":(*tea.printfKeyStruct)(0x2)}}'
      },
      {
        name: 'slice iface nested pointer %#v',
        template: 'iface nested pointer slice: %#v',
        args: [
          [
            'chai',
            [
              goPointer(
                goStruct('tea.printfKeyStruct', { Code: 1, Label: 'hot' }),
                0x1
              ),
              goPointer(
                goStruct('tea.printfKeyStruct', { Code: 2, Label: 'iced' }),
                0x2
              )
            ],
            [
              goPointer(
                goStruct('tea.printfKeyStruct', { Code: 3, Label: 'ptr' }),
                0x3
              ),
              'milk',
              null
            ]
          ]
        ],
        expected:
          'iface nested pointer slice: []interface {}{"chai", []*tea.printfKeyStruct{(*tea.printfKeyStruct)(0x1), (*tea.printfKeyStruct)(0x2)}, []interface {}{(*tea.printfKeyStruct)(0x3), "milk", interface {}(nil)}}'
      },
      {
        name: 'map iface pointer map struct %#v',
        template: 'iface pointer map struct: %#v',
        args: [
          new Map<string, unknown>([
            [
              'details',
              goStruct('tea.printfNestedStruct', {
                Title: 'chai mix',
                Details: goStruct('tea.printfNestedDetails', {
                  Counts: [6, 1],
                  Tags: new Map([['origin', 'assam']])
                })
              })
            ],
            [
              'ptrs',
              new Map<string, unknown>([
                [
                  'hot',
                  goPointer(
                    goStruct('tea.printfKeyStruct', { Code: 1, Label: 'hot' }),
                    0x1
                  )
                ],
                [
                  'iced',
                  goPointer(
                    goStruct('tea.printfKeyStruct', { Code: 2, Label: 'iced' }),
                    0x2
                  )
                ]
              ])
            ]
          ])
        ],
        expected:
          'iface pointer map struct: map[string]interface {}{"details":tea.printfNestedStruct{Title:"chai mix", Details:tea.printfNestedDetails{Counts:[]int{6, 1}, Tags:map[string]string{"origin":"assam"}}}, "ptrs":map[string]*tea.printfKeyStruct{"hot":(*tea.printfKeyStruct)(0x1), "iced":(*tea.printfKeyStruct)(0x2)}}'
      },
      {
        name: 'slice iface pointer map struct %#v',
        template: 'iface pointer slice struct: %#v',
        args: [
          [
            new Map<string, unknown>([
              [
                'hot',
                goPointer(
                  goStruct('tea.printfKeyStruct', { Code: 1, Label: 'hot' }),
                  0x1
                )
              ],
              [
                'iced',
                goPointer(
                  goStruct('tea.printfKeyStruct', { Code: 2, Label: 'iced' }),
                  0x2
                )
              ]
            ]),
            goStruct('tea.printfNestedStruct', {
              Title: 'chai pointer',
              Details: goStruct('tea.printfNestedDetails', {
                Counts: [2],
                Tags: new Map([['origin', 'darjeeling']])
              })
            })
          ]
        ],
        expected:
          'iface pointer slice struct: []interface {}{map[string]*tea.printfKeyStruct{"hot":(*tea.printfKeyStruct)(0x1), "iced":(*tea.printfKeyStruct)(0x2)}, tea.printfNestedStruct{Title:"chai pointer", Details:tea.printfNestedDetails{Counts:[]int{2}, Tags:map[string]string{"origin":"darjeeling"}}}}'
      },
      {
        name: 'map iface pointer nested slice struct %#v',
        template: 'iface pointer map nested slice struct: %#v',
        args: (() => {
          const pointerHot = goPointer(
            goStruct('tea.printfKeyStruct', { Code: 1, Label: 'hot' }),
            0x1
          );
          const pointerIced = goPointer(
            goStruct('tea.printfKeyStruct', { Code: 2, Label: 'iced' }),
            0x2
          );
          const structPointer = goPointer(
            goStruct('tea.printfNestedStruct', {
              Title: 'pointer chai',
              Details: goStruct('tea.printfNestedDetails', {
                Counts: [3, 8],
                Tags: new Map([
                  ['origin', 'nilgiri'],
                  ['style', 'masala']
                ])
              })
            }),
            0x4
          );
          return [
            new Map<string, unknown>([
              [
                'mix',
                new Map<string, unknown>([
                  ['details', structPointer],
                  ['ptrSlice', [pointerHot, pointerIced, null]],
                  [
                    'ptrs',
                    new Map<string, unknown>([
                      ['hot', pointerHot],
                      ['iced', pointerIced]
                    ])
                  ]
                ])
              ],
              ['note', 'masala']
            ])
          ];
        })(),
        expected:
          'iface pointer map nested slice struct: map[string]interface {}{"mix":map[string]interface {}{"details":(*tea.printfNestedStruct)(0x4), "ptrSlice":[]*tea.printfKeyStruct{(*tea.printfKeyStruct)(0x1), (*tea.printfKeyStruct)(0x2), (*tea.printfKeyStruct)(nil)}, "ptrs":map[string]*tea.printfKeyStruct{"hot":(*tea.printfKeyStruct)(0x1), "iced":(*tea.printfKeyStruct)(0x2)}}, "note":"masala"}'
      },
      {
        name: 'slice iface pointer nested map ptr %#v',
        template: 'iface pointer slice nested map ptr: %#v',
        args: (() => {
          const pointerHot = goPointer(
            goStruct('tea.printfKeyStruct', { Code: 1, Label: 'hot' }),
            0x1
          );
          const pointerIced = goPointer(
            goStruct('tea.printfKeyStruct', { Code: 2, Label: 'iced' }),
            0x2
          );
          const pointerIface = goPointer(
            goStruct('tea.printfKeyStruct', { Code: 3, Label: 'ptr' }),
            0x3
          );
          const structPointer = goPointer(
            goStruct('tea.printfNestedStruct', {
              Title: 'pointer chai',
              Details: goStruct('tea.printfNestedDetails', {
                Counts: [3, 8],
                Tags: new Map([
                  ['origin', 'nilgiri'],
                  ['style', 'masala']
                ])
              })
            }),
            0x4
          );
          return [
            [
              new Map<string, unknown>([
                ['hot', pointerHot],
                ['iced', pointerIced]
              ]),
              [pointerHot, pointerIced, null],
              [structPointer, new Map<string, unknown>([['ptr', pointerIface]])]
            ]
          ];
        })(),
        expected:
          'iface pointer slice nested map ptr: []interface {}{map[string]*tea.printfKeyStruct{"hot":(*tea.printfKeyStruct)(0x1), "iced":(*tea.printfKeyStruct)(0x2)}, []*tea.printfKeyStruct{(*tea.printfKeyStruct)(0x1), (*tea.printfKeyStruct)(0x2), (*tea.printfKeyStruct)(nil)}, []interface {}{(*tea.printfNestedStruct)(0x4), map[string]*tea.printfKeyStruct{"ptr":(*tea.printfKeyStruct)(0x3)}}}'
      },
      {
        name: 'map iface pointer map-of-map slice %#v',
        template: 'iface pointer map of map slice: %#v',
        args: [
          new Map<string, unknown>([
            ['note', 'outer'],
            [
              'outer',
              new Map<string, unknown>([
                [
                  'inner',
                  new Map<string, unknown>([
                    [
                      'nested',
                      new Map<string, unknown>([
                        [
                          'details',
                          goPointer(
                            goStruct('tea.printfNestedStruct', {
                              Title: 'pointer chai',
                              Details: goStruct('tea.printfNestedDetails', {
                                Counts: [3, 8],
                                Tags: new Map([
                                  ['origin', 'nilgiri'],
                                  ['style', 'masala']
                                ])
                              })
                            }),
                            0x4
                          )
                        ],
                        [
                          'ptrSlice',
                          [
                            goPointer(
                              goStruct('tea.printfKeyStruct', { Code: 1, Label: 'hot' }),
                              0x1
                            ),
                            goPointer(
                              goStruct('tea.printfKeyStruct', { Code: 2, Label: 'iced' }),
                              0x2
                            ),
                            null
                          ]
                        ],
                        [
                          'ptrSliceMix',
                          [
                            [
                              goPointer(
                                goStruct('tea.printfKeyStruct', { Code: 1, Label: 'hot' }),
                                0x1
                              )
                            ],
                            new Map<string, unknown>([
                              [
                                'ptr',
                                goPointer(
                                  goStruct('tea.printfKeyStruct', { Code: 3, Label: 'ptr' }),
                                  0x3
                                )
                              ]
                            ])
                          ]
                        ]
                      ])
                    ],
                    ['note', 'inner']
                  ])
                ],
                [
                  'ptrs',
                  new Map<string, unknown>([
                    [
                      'hot',
                      goPointer(
                        goStruct('tea.printfKeyStruct', { Code: 1, Label: 'hot' }),
                        0x1
                      )
                    ],
                    [
                      'iced',
                      goPointer(
                        goStruct('tea.printfKeyStruct', { Code: 2, Label: 'iced' }),
                        0x2
                      )
                    ]
                  ])
                ]
              ])
            ]
          ])
        ],
        expected:
          'iface pointer map of map slice: map[string]interface {}{"note":"outer", "outer":map[string]interface {}{"inner":map[string]interface {}{"nested":map[string]interface {}{"details":(*tea.printfNestedStruct)(0x4), "ptrSlice":[]*tea.printfKeyStruct{(*tea.printfKeyStruct)(0x1), (*tea.printfKeyStruct)(0x2), (*tea.printfKeyStruct)(nil)}, "ptrSliceMix":[]interface {}{[]*tea.printfKeyStruct{(*tea.printfKeyStruct)(0x1)}, map[string]*tea.printfKeyStruct{"ptr":(*tea.printfKeyStruct)(0x3)}}}, "note":"inner"}, "ptrs":map[string]*tea.printfKeyStruct{"hot":(*tea.printfKeyStruct)(0x1), "iced":(*tea.printfKeyStruct)(0x2)}}}'
      },
      {
        name: 'slice iface pointer map refs %#v',
        template: 'iface pointer slice map refs: %#v',
        args: (() => {
          const pointerHot = goPointer(
            goStruct('tea.printfKeyStruct', { Code: 1, Label: 'hot' }),
            0x1
          );
          const pointerIced = goPointer(
            goStruct('tea.printfKeyStruct', { Code: 2, Label: 'iced' }),
            0x2
          );
          const pointerIface = goPointer(
            goStruct('tea.printfKeyStruct', { Code: 3, Label: 'ptr' }),
            0x3
          );
          const chPrimary = goChannel('chan tea.incrementMsg', 0xe0);
          const fnPrimary = goFunc(
            function ifacePointerSlicePrimary() {
              return null;
            },
            'func() tea.incrementMsg',
            0xe1
          );
          const chNested = goChannel('chan tea.incrementMsg', 0xe2);
          const fnNested = goFunc(
            function ifacePointerSliceNested() {
              return null;
            },
            'func() tea.incrementMsg',
            0xe3
          );
          return [
            [
              new Map<string, unknown>([
                ['hot', pointerHot],
                ['iced', pointerIced]
              ]),
              chPrimary,
              fnPrimary,
              [
                new Map<string, unknown>([['ptr', pointerIface]]),
                chNested,
                fnNested
              ]
            ]
          ];
        })(),
        expected:
          'iface pointer slice map refs: []interface {}{map[string]*tea.printfKeyStruct{"hot":(*tea.printfKeyStruct)(0x1), "iced":(*tea.printfKeyStruct)(0x2)}, (chan tea.incrementMsg)(0xe0), (func() tea.incrementMsg)(0xe1), []interface {}{map[string]*tea.printfKeyStruct{"ptr":(*tea.printfKeyStruct)(0x3)}, (chan tea.incrementMsg)(0xe2), (func() tea.incrementMsg)(0xe3)}}'
      },
      {
        name: 'pointer padded width',
        template: 'pointer padded: %20p',
        args: [0xdeadbeef],
        expected: 'pointer padded:           0xdeadbeef'
      },
      {
        name: 'pointer zero padded',
        template: 'pointer zero padded: %020p',
        args: [0xdeadbeef],
        expected: 'pointer zero padded: 0x000000000000deadbeef'
      },
      {
        name: 'unicode rune %c',
        template: 'rune: %c',
        args: [0x2318],
        expected: 'rune: ⌘'
      },
      {
        name: 'unicode code point %U',
        template: 'code point: %U',
        args: [0x2318],
        expected: 'code point: U+2318'
      },
      {
        name: 'unicode verbose %#U',
        template: "verbose rune: %#U",
        args: [0x2318],
        expected: "verbose rune: U+2318 '⌘'"
      },
      {
        name: 'nested struct %#v',
        template: 'struct: %#v',
        args: [
          goStruct('tea.printfNestedStruct', {
            Title: 'chai',
            Details: goStruct('tea.printfNestedDetails', {
              Counts: [1, 2],
              Tags: new Map([['origin', 'assam']])
            })
          })
        ],
        expected:
          'struct: tea.printfNestedStruct{Title:"chai", Details:tea.printfNestedDetails{Counts:[]int{1, 2}, Tags:map[string]string{"origin":"assam"}}}'
      },
      {
        name: 'nested map %#v',
        template: 'map: %#v',
        args: [
          new Map([
            [
              'counts',
              new Map([['steep', 2]])
            ]
          ])
        ],
        expected: 'map: map[string]map[string]int{"counts":map[string]int{"steep":2}}'
      },
      {
        name: 'nested map multiple keys %#v',
        template: 'map multi: %#v',
        args: [
          new Map([
            [
              'temps',
              new Map([
                ['hot', 98],
                ['cold', 65]
              ])
            ],
            [
              'counts',
              new Map([
                ['steep', 2],
                ['rest', 1]
              ])
            ]
          ])
        ],
        expected:
          'map multi: map[string]map[string]int{"counts":map[string]int{"rest":1, "steep":2}, "temps":map[string]int{"cold":65, "hot":98}}'
      },
      {
        name: 'map bool keys %#v',
        template: 'bool map: %#v',
        args: [
          new Map<boolean, string>([
            [true, 'hot'],
            [false, 'iced']
          ])
        ],
        expected: 'bool map: map[bool]string{false:"iced", true:"hot"}'
      },
      {
        name: 'map int keys %#v',
        template: 'int map: %#v',
        args: [
          new Map<number, string>([
            [5, 'high'],
            [-7, 'low'],
            [0, 'zero']
          ])
        ],
        expected: 'int map: map[int]string{-7:"low", 0:"zero", 5:"high"}'
      },
      {
        name: 'map float keys %#v',
        template: 'float map: %#v',
        args: [
          new Map<number, string>([
            [Number.NaN, 'nan'],
            [-Infinity, 'neg'],
            [0, 'zero'],
            [Infinity, 'pos']
          ])
        ],
        expected: 'float map: map[float64]string{NaN:"nan", -Inf:"neg", 0:"zero", +Inf:"pos"}'
      },
      {
        name: 'map float values %#v',
        template: 'float map values: %#v',
        args: [
          new Map<string, number>([
            ['zero', 0],
            ['pos', Number.POSITIVE_INFINITY],
            ['neg', Number.NEGATIVE_INFINITY],
            ['nan', Number.NaN]
          ])
        ],
        expected: 'float map values: map[string]float64{"nan":NaN, "neg":-Inf, "pos":+Inf, "zero":0}'
      },
      {
        name: 'map interface keys %#v',
        template: 'iface map: %#v',
        args: [
          new Map<unknown, string>([
            [true, 'boolTrue'],
            [false, 'boolFalse'],
            [-2, 'int8'],
            [5, 'int32'],
            [3.5, 'float'],
            ['tea', 'string']
          ])
        ],
        expected:
          'iface map: map[interface {}]string{"tea":"string", -2:"int8", 5:"int32", 3.5:"float", false:"boolFalse", true:"boolTrue"}'
      },
      {
        name: 'map interface values %#v',
        template: 'iface map values: %#v',
        args: [
          new Map<string, unknown>([
            ['string', 'chai'],
            ['int', 7],
            ['float', 3.5],
            ['bool', true],
            ['nil', null]
          ])
        ],
        expected:
          'iface map values: map[string]interface {}{"bool":true, "float":3.5, "int":7, "nil":interface {}(nil), "string":"chai"}'
      },
      {
        name: 'map pointer keys %#v',
        template: 'pointer key map: %#v',
        args: [
          (() => {
            const pointerHot = goPointer(
              goStruct('tea.printfKeyStruct', { Code: 1, Label: 'hot' }),
              0x1
            );
            const pointerIced = goPointer(
              goStruct('tea.printfKeyStruct', { Code: 2, Label: 'iced' }),
              0x2
            );
            return new Map([
              [pointerIced, 'iced'],
              [pointerHot, 'hot']
            ]);
          })()
        ],
        expected:
          'pointer key map: map[*tea.printfKeyStruct]string{(*tea.printfKeyStruct)(0x1):"hot", (*tea.printfKeyStruct)(0x2):"iced"}'
      },
      {
        name: 'map pointer values %#v',
        template: 'pointer value map: %#v',
        args: [
          new Map<string, unknown>([
            [
              'hot',
              goPointer(
                goStruct('tea.printfKeyStruct', { Code: 1, Label: 'hot' }),
                0x1
              )
            ],
            [
              'iced',
              goPointer(
                goStruct('tea.printfKeyStruct', { Code: 2, Label: 'iced' }),
                0x2
              )
            ],
            ['zero', null]
          ])
        ],
        expected:
          'pointer value map: map[string]*tea.printfKeyStruct{"hot":(*tea.printfKeyStruct)(0x1), "iced":(*tea.printfKeyStruct)(0x2), "zero":(*tea.printfKeyStruct)(nil)}'
      },
      {
        name: 'map interface pointer values %#v',
        template: 'iface pointer map: %#v',
        args: [
          new Map<string, unknown>([
            ['note', 'chai'],
            [
              'ptr',
              goPointer(
                goStruct('tea.printfKeyStruct', { Code: 3, Label: 'ptr' }),
                0x3
              )
            ]
          ])
        ],
        expected:
          'iface pointer map: map[string]interface {}{"note":"chai", "ptr":(*tea.printfKeyStruct)(0x3)}'
      },
      {
        name: 'map struct keys %#v',
        template: 'struct key map: %#v',
        args: [
          new Map([
            [
              goStruct('tea.printfKeyStruct', { Code: 2, Label: 'iced' }),
              'cold'
            ],
            [
              goStruct('tea.printfKeyStruct', { Code: 1, Label: 'hot' }),
              'warm'
            ]
          ])
        ],
        expected:
          'struct key map: map[tea.printfKeyStruct]string{tea.printfKeyStruct{Code:1, Label:"hot"}:"warm", tea.printfKeyStruct{Code:2, Label:"iced"}:"cold"}'
      },
      {
        name: 'pointer struct %#v',
        template: 'pointer struct: %#v',
        args: [
          goPointer(
            goStruct('tea.printfNestedStruct', {
              Title: 'chai',
              Details: goStruct('tea.printfNestedDetails', {
                Counts: [3],
                Tags: new Map([['origin', 'assam']])
              })
            })
          )
        ],
        expected:
          'pointer struct: &tea.printfNestedStruct{Title:"chai", Details:tea.printfNestedDetails{Counts:[]int{3}, Tags:map[string]string{"origin":"assam"}}}'
      },
      {
        name: 'type struct %T',
        template: 'type: %T',
        args: [
          goStruct('tea.printfNestedStruct', {
            Title: 'type chai',
            Details: goStruct('tea.printfNestedDetails', {
              Counts: [7, 9],
              Tags: new Map([['origin', 'assam']])
            })
          })
        ],
        expected: 'type: tea.printfNestedStruct'
      },
      {
        name: 'type pointer %T',
        template: 'type pointer: %T',
        args: [goPointer(goStruct('tea.printfKeyStruct', { Code: 7, Label: 'type' }))],
        expected: 'type pointer: *tea.printfKeyStruct'
      },
      {
        name: 'type channel %T',
        template: 'type channel: %T',
        args: [goChannel('chan tea.incrementMsg', 0xc0)],
        expected: 'type channel: chan tea.incrementMsg'
      },
      {
        name: 'type func %T',
        template: 'type func: %T',
        args: [
          goFunc(
            function typeFunc() {
              return null;
            },
            'func() tea.incrementMsg',
            0xc1
          )
        ],
        expected: 'type func: func() tea.incrementMsg'
      },
      {
        name: 'type iface map %T',
        template: 'iface ref map type: %T',
        args: [
          new Map([
            ['chan', goChannel('chan tea.incrementMsg', 0xc2)],
            [
              'func',
              goFunc(
                function ifaceTypeMapFunc() {
                  return null;
                },
                'func() tea.incrementMsg',
                0xc3
              )
            ],
            ['note', 'chai']
          ])
        ],
        expected: 'iface ref map type: map[string]interface {}'
      },
      {
        name: 'type iface slice %T',
        template: 'iface ref slice type: %T',
        args: [
          [
            goChannel('chan tea.incrementMsg', 0xc4),
            goFunc(
              function ifaceTypeSliceFunc() {
                return null;
              },
              'func() tea.incrementMsg',
              0xc5
            ),
            'chai'
          ]
        ],
        expected: 'iface ref slice type: []interface {}'
      },
      {
        name: 'struct %+v',
        template: 'struct plus: %+v',
        args: [
          goStruct('tea.printfNestedStruct', {
            Title: 'plus chai',
            Details: goStruct('tea.printfNestedDetails', {
              Counts: [4],
              Tags: new Map([['style', 'milk'], ['origin', 'darjeeling']])
            })
          })
        ],
        expected:
          'struct plus: {Title:plus chai Details:{Counts:[4] Tags:map[origin:darjeeling style:milk]}}'
      },
      {
        name: 'channel %+v',
        template: 'channel plus: %+v',
        args: [goChannel('chan tea.incrementMsg', 0xd0)],
        expected: 'channel plus: 0xd0'
      },
      {
        name: 'func %+v',
        template: 'func plus: %+v',
        args: [
          goFunc(
            function funcPlus() {
              return null;
            },
            'func() tea.incrementMsg',
            0xd1
          )
        ],
        expected: 'func plus: 0xd1'
      },
      {
        name: 'iface map %+v',
        template: 'iface ref map plus: %+v',
        args: [
          new Map([
            ['chan', goChannel('chan tea.incrementMsg', 0xd2)],
            [
              'func',
              goFunc(
                function ifacePlusMapFunc() {
                  return null;
                },
                'func() tea.incrementMsg',
                0xd3
              )
            ],
            ['note', 'chai']
          ])
        ],
        expected: 'iface ref map plus: map[chan:0xd2 func:0xd3 note:chai]'
      },
      {
        name: 'iface slice %+v',
        template: 'iface ref slice plus: %+v',
        args: [
          [
            goChannel('chan tea.incrementMsg', 0xd4),
            goFunc(
              function ifacePlusSliceFunc() {
                return null;
              },
              'func() tea.incrementMsg',
              0xd5
            ),
            'chai'
          ]
        ],
        expected: 'iface ref slice plus: [0xd4 0xd5 chai]'
      },
      {
        name: 'struct tags %#v',
        template: 'struct tags: %#v',
        args: [
          goStruct('tea.printfNestedStruct', {
            Title: 'chai',
            Details: goStruct('tea.printfNestedDetails', {
              Counts: [5, 8],
              Tags: new Map([
                ['origin', 'assam'],
                ['grade', 'ftgfop']
              ])
            })
          })
        ],
        expected:
          'struct tags: tea.printfNestedStruct{Title:"chai", Details:tea.printfNestedDetails{Counts:[]int{5, 8}, Tags:map[string]string{"grade":"ftgfop", "origin":"assam"}}}'
      },
      {
        name: 'nil pointer %p',
        template: 'pointer: %p',
        args: [null],
        expected: 'pointer: 0x0'
      },
      {
        name: 'map pointer reference %p',
        template: 'map pointer: %p',
        args: [
          withPointerAddress(
            new Map([
              ['steep', 2]
            ]),
            0x50
          )
        ],
        expected: 'map pointer: 0x50'
      },
      {
        name: 'slice pointer reference %p',
        template: 'slice pointer: %p',
        args: [withPointerAddress([1, 2, 3], 0x60)],
        expected: 'slice pointer: 0x60'
      },
      {
        name: 'func pointer reference %p',
        template: 'func pointer: %p',
        args: [
          withPointerAddress(
            function pointerTest() {
              return null;
            },
            0x70
          )
        ],
        expected: 'func pointer: 0x70'
      },
      {
        name: 'channel %#v',
        template: 'channel literal: %#v',
        args: [goChannel('chan tea.incrementMsg', 0x80)],
        expected: 'channel literal: (chan tea.incrementMsg)(0x80)'
      },
      {
        name: 'func %#v',
        template: 'func literal: %#v',
        args: [
          goFunc(
            function funcLiteral() {
              return null;
            },
            'func() tea.Msg',
            0x90
          )
        ],
        expected: 'func literal: (func() tea.Msg)(0x90)'
      },
      {
        name: 'iface map refs %#v',
        template: 'iface ref map: %#v',
        args: [
          new Map([
            ['chan', goChannel('chan tea.incrementMsg', 0xa0)],
            [
              'func',
              goFunc(
                function ifaceRefFunc() {
                  return null;
                },
                'func() tea.incrementMsg',
                0xa1
              )
            ],
            ['note', 'chai']
          ])
        ],
        expected:
          'iface ref map: map[string]interface {}{"chan":(chan tea.incrementMsg)(0xa0), "func":(func() tea.incrementMsg)(0xa1), "note":"chai"}'
      },
      {
        name: 'iface slice refs %#v',
        template: 'iface ref slice: %#v',
        args: [
          [
            goChannel('chan tea.incrementMsg', 0xb0),
            goFunc(
              function ifaceSliceFunc() {
                return null;
              },
              'func() tea.incrementMsg',
              0xb1
            ),
            'chai'
          ]
        ],
        expected:
          'iface ref slice: []interface {}{(chan tea.incrementMsg)(0xb0), (func() tea.incrementMsg)(0xb1), "chai"}'
      }
    ] as const;

    for (const { name, template, args, expected } of formattingCases) {
      it(`formats ${name}`, async () => {
        const cmd = Printf(template, ...args);
        const msg = (await cmd?.()) as PrintLineMsg | null | undefined;
        expect(msg).toBeTruthy();
        expect(msg?.type).toBe('bubbletea/print-line');
        expect(msg?.body).toBe(expected);
      });
    }
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
  });
});
