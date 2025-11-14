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
