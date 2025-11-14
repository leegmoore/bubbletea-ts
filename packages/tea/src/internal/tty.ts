import { closeSync, constants, openSync } from 'node:fs';
import { ReadStream, WriteStream } from 'node:tty';

const UNIX_TTY_DEVICE = '/dev/tty';
const { O_RDWR } = constants;

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
  const devicePath = UNIX_TTY_DEVICE;
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
  void stream;
};

export const enableWindowsVirtualTerminalOutput = (stream: NodeJS.WriteStream): void => {
  void stream;
};
