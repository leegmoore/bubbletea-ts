import { ensureWindowsConsoleBindingLoaded, setWindowsConsoleBindingOverride } from './binding-loader';

export type WindowsHandle = number;

export interface WindowsPoint {
  x: number;
  y: number;
}

export interface WindowsSize {
  columns: number;
  rows: number;
}

export type WindowsInputRecord =
  | WindowsKeyInputRecord
  | WindowsMouseInputRecord
  | WindowsWindowBufferSizeRecord;

export interface WindowsKeyInputRecord {
  type: 'key';
  keyDown: boolean;
  repeatCount: number;
  charCode: number;
  virtualKeyCode: number;
  controlKeyState: number;
}

export interface WindowsMouseInputRecord {
  type: 'mouse';
  position: WindowsPoint;
  buttonState: number;
  controlKeyState: number;
  eventFlags: number;
}

export interface WindowsWindowBufferSizeRecord {
  type: 'window-buffer-size';
  size: WindowsSize;
}

export type WindowsPseudoConsoleHandle = number;

export interface WindowsPseudoConsole {
  handle: WindowsPseudoConsoleHandle;
  input: WindowsHandle;
  output: WindowsHandle;
}

export interface WindowsConsoleBinding {
  /**
   * Reads the current mode bits for the provided console handle.
   */
  getConsoleMode(handle: WindowsHandle): number;
  /**
   * Persists the provided mode bits for the console handle.
   */
  setConsoleMode(handle: WindowsHandle, mode: number): void;
  /**
   * Streams queued input records for the console handle. Implementations should
   * resolve the iterable whenever records are enqueued and honor cancelIo
   * requests by ending the stream.
   */
  readConsoleInput(handle: WindowsHandle): AsyncIterable<WindowsInputRecord>;
  /**
   * Cancels any pending read operations for the provided console handle.
   */
  cancelIo(handle: WindowsHandle): void;
  /**
   * Creates a new pseudo console session with dedicated input/output handles.
   */
  createPseudoConsole(initialSize: WindowsSize): WindowsPseudoConsole;
  /**
   * Applies a resize to the pseudo console and (optionally) emits a
   * WINDOW_BUFFER_SIZE event through the associated input handle.
   */
  resizePseudoConsole(pseudoConsole: WindowsPseudoConsoleHandle, size: WindowsSize): void;
  /**
   * Releases pseudo console resources, closing any pending input streams.
   */
  closePseudoConsole(pseudoConsole: WindowsPseudoConsoleHandle): void;
}

/**
 * Resolves (and caches) the active Windows console binding for the current platform.
 */
export const getWindowsConsoleBinding = (): WindowsConsoleBinding | null =>
  ensureWindowsConsoleBindingLoaded();

/**
 * Installs a fake binding for tests. Pass `null` to clear the override.
 */
export const setWindowsConsoleBindingForTests = (
  binding: WindowsConsoleBinding | null
): void => {
  setWindowsConsoleBindingOverride(binding);
};
