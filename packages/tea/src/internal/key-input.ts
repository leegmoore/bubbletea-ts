import type { BlurMsg, FocusMsg, MaybePromise, Msg } from '../index';
import type { Key, KeyMsg } from '../key';
import { KeyType } from '../key';
import type { MouseMsg } from '../mouse';
import { MouseAction, MouseButton, MouseEventType } from '../mouse';
import { goSequences } from './generated/goSequences';

export interface UnknownInputByteMsg {
  readonly type: 'bubbletea/unknown-input-byte';
  readonly byte: number;
}

export interface UnknownCSISequenceMsg {
  readonly type: 'bubbletea/unknown-csi-sequence';
  readonly sequence: readonly number[];
}

export const createUnknownInputByteMsg = (value: number): UnknownInputByteMsg => ({
  type: 'bubbletea/unknown-input-byte',
  byte: value & 0xff
});

export const createUnknownCSISequenceMsg = (
  sequence: Uint8Array | readonly number[]
): UnknownCSISequenceMsg => ({
  type: 'bubbletea/unknown-csi-sequence',
  sequence: Array.from(sequence)
});

export type DetectSequenceResult = [hasSequence: boolean, width: number, msg: Msg | undefined];

export type DetectOneMsgResult = [width: number, msg: Msg | undefined];

export type ReadAnsiInputChunk = Uint8Array | string;

export interface ReadAnsiInputsOptions {
  readonly signal: AbortSignal;
  readonly input: AsyncIterable<ReadAnsiInputChunk> | Iterable<ReadAnsiInputChunk>;
  readonly emit: (msg: Msg) => MaybePromise<void>;
}

const ESCAPE_BYTE = 0x1b;
const ESCAPE_CHAR = '\x1b';
const SPACE_CHAR = ' ';
const SPACE_RUNES = [SPACE_CHAR] as const;

const toLatin1Bytes = (value: string): Uint8Array => {
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) {
    bytes[i] = value.charCodeAt(i) & 0xff;
  }
  return bytes;
};
const KEY_NUL = KeyType.KeyNull;
const KEY_ESC = KeyType.KeyEsc;
const KEY_US = KeyType.KeyCtrlUnderscore;
const KEY_DEL = KeyType.KeyBackspace;
const SPACE_CODE_POINT = SPACE_CHAR.codePointAt(0) ?? 0x20;
const RUNE_ERROR = 0xfffd;
const X10_MOUSE_EVENT_LENGTH = 6;
const X10_MOUSE_BYTE_OFFSET = 32;
const UNKNOWN_CSI_REGEX = /^\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/;
const MOUSE_SGR_REGEX = /(\d+);(\d+);(\d+)([Mm])/;
const BRACKETED_PASTE_START = toLatin1Bytes('\x1b[200~');
const BRACKETED_PASTE_END = toLatin1Bytes('\x1b[201~');
const FOCUS_SEQUENCE = toLatin1Bytes('\x1b[I');
const BLUR_SEQUENCE = toLatin1Bytes('\x1b[O');

const FOCUS_MSG: FocusMsg = { type: 'bubbletea/focus' };
const BLUR_MSG: BlurMsg = { type: 'bubbletea/blur' };

interface SequenceKeyDefinition {
  readonly type: KeyType;
  readonly alt?: boolean;
  readonly runes?: readonly string[];
}

const EXTENDED_SEQUENCES = buildExtendedSequences();
const SEQUENCE_LENGTHS = buildSequenceLengths(EXTENDED_SEQUENCES);

export const detectSequence = (input: Uint8Array): DetectSequenceResult => {
  if (input.length === 0) {
    return [false, 0, undefined];
  }

  const inputString = toLatin1String(input);
  for (const length of SEQUENCE_LENGTHS) {
    if (length > input.length) {
      continue;
    }
    const prefix = inputString.slice(0, length);
    const definition = EXTENDED_SEQUENCES.get(prefix);
    if (definition) {
      return [true, length, keyDefinitionToMsg(definition)];
    }
  }

  const unknownMatch = UNKNOWN_CSI_REGEX.exec(inputString);
  if (unknownMatch) {
    const width = unknownMatch[0].length;
    return [true, width, createUnknownCSISequenceMsg(input.slice(0, width))];
  }

  return [false, 0, undefined];
};

