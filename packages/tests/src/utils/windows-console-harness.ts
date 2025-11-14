import type {
  WindowsConsoleBinding,
  WindowsHandle,
  WindowsInputRecord,
  WindowsKeyInputRecord,
  WindowsMouseInputRecord,
  WindowsPseudoConsole,
  WindowsPseudoConsoleHandle,
  WindowsSize,
  WindowsWindowBufferSizeRecord
} from '@bubbletea/tea/internal';

type AsyncRecordResolve<T> = (result: IteratorResult<T>) => void;

class AsyncRecordQueue<T> {
  private readonly pending: T[] = [];
  private readonly waiters: AsyncRecordResolve<T>[] = [];
  private finished = false;

  push(value: T): void {
    if (this.finished) {
      throw new Error('cannot push records after the queue is finished');
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value, done: false });
      return;
    }
    this.pending.push(value);
  }

  finish(): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      waiter?.({ value: undefined, done: true } as IteratorResult<T>);
    }
  }

  private createIterator(): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.pending.length > 0) {
          const value = this.pending.shift() as T;
          return Promise.resolve({ value, done: false });
        }
        if (this.finished) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.waiters.push(resolve);
        });
      },
      return: async (value?: unknown): Promise<IteratorResult<T>> => {
        this.finish();
        return { value: value as T, done: true };
      }
    } satisfies AsyncIterator<T>;
  }

  get iterable(): AsyncIterable<T> {
    return {
      [Symbol.asyncIterator]: () => this.createIterator()
    } satisfies AsyncIterable<T>;
  }
}

interface PseudoConsoleState {
  size: WindowsSize;
  input: WindowsHandle;
  output: WindowsHandle;
}

const cloneSize = (size: WindowsSize): WindowsSize => ({ columns: size.columns, rows: size.rows });

const cloneRecord = (record: WindowsInputRecord): WindowsInputRecord => {
  if (record.type === 'mouse') {
    return {
      type: 'mouse',
      position: { x: record.position.x, y: record.position.y },
      buttonState: record.buttonState,
      controlKeyState: record.controlKeyState,
      eventFlags: record.eventFlags
    } satisfies WindowsMouseInputRecord;
  }
  if (record.type === 'key') {
    return {
      type: 'key',
      keyDown: record.keyDown,
      repeatCount: record.repeatCount,
      charCode: record.charCode,
      virtualKeyCode: record.virtualKeyCode,
      controlKeyState: record.controlKeyState
    } satisfies WindowsKeyInputRecord;
  }
  return {
    type: 'window-buffer-size',
    size: cloneSize(record.size)
  } satisfies WindowsWindowBufferSizeRecord;
};

export class FakeWindowsConsoleBinding implements WindowsConsoleBinding {
  readonly getConsoleModeCalls: WindowsHandle[] = [];
  readonly setConsoleModeCalls: Array<{ handle: WindowsHandle; mode: number }> = [];
  readonly cancelIoCalls: WindowsHandle[] = [];
  readonly resizePseudoConsoleCalls: Array<{ handle: WindowsPseudoConsoleHandle; size: WindowsSize }> = [];
  readonly closePseudoConsoleCalls: WindowsPseudoConsoleHandle[] = [];

  private readonly modes = new Map<WindowsHandle, number>();
  private readonly recordQueues = new Map<WindowsHandle, AsyncRecordQueue<WindowsInputRecord>>();
  private readonly pseudoConsoles = new Map<WindowsPseudoConsoleHandle, PseudoConsoleState>();
  private nextHandle: WindowsHandle = 64;
  private nextPseudoConsoleHandle: WindowsPseudoConsoleHandle = 1;

  getConsoleMode(handle: WindowsHandle): number {
    this.getConsoleModeCalls.push(handle);
    return this.modes.get(handle) ?? 0;
  }

  setConsoleMode(handle: WindowsHandle, mode: number): void {
    this.setConsoleModeCalls.push({ handle, mode });
    this.modes.set(handle, mode);
  }

  readConsoleInput(handle: WindowsHandle): AsyncIterable<WindowsInputRecord> {
    return this.ensureRecordQueue(handle).iterable;
  }

