// Core primitives for the Bubble Tea TypeScript runtime.

import { Console } from 'node:console';
import { createWriteStream } from 'node:fs';
import { Writable } from 'node:stream';
import { format as utilFormat } from 'node:util';
import type { WriteStream } from 'node:fs';
import {
  InputReaderCanceledError,
  createCancelableInputReader,
  openInputTTY,
  readAnsiInputs
} from './internal';
import type { CancelableInputReader } from './internal';

export * from './key';
export * from './mouse';

export type Msg = unknown;
export type MaybePromise<T> = T | Promise<T>;
export type Cmd<TMsg = Msg> =
  | (() => MaybePromise<TMsg | undefined | null>)
  | null
  | undefined;

export type BatchMsg = Cmd[];
export type SequenceMsg = Cmd[];

export interface Model {
  init?(): Cmd;
  update?(msg: Msg): [Model, Cmd] | [Model] | null | undefined;
  view?(): string;
}

export type FilterFn = (model: Model | null, msg: Msg) => Msg | null | undefined;

export interface QuitMsg {
  readonly type: 'bubbletea/quit';
}

export type FocusMsg = SimpleMsg<'bubbletea/focus'>;
export type BlurMsg = SimpleMsg<'bubbletea/blur'>;

export interface WindowSizeMsg {
  readonly type: 'bubbletea/window-size';
  readonly width: number;
  readonly height: number;
}

type SimpleMsg<TType extends string> = { readonly type: TType };

export type ClearScreenMsg = SimpleMsg<'bubbletea/clear-screen'>;
export type EnterAltScreenMsg = SimpleMsg<'bubbletea/enter-alt-screen'>;
export type ExitAltScreenMsg = SimpleMsg<'bubbletea/exit-alt-screen'>;
export type EnableMouseCellMotionMsg = SimpleMsg<'bubbletea/enable-mouse-cell-motion'>;
export type EnableMouseAllMotionMsg = SimpleMsg<'bubbletea/enable-mouse-all-motion'>;
export type DisableMouseMsg = SimpleMsg<'bubbletea/disable-mouse'>;
export type HideCursorMsg = SimpleMsg<'bubbletea/hide-cursor'>;
export type ShowCursorMsg = SimpleMsg<'bubbletea/show-cursor'>;
export type EnableBracketedPasteMsg = SimpleMsg<'bubbletea/enable-bracketed-paste'>;
export type DisableBracketedPasteMsg = SimpleMsg<'bubbletea/disable-bracketed-paste'>;
export type EnableReportFocusMsg = SimpleMsg<'bubbletea/enable-report-focus'>;
export type DisableReportFocusMsg = SimpleMsg<'bubbletea/disable-report-focus'>;
export interface PrintLineMsg {
  readonly type: 'bubbletea/print-line';
  readonly body: string;
}

export interface SyncScrollAreaMsg {
  readonly type: 'bubbletea/sync-scroll-area';
  readonly lines: string[];
  readonly topBoundary: number;
  readonly bottomBoundary: number;
}

export interface ScrollUpMsg {
  readonly type: 'bubbletea/scroll-up';
  readonly lines: string[];
  readonly topBoundary: number;
  readonly bottomBoundary: number;
}

export interface ScrollDownMsg {
  readonly type: 'bubbletea/scroll-down';
  readonly lines: string[];
  readonly topBoundary: number;
  readonly bottomBoundary: number;
}

export interface ClearScrollAreaMsg {
  readonly type: 'bubbletea/clear-scroll-area';
}

const hasType = (msg: Msg, type: string): msg is Record<string, unknown> & { type: string } =>
  isRecord(msg) && (msg as { type?: unknown }).type === type;

const isWindowSizeMsg = (msg: Msg): msg is WindowSizeMsg =>
  hasType(msg, 'bubbletea/window-size') &&
  typeof (msg as WindowSizeMsg).width === 'number' &&
  typeof (msg as WindowSizeMsg).height === 'number';

const isPrintLineMsg = (msg: Msg): msg is PrintLineMsg =>
  hasType(msg, 'bubbletea/print-line') && typeof (msg as PrintLineMsg).body === 'string';

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

const isSyncScrollAreaMsg = (msg: Msg): msg is SyncScrollAreaMsg =>
  hasType(msg, 'bubbletea/sync-scroll-area') &&
  isStringArray((msg as SyncScrollAreaMsg).lines) &&
  typeof (msg as SyncScrollAreaMsg).topBoundary === 'number' &&
  typeof (msg as SyncScrollAreaMsg).bottomBoundary === 'number';

const isScrollUpMsg = (msg: Msg): msg is ScrollUpMsg =>
  hasType(msg, 'bubbletea/scroll-up') &&
  isStringArray((msg as ScrollUpMsg).lines) &&
  typeof (msg as ScrollUpMsg).topBoundary === 'number' &&
  typeof (msg as ScrollUpMsg).bottomBoundary === 'number';

const isScrollDownMsg = (msg: Msg): msg is ScrollDownMsg =>
  hasType(msg, 'bubbletea/scroll-down') &&
  isStringArray((msg as ScrollDownMsg).lines) &&
  typeof (msg as ScrollDownMsg).topBoundary === 'number' &&
  typeof (msg as ScrollDownMsg).bottomBoundary === 'number';

const isClearScrollAreaMsg = (msg: Msg): msg is ClearScrollAreaMsg =>
  hasType(msg, 'bubbletea/clear-scroll-area');

export class ProgramPanicError extends Error {
  constructor(message = 'program experienced a panic', options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProgramPanicError';
  }
}

export class ProgramKilledError extends Error {
  constructor(message = 'program was killed', options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProgramKilledError';
  }
}

export type Duration = number; // milliseconds

export enum InputType {
  Default = 'default input',
  Tty = 'tty input',
  Custom = 'custom input'
}

export enum StartupFlag {
  AltScreen = 1 << 0,
  MouseCellMotion = 1 << 1,
  MouseAllMotion = 1 << 2,
  ANSICompressor = 1 << 3,
  WithoutSignalHandler = 1 << 4,
  WithoutCatchPanics = 1 << 5,
  WithoutBracketedPaste = 1 << 6,
  ReportFocus = 1 << 7
}

export class StartupOptions {
  constructor(private flags = 0) {}

  has(flag: StartupFlag): boolean {
    return (this.flags & flag) !== 0;
  }

  add(flag: StartupFlag): void {
    this.flags |= flag;
  }

  remove(flag: StartupFlag): void {
    this.flags &= ~flag;
  }
}

export interface Renderer {
  readonly kind: 'standard' | 'nil';
  start(): void;
  stop(): void;
  kill(): void;
  write(content: string): void;
  repaint(): void;
  clearScreen(): void;
  altScreen(): boolean;
  enterAltScreen(): void;
  exitAltScreen(): void;
  showCursor(): void;
  hideCursor(): void;
  enableMouseCellMotion(): void;
  disableMouseCellMotion(): void;
  enableMouseAllMotion(): void;
  disableMouseAllMotion(): void;
  enableMouseSGRMode(): void;
  disableMouseSGRMode(): void;
  enableBracketedPaste(): void;
  disableBracketedPaste(): void;
  bracketedPasteActive(): boolean;
  enableReportFocus(): void;
  disableReportFocus(): void;
  reportFocus(): boolean;
  setWindowTitle(title: string): void;
  resetLinesRendered(): void;
  handleMessage?(msg: Msg): void;
}

export class NilRenderer implements Renderer {
  readonly kind = 'nil' as const;

  start(): void {}
  stop(): void {}
  kill(): void {}
  write(): void {}
  repaint(): void {}
  clearScreen(): void {}
  altScreen(): boolean {
    return false;
  }
  enterAltScreen(): void {}
  exitAltScreen(): void {}
  showCursor(): void {}
  hideCursor(): void {}
  enableMouseCellMotion(): void {}
  disableMouseCellMotion(): void {}
  enableMouseAllMotion(): void {}
  disableMouseAllMotion(): void {}
  enableMouseSGRMode(): void {}
  disableMouseSGRMode(): void {}
  enableBracketedPaste(): void {}
  disableBracketedPaste(): void {}
  bracketedPasteActive(): boolean {
    return false;
  }
  enableReportFocus(): void {}
  disableReportFocus(): void {}
  reportFocus(): boolean {
    return false;
  }
  setWindowTitle(): void {}
  resetLinesRendered(): void {}
}

class StandardRenderer implements Renderer {
  readonly kind = 'standard' as const;

  private buffer = '';
  private lastRender = '';
  private lastRenderedLines: string[] = [];
  private linesRendered = 0;
  private altLinesRendered = 0;
  private altScreenActive = false;
  private cursorHidden = false;
  private bracketedPaste = false;
  private reportingFocus = false;
  private mouseCellMotion = false;
  private mouseAllMotion = false;
  private mouseSGR = false;
  private width = 0;
  private height = 0;
  private running = false;
  private ticker: NodeJS.Timeout | null = null;
  private queuedMessageLines: string[] = [];
  private ignoreLines: Set<number> | null = null;