export const detectOneMsg = (input: Uint8Array, canHaveMoreData: boolean): DetectOneMsgResult => {
  if (input.length === 0) {
    return [0, undefined];
  }

  if (input.length >= X10_MOUSE_EVENT_LENGTH && input[0] === ESCAPE_BYTE && input[1] === 0x5b) {
    if (input[2] === 0x4d) {
      return [X10_MOUSE_EVENT_LENGTH, parseX10MouseEvent(input)];
    }
    if (input[2] === 0x3c) {
      const tailString = toLatin1String(input.subarray(3));
      const match = MOUSE_SGR_REGEX.exec(tailString);
      if (match && match.index === 0) {
        const length = match[0].length + 3;
        return [length, parseSGRMouseEvent(input.subarray(0, length))];
      }
    }
  }

  const [hasFocus, focusWidth, focusMsg] = detectReportFocus(input);
  if (hasFocus) {
    return [focusWidth, focusMsg];
  }

  const [hasPaste, pasteWidth, pasteMsg] = detectBracketedPaste(input);
  if (hasPaste) {
    return [pasteWidth, pasteMsg];
  }

  const [hasSequence, seqWidth, seqMsg] = detectSequence(input);
  if (hasSequence) {
    return [seqWidth, seqMsg];
  }

  let alt = false;
  let offset = 0;
  if (input[offset] === ESCAPE_BYTE) {
    alt = true;
    offset += 1;
  }

  if (offset < input.length && input[offset] === 0) {
    return [offset + 1, keyToMsg({ type: KeyType.KeyNull, alt })];
  }

  const runes: string[] = [];
  while (offset < input.length) {
    const [codePoint, width] = decodeRune(input, offset);
    if (
      codePoint === RUNE_ERROR ||
      codePoint <= KEY_US ||
      codePoint === KEY_DEL ||
      codePoint === SPACE_CODE_POINT
    ) {
      break;
    }
    runes.push(String.fromCodePoint(codePoint));
    offset += width;
    if (alt) {
      break;
    }
  }

  if (offset >= input.length && canHaveMoreData) {
    return [0, undefined];
  }

  if (runes.length > 0) {
    const key: Key = { type: KeyType.KeyRunes, runes };
    if (alt) {
      key.alt = true;
    }
    if (runes.length === 1 && runes[0] === SPACE_CHAR) {
      key.type = KeyType.KeySpace;
      key.runes = [...SPACE_RUNES];
    }
    return [offset, keyToMsg(key)];
  }

  if (alt && input.length === 1) {
    return [1, keyToMsg({ type: KeyType.KeyEscape })];
  }

  const value = input[offset] ?? input[0];
  return [1, createUnknownInputByteMsg(value)];
};

export const readAnsiInputs = async ({ signal, input, emit }: ReadAnsiInputsOptions): Promise<void> => {
  if (signal.aborted) {
    return;
  }

  let pending = new Uint8Array(0);
  const source = toAsyncIterable(input);

  for await (const chunk of source) {
    if (signal.aborted) {
      return;
    }
    const bytes = normalizeChunk(chunk);
    const combined = pending.length > 0 ? concatBuffers(pending, bytes) : bytes;
    pending = await consumeBuffer(combined, true, emit);
    if (signal.aborted) {
      return;
    }
  }

  if (signal.aborted || pending.length === 0) {
    return;
  }

  while (pending.length > 0) {
    const previousLength = pending.length;
    pending = await consumeBuffer(pending, false, emit);
    if (pending.length === previousLength) {
      break;
    }
  }
};

const consumeBuffer = async (
  buffer: Uint8Array,
  canHaveMoreData: boolean,
  emit: (msg: Msg) => MaybePromise<void>
): Promise<Uint8Array> => {
  let offset = 0;
  while (offset < buffer.length) {
    const slice = buffer.subarray(offset);
    const [width, msg] = detectOneMsg(slice, canHaveMoreData);
    if (width === 0) {
      return buffer.subarray(offset);
    }
    offset += width;
    if (msg !== undefined) {
      await emit(msg);
    }
  }
  return new Uint8Array(0);
};

const normalizeChunk = (chunk: ReadAnsiInputChunk): Uint8Array => {
  if (typeof chunk === 'string') {
    return Buffer.from(chunk, 'utf8');
  }
  return Uint8Array.from(chunk);
};

