import { createRequire } from 'node:module';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { KeyMsg, Model, Msg, MouseMsg, Program } from '@bubbletea/tea';
import {
  DisableMouse,
  EnableMouseAllMotion,
  EnableMouseCellMotion,
  KeyType,
  MouseAction,
  MouseButton,
  MouseEventType,
  NewProgram,
  WithInput,
  WithMouseAllMotion,
  WithMouseCellMotion,
  WithOutput
} from '@bubbletea/tea';
import {
  resetWindowsConsoleBindingLoaderForTests,
  setWindowsBindingModuleLoaderForTests
} from '@bubbletea/tea/internal/windows/binding-loader';

import { sleep, waitFor, withTimeout } from '../utils/async';
import { FakeWindowsConsoleBinding } from '../utils/windows-console-harness';

const WINDOWS_LEFT_ALT_PRESSED = 0x0002;
const WINDOWS_RIGHT_ALT_PRESSED = 0x0001;
const WINDOWS_LEFT_CTRL_PRESSED = 0x0008;
const WINDOWS_RIGHT_CTRL_PRESSED = 0x0004;
const WINDOWS_SHIFT_PRESSED = 0x0010;

const WINDOWS_FROM_LEFT_1ST_BUTTON = 0x0001;
const WINDOWS_RIGHTMOST_BUTTON = 0x0002;
const WINDOWS_FROM_LEFT_2ND_BUTTON = 0x0004;

const WINDOWS_MOUSE_EVENT_MOVED = 0x0001;
const WINDOWS_MOUSE_EVENT_DOUBLE_CLICK = 0x0002;
const WINDOWS_MOUSE_EVENT_WHEELED = 0x0004;
const WINDOWS_MOUSE_EVENT_HWHEELED = 0x0008;

const WINDOWS_VK_RETURN = 0x0d;
const WINDOWS_VK_A = 0x41;
const WINDOWS_VK_UP = 0x26;
const WINDOWS_VK_SHIFT = 0x10;
const WINDOWS_VK_ESCAPE = 0x1b;

const encodeWheelDelta = (delta: number): number => ((delta & 0xffff) << 16) >>> 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isKeyMsg = (msg: Msg): msg is KeyMsg => isRecord(msg) && typeof (msg as KeyMsg).type === 'number';

const isMouseMsg = (msg: Msg): msg is MouseMsg => isRecord(msg) && typeof (msg as MouseMsg).Button === 'number';

const awaitRun = (program: Program, timeoutMs = 4000) => withTimeout(program.run(), timeoutMs);

class FakeWindowsTtyInput extends PassThrough {
  public isTTY = true;
  public fd: number;
  public isRaw = false;

  constructor(fd = 50) {
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
  public fd: number;
  public columns: number;
  public rows: number;

  constructor(columns = 80, rows = 24, fd = 60) {
    super();
    this.columns = columns;
    this.rows = rows;
    this.fd = fd;
  }
}

class MessageRecorder implements Model {
  public readonly messages: Msg[] = [];

  init() {
    return null;
  }

  update(msg: Msg) {
    this.messages.push(msg);
    return [this, null] as const;
  }

