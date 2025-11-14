import { PassThrough } from 'node:stream';

export class FakeTtyInput extends PassThrough {
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
