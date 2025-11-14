import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';

import {
  ClearScreen,
  Cmd,
  DisableBracketedPaste,
  DisableMouse,
  DisableReportFocus,
  EnableBracketedPaste,
  EnableMouseAllMotion,
  EnableMouseCellMotion,
  EnableReportFocus,
  EnterAltScreen,
  ExitAltScreen,
  HideCursor,
  Model,
  Msg,
  NewProgram,
  Program,
  ProgramOption,
  Quit,
  SequenceMsg,
  ShowCursor,
  WithInput,
  WithMouseAllMotion,
  WithMouseCellMotion,
  WithOutput,
  WithReportFocus
} from '@bubbletea/tea';

class RendererTestModel implements Model {
  init(): Cmd {
    return null;
  }

  update(_msg: Msg) {
    return [this, null] as const;
  }

  view(): string {
    return 'success\n';
  }
}

const createProgram = (...extraOptions: ProgramOption[]) => {
  const input = new PassThrough();
  const output = new PassThrough();
  let buffer = '';
  output.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
  });
  const program = NewProgram(
    new RendererTestModel(),
    WithInput(input),
    WithOutput(output),
    ...extraOptions
  );
  return {
    program,
    readOutput: () => buffer
  };
};

const windowSizeCmd: Cmd = () => ({
  type: 'bubbletea/window-size',
  width: 80,
  height: 24
});

const sendSequence = async (program: Program, commands: Cmd[]): Promise<void> => {
  await program.send([windowSizeCmd, ...commands, Quit] as SequenceMsg);
};

describe('Renderer control sequences (screen_test.go parity)', () => {
  const cases: Array<{ name: string; cmds: Cmd[]; expected: string }> = [
    {
      name: 'clear_screen',
      cmds: [ClearScreen],
      expected:
        '\x1b[?25l\x1b[?2004h\x1b[2J\x1b[H\rsuccess\x1b[K\r\n\x1b[K\r\x1b[2K\r\x1b[?2004l\x1b[?25h\x1b[?1002l\x1b[?1003l\x1b[?1006l'
    },
    {
      name: 'altscreen',
      cmds: [EnterAltScreen, ExitAltScreen],
      expected:
        '\x1b[?25l\x1b[?2004h\x1b[?1049h\x1b[2J\x1b[H\x1b[?25l\x1b[?1049l\x1b[?25l\rsuccess\x1b[K\r\n\x1b[K\r\x1b[2K\r\x1b[?2004l\x1b[?25h\x1b[?1002l\x1b[?1003l\x1b[?1006l'
    },
    {
      name: 'altscreen_autoexit',
      cmds: [EnterAltScreen],
      expected:
        '\x1b[?25l\x1b[?2004h\x1b[?1049h\x1b[2J\x1b[H\x1b[?25l\x1b[H\rsuccess\x1b[K\r\n\x1b[K\x1b[2;H\x1b[2K\r\x1b[?2004l\x1b[?25h\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1049l\x1b[?25h'
    },
    {
      name: 'mouse_cellmotion',
      cmds: [EnableMouseCellMotion],
      expected:
        '\x1b[?25l\x1b[?2004h\x1b[?1002h\x1b[?1006h\rsuccess\x1b[K\r\n\x1b[K\r\x1b[2K\r\x1b[?2004l\x1b[?25h\x1b[?1002l\x1b[?1003l\x1b[?1006l'
    },
    {
      name: 'mouse_allmotion',
      cmds: [EnableMouseAllMotion],
      expected:
        '\x1b[?25l\x1b[?2004h\x1b[?1003h\x1b[?1006h\rsuccess\x1b[K\r\n\x1b[K\r\x1b[2K\r\x1b[?2004l\x1b[?25h\x1b[?1002l\x1b[?1003l\x1b[?1006l'
    },
    {
      name: 'mouse_disable',
      cmds: [EnableMouseAllMotion, DisableMouse],
      expected:
        '\x1b[?25l\x1b[?2004h\x1b[?1003h\x1b[?1006h\x1b[?1002l\x1b[?1003l\x1b[?1006l\rsuccess\x1b[K\r\n\x1b[K\r\x1b[2K\r\x1b[?2004l\x1b[?25h\x1b[?1002l\x1b[?1003l\x1b[?1006l'
    },
    {
      name: 'cursor_hide',
      cmds: [HideCursor],
      expected:
        '\x1b[?25l\x1b[?2004h\x1b[?25l\rsuccess\x1b[K\r\n\x1b[K\r\x1b[2K\r\x1b[?2004l\x1b[?25h\x1b[?1002l\x1b[?1003l\x1b[?1006l'
    },
    {
      name: 'cursor_hideshow',
      cmds: [HideCursor, ShowCursor],
      expected:
        '\x1b[?25l\x1b[?2004h\x1b[?25l\x1b[?25h\rsuccess\x1b[K\r\n\x1b[K\r\x1b[2K\r\x1b[?2004l\x1b[?25h\x1b[?1002l\x1b[?1003l\x1b[?1006l'
    },
    {
      name: 'bp_stop_start',
      cmds: [DisableBracketedPaste, EnableBracketedPaste],
      expected:
        '\x1b[?25l\x1b[?2004h\x1b[?2004l\x1b[?2004h\rsuccess\x1b[K\r\n\x1b[K\r\x1b[2K\r\x1b[?2004l\x1b[?25h\x1b[?1002l\x1b[?1003l\x1b[?1006l'
    }
  ];

  for (const { name, cmds, expected } of cases) {
    it(name, async () => {
      const { program, readOutput } = createProgram();
      const runPromise = program.run();
      void sendSequence(program, cmds);
      const result = await runPromise;
      expect(result.err).toBeNull();
      expect(readOutput()).toBe(expected);
    });
  }
});

const expectSequences = (output: string, sequences: string[]) => {
  for (const seq of sequences) {
    expect(output).toContain(seq);
  }
};

describe('Report focus controls', () => {
  it('enables and disables reporting via commands', async () => {
    const { program, readOutput } = createProgram();
    const runPromise = program.run();
    void sendSequence(program, [EnableReportFocus, DisableReportFocus]);
    const result = await runPromise;
    expect(result.err).toBeNull();
    const output = readOutput();
    expectSequences(output, ['\x1b[?1004h', '\x1b[?1004l']);
    expect(output.indexOf('\x1b[?1004h')).toBeLessThan(output.lastIndexOf('\x1b[?1004l'));
  });

  it('enables focus reports at startup when configured', async () => {
    const { program, readOutput } = createProgram(WithReportFocus());
    const runPromise = program.run();
    void sendSequence(program, []);
    const result = await runPromise;
    expect(result.err).toBeNull();
    const output = readOutput();
    expectSequences(output, ['\x1b[?1004h', '\x1b[?1004l']);
  });
});

describe('Mouse startup options', () => {
  it('enables cell motion + SGR when configured', async () => {
    const { program, readOutput } = createProgram(WithMouseCellMotion());
    const runPromise = program.run();
    void sendSequence(program, []);
    const result = await runPromise;
    expect(result.err).toBeNull();
    const output = readOutput();
    expectSequences(output, ['\x1b[?1002h', '\x1b[?1006h']);
  });

  it('enables all motion + SGR when configured', async () => {
    const { program, readOutput } = createProgram(WithMouseAllMotion());
    const runPromise = program.run();
    void sendSequence(program, []);
    const result = await runPromise;
    expect(result.err).toBeNull();
    const output = readOutput();
    expectSequences(output, ['\x1b[?1003h', '\x1b[?1006h']);
  });
});
