import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  enableWindowsVirtualTerminalInput,
  enableWindowsVirtualTerminalOutput,
  setWindowsConsoleBindingForTests,
  WINDOWS_ENABLE_VIRTUAL_TERMINAL_INPUT,
  WINDOWS_ENABLE_VIRTUAL_TERMINAL_PROCESSING
} from '@bubbletea/tea/internal';

import { FakeWindowsConsoleBinding } from '../utils/windows-console-harness';

class FakeWindowsTty extends PassThrough {
  public isTTY = true;
  public fd: number | undefined;

  constructor(fd?: number) {
    super();
    this.fd = fd;
  }
}

const mockWindowsPlatform = () => vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
const mockNonWindowsPlatform = () => vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');

const installFakeBinding = () => {
  const binding = new FakeWindowsConsoleBinding();
  setWindowsConsoleBindingForTests(binding);
  return binding;
};

afterEach(() => {
  setWindowsConsoleBindingForTests(null);
  vi.restoreAllMocks();
});

describe('enableWindowsVirtualTerminalInput', () => {
  it('enables the VT input flag via the binding on Windows', () => {
    mockWindowsPlatform();
    const binding = installFakeBinding();
    const handle = 11;
    binding.seedConsoleMode(handle, 0x0010);
    enableWindowsVirtualTerminalInput(new FakeWindowsTty(handle) as unknown as NodeJS.ReadStream);

    expect(binding.getConsoleModeCalls).toEqual([handle]);
    expect(binding.setConsoleModeCalls).toEqual([
      { handle, mode: 0x0010 | WINDOWS_ENABLE_VIRTUAL_TERMINAL_INPUT }
    ]);
    expect(binding.modeFor(handle)).toBe(0x0010 | WINDOWS_ENABLE_VIRTUAL_TERMINAL_INPUT);
  });

  it('skips binding interaction when not on Windows', () => {
    mockNonWindowsPlatform();
    const binding = installFakeBinding();
    enableWindowsVirtualTerminalInput(new FakeWindowsTty(9) as unknown as NodeJS.ReadStream);

    expect(binding.getConsoleModeCalls).toHaveLength(0);
    expect(binding.setConsoleModeCalls).toHaveLength(0);
  });

  it('skips binding interaction when the stream lacks an fd', () => {
    mockWindowsPlatform();
    const binding = installFakeBinding();
    enableWindowsVirtualTerminalInput(new FakeWindowsTty() as unknown as NodeJS.ReadStream);

    expect(binding.getConsoleModeCalls).toHaveLength(0);
    expect(binding.setConsoleModeCalls).toHaveLength(0);
  });
});

describe('enableWindowsVirtualTerminalOutput', () => {
  it('enables the VT output flag via the binding on Windows', () => {
    mockWindowsPlatform();
    const binding = installFakeBinding();
    const handle = 42;
    binding.seedConsoleMode(handle, 0x0001);

    enableWindowsVirtualTerminalOutput(new FakeWindowsTty(handle) as unknown as NodeJS.WriteStream);

    expect(binding.getConsoleModeCalls).toEqual([handle]);
    expect(binding.setConsoleModeCalls).toEqual([
      { handle, mode: 0x0001 | WINDOWS_ENABLE_VIRTUAL_TERMINAL_PROCESSING }
    ]);
    expect(binding.modeFor(handle)).toBe(0x0001 | WINDOWS_ENABLE_VIRTUAL_TERMINAL_PROCESSING);
  });

  it('skips binding interaction for non-Windows platforms', () => {
    mockNonWindowsPlatform();
    const binding = installFakeBinding();
    enableWindowsVirtualTerminalOutput(new FakeWindowsTty(7) as unknown as NodeJS.WriteStream);

    expect(binding.getConsoleModeCalls).toHaveLength(0);
    expect(binding.setConsoleModeCalls).toHaveLength(0);
  });

  it('skips binding interaction when the stream is missing an fd', () => {
    mockWindowsPlatform();
    const binding = installFakeBinding();
    enableWindowsVirtualTerminalOutput(new FakeWindowsTty() as unknown as NodeJS.WriteStream);

    expect(binding.getConsoleModeCalls).toHaveLength(0);
    expect(binding.setConsoleModeCalls).toHaveLength(0);
  });
});

describe('FakeWindowsConsoleBinding record helpers', () => {
  const createIterator = (binding: FakeWindowsConsoleBinding, handle: number) =>
    binding.readConsoleInput(handle)[Symbol.asyncIterator]();

  it('streams queued key and mouse events in FIFO order', async () => {
    const binding = new FakeWindowsConsoleBinding();
    const handle = binding.createHandle();
    const iterator = createIterator(binding, handle);

    const first = iterator.next();
    binding.queueKeyEvent(handle, { charCode: 65, virtualKeyCode: 0x41 });
    const firstRecord = await first;
    expect(firstRecord.done).toBe(false);
    expect(firstRecord.value).toEqual({
      type: 'key',
      keyDown: true,
      repeatCount: 1,
      charCode: 65,
      virtualKeyCode: 0x41,
      controlKeyState: 0
    });

    const second = iterator.next();
    binding.queueMouseEvent(handle, {
      position: { x: 3, y: 4 },
      buttonState: 0x0001,
      controlKeyState: 0x0002,
      eventFlags: 0x0004
    });
    const secondRecord = await second;
    expect(secondRecord.done).toBe(false);
    expect(secondRecord.value).toEqual({
      type: 'mouse',
      position: { x: 3, y: 4 },
      buttonState: 0x0001,
      controlKeyState: 0x0002,
      eventFlags: 0x0004
    });
  });

  it('emits window-buffer-size events when pseudo consoles resize', async () => {
    const binding = new FakeWindowsConsoleBinding();
    const pseudo = binding.createPseudoConsole({ columns: 80, rows: 24 });
    const iterator = createIterator(binding, pseudo.input);

    const nextRecordPromise = iterator.next();
    binding.resizePseudoConsole(pseudo.handle, { columns: 120, rows: 40 });
    const record = await nextRecordPromise;

    expect(record.done).toBe(false);
    expect(record.value).toEqual({
      type: 'window-buffer-size',
      size: { columns: 120, rows: 40 }
    });
    expect(binding.resizePseudoConsoleCalls).toEqual([
      { handle: pseudo.handle, size: { columns: 120, rows: 40 } }
    ]);
    expect(binding.pseudoConsoleSize(pseudo.handle)).toEqual({ columns: 120, rows: 40 });
  });

  it('cancels pending input reads when cancelIo is invoked', async () => {
    const binding = new FakeWindowsConsoleBinding();
    const handle = binding.createHandle();
    const iterator = createIterator(binding, handle);

    const pending = iterator.next();
    binding.cancelIo(handle);

    const result = await pending;
    expect(result.done).toBe(true);
    expect(binding.cancelIoCalls).toEqual([handle]);
  });
});
