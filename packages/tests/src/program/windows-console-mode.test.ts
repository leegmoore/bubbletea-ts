import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Model, Msg, Program } from '@bubbletea/tea';
import {
  DisableMouse,
  EnableMouseAllMotion,
  EnableMouseCellMotion,
  NewProgram,
  WithInput,
  WithMouseAllMotion,
  WithOutput
} from '@bubbletea/tea';
import {
  WINDOWS_ENABLE_EXTENDED_FLAGS,
  WINDOWS_ENABLE_MOUSE_INPUT,
  WINDOWS_ENABLE_WINDOW_INPUT,
  setWindowsConsoleBindingForTests
} from '@bubbletea/tea/internal';

import { waitFor, withTimeout } from '../utils/async';
import { FakeWindowsConsoleBinding } from '../utils/windows-console-harness';

const awaitRun = (program: Program, timeoutMs = 4000) => withTimeout(program.run(), timeoutMs);

class IdleModel implements Model {
  init() {
    return null;
  }

  update(_msg: Msg) {
    return [this, null] as const;
  }

  view(): string {
    return '';
  }
}

class FakeWindowsTtyInput extends PassThrough {
  public isTTY = true;
  public fd: number;
  public isRaw = false;

  constructor(fd = 200) {
    super();
    this.fd = fd;
  }

  setRawMode(mode: boolean): this {
    this.isRaw = mode;
    return this;
  }
}

class FakeWindowsTtyOutput extends PassThrough {
  public isTTY = true;
  public columns: number;
  public rows: number;

  constructor(columns = 80, rows = 24) {
    super();
    this.columns = columns;
    this.rows = rows;
  }
}

const mockWindowsPlatform = () => vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');

const installFakeBinding = () => {
  const binding = new FakeWindowsConsoleBinding();
  setWindowsConsoleBindingForTests(binding);
  return binding;
};

const baseFlags = WINDOWS_ENABLE_WINDOW_INPUT | WINDOWS_ENABLE_EXTENDED_FLAGS;

const expectModeEventually = async (
  binding: FakeWindowsConsoleBinding,
  handle: number,
  predicate: (mode: number) => boolean
) => {
  await waitFor(() => predicate(binding.modeFor(handle) ?? 0));
  return binding.modeFor(handle) ?? 0;
};

afterEach(() => {
  setWindowsConsoleBindingForTests(null);
  vi.restoreAllMocks();
});

describe('Windows console mode flags', () => {
  it('enables base flags and mouse input when mouse motion is enabled at startup', async () => {
    const platformSpy = mockWindowsPlatform();
    const binding = installFakeBinding();
    const inputHandle = 301;
    const input = new FakeWindowsTtyInput(inputHandle);
    const output = new FakeWindowsTtyOutput();
    const program = NewProgram(new IdleModel(), WithInput(input), WithOutput(output), WithMouseAllMotion());
    const runPromise = awaitRun(program);

    try {
      const mode = await expectModeEventually(binding, inputHandle, (value) =>
        (value & baseFlags) === baseFlags && (value & WINDOWS_ENABLE_MOUSE_INPUT) !== 0
      );

      expect(mode & baseFlags).toBe(baseFlags);
      expect(mode & WINDOWS_ENABLE_MOUSE_INPUT).toBe(WINDOWS_ENABLE_MOUSE_INPUT);

      program.quit();
      await runPromise;
    } finally {
      platformSpy.mockRestore();
    }
  });

  it('toggles the mouse flag when EnableMouse*/DisableMouse commands run', async () => {
    const platformSpy = mockWindowsPlatform();
    const binding = installFakeBinding();
    const inputHandle = 305;
    const input = new FakeWindowsTtyInput(inputHandle);
    const output = new FakeWindowsTtyOutput();
    const program = NewProgram(new IdleModel(), WithInput(input), WithOutput(output));
    const runPromise = awaitRun(program);

    try {
      await expectModeEventually(binding, inputHandle, (value) => (value & baseFlags) === baseFlags);

      await program.send(EnableMouseCellMotion());

      await expectModeEventually(binding, inputHandle, (value) =>
        (value & WINDOWS_ENABLE_MOUSE_INPUT) === WINDOWS_ENABLE_MOUSE_INPUT
      );

      await program.send(DisableMouse());

      await expectModeEventually(binding, inputHandle, (value) =>
        (value & WINDOWS_ENABLE_MOUSE_INPUT) === 0
      );

      await program.send(EnableMouseAllMotion());

      await expectModeEventually(binding, inputHandle, (value) =>
        (value & WINDOWS_ENABLE_MOUSE_INPUT) === WINDOWS_ENABLE_MOUSE_INPUT
      );

      program.quit();
      await runPromise;
    } finally {
      platformSpy.mockRestore();
    }
  });
});

