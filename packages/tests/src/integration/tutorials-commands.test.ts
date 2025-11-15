import { STATUS_CODES } from 'node:http';

import { describe, expect, it, vi } from 'vitest';

import {
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

const URL = 'https://charm.sh/';

interface StatusMsg {
  readonly type: 'tutorials/status';
  readonly status: number;
}

interface ErrorMsg {
  readonly type: 'tutorials/error';
  readonly error: Error;
}

const createStatusMsg = (status: number): StatusMsg => ({
  type: 'tutorials/status',
  status
});

const createErrorMsg = (error: Error): ErrorMsg => ({
  type: 'tutorials/error',
  error
});

const isStatusMsg = (msg: Msg): msg is StatusMsg =>
  typeof msg === 'object' &&
  msg !== null &&
  (msg as StatusMsg).type === 'tutorials/status' &&
  typeof (msg as StatusMsg).status === 'number';

const isErrorMsg = (msg: Msg): msg is ErrorMsg =>
  typeof msg === 'object' &&
  msg !== null &&
  (msg as ErrorMsg).type === 'tutorials/error' &&
  (msg as ErrorMsg).error instanceof Error;

const isKeyMsg = (msg: Msg): msg is KeyMsg =>
  typeof msg === 'object' && msg !== null && typeof (msg as KeyMsg).type === 'number';

class CommandsTutorialModel implements Model {
  public status = 0;
  public err: Error | null = null;

  constructor(private readonly checkServerCmd: Cmd) {}

  init(): Cmd {
    return this.checkServerCmd;
  }

  update(msg: Msg) {
    if (isStatusMsg(msg)) {
      this.status = msg.status;
      return [this, Quit] as const;
    }

    if (isErrorMsg(msg)) {
      this.err = msg.error;
      return [this, Quit] as const;
    }

    if (isKeyMsg(msg) && keyToString(msg) === 'ctrl+c') {
      return [this, Quit] as const;
    }

    return [this] as const;
  }

  view(): string {
    if (this.err) {
      return ['', `We had some trouble: ${this.err.message}`, '', ''].join('\n');
    }

    let line = `Checking ${URL} ... `;
    if (this.status > 0) {
      const statusText = STATUS_CODES[this.status] ?? 'Unknown Status';
      line += `${this.status} ${statusText}!`;
    }

    return ['', line, '', ''].join('\n');
  }
}

const createAsyncStatusCommand = (status: number, onCall?: () => void): Cmd => () => {
  onCall?.();
  return new Promise<Msg>((resolve) => {
    queueMicrotask(() => resolve(createStatusMsg(status)));
  });
};

const createAsyncErrorCommand = (message: string, onCall?: () => void): Cmd => () => {
  onCall?.();
  return new Promise<Msg>((resolve) => {
    queueMicrotask(() => resolve(createErrorMsg(new Error(message))));
  });
};

describe('Integration: tutorials/commands', () => {
  it('checks the server and renders the HTTP status', async () => {
    const checkServerSpy = vi.fn();
    const model = new CommandsTutorialModel(createAsyncStatusCommand(200, checkServerSpy));
    const program = NewProgram(
      model,
      WithInput(new FakeTtyInput(false)),
      WithOutput(new FakeTtyOutput())
    );

    const result = await program.run();
    expect(result.err).toBeNull();
    expect(result.model).toBe(model);
    expect(checkServerSpy).toHaveBeenCalledTimes(1);
    expect(model.status).toBe(200);
    expect(model.err).toBeNull();

    const expectedOutput = ['', 'Checking https://charm.sh/ ... 200 OK!', '', ''].join('\n');
    expect(model.view()).toBe(expectedOutput);
  });

  it('surfaces errors from the server check', async () => {
    const checkServerSpy = vi.fn();
    const model = new CommandsTutorialModel(
      createAsyncErrorCommand('connection refused', checkServerSpy)
    );
    const program = NewProgram(
      model,
      WithInput(new FakeTtyInput(false)),
      WithOutput(new FakeTtyOutput())
    );

    const result = await program.run();
    expect(result.err).toBeNull();
    expect(result.model).toBe(model);
    expect(checkServerSpy).toHaveBeenCalledTimes(1);
    expect(model.status).toBe(0);
    expect(model.err).toBeInstanceOf(Error);

    const expectedOutput = ['', 'We had some trouble: connection refused', '', ''].join('\n');
    expect(model.view()).toBe(expectedOutput);
  });

  it('allows the user to cancel with ctrl+c before the check finishes', async () => {
    let resolveCmd: ((msg: Msg) => void) | null = null;
    const pendingCmd: Cmd = () =>
      new Promise<Msg>((resolve) => {
        resolveCmd = resolve;
      });

    const model = new CommandsTutorialModel(pendingCmd);
    const input = new FakeTtyInput(false);
    const program = NewProgram(model, WithInput(input), WithOutput(new FakeTtyOutput()));

    const runPromise = program.run();

    input.end('\u0003');
    const result = await runPromise;
    expect(result.err).toBeNull();
    expect(model.status).toBe(0);
    expect(model.err).toBeNull();
    expect(resolveCmd).not.toBeNull();
    resolveCmd?.(createStatusMsg(200));
  });
});
