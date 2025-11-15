import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    openSync: vi.fn(),
    closeSync: vi.fn()
  };
});

vi.mock('node:tty', async () => {
  const actual = await vi.importActual<typeof import('node:tty')>('node:tty');
  return {
    ...actual,
    ReadStream: vi.fn()
  };
});

import * as fs from 'node:fs';
import * as tty from 'node:tty';
import { openInputTTY } from '@bubbletea/tea/internal';

const UNIX_TTY_DEVICE = '/dev/tty';

afterEach(() => {
  vi.resetAllMocks();
});

describe('openInputTTY (tty_unix.go)', () => {
  it('TestOpenInputTTYSelectsUnixDevice - opens /dev/tty for read/write and returns an auto-destroying read stream', () => {
    const fakeFd = 105;
    const fakeStream = new PassThrough() as unknown as NodeJS.ReadStream;
    const openSpy = vi.mocked(fs.openSync);
    openSpy.mockReturnValue(fakeFd);
    const closeSpy = vi.mocked(fs.closeSync);
    const readSpy = vi.mocked(tty.ReadStream);
    readSpy.mockImplementation(
      (function (this: unknown, fd: number, options?: { autoDestroy?: boolean }) {
        expect(fd).toBe(fakeFd);
        expect(options).toEqual({ autoDestroy: true });
        return fakeStream as unknown as tty.ReadStream;
      }) as unknown as typeof tty.ReadStream
    );

    const stream = openInputTTY();

    expect(stream).toBe(fakeStream);
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith(UNIX_TTY_DEVICE, fs.constants.O_RDWR);
    expect(readSpy).toHaveBeenCalledTimes(1);
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('TestOpenInputTTYClosesFdWhenStreamCreationFails - closes the fd and wraps the read-stream failure', () => {
    const fakeFd = 7;
    const openSpy = vi.mocked(fs.openSync);
    openSpy.mockReturnValue(fakeFd);
    const closeSpy = vi.mocked(fs.closeSync);
    const streamError = new Error('ReadStream failure');
    const readSpy = vi.mocked(tty.ReadStream);
    readSpy.mockImplementation(
      (function (this: unknown, fd: number) {
        expect(fd).toBe(fakeFd);
        throw streamError;
      }) as unknown as typeof tty.ReadStream
    );

    let thrown: unknown;
    try {
      openInputTTY();
    } catch (error) {
      thrown = error;
    }

    expect(openSpy).toHaveBeenCalledWith(UNIX_TTY_DEVICE, fs.constants.O_RDWR);
    expect(closeSpy).toHaveBeenCalledWith(fakeFd);
    expect(thrown).toBeInstanceOf(Error);
    const typed = thrown as Error & { cause?: unknown };
    expect(typed.message).toBe(`failed to open tty device ${UNIX_TTY_DEVICE}`);
    expect(typed.cause).toBe(streamError);
  });

  it('TestOpenInputTTYWrapsOpenSyncErrors - surfaces fs.openSync failures with device context and skips ReadStream', () => {
    const openError = new Error('permission denied');
    const openSpy = vi.mocked(fs.openSync);
    openSpy.mockImplementation(() => {
      throw openError;
    });
    const closeSpy = vi.mocked(fs.closeSync);
    const readSpy = vi.mocked(tty.ReadStream);

    let thrown: unknown;
    try {
      openInputTTY();
    } catch (error) {
      thrown = error;
    }

    expect(openSpy).toHaveBeenCalledWith(UNIX_TTY_DEVICE, fs.constants.O_RDWR);
    expect(readSpy).not.toHaveBeenCalled();
    expect(closeSpy).not.toHaveBeenCalled();
    expect(thrown).toBeInstanceOf(Error);
    const typed = thrown as Error & { cause?: unknown };
    expect(typed.message).toBe(`failed to open tty device ${UNIX_TTY_DEVICE}`);
    expect(typed.cause).toBe(openError);
  });
});
