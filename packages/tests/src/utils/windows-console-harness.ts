import type { WindowsConsoleBinding, WindowsHandle } from '@bubbletea/tea/internal';

export class FakeWindowsConsoleBinding implements WindowsConsoleBinding {
  readonly getConsoleModeCalls: WindowsHandle[] = [];
  readonly setConsoleModeCalls: Array<{ handle: WindowsHandle; mode: number }> = [];
  private readonly modes = new Map<WindowsHandle, number>();

  getConsoleMode(handle: WindowsHandle): number {
    this.getConsoleModeCalls.push(handle);
    return this.modes.get(handle) ?? 0;
  }

  setConsoleMode(handle: WindowsHandle, mode: number): void {
    this.setConsoleModeCalls.push({ handle, mode });
    this.modes.set(handle, mode);
  }

  seedConsoleMode(handle: WindowsHandle, mode: number): void {
    this.modes.set(handle, mode);
  }

  modeFor(handle: WindowsHandle): number | undefined {
    return this.modes.get(handle);
  }
}
