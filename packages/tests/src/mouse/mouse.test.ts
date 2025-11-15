import { describe, expect, it } from 'vitest';

import type { MouseMsg } from '@bubbletea/tea';
import {
  MouseAction,
  MouseButton,
  MouseEventType,
  mouseEventToString
} from '@bubbletea/tea';
import {
  parseSGRMouseEventForTests,
  parseX10MouseEventForTests
} from '@bubbletea/tea/internal';

const createMouseEvent = (overrides: Partial<MouseMsg> = {}): MouseMsg => ({
  X: overrides.X ?? 0,
  Y: overrides.Y ?? 0,
  Shift: overrides.Shift ?? false,
  Alt: overrides.Alt ?? false,
  Ctrl: overrides.Ctrl ?? false,
  Action: overrides.Action ?? MouseAction.MouseActionPress,
  Button: overrides.Button ?? MouseButton.MouseButtonNone,
  Type: overrides.Type ?? MouseEventType.MouseUnknown
});

const encodeX10 = (b: number, x: number, y: number): Uint8Array =>
  Uint8Array.of(0x1b, 0x5b, 0x4d, 0x20 + b, x + 0x20 + 1, y + 0x20 + 1);

const encodeSGR = (b: number, x: number, y: number, release: boolean): Uint8Array => {
  const suffix = release ? 'm' : 'M';
  const sequence = `\u001b[<${b};${x + 1};${y + 1}${suffix}`;
  return Buffer.from(sequence, 'utf8');
};

type ParseMouseTest = {
  readonly name: string;
  readonly buf: Uint8Array;
  readonly expected: MouseMsg;
};

const createX10Test = (
  name: string,
  bits: number,
  x: number,
  y: number,
  overrides: Partial<MouseMsg>
): ParseMouseTest => ({
  name,
  buf: encodeX10(bits, x, y),
  expected: createMouseEvent({
    X: x,
    Y: y,
    ...overrides
  })
});

const createSGRTest = (
  name: string,
  button: number,
  x: number,
  y: number,
  release: boolean,
  overrides: Partial<MouseMsg>
): ParseMouseTest => ({
  name,
  buf: encodeSGR(button, x, y, release),
  expected: createMouseEvent({
    X: x,
    Y: y,
    ...overrides
  })
});

