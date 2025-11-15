import { EventEmitter } from 'node:events';

type SignalName = NodeJS.Signals;
type Listener = () => void;

/**
 * Lightweight stand-in for Node's process object, limited to the signal APIs
 * Bubble Tea cares about.
 */
export class FakeProcessSignals {
  private readonly emitter = new EventEmitter();
  private readonly listeners = new Map<SignalName, Set<Listener>>();

  on(signal: SignalName, listener: Listener): this {
    this.track(signal, listener);
    this.emitter.on(signal, listener);
    return this;
  }

  off(signal: SignalName, listener: Listener): this {
    this.untrack(signal, listener);
    this.emitter.off(signal, listener);
    return this;
  }

  removeListener(signal: SignalName, listener: Listener): this {
    return this.off(signal, listener);
  }

  emit(signal: SignalName): boolean {
    return this.emitter.emit(signal);
  }

  listenerCount(signal: SignalName): number {
    return this.listeners.get(signal)?.size ?? 0;
  }

  private track(signal: SignalName, listener: Listener): void {
    let bucket = this.listeners.get(signal);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(signal, bucket);
    }
    bucket.add(listener);
  }

  private untrack(signal: SignalName, listener: Listener): void {
    const bucket = this.listeners.get(signal);
    if (!bucket) {
      return;
    }
    bucket.delete(listener);
    if (bucket.size === 0) {
      this.listeners.delete(signal);
    }
  }
}
