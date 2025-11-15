import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';

import {
  ExecProcess,
  NewProgram,
  Quit,
  WithInput,
  WithOutput,
  type Cmd,
  type Model,
  type Msg
} from '@bubbletea/tea';

const createExecFinishedMsg = (error: Error | null) => ({
  type: 'tests/exec-finished',
  error
});

type ExecFinishedMsg = ReturnType<typeof createExecFinishedMsg>;

type ExecSpec = Parameters<typeof ExecProcess>[0];

type ExecTestCase = {
  readonly name: string;
  readonly command: ExecSpec;
  readonly expectError: boolean;
};

class TestExecModel implements Model {
  public err: Error | null = null;

  constructor(private readonly command: ExecSpec) {}

  init(): Cmd {
    return ExecProcess(this.command, (error) => createExecFinishedMsg(error));
  }

  update(msg: Msg): [Model, Cmd] | [Model] {
    if ((msg as ExecFinishedMsg).type === 'tests/exec-finished') {
      const finished = msg as ExecFinishedMsg;
      if (finished.error) {
        this.err = finished.error;
      }
      return [this, Quit];
    }
    return [this];
  }

  view(): string {
    return '\n';
  }
}

describe('ExecProcess (exec_test.go::TestTeaExec)', () => {
  const cases: ExecTestCase[] = [
    {
      name: 'invalid command',
      command: 'invalid',
      expectError: true
    }
  ];

  if (process.platform !== 'win32') {
    cases.push(
      {
        name: 'true',
        command: 'true',
        expectError: false
      },
      {
        name: 'false',
        command: 'false',
        expectError: true
      }
    );
  }

  cases.forEach(({ name, command, expectError }) => {
    it(name, async () => {
      const input = new PassThrough();
      const output = new PassThrough();
      const model = new TestExecModel(command);
      const program = NewProgram(model, WithInput(input), WithOutput(output));

      let resetLinesRendered = false;
      const originalReset = program.renderer.resetLinesRendered.bind(program.renderer);
      program.renderer.resetLinesRendered = () => {
        resetLinesRendered = true;
        originalReset();
      };

      const { err } = await program.run();
      expect(err).toBeNull();

      if (model.err && !expectError) {
        expect(resetLinesRendered).toBe(true);
        throw model.err;
      }

      if (!model.err && expectError) {
        throw new Error('expected an error but command succeeded');
      }
    });
  });
});
