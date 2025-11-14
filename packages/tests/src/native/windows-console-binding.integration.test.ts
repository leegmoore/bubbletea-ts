import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type {
  WindowsConsoleBinding,
  WindowsInputRecord,
  WindowsPseudoConsole
} from '@bubbletea/tea/internal';
import type { WindowsConsoleInputHarness } from './windows-console-input-harness';

const isWindowsHost = process.platform === 'win32';
const describeOnWindows = isWindowsHost ? describe : describe.skip;

const loadWindowsConsoleBinding = async (): Promise<WindowsConsoleBinding> => {
  if (!isWindowsHost) {
    throw new Error('windows console binding tests only run on Windows hosts');
  }
  const moduleId = '@bubbletea/windows-binding';
  const mod: unknown = await import(moduleId);
  if (!mod || typeof mod !== 'object' || mod === null) {
    throw new Error(`module "${moduleId}" did not export an object`);
  }
  const factory = (mod as { createWindowsConsoleBinding?: () => WindowsConsoleBinding })
    .createWindowsConsoleBinding;
  if (typeof factory !== 'function') {
    throw new Error(`module "${moduleId}" is missing createWindowsConsoleBinding()`);
  }
  return factory();
};

const nextRecord = async (
  pseudo: WindowsPseudoConsole,
  binding: WindowsConsoleBinding
): Promise<IteratorResult<WindowsInputRecord>> => {
  const iterator = binding.readConsoleInput(pseudo.input)[Symbol.asyncIterator]();
  try {
    const result = await iterator.next();
    return result;
  } finally {
    await iterator.return?.();
  }
};

describeOnWindows('WindowsConsoleBinding (native integration)', () => {
  let binding: WindowsConsoleBinding;
  let inputHarness: WindowsConsoleInputHarness | undefined;
  const pseudoConsoles: WindowsPseudoConsole[] = [];

  const createPseudoConsole = (): WindowsPseudoConsole => {
    const pseudo = binding.createPseudoConsole({ columns: 80, rows: 24 });
    pseudoConsoles.push(pseudo);
    return pseudo;
  };

  beforeAll(async () => {
    if (isWindowsHost) {
      const mod = await import('./windows-console-input-harness');
      inputHarness = mod.createWindowsConsoleInputHarness();
    }
  });

  beforeEach(async () => {
    binding = await loadWindowsConsoleBinding();
  });

  afterEach(() => {
    while (pseudoConsoles.length > 0) {
      const pseudo = pseudoConsoles.pop();
      if (!pseudo) {
        continue;
      }
      binding.closePseudoConsole(pseudo.handle);
    }
  });

  it('emits window-buffer-size records when pseudo consoles resize', async () => {
    const pseudo = createPseudoConsole();
    const pending = nextRecord(pseudo, binding);
    const nextSize = { columns: 120, rows: 40 } as const;

    binding.resizePseudoConsole(pseudo.handle, nextSize);

    const record = await pending;
    expect(record.done).toBe(false);
    expect(record.value).toEqual({
      type: 'window-buffer-size',
      size: nextSize
    });
  });

  it('completes read iterators when pseudo consoles close', async () => {
    const pseudo = createPseudoConsole();
    const iterator = binding.readConsoleInput(pseudo.input)[Symbol.asyncIterator]();
    const pending = iterator.next();

    binding.closePseudoConsole(pseudo.handle);

    const result = await pending;
    expect(result.done).toBe(true);
    await iterator.return?.();
  });

  it('cancels pending reads when cancelIo is invoked', async () => {
    const pseudo = createPseudoConsole();
    const iterator = binding.readConsoleInput(pseudo.input)[Symbol.asyncIterator]();
    const pending = iterator.next();

    binding.cancelIo(pseudo.input);

    const result = await pending;
    expect(result.done).toBe(true);
    await iterator.return?.();
  });

  it('emits KEY_EVENT records when WriteConsoleInputW injects keypresses', async () => {
    const pseudo = createPseudoConsole();
    const iterator = binding.readConsoleInput(pseudo.input)[Symbol.asyncIterator]();
    const harness = ensureHarness(inputHarness);

    harness.writeKeyEvent(pseudo.input, {
      keyDown: true,
      repeatCount: 2,
      virtualKeyCode: 0x41,
      virtualScanCode: 0x1e,
      charCode: 'A'.charCodeAt(0),
      controlKeyState: 0
    });
    harness.writeKeyEvent(pseudo.input, {
      keyDown: false,
      repeatCount: 1,
      virtualKeyCode: 0x41,
      virtualScanCode: 0x1e,
      charCode: 0,
      controlKeyState: 0
    });

    const down = await iterator.next();
    expect(down.done).toBe(false);
    expect(down.value).toEqual({
      type: 'key',
      keyDown: true,
      repeatCount: 2,
      charCode: 65,
      virtualKeyCode: 0x41,
      controlKeyState: 0
    });

    const up = await iterator.next();
    expect(up.done).toBe(false);
    expect(up.value).toEqual({
      type: 'key',
      keyDown: false,
      repeatCount: 1,
      charCode: 0,
      virtualKeyCode: 0x41,
      controlKeyState: 0
    });
    await iterator.return?.();
  });

  it('emits MOUSE_EVENT records with wheel + button data', async () => {
    const pseudo = createPseudoConsole();
    const iterator = binding.readConsoleInput(pseudo.input)[Symbol.asyncIterator]();
    const harness = ensureHarness(inputHarness);

    harness.writeMouseEvent(pseudo.input, {
      position: { x: 12, y: 34 },
      buttonState: 0x0002,
      controlKeyState: 0x0008,
      eventFlags: 0x0004
    });

    const record = await iterator.next();
    expect(record.done).toBe(false);
    expect(record.value).toEqual({
      type: 'mouse',
      position: { x: 12, y: 34 },
      buttonState: 0x0002,
      controlKeyState: 0x0008,
      eventFlags: 0x0004
    });
    await iterator.return?.();
  });
});

const ensureHarness = (harness: WindowsConsoleInputHarness | undefined): WindowsConsoleInputHarness => {
  if (!harness) {
    throw new Error('windows console input harness is not available outside Windows hosts');
  }
  return harness;
};