  constructor(
    private readonly outputProvider: () => NodeJS.WritableStream | null,
    private readonly fpsProvider: () => number
  ) {}

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.repaint();
    this.hideCursor();
    this.startTicker();
  }

  stop(): void {
    if (!this.running) {
      return;
    }
    this.flush();
    this.stopTicker();
    this.execute(ANSI.eraseEntireLine);
    this.execute('\r');
    this.running = false;
  }

  kill(): void {
    if (!this.running) {
      return;
    }
    this.buffer = '';
    this.lastRender = '';
    this.stopTicker();
    this.execute(ANSI.eraseEntireLine);
    this.execute('\r');
    this.running = false;
  }

  write(content: string): void {
    if (!this.running) {
      return;
    }
    const normalized = typeof content === 'string' ? content : '';
    this.buffer = normalized.length === 0 ? ' ' : normalized;
  }

  repaint(): void {
    this.lastRender = '';
    this.lastRenderedLines = [];
  }

  clearScreen(): void {
    this.execute(ANSI.eraseEntireScreen);
    this.execute(ANSI.cursorHome);
    this.repaint();
  }

  altScreen(): boolean {
    return this.altScreenActive;
  }

  enterAltScreen(): void {
    if (this.altScreenActive) {
      return;
    }
    this.altScreenActive = true;
    this.execute(ANSI.setAltScreen);
    this.execute(ANSI.eraseEntireScreen);
    this.execute(ANSI.cursorHome);
    if (this.cursorHidden) {
      this.execute(ANSI.hideCursor);
    } else {
      this.execute(ANSI.showCursor);
    }
    this.altLinesRendered = 0;
    this.repaint();
  }

  exitAltScreen(): void {
    if (!this.altScreenActive) {
      return;
    }
    this.altScreenActive = false;
    this.execute(ANSI.resetAltScreen);
    if (this.cursorHidden) {
      this.execute(ANSI.hideCursor);
    } else {
      this.execute(ANSI.showCursor);
    }
    this.repaint();
  }

  showCursor(): void {
    this.cursorHidden = false;
    this.execute(ANSI.showCursor);
  }

  hideCursor(): void {
    this.cursorHidden = true;
    this.execute(ANSI.hideCursor);
  }

  enableMouseCellMotion(): void {
    if (this.mouseCellMotion) {
      return;
    }
    this.mouseCellMotion = true;
    this.execute(ANSI.setMouseCellMotion);
  }

  disableMouseCellMotion(): void {
    this.mouseCellMotion = false;
    this.execute(ANSI.resetMouseCellMotion);
  }

  enableMouseAllMotion(): void {
    if (this.mouseAllMotion) {
      return;
    }
    this.mouseAllMotion = true;
    this.execute(ANSI.setMouseAllMotion);
  }

  disableMouseAllMotion(): void {
    this.mouseAllMotion = false;
    this.execute(ANSI.resetMouseAllMotion);
  }

  enableMouseSGRMode(): void {
    if (this.mouseSGR) {
      return;
    }
    this.mouseSGR = true;
    this.execute(ANSI.setMouseSGR);
  }

  disableMouseSGRMode(): void {
    this.mouseSGR = false;
    this.execute(ANSI.resetMouseSGR);
  }

  enableBracketedPaste(): void {
    if (this.bracketedPaste) {
      return;
    }
    this.bracketedPaste = true;
    this.execute(ANSI.setBracketedPaste);
  }

  disableBracketedPaste(): void {
    if (!this.bracketedPaste) {
      return;
    }
    this.bracketedPaste = false;
    this.execute(ANSI.resetBracketedPaste);
  }

  bracketedPasteActive(): boolean {
    return this.bracketedPaste;
  }

  enableReportFocus(): void {
    if (this.reportingFocus) {
      return;
    }
    this.reportingFocus = true;
    this.execute(ANSI.setFocusEvent);
  }

  disableReportFocus(): void {
    if (!this.reportingFocus) {
      return;
    }
    this.reportingFocus = false;
    this.execute(ANSI.resetFocusEvent);
  }

  reportFocus(): boolean {
    return this.reportingFocus;
  }

  setWindowTitle(title: string): void {
    this.execute(`\x1b]0;${title}\x07`);
  }

  resetLinesRendered(): void {
    this.linesRendered = 0;
    this.altLinesRendered = 0;
  }

  setIgnoredLines(from: number, to: number): void {
    const start = Math.max(0, Math.trunc(from));
    const end = Math.max(start, Math.trunc(to));
    if (end <= start) {
      return;
    }
    if (!this.ignoreLines) {
      this.ignoreLines = new Set();
    }
    for (let i = start; i < end; i += 1) {
      this.ignoreLines.add(i);
    }

    const lastLines = this.lastLinesRendered();
    if (lastLines <= 0) {
      return;
    }

    const output = this.outputProvider();
    if (!output) {
      return;
    }

    const segments: string[] = [];
    for (let index = lastLines - 1; index >= 0; index -= 1) {
      if (this.ignoreLines.has(index)) {
        segments.push(ANSI.eraseEntireLine);
      }
      segments.push(cursorUp(1));
    }
    segments.push(cursorPosition(0, lastLines));
    this.writeOutput(output, segments.join(''));
  }

  clearIgnoredLines(): void {
    this.ignoreLines = null;
  }

  handleMessage(msg: Msg): void {
    if (isWindowSizeMsg(msg)) {
      this.width = msg.width;
      this.height = msg.height;
      this.repaint();
    } else if (isPrintLineMsg(msg)) {
      this.queuePrintLines(msg.body);
    } else if (isSyncScrollAreaMsg(msg)) {
      this.clearIgnoredLines();
      this.setIgnoredLines(msg.topBoundary, msg.bottomBoundary);
      this.insertTop(msg.lines, msg.topBoundary, msg.bottomBoundary);
      this.repaint();
    } else if (isClearScrollAreaMsg(msg)) {
      this.clearIgnoredLines();
      this.repaint();
    } else if (isScrollUpMsg(msg)) {
      this.insertTop(msg.lines, msg.topBoundary, msg.bottomBoundary);
    } else if (isScrollDownMsg(msg)) {
      this.insertBottom(msg.lines, msg.topBoundary, msg.bottomBoundary);
    }
  }

  private queuePrintLines(body: string): void {
    if (this.altScreenActive) {
      return;
    }
    const lines = String(body).split('\n');
    this.queuedMessageLines.push(...lines);
    this.repaint();
  }

  private insertTop(lines: string[], topBoundary: number, bottomBoundary: number): void {
    const output = this.outputProvider();
    if (!output) {
      return;
    }
    const payload = Array.isArray(lines) ? lines : [];
    const segments: string[] = [];
    segments.push(setTopBottomMargins(topBoundary, bottomBoundary));
    segments.push(cursorPosition(0, topBoundary));
    segments.push(insertLine(payload.length));
    if (payload.length > 0) {
      segments.push(payload.join('\r\n'));
    }
    segments.push(setTopBottomMargins(0, this.height));
    segments.push(cursorPosition(0, this.lastLinesRendered()));
    this.writeOutput(output, segments.join(''));
  }

  private insertBottom(lines: string[], topBoundary: number, bottomBoundary: number): void {
    const output = this.outputProvider();
    if (!output) {
      return;
    }
    const payload = Array.isArray(lines) ? lines : [];
    const segments: string[] = [];
    segments.push(setTopBottomMargins(topBoundary, bottomBoundary));
    segments.push(cursorPosition(0, bottomBoundary));
    segments.push(`\r\n${payload.join('\r\n')}`);
    segments.push(setTopBottomMargins(0, this.height));
    segments.push(cursorPosition(0, this.lastLinesRendered()));
    this.writeOutput(output, segments.join(''));
  }

  private flush(): void {
    const output = this.outputProvider();
    if (!output) {
      return;
    }
    if (this.buffer.length === 0 || this.buffer === this.lastRender) {
      return;
    }

    let newLines = this.buffer.split('\n');
    if (this.height > 0 && newLines.length > this.height) {
      newLines = newLines.slice(newLines.length - this.height);
    }

    const chunks: string[] = [];
    if (this.altScreenActive) {
      chunks.push(ANSI.cursorHome);
    } else if (this.linesRendered > 1) {
      chunks.push(cursorUp(this.linesRendered - 1));
    }
    const flushQueuedMessages = this.queuedMessageLines.length > 0 && !this.altScreenActive;
    if (flushQueuedMessages) {
      for (const line of this.queuedMessageLines) {
        chunks.push(line);
        if (this.shouldEraseLine(line)) {
          chunks.push(ANSI.eraseLineRight);
        }
        chunks.push('\r\n');
      }
      this.queuedMessageLines = [];
    }

    for (let i = 0; i < newLines.length; i += 1) {
      const ignoreLine = this.ignoreLines?.has(i) ?? false;
      const matchesPrevious =
        !flushQueuedMessages &&
        this.lastRenderedLines.length > i &&
        this.lastRenderedLines[i] === newLines[i];

      if (ignoreLine || matchesPrevious) {
        if (i < newLines.length - 1) {
          chunks.push('\n');
        }
        continue;
      }

      if (i === 0 && this.lastRender === '') {
        chunks.push('\r');
      }

      const truncated = this.truncateLine(newLines[i]);
      chunks.push(truncated);

      if (this.shouldEraseLine(truncated)) {
        chunks.push(ANSI.eraseLineRight);
      }

      if (i < newLines.length - 1) {
        chunks.push('\r\n');
      }
    }

    if (this.lastLinesRendered() > newLines.length) {
      chunks.push(ANSI.eraseScreenBelow);
    }

    if (this.altScreenActive) {
      chunks.push(cursorPosition(0, newLines.length));
      this.altLinesRendered = newLines.length;
    } else {
      chunks.push('\r');
      this.linesRendered = newLines.length;
    }

    this.writeOutput(output, chunks.join(''));
    this.lastRender = this.buffer;
    this.lastRenderedLines = newLines;
    this.buffer = '';
  }

  private truncateLine(line: string): string {
    if (this.width <= 0) {
      return line;
    }
    const chars = Array.from(line);
    if (chars.length <= this.width) {
      return line;
    }
    return chars.slice(0, this.width).join('');
  }

  private shouldEraseLine(line: string): boolean {
    return this.width > 0 && stringWidth(line) < this.width;
  }

  private startTicker(): void {
    this.stopTicker();
    const fps = normalizeFps(this.fpsProvider());
    const interval = Math.max(1, Math.round(1000 / fps));
    this.ticker = setInterval(() => {
      this.flush();
    }, interval);
  }

  private stopTicker(): void {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  private execute(seq: string): void {
    const output = this.outputProvider();
    if (!output || !seq) {
      return;
    }
    this.writeOutput(output, seq);
  }

  private writeOutput(output: NodeJS.WritableStream, value: string): void {
    if (!value) {
      return;
    }
    const payload = this.normalizeNewlinesForPlatform(value);
    output.write(payload);
  }

  private normalizeNewlinesForPlatform(value: string): string {
    if (!isWindowsPlatform()) {
      return value;
    }
    return normalizeWindowsNewlines(value);
  }

  private lastLinesRendered(): number {
    return this.altScreenActive ? this.altLinesRendered : this.linesRendered;
  }
}

const ANSI = {
  hideCursor: '\x1b[?25l',
  showCursor: '\x1b[?25h',
  eraseEntireScreen: '\x1b[2J',
  eraseEntireLine: '\x1b[2K',
  eraseLineRight: '\x1b[K',
  eraseScreenBelow: '\x1b[J',
  cursorHome: '\x1b[H',
  setAltScreen: '\x1b[?1049h',
  resetAltScreen: '\x1b[?1049l',
  setBracketedPaste: '\x1b[?2004h',
  resetBracketedPaste: '\x1b[?2004l',
  setMouseCellMotion: '\x1b[?1002h',
  resetMouseCellMotion: '\x1b[?1002l',
  setMouseAllMotion: '\x1b[?1003h',
  resetMouseAllMotion: '\x1b[?1003l',
  setMouseSGR: '\x1b[?1006h',
  resetMouseSGR: '\x1b[?1006l',
  setFocusEvent: '\x1b[?1004h',
  resetFocusEvent: '\x1b[?1004l'
} as const;

const cursorUp = (rows: number): string => {
  if (rows <= 0) {
    return '';
  }
  return `\x1b[${rows}A`;
};

const cursorPosition = (col: number, row: number): string => {
  if (row <= 0 && col <= 0) {
    return ANSI.cursorHome;
  }
  const rowPart = row > 0 ? String(row) : '';
  const colPart = col > 0 ? String(col) : '';
  return `\x1b[${rowPart};${colPart}H`;
};

const setTopBottomMargins = (top: number, bottom: number): string => {
  const topPart = top > 0 ? String(top) : '';
  const bottomPart = bottom > 0 ? String(bottom) : '';
  return `\x1b[${topPart};${bottomPart}r`;
};

const insertLine = (count: number): string => {
  const normalized = Math.max(0, Math.trunc(count));
  const prefix = normalized > 1 ? String(normalized) : '';
  return `\x1b[${prefix}L`;
};

const stringWidth = (value: string): number => Array.from(value).length;

const isWindowsPlatform = (): boolean => process.platform === 'win32';

const windowsNewlinePattern = /\r?\n/g;

const normalizeWindowsNewlines = (value: string): string =>
  value.replace(windowsNewlinePattern, '\r\n');

const normalizeWritableChunkForWindows = (
  chunk: Buffer | string,
  encoding: BufferEncoding
): { payload: Buffer | string; payloadEncoding?: BufferEncoding } => {
  const resolvedEncoding = encoding === 'buffer' ? 'utf8' : encoding;
  if (typeof chunk === 'string') {
    return { payload: normalizeWindowsNewlines(chunk), payloadEncoding: resolvedEncoding };
  }
  const normalized = normalizeWindowsNewlines(chunk.toString(resolvedEncoding));
  return { payload: Buffer.from(normalized, resolvedEncoding) };
};

export type ProgramContext = AbortController;
export type ProgramOption = (program: Program) => void;

export interface RunResult {
  model: Model | null;
  err: Error | null;
}

type InternalMsg = Msg | BatchMsg | SequenceMsg;

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
}