  cancelIo(handle: WindowsHandle): void {
    this.cancelIoCalls.push(handle);
    const queue = this.recordQueues.get(handle);
    if (queue) {
      queue.finish();
      return;
    }
    const finishedQueue = new AsyncRecordQueue<WindowsInputRecord>();
    finishedQueue.finish();
    this.recordQueues.set(handle, finishedQueue);
  }

  createPseudoConsole(initialSize: WindowsSize): WindowsPseudoConsole {
    const handle = this.nextPseudoConsoleHandle++;
    const input = this.createHandle();
    const output = this.createHandle();
    this.ensureRecordQueue(input);
    this.pseudoConsoles.set(handle, { size: cloneSize(initialSize), input, output });
    return { handle, input, output } satisfies WindowsPseudoConsole;
  }

  resizePseudoConsole(pseudoConsole: WindowsPseudoConsoleHandle, size: WindowsSize): void {
    const state = this.pseudoConsoles.get(pseudoConsole);
    if (!state) {
      throw new Error(`unknown pseudo console handle ${pseudoConsole}`);
    }
    const sizeClone = cloneSize(size);
    state.size = sizeClone;
    this.resizePseudoConsoleCalls.push({ handle: pseudoConsole, size: sizeClone });
    this.queueWindowResizeEvent(state.input, sizeClone);
  }

  closePseudoConsole(pseudoConsole: WindowsPseudoConsoleHandle): void {
    const state = this.pseudoConsoles.get(pseudoConsole);
    if (!state) {
      return;
    }
    this.closePseudoConsoleCalls.push(pseudoConsole);
    this.pseudoConsoles.delete(pseudoConsole);
    this.cancelIo(state.input);
  }

  seedConsoleMode(handle: WindowsHandle, mode: number): void {
    this.modes.set(handle, mode);
  }

  modeFor(handle: WindowsHandle): number | undefined {
    return this.modes.get(handle);
  }

  createHandle(): WindowsHandle {
    const handle = this.nextHandle++;
    return handle;
  }

  queueInputRecord(handle: WindowsHandle, record: WindowsInputRecord): void {
    const queue = this.ensureRecordQueue(handle);
    queue.push(cloneRecord(record));
  }

  queueKeyEvent(
    handle: WindowsHandle,
    overrides: Partial<Omit<WindowsKeyInputRecord, 'type'>> = {}
  ): void {
    const record: WindowsKeyInputRecord = {
      type: 'key',
      keyDown: overrides.keyDown ?? true,
      repeatCount: overrides.repeatCount ?? 1,
      charCode: overrides.charCode ?? 0,
      virtualKeyCode: overrides.virtualKeyCode ?? 0,
      controlKeyState: overrides.controlKeyState ?? 0
    };
    this.queueInputRecord(handle, record);
  }

  queueMouseEvent(
    handle: WindowsHandle,
    overrides: Partial<Omit<WindowsMouseInputRecord, 'type'>> = {}
  ): void {
    const record: WindowsMouseInputRecord = {
      type: 'mouse',
      position: overrides.position ? { ...overrides.position } : { x: 0, y: 0 },
      buttonState: overrides.buttonState ?? 0,
      controlKeyState: overrides.controlKeyState ?? 0,
      eventFlags: overrides.eventFlags ?? 0
    };
    this.queueInputRecord(handle, record);
  }

  queueWindowResizeEvent(handle: WindowsHandle, size: WindowsSize): void {
    const record: WindowsWindowBufferSizeRecord = {
      type: 'window-buffer-size',
      size: cloneSize(size)
    };
    this.queueInputRecord(handle, record);
  }

  pseudoConsoleSize(handle: WindowsPseudoConsoleHandle): WindowsSize | undefined {
    const state = this.pseudoConsoles.get(handle);
    return state ? cloneSize(state.size) : undefined;
  }

  pseudoConsoleHandles(handle: WindowsPseudoConsoleHandle):
    | { input: WindowsHandle; output: WindowsHandle }
    | undefined {
    const state = this.pseudoConsoles.get(handle);
    if (!state) {
      return undefined;
    }
    return { input: state.input, output: state.output };
  }

  private ensureRecordQueue(handle: WindowsHandle): AsyncRecordQueue<WindowsInputRecord> {
    let queue = this.recordQueues.get(handle);
    if (!queue) {
      queue = new AsyncRecordQueue<WindowsInputRecord>();
      this.recordQueues.set(handle, queue);
    }
    return queue;
  }
}
