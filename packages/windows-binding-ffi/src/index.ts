import type { WindowsConsoleBinding } from '@bubbletea/tea/internal';

const missingShim = () =>
  new Error(
    'ffi-napi Windows console shim is not implemented yet. Set BUBBLETEA_WINDOWS_BINDING_MODE=ffi once it exists.'
  );

export const createWindowsConsoleBinding = (): WindowsConsoleBinding => {
  throw missingShim();
};
