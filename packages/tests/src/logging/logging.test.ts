import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { LogOptionsSetter, LogToFile, createMultiWriterLogOptions } from '@bubbletea/tea';

class TestLogger implements LogOptionsSetter {
  private output: NodeJS.WritableStream | null = null;
  private prefix = '';

  setOutput(output: NodeJS.WritableStream): void {
    this.output = output;
  }

  setPrefix(prefix: string): void {
    this.prefix = prefix;
  }

  log(message: string): void {
    if (!this.output) {
      throw new Error('output not configured');
    }
    this.output.write(`${this.prefix}${message}\n`);
  }
}

class MultiWriterLogger implements LogOptionsSetter {
  private output: NodeJS.WritableStream | null = null;
  private prefix = '';

  constructor(private readonly extra: NodeJS.WritableStream) {}

  setOutput(output: NodeJS.WritableStream): void {
    this.output = output;
  }

  setPrefix(prefix: string): void {
    this.prefix = prefix;
  }

  log(message: string): void {
    if (!this.output) {
      throw new Error('output not configured');
    }
    const line = `${this.prefix}${message}\n`;
    this.output.write(line);
    this.extra.write(line);
  }
}

const createTempLogPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'bubbletea-log-'));
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

describe('LogToFile (logging_test.go parity)', () => {
  it('writes prefix and log entry to the configured file', async () => {
    const logger = new TestLogger();
    const path = createTempLogPath();
    const prefix = 'logprefix';

    const stream = LogToFile(path, prefix, logger);
    logger.log('some test log');
    await closeStream(stream);

    const contents = readFileSync(path, 'utf8');
    expect(contents).toBe('logprefix some test log\n');
  });

  it('supports custom loggers that fan out to multiple writers', async () => {
    const extra = new PassThrough();
    const seen: string[] = [];
    extra.on('data', (chunk) => seen.push(chunk.toString('utf8')));

    const logger = new MultiWriterLogger(extra);
    const path = createTempLogPath();
    const stream = LogToFile(path, 'multi', logger);

    logger.log('structured log entry');
    await closeStream(stream);

    const contents = readFileSync(path, 'utf8');
    expect(contents).toBe('multi structured log entry\n');
    expect(seen.join('')).toBe('multi structured log entry\n');
  });

  it('appends to existing files without truncating prior entries', async () => {
    const originals = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error
    } as const;

    const path = createTempLogPath();
    writeFileSync(path, 'legacy entry\n', 'utf8');
    const stream = LogToFile(path, 'append');

    try {
      console.log('new entry');
      await closeStream(stream);
      expect(console.log).toBe(originals.log);
      expect(console.info).toBe(originals.info);
      expect(console.warn).toBe(originals.warn);
      expect(console.error).toBe(originals.error);
    } finally {
      console.log = originals.log;
      console.info = originals.info;
      console.warn = originals.warn;
      console.error = originals.error;
    }

    const contents = readFileSync(path, 'utf8');
    expect(contents).toBe('legacy entry\nappend new entry\n');
  });

  it('allows sequential processes to append to the same log file', async () => {
    const originals = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error
    } as const;

    const path = createTempLogPath();
    const first = LogToFile(path, 'proc1');
    try {
      console.log('first entry');
      await closeStream(first);
      const second = LogToFile(path, 'proc2');
      console.log('second entry');
      await closeStream(second);
      expect(console.log).toBe(originals.log);
      expect(console.info).toBe(originals.info);
      expect(console.warn).toBe(originals.warn);
      expect(console.error).toBe(originals.error);
    } finally {
      console.log = originals.log;
      console.info = originals.info;
      console.warn = originals.warn;
      console.error = originals.error;
    }

    const contents = readFileSync(path, 'utf8');
    expect(contents).toBe('proc1 first entry\nproc2 second entry\n');
  });
});

describe('createMultiWriterLogOptions', () => {
  it('fans out console output to additional streams', async () => {
    const extra = new PassThrough();
    const seen: string[] = [];
    extra.on('data', (chunk) => seen.push(chunk.toString('utf8')));

    const path = createTempLogPath();
    const stream = LogToFile(path, 'multi', createMultiWriterLogOptions([extra]));

    console.log('helper log entry');
    await closeStream(stream);

    const contents = readFileSync(path, 'utf8');
    expect(contents).toBe('multi helper log entry\n');
    expect(seen.join('')).toBe('multi helper log entry\n');
  });

  it('mirrors logs to stderr-like streams without closing them', async () => {
    const originals = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error
    } as const;

    const extra = new PassThrough();
    const seen: string[] = [];
    let closed = false;
    extra.on('data', (chunk) => seen.push(chunk.toString('utf8')));
    extra.once('close', () => {
      closed = true;
    });
    extra.once('finish', () => {
      closed = true;
    });

    const path = createTempLogPath();
    const stream = LogToFile(path, 'stderr', createMultiWriterLogOptions([extra]));

    try {
      console.error('mirrored log entry');
      await closeStream(stream);
      expect(console.log).toBe(originals.log);
      expect(console.info).toBe(originals.info);
      expect(console.warn).toBe(originals.warn);
      expect(console.error).toBe(originals.error);
    } finally {
      console.log = originals.log;
      console.info = originals.info;
      console.warn = originals.warn;
      console.error = originals.error;
      extra.destroy();
    }

    const contents = readFileSync(path, 'utf8');
    expect(contents).toBe('stderr mirrored log entry\n');
    expect(seen.join('')).toBe('stderr mirrored log entry\n');
    expect(closed).toBe(false);
  });
});

describe('Console patching lifecycle', () => {
  it('restores console methods once the log stream closes', async () => {
    const originals = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error
    } as const;

    const path = createTempLogPath();
    const stream = LogToFile(path, 'scoped');

    expect(console.log).not.toBe(originals.log);
    expect(console.info).not.toBe(originals.info);
    expect(console.warn).not.toBe(originals.warn);
    expect(console.error).not.toBe(originals.error);

    console.log('scoped entry');

    try {
      await closeStream(stream);
      expect(console.log).toBe(originals.log);
      expect(console.info).toBe(originals.info);
      expect(console.warn).toBe(originals.warn);
      expect(console.error).toBe(originals.error);
    } finally {
      console.log = originals.log;
      console.info = originals.info;
      console.warn = originals.warn;
      console.error = originals.error;
    }

    const contents = readFileSync(path, 'utf8');
    expect(contents).toBe('scoped scoped entry\n');
  });
});
