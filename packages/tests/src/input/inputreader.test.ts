import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';

import type { ReadAnsiInputChunk } from '@bubbletea/tea/internal';
import {
  InputReaderCanceledError,
  createCancelableInputReader
} from '@bubbletea/tea/internal';

import { waitFor } from '../utils/async';

const chunkToString = (chunk: ReadAnsiInputChunk): string =>
  typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');

describe('cancelable input reader', () => {
  it('yields chunks from the underlying stream until it ends', async () => {
    const stream = new PassThrough();
    const reader = createCancelableInputReader(stream);
    const collected: string[] = [];

    const consume = (async () => {
      for await (const chunk of reader) {
        collected.push(chunkToString(chunk));
      }
    })();

    stream.write('hello ');
    stream.write(Buffer.from('world', 'utf8'));
    stream.end('!');

    await consume;
    expect(collected).toEqual(['hello ', 'world', '!']);
  });

  it('rejects pending reads with InputReaderCanceledError when canceled', async () => {
    const stream = new PassThrough();
    const reader = createCancelableInputReader(stream);
    const iterator = reader[Symbol.asyncIterator]();
    const pending = iterator.next();

    expect(reader.cancel()).toBe(true);
    await expect(pending).rejects.toBeInstanceOf(InputReaderCanceledError);
    expect(reader.cancel()).toBe(false);
  });

  it('stops delivering chunks once canceled even if the stream keeps writing', async () => {
    const stream = new PassThrough();
    const reader = createCancelableInputReader(stream);
    const received: string[] = [];

    const consume = (async () => {
      try {
        for await (const chunk of reader) {
          received.push(chunkToString(chunk));
        }
      } catch (error) {
        if (!(error instanceof InputReaderCanceledError)) {
          throw error;
        }
      }
    })();

    stream.write('a');
    await waitFor(() => received.length === 1, { timeoutMs: 250 });

    reader.cancel();
    stream.write('b');
    stream.end('c');

    await consume;
    expect(received).toEqual(['a']);
  });

  it('finishes gracefully when close() is called', async () => {
    const stream = new PassThrough();
    const reader = createCancelableInputReader(stream);
    const received: string[] = [];

    const consume = (async () => {
      for await (const chunk of reader) {
        received.push(chunkToString(chunk));
      }
    })();

    stream.write('first chunk');
    reader.close();
    stream.write('ignored');

    await consume;
    expect(received).toEqual(['first chunk']);
    expect(reader.cancel()).toBe(false);
  });

  it('propagates stream errors to pending consumers', async () => {
    const stream = new PassThrough();
    const reader = createCancelableInputReader(stream);
    const iterator = reader[Symbol.asyncIterator]();
    const pending = iterator.next();
    const failure = new Error('boom');

    stream.destroy(failure);

    await expect(pending).rejects.toBe(failure);
  });
});
