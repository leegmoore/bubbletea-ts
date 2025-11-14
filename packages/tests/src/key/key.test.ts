import { describe, expect, it } from 'vitest';

import type { BlurMsg, FocusMsg, Key, KeyMsg, MouseMsg, Msg } from '@bubbletea/tea';
import {
  KeyType,
  MouseAction,
  MouseButton,
  MouseEventType,
  keyToString,
  keyTypeToString
} from '@bubbletea/tea';
import type { UnknownCSISequenceMsg, UnknownInputByteMsg } from '@bubbletea/tea/internal';
import {
  createUnknownCSISequenceMsg,
  createUnknownInputByteMsg,
  detectOneMsg,
  detectSequence,
  readAnsiInputs
} from '@bubbletea/tea/internal';

import type { SequenceEntry } from './fixtures/goSequences';
import { goSequences } from './fixtures/goSequences';

type ReadonlyRunes = readonly string[];

type SeqTest = {
  readonly seq: Uint8Array;
  readonly msg: Msg;
  readonly label: string;
};

type ReadInputTestCase = {
  readonly name: string;
  readonly input: Uint8Array;
  readonly expected: readonly Msg[];
};

const runes = (value: string): ReadonlyRunes => Array.from(value);

const ESCAPE_BYTE = 0x1b;
const KEY_NUL = KeyType.KeyNull;
const KEY_US = KeyType.KeyCtrlUnderscore;
const KEY_DEL = KeyType.KeyBackspace;
const SPACE_RUNES = runes(' ');
const FOCUS_MSG: FocusMsg = { type: 'bubbletea/focus' };
const BLUR_MSG: BlurMsg = { type: 'bubbletea/blur' };

const defaultMouseState: MouseMsg = {
  X: 0,
  Y: 0,
  Shift: false,
  Alt: false,
  Ctrl: false,
  Action: MouseAction.MouseActionPress,
  Button: MouseButton.MouseButtonNone,
  Type: MouseEventType.MouseUnknown
};

const createMouseMsg = (overrides: Partial<MouseMsg>): MouseMsg => ({
  ...defaultMouseState,
  ...overrides
});

const bytes = (value: string | readonly number[]): Uint8Array => {
  if (typeof value === 'string') {
    return Buffer.from(value, 'utf8');
  }
  return Uint8Array.from(value);
};

const withAltPrefix = (sequence: Uint8Array): Uint8Array => {
  const prefixed = new Uint8Array(sequence.length + 1);
  prefixed[0] = ESCAPE_BYTE;
  prefixed.set(sequence, 1);
  return prefixed;
};

const formatSequence = (sequence: Uint8Array): string =>
  JSON.stringify(Buffer.from(sequence).toString('latin1'));

const makeKeyMsg = ({
  type,
  runes: runeList,
  alt,
  paste
}: {
  type: KeyType;
  runes?: ReadonlyRunes;
  alt?: boolean;
  paste?: boolean;
}): KeyMsg => {
  const key: Key = { type };
  if (runeList && runeList.length > 0) {
    key.runes = [...runeList];
  }
  if (alt) {
    key.alt = alt;
  }
  if (paste) {
    key.paste = paste;
  }
  return key;
};

const keyFromSequenceEntry = (entry: SequenceEntry, overrides: Partial<Key> = {}): KeyMsg =>
  makeKeyMsg({
    type: overrides.type ?? entry.type,
    runes: overrides.runes,
    alt: overrides.alt ?? entry.alt ?? false,
    paste: overrides.paste
  });

