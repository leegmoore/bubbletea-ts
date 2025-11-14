import { describe, expect, it } from 'vitest';
import type { BatchMsg, Cmd, QuitMsg } from '@bubbletea/tea';
import { Batch, Every, Quit, Sequence, Sequentially, Tick } from '@bubbletea/tea';
import { runCmd } from '../utils/cmd';
import { advanceBy, withFakeTimers } from '../utils/fakeTimers';

const runTimersFor = async (ms: number) => {
  await advanceBy(ms);
};

describe('Every', () => {
  it('returns the message created by the callback', async () => {
    await withFakeTimers(async () => {
      const expected = 'every ms';
      const cmd = Every(1, () => expected);
      const msgPromise = runCmd<string>(cmd);
      await runTimersFor(1);
      await expect(msgPromise).resolves.toBe(expected);
    });
  });
});

describe('Tick', () => {
  it('returns the message created by the callback', async () => {
    await withFakeTimers(async () => {
      const expected = 'tick';
      const cmd = Tick(1, () => expected);
      const msgPromise = runCmd<string>(cmd);
      await runTimersFor(1);
      await expect(msgPromise).resolves.toBe(expected);
    });
  });
});

describe('Sequentially', () => {
  const expectedErrMsg = new Error('some err');
  const expectedStrMsg = 'some msg';
  const nilReturnCmd: Cmd = () => null;

  const table = [
    {
      name: 'all nil returns nil',
      cmds: [nilReturnCmd, nilReturnCmd],
      expected: null
    },
    {
      name: 'null cmds returns nil',
      cmds: [null, null],
      expected: null
    },
    {
      name: 'one error returns the error',
      cmds: [
        nilReturnCmd,
        () => expectedErrMsg,
        nilReturnCmd
      ],
      expected: expectedErrMsg
    },
    {
      name: 'some msg returns the msg',
      cmds: [
        nilReturnCmd,
        () => expectedStrMsg,
        nilReturnCmd
      ],
      expected: expectedStrMsg
    }
  ] as const;

  for (const { name, cmds, expected } of table) {
    it(name, async () => {
      const result = await runCmd<Error | string | null | undefined>(
        Sequentially(...cmds) as Cmd<Error | string | null | undefined>
      );
      expect(result).toBe(expected);
    });
  }
});

const testMultipleCommands = (
  label: string,
  createFn: (...cmds: Cmd[]) => Cmd
) => {
  const nilCmd: Cmd = null;
  describe(label, () => {
    it('returns null when provided only nil cmd', () => {
      expect(createFn(nilCmd)).toBeNull();
    });

    it('returns null when provided no cmds', () => {
      expect(createFn()).toBeNull();
    });

    it('passes through a single cmd', async () => {
      const result = await runCmd<QuitMsg>(createFn(Quit) as Cmd<QuitMsg>);
      expect(result).toStrictEqual({ type: 'bubbletea/quit' });
    });

    it('filters nil cmds and returns the remainder as a batch msg', async () => {
      const msg = await runCmd<BatchMsg>(
        createFn(nilCmd, Quit, nilCmd, Quit, nilCmd, nilCmd) as Cmd<BatchMsg>
      );
      expect(Array.isArray(msg)).toBe(true);
      expect((msg as BatchMsg).length).toBe(2);
    });
  });
};

testMultipleCommands('Batch', Batch);
testMultipleCommands('Sequence', Sequence);
