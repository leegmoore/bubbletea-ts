import { createRequire } from 'node:module';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Cmd, Model, Msg, Program, WindowSizeMsg } from '@bubbletea/tea';
import { NewProgram, WithInput, WithOutput } from '@bubbletea/tea';
import {
  resetWindowsConsoleBindingLoaderForTests,
  setWindowsBindingModuleLoaderForTests
} from '@bubbletea/tea/internal/windows/binding-loader';

import { waitFor, withTimeout } from '../utils/async';
import { FakeWindowsConsoleBinding } from '../utils/windows-console-harness';

const WINDOW_SIZE_MSG = 'bubbletea/window-size';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isWindowSizeMsg = (msg: Msg): msg is WindowSizeMsg =>
  isRecord(msg) && (msg as { type?: unknown }).type === WINDOW_SIZE_MSG;

const awaitRun = (program: Program, timeoutMs = 3000) => withTimeout(program.run(), timeoutMs);

class WindowSizeRecorder implements Model {
  public readonly sizes: Array<{ width: number; height: number }> = [];

  init(): Cmd {
    return null;
  }

  update(msg: Msg) {
    if (isWindowSizeMsg(msg)) {
      this.sizes.push({ width: msg.width, height: msg.height });
    }
    return [this, null] as const;
  }

  view(): string {
    return '';
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

const nativeRequire = createRequire(import.meta.url);

const mockWindowsPlatform = () => vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');

let activeBindingFactory: (() => FakeWindowsConsoleBinding) | null = null;

const installLoaderBinding = (): FakeWindowsConsoleBinding => {
  const binding = new FakeWindowsConsoleBinding();
  activeBindingFactory = () => binding;
  return binding;
};

const installModuleResolver = () => {
  setWindowsBindingModuleLoaderForTests((specifier) => {
    if (specifier === '@bubbletea/windows-binding' || specifier === '@bubbletea/windows-binding-ffi') {
      if (!activeBindingFactory) {
        throw new Error('Test Windows binding factory not installed');
      }
      return {
        createWindowsConsoleBinding: activeBindingFactory
      } satisfies Record<string, unknown>;
    }
    return nativeRequire(specifier);
  });
};

const createProgram = (
  output: NodeJS.WritableStream,
  overrides: { columns?: number; rows?: number } = {}
) => {
  const input = new PassThrough();
  const model = new WindowSizeRecorder();
  if (output instanceof FakeWindowsTtyOutput) {
    if (typeof overrides.columns === 'number') {
      output.columns = overrides.columns;
    }
    if (typeof overrides.rows === 'number') {
      output.rows = overrides.rows;
    }
  }
  const program = NewProgram(model, WithInput(input), WithOutput(output));
  return { program, model, input, output };
};

const expectGracefulExit = async (result: Awaited<ReturnType<Program['run']>>) => {
  expect(result.err).toBeNull();
};

beforeEach(() => {
  activeBindingFactory = null;
  resetWindowsConsoleBindingLoaderForTests();
  installModuleResolver();
});

afterEach(() => {
  activeBindingFactory = null;
  resetWindowsConsoleBindingLoaderForTests();
  setWindowsBindingModuleLoaderForTests(null);
});

describe('Windows console resize propagation', () => {
  it('delivers WindowSizeMsg entries for WINDOW_BUFFER_SIZE records', async () => {
    const platformSpy = mockWindowsPlatform();
    const binding = installLoaderBinding();
    const output = new FakeWindowsTtyOutput(91, 35);
    const { program, model } = createProgram(output);
    const runPromise = awaitRun(program);

    try {
      await waitFor(() => binding.latestPseudoConsoleHandle() !== undefined);
      await waitFor(() => model.sizes.length >= 1);
      expect(model.sizes[0]).toEqual({ width: 91, height: 35 });

      const pseudoHandle = binding.latestPseudoConsoleHandle();
      expect(pseudoHandle).toBeDefined();
      const handles = pseudoHandle ? binding.pseudoConsoleHandles(pseudoHandle) : undefined;
      expect(handles).toBeDefined();

      const nextSize = { columns: 120, rows: 60 } as const;
      binding.queueWindowResizeEvent(handles!.input, nextSize);

      await waitFor(() => model.sizes.length >= 2);

      program.quit();
      const result = await runPromise;
      expectGracefulExit(result);

      const [_initial, resize] = model.sizes;
      expect(resize).toEqual({ width: nextSize.columns, height: nextSize.rows });
    } finally {
      platformSpy.mockRestore();
    }
  });

  it('tears down the pseudo console when the program stops', async () => {
    const platformSpy = mockWindowsPlatform();
    const binding = installLoaderBinding();
    const output = new FakeWindowsTtyOutput(80, 24);
    const { program } = createProgram(output);
    const runPromise = awaitRun(program);

    try {
      await waitFor(() => binding.latestPseudoConsoleHandle() !== undefined);
      const pseudoHandle = binding.latestPseudoConsoleHandle();
      expect(pseudoHandle).toBeDefined();
      const handles = pseudoHandle ? binding.pseudoConsoleHandles(pseudoHandle) : undefined;
      expect(handles).toBeDefined();

      program.quit();
      const result = await runPromise;
      expectGracefulExit(result);

      expect(binding.closePseudoConsoleCalls).toContain(pseudoHandle);
      if (handles) {
        expect(binding.cancelIoCalls).toContain(handles.input);
      }
    } finally {
      platformSpy.mockRestore();
    }
  });
});