const createKey = (overrides: Partial<Key> = {}): Key => ({
  type: overrides.type ?? KeyType.KeyRunes,
  runes: overrides.runes ?? [],
  alt: overrides.alt ?? false,
  paste: overrides.paste ?? false
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isKeyMsg = (msg: Msg): msg is KeyMsg => isRecord(msg) && typeof (msg as KeyMsg).type === 'number';

const isMouseMsg = (msg: Msg): msg is MouseMsg =>
  isRecord(msg) &&
  typeof (msg as MouseMsg).X === 'number' &&
  typeof (msg as MouseMsg).Y === 'number' &&
  typeof (msg as MouseMsg).Action === 'number' &&
  typeof (msg as MouseMsg).Button === 'number';

const isUnknownInputByteMsgGuard = (msg: Msg): msg is UnknownInputByteMsg =>
  isRecord(msg) &&
  (msg as { type?: unknown }).type === 'bubbletea/unknown-input-byte' &&
  typeof (msg as UnknownInputByteMsg).byte === 'number';

const isUnknownCSISequenceMsgGuard = (msg: Msg): msg is UnknownCSISequenceMsg =>
  isRecord(msg) &&
  (msg as { type?: unknown }).type === 'bubbletea/unknown-csi-sequence' &&
  Array.isArray((msg as UnknownCSISequenceMsg).sequence);

const mouseActionLabels: Record<MouseAction, string> = {
  [MouseAction.MouseActionPress]: 'press',
  [MouseAction.MouseActionRelease]: 'release',
  [MouseAction.MouseActionMotion]: 'motion'
};

const mouseButtonLabels: Record<MouseButton, string> = {
  [MouseButton.MouseButtonNone]: 'none',
  [MouseButton.MouseButtonLeft]: 'left',
  [MouseButton.MouseButtonMiddle]: 'middle',
  [MouseButton.MouseButtonRight]: 'right',
  [MouseButton.MouseButtonWheelUp]: 'wheel up',
  [MouseButton.MouseButtonWheelDown]: 'wheel down',
  [MouseButton.MouseButtonWheelLeft]: 'wheel left',
  [MouseButton.MouseButtonWheelRight]: 'wheel right',
  [MouseButton.MouseButtonBackward]: 'backward',
  [MouseButton.MouseButtonForward]: 'forward',
  [MouseButton.MouseButton10]: 'button 10',
  [MouseButton.MouseButton11]: 'button 11'
};

const isWheelButton = (button: MouseButton): boolean =>
  button === MouseButton.MouseButtonWheelUp ||
  button === MouseButton.MouseButtonWheelDown ||
  button === MouseButton.MouseButtonWheelLeft ||
  button === MouseButton.MouseButtonWheelRight;

const formatMouseMsg = (msg: MouseMsg): string => {
  let result = '';
  if (msg.Ctrl) {
    result += 'ctrl+';
  }
  if (msg.Alt) {
    result += 'alt+';
  }
  if (msg.Shift) {
    result += 'shift+';
  }

  if (msg.Button === MouseButton.MouseButtonNone) {
    if (msg.Action === MouseAction.MouseActionMotion || msg.Action === MouseAction.MouseActionRelease) {
      const actionLabel = mouseActionLabels[msg.Action];
      result += actionLabel ?? 'unknown';
    } else {
      result += 'unknown';
    }
    return result;
  }

  const buttonLabel = mouseButtonLabels[msg.Button] ?? 'unknown';
  if (isWheelButton(msg.Button)) {
    result += buttonLabel;
    return result;
  }

  result += buttonLabel;
  const actionLabel = mouseActionLabels[msg.Action];
  if (actionLabel) {
    result += ` ${actionLabel}`;
  }

  return result;
};

const formatUnknownInputByte = (msg: UnknownInputByteMsg): string =>
  `?0x${msg.byte.toString(16).padStart(2, '0')}?`;

const formatUnknownCSISequence = (msg: UnknownCSISequenceMsg): string => {
  const payload = msg.sequence.slice(2).map((value) => value.toString(10)).join(' ');
  return `?CSI[${payload}]?`;
};

const formatMsgTitle = (msg: Msg): string => {
  if (isKeyMsg(msg)) {
    return keyToString(msg);
  }
  if (isMouseMsg(msg)) {
    return formatMouseMsg(msg);
  }
  if (isUnknownInputByteMsgGuard(msg)) {
    return formatUnknownInputByte(msg);
  }
  if (isUnknownCSISequenceMsgGuard(msg)) {
    return formatUnknownCSISequence(msg);
  }
  return JSON.stringify(msg);
};

const formatMsgList = (msgs: readonly Msg[]): string => msgs.map(formatMsgTitle).join(' ');

const iterableFromChunks = (chunks: readonly Uint8Array[]): Iterable<Uint8Array> => ({
  *[Symbol.iterator]() {
    for (const chunk of chunks) {
      yield chunk;
    }
  }
});

const testReadInputs = async (input: Uint8Array | readonly Uint8Array[]): Promise<Msg[]> => {
  const chunks = Array.isArray(input) ? input : [input];
  const controller = new AbortController();
  const messages: Msg[] = [];
  await readAnsiInputs({
    signal: controller.signal,
    input: iterableFromChunks(chunks),
    emit: (msg) => {
      messages.push(msg);
    }
  });
  return messages;
};

describe('Key.String (key_test.go::TestKeyString)', () => {
  it('alt+space', () => {
    const key = createKey({
      type: KeyType.KeySpace,
      runes: [' '],
      alt: true
    });

    expect(keyToString(key)).toBe('alt+ ');
  });

  it('runes', () => {
    const key = createKey({
      type: KeyType.KeyRunes,
      runes: ['a']
    });

    expect(keyToString(key)).toBe('a');
  });

  it('invalid', () => {
    const key = createKey({
      type: 99999 as KeyType
    });

    expect(keyToString(key)).toBe('');
  });
});

describe('KeyType.String (key_test.go::TestKeyTypeString)', () => {
  it('space', () => {
    expect(keyTypeToString(KeyType.KeySpace)).toBe(' ');
  });

  it('invalid', () => {
    expect(keyTypeToString(99999 as KeyType)).toBe('');
  });
});

const buildBaseSeqTests = (): SeqTest[] => {
  const td: SeqTest[] = [];

  for (const [sequence, entry] of Object.entries(goSequences)) {
    const seqBytes = bytes(sequence);
    const msg = keyFromSequenceEntry(entry);
    td.push({ seq: seqBytes, msg, label: formatSequence(seqBytes) });

    if (entry.alt !== true) {
      const altSeq = withAltPrefix(seqBytes);
      const altMsg = keyFromSequenceEntry(entry, { alt: true });
      td.push({ seq: altSeq, msg: altMsg, label: formatSequence(altSeq) });
    }
  }

  for (let value = KEY_NUL + 1; value <= KEY_DEL; value++) {
    if (value === KeyType.KeyEsc) {
      continue;
    }
    const type = value as KeyType;
    const seq = Uint8Array.of(value);
    td.push({ seq, msg: makeKeyMsg({ type }), label: formatSequence(seq) });

    const altSeq = Uint8Array.of(ESCAPE_BYTE, value);
    td.push({ seq: altSeq, msg: makeKeyMsg({ type, alt: true }), label: formatSequence(altSeq) });

    if (value === KEY_US) {
      value = KEY_DEL - 1;
    }
  }

  const unknownSeq = bytes('\u001b[----X');
  td.push({
    seq: unknownSeq,
    msg: createUnknownCSISequenceMsg(unknownSeq),
    label: formatSequence(unknownSeq)
  });

  const spaceSeq = bytes(' ');
  td.push({
    seq: spaceSeq,
    msg: makeKeyMsg({ type: KeyType.KeySpace, runes: SPACE_RUNES }),
    label: formatSequence(spaceSeq)
  });

  const altSpaceSeq = bytes('\u001b ');
  td.push({
    seq: altSpaceSeq,
    msg: makeKeyMsg({ type: KeyType.KeySpace, runes: SPACE_RUNES, alt: true }),
    label: formatSequence(altSpaceSeq)
  });

  return td;
};

const buildDetectOneMsgTests = (): SeqTest[] => {
  const td = [...buildBaseSeqTests()];

  const push = (seq: Uint8Array, msg: Msg): void => {
    td.push({ seq, msg, label: formatSequence(seq) });
  };

  push(bytes('\u001b[I'), FOCUS_MSG);
  push(bytes('\u001b[O'), BLUR_MSG);

  push(
    Uint8Array.from([ESCAPE_BYTE, 0x5b, 0x4d, 32 + 0b0100_0000, 65, 49]),
    createMouseMsg({
      X: 32,
      Y: 16,
      Type: MouseEventType.MouseWheelUp,
      Button: MouseButton.MouseButtonWheelUp,
      Action: MouseAction.MouseActionPress
    })
  );

  push(
    bytes('\u001b[<0;33;17M'),
    createMouseMsg({
      X: 32,
      Y: 16,
      Type: MouseEventType.MouseLeft,
      Button: MouseButton.MouseButtonLeft,
      Action: MouseAction.MouseActionPress
    })
  );

  push(bytes('a'), makeKeyMsg({ type: KeyType.KeyRunes, runes: runes('a') }));
  push(bytes('\u001ba'), makeKeyMsg({ type: KeyType.KeyRunes, runes: runes('a'), alt: true }));
  push(bytes('aaa'), makeKeyMsg({ type: KeyType.KeyRunes, runes: runes('aaa') }));
  push(bytes('☃'), makeKeyMsg({ type: KeyType.KeyRunes, runes: runes('☃') }));
  push(bytes('\u001b☃'), makeKeyMsg({ type: KeyType.KeyRunes, runes: runes('☃'), alt: true }));

  push(Uint8Array.of(ESCAPE_BYTE), makeKeyMsg({ type: KeyType.KeyEscape }));
  push(Uint8Array.of(KeyType.KeyCtrlA), makeKeyMsg({ type: KeyType.KeyCtrlA }));
  push(Uint8Array.of(ESCAPE_BYTE, KeyType.KeyCtrlA), makeKeyMsg({ type: KeyType.KeyCtrlA, alt: true }));
  push(Uint8Array.of(KEY_NUL), makeKeyMsg({ type: KeyType.KeyCtrlAt }));
  push(Uint8Array.of(ESCAPE_BYTE, KEY_NUL), makeKeyMsg({ type: KeyType.KeyCtrlAt, alt: true }));

  push(Uint8Array.of(0x80), createUnknownInputByteMsg(0x80));
  if (process.platform !== 'win32') {
    push(Uint8Array.of(0xfe), createUnknownInputByteMsg(0xfe));
  }

  return td;
};

const createReadInputTests = (): ReadInputTestCase[] => {
  const tests: ReadInputTestCase[] = [
    {
      name: 'a',
      input: bytes('a'),
      expected: [makeKeyMsg({ type: KeyType.KeyRunes, runes: runes('a') })]
    },
    {
      name: ' ',
      input: bytes(' '),
      expected: [makeKeyMsg({ type: KeyType.KeySpace, runes: SPACE_RUNES })]
    },
    {
      name: 'a alt+a',
      input: bytes('aa'),
      expected: [
        makeKeyMsg({ type: KeyType.KeyRunes, runes: runes('a') }),
        makeKeyMsg({ type: KeyType.KeyRunes, runes: runes('a'), alt: true })
      ]
    },
    {
      name: 'a alt+a a',
      input: bytes('aaa'),
      expected: [
        makeKeyMsg({ type: KeyType.KeyRunes, runes: runes('a') }),
        makeKeyMsg({ type: KeyType.KeyRunes, runes: runes('a'), alt: true }),
        makeKeyMsg({ type: KeyType.KeyRunes, runes: runes('a') })
      ]
    },
    {
      name: 'ctrl+a',
      input: Uint8Array.of(KeyType.KeyCtrlA),
      expected: [makeKeyMsg({ type: KeyType.KeyCtrlA })]
    },
    {
      name: 'ctrl+a ctrl+b',
      input: Uint8Array.of(KeyType.KeyCtrlA, KeyType.KeyCtrlB),
      expected: [makeKeyMsg({ type: KeyType.KeyCtrlA }), makeKeyMsg({ type: KeyType.KeyCtrlB })]
    },
    {
      name: 'alt+a',
      input: Uint8Array.of(ESCAPE_BYTE, 'a'.charCodeAt(0)),
      expected: [makeKeyMsg({ type: KeyType.KeyRunes, runes: runes('a'), alt: true })]
    },
    {
      name: 'abcd',
      input: bytes('abcd'),
      expected: [makeKeyMsg({ type: KeyType.KeyRunes, runes: runes('abcd') })]
    },
    {
      name: 'up',
      input: bytes('\u001b[A'),
      expected: [makeKeyMsg({ type: KeyType.KeyUp })]
    },
    {
      name: 'wheel up',
      input: Uint8Array.of(ESCAPE_BYTE, 0x5b, 0x4d, 32 + 0b0100_0000, 65, 49),
      expected: [
        createMouseMsg({
          X: 32,
          Y: 16,
          Type: MouseEventType.MouseWheelUp,
          Button: MouseButton.MouseButtonWheelUp,
          Action: MouseAction.MouseActionPress
        })
      ]
    },
    {
      name: 'left motion release',
      input: Uint8Array.of(
        ESCAPE_BYTE,
        0x5b,
        0x4d,
        32 + 0b0010_0000,
        32 + 33,
        16 + 33,
        ESCAPE_BYTE,
        0x5b,
        0x4d,
        32 + 0b0000_0011,
        64 + 33,
        32 + 33
      ),
      expected: [
        createMouseMsg({
          X: 32,
          Y: 16,
          Type: MouseEventType.MouseLeft,
          Button: MouseButton.MouseButtonLeft,
          Action: MouseAction.MouseActionMotion
        }),
        createMouseMsg({
          X: 64,
          Y: 32,
          Type: MouseEventType.MouseRelease,
          Button: MouseButton.MouseButtonNone,
          Action: MouseAction.MouseActionRelease
        })
      ]
    },
    {
      name: 'shift+tab',
      input: bytes('\u001b[Z'),
      expected: [makeKeyMsg({ type: KeyType.KeyShiftTab })]
    },
    {
      name: 'enter',
      input: bytes('\r'),
      expected: [makeKeyMsg({ type: KeyType.KeyEnter })]
    },
    {
      name: 'alt+enter',
      input: Uint8Array.of(ESCAPE_BYTE, 0x0d),
      expected: [makeKeyMsg({ type: KeyType.KeyEnter, alt: true })]
    },
    {
      name: 'insert',
      input: bytes('\u001b[2~'),
      expected: [makeKeyMsg({ type: KeyType.KeyInsert })]
    },
    {
      name: 'alt+ctrl+a',
      input: Uint8Array.of(ESCAPE_BYTE, KeyType.KeyCtrlA),
      expected: [makeKeyMsg({ type: KeyType.KeyCtrlA, alt: true })]
    },
    {
      name: '?CSI[45 45 45 45 88]?',
      input: bytes('\u001b[----X'),
      expected: [createUnknownCSISequenceMsg(bytes('\u001b[----X'))]
    },
    {
      name: 'up',
      input: bytes('\u001bOA'),
      expected: [makeKeyMsg({ type: KeyType.KeyUp })]
    },
    {
      name: 'down',
      input: bytes('\u001bOB'),
      expected: [makeKeyMsg({ type: KeyType.KeyDown })]
    },
    {
      name: 'right',
      input: bytes('\u001bOC'),
      expected: [makeKeyMsg({ type: KeyType.KeyRight })]
    },
    {
      name: 'left',
      input: bytes('\u001bOD'),
      expected: [makeKeyMsg({ type: KeyType.KeyLeft })]
    },
    {
      name: 'alt+enter',
      input: Uint8Array.of(ESCAPE_BYTE, 0x0d),
      expected: [makeKeyMsg({ type: KeyType.KeyEnter, alt: true })]
    },
    {
      name: 'alt+backspace',
      input: Uint8Array.of(ESCAPE_BYTE, 0x7f),
      expected: [makeKeyMsg({ type: KeyType.KeyBackspace, alt: true })]
    },
    {
      name: 'ctrl+@',
      input: Uint8Array.of(KeyType.KeyCtrlAt),
      expected: [makeKeyMsg({ type: KeyType.KeyCtrlAt })]
    },
    {
      name: 'alt+ctrl+@',
      input: Uint8Array.of(ESCAPE_BYTE, KeyType.KeyCtrlAt),
      expected: [makeKeyMsg({ type: KeyType.KeyCtrlAt, alt: true })]
    },
    {
      name: 'esc',
      input: Uint8Array.of(ESCAPE_BYTE),
      expected: [makeKeyMsg({ type: KeyType.KeyEsc })]
    },
    {
      name: 'alt+esc',
      input: Uint8Array.of(ESCAPE_BYTE, ESCAPE_BYTE),
      expected: [makeKeyMsg({ type: KeyType.KeyEsc, alt: true })]
    },
    {
      name: '[a b] o',
      input: bytes('\u001b[200~a b\u001b[201~o'),
      expected: [
        makeKeyMsg({ type: KeyType.KeyRunes, runes: runes('a b'), paste: true }),
        makeKeyMsg({ type: KeyType.KeyRunes, runes: runes('o') })
      ]
    },
    {
      name: '[a\x03\nb]',
      input: bytes('\u001b[200~a\u0003\nb\u001b[201~'),
      expected: [makeKeyMsg({ type: KeyType.KeyRunes, runes: runes('a\u0003\nb'), paste: true })]
    }
  ];

  if (process.platform !== 'win32') {
    tests.push(
      {
        name: '?0xfe?',
        input: Uint8Array.of(0xfe),
        expected: [createUnknownInputByteMsg(0xfe)]
      },
      {
        name: 'a ?0xfe?   b',
        input: Uint8Array.of(0x61, 0xfe, 0x20, 0x62),
        expected: [
          makeKeyMsg({ type: KeyType.KeyRunes, runes: runes('a') }),
          createUnknownInputByteMsg(0xfe),
          makeKeyMsg({ type: KeyType.KeySpace, runes: SPACE_RUNES }),
          makeKeyMsg({ type: KeyType.KeyRunes, runes: runes('b') })
        ]
      }
    );
  }

  return tests;
};

type SequencePair = {
  readonly sequence: string;
  readonly bytes: Uint8Array;
  readonly name: string;
};

type RandTest = {
  readonly data: Uint8Array;
  readonly lengths: number[];
  readonly names: string[];
};

const RANDOM_SEED_ENV = 'BUBBLETEA_TS_KEY_TEST_SEED';
const RANDOM_SEQUENCE_LENGTH = 1000;
const RANDOM_SEQUENCE_ITERATIONS = 10;

const allSequencePairs: SequencePair[] = Object.entries(goSequences)
  .map(([sequence, entry]) => {
    const key = keyFromSequenceEntry(entry);
    return {
      sequence,
      bytes: bytes(sequence),
      name: keyToString(key)
    };
  })
  .sort((a, b) => a.sequence.localeCompare(b.sequence));

const normalizeSeed = (value: number): number => (Math.trunc(value) >>> 0);

const resolveRandomSeed = (): number => {
  const override = process.env[RANDOM_SEED_ENV];
  if (override != null && override.trim() !== '') {
    const parsed = Number(override);
    if (Number.isFinite(parsed)) {
      return normalizeSeed(parsed);
    }
  }
  return normalizeSeed(Date.now());
};

const createPrng = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let result = Math.imul(state ^ (state >>> 15), 1 | state);
    result ^= result + Math.imul(result ^ (result >>> 7), 61 | result);
    return ((result ^ (result >>> 14)) >>> 0) / 0x100000000;
  };
};

