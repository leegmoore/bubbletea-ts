import { describe, expect, it, vi } from 'vitest';

import {
  Cmd,
  KeyMsg,
  Model,
  Msg,
  NewProgram,
  Quit,
  SetWindowTitle,
  WithInput,
  WithOutput,
  keyToString
} from '@bubbletea/tea';

import { FakeTtyInput, FakeTtyOutput } from '../utils/fake-tty';

const isKeyMsg = (msg: Msg): msg is KeyMsg =>
  typeof msg === 'object' && msg !== null && typeof (msg as KeyMsg).type === 'number';

class GroceryListModel implements Model {
  public cursor = 0;
  public readonly choices = ['Buy carrots', 'Buy celery', 'Buy kohlrabi'];
  public readonly selected = new Set<number>();

  init(): Cmd {
    return SetWindowTitle('Grocery List');
  }

  update(msg: Msg) {
    if (!isKeyMsg(msg)) {
      return [this] as const;
    }

    const key = keyToString(msg);

    switch (key) {
      case 'ctrl+c':
      case 'q':
        return [this, Quit] as const;
      case 'up':
      case 'k':
        if (this.cursor > 0) {
          this.cursor -= 1;
        }
        return [this] as const;
      case 'down':
      case 'j':
        if (this.cursor < this.choices.length - 1) {
          this.cursor += 1;
        }
        return [this] as const;
      case 'enter':
      case ' ': {
        this.toggleSelection(this.cursor);
        return [this] as const;
      }
      default:
        return [this] as const;
    }
  }

  view(): string {
    const lines = ['What should we buy at the market?', ''];
    for (let index = 0; index < this.choices.length; index += 1) {
      const cursorChar = this.cursor === index ? '>' : ' ';
      const checked = this.selected.has(index) ? 'x' : ' ';
      lines.push(`${cursorChar} [${checked}] ${this.choices[index]}`);
    }
    lines.push('', 'Press q to quit.', '');
    return lines.join('\n');
  }

  private toggleSelection(index: number): void {
    if (this.selected.has(index)) {
      this.selected.delete(index);
    } else {
      this.selected.add(index);
    }
  }
}

describe('Integration: tutorials/basics', () => {
  it('mirrors the grocery-list tutorial', async () => {
    const input = new FakeTtyInput(false);
    const output = new FakeTtyOutput();
    const model = new GroceryListModel();
    const program = NewProgram(model, WithInput(input), WithOutput(output));
    const titleSpy = vi.spyOn(program.renderer, 'setWindowTitle');

    const runPromise = program.run();

    input.write(' ');
    input.write('j');
    input.write(' ');
    input.write('j');
    input.write(' ');
    input.write('k');
    input.write(' ');
    input.end('q');

    const result = await runPromise;
    expect(result.err).toBeNull();

    expect(titleSpy).toHaveBeenCalledWith('Grocery List');

    const expectedView = [
      'What should we buy at the market?',
      '',
      '  [x] Buy carrots',
      '> [ ] Buy celery',
      '  [x] Buy kohlrabi',
      '',
      'Press q to quit.',
      ''
    ].join('\n');
    expect(model.view()).toBe(expectedView);
  });
});