  view(): string {
    return '';
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

const waitForPseudoHandles = async (binding: FakeWindowsConsoleBinding) => {
  let handles: { input: number; output: number } | undefined;
  await waitFor(() => {
    const handle = binding.latestPseudoConsoleHandle();
    if (!handle) {
      return false;
    }
    const resolved = binding.pseudoConsoleHandles(handle);
    if (!resolved) {
      return false;
    }
    handles = resolved;
    return true;
  });
  return handles!;
};

const collectKeyMsgs = (recorder: MessageRecorder): KeyMsg[] =>
  recorder.messages.filter(isKeyMsg);

const collectMouseMsgs = (recorder: MessageRecorder): MouseMsg[] =>
  recorder.messages.filter(isMouseMsg);

const readWindowsMouseMode = (program: Program): string | undefined =>
  (program as unknown as { windowsMouseTracking?: string }).windowsMouseTracking;

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

describe('Windows console key input', () => {
  it('emits KeyMsg entries for Windows key records with repeat counts and modifiers', async () => {
    const platformSpy = mockWindowsPlatform();
    const binding = installLoaderBinding();
    const recorder = new MessageRecorder();
    const input = new FakeWindowsTtyInput(100);
    const output = new FakeWindowsTtyOutput(120, 30, 101);
    const program = NewProgram(recorder, WithInput(input), WithOutput(output));
    const runPromise = awaitRun(program);

    try {
      const handles = await waitForPseudoHandles(binding);
      binding.queueKeyEvent(handles.input, {
        virtualKeyCode: WINDOWS_VK_RETURN,
        charCode: 13,
        repeatCount: 2
      });
      binding.queueKeyEvent(handles.input, {
        virtualKeyCode: WINDOWS_VK_A,
        charCode: 'a'.charCodeAt(0),
        controlKeyState: WINDOWS_LEFT_ALT_PRESSED
      });

      await waitFor(() => collectKeyMsgs(recorder).length >= 3);

      const keyMsgs = collectKeyMsgs(recorder);
      expect(keyMsgs.slice(0, 2).every((msg) => msg.type === KeyType.KeyEnter)).toBe(true);
      expect(keyMsgs[2]).toEqual({
        type: KeyType.KeyRunes,
        alt: true,
        runes: ['a']
      });
    } finally {
      program.quit();
      await runPromise;
      platformSpy.mockRestore();
    }
  });

  it('maps ctrl/shift combinations and ignores key-up + shift-only records', async () => {
    const platformSpy = mockWindowsPlatform();
    const binding = installLoaderBinding();
    const recorder = new MessageRecorder();
    const program = NewProgram(recorder, WithInput(new FakeWindowsTtyInput()), WithOutput(new FakeWindowsTtyOutput()));
    const runPromise = awaitRun(program);

    try {
      const handles = await waitForPseudoHandles(binding);
      binding.queueKeyEvent(handles.input, {
        virtualKeyCode: WINDOWS_VK_SHIFT,
        keyDown: false
      });
      binding.queueKeyEvent(handles.input, {
        virtualKeyCode: WINDOWS_VK_SHIFT,
        keyDown: true
      });
      binding.queueKeyEvent(handles.input, {
        virtualKeyCode: WINDOWS_VK_UP,
        controlKeyState: WINDOWS_SHIFT_PRESSED | WINDOWS_LEFT_CTRL_PRESSED | WINDOWS_RIGHT_CTRL_PRESSED
      });

      await waitFor(() => collectKeyMsgs(recorder).length >= 1);

      const [msg] = collectKeyMsgs(recorder);
      expect(msg).toEqual({ type: KeyType.KeyCtrlShiftUp });
    } finally {
      program.quit();
      await runPromise;
      platformSpy.mockRestore();
    }
  });
});

describe('Windows console mouse input', () => {
  it('delivers mouse events only when mouse tracking is enabled and stops when disabled', async () => {
    const platformSpy = mockWindowsPlatform();
    const binding = installLoaderBinding();
    const recorder = new MessageRecorder();
    const program = NewProgram(recorder, WithInput(new FakeWindowsTtyInput()), WithOutput(new FakeWindowsTtyOutput()));
    const runPromise = awaitRun(program);

    try {
      const handles = await waitForPseudoHandles(binding);

      binding.queueMouseEvent(handles.input, {
        eventFlags: WINDOWS_MOUSE_EVENT_DOUBLE_CLICK,
        buttonState: WINDOWS_FROM_LEFT_1ST_BUTTON,
        position: { x: 5, y: 9 }
      });

      await sleep(50);
      expect(collectMouseMsgs(recorder)).toHaveLength(0);

      await program.send(EnableMouseCellMotion());
      await waitFor(() => readWindowsMouseMode(program) === 'cell', { timeoutMs: 500 });

      binding.queueMouseEvent(handles.input, {
        eventFlags: WINDOWS_MOUSE_EVENT_DOUBLE_CLICK,
        buttonState: WINDOWS_RIGHTMOST_BUTTON,
        position: { x: 2, y: 3 }
      });

      await waitFor(() => collectMouseMsgs(recorder).length >= 1);
      const [mouseMsg] = collectMouseMsgs(recorder);
      expect(mouseMsg).toMatchObject({
        Button: MouseButton.MouseButtonRight,
        Type: MouseEventType.MouseRight,
        Action: MouseAction.MouseActionPress,
        X: 2,
        Y: 3
      });

      await program.send(DisableMouse());
      await waitFor(() => readWindowsMouseMode(program) === 'none', { timeoutMs: 500 });
      binding.queueMouseEvent(handles.input, {
        eventFlags: WINDOWS_MOUSE_EVENT_DOUBLE_CLICK,
        buttonState: WINDOWS_FROM_LEFT_1ST_BUTTON,
        position: { x: 10, y: 11 }
      });

      await sleep(50);
      expect(collectMouseMsgs(recorder)).toHaveLength(1);
    } finally {
      program.quit();
      await runPromise;
      platformSpy.mockRestore();
    }
  });

  it('translates wheel and motion events with modifier flags', async () => {
    const platformSpy = mockWindowsPlatform();
    const binding = installLoaderBinding();
    const recorder = new MessageRecorder();
    const program = NewProgram(
      recorder,
      WithInput(new FakeWindowsTtyInput()),
      WithOutput(new FakeWindowsTtyOutput()),
      WithMouseAllMotion()
    );
    const runPromise = awaitRun(program);

    try {
      const handles = await waitForPseudoHandles(binding);

      binding.queueMouseEvent(handles.input, {
        eventFlags: WINDOWS_MOUSE_EVENT_WHEELED,
        buttonState: encodeWheelDelta(120),
        controlKeyState: WINDOWS_SHIFT_PRESSED | WINDOWS_RIGHT_ALT_PRESSED,
        position: { x: 7, y: 4 }
      });

      binding.queueMouseEvent(handles.input, {
        eventFlags: WINDOWS_MOUSE_EVENT_MOVED,
        buttonState: WINDOWS_FROM_LEFT_2ND_BUTTON,
        controlKeyState: WINDOWS_RIGHT_CTRL_PRESSED,
        position: { x: 8, y: 6 }
      });

      await waitFor(() => collectMouseMsgs(recorder).length >= 2);

      const [wheelMsg, motionMsg] = collectMouseMsgs(recorder);
      expect(wheelMsg).toMatchObject({
        Button: MouseButton.MouseButtonWheelUp,
        Type: MouseEventType.MouseWheelUp,
        Alt: true,
        Shift: true,
        Ctrl: false
      });
      expect(motionMsg).toMatchObject({
        Button: MouseButton.MouseButtonMiddle,
        Type: MouseEventType.MouseMotion,
        Action: MouseAction.MouseActionMotion,
        Ctrl: true
      });
    } finally {
      program.quit();
      await runPromise;
      platformSpy.mockRestore();
    }
  });
});