const createDeferred = <T = void>(): Deferred<T> => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const scheduleMicrotask = (fn: () => void): void => {
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(fn);
    return;
  }
  Promise.resolve().then(fn);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isQuitMessage = (msg: unknown): msg is QuitMsg => isRecord(msg) && msg.type === 'bubbletea/quit';

const isCmdArray = (value: unknown): value is Cmd[] =>
  Array.isArray(value) && value.every((entry) => entry == null || typeof entry === 'function');

const toError = (value: unknown, fallbackMessage: string): Error => {
  if (value instanceof Error) {
    return value;
  }
  if (typeof value === 'string') {
    return new Error(value);
  }
  return new Error(fallbackMessage);
};

const DEFAULT_FPS = 60;
const MIN_FPS = 1;
const MAX_FPS = 120;

const normalizeFps = (fps: number): number => {
  if (!Number.isFinite(fps)) {
    return DEFAULT_FPS;
  }
  const clamped = Math.trunc(fps);
  if (clamped < MIN_FPS) {
    return MIN_FPS;
  }
  if (clamped > MAX_FPS) {
    return MAX_FPS;
  }
  return clamped;
};

const getDefaultInput = (): NodeJS.ReadableStream | null =>
  typeof process !== 'undefined' && process.stdin ? process.stdin : null;

const getDefaultOutput = (): NodeJS.WritableStream | null =>
  typeof process !== 'undefined' && process.stdout ? process.stdout : null;

const sanitizeDimension = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : null;
};

type RawModeTty = NodeJS.ReadStream & {
  setRawMode(mode: boolean): NodeJS.ReadStream;
  isRaw?: boolean;
};

const isReadableTty = (
  stream: NodeJS.ReadableStream | null
): stream is NodeJS.ReadStream => Boolean(stream && (stream as NodeJS.ReadStream).isTTY);

const toRawModeTty = (stream: NodeJS.ReadableStream | null): RawModeTty | null => {
  if (!isReadableTty(stream)) {
    return null;
  }
  const candidate = stream as RawModeTty;
  return typeof candidate.setRawMode === 'function' ? candidate : null;
};

const toWritableTty = (stream: NodeJS.WritableStream | null): NodeJS.WriteStream | null => {
  if (!isWritableTty(stream)) {
    return null;
  }
  return stream as NodeJS.WriteStream;
};

const isWritableTty = (
  stream: NodeJS.WritableStream | null
): stream is NodeJS.WriteStream =>
  Boolean(stream && (stream as NodeJS.WriteStream).isTTY);

type ProgramState = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped';

export class Program {
  public readonly startupOptions = new StartupOptions();
  public renderer: Renderer;
  public inputType: InputType = InputType.Default;
  public input: NodeJS.ReadableStream | null = getDefaultInput();
  public output: NodeJS.WritableStream | null = getDefaultOutput();
  public ignoreSignals = false;
  public filter?: FilterFn;
  public externalContext: ProgramContext = new AbortController();
  public environ: string[] = [];
  public fps = DEFAULT_FPS;

  private state: ProgramState = 'idle';
  private readonly started = createDeferred<void>();
  private hasStarted = false;
  private readonly finished = createDeferred<void>();
  private startPromise: Promise<void> | null = null;
  private runPromise: Promise<RunResult> | null = null;
  private messageQueue: InternalMsg[] = [];
  private processingQueue = false;
  private resultErr: Error | null = null;
  private externalAbortCleanup?: () => void;
  private inputCleanup?: () => void;
  private inputPause?: () => void;
  private inputReader?: CancelableInputReader;
  private rawInputCleanup?: () => void;
  private resizeCleanup?: () => void;
  private terminalReleased = false;
  private releasedAltScreen = false;
  private releasedBracketedPaste = false;
  private releasedReportFocus = false;

  constructor(public model: Model | null) {
    this.renderer = new StandardRenderer(() => this.output, () => this.fps);
  }

  async run(): Promise<RunResult> {
    if (!this.runPromise) {
      this.runPromise = (async () => {
        await this.start();
        await this.wait();
        return { model: this.model, err: this.resultErr };
      })();
    }
    return this.runPromise;
  }

  async start(): Promise<void> {
    if (this.state === 'running' || this.state === 'starting') {
      if (this.startPromise) {
        await this.startPromise;
      }
      return;
    }

    if (this.state === 'stopping' || this.state === 'stopped') {
      throw new Error('program already finished');
    }

    this.startPromise = this.bootstrap();
    await this.startPromise;
  }

  async wait(): Promise<void> {
    await this.finished.promise;
  }

  async send(msg: Msg | BatchMsg | SequenceMsg): Promise<void> {
    if (msg == null) {
      return;
    }

    if (this.state === 'stopped' || this.state === 'stopping') {
      return;
    }

    if (this.state === 'idle') {
      await this.started.promise;
    } else if (this.state === 'starting' && this.startPromise) {
      await this.startPromise;
    }

    if (!this.isRunning()) {
      return;
    }

    this.enqueueMsg(msg);
  }

  quit(): void {
    void this.send({ type: 'bubbletea/quit' }).catch(() => undefined);
  }

  kill(reason?: Error): void {
    if (this.state === 'stopped' || this.state === 'stopping') {
      return;
    }
    const finalErr =
      reason instanceof ProgramKilledError
        ? reason
        : new ProgramKilledError('program was killed', { cause: reason });
    this.finish(finalErr);
  }

  releaseTerminal(): void {
    if (!this.isRunning() || this.terminalReleased) {
      return;
    }
    this.ignoreSignals = true;
    this.pauseInput();
    this.renderer.stop();
    this.releasedAltScreen = this.renderer.altScreen();
    this.releasedBracketedPaste = this.renderer.bracketedPasteActive();
    this.releasedReportFocus = this.renderer.reportFocus();
    this.restoreTerminalState();
    this.terminalReleased = true;
  }

  restoreTerminal(): void {
    if (!this.isRunning() || !this.terminalReleased) {
      return;
    }
    this.ignoreSignals = false;
    this.setupTerminalInput();
    this.setupInput();
    if (this.releasedAltScreen) {
      this.renderer.enterAltScreen();
    } else {
      this.renderer.repaint();
    }
    this.renderer.start();
    if (this.releasedBracketedPaste) {
      this.renderer.enableBracketedPaste();
    } else {
      this.renderer.disableBracketedPaste();
    }
    if (this.releasedReportFocus) {
      this.renderer.enableReportFocus();
    } else {
      this.renderer.disableReportFocus();
    }
    this.emitWindowSizeFrom(this.output);
    this.render();
    this.terminalReleased = false;
    this.releasedAltScreen = false;
    this.releasedBracketedPaste = false;
    this.releasedReportFocus = false;
  }

  println(...args: unknown[]): void {
    this.dispatchPrintLine(formatPrintArgs(args));
  }

  printf(template: string, ...args: unknown[]): void {
    this.dispatchPrintLine(formatPrintf(template, args));
  }

  private dispatchPrintLine(body: string): void {
    void this.send({ type: 'bubbletea/print-line', body }).catch(() => undefined);
  }

  private async bootstrap(): Promise<void> {
    this.state = 'starting';
    this.messageQueue = [];
    this.processingQueue = false;
    this.resultErr = null;
    this.terminalReleased = false;
    this.releasedAltScreen = false;
    this.releasedBracketedPaste = false;
    this.releasedReportFocus = false;
    this.bindExternalContext();
    this.state = 'running';
    this.markStarted();
    try {
      this.resolveInputSource();
    } catch (error) {
      const reason = error instanceof Error ? error : new Error(String(error));
      this.finish(reason);
      return;
    }
    this.setupTerminalInput();
    this.setupInput();
    this.renderer.start();
    this.applyStartupOptions();
    this.setupResizeListener();

    if (this.messageQueue.length > 0 && !this.processingQueue) {
      this.processingQueue = true;
      await this.drainQueue();
    }

    setTimeout(() => {
      this.render();
    }, 0);

    let initCmd: Cmd | null | undefined;
    try {
      initCmd = this.model?.init?.();
    } catch (error) {
      this.handlePanic(error);
      return;
    }

    if (initCmd) {
      this.processCmd(initCmd);
    }
  }

  private isRunning(): boolean {
    return this.state === 'running';
  }

  private markStarted(): void {
    if (!this.hasStarted) {
      this.hasStarted = true;
      this.started.resolve();
    }
  }

  private resolveInputSource(): void {
    if (this.inputType === InputType.Custom) {
      return;
    }

    const assignNewTty = (): void => {
      try {
        const ttyStream = openInputTTY();
        this.input = ttyStream;
      } catch (error) {
        this.handlePanic(error);
        throw error;
      }
    };

    if (this.inputType === InputType.Tty) {
      assignNewTty();
      return;
    }

    if (!this.input || isReadableTty(this.input)) {
      return;
    }

    assignNewTty();
  }

  private setupTerminalInput(): void {
    if (this.rawInputCleanup || this.renderer instanceof NilRenderer) {
      return;
    }
    const ttyInput = toRawModeTty(this.input);
    const ttyOutput = toWritableTty(this.output);

    if (!ttyInput) {
      return;
    }

    const initialRaw = Boolean(ttyInput.isRaw);
    try {
      ttyInput.setRawMode(true);
    } catch (error) {
      this.handlePanic(error);
      return;
    }
    this.rawInputCleanup = () => {
      try {
        ttyInput.setRawMode(initialRaw);
      } catch {
        // Ignore restore failures; by this point the program is already exiting.
      }
    };
  }

  private restoreRawInput(): void {
    if (!this.rawInputCleanup) {
      return;
    }
    try {
      this.rawInputCleanup();
    } finally {
      this.rawInputCleanup = undefined;
    }
  }

  private setupInput(): void {
    if (!this.input || this.inputCleanup) {
      return;
    }

    const controller = new AbortController();
    const reader = createCancelableInputReader(this.input);
    this.inputReader = reader;

    const emit = async (msg: Msg): Promise<void> => {
      if (!this.isRunning()) {
        return;
      }
      this.enqueueMsg(msg);
    };

    const handleReadError = (error: unknown): void => {
      if (controller.signal.aborted) {
        return;
      }
      if (error instanceof InputReaderCanceledError) {
        return;
      }
      this.handlePanic(error);
    };

    void readAnsiInputs({
      signal: controller.signal,
      input: reader,
      emit
    }).catch(handleReadError);

    let cleaned = false;

    const closeReader = () => {
      reader.close();
      if (!controller.signal.aborted) {
        controller.abort();
      }
      if (this.inputReader === reader) {
        this.inputReader = undefined;
      }
    };

    const cleanupFn = () => {
      if (cleaned) {
        return;
      }
      cleaned = true;
      reader.cancel();
      closeReader();
      if (this.inputCleanup === cleanupFn) {
        this.inputCleanup = undefined;
      }
      if (this.inputPause === pauseFn) {
        this.inputPause = undefined;
      }
    };

    const pauseFn = () => {
      if (cleaned) {
        return;
      }
      cleaned = true;
      closeReader();
      if (this.inputCleanup === cleanupFn) {
        this.inputCleanup = undefined;
      }
      if (this.inputPause === pauseFn) {
        this.inputPause = undefined;
      }
    };

    this.inputCleanup = cleanupFn;
    this.inputPause = pauseFn;
  }

  private cleanupInput(): void {
    if (this.inputCleanup) {
      this.inputCleanup();
      this.inputCleanup = undefined;
    }
    this.inputPause = undefined;
  }

  private pauseInput(): void {
    if (this.inputPause) {
      const pause = this.inputPause;
      this.inputPause = undefined;
      pause();
    }
  }