const randomInt = (rand: () => number, max: number): number => Math.floor(rand() * max);

const genRandomData = (logFn: (seed: number) => void, length: number): RandTest => {
  const seed = resolveRandomSeed();
  logFn(seed);
  return genRandomDataWithSeed(seed, length);
};

const genRandomDataWithSeed = (seed: number, length: number): RandTest => {
  const rand = createPrng(seed);
  const data: number[] = [];
  const lengths: number[] = [];
  const names: string[] = [];

  while (data.length < length) {
    let alt = randomInt(rand, 2);
    let prefix = alt === 1 ? 'alt+' : '';
    let escapeLength = alt === 1 ? 1 : 0;
    const kind = randomInt(rand, 3);
    if (kind === 0) {
      if (alt === 1) {
        data.push(ESCAPE_BYTE);
      }
      data.push(KeyType.KeyCtrlA);
      names.push(`${prefix}ctrl+a`);
      lengths.push(1 + escapeLength);
      continue;
    }

    const entry = allSequencePairs[randomInt(rand, allSequencePairs.length)];
    if (entry.name.startsWith('alt+')) {
      alt = 0;
      prefix = '';
      escapeLength = 0;
    }
    if (alt === 1) {
      data.push(ESCAPE_BYTE);
    }
    for (const value of entry.bytes) {
      data.push(value);
    }
    names.push(`${prefix}${entry.name}`);
    lengths.push(entry.bytes.length + escapeLength);
  }

  return {
    data: Uint8Array.from(data),
    lengths,
    names
  };
};