const toAsyncIterable = <T>(value: AsyncIterable<T> | Iterable<T>): AsyncIterable<T> => {
  if ((value as AsyncIterable<T>)[Symbol.asyncIterator]) {
    return value as AsyncIterable<T>;
  }
  const iterable = value as Iterable<T>;
  return {
    async *[Symbol.asyncIterator]() {
      for (const entry of iterable) {
        yield entry;
      }
    }
  };
};

const concatBuffers = (first: Uint8Array, second: Uint8Array): Uint8Array => {
  const result = new Uint8Array(first.length + second.length);
  result.set(first);
  result.set(second, first.length);
  return result;
};

const detectReportFocus = (input: Uint8Array): DetectSequenceResult => {
  if (input.length === FOCUS_SEQUENCE.length && startsWithBytes(input, FOCUS_SEQUENCE)) {
    return [true, FOCUS_SEQUENCE.length, FOCUS_MSG];
  }
  if (input.length === BLUR_SEQUENCE.length && startsWithBytes(input, BLUR_SEQUENCE)) {
    return [true, BLUR_SEQUENCE.length, BLUR_MSG];
  }
  return [false, 0, undefined];
};

const detectBracketedPaste = (input: Uint8Array): DetectSequenceResult => {
  if (!startsWithBytes(input, BRACKETED_PASTE_START)) {
    return [false, 0, undefined];
  }
  const afterStart = input.subarray(BRACKETED_PASTE_START.length);
  const endIndex = indexOfSubarray(afterStart, BRACKETED_PASTE_END);
  if (endIndex === -1) {
    return [true, 0, undefined];
  }
  const payload = afterStart.subarray(0, endIndex);
  const runes = decodeRunes(payload);
  const key: Key = { type: KeyType.KeyRunes, runes, paste: true };
  const width = BRACKETED_PASTE_START.length + endIndex + BRACKETED_PASTE_END.length;
  return [true, width, keyToMsg(key)];
};

const decodeRunes = (buffer: Uint8Array): readonly string[] => {
  const runes: string[] = [];
  for (let offset = 0; offset < buffer.length; ) {
    const [codePoint, width] = decodeRune(buffer, offset);
    if (codePoint !== RUNE_ERROR) {
      runes.push(String.fromCodePoint(codePoint));
    }
    offset += width;
  }
  return runes;
};

const decodeRune = (buffer: Uint8Array, offset: number): [number, number] => {
  const first = buffer[offset];
  if (first < 0x80) {
    return [first, 1];
  }
  if (first < 0xc0) {
    return [RUNE_ERROR, 1];
  }
  let size = 0;
  let minValue = 0;
  let codePoint = 0;
  if (first < 0xe0) {
    size = 2;
    minValue = 0x80;
    codePoint = first & 0x1f;
  } else if (first < 0xf0) {
    size = 3;
    minValue = 0x800;
    codePoint = first & 0x0f;
  } else if (first < 0xf8) {
    size = 4;
    minValue = 0x10000;
    codePoint = first & 0x07;
  } else {
    return [RUNE_ERROR, 1];
  }
  if (offset + size > buffer.length) {
    return [RUNE_ERROR, 1];
  }
  for (let i = 1; i < size; i += 1) {
    const byte = buffer[offset + i];
    if ((byte & 0xc0) !== 0x80) {
      return [RUNE_ERROR, 1];
    }
    codePoint = (codePoint << 6) | (byte & 0x3f);
  }
  if (codePoint < minValue || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
    return [RUNE_ERROR, 1];
  }
  return [codePoint, size];
};

const parseSGRMouseEvent = (buffer: Uint8Array): MouseMsg => {
  const tail = toLatin1String(buffer.subarray(3));
  const match = MOUSE_SGR_REGEX.exec(tail);
  if (!match || match.index !== 0) {
    throw new Error('invalid mouse event');
  }
  const button = Number.parseInt(match[1] ?? '0', 10);
  const x = Number.parseInt(match[2] ?? '1', 10) - 1;
  const y = Number.parseInt(match[3] ?? '1', 10) - 1;
  const release = match[4] === 'm';
  const event = parseMouseButton(button, true);
  if (event.Action !== MouseAction.MouseActionMotion && !isWheelButton(event.Button) && release) {
    event.Action = MouseAction.MouseActionRelease;
    event.Type = MouseEventType.MouseRelease;
  }
  event.X = x;
  event.Y = y;
  return event;
};