  private setupResizeListener(): void {
    if (this.resizeCleanup) {
      return;
    }

    if (!isWritableTty(this.output)) {
      return;
    }

    const output = this.output;

    const emitWindowSize = () => {
      this.emitWindowSizeFrom(output);
    };

    const onResize = () => {
      emitWindowSize();
    };

    output.on('resize', onResize);
    emitWindowSize();

    this.resizeCleanup = () => {
      if (typeof output.off === 'function') {
        output.off('resize', onResize);
      } else {
        output.removeListener('resize', onResize);
      }
    };
  }

  private emitWindowSizeFrom(stream: NodeJS.WritableStream | null): void {
    if (!this.isRunning() || !isWritableTty(stream)) {
      return;
    }
    const width = sanitizeDimension(stream.columns);
    const height = sanitizeDimension(stream.rows);
    if (width == null || height == null) {
      return;
    }
    this.enqueueMsg({
      type: 'bubbletea/window-size',
      width,
      height
    });
  }

  private cleanupResizeListener(): void {
    if (this.resizeCleanup) {
      this.resizeCleanup();
      this.resizeCleanup = undefined;
    }
  }

  private applyStartupOptions(): void {
    if (this.startupOptions.has(StartupFlag.AltScreen)) {
      this.renderer.enterAltScreen();
    }

    if (this.startupOptions.has(StartupFlag.WithoutBracketedPaste)) {
      this.renderer.disableBracketedPaste();
    } else if (!this.renderer.bracketedPasteActive()) {
      this.renderer.enableBracketedPaste();
    }

    if (this.startupOptions.has(StartupFlag.MouseCellMotion)) {
      this.renderer.enableMouseCellMotion();
      this.renderer.enableMouseSGRMode();
    } else if (this.startupOptions.has(StartupFlag.MouseAllMotion)) {
      this.renderer.enableMouseAllMotion();
      this.renderer.enableMouseSGRMode();
    }

    if (this.startupOptions.has(StartupFlag.ReportFocus)) {
      this.renderer.enableReportFocus();
    }
  }

  private bindExternalContext(): void {
    this.clearExternalContextBinding();
    const controller = this.externalContext;
    const signal = controller?.signal;
    if (!signal) {
      return;
    }

    const onAbort = () => {
      this.handleExternalAbort(signal.reason);
    };

    if (signal.aborted) {
      onAbort();
      return;
    }

    signal.addEventListener('abort', onAbort, { once: true });
    this.externalAbortCleanup = () => {
      signal.removeEventListener('abort', onAbort);
    };
  }

  private clearExternalContextBinding(): void {
    if (this.externalAbortCleanup) {
      this.externalAbortCleanup();
      this.externalAbortCleanup = undefined;
    }
  }

  private render(): void {
    if (!this.model || typeof this.model.view !== 'function') {
      return;
    }

    try {
      const viewResult = this.model.view();
      if (typeof viewResult === 'string') {
        this.renderer.write(viewResult);
      }
    } catch (error) {
      this.handlePanic(error);
    }
  }

  private enqueueMsg(msg: InternalMsg): void {
    if (!this.isRunning()) {
      return;
    }
    this.messageQueue.push(msg);
    this.scheduleQueueDrain();
  }

  private scheduleQueueDrain(): void {
    if (!this.isRunning() || this.processingQueue) {
      return;
    }
    this.processingQueue = true;
    scheduleMicrotask(() => {
      void this.drainQueue();
    });
  }

  private async drainQueue(): Promise<void> {
    try {
      while (this.isRunning() && this.messageQueue.length > 0) {
        const next = this.messageQueue.shift();
        if (next !== undefined) {
          await this.dispatchMsg(next);
        }
      }
    } finally {
      this.processingQueue = false;
      if (this.isRunning() && this.messageQueue.length > 0) {
        this.scheduleQueueDrain();
      }
    }
  }

  private async dispatchMsg(msg: InternalMsg): Promise<void> {
    if (!this.isRunning()) {
      return;
    }

    if (isCmdArray(msg)) {
      await this.execCmdCollection(msg);
      return;
    }

    let nextMsg: Msg | null | undefined = msg as Msg;
    if (this.filter) {
      try {
        nextMsg = this.filter(this.model, msg as Msg);
      } catch (error) {
        this.handlePanic(error);
        return;
      }
    }

    if (nextMsg == null) {
      return;
    }

    if (isCmdArray(nextMsg)) {
      await this.execCmdCollection(nextMsg);
      return;
    }

    if (isQuitMessage(nextMsg)) {
      this.finish(null);
      return;
    }

    this.handleInternalMsg(nextMsg);
    this.renderer.handleMessage?.(nextMsg);

    await this.applyUpdate(nextMsg);
  }

  private async applyUpdate(msg: Msg): Promise<void> {
    if (!this.model || typeof this.model.update !== 'function') {
      this.render();
      return;
    }

    let result: [Model, Cmd?] | [Model?] | null | undefined;
    try {
      result = this.model.update(msg);
    } catch (error) {
      this.handlePanic(error);
      return;
    }

    if (Array.isArray(result) && result.length > 0) {
      const [nextModel, cmd] = result as [Model, Cmd | undefined];
      if (nextModel) {
        this.model = nextModel;
      }
      if (cmd) {
        this.processCmd(cmd);
      }
    }

    this.render();
  }

  private processCmd(cmd: Cmd | null | undefined): void {
    if (!cmd || !this.isRunning() || !isConcreteCmd(cmd)) {
      return;
    }
    void this.execCmd(cmd);
  }

  private async execCmd(cmd: ConcreteCmd): Promise<void> {
    if (!this.isRunning()) {
      return;
    }
    try {
      const result = await cmd();
      await this.handleCmdResult(result);
    } catch (error) {
      this.handlePanic(error);
    }
  }

  private async execCmdCollection(cmds: Cmd[]): Promise<void> {
    for (const cmd of cmds) {
      if (!this.isRunning()) {
        return;
      }
      if (!isConcreteCmd(cmd)) {
        continue;
      }
      await this.execCmd(cmd);
    }
  }

  private async handleCmdResult(
    result: Msg | BatchMsg | SequenceMsg | null | undefined
  ): Promise<void> {
    if (!this.isRunning() || result == null) {
      return;
    }

    if (isCmdArray(result)) {
      await this.execCmdCollection(result);
      return;
    }

    this.enqueueMsg(result);
  }

  private handleInternalMsg(msg: Msg): void {
    if (!isRecord(msg) || typeof (msg as { type?: unknown }).type !== 'string') {
      return;
    }

    switch ((msg as { type: string }).type) {
      case 'bubbletea/clear-screen':
        this.renderer.clearScreen();
        break;
      case 'bubbletea/enter-alt-screen':
        this.renderer.enterAltScreen();
        break;
      case 'bubbletea/exit-alt-screen':
        this.renderer.exitAltScreen();
        break;
      case 'bubbletea/enable-mouse-cell-motion':
        this.renderer.enableMouseCellMotion();
        this.renderer.enableMouseSGRMode();
        break;
      case 'bubbletea/enable-mouse-all-motion':
        this.renderer.enableMouseAllMotion();
        this.renderer.enableMouseSGRMode();
        break;
      case 'bubbletea/disable-mouse':
        this.disableMouseModes();
        break;
      case 'bubbletea/hide-cursor':
        this.renderer.hideCursor();
        break;
      case 'bubbletea/show-cursor':
        this.renderer.showCursor();
        break;
      case 'bubbletea/enable-bracketed-paste':
        this.renderer.enableBracketedPaste();
        break;
      case 'bubbletea/disable-bracketed-paste':
        this.renderer.disableBracketedPaste();
        break;
      case 'bubbletea/enable-report-focus':
        this.renderer.enableReportFocus();
        break;
      case 'bubbletea/disable-report-focus':
        this.renderer.disableReportFocus();
        break;
      default:
        break;
    }
  }

  private disableMouseModes(): void {
    this.renderer.disableMouseCellMotion();
    this.renderer.disableMouseAllMotion();
    this.renderer.disableMouseSGRMode();
  }

  private stopRenderer(err: Error | null): void {
    const shouldKill = err instanceof ProgramKilledError || err instanceof ProgramPanicError;
    if (shouldKill) {
      this.renderer.kill();
    } else {
      this.renderer.stop();
    }
    this.restoreTerminalState();
  }

  private restoreTerminalState(): void {
    this.renderer.disableBracketedPaste();
    this.renderer.showCursor();
    this.disableMouseModes();

    if (this.renderer.reportFocus()) {
      this.renderer.disableReportFocus();
    }

    if (this.renderer.altScreen()) {
      this.renderer.exitAltScreen();
    }

    this.restoreRawInput();
  }

  private finish(err: Error | null): void {
    if (!this.resultErr && err) {
      this.resultErr = err;
    }

    if (this.state === 'stopping' || this.state === 'stopped') {
      return;
    }

    this.state = 'stopping';
    this.cleanupInput();
    this.cleanupResizeListener();
    this.clearExternalContextBinding();
    this.messageQueue.length = 0;
    this.processingQueue = false;
    this.stopRenderer(err);
    this.terminalReleased = false;
    this.releasedAltScreen = false;
    this.releasedBracketedPaste = false;
    this.releasedReportFocus = false;
    this.markStarted();
    this.state = 'stopped';
    this.finished.resolve();
  }

  private handlePanic(error: unknown): void {
    const original = error instanceof Error ? error : new Error(String(error));
    const panicError =
      error instanceof ProgramPanicError
        ? error
        : new ProgramPanicError(original.message, { cause: original });
    this.kill(panicError);
  }

  private handleExternalAbort(reason: unknown): void {
    const cause = toError(reason, 'context canceled');
    const killErr = new ProgramKilledError('program was killed', { cause });
    this.finish(killErr);
  }
}

export function NewProgram(
  model: Model | null,
  ...opts: Array<ProgramOption | null | undefined>
): Program {
  const program = new Program(model);
  for (const opt of opts) {
    opt?.(program);
  }
  return program;
}

export const WithOutput = (output: NodeJS.WritableStream | null): ProgramOption => (program) => {
  program.output = output;
};

export const WithInput = (input: NodeJS.ReadableStream | null): ProgramOption => (program) => {
  program.input = input;
  program.inputType = InputType.Custom;
};

export const WithInputTTY = (): ProgramOption => (program) => {
  program.inputType = InputType.Tty;
};

export const WithEnvironment = (env: string[]): ProgramOption => (program) => {
  program.environ = [...env];
};

export const WithoutSignals = (): ProgramOption => (program) => {
  program.ignoreSignals = true;
};

export const WithoutRenderer = (): ProgramOption => (program) => {
  program.renderer = new NilRenderer();
};

export const WithoutSignalHandler = (): ProgramOption => (program) => {
  program.startupOptions.add(StartupFlag.WithoutSignalHandler);
};

export const WithoutCatchPanics = (): ProgramOption => (program) => {
  program.startupOptions.add(StartupFlag.WithoutCatchPanics);
};

export const WithoutBracketedPaste = (): ProgramOption => (program) => {
  program.startupOptions.add(StartupFlag.WithoutBracketedPaste);
};

export const WithAltScreen = (): ProgramOption => (program) => {
  program.startupOptions.add(StartupFlag.AltScreen);
};

export const WithANSICompressor = (): ProgramOption => (program) => {
  program.startupOptions.add(StartupFlag.ANSICompressor);
};

export const WithMouseCellMotion = (): ProgramOption => (program) => {
  program.startupOptions.add(StartupFlag.MouseCellMotion);
  program.startupOptions.remove(StartupFlag.MouseAllMotion);
};