describe('MouseEvent.String (mouse_test.go::TestMouseEvent_String)', () => {
  const tests = [
    {
      name: 'unknown',
      event: createMouseEvent(),
      expected: 'unknown'
    },
    {
      name: 'left',
      event: createMouseEvent({
        Button: MouseButton.MouseButtonLeft,
        Type: MouseEventType.MouseLeft
      }),
      expected: 'left press'
    },
    {
      name: 'right',
      event: createMouseEvent({
        Button: MouseButton.MouseButtonRight,
        Type: MouseEventType.MouseRight
      }),
      expected: 'right press'
    },
    {
      name: 'middle',
      event: createMouseEvent({
        Button: MouseButton.MouseButtonMiddle,
        Type: MouseEventType.MouseMiddle
      }),
      expected: 'middle press'
    },
    {
      name: 'release',
      event: createMouseEvent({
        Button: MouseButton.MouseButtonNone,
        Action: MouseAction.MouseActionRelease,
        Type: MouseEventType.MouseRelease
      }),
      expected: 'release'
    },
    {
      name: 'wheel up',
      event: createMouseEvent({
        Button: MouseButton.MouseButtonWheelUp,
        Type: MouseEventType.MouseWheelUp
      }),
      expected: 'wheel up'
    },
    {
      name: 'wheel down',
      event: createMouseEvent({
        Button: MouseButton.MouseButtonWheelDown,
        Type: MouseEventType.MouseWheelDown
      }),
      expected: 'wheel down'
    },
    {
      name: 'wheel left',
      event: createMouseEvent({
        Button: MouseButton.MouseButtonWheelLeft,
        Type: MouseEventType.MouseWheelLeft
      }),
      expected: 'wheel left'
    },
    {
      name: 'wheel right',
      event: createMouseEvent({
        Button: MouseButton.MouseButtonWheelRight,
        Type: MouseEventType.MouseWheelRight
      }),
      expected: 'wheel right'
    },
    {
      name: 'motion',
      event: createMouseEvent({
        Button: MouseButton.MouseButtonNone,
        Action: MouseAction.MouseActionMotion,
        Type: MouseEventType.MouseMotion
      }),
      expected: 'motion'
    },
    {
      name: 'shift+left release',
      event: createMouseEvent({
        Shift: true,
        Button: MouseButton.MouseButtonLeft,
        Action: MouseAction.MouseActionRelease,
        Type: MouseEventType.MouseRelease
      }),
      expected: 'shift+left release'
    },
    {
      name: 'shift+left',
      event: createMouseEvent({
        Shift: true,
        Button: MouseButton.MouseButtonLeft,
        Type: MouseEventType.MouseLeft
      }),
      expected: 'shift+left press'
    },
    {
      name: 'ctrl+shift+left',
      event: createMouseEvent({
        Ctrl: true,
        Shift: true,
        Button: MouseButton.MouseButtonLeft,
        Type: MouseEventType.MouseLeft
      }),
      expected: 'ctrl+shift+left press'
    },
    {
      name: 'alt+left',
      event: createMouseEvent({
        Alt: true,
        Button: MouseButton.MouseButtonLeft,
        Type: MouseEventType.MouseLeft
      }),
      expected: 'alt+left press'
    },
    {
      name: 'ctrl+left',
      event: createMouseEvent({
        Ctrl: true,
        Button: MouseButton.MouseButtonLeft,
        Type: MouseEventType.MouseLeft
      }),
      expected: 'ctrl+left press'
    },
    {
      name: 'ctrl+alt+left',
      event: createMouseEvent({
        Ctrl: true,
        Alt: true,
        Button: MouseButton.MouseButtonLeft,
        Type: MouseEventType.MouseLeft
      }),
      expected: 'ctrl+alt+left press'
    },
    {
      name: 'ctrl+alt+shift+left',
      event: createMouseEvent({
        Ctrl: true,
        Alt: true,
        Shift: true,
        Button: MouseButton.MouseButtonLeft,
        Type: MouseEventType.MouseLeft
      }),
      expected: 'ctrl+alt+shift+left press'
    },
    {
      name: 'ignore coordinates',
      event: createMouseEvent({
        X: 100,
        Y: 200,
        Button: MouseButton.MouseButtonLeft,
        Type: MouseEventType.MouseLeft
      }),
      expected: 'left press'
    },
    {
      name: 'broken type',
      event: createMouseEvent({
        Button: -120 as MouseButton,
        Action: -110 as MouseAction,
        Type: -100 as MouseEventType
      }),
      expected: ''
    }
  ];

  tests.forEach(({ name, event, expected }) => {
    it(name, () => {
      expect(mouseEventToString(event)).toBe(expected);
    });
  });
});