const parseX10MouseEvent = (buffer: Uint8Array): MouseMsg => {
  const event = parseMouseButton(buffer[3] ?? 0, false);
  event.X = (buffer[4] ?? 0) - X10_MOUSE_BYTE_OFFSET - 1;
  event.Y = (buffer[5] ?? 0) - X10_MOUSE_BYTE_OFFSET - 1;
  return event;
};

const createMouseEvent = (): MouseMsg => ({
  X: 0,
  Y: 0,
  Shift: false,
  Alt: false,
  Ctrl: false,
  Action: MouseAction.MouseActionPress,
  Button: MouseButton.MouseButtonNone,
  Type: MouseEventType.MouseUnknown
});

const isWheelButton = (button: MouseButton): boolean =>
  button === MouseButton.MouseButtonWheelUp ||
  button === MouseButton.MouseButtonWheelDown ||
  button === MouseButton.MouseButtonWheelLeft ||
  button === MouseButton.MouseButtonWheelRight;

const parseMouseButton = (value: number, isSGR: boolean): MouseMsg => {
  const event = createMouseEvent();
  let encoded = value;
  if (!isSGR) {
    encoded -= X10_MOUSE_BYTE_OFFSET;
  }

  const BIT_SHIFT = 0b0000_0100;
  const BIT_ALT = 0b0000_1000;
  const BIT_CTRL = 0b0001_0000;
  const BIT_MOTION = 0b0010_0000;
  const BIT_WHEEL = 0b0100_0000;
  const BIT_ADD = 0b1000_0000;
  const BITS_MASK = 0b0000_0011;

  if ((encoded & BIT_ADD) !== 0) {
    event.Button = (MouseButton.MouseButtonBackward + (encoded & BITS_MASK)) as MouseButton;
  } else if ((encoded & BIT_WHEEL) !== 0) {
    event.Button = (MouseButton.MouseButtonWheelUp + (encoded & BITS_MASK)) as MouseButton;
  } else {
    event.Button = (MouseButton.MouseButtonLeft + (encoded & BITS_MASK)) as MouseButton;
    if ((encoded & BITS_MASK) === BITS_MASK) {
      event.Action = MouseAction.MouseActionRelease;
      event.Button = MouseButton.MouseButtonNone;
    }
  }

  if ((encoded & BIT_MOTION) !== 0 && !isWheelButton(event.Button)) {
    event.Action = MouseAction.MouseActionMotion;
  }

  event.Shift = (encoded & BIT_SHIFT) !== 0;
  event.Alt = (encoded & BIT_ALT) !== 0;
  event.Ctrl = (encoded & BIT_CTRL) !== 0;
  event.Type = deriveMouseEventType(event);
  return event;
};

const deriveMouseEventType = (event: MouseMsg): MouseEventType => {
  if (event.Button === MouseButton.MouseButtonLeft && event.Action === MouseAction.MouseActionPress) {
    return MouseEventType.MouseLeft;
  }
  if (event.Button === MouseButton.MouseButtonMiddle && event.Action === MouseAction.MouseActionPress) {
    return MouseEventType.MouseMiddle;
  }
  if (event.Button === MouseButton.MouseButtonRight && event.Action === MouseAction.MouseActionPress) {
    return MouseEventType.MouseRight;
  }
  if (event.Button === MouseButton.MouseButtonNone && event.Action === MouseAction.MouseActionRelease) {
    return MouseEventType.MouseRelease;
  }
  if (event.Button === MouseButton.MouseButtonWheelUp && event.Action === MouseAction.MouseActionPress) {
    return MouseEventType.MouseWheelUp;
  }
  if (event.Button === MouseButton.MouseButtonWheelDown && event.Action === MouseAction.MouseActionPress) {
    return MouseEventType.MouseWheelDown;
  }
  if (event.Button === MouseButton.MouseButtonWheelLeft && event.Action === MouseAction.MouseActionPress) {
    return MouseEventType.MouseWheelLeft;
  }
  if (event.Button === MouseButton.MouseButtonWheelRight && event.Action === MouseAction.MouseActionPress) {
    return MouseEventType.MouseWheelRight;
  }
  if (event.Button === MouseButton.MouseButtonBackward && event.Action === MouseAction.MouseActionPress) {
    return MouseEventType.MouseBackward;
  }
  if (event.Button === MouseButton.MouseButtonForward && event.Action === MouseAction.MouseActionPress) {
    return MouseEventType.MouseForward;
  }
  if (event.Action === MouseAction.MouseActionMotion) {
    switch (event.Button) {
      case MouseButton.MouseButtonLeft:
        return MouseEventType.MouseLeft;
      case MouseButton.MouseButtonMiddle:
        return MouseEventType.MouseMiddle;
      case MouseButton.MouseButtonRight:
        return MouseEventType.MouseRight;
      case MouseButton.MouseButtonBackward:
        return MouseEventType.MouseBackward;
      case MouseButton.MouseButtonForward:
        return MouseEventType.MouseForward;
      default:
        return MouseEventType.MouseMotion;
    }
  }
  return MouseEventType.MouseUnknown;
};

