import type { ReadAnsiInputChunk } from './key-input';

export interface AnsiInputQueue {
  readonly iterable: AsyncIterable<ReadAnsiInputChunk>;
  push(chunk: ReadAnsiInputChunk): void;
  finish(): void;
  fail(error: unknown): void;
}

export const createAnsiInputQueue = (): AnsiInputQueue => {
  const buffered: ReadAnsiInputChunk[] = [];
  const pending: Array<{
    resolve(value: IteratorResult<ReadAnsiInputChunk>): void;
    reject(reason?: unknown): void;
  }> = [];
  let done = false;
  let error: unknown;

  const flush = (): void => {
    while (!error && buffered.length > 0 && pending.length > 0) {
      const chunk = buffered.shift();
      const entry = pending.shift();
      if (chunk === undefined || !entry) {
        break;
      }
      entry.resolve({ value: chunk, done: false });
    }

    if (error && pending.length > 0) {
      const err = error;
      while (pending.length > 0) {
        pending.shift()?.reject(err);
      }
      return;
    }

    if (done && buffered.length === 0) {
      while (pending.length > 0) {
        pending.shift()?.resolve({ value: undefined, done: true });
      }
    }
  };

  return {
    iterable: {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<ReadAnsiInputChunk>> {
            if (error) {
              return Promise.reject(error);
            }
            if (buffered.length > 0) {
              const chunk = buffered.shift()!;
              return Promise.resolve({ value: chunk, done: false });
            }
            if (done) {
              return Promise.resolve({ value: undefined, done: true });
            }
            return new Promise<IteratorResult<ReadAnsiInputChunk>>((resolve, reject) => {
              pending.push({ resolve, reject });
            });
          },
          return(): Promise<IteratorResult<ReadAnsiInputChunk>> {
            done = true;
            buffered.length = 0;
            flush();
            return Promise.resolve({ value: undefined, done: true });
          }
        };
      }
    },
    push(chunk: ReadAnsiInputChunk) {
      if (done || error) {
        return;
      }
      buffered.push(chunk);
      flush();
    },
    finish() {
      if (done || error) {
        return;
      }
      done = true;
      flush();
    },
    fail(err: unknown) {
      if (error) {
        return;
      }
      error = err ?? new Error('input stream error');
      done = true;
      flush();
    }
  };
};
