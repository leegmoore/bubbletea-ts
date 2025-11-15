import { describe, expect, it } from 'vitest';

import {
  createSuspendBridge,
  SuspendBridgeProcess,
  SuspendProcessError
} from '@bubbletea/tea/internal';

type Listener = () => void;

type KillFn = (pid: number, signal: NodeJS.Signals, callIndex: number) => void;

class FakeSuspendProcess implements SuspendBridgeProcess {
  public pid: number;
  public platform: NodeJS.Platform = 'darwin';
  public callLog: string[] = [];
  private killImpl: KillFn | null = null;
  private killCallCount = 0;
  private listeners = new Map<NodeJS.Signals, Set<ListenerWrapper>>();

  constructor(pid = 1337) {
    this.pid = pid;
  }

  setKillImplementation(fn: KillFn): void {
    this.killImpl = fn;
  }

  kill(targetPid: number, signal: NodeJS.Signals): void {
    this.callLog.push(`kill:${signal}:${targetPid}`);
    this.killCallCount += 1;
    if (this.killImpl) {
      this.killImpl(targetPid, signal, this.killCallCount);
    }
  }

  once(signal: NodeJS.Signals, listener: Listener): this {
    this.callLog.push(`once:${signal}`);
    const wrapper: ListenerWrapper = () => {
      this.off(signal, wrapper);
      listener();
    };
    wrapper.listener = listener;
    this.addListener(signal, wrapper);
    return this;
  }

  off(signal: NodeJS.Signals, listener: Listener): this {
    const bucket = this.listeners.get(signal);
    if (!bucket) {
      return this;
    }
    for (const entry of bucket) {
      if (entry === listener || entry.listener === listener) {
        bucket.delete(entry);
        break;
      }
    }
    if (bucket.size === 0) {
      this.listeners.delete(signal);
    }
    return this;
  }

  removeListener(signal: NodeJS.Signals, listener: Listener): this {
    return this.off(signal, listener);
  }

  emit(signal: NodeJS.Signals): void {
    const bucket = this.listeners.get(signal);
    if (!bucket) {
      return;
    }
    for (const entry of [...bucket]) {
      entry();
    }
  }

  listenerCount(signal: NodeJS.Signals): number {
    return this.listeners.get(signal)?.size ?? 0;
  }

  private addListener(signal: NodeJS.Signals, listener: ListenerWrapper): void {
    let bucket = this.listeners.get(signal);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(signal, bucket);
    }
    bucket.add(listener);
  }
}

interface ListenerWrapper {
  (): void;
  listener?: Listener;
}

describe('createSuspendBridge', () => {
  it('registers SIGCONT before attempting to suspend the process group', async () => {
    const fake = new FakeSuspendProcess(4242);
    const bridge = createSuspendBridge(fake);

    const promise = bridge();

    expect(fake.callLog[0]).toBe('once:SIGCONT');
    expect(fake.callLog[1]).toBe('kill:SIGTSTP:-4242');
    expect(fake.listenerCount('SIGCONT')).toBe(1);

    fake.emit('SIGCONT');
    await expect(promise).resolves.toBeUndefined();
    expect(fake.listenerCount('SIGCONT')).toBe(0);
  });

  it('falls back to sending SIGTSTP to the PID when the group kill fails with ESRCH', async () => {
    const fake = new FakeSuspendProcess(777);
    fake.setKillImplementation((target, _signal, callIndex) => {
      if (callIndex === 1) {
        const err = new Error('no process group') as NodeJS.ErrnoException;
        err.code = 'ESRCH';
        throw err;
      }
    });

    const bridge = createSuspendBridge(fake);
    const promise = bridge();

    expect(fake.callLog[1]).toBe('kill:SIGTSTP:-777');
    expect(fake.callLog[2]).toBe('kill:SIGTSTP:777');

    fake.emit('SIGCONT');
    await expect(promise).resolves.toBeUndefined();
  });

  it('rejects with SuspendProcessError when suspend signaling fails twice', async () => {
    const fake = new FakeSuspendProcess(2024);
    const rootError = new Error('permission denied');
    const fallbackError = new Error('still failing');
    fake.setKillImplementation((_pid, _signal, callIndex) => {
      if (callIndex === 1) {
        const err = rootError as NodeJS.ErrnoException;
        err.code = 'EPERM';
        throw err;
      }
      throw fallbackError;
    });

    const bridge = createSuspendBridge(fake);
    await expect(bridge()).rejects.toBeInstanceOf(SuspendProcessError);
    expect(fake.listenerCount('SIGCONT')).toBe(0);
  });

  it('cleans up SIGCONT listeners when suspension completes or fails', async () => {
    const fake = new FakeSuspendProcess(9000);
    const bridge = createSuspendBridge(fake);

    const promise = bridge();
    expect(fake.listenerCount('SIGCONT')).toBe(1);
    fake.emit('SIGCONT');
    await promise;
    expect(fake.listenerCount('SIGCONT')).toBe(0);

    const failing = new FakeSuspendProcess(9001);
    failing.setKillImplementation(() => {
      const err = new Error('boom') as NodeJS.ErrnoException;
      err.code = 'ESRCH';
      throw err;
    });
    const fallback = createSuspendBridge(failing);
    await expect(fallback()).rejects.toBeInstanceOf(SuspendProcessError);
    expect(failing.listenerCount('SIGCONT')).toBe(0);
  });

  it('resolves immediately on unsupported platforms', async () => {
    const fake = new FakeSuspendProcess(55);
    fake.platform = 'win32';
    const bridge = createSuspendBridge(fake);

    await expect(bridge()).resolves.toBeUndefined();
    expect(fake.callLog).toHaveLength(0);
  });
});
