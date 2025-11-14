import { vi } from 'vitest';

/**
 * Runs the provided callback with Vitest's modern fake timers enabled.
 * Always restores the timers to their previous mode after the callback finishes.
 */
export const withFakeTimers = async <T>(cb: () => Promise<T> | T): Promise<T> => {
  vi.useFakeTimers();
  try {
    return await cb();
  } finally {
    vi.useRealTimers();
  }
};

/** Advances timers by the requested milliseconds and flushes pending microtasks. */
export const advanceBy = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
};

/** Resolves after pending microtasks/timers complete. */
export const flushMicrotasks = async () => {
  await vi.runOnlyPendingTimersAsync();
};
