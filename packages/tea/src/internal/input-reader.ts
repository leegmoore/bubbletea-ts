import { createAnsiInputQueue } from './ansi-input-queue';
import type { ReadAnsiInputChunk } from './key-input';

export class InputReaderCanceledError extends Error {
  constructor(message = 'input reader canceled') {
    super(message);
    this.name = 'InputReaderCanceledError';
  }
}

export interface CancelableInputReader extends AsyncIterable<ReadAnsiInputChunk> {
  cancel(): boolean;
  close(): void;
}

const normalizeChunk = (chunk: Buffer | string): ReadAnsiInputChunk =>
  typeof chunk === 'string' ? chunk : Uint8Array.from(chunk);

const removeListener = (
  stream: NodeJS.ReadableStream,
  event: string,
  listener: (...args: unknown[]) => void
): void => {
  if (typeof stream.off === 'function') {
    stream.off(event, listener);
  } else {
    stream.removeListener(event, listener);
  }
};

export const createCancelableInputReader = (
  stream: NodeJS.ReadableStream
): CancelableInputReader => {
  if (!stream) {
    throw new Error('input stream is required');
  }

  const queue = createAnsiInputQueue();
  let cleanedUp = false;
  let settled = false;
  let canceled = false;

  const settleWith = (action: () => void): void => {
    if (settled) {
      return;
    }
    settled = true;
    action();
  };

  const finishQueue = (): void => {
    settleWith(() => {
      queue.finish();
    });
  };

  const failQueue = (error: unknown): void => {
    settleWith(() => {
      queue.fail(error);
    });
  };

  const cleanup = (): void => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    removeListener(stream, 'data', onData);
    removeListener(stream, 'end', onEnd);
    removeListener(stream, 'close', onClose);
    removeListener(stream, 'error', onError);
  };

  const onData = (chunk: Buffer | string): void => {
    queue.push(normalizeChunk(chunk));
  };

  const onEnd = (): void => {
    cleanup();
    finishQueue();
  };

  const onClose = (): void => {
    cleanup();
    finishQueue();
  };

  const onError = (error: unknown): void => {
    cleanup();
    failQueue(error ?? new Error('input stream error'));
  };

  stream.on('data', onData);
  stream.on('end', onEnd);
  stream.on('close', onClose);
  stream.on('error', onError);

  const createIterator = () => {
    const iterator = queue.iterable[Symbol.asyncIterator]();
    return {
      next: iterator.next.bind(iterator),
      return: async (value?: unknown): Promise<IteratorResult<ReadAnsiInputChunk>> => {
        cleanup();
        finishQueue();
        if (typeof iterator.return === 'function') {
          return iterator.return(value as ReadAnsiInputChunk);
        }
        return { value: value as ReadAnsiInputChunk, done: true };
      }
    } satisfies AsyncIterator<ReadAnsiInputChunk>;
  };

  return {
    [Symbol.asyncIterator]() {
      return createIterator();
    },
    cancel(): boolean {
      if (canceled || settled) {
        return false;
      }
      canceled = true;
      const error = new InputReaderCanceledError();
      failQueue(error);
      if (typeof stream.destroy === 'function') {
        stream.destroy(error as Error);
      } else {
        cleanup();
      }
      return true;
    },
    close(): void {
      if (settled) {
        return;
      }
      cleanup();
      finishQueue();
    }
  };
};
