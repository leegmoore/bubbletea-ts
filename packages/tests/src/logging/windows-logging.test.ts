import { mkdtempSync, readFileSync } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { LogToFile, createMultiWriterLogOptions } from '@bubbletea/tea';

import { WindowsWritable } from '../utils/windows-terminal';

const mockWindowsPlatform = () => vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');

const createTempLogPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'bubbletea-win-log-'));
  return join(dir, 'log.txt');
};

const closeStream = (stream: WriteStream): Promise<void> =>
  new Promise((resolve, reject) => {
    stream.end((err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });

describe('LogToFile (Windows parity)', () => {
  const captureConsole = () => ({
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error
  });

  const restoreConsole = (originals: ReturnType<typeof captureConsole>) => {
    console.log = originals.log;
    console.info = originals.info;
    console.warn = originals.warn;
    console.error = originals.error;
  };

  it('appends sequential sessions when running on Windows', async () => {
    const spy = mockWindowsPlatform();
    const originals = captureConsole();
    const path = createTempLogPath();

    try {
      const first = LogToFile(path, 'proc1');
      console.log('first entry');
      await closeStream(first);

      const second = LogToFile(path, 'proc2');
      console.log('second entry');
      await closeStream(second);

      const contents = readFileSync(path, 'utf8');
      expect(contents).toBe('proc1 first entry\nproc2 second entry\n');
    } finally {
      restoreConsole(originals);
      spy.mockRestore();
    }
  });

  it('mirrors log output to WindowsWritable without closing the injected stderr', async () => {
    const spy = mockWindowsPlatform();
    const originals = captureConsole();

    try {
      const extra = new WindowsWritable();
      const path = createTempLogPath();
      const stream = LogToFile(path, 'stderr', createMultiWriterLogOptions([extra]));

      console.log('mirrored log entry');
      await closeStream(stream);

      expect(extra.closed).toBe(false);
      expect(extra.read()).toBe('stderr mirrored log entry\r\n');
      const contents = readFileSync(path, 'utf8');
      expect(contents).toBe('stderr mirrored log entry\n');
    } finally {
      restoreConsole(originals);
      spy.mockRestore();
    }
  });

  it('preserves existing CRLF sequences in logged payloads', async () => {
    const spy = mockWindowsPlatform();
    const originals = captureConsole();

    try {
      const extra = new WindowsWritable();
      const path = createTempLogPath();
      const stream = LogToFile(path, 'win', createMultiWriterLogOptions([extra]));
      console.log('line one\r\nline two');
      await closeStream(stream);

      const mirrored = extra.read();
      expect(mirrored).toBe('win line one\r\nline two\r\n');
      expect(mirrored.includes('\r\r\n')).toBe(false);

      const contents = readFileSync(path, 'utf8');
      expect(contents).toBe('win line one\r\nline two\n');
    } finally {
      restoreConsole(originals);
      spy.mockRestore();
    }
  });
});
