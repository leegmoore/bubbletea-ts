import { describe, expect, it, vi } from 'vitest';

import {
  Batch,
  Cmd,
  KeyMsg,
  Model,
  Msg,
  NewProgram,
  Quit,
  WithInput,
  WithOutput,
  keyToString
} from '@bubbletea/tea';

import { FakeTtyInput, FakeTtyOutput } from '../utils/fake-tty';

const SPINNER_TICK_TYPE = 'examples/spinner/tick';
const SPINNER_ERROR_TYPE = 'examples/spinner/error';

interface SpinnerTickMsg {
  readonly type: typeof SPINNER_TICK_TYPE;
}

interface SpinnerErrorMsg {
  readonly type: typeof SPINNER_ERROR_TYPE;
  readonly error: Error;
}

const createSpinnerTickMsg = (): SpinnerTickMsg => ({ type: SPINNER_TICK_TYPE });

const createSpinnerErrorMsg = (message: string): SpinnerErrorMsg => ({
  type: SPINNER_ERROR_TYPE,
  error: new Error(message)
});

const isSpinnerErrorMsg = (msg: Msg): msg is SpinnerErrorMsg =>
  typeof msg === 'object' &&
  msg !== null &&
  (msg as SpinnerErrorMsg).type === SPINNER_ERROR_TYPE &&
  (msg as SpinnerErrorMsg).error instanceof Error;

const isKeyMsg = (msg: Msg): msg is KeyMsg =>
  typeof msg === 'object' && msg !== null && typeof (msg as KeyMsg).type === 'number';

const isSpinnerTickMsg = (msg: Msg): msg is SpinnerTickMsg =>
  typeof msg === 'object' &&
  msg !== null &&
  (msg as SpinnerTickMsg).type === SPINNER_TICK_TYPE;

type OnTick = (tickIndex: number) => void;

class FakeSpinner {
  private frameIndex = 0;
  private tickCounter = 0;

  constructor(
    private readonly frames: readonly string[] = ['⠋', '⠙', '⠹', '⠸'],
    private readonly onTick?: OnTick
  ) {}

  readonly Tick: Cmd = () =>
    new Promise<SpinnerTickMsg>((resolve) => {
      const tickIndex = this.tickCounter;
      this.tickCounter += 1;
      setTimeout(() => {
        this.onTick?.(tickIndex);
        resolve(createSpinnerTickMsg());
      }, 0);
    });

  update(msg: Msg): [FakeSpinner, Cmd] | [FakeSpinner] {
    if (!isSpinnerTickMsg(msg)) {
      return [this] as const;
    }

    this.frameIndex = (this.frameIndex + 1) % this.frames.length;
    return [this, this.Tick] as const;
  }

  view(): string {
    return this.frames[this.frameIndex];
  }

  get ticksScheduled(): number {
    return this.tickCounter;
  }
}

class SpinnerExampleModel implements Model {
  public quitting = false;
  public err: Error | null = null;

  constructor(private readonly spinner: FakeSpinner, private readonly extraInitCmds: Cmd[] = []) {}

  init(): Cmd {
    return Batch(this.spinner.Tick, ...this.extraInitCmds);
  }

  update(msg: Msg) {
    if (isKeyMsg(msg)) {
      return this.handleKeyMsg(msg);
    }

    if (isSpinnerErrorMsg(msg)) {
      this.err = msg.error;
      return [this] as const;
    }

    const [, cmd] = this.spinner.update(msg);
    return [this, cmd] as const;
  }

  view(): string {
    if (this.err) {
      return this.err.message;
    }

    const base = `\n\n   ${this.spinner.view()} Loading forever...press q to quit\n\n`;
    return this.quitting ? `${base}\n` : base;
  }

  private handleKeyMsg(msg: KeyMsg) {
    const key = keyToString(msg);
    if (key === 'q' || key === 'esc' || key === 'ctrl+c') {
      this.quitting = true;
      return [this, Quit] as const;
    }
    return [this] as const;
  }
}

const CTRL_C = '\u0003';

const createAsyncErrorCommand = (message: string, onEmit?: () => void): Cmd => () =>
  new Promise<SpinnerErrorMsg>((resolve) => {
    queueMicrotask(() => {
      onEmit?.();
      resolve(createSpinnerErrorMsg(message));
    });
  });

describe('Integration: examples/spinner', () => {
  it('spins and quits once the user presses q', async () => {
    const input = new FakeTtyInput(false);
    const spinner = new FakeSpinner(['⠋', '⠙', '⠹', '⠸'], (tickIndex) => {
      if (tickIndex === 5) {
        input.end('q');
      }
    });
    const model = new SpinnerExampleModel(spinner);
    const program = NewProgram(model, WithInput(input), WithOutput(new FakeTtyOutput()));

    const result = await program.run();
    expect(result.err).toBeNull();
    expect(result.model).toBe(model);

    expect(model.quitting).toBe(true);
    expect(model.err).toBeNull();
    expect(spinner.ticksScheduled).toBeGreaterThanOrEqual(6);

    const expectedView = `\n\n   ${spinner.view()} Loading forever...press q to quit\n\n\n`;
    expect(model.view()).toBe(expectedView);
  });

  it('surfaces asynchronous errors from commands', async () => {
    const input = new FakeTtyInput(false);
    const errorSpy = vi.fn();
    const spinner = new FakeSpinner();
    const errorCmd = createAsyncErrorCommand('spinner exploded', () => {
      errorSpy();
      input.end(CTRL_C);
    });

    const model = new SpinnerExampleModel(spinner, [errorCmd]);
    const program = NewProgram(model, WithInput(input), WithOutput(new FakeTtyOutput()));

    const result = await program.run();
    expect(result.err).toBeNull();
    expect(result.model).toBe(model);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(model.err).toBeInstanceOf(Error);
    expect(model.view()).toBe('spinner exploded');
  });
});
