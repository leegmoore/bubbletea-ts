import { createRequire } from 'node:module';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Model, Msg, Program } from '@bubbletea/tea';
import {
  DisableMouse,
  EnableMouseAllMotion,
  EnableMouseCellMotion,
  ProgramKilledError,
  ProgramPanicError,
  NewProgram,
  WithInput,
  WithMouseAllMotion,
  WithOutput
} from '@bubbletea/tea';
import {
  WINDOWS_ENABLE_EXTENDED_FLAGS,
  WINDOWS_ENABLE_MOUSE_INPUT,
  WINDOWS_ENABLE_WINDOW_INPUT
} from '@bubbletea/tea/internal';
import {
  BubbleTeaWindowsBindingError,
  resetWindowsConsoleBindingLoaderForTests,
  setWindowsBindingModuleLoaderForTests
} from '@bubbletea/tea/internal/windows/binding-loader';

import { waitFor, withTimeout } from '../utils/async';
import { FakeWindowsConsoleBinding } from '../utils/windows-console-harness';

const nativeRequire = createRequire(import.meta.url);

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

let activeBindingFactory: (() => FakeWindowsConsoleBinding) | null = null;

const installLoaderBinding = (): FakeWindowsConsoleBinding => {
  const binding = new FakeWindowsConsoleBinding();
  activeBindingFactory = () => binding;
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

const installModuleResolver = () => {
  setWindowsBindingModuleLoaderForTests((specifier) => {
    if (specifier === '@bubbletea/windows-binding' || specifier === '@bubbletea/windows-binding-ffi') {
      if (!activeBindingFactory) {
        throw new Error('Test Windows binding factory not installed');
      }
      return {
        createWindowsConsoleBinding: activeBindingFactory
      };
    }
    return nativeRequire(specifier);
  });
};

beforeEach(() => {
  activeBindingFactory = null;
  resetWindowsConsoleBindingLoaderForTests();
  installModuleResolver();
});

afterEach(() => {
  vi.restoreAllMocks();
  activeBindingFactory = null;
  resetWindowsConsoleBindingLoaderForTests();
  setWindowsBindingModuleLoaderForTests(null);
});

describe('Windows console binding loader failures', () => {
  it('surfaces BubbleTeaWindowsBindingError via Program.run()', async () => {
    const platformSpy = mockWindowsPlatform();
    const previousAllowFfi = process.env.BUBBLETEA_WINDOWS_BINDING_ALLOW_FFI;
    process.env.BUBBLETEA_WINDOWS_BINDING_ALLOW_FFI = '1';
    resetWindowsConsoleBindingLoaderForTests();
    setWindowsBindingModuleLoaderForTests((specifier) => {
      if (specifier === '@bubbletea/windows-binding' || specifier === '@bubbletea/windows-binding-ffi') {
        throw new Error(`module not found: ${specifier}`);
      }
      return nativeRequire(specifier);
    });

    try {
      const program = NewProgram(
        new IdleModel(),
        WithInput(new FakeWindowsTtyInput()),
        WithOutput(new FakeWindowsTtyOutput())
      );
      const result = await awaitRun(program);

      expect(result.err).toBeInstanceOf(ProgramKilledError);
      const killErr = result.err as ProgramKilledError;
      expect(killErr.cause).toBeInstanceOf(ProgramPanicError);
      const panicErr = killErr.cause as ProgramPanicError;
      expect(panicErr.cause).toBeInstanceOf(BubbleTeaWindowsBindingError);
      const bindingError = panicErr.cause as BubbleTeaWindowsBindingError;
      expect(bindingError.attempts).toEqual([
        expect.objectContaining({ kind: 'addon', specifier: '@bubbletea/windows-binding' }),
        expect.objectContaining({ kind: 'ffi', specifier: '@bubbletea/windows-binding-ffi' })
      ]);
    } finally {
      platformSpy.mockRestore();
      if (previousAllowFfi === undefined) {
        delete process.env.BUBBLETEA_WINDOWS_BINDING_ALLOW_FFI;
      } else {
        process.env.BUBBLETEA_WINDOWS_BINDING_ALLOW_FFI = previousAllowFfi;
      }
    }
  });
});

describe('Windows console mode flags', () => {
  it('enables base flags and mouse input when mouse motion is enabled at startup', async () => {
    const platformSpy = mockWindowsPlatform();
    const binding = installLoaderBinding();
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
    const binding = installLoaderBinding();
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

  it('restores the original console mode on release and allows mouse toggles after restore', async () => {
    const platformSpy = mockWindowsPlatform();
    const binding = installLoaderBinding();
    const inputHandle = 309;
    const originalMode = 0x0400;
    const input = new FakeWindowsTtyInput(inputHandle);
    const output = new FakeWindowsTtyOutput();
    binding.seedConsoleMode(inputHandle, originalMode);
    const program = NewProgram(new IdleModel(), WithInput(input), WithOutput(output));
    const runPromise = awaitRun(program);

    try {
      await expectModeEventually(binding, inputHandle, (value) => (value & baseFlags) === baseFlags);

      await program.send(EnableMouseCellMotion());

      await expectModeEventually(binding, inputHandle, (value) =>
        (value & WINDOWS_ENABLE_MOUSE_INPUT) === WINDOWS_ENABLE_MOUSE_INPUT
      );

      program.releaseTerminal();

      await expectModeEventually(binding, inputHandle, (value) => value === originalMode);

      program.restoreTerminal();

      await expectModeEventually(binding, inputHandle, (value) =>
        (value & baseFlags) === baseFlags &&
        (value & WINDOWS_ENABLE_MOUSE_INPUT) === 0
      );

      await program.send(EnableMouseCellMotion());

      await expectModeEventually(binding, inputHandle, (value) =>
        (value & WINDOWS_ENABLE_MOUSE_INPUT) === WINDOWS_ENABLE_MOUSE_INPUT
      );

      await program.send(DisableMouse());

      await expectModeEventually(binding, inputHandle, (value) =>
        (value & WINDOWS_ENABLE_MOUSE_INPUT) === 0
      );

      program.quit();
      await runPromise;
    } finally {
      platformSpy.mockRestore();
    }
  });
});