export const WithMouseAllMotion = (): ProgramOption => (program) => {
  program.startupOptions.add(StartupFlag.MouseAllMotion);
  program.startupOptions.remove(StartupFlag.MouseCellMotion);
};

export const WithFilter = (filter: FilterFn): ProgramOption => (program) => {
  program.filter = filter;
};

export const WithContext = (context: ProgramContext): ProgramOption => (program) => {
  program.externalContext = context;
};

export const WithFPS = (fps: number): ProgramOption => (program) => {
  program.fps = normalizeFps(fps);
};

export const WithReportFocus = (): ProgramOption => (program) => {
  program.startupOptions.add(StartupFlag.ReportFocus);
};

// Command primitives ---------------------------------------------------------

type ConcreteCmd<TMsg = Msg> = Exclude<Cmd<TMsg>, null | undefined>;
type TimerHandle = ReturnType<typeof setTimeout>;

const isConcreteCmd = <TMsg = Msg>(cmd: Cmd<TMsg>): cmd is ConcreteCmd<TMsg> =>
  typeof cmd === 'function';

const filterConcreteCmds = (cmds: Cmd[]): ConcreteCmd[] => cmds.filter(isConcreteCmd);

const compactCmds = (cmds: Cmd[], multiCmdFactory: (validCmds: ConcreteCmd[]) => ConcreteCmd): Cmd => {
  const validCmds = filterConcreteCmds(cmds);
  if (validCmds.length === 0) {
    return null;
  }
  if (validCmds.length === 1) {
    return validCmds[0];
  }
  return multiCmdFactory(validCmds);
};

const isNil = (value: unknown): value is null | undefined => value === null || value === undefined;

const normalizeDuration = (duration: Duration): number => {
  if (!Number.isFinite(duration)) {
    return 0;
  }
  return Math.max(0, duration);
};

const computeEveryDelay = (duration: Duration, nowMs: number): number => {
  const normalized = normalizeDuration(duration);
  if (normalized === 0) {
    return 0;
  }
  const remainder = nowMs % normalized;
  return remainder === 0 ? normalized : normalized - remainder;
};

const createTimerPromise = <TMsg>(delayMs: number, fn: (ts: Date) => TMsg): Promise<TMsg> => {
  const clampedDelay = Math.max(0, delayMs);
  return new Promise<TMsg>((resolve) => {
    const handle: TimerHandle = setTimeout(() => {
      clearTimeout(handle);
      resolve(fn(new Date()));
    }, clampedDelay);
  });
};

export const Quit: Cmd<QuitMsg> = () => ({ type: 'bubbletea/quit' });

export function Batch(...cmds: Cmd[]): Cmd {
  return compactCmds(cmds, (validCmds) => () => [...validCmds] as BatchMsg);
}

export function Sequence(...cmds: Cmd[]): Cmd {
  return compactCmds(cmds, (validCmds) => () => [...validCmds] as SequenceMsg);
}

export function Sequentially(...cmds: Cmd[]): Cmd {
  const validCmds = filterConcreteCmds(cmds);
  return async () => {
    for (const cmd of validCmds) {
      const result = await cmd();
      if (!isNil(result)) {
        return result;
      }
    }
    return null;
  };
}

export function Every<TMsg = Msg>(duration: Duration, fn: (ts: Date) => TMsg): Cmd<TMsg> {
  const delay = computeEveryDelay(duration, Date.now());
  const timerPromise = createTimerPromise(delay, fn);
  return () => timerPromise;
}

export function Tick<TMsg = Msg>(duration: Duration, fn: (ts: Date) => TMsg): Cmd<TMsg> {
  const timerPromise = createTimerPromise(normalizeDuration(duration), fn);
  return () => timerPromise;
}

const createSimpleMsgCmd = <TType extends string>(
  type: TType
): Cmd<SimpleMsg<TType>> => () => ({ type } as SimpleMsg<TType>);

export const ClearScreen: Cmd<ClearScreenMsg> = createSimpleMsgCmd('bubbletea/clear-screen');
export const EnterAltScreen: Cmd<EnterAltScreenMsg> = createSimpleMsgCmd('bubbletea/enter-alt-screen');
export const ExitAltScreen: Cmd<ExitAltScreenMsg> = createSimpleMsgCmd('bubbletea/exit-alt-screen');
export const EnableMouseCellMotion: Cmd<EnableMouseCellMotionMsg> = createSimpleMsgCmd(
  'bubbletea/enable-mouse-cell-motion'
);
export const EnableMouseAllMotion: Cmd<EnableMouseAllMotionMsg> = createSimpleMsgCmd(
  'bubbletea/enable-mouse-all-motion'
);
export const DisableMouse: Cmd<DisableMouseMsg> = createSimpleMsgCmd('bubbletea/disable-mouse');
export const HideCursor: Cmd<HideCursorMsg> = createSimpleMsgCmd('bubbletea/hide-cursor');
export const ShowCursor: Cmd<ShowCursorMsg> = createSimpleMsgCmd('bubbletea/show-cursor');
export const EnableBracketedPaste: Cmd<EnableBracketedPasteMsg> = createSimpleMsgCmd(
  'bubbletea/enable-bracketed-paste'
);
export const DisableBracketedPaste: Cmd<DisableBracketedPasteMsg> = createSimpleMsgCmd(
  'bubbletea/disable-bracketed-paste'
);
export const EnableReportFocus: Cmd<EnableReportFocusMsg> = createSimpleMsgCmd(
  'bubbletea/enable-report-focus'
);
export const DisableReportFocus: Cmd<DisableReportFocusMsg> = createSimpleMsgCmd(
  'bubbletea/disable-report-focus'
);
export const Println = (...args: unknown[]): Cmd<PrintLineMsg> => () => ({
  type: 'bubbletea/print-line',
  body: formatPrintArgs(args)
});
export const Printf = (template: string, ...args: unknown[]): Cmd<PrintLineMsg> => () => ({
  type: 'bubbletea/print-line',
  body: formatPrintf(template, args)
});

const cloneLines = (lines: readonly string[]): string[] => lines.map((line) => String(line));

export const SyncScrollArea = (
  lines: readonly string[],
  topBoundary: number,
  bottomBoundary: number
): Cmd<SyncScrollAreaMsg> => () => ({
  type: 'bubbletea/sync-scroll-area',
  lines: cloneLines(lines),
  topBoundary,
  bottomBoundary
});

export const ScrollUp = (
  lines: readonly string[],
  topBoundary: number,
  bottomBoundary: number
): Cmd<ScrollUpMsg> => () => ({
  type: 'bubbletea/scroll-up',
  lines: cloneLines(lines),
  topBoundary,
  bottomBoundary
});

export const ScrollDown = (
  lines: readonly string[],
  topBoundary: number,
  bottomBoundary: number
): Cmd<ScrollDownMsg> => () => ({
  type: 'bubbletea/scroll-down',
  lines: cloneLines(lines),
  topBoundary,
  bottomBoundary
});

export const ClearScrollArea = (): ClearScrollAreaMsg => ({
  type: 'bubbletea/clear-scroll-area'
});

const formatPrintArgs = (values: unknown[]): string => values.map(formatPrintArg).join('');

const formatPrintArg = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (value === null) {
    return '<nil>';
  }
  if (typeof value === 'undefined') {
    return '<undefined>';
  }
  if (typeof value === 'symbol') {
    return value.toString();
  }
  return utilFormat('%O', value);
};

const PRINTF_SPECIFIER_RE =
  /%([#0\- +']*)(\d+|\*)?(?:\.(\d+|\*))?([bcdeEfFgGopqsTtUxXvd%])/g;

interface PrintfFormatSpec {
  verb: string;
  flags: Set<string>;
  width?: number;
  precision?: number;
}

const pointerIds = new WeakMap<object, number>();
let pointerIdCounter = 0;

const getPointerAddressOverride = (value: object): number | null => {
	const override = Reflect.get(value, GO_POINTER_ADDRESS_SYMBOL);
	if (typeof override === 'number' && Number.isFinite(override)) {
		return Math.abs(Math.trunc(override));
	}
	if (typeof override === 'bigint') {
		const normalized = override < 0n ? -override : override;
		const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
		if (normalized <= maxSafe) {
			return Number(normalized);
		}
	}
	return null;
};

const getOrCreatePointerNumericId = (value: object): number => {
	let id = pointerIds.get(value);
	if (!id) {
		pointerIdCounter += 1;
		id = pointerIdCounter;
		pointerIds.set(value, id);
	}
	return id;
};

const getPointerNumericValue = (value: object): number =>
	getPointerAddressOverride(value) ?? getOrCreatePointerNumericId(value);

const formatPrintf = (template: string, values: unknown[]): string => {
  if (!template.includes('%')) {
    return template;
  }

  let argIndex = 0;

  const takeArg = (): unknown => {
    if (argIndex >= values.length) {
      return undefined;
    }
    const value = values[argIndex];
    argIndex += 1;
    return value;
  };

  const takeIntegerArg = (): number | undefined => {
    const raw = takeArg();
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return Math.trunc(raw);
    }
    if (typeof raw === 'bigint') {
      return Number(raw);
    }
    if (typeof raw === 'string') {
      const parsed = Number(raw);
      if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
        return Math.trunc(parsed);
      }
    }
    return undefined;
  };

  const formatted = template.replace(
    PRINTF_SPECIFIER_RE,
    (_, flagGroup = '', widthToken, precisionToken, verbToken) => {
      const verb = verbToken as string;
      if (verb === '%') {
        return '%';
      }

      const flags = new Set(flagGroup.split('').filter(Boolean));

      let width: number | undefined;
      if (widthToken === '*') {
        width = takeIntegerArg();
      } else if (typeof widthToken === 'string' && widthToken.length > 0) {
        width = parseInt(widthToken, 10);
      }

      let precision: number | undefined;
      if (precisionToken === '*') {
        precision = takeIntegerArg();
      } else if (typeof precisionToken === 'string' && precisionToken.length > 0) {
        precision = parseInt(precisionToken, 10);
      }

      if (typeof width === 'number' && Number.isFinite(width) && width < 0) {
        flags.add('-');
        width = Math.abs(width);
      }

      if (typeof precision === 'number' && precision < 0) {
        precision = undefined;
      }

      const value = takeArg();
      return formatPrintfValue(value, { verb, flags, width, precision });
    }
  );

  if (argIndex < values.length) {
    const extras = values
      .slice(argIndex)
      .map((value) => `%!(EXTRA ${typeof value}=${formatPrintArg(value)})`);
    return formatted + extras.join('');
  }

  return formatted;
};

const formatPrintfValue = (value: unknown, spec: PrintfFormatSpec): string => {
  if (value === undefined) {
    return `%!${spec.verb}(MISSING)`;
  }

  switch (spec.verb) {
    case 'd':
      return formatIntegerValue(value, spec, 10);
    case 'b':
      return formatIntegerValue(value, spec, 2);
    case 'o':
      return formatIntegerValue(value, spec, 8);
    case 'x':
      return formatIntegerValue(value, spec, 16);
    case 'X':
      return formatIntegerValue(value, spec, 16, true);
    case 'c':
      return formatRuneValue(value, spec);
    case 'U':
      return formatUnicodeValue(value, spec);
    case 'q':
      return formatStringValue(JSON.stringify(String(value)), spec);
    case 's':
      return formatStringValue(String(value), spec);
    case 't':
      return formatBoolValue(value, spec);
    case 'f':
    case 'F':
    case 'e':
    case 'E':
    case 'g':
    case 'G':
      return formatFloatValue(value, spec);
    case 'v':
    case 'V':
      return formatVerbValue(value, spec);
    case 'T':
      return formatTypeValue(value, spec);
    case 'p':
      return formatPointerValue(value, spec);
    default:
      return formatStringValue(formatPrintArg(value), spec);
  }
};

