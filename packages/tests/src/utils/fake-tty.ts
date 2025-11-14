import { PassThrough } from 'node:stream';

export interface FakeTtyInputOptions {
  beforeSetRawMode?: (next: boolean) => Error | string | null | undefined;
}

export class FakeTtyInput extends PassThrough {
  public isTTY = true;
  public isRaw: boolean;
  public readonly rawModeCalls: boolean[] = [];
  private readonly beforeSetRawMode?: FakeTtyInputOptions['beforeSetRawMode'];

  constructor(initialRaw = false, options: FakeTtyInputOptions = {}) {
    super();
    this.isRaw = initialRaw;
    this.beforeSetRawMode = options.beforeSetRawMode;
  }

  setRawMode(next: boolean): this {
    this.rawModeCalls.push(next);
    const maybeError = this.beforeSetRawMode?.(next);
    if (maybeError) {
      throw typeof maybeError === 'string' ? new Error(maybeError) : maybeError;
    }
    this.isRaw = next;
    return this;
  }
}

export class NonTtyInput extends PassThrough {
  public isTTY = false;
  public readonly rawModeCalls: boolean[] = [];

  setRawMode(next: boolean): this {
    this.rawModeCalls.push(next);
    return this;
  }
}

export class FakeTtyOutput extends PassThrough {
  public isTTY = true;
  public columns = 80;
  public rows = 24;
}
