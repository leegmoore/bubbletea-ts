import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { WindowsHandle, WindowsPoint } from '@bubbletea/tea/internal';

export interface WindowsConsoleInputHarness {
  writeKeyEvent(handle: WindowsHandle, overrides?: KeyEventOptions): void;
  writeMouseEvent(handle: WindowsHandle, overrides?: MouseEventOptions): void;
}

export interface KeyEventOptions {
  keyDown?: boolean;
  repeatCount?: number;
  virtualKeyCode?: number;
  virtualScanCode?: number;
  charCode?: number;
  controlKeyState?: number;
}

export interface MouseEventOptions {
  position?: WindowsPoint;
  buttonState?: number;
  controlKeyState?: number;
  eventFlags?: number;
}

type RecordType = 'key' | 'mouse';

const scriptPath = (() => {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(dirname, '../../scripts/windows-write-console-input.ps1');
})();

const ensureWindowsHost = (): void => {
  if (process.platform !== 'win32') {
    throw new Error('Windows console input harness can only run on Windows hosts');
  }
};

class PowerShellWindowsConsoleInputHarness implements WindowsConsoleInputHarness {
  writeKeyEvent(handle: WindowsHandle, overrides: KeyEventOptions = {}): void {
    ensureWindowsHost();
    const payload = {
      keyDown: overrides.keyDown ?? true,
      repeatCount: overrides.repeatCount ?? 1,
      virtualKeyCode: overrides.virtualKeyCode ?? 0,
      virtualScanCode: overrides.virtualScanCode ?? overrides.virtualKeyCode ?? 0,
      charCode: overrides.charCode ?? 0,
      controlKeyState: overrides.controlKeyState ?? 0
    } satisfies Record<string, unknown>;
    invokePowerShell('key', handle, payload);
  }

  writeMouseEvent(handle: WindowsHandle, overrides: MouseEventOptions = {}): void {
    ensureWindowsHost();
    const position = overrides.position ?? { x: 0, y: 0 };
    const payload = {
      x: position.x,
      y: position.y,
      buttonState: overrides.buttonState ?? 0,
      controlKeyState: overrides.controlKeyState ?? 0,
      eventFlags: overrides.eventFlags ?? 0
    } satisfies Record<string, unknown>;
    invokePowerShell('mouse', handle, payload);
  }
}

const invokePowerShell = (
  recordType: RecordType,
  handle: WindowsHandle,
  payload: Record<string, unknown>
): void => {
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoLogo',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-RecordType',
      recordType,
      '-Handle',
      String(handle),
      '-Payload',
      encodedPayload
    ],
    { encoding: 'utf8' }
  );

  if (result.error) {
    throw new Error(`failed to spawn PowerShell: ${result.error.message}`, { cause: result.error });
  }
  if (result.status === null) {
    throw new Error('PowerShell harness exited without a status code');
  }
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    const details = stderr || stdout || 'unknown error';
    throw new Error(`PowerShell harness exited with code ${result.status}: ${details}`);
  }
};

export const createWindowsConsoleInputHarness = (): WindowsConsoleInputHarness => {
  ensureWindowsHost();
  return new PowerShellWindowsConsoleInputHarness();
};