const formatIntegerValue = (
  value: unknown,
  spec: PrintfFormatSpec,
  base: number,
  uppercase = false
): string => {
  const bigValue = toBigIntValue(value);
  if (bigValue === null) {
    return formatStringValue(formatPrintArg(value), spec);
  }

  let magnitude = bigValue;
  let sign = '';
  if (magnitude < 0n) {
    sign = '-';
    magnitude = -magnitude;
  } else if (spec.flags.has('+')) {
    sign = '+';
  } else if (spec.flags.has(' ')) {
    sign = ' ';
  }

  let digits = magnitude.toString(base);
  if (uppercase) {
    digits = digits.toUpperCase();
  }

  let effectivePrecision = spec.precision;
  const zeroPadToWidth =
    effectivePrecision === undefined &&
    spec.flags.has('0') &&
    !spec.flags.has('-') &&
    typeof spec.width === 'number';

  if (zeroPadToWidth) {
    effectivePrecision = spec.width;
    if (sign.length > 0 && typeof effectivePrecision === 'number') {
      effectivePrecision = Math.max(effectivePrecision - 1, 0);
    }
  }

  if (typeof effectivePrecision === 'number') {
    if (effectivePrecision === 0 && magnitude === 0n) {
      digits = '';
    } else if (effectivePrecision > digits.length) {
      digits = digits.padStart(effectivePrecision, '0');
    }
  }

  const specForWidth =
    effectivePrecision === spec.precision ? spec : { ...spec, precision: effectivePrecision };

  let prefix = '';
  if (spec.flags.has('#') && digits !== '') {
    switch (spec.verb) {
      case 'b':
        prefix = '0b';
        break;
      case 'o':
        prefix = digits.startsWith('0') ? '' : '0';
        break;
      case 'x':
        prefix = '0x';
        break;
      case 'X':
        prefix = '0X';
        break;
      default:
        break;
    }
  }

  const combined = `${sign}${prefix}${digits}`;
  return applyWidth(combined, specForWidth, {
    numeric: true,
    signPrefixLength: sign.length + prefix.length
  });
};

const formatRuneValue = (value: unknown, spec: PrintfFormatSpec): string => {
  const numeric = toNumberValue(value);
  if (numeric === undefined) {
    return formatStringValue(formatPrintArg(value), spec);
  }
  try {
    const char = String.fromCodePoint(Math.trunc(numeric));
    return applyWidth(char, spec);
  } catch {
    return formatStringValue(formatPrintArg(value), spec);
  }
};

const formatUnicodeValue = (value: unknown, spec: PrintfFormatSpec): string => {
  const numeric = toNumberValue(value);
  if (numeric === undefined || Number.isNaN(numeric)) {
    return formatStringValue(formatPrintArg(value), spec);
  }
  const codePoint = Math.trunc(numeric);
  if (codePoint < 0 || codePoint > 0x10ffff) {
    return formatStringValue(formatPrintArg(value), spec);
  }
  const hex = codePoint.toString(16).toUpperCase().padStart(4, '0');
  let formatted = `U+${hex}`;
  if (spec.flags.has('#') && isPrintableRune(codePoint)) {
    const literal = String.fromCodePoint(codePoint);
    formatted = `${formatted} '${literal}'`;
  }
  return applyWidth(formatted, spec);
};

const isPrintableRune = (codePoint: number): boolean => {
  if (codePoint < 0x20 || codePoint === 0x7f) {
    return false;
  }
  return codePoint <= 0x10ffff;
};

const formatBoolValue = (value: unknown, spec: PrintfFormatSpec): string => {
  const result = Boolean(value) ? 'true' : 'false';
  return applyWidth(result, spec);
};

const formatFloatValue = (value: unknown, spec: PrintfFormatSpec): string => {
  const num = toNumberValue(value);
  if (num === undefined) {
    return formatStringValue(formatPrintArg(value), spec);
  }

  if (Number.isNaN(num)) {
    return applyWidth('NaN', spec);
  }
  if (!Number.isFinite(num)) {
    const sign = num < 0 ? '-' : spec.flags.has('+') ? '+' : spec.flags.has(' ') ? ' ' : '';
    return applyWidth(`${sign}Inf`, spec, {
      numeric: true,
      signPrefixLength: sign ? 1 : 0
    });
  }

  const verb = spec.verb;
  let precision = spec.precision;
  if (precision === undefined) {
    precision = verb === 'g' || verb === 'G' ? 6 : 6;
  }

  let formatted: string;
  switch (verb) {
    case 'f':
    case 'F':
      formatted = num.toFixed(precision);
      break;
    case 'e':
    case 'E':
      formatted = num.toExponential(precision);
      if (verb === 'E') {
        formatted = formatted.toUpperCase();
      }
      break;
    case 'g':
    case 'G':
      formatted = num.toPrecision(Math.max(precision, 1));
      if (!spec.flags.has('#')) {
        formatted = trimTrailingZeros(formatted);
      }
      if (verb === 'G') {
        formatted = formatted.toUpperCase();
      }
      break;
    default:
      formatted = num.toString();
  }

  if (spec.flags.has('#') && !formatted.includes('.')) {
    const exponentMatch = formatted.match(/[eE].*$/);
    if (exponentMatch) {
      const base = formatted.slice(0, formatted.length - exponentMatch[0].length);
      formatted = `${base}.${exponentMatch[0]}`;
    } else {
      formatted = `${formatted}.`;
    }
  }

  if (num >= 0) {
    if (spec.flags.has('+')) {
      formatted = `+${formatted}`;
    } else if (spec.flags.has(' ')) {
      formatted = ` ${formatted}`;
    }
  }

  const prefixLength =
    formatted.startsWith('-') || formatted.startsWith('+') || formatted.startsWith(' ')
      ? 1
      : 0;
  return applyWidth(formatted, spec, {
    numeric: true,
    signPrefixLength: prefixLength,
    zeroPadIgnoresPrecision: true
  });
};

const formatVerbValue = (value: unknown, spec: PrintfFormatSpec): string => {
  let text: string;
  if (spec.flags.has('#')) {
    text = formatDetailedValue(value);
  } else if (spec.flags.has('+')) {
    text = formatVerboseValue(value);
  } else {
    text = formatPrintArg(value);
  }
  return applyWidth(text, spec);
};

const formatTypeValue = (value: unknown, spec: PrintfFormatSpec): string => {
  const typeName = getValueTypeName(value);
  return applyWidth(typeName, spec);
};

const MAX_DETAILED_VALUE_DEPTH = 16;
const GO_TYPE_SYMBOL = Symbol.for('bubbletea.goType');
const GO_POINTER_SYMBOL = Symbol.for('bubbletea.goPointer');
const GO_POINTER_ADDRESS_SYMBOL = Symbol.for('bubbletea.goPointerAddress');
const GO_CHANNEL_SYMBOL = Symbol.for('bubbletea.goChannel');

const formatDetailedValue = (value: unknown, depth = 0): string => {
	if (depth > MAX_DETAILED_VALUE_DEPTH) {
		return formatPrintArg(value);
	}
	if (isGoPointerValue(value)) {
		const pointed = unwrapGoPointerValue(value);
		return `&${formatDetailedValue(pointed, depth + 1)}`;
	}
	if (isGoChannelValue(value)) {
		const channelTypeName = getValueTypeName(value, depth + 1);
		return formatReferenceLiteral(value as object, channelTypeName);
	}
	if (value instanceof Map) {
		return formatDetailedMapValue(value as Map<unknown, unknown>, depth + 1);
	}
	if (Array.isArray(value)) {
		return formatDetailedArrayValue(value, depth + 1);
	}
	if (value !== null && typeof value === 'object') {
		return formatDetailedObjectValue(value as Record<string, unknown>, depth + 1);
	}
	return formatDetailedPrimitive(value);
};

const formatDetailedPrimitive = (value: unknown): string => {
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (Number.isNaN(value)) {
      return 'NaN';
    }
    if (!Number.isFinite(value)) {
      return value < 0 ? '-Inf' : '+Inf';
    }
    return value.toString();
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (value === null || value === undefined) {
    return '<nil>';
  }
	if (typeof value === 'symbol') {
		return value.toString();
	}
	if (typeof value === 'function') {
		return formatFunctionLiteral(value);
	}
	return formatPrintArg(value);
};

const formatFunctionLiteral = (value: (...args: unknown[]) => unknown): string => {
	const typeName = getGoTypeOverride(value) ?? 'func()';
	return formatReferenceLiteral(value as unknown as object, typeName);
};

const formatVerboseValue = (value: unknown, depth = 0): string => {
	if (depth > MAX_DETAILED_VALUE_DEPTH) {
		return formatPrintArg(value);
	}
	if (isGoPointerValue(value)) {
		const pointed = unwrapGoPointerValue(value);
		return `&${formatVerboseValue(pointed, depth + 1)}`;
	}
	if (isGoChannelValue(value)) {
		const pointerValue = getPointerNumericValue(value as object);
		return `0x${pointerValue.toString(16)}`;
	}
	if (value instanceof Map) {
		return formatVerboseMapValue(value as Map<unknown, unknown>, depth + 1);
	}
	if (Array.isArray(value)) {
		return formatVerboseArrayValue(value, depth + 1);
	}
	if (value !== null && typeof value === 'object') {
		return formatVerboseStructValue(value as Record<string, unknown>, depth + 1);
	}
	if (value === null || value === undefined) {
		return '<nil>';
	}
	if (typeof value === 'string') {
		return value;
	}
	if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
		return String(value);
	}
	if (typeof value === 'function') {
		const pointerValue = getPointerNumericValue(value as unknown as object);
		return `0x${pointerValue.toString(16)}`;
	}
	return formatPrintArg(value);
};

const formatVerboseStructValue = (value: Record<string, unknown>, depth: number): string => {
	const keys = Object.keys(value);
	if (keys.length === 0) {
		return '{}';
	}
	const fields = keys.map((key) => `${key}:${formatVerboseValue(value[key], depth + 1)}`);
	return `{${fields.join(' ')}}`;
};

const formatVerboseArrayValue = (values: readonly unknown[], depth: number): string => {
	if (values.length === 0) {
		return '[]';
	}
	const formatted = values.map((entry) => formatVerboseValue(entry, depth + 1));
	return `[${formatted.join(' ')}]`;
};

const formatVerboseMapValue = (value: Map<unknown, unknown>, depth: number): string => {
	const entries = Array.from(value.entries()).map(([key, entryValue]) => ({
		keyText: formatVerboseValue(key, depth + 1),
		valueText: formatVerboseValue(entryValue, depth + 1)
	}));
	entries.sort((a, b) => a.keyText.localeCompare(b.keyText));
	if (entries.length === 0) {
		return 'map[]';
	}
	const body = entries.map((entry) => `${entry.keyText}:${entry.valueText}`).join(' ');
	return `map[${body}]`;
};

const formatDetailedArrayValue = (values: readonly unknown[], depth: number): string => {
	const elementType = inferCommonSliceElementType(values, depth);
	const formattedElements = values.map((entry) =>
		formatSliceElementValue(entry, elementType, depth)
	);
	const normalizedElementType = formatInterfaceTypeName(elementType);
	const body = formattedElements.join(', ');
	return `[]${normalizedElementType}{${body}}`;
};

const formatInterfaceTypeName = (typeName: string): string =>
	typeName === 'interface{}' ? 'interface {}' : typeName;

const formatMapTypeName = (keyType: string, valueType: string): string =>
	`map[${formatInterfaceTypeName(keyType)}]${formatInterfaceTypeName(valueType)}`;

