export interface SuspendBridgeProcess {
  pid?: number;
  platform?: NodeJS.Platform;
  kill?(pid: number, signal: NodeJS.Signals): void;
  once?(event: NodeJS.Signals, listener: () => void): void;
  off?(event: NodeJS.Signals, listener: () => void): void;
  removeListener?(event: NodeJS.Signals, listener: () => void): void;
}

export type SuspendBridge = () => Promise<void>;

export class SuspendProcessError extends Error {
  constructor(message = 'failed to suspend process', options?: ErrorOptions) {
    super(message, options);
    this.name = 'SuspendProcessError';
  }
}

const FALLBACK_ERROR_CODES = new Set(['ESRCH', 'EPERM', 'EINVAL']);

const NOOP_BRIDGE: SuspendBridge = () => Promise.resolve();

export const createSuspendBridge = (
  processLike: SuspendBridgeProcess | null | undefined
): SuspendBridge => {
  if (!isSuspendSupported(processLike)) {
    return NOOP_BRIDGE;
  }

  const normalizedPid = normalizePid(processLike.pid);
  if (normalizedPid == null) {
    return NOOP_BRIDGE;
  }

  const kill = typeof processLike.kill === 'function' ? processLike.kill.bind(processLike) : null;
  const once = typeof processLike.once === 'function' ? processLike.once.bind(processLike) : null;
  if (!kill || !once) {
    return NOOP_BRIDGE;
  }

  const cleanupListener = (listener: () => void) => {
    if (typeof processLike.off === 'function') {
      processLike.off.call(processLike, 'SIGCONT', listener);
    } else if (typeof processLike.removeListener === 'function') {
      processLike.removeListener.call(processLike, 'SIGCONT', listener);
    }
  };

  return () =>
    new Promise<void>((resolve, reject) => {
      let finished = false;

      const finish = (fn: () => void) => {
        if (finished) {
          return;
        }
        finished = true;
        fn();
      };

      const onResume = () => {
        cleanupListener(onResume);
        finish(() => {
          resolve();
        });
      };

      const fail = (reason: unknown) => {
        cleanupListener(onResume);
        const error =
          reason instanceof SuspendProcessError
            ? reason
            : new SuspendProcessError('failed to suspend process', {
                cause: reason instanceof Error ? reason : undefined
              });
        finish(() => {
          reject(error);
        });
      };

      try {
        once('SIGCONT', onResume);
      } catch (error) {
        fail(error);
        return;
      }

      const killTargets = normalizedPid > 0 ? [-normalizedPid, normalizedPid] : [normalizedPid];
      let attemptIndex = 0;
      let lastError: unknown = null;

      for (const target of killTargets) {
        attemptIndex += 1;
        const result = trySendSuspendSignal(kill, target);
        if (result.kind === 'ok') {
          return;
        }
        lastError = result.error;
        if (result.kind === 'fallback' && attemptIndex === 1) {
          continue;
        }
        fail(lastError);
        return;
      }

      fail(lastError ?? new Error('unable to deliver suspend signal'));
    });
};

const trySendSuspendSignal = (
  kill: NonNullable<SuspendBridgeProcess['kill']>,
  targetPid: number
): { kind: 'ok' } | { kind: 'fallback'; error: unknown } | { kind: 'error'; error: unknown } => {
  try {
    kill(targetPid, 'SIGTSTP');
    return { kind: 'ok' };
  } catch (error) {
    if (shouldFallback(error)) {
      return { kind: 'fallback', error };
    }
    return { kind: 'error', error };
  }
};

const shouldFallback = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && FALLBACK_ERROR_CODES.has(code);
};

const normalizePid = (pid: unknown): number | null => {
  if (typeof pid !== 'number' || !Number.isFinite(pid)) {
    return null;
  }
  const normalized = Math.abs(Math.trunc(pid));
  return normalized > 0 ? normalized : null;
};

const isSuspendSupported = (processLike: SuspendBridgeProcess | null | undefined): boolean => {
  if (!processLike) {
    return false;
  }
  if (processLike.platform === 'win32') {
    return false;
  }
  return true;
};