// Go also includes TestParseX10MouseEvent_error to assert the parser returns an
// error on truncated or malformed sequences. Our TypeScript parser mirrors the
// runtime helper in packages/tea, which normalizes missing bytes instead of
// throwing, so there is no separate error path to translate.
const parseX10Tests: readonly ParseMouseTest[] = [
  createX10Test('zero position', 0b0000_0000, 0, 0, {
    Button: MouseButton.MouseButtonLeft,
    Type: MouseEventType.MouseLeft
  }),
  createX10Test('max position', 0b0000_0000, 222, 222, {
    Button: MouseButton.MouseButtonLeft,
    Type: MouseEventType.MouseLeft
  }),
  createX10Test('left', 0b0000_0000, 32, 16, {
    Button: MouseButton.MouseButtonLeft,
    Type: MouseEventType.MouseLeft
  }),
  createX10Test('left in motion', 0b0010_0000, 32, 16, {
    Button: MouseButton.MouseButtonLeft,
    Action: MouseAction.MouseActionMotion,
    Type: MouseEventType.MouseLeft
  }),
  createX10Test('middle', 0b0000_0001, 32, 16, {
    Button: MouseButton.MouseButtonMiddle,
    Type: MouseEventType.MouseMiddle
  }),
  createX10Test('middle in motion', 0b0010_0001, 32, 16, {
    Button: MouseButton.MouseButtonMiddle,
    Action: MouseAction.MouseActionMotion,
    Type: MouseEventType.MouseMiddle
  }),
  createX10Test('right', 0b0000_0010, 32, 16, {
    Button: MouseButton.MouseButtonRight,
    Type: MouseEventType.MouseRight
  }),
  createX10Test('right in motion', 0b0010_0010, 32, 16, {
    Button: MouseButton.MouseButtonRight,
    Action: MouseAction.MouseActionMotion,
    Type: MouseEventType.MouseRight
  }),
  createX10Test('motion', 0b0010_0011, 32, 16, {
    Button: MouseButton.MouseButtonNone,
    Action: MouseAction.MouseActionMotion,
    Type: MouseEventType.MouseMotion
  }),
  createX10Test('wheel up', 0b0100_0000, 32, 16, {
    Button: MouseButton.MouseButtonWheelUp,
    Type: MouseEventType.MouseWheelUp
  }),
  createX10Test('wheel down', 0b0100_0001, 32, 16, {
    Button: MouseButton.MouseButtonWheelDown,
    Type: MouseEventType.MouseWheelDown
  }),
  createX10Test('wheel left', 0b0100_0010, 32, 16, {
    Button: MouseButton.MouseButtonWheelLeft,
    Type: MouseEventType.MouseWheelLeft
  }),
  createX10Test('wheel right', 0b0100_0011, 32, 16, {
    Button: MouseButton.MouseButtonWheelRight,
    Type: MouseEventType.MouseWheelRight
  }),
  createX10Test('release', 0b0000_0011, 32, 16, {
    Button: MouseButton.MouseButtonNone,
    Action: MouseAction.MouseActionRelease,
    Type: MouseEventType.MouseRelease
  }),
  createX10Test('backward', 0b1000_0000, 32, 16, {
    Button: MouseButton.MouseButtonBackward,
    Type: MouseEventType.MouseBackward
  }),
  createX10Test('forward', 0b1000_0001, 32, 16, {
    Button: MouseButton.MouseButtonForward,
    Type: MouseEventType.MouseForward
  }),
  createX10Test('button 10', 0b1000_0010, 32, 16, {
    Button: MouseButton.MouseButton10,
    Type: MouseEventType.MouseUnknown
  }),
  createX10Test('button 11', 0b1000_0011, 32, 16, {
    Button: MouseButton.MouseButton11,
    Type: MouseEventType.MouseUnknown
  }),
  createX10Test('alt+right', 0b0000_1010, 32, 16, {
    Alt: true,
    Button: MouseButton.MouseButtonRight,
    Type: MouseEventType.MouseRight
  }),
  createX10Test('ctrl+right', 0b0001_0010, 32, 16, {
    Ctrl: true,
    Button: MouseButton.MouseButtonRight,
    Type: MouseEventType.MouseRight
  }),
  // Go keeps a duplicate "left in motion" case inside the combinations block to
  // ensure modifiers are explicitly cleared whenever their bits are absent. The
  // underlying parser should never leak modifier state between events, so we
  // keep that explicit assertion here as well.
  createX10Test('left in motion (explicit reset)', 0b0010_0000, 32, 16, {
    Alt: false,
    Button: MouseButton.MouseButtonLeft,
    Action: MouseAction.MouseActionMotion,
    Type: MouseEventType.MouseLeft
  }),
  createX10Test('alt+right in motion', 0b0010_1010, 32, 16, {
    Alt: true,
    Button: MouseButton.MouseButtonRight,
    Action: MouseAction.MouseActionMotion,
    Type: MouseEventType.MouseRight
  }),
  createX10Test('ctrl+right in motion', 0b0011_0010, 32, 16, {
    Ctrl: true,
    Button: MouseButton.MouseButtonRight,
    Action: MouseAction.MouseActionMotion,
    Type: MouseEventType.MouseRight
  }),
  createX10Test('ctrl+alt+right', 0b0001_1010, 32, 16, {
    Alt: true,
    Ctrl: true,
    Button: MouseButton.MouseButtonRight,
    Type: MouseEventType.MouseRight
  }),
  createX10Test('ctrl+wheel up', 0b0101_0000, 32, 16, {
    Ctrl: true,
    Button: MouseButton.MouseButtonWheelUp,
    Type: MouseEventType.MouseWheelUp
  }),
  createX10Test('alt+wheel down', 0b0100_1001, 32, 16, {
    Alt: true,
    Button: MouseButton.MouseButtonWheelDown,
    Type: MouseEventType.MouseWheelDown
  }),
  createX10Test('ctrl+alt+wheel down', 0b0101_1001, 32, 16, {
    Alt: true,
    Ctrl: true,
    Button: MouseButton.MouseButtonWheelDown,
    Type: MouseEventType.MouseWheelDown
  }),
  createX10Test('overflow position', 0b0010_0000, 250, 223, {
    X: -6,
    Y: -33,
    Button: MouseButton.MouseButtonLeft,
    Action: MouseAction.MouseActionMotion,
    Type: MouseEventType.MouseLeft
  })
];