const formatMapKeyValue = (key: unknown, dynamicKeyTypeName: string, depth: number): string => {
	if (isGoPointerValue(key) && key && typeof key === 'object') {
		return formatPointerMapKeyLiteral(key as object, dynamicKeyTypeName);
	}
	return formatDetailedValue(key, depth);
};

const formatReferenceLiteral = (value: object, typeName: string): string => {
	const pointerValue = getPointerNumericValue(value);
	return `(${typeName})(0x${pointerValue.toString(16)})`;
};

const formatPointerMapKeyLiteral = (key: object, pointerTypeName: string): string =>
	formatReferenceLiteral(key, pointerTypeName);

const formatMapValue = (value: unknown, declaredValueType: string, depth: number): string => {
	if (value && typeof value === 'object' && isGoPointerValue(value)) {
		const pointerTypeName = getValueTypeName(value, depth + 1);
		return formatReferenceLiteral(value as object, pointerTypeName);
	}
	if (declaredValueType === 'interface{}' && (value === null || value === undefined)) {
		return 'interface {}(nil)';
	}
	if (declaredValueType.startsWith('*') && (value === null || value === undefined)) {
		return `(${declaredValueType})(nil)`;
	}
	return formatDetailedValue(value, depth);
};

const formatSliceElementValue = (
	value: unknown,
	declaredElementType: string,
	depth: number
): string => {
	if (declaredElementType === 'interface{}') {
		if (value === null || value === undefined) {
			return 'interface {}(nil)';
		}
		if (value && typeof value === 'object' && isGoPointerValue(value)) {
			const pointerTypeName = getValueTypeName(value, depth + 1);
			return formatReferenceLiteral(value as object, pointerTypeName);
		}
		return formatDetailedValue(value, depth + 1);
	}
	if (declaredElementType.startsWith('*')) {
		if (value === null || value === undefined) {
			return `(${declaredElementType})(nil)`;
		}
		if (value && typeof value === 'object' && isGoPointerValue(value)) {
			return formatReferenceLiteral(value as object, declaredElementType);
		}
	}
	return formatDetailedValue(value, depth + 1);
};

const formatDetailedMapValue = (value: Map<unknown, unknown>, depth: number): string => {
	if (depth > MAX_DETAILED_VALUE_DEPTH) {
		return 'map[interface{}]interface{}{}';
	}
	const declaredKeyType = inferCommonMapKeyType(value, depth);
	const declaredValueType = inferCommonMapValueType(value, depth);
	const typeName = formatMapTypeName(declaredKeyType, declaredValueType);
	const entries = Array.from(value.entries()).map(([key, entryValue]) => {
		const dynamicKeyTypeName = getValueTypeName(key, depth + 1);
		const keyText = formatMapKeyValue(key, dynamicKeyTypeName, depth + 1);
		return {
			keyText,
			valueText: formatMapValue(entryValue, declaredValueType, depth + 1),
			sortToken: createMapKeySortToken(
				key,
				keyText,
				declaredKeyType,
				dynamicKeyTypeName
			)
		};
	});
	entries.sort((a, b) => {
		const comparison = compareMapKeyTokens(a.sortToken, b.sortToken);
		if (comparison !== 0) {
			return comparison;
		}
		return a.keyText.localeCompare(b.keyText);
	});
	const body = entries.map((entry) => `${entry.keyText}:${entry.valueText}`).join(', ');
	return `${typeName}{${body}}`;
};

type MapKeySortToken = {
	typeRank: number;
	kind:
		| 'nil'
		| 'bool'
		| 'number'
		| 'bigint'
		| 'string'
		| 'symbol'
		| 'object'
		| 'pointer'
		| 'fallback';
	boolValue?: boolean;
	numberValue?: number;
	isNaN?: boolean;
	bigIntValue?: bigint;
	stringValue?: string;
	pointerValue?: number;
};

const NIL_TYPE_NAME = '<nil>';

const GO_TYPE_ALIASES: Record<string, string> = {
	byte: 'uint8',
	rune: 'int32'
};

const GO_INTERFACE_TYPE_ORDER = [
	'<nil>',
	'string',
	'int8',
	'uint8',
	'int16',
	'uint16',
	'int32',
	'uint32',
	'int64',
	'uint64',
	'int',
	'uint',
	'uintptr',
	'complex64',
	'complex128',
	'float32',
	'float64',
	'bool'
] as const;

const GO_INTERFACE_TYPE_RANKS = new Map<string, number>(
	GO_INTERFACE_TYPE_ORDER.map((typeName, index) => [typeName, index])
);

const POINTER_TYPE_RANK_BASE = 200;
const ARRAY_TYPE_RANK_BASE = 300;
const STRUCT_TYPE_RANK_BASE = 400;
const FUNC_TYPE_RANK_BASE = 500;
const DEFAULT_TYPE_RANK_BASE = 1000;

const hashTypeName = (typeName: string): number => {
	let hash = 0;
	for (let i = 0; i < typeName.length; i += 1) {
		hash = (hash * 31 + typeName.charCodeAt(i)) & 0xffff;
	}
	return hash;
};

const normalizeGoTypeName = (typeName: string): string => GO_TYPE_ALIASES[typeName] ?? typeName;

const getGoTypeRank = (typeName: string): number => {
	const normalized = normalizeGoTypeName(typeName);
	const knownRank = GO_INTERFACE_TYPE_RANKS.get(normalized);
	if (knownRank !== undefined) {
		return knownRank;
	}
	if (normalized.startsWith('*')) {
		return POINTER_TYPE_RANK_BASE + hashTypeName(normalized);
	}
	if (normalized.startsWith('[')) {
		return ARRAY_TYPE_RANK_BASE + hashTypeName(normalized);
	}
	if (normalized.startsWith('map[')) {
		return ARRAY_TYPE_RANK_BASE + hashTypeName(normalized);
	}
	if (normalized.startsWith('func')) {
		return FUNC_TYPE_RANK_BASE + hashTypeName(normalized);
	}
	if (normalized === 'struct') {
		return STRUCT_TYPE_RANK_BASE;
	}
	return DEFAULT_TYPE_RANK_BASE + hashTypeName(normalized);
};

const createMapKeySortToken = (
	value: unknown,
	fallbackText: string,
	declaredKeyType: string,
	dynamicKeyType: string
): MapKeySortToken => {
	if (value === null || value === undefined) {
		return { typeRank: getGoTypeRank('<nil>'), kind: 'nil' };
	}
	const typeRankSource = declaredKeyType === 'interface{}' ? dynamicKeyType : declaredKeyType;
	const typeRank = getGoTypeRank(typeRankSource);
	if (isGoPointerValue(value) && value && typeof value === 'object') {
		return {
			typeRank,
			kind: 'pointer',
			pointerValue: getPointerNumericValue(value as object)
		};
	}
	switch (typeof value) {
		case 'boolean':
			return { typeRank, kind: 'bool', boolValue: value };
		case 'number':
			return {
				typeRank,
				kind: 'number',
				numberValue: value,
				isNaN: Number.isNaN(value)
			};
		case 'bigint':
			return { typeRank, kind: 'bigint', bigIntValue: value };
		case 'string':
			return { typeRank, kind: 'string', stringValue: value };
		case 'symbol': {
			const symbolText = Symbol.keyFor(value) ?? value.description ?? value.toString();
			return { typeRank, kind: 'symbol', stringValue: symbolText };
		}
		case 'object':
			return { typeRank, kind: 'object', stringValue: fallbackText };
		default:
			return { typeRank, kind: 'fallback', stringValue: fallbackText };
	}
};

const compareMapKeyTokens = (a: MapKeySortToken, b: MapKeySortToken): number => {
	if (a.typeRank !== b.typeRank) {
		return a.typeRank - b.typeRank;
	}
	if (a.kind !== b.kind) {
		return a.kind < b.kind ? -1 : 1;
	}
	switch (a.kind) {
		case 'nil':
			return 0;
		case 'bool': {
			const aValue = a.boolValue ? 1 : 0;
			const bValue = b.boolValue ? 1 : 0;
			return aValue - bValue;
		}
		case 'number': {
			const aIsNaN = Boolean(a.isNaN);
			const bIsNaN = Boolean(b.isNaN);
			if (aIsNaN || bIsNaN) {
				if (aIsNaN && bIsNaN) {
					return 0;
				}
				return aIsNaN ? -1 : 1;
			}
			const aValue = a.numberValue ?? 0;
			const bValue = b.numberValue ?? 0;
			if (aValue === bValue) {
				return 0;
			}
			return aValue < bValue ? -1 : 1;
		}
		case 'bigint': {
			const aValue = a.bigIntValue ?? 0n;
			const bValue = b.bigIntValue ?? 0n;
			if (aValue === bValue) {
				return 0;
			}
			return aValue < bValue ? -1 : 1;
		}
		case 'pointer': {
			const aValue = a.pointerValue ?? 0;
			const bValue = b.pointerValue ?? 0;
			if (aValue === bValue) {
				return 0;
			}
			return aValue < bValue ? -1 : 1;
		}
		default: {
			const aText = a.stringValue ?? '';
			const bText = b.stringValue ?? '';
			if (aText === bText) {
				return 0;
			}
			return aText < bText ? -1 : 1;
		}
	}
};

const formatDetailedObjectValue = (
	value: Record<string, unknown>,
	depth: number
): string => {
  const typeName = getValueTypeName(value, depth);
  const entries = Object.keys(value).map((key) => `${key}:${formatDetailedValue(value[key], depth + 1)}`);
  const body = entries.join(', ');
  return `${typeName}{${body}}`;
};

const isNumericGoType = (typeName: string): boolean => typeName === 'int' || typeName === 'float64';

const mergeInferredGoType = (current: string | null, candidate: string): string => {
	if (current === null || current === NIL_TYPE_NAME) {
		return candidate;
	}
	if (candidate === NIL_TYPE_NAME) {
		return current;
	}
	if (current === candidate) {
		return current;
	}
	if (isNumericGoType(current) && isNumericGoType(candidate)) {
		return 'float64';
	}
	return 'interface{}';
};

const inferCommonSliceElementType = (values: readonly unknown[], depth: number): string => {
	if (values.length === 0) {
		return 'interface{}';
	}
	let inferred: string | null = null;
	for (let i = 0; i < values.length; i += 1) {
		const candidate = getValueTypeName(values[i], depth);
		inferred = mergeInferredGoType(inferred, candidate);
		if (inferred === 'interface{}') {
			return 'interface{}';
		}
	}
	return inferred ?? 'interface{}';
};

const inferCommonMapKeyType = (value: Map<unknown, unknown>, depth: number): string => {
	let inferred: string | null = null;
	for (const key of value.keys()) {
		const candidate = getValueTypeName(key, depth + 1);
		inferred = mergeInferredGoType(inferred, candidate);
		if (inferred === 'interface{}') {
			break;
		}
	}
	return inferred ?? 'interface{}';
};

const inferCommonMapValueType = (value: Map<unknown, unknown>, depth: number): string => {
	let inferred: string | null = null;
	for (const entry of value.values()) {
		const candidate = getValueTypeName(entry, depth + 1);
		inferred = mergeInferredGoType(inferred, candidate);
		if (inferred === 'interface{}') {
			break;
		}
	}
	return inferred ?? 'interface{}';
};

const getMapTypeName = (value: Map<unknown, unknown>, depth: number): string => {
	const keyType = inferCommonMapKeyType(value, depth);
	const valueType = inferCommonMapValueType(value, depth);
	return formatMapTypeName(keyType, valueType);
};

