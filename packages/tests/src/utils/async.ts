/** Small async helpers used across the Vitest suites. */

/** Resolves after the requested milliseconds (0 yields next tick). */
export const sleep = (ms = 0): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface WaitForOptions {
  timeoutMs?: number;
  intervalMs?: number;
  errorMessage?: string;
}

/**
 * Polls the predicate until it returns truthy or the timeout expires.
 * Throws when the condition is not met within the allowed time.
 */
export const waitFor = async (
  predicate: () => boolean | Promise<boolean>,
  { timeoutMs = 2000, intervalMs = 10, errorMessage }: WaitForOptions = {}
): Promise<void> => {
  const start = Date.now();
  while (true) {
    if (await predicate()) {
      return;
    }

    if (Date.now() - start >= timeoutMs) {
      throw new Error(errorMessage ?? `waitFor timed out after ${timeoutMs}ms`);
    }

    await sleep(intervalMs);
  }
};

export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
}

/**
 * Creates a controllable promise similar to a Go channel awaiting a single value.
 */
export const createDeferred = <T = void>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

/** Awaits a promise but rejects if it fails to settle before the timeout. */
export const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  message = 'operation timed out'
): Promise<T> => {
  let timeout: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

/** Creates an AbortController that automatically aborts after the timeout. */
export const controllerWithTimeout = (timeoutMs: number): AbortController => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  controller.signal.addEventListener(
    'abort',
    () => {
      clearTimeout(timer);
    },
    { once: true }
  );
  return controller;
};