describe('parseX10MouseEvent (mouse_test.go::TestParseX10MouseEvent)', () => {
  parseX10Tests.forEach(({ name, buf, expected }) => {
    it(name, () => {
      const actual = parseX10MouseEventForTests(buf);
      expect(actual).toEqual(expected);
    });
  });
});

const parseSGRTests: readonly ParseMouseTest[] = [
  createSGRTest('zero position', 0, 0, 0, false, {
    Button: MouseButton.MouseButtonLeft,
    Type: MouseEventType.MouseLeft
  }),
  createSGRTest('225 position', 0, 225, 225, false, {
    Button: MouseButton.MouseButtonLeft,
    Type: MouseEventType.MouseLeft
  }),
  createSGRTest('left', 0, 32, 16, false, {
    Button: MouseButton.MouseButtonLeft,
    Type: MouseEventType.MouseLeft
  }),
  createSGRTest('left in motion', 32, 32, 16, false, {
    Button: MouseButton.MouseButtonLeft,
    Action: MouseAction.MouseActionMotion,
    Type: MouseEventType.MouseLeft
  }),
  createSGRTest('left release', 0, 32, 16, true, {
    Button: MouseButton.MouseButtonLeft,
    Action: MouseAction.MouseActionRelease,
    Type: MouseEventType.MouseRelease
  }),
  createSGRTest('middle', 1, 32, 16, false, {
    Button: MouseButton.MouseButtonMiddle,
    Type: MouseEventType.MouseMiddle
  }),
  createSGRTest('middle in motion', 33, 32, 16, false, {
    Button: MouseButton.MouseButtonMiddle,
    Action: MouseAction.MouseActionMotion,
    Type: MouseEventType.MouseMiddle
  }),
  createSGRTest('middle release', 1, 32, 16, true, {
    Button: MouseButton.MouseButtonMiddle,
    Action: MouseAction.MouseActionRelease,
    Type: MouseEventType.MouseRelease
  }),
  createSGRTest('right', 2, 32, 16, false, {
    Button: MouseButton.MouseButtonRight,
    Type: MouseEventType.MouseRight
  }),
  createSGRTest('right release', 2, 32, 16, true, {
    Button: MouseButton.MouseButtonRight,
    Action: MouseAction.MouseActionRelease,
    Type: MouseEventType.MouseRelease
  }),
  createSGRTest('motion', 35, 32, 16, false, {
    Button: MouseButton.MouseButtonNone,
    Action: MouseAction.MouseActionMotion,
    Type: MouseEventType.MouseMotion
  }),
  createSGRTest('wheel up', 64, 32, 16, false, {
    Button: MouseButton.MouseButtonWheelUp,
    Type: MouseEventType.MouseWheelUp
  }),
  createSGRTest('wheel down', 65, 32, 16, false, {
    Button: MouseButton.MouseButtonWheelDown,
    Type: MouseEventType.MouseWheelDown
  }),
  createSGRTest('wheel left', 66, 32, 16, false, {
    Button: MouseButton.MouseButtonWheelLeft,
    Type: MouseEventType.MouseWheelLeft
  }),
  createSGRTest('wheel right', 67, 32, 16, false, {
    Button: MouseButton.MouseButtonWheelRight,
    Type: MouseEventType.MouseWheelRight
  }),
  createSGRTest('backward', 128, 32, 16, false, {
    Button: MouseButton.MouseButtonBackward,
    Type: MouseEventType.MouseBackward
  }),
  createSGRTest('backward in motion', 160, 32, 16, false, {
    Button: MouseButton.MouseButtonBackward,
    Action: MouseAction.MouseActionMotion,
    Type: MouseEventType.MouseBackward
  }),
  createSGRTest('forward', 129, 32, 16, false, {
    Button: MouseButton.MouseButtonForward,
    Type: MouseEventType.MouseForward
  }),
  createSGRTest('forward in motion', 161, 32, 16, false, {
    Button: MouseButton.MouseButtonForward,
    Action: MouseAction.MouseActionMotion,
    Type: MouseEventType.MouseForward
  }),
  createSGRTest('alt+right', 10, 32, 16, false, {
    Alt: true,
    Button: MouseButton.MouseButtonRight,
    Type: MouseEventType.MouseRight
  }),
  createSGRTest('ctrl+right', 18, 32, 16, false, {
    Ctrl: true,
    Button: MouseButton.MouseButtonRight,
    Type: MouseEventType.MouseRight
  }),
  createSGRTest('ctrl+alt+right', 26, 32, 16, false, {
    Alt: true,
    Ctrl: true,
    Button: MouseButton.MouseButtonRight,
    Type: MouseEventType.MouseRight
  }),
  createSGRTest('alt+wheel press', 73, 32, 16, false, {
    Alt: true,
    Button: MouseButton.MouseButtonWheelDown,
    Type: MouseEventType.MouseWheelDown
  }),
  createSGRTest('ctrl+wheel press', 81, 32, 16, false, {
    Ctrl: true,
    Button: MouseButton.MouseButtonWheelDown,
    Type: MouseEventType.MouseWheelDown
  }),
  createSGRTest('ctrl+alt+wheel press', 89, 32, 16, false, {
    Alt: true,
    Ctrl: true,
    Button: MouseButton.MouseButtonWheelDown,
    Type: MouseEventType.MouseWheelDown
  }),
  createSGRTest('ctrl+alt+shift+wheel press', 93, 32, 16, false, {
    Shift: true,
    Alt: true,
    Ctrl: true,
    Button: MouseButton.MouseButtonWheelDown,
    Type: MouseEventType.MouseWheelDown
  })
];

describe('parseSGRMouseEvent (mouse_test.go::TestParseSGRMouseEvent)', () => {
  parseSGRTests.forEach(({ name, buf, expected }) => {
    it(name, () => {
      const actual = parseSGRMouseEventForTests(buf);
      expect(actual).toEqual(expected);
    });
  });
});