const logRandomSeed = (seed: number): void => {
  console.info(`[key_test] using random seed: ${seed}`);
};

const runRandomSequenceSuite = (title: string): void => {
  describe(title, () => {
    for (let iteration = 0; iteration < RANDOM_SEQUENCE_ITERATIONS; iteration += 1) {
      it(`iteration ${iteration + 1}`, () => {
        const td = genRandomData(logRandomSeed, RANDOM_SEQUENCE_LENGTH);
        for (let eventIndex = 0, offset = 0; offset < td.data.length; eventIndex += 1) {
          const [hasSequence, width, msg] = detectSequence(td.data.subarray(offset));
          expect(hasSequence).toBe(true);
          expect(width).toBe(td.lengths[eventIndex]);
          expect(width).toBeGreaterThan(0);
          expect(msg).toBeDefined();
          if (!msg || !isKeyMsg(msg)) {
            throw new Error('expected KeyMsg from detectSequence');
          }
          expect(keyToString(msg)).toBe(td.names[eventIndex]);
          offset += width;
        }
      });
    }
  });
};

describe('detectSequence (key_test.go::TestDetectSequence)', () => {
  const td = buildBaseSeqTests();
  for (const testCase of td) {
    it(`parses ${testCase.label}`, () => {
      const [hasSequence, width, msg] = detectSequence(testCase.seq);
      expect(hasSequence).toBe(true);
      expect(width).toBe(testCase.seq.length);
      expect(msg).toEqual(testCase.msg);
    });
  }
});

