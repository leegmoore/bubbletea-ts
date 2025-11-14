import { closeSync, constants, openSync } from 'node:fs';
import { ReadStream, WriteStream } from 'node:tty';

import { getWindowsConsoleBinding } from './windows/binding';
import {
  WINDOWS_ENABLE_VIRTUAL_TERMINAL_INPUT,
  WINDOWS_ENABLE_VIRTUAL_TERMINAL_PROCESSING
} from './windows/constants';

const WINDOWS_TTY_DEVICE = 'CONIN$';
const UNIX_TTY_DEVICE = '/dev/tty';
const { O_RDWR } = constants;

const isWindows = (): boolean => process.platform === 'win32';

type WindowsTtyStream = (NodeJS.ReadStream | NodeJS.WriteStream) & {
  fd?: number;
};

const resolveConsoleHandle = (stream: NodeJS.ReadStream | NodeJS.WriteStream): number | null => {
  if (!stream || !stream.isTTY) {
    return null;
  }
  const { fd } = stream as WindowsTtyStream;
  if (typeof fd !== 'number') {
    return null;
  }
  return fd;
};

const enableWindowsVirtualTerminalFlag = (
  stream: NodeJS.ReadStream | NodeJS.WriteStream,
  flag: number
): void => {
  if (!isWindows()) {
    return;
  }
  const binding = getWindowsConsoleBinding();
  if (!binding) {
    return;
  }
  const handle = resolveConsoleHandle(stream);
  if (handle === null) {
    return;
  }
  const currentMode = binding.getConsoleMode(handle);
  const nextMode = currentMode | flag;
  binding.setConsoleMode(handle, nextMode);
};

const createReadStreamFromFd = (fd: number): NodeJS.ReadStream => {
  try {
    const stream = new ReadStream(fd, { autoDestroy: true });
    return stream;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
};

export const openInputTTY = (): NodeJS.ReadStream => {
  const devicePath = isWindows() ? WINDOWS_TTY_DEVICE : UNIX_TTY_DEVICE;
  try {
    const fd = openSync(devicePath, O_RDWR);
    return createReadStreamFromFd(fd);
  } catch (error) {
    const reason = error instanceof Error ? error : new Error(String(error));
    const message = `failed to open tty device ${devicePath}`;
    throw new Error(message, { cause: reason });
  }
};

export const enableWindowsVirtualTerminalInput = (stream: NodeJS.ReadStream): void => {
  enableWindowsVirtualTerminalFlag(stream, WINDOWS_ENABLE_VIRTUAL_TERMINAL_INPUT);
};

export const enableWindowsVirtualTerminalOutput = (stream: NodeJS.WriteStream): void => {
  enableWindowsVirtualTerminalFlag(stream, WINDOWS_ENABLE_VIRTUAL_TERMINAL_PROCESSING);
};
