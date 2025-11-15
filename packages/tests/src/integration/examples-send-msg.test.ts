import { describe, expect, it } from 'vitest';

import type { Program } from '@bubbletea/tea';
import { KeyMsg, Model, Msg, NewProgram, Quit, WithInput, WithOutput } from '@bubbletea/tea';

import { FakeTtyInput, FakeTtyOutput } from '../utils/fake-tty';
import { FakeSpinner } from './utils/fake-spinner';

const RESULT_MSG_TYPE = 'examples/send-msg/result';
const DOT_LINE = '.'.repeat(30);

interface ResultMsg {
  readonly type: typeof RESULT_MSG_TYPE;
  readonly food: string;
  readonly durationMs: number;
}

type ResultEntry = ResultMsg | null;

const createResultMsg = (food: string, durationMs: number): ResultMsg => ({
  type: RESULT_MSG_TYPE,
  food,
  durationMs
});

const isResultMsg = (msg: Msg): msg is ResultMsg =>
  typeof msg === 'object' &&
  msg !== null &&
  (msg as ResultMsg).type === RESULT_MSG_TYPE;

const isKeyMsg = (msg: Msg): msg is KeyMsg =>
  typeof msg === 'object' && msg !== null && typeof (msg as KeyMsg).type === 'number';

const formatDuration = (durationMs: number): string => `${durationMs}ms`;

const renderResultLine = (result: ResultEntry): string => {
  if (!result || result.durationMs === 0) {
    return DOT_LINE;
  }
  return `🍔 Ate ${result.food} ${formatDuration(result.durationMs)}`;
};

class SendMsgExampleModel implements Model {
  public quitting = false;
  public results: ResultEntry[];

  constructor(private readonly spinner: FakeSpinner, private readonly maxResults = 5) {
    this.results = Array.from({ length: this.maxResults }, () => null);
  }

  init() {
    return this.spinner.Tick;
  }

  update(msg: Msg) {
    if (isKeyMsg(msg)) {
      this.quitting = true;
      return [this, Quit] as const;
    }

    if (isResultMsg(msg)) {
      this.results = [...this.results.slice(1), msg];
      return [this] as const;
    }

    const [, cmd] = this.spinner.update(msg);
    return [this, cmd] as const;
  }

  view(): string {
    const header = this.quitting ? "That's all for today!" : `${this.spinner.view()} Eating food...`;
    const body = this.results.map((res) => renderResultLine(res)).join('\n');
    const help = this.quitting ? '' : '\nPress any key to exit';
    const trailingNewline = this.quitting ? '\n' : '';
    return `${header}\n\n${body}\n${help}${trailingNewline}`;
  }
}

describe('Integration: examples/send-msg', () => {
  it('records the last five meals sent via program.send()', async () => {
    const input = new FakeTtyInput(false);
    const output = new FakeTtyOutput();
    const script = [
      createResultMsg('an apple', 125),
      createResultMsg('some ramen', 480),
      createResultMsg('a currywurst', 300),
      createResultMsg('a party gherkin', 180),
      createResultMsg('tacos', 510),
      createResultMsg('some cashews', 275),
      createResultMsg('a sandwich', 640)
    ];

    let program: Program;
    const spinner = new FakeSpinner(undefined, (tickIndex) => {
      const message = script[tickIndex];
      if (message) {
        void program.send(message).catch(() => undefined);
      }
      if (tickIndex === script.length + 1) {
        input.end('k');
      }
    });
    const model = new SendMsgExampleModel(spinner);
    program = NewProgram(model, WithInput(input), WithOutput(output));

    const result = await program.run();
    expect(result.err).toBeNull();
    expect(result.model).toBe(model);
    expect(model.quitting).toBe(true);

    const expectedWindow = script.slice(-5);
    expect(model.results).toEqual(expectedWindow);
    const view = model.view();
    expectedWindow.forEach((entry) => {
      const durationText = formatDuration(entry.durationMs);
      expect(view).toContain(entry.food);
      expect(view).toContain(durationText);
    });
    expect(view).toContain("That's all for today!");
  });

  it('renders placeholder entries until any external messages arrive', async () => {
    const input = new FakeTtyInput(false);
    const output = new FakeTtyOutput();
    const spinner = new FakeSpinner();
    const model = new SendMsgExampleModel(spinner);
    const program = NewProgram(model, WithInput(input), WithOutput(output));

    queueMicrotask(() => {
      input.end('x');
    });

    const result = await program.run();
    expect(result.err).toBeNull();
    expect(model.quitting).toBe(true);
    expect(model.results.every((entry) => entry === null)).toBe(true);

    const view = model.view();
    expect(view).toContain(DOT_LINE);
    expect(view).not.toContain('Press any key to exit');
  });
});