const keyDefinitionToMsg = (definition: SequenceKeyDefinition): KeyMsg => {
  const key: Key = { type: definition.type };
  if (definition.runes) {
    key.runes = [...definition.runes];
  }
  if (definition.alt) {
    key.alt = true;
  }
  return keyToMsg(key);
};

const keyToMsg = (key: Key): KeyMsg => {
  const msg: Key = { type: key.type };
  if (key.runes) {
    msg.runes = [...key.runes];
  }
  if (key.alt) {
    msg.alt = key.alt;
  }
  if (key.paste) {
    msg.paste = key.paste;
  }
  return msg;
};

function buildExtendedSequences(): Map<string, SequenceKeyDefinition> {
  const map = new Map<string, SequenceKeyDefinition>();
  const addDefinition = (sequence: string, definition: SequenceKeyDefinition): void => {
    map.set(sequence, definition);
  };

  for (const [sequence, entry] of Object.entries(goSequences)) {
    const baseDefinition: SequenceKeyDefinition = {
      type: entry.type,
      ...(entry.alt ? { alt: true } : {})
    };
    addDefinition(sequence, baseDefinition);
    if (entry.alt !== true) {
      addDefinition(`${ESCAPE_CHAR}${sequence}`, { ...baseDefinition, alt: true });
    }
  }

  for (let value = KEY_NUL + 1; value <= KEY_DEL; value += 1) {
    if (value === KEY_ESC) {
      continue;
    }
    const char = String.fromCharCode(value);
    addDefinition(char, { type: value as KeyType });
    addDefinition(`${ESCAPE_CHAR}${char}`, { type: value as KeyType, alt: true });
    if (value === KEY_US) {
      value = KEY_DEL - 1;
    }
  }

  addDefinition(SPACE_CHAR, { type: KeyType.KeySpace, runes: SPACE_RUNES });
  addDefinition(`${ESCAPE_CHAR}${SPACE_CHAR}`, {
    type: KeyType.KeySpace,
    alt: true,
    runes: SPACE_RUNES
  });
  addDefinition(`${ESCAPE_CHAR}${ESCAPE_CHAR}`, { type: KeyType.KeyEsc, alt: true });

  return map;
}

function buildSequenceLengths(map: Map<string, SequenceKeyDefinition>): number[] {
  const lengths = new Set<number>();
  for (const sequence of map.keys()) {
    lengths.add(sequence.length);
  }
  return Array.from(lengths).sort((a, b) => b - a);
}

const toLatin1String = (buffer: Uint8Array): string => {
  if (buffer.length === 0) {
    return '';
  }
  let result = '';
  for (let i = 0; i < buffer.length; i += 1) {
    result += String.fromCharCode(buffer[i]);
  }
  return result;
};

const startsWithBytes = (buffer: Uint8Array, prefix: Uint8Array): boolean => {
  if (buffer.length < prefix.length) {
    return false;
  }
  for (let i = 0; i < prefix.length; i += 1) {
    if (buffer[i] !== prefix[i]) {
      return false;
    }
  }
  return true;
};

const indexOfSubarray = (buffer: Uint8Array, search: Uint8Array): number => {
  outer: for (let i = 0; i <= buffer.length - search.length; i += 1) {
    for (let j = 0; j < search.length; j += 1) {
      if (buffer[i + j] !== search[j]) {
        continue outer;
      }
    }
    return i;
  }
  return -1;
};
