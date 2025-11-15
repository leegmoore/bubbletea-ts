import { Cmd, Msg } from '@bubbletea/tea';

export const SPINNER_TICK_TYPE = 'tests/fake-spinner/tick';

export interface SpinnerTickMsg {
  readonly type: typeof SPINNER_TICK_TYPE;
}

export const createSpinnerTickMsg = (): SpinnerTickMsg => ({ type: SPINNER_TICK_TYPE });

export const isSpinnerTickMsg = (msg: Msg): msg is SpinnerTickMsg =>
  typeof msg === 'object' &&
  msg !== null &&
  (msg as SpinnerTickMsg).type === SPINNER_TICK_TYPE;

export type OnTick = (tickIndex: number) => void;

export class FakeSpinner {
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
