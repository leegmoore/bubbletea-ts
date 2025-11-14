export type WindowsHandle = number;

export interface WindowsConsoleBinding {
  /**
   * Reads the current mode bits for the provided console handle.
   */
  getConsoleMode(handle: WindowsHandle): number;
  /**
   * Persists the provided mode bits for the console handle.
   */
  setConsoleMode(handle: WindowsHandle, mode: number): void;
}

let activeBinding: WindowsConsoleBinding | null = null;

/**
 * Returns the currently registered Windows console binding, if any.
 */
export const getWindowsConsoleBinding = (): WindowsConsoleBinding | null => activeBinding;

/**
 * Installs a new Windows console binding for tests.
 *
 * Production builds will replace this function with a loader that
 * dynamically resolves the native binding. Until then, tests can
 * inject a fake binding to exercise runtime logic.
 */
export const setWindowsConsoleBindingForTests = (
  binding: WindowsConsoleBinding | null
): void => {
  activeBinding = binding;
};
