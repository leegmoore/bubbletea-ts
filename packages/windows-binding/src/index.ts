import type { WindowsConsoleBinding } from '@bubbletea/tea/internal';

const notImplemented = () =>
  new Error(
    'Native Windows console binding is not implemented yet. See docs/windows-console-binding-implementation.md.'
  );

export const createWindowsConsoleBinding = (): WindowsConsoleBinding => {
  throw notImplemented();
};
