import { PassThrough, Writable } from 'node:stream';

import {
  Msg,
  NewProgram,
  Renderer,
  WithOutput
} from '@bubbletea/tea';

export interface StandardRendererHarness extends Renderer {
  flush(): void;
  running: boolean;
  setIgnoredLines(from: number, to: number): void;
  clearIgnoredLines(): void;
}

export class FakeWindowsTerminal {
  private readonly stream = new PassThrough();
  private buffer = '';

  constructor() {
    this.stream.on('data', (chunk) => {
      this.buffer += chunk.toString('utf8');
    });
  }

  get writable(): NodeJS.WritableStream {
    return this.stream;
  }

  read(): string {
    return this.buffer;
  }

  consume(): string {
    const output = this.buffer;
    this.buffer = '';
    return output;
  }

}

export interface WindowsRendererHarness {
  renderer: StandardRendererHarness;
  terminal: FakeWindowsTerminal;
}

export const createWindowsRendererHarness = (): WindowsRendererHarness => {
  const terminal = new FakeWindowsTerminal();
  const program = NewProgram(null, WithOutput(terminal.writable));
  const renderer = program.renderer as unknown as StandardRendererHarness;
  renderer.running = true;
  return { renderer, terminal };
};

export interface WindowSizeMessage extends Msg {
  readonly type: 'bubbletea/window-size';
  readonly width: number;
  readonly height: number;
}

export class WindowsWritable extends Writable {
  private buffer = '';
  closed = false;

  constructor() {
    super();
    this.once('close', () => {
      this.closed = true;
    });
    this.once('finish', () => {
      this.closed = true;
    });
  }

  override _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    const normalizedEncoding = encoding === 'buffer' ? 'utf8' : encoding;
    const asString =
      typeof chunk === 'string' ? chunk : chunk.toString(normalizedEncoding as BufferEncoding);
    this.buffer += asString;
    callback();
  }

  read(): string {
    return this.buffer;
  }

  clear(): void {
    this.buffer = '';
  }
}
