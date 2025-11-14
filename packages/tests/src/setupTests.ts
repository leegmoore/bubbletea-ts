// Shared Vitest setup hook for the Bubble Tea TypeScript port.
import { afterEach, vi } from 'vitest';

// Always restore timers/mocks to prevent state bleeding across suites.
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