const getValueTypeName = (value: unknown, depth = 0): string => {
	if (depth > MAX_DETAILED_VALUE_DEPTH) {
		return 'interface{}';
	}
	const goTypeOverride = getGoTypeOverride(value);
	if (goTypeOverride) {
		return goTypeOverride;
	}
	if (isGoPointerValue(value)) {
		const pointed = unwrapGoPointerValue(value);
		const pointedTypeName = getValueTypeName(pointed, depth + 1);
		return `*${pointedTypeName}`;
	}
	if (value === null || value === undefined) {
		return NIL_TYPE_NAME;
	}
	if (value instanceof Map) {
		return getMapTypeName(value as Map<unknown, unknown>, depth + 1);
	}
	if (Array.isArray(value)) {
		const elementType = inferCommonSliceElementType(value, depth + 1);
		return `[]${formatInterfaceTypeName(elementType)}`;
	}
	if (typeof value === 'string') {
    return 'string';
  }
  if (typeof value === 'boolean') {
    return 'bool';
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'int' : 'float64';
  }
  if (typeof value === 'bigint') {
    return 'int';
  }
  if (typeof value === 'function') {
    return 'func';
  }
	if (typeof value === 'object') {
		const ctor = (value as Record<string, unknown>).constructor;
		if (typeof ctor?.name === 'string' && ctor.name.length > 0 && ctor.name !== 'Object') {
			return ctor.name;
		}
		return 'struct';
	}
	return typeof value;
};

const getGoTypeOverride = (value: unknown): string | undefined => {
	if ((value && typeof value === 'object') || typeof value === 'function') {
		const override = Reflect.get(value as object, GO_TYPE_SYMBOL);
		if (typeof override === 'string' && override.length > 0) {
			return override;
		}
	}
	return undefined;
};

const isGoPointerValue = (value: unknown): boolean =>
	Boolean(value && typeof value === 'object' && Reflect.has(value as object, GO_POINTER_SYMBOL));

const isGoChannelValue = (value: unknown): boolean =>
	Boolean(value && (typeof value === 'object') && Reflect.has(value as object, GO_CHANNEL_SYMBOL));

const unwrapGoPointerValue = (value: unknown): unknown =>
	Reflect.get(value as object, GO_POINTER_SYMBOL);

const formatPointerValue = (value: unknown, spec: PrintfFormatSpec): string => {
  let text: string;
  if (value === null || value === undefined) {
    text = '0x0';
  } else if (typeof value === 'object' || typeof value === 'function') {
    const pointerValue = getPointerNumericValue(value as object);
    text = `0x${pointerValue.toString(16)}`;
  } else {
    const bigValue = toBigIntValue(value);
    if (bigValue === null) {
      text = '0x0';
    } else {
      const unsigned = bigValue < 0n ? -bigValue : bigValue;
      text = `0x${unsigned.toString(16)}`;
    }
  }
  const zeroPadWidth =
    spec.flags.has('0') && !spec.flags.has('-') && typeof spec.width === 'number' && spec.width > 0;
  if (zeroPadWidth && text.startsWith('0x')) {
    const digits = text.slice(2);
    const paddedDigits = digits.padStart(spec.width ?? 0, '0');
    const paddedText = `0x${paddedDigits}`;
    const adjustedSpec: PrintfFormatSpec = { ...spec, width: undefined };
    return applyWidth(paddedText, adjustedSpec, { numeric: true, signPrefixLength: 2 });
  }

  return applyWidth(text, spec, { numeric: true, signPrefixLength: 2 });
};

const formatStringValue = (value: string, spec: PrintfFormatSpec): string => {
  const truncated = truncateString(value, spec.precision);
  return applyWidth(truncated, spec);
};

const truncateString = (value: string, precision?: number): string => {
  if (precision === undefined) {
    return value;
  }
  if (precision <= 0) {
    return '';
  }
  const chars = Array.from(value);
  if (chars.length <= precision) {
    return value;
  }
  return chars.slice(0, precision).join('');
};

const trimTrailingZeros = (value: string): string => {
  const exponentMatch = value.match(/[eE].*$/);
  const exponent = exponentMatch ? exponentMatch[0] : '';
  let base = exponent ? value.slice(0, -exponent.length) : value;
  if (!base.includes('.')) {
    return value;
  }
  base = base.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
  return `${base}${exponent}`;
};

const applyWidth = (
  value: string,
  spec: PrintfFormatSpec,
  options: { numeric?: boolean; signPrefixLength?: number; zeroPadIgnoresPrecision?: boolean } = {}
): string => {
  const width = spec.width;
  if (typeof width !== 'number' || width <= value.length) {
    return value;
  }
  const { numeric = false, signPrefixLength = 0, zeroPadIgnoresPrecision = false } = options;
  const leftJustify = spec.flags.has('-');
  const padWithZero =
    numeric &&
    spec.flags.has('0') &&
    !leftJustify &&
    (zeroPadIgnoresPrecision || spec.precision === undefined);
  const padChar = padWithZero ? '0' : ' ';
  const padding = padChar.repeat(width - value.length);
  if (padWithZero && signPrefixLength > 0) {
    return value.slice(0, signPrefixLength) + padding + value.slice(signPrefixLength);
  }
  return leftJustify ? value + padding : padding + value;
};

const toBigIntValue = (value: unknown): bigint | null => {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return BigInt(Math.trunc(value));
  }
  if (typeof value === 'string') {
    try {
      if (value.trim() === '') {
        return null;
      }
      return BigInt(value.trim());
    } catch {
      const parsed = Number(value);
      if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
        return BigInt(Math.trunc(parsed));
      }
    }
  }
  if (typeof value === 'boolean') {
    return value ? 1n : 0n;
  }
  return null;
};

const toNumberValue = (value: unknown): number | undefined => {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'bigint') {
    const converted = Number(value);
    return Number.isNaN(converted) ? undefined : converted;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
};

// Logging ---------------------------------------------------------------

export interface LogOptionsSetter {
  setOutput(output: NodeJS.WritableStream): void;
  setPrefix(prefix: string): void;
}

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error';
const consoleMethods: ConsoleMethod[] = ['log', 'info', 'warn', 'error'];

class ConsoleLogOptions implements LogOptionsSetter {
  private consoleInstance: Console | null = null;
  private prefix = '';
  private patched = false;
  private readonly originals: Partial<Record<ConsoleMethod, (...args: unknown[]) => void>> = {};
  private readonly activeOutputs = new Set<NodeJS.WritableStream>();

  constructor(private readonly target: Pick<typeof console, ConsoleMethod> = console) {}

  setOutput(output: NodeJS.WritableStream): void {
    this.consoleInstance = new Console({ stdout: output, stderr: output });
    this.patchConsole();
    this.trackOutputLifecycle(output);
  }

  setPrefix(prefix: string): void {
    this.prefix = prefix;
  }

  private patchConsole(): void {
    if (this.patched) {
      return;
    }
    this.patched = true;
    for (const method of consoleMethods) {
      const original = this.target[method].bind(this.target);
      this.originals[method] = this.target[method];
      this.target[method] = (...args: unknown[]) => {
        const instance = this.consoleInstance;
        if (!instance) {
          original(...args);
          return;
        }
        if (args.length === 0) {
          instance[method](this.prefix);
          return;
        }
        const [first, ...rest] = args;
        if (typeof first === 'string') {
          instance[method](`${this.prefix}${first}`, ...rest);
        } else {
          instance[method](this.prefix ? `${this.prefix}${String(first)}` : first, ...rest);
        }
      };
    }
  }

  private trackOutputLifecycle(output: NodeJS.WritableStream): void {
    if (this.activeOutputs.has(output)) {
      return;
    }
    this.activeOutputs.add(output);
    let settled = false;
    const release = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      output.off?.('close', release);
      output.off?.('finish', release);
      output.off?.('error', release);
      this.activeOutputs.delete(output);
      if (this.activeOutputs.size === 0) {
        this.restoreConsole();
      }
    };
    output.once?.('close', release);
    output.once?.('finish', release);
    output.once?.('error', release);
  }

  private restoreConsole(): void {
    if (!this.patched) {
      return;
    }
    this.patched = false;
    this.consoleInstance = null;
    for (const method of consoleMethods) {
      const original = this.originals[method];
      if (original) {
        this.target[method] = original;
      }
    }
  }
}

const defaultConsoleLogger = new ConsoleLogOptions();

const ensureTrailingWhitespace = (value: string): string => {
  if (!value) {
    return '';
  }
  const lastChar = value[value.length - 1];
  return /\s/u.test(lastChar) ? value : `${value} `;
};

class FanOutWritable extends Writable {
  private readonly targets: NodeJS.WritableStream[];
  private readonly primary: NodeJS.WritableStream | null;

  constructor(
    targets: NodeJS.WritableStream[],
    private readonly normalizeTargets?: WeakSet<NodeJS.WritableStream>
  ) {
    super();
    this.targets = targets;
    this.primary = targets[0] ?? null;
    this.forwardLifecycleEvents();
  }

  override _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    if (this.targets.length === 0) {
      callback();
      return;
    }
    let pending = this.targets.length;
    let error: Error | null = null;

    const settle = (err?: Error | null): void => {
      if (err && !error) {
        error = err;
      }
      pending -= 1;
      if (pending === 0) {
        callback(error ?? undefined);
      }
    };

    for (const target of this.targets) {
      try {
        const { payload, payloadEncoding } = this.prepareChunk(chunk, encoding, target);
        if (typeof payload === 'string') {
          target.write(payload, payloadEncoding ?? 'utf8', (err) => {
            settle(err ?? undefined);
          });
        } else {
          target.write(payload, (err) => {
            settle(err ?? undefined);
          });
        }
      } catch (err) {
        settle(err as Error);
      }
    }
  }

  private prepareChunk(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    target: NodeJS.WritableStream
  ): { payload: Buffer | string; payloadEncoding?: BufferEncoding } {
    const normalize = Boolean(this.normalizeTargets && this.normalizeTargets.has(target)) && isWindowsPlatform();
    if (!normalize) {
      return { payload: chunk, payloadEncoding: encoding };
    }
    return normalizeWritableChunkForWindows(chunk, encoding);
  }

  private forwardLifecycleEvents(): void {
    const source = this.primary;
    if (!source || typeof source.once !== 'function') {
      return;
    }
    source.once('close', () => {
      this.emit('close');
    });
    source.once('finish', () => {
      this.emit('finish');
    });
    source.once('error', (err) => {
      this.emit('error', err);
    });
  }
}

export function createMultiWriterLogOptions(
  extraTargets: NodeJS.WritableStream[],
  baseLogger: LogOptionsSetter = defaultConsoleLogger
): LogOptionsSetter {
  const sanitizedTargets = extraTargets.filter((target): target is NodeJS.WritableStream => Boolean(target));
  const shouldNormalizeExtras = sanitizedTargets.length > 0 && isWindowsPlatform();
  const normalizeTargets = shouldNormalizeExtras ? new WeakSet(sanitizedTargets) : undefined;
  return {
    setOutput(output: NodeJS.WritableStream): void {
      if (sanitizedTargets.length === 0) {
        baseLogger.setOutput(output);
        return;
      }
      const fanOut = new FanOutWritable([output, ...sanitizedTargets], normalizeTargets);
      baseLogger.setOutput(fanOut);
    },
    setPrefix(prefix: string): void {
      baseLogger.setPrefix(prefix);
    }
  };
}

export function LogToFile(
  path: string,
  prefix = '',
  logger: LogOptionsSetter = defaultConsoleLogger
): WriteStream {
  const stream = createWriteStream(path, { flags: 'a', mode: 0o600 });
  logger.setOutput(stream);
  logger.setPrefix(ensureTrailingWhitespace(prefix));
  return stream;
}