describe('detectOneMsg (key_test.go::TestDetectOneMsg)', () => {
  const td = buildDetectOneMsgTests();
  for (const testCase of td) {
    it(`parses ${testCase.label}`, () => {
      const [width, msg] = detectOneMsg(testCase.seq, false);
      expect(width).toBe(testCase.seq.length);
      expect(msg).toEqual(testCase.msg);
    });
  }
});

describe('readAnsiInputs (key_test.go::TestReadLongInput)', () => {
  it('aggregates a 1000-rune payload into a single KeyMsg', async () => {
    const payload = 'a'.repeat(1000);
    const msgs = await testReadInputs(bytes(payload));
    expect(msgs).toHaveLength(1);
    const [msg] = msgs;
    expect(isKeyMsg(msg)).toBe(true);
    if (!msg || !isKeyMsg(msg)) {
      return;
    }
    expect(msg.type).toBe(KeyType.KeyRunes);
    expect(msg.runes).toEqual(runes(payload));
    expect(msg.alt ?? false).toBe(false);
  });
});

describe('readAnsiInputs (key_test.go::TestReadInput)', () => {
  const tests = createReadInputTests();
  tests.forEach((testCase, index) => {
    it(`${index}: ${testCase.name}`, async () => {
      const msgs = await testReadInputs(testCase.input);
      expect(formatMsgList(msgs)).toBe(testCase.name);
      expect(msgs).toEqual(testCase.expected);
    });
  });
});

runRandomSequenceSuite('detectSequence random combos (key_test.go::TestDetectRandomSequencesLex)');
runRandomSequenceSuite('detectSequence random combos (key_test.go::TestDetectRandomSequencesMap)');
