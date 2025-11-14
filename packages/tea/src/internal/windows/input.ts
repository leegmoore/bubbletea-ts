import type { KeyMsg } from '../../key';
import { KeyType } from '../../key';
import type { MouseMsg } from '../../mouse';
import { MouseAction, MouseButton, MouseEventType } from '../../mouse';
import type { WindowsKeyInputRecord, WindowsMouseInputRecord } from './binding';

export const WINDOWS_LEFT_ALT_PRESSED = 0x0002;
export const WINDOWS_RIGHT_ALT_PRESSED = 0x0001;
export const WINDOWS_LEFT_CTRL_PRESSED = 0x0008;
export const WINDOWS_RIGHT_CTRL_PRESSED = 0x0004;
export const WINDOWS_SHIFT_PRESSED = 0x0010;

export const WINDOWS_FROM_LEFT_1ST_BUTTON = 0x0001;
export const WINDOWS_RIGHTMOST_BUTTON = 0x0002;
export const WINDOWS_FROM_LEFT_2ND_BUTTON = 0x0004;
export const WINDOWS_FROM_LEFT_3RD_BUTTON = 0x0008;
export const WINDOWS_FROM_LEFT_4TH_BUTTON = 0x0010;

export const WINDOWS_MOUSE_EVENT_CLICK = 0x0000;
export const WINDOWS_MOUSE_EVENT_DOUBLE_CLICK = 0x0002;
export const WINDOWS_MOUSE_EVENT_MOVED = 0x0001;
export const WINDOWS_MOUSE_EVENT_WHEELED = 0x0004;
export const WINDOWS_MOUSE_EVENT_HWHEELED = 0x0008;

const WINDOWS_VK_RETURN = 0x0d;
const WINDOWS_VK_BACK = 0x08;
const WINDOWS_VK_TAB = 0x09;
const WINDOWS_VK_SPACE = 0x20;
const WINDOWS_VK_ESCAPE = 0x1b;
const WINDOWS_VK_UP = 0x26;
const WINDOWS_VK_DOWN = 0x28;
const WINDOWS_VK_RIGHT = 0x27;
const WINDOWS_VK_LEFT = 0x25;
const WINDOWS_VK_HOME = 0x24;
const WINDOWS_VK_END = 0x23;
const WINDOWS_VK_PRIOR = 0x21;
const WINDOWS_VK_NEXT = 0x22;
const WINDOWS_VK_DELETE = 0x2e;
const WINDOWS_VK_SHIFT = 0x10;
const WINDOWS_VK_OEM_4 = 0xdb;
const WINDOWS_VK_OEM_6 = 0xdd;

const WINDOWS_VK_F1 = 0x70;
const WINDOWS_VK_F20 = 0x83;

const hasFlag = (state: number, flag: number): boolean => (state & flag) !== 0;

const runeFromCharCode = (codePoint: number): string | undefined => {
  if (!Number.isFinite(codePoint) || codePoint <= 0) {
    return undefined;
  }
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return undefined;
  }
};

const determineWindowsKeyType = (
  record: WindowsKeyInputRecord,
  shiftPressed: boolean,
  ctrlPressed: boolean
): KeyType | null => {
  const vk = record.virtualKeyCode;
  switch (vk) {
    case WINDOWS_VK_RETURN:
      return KeyType.KeyEnter;
    case WINDOWS_VK_BACK:
      return KeyType.KeyBackspace;
    case WINDOWS_VK_TAB:
      return shiftPressed ? KeyType.KeyShiftTab : KeyType.KeyTab;
    case WINDOWS_VK_SPACE:
      return KeyType.KeyRunes;
    case WINDOWS_VK_ESCAPE:
      return KeyType.KeyEscape;
    case WINDOWS_VK_UP:
      if (shiftPressed && ctrlPressed) {
        return KeyType.KeyCtrlShiftUp;
      }
      if (shiftPressed) {
        return KeyType.KeyShiftUp;
      }
      if (ctrlPressed) {
        return KeyType.KeyCtrlUp;
      }
      return KeyType.KeyUp;
    case WINDOWS_VK_DOWN:
      if (shiftPressed && ctrlPressed) {
        return KeyType.KeyCtrlShiftDown;
      }
      if (shiftPressed) {
        return KeyType.KeyShiftDown;
      }
      if (ctrlPressed) {
        return KeyType.KeyCtrlDown;
      }
      return KeyType.KeyDown;
    case WINDOWS_VK_RIGHT:
      if (shiftPressed && ctrlPressed) {
        return KeyType.KeyCtrlShiftRight;
      }
      if (shiftPressed) {
        return KeyType.KeyShiftRight;
      }
      if (ctrlPressed) {
        return KeyType.KeyCtrlRight;
      }
      return KeyType.KeyRight;
    case WINDOWS_VK_LEFT:
      if (shiftPressed && ctrlPressed) {
        return KeyType.KeyCtrlShiftLeft;
      }
      if (shiftPressed) {
        return KeyType.KeyShiftLeft;
      }
      if (ctrlPressed) {
        return KeyType.KeyCtrlLeft;
      }
      return KeyType.KeyLeft;
    case WINDOWS_VK_HOME:
      if (shiftPressed && ctrlPressed) {
        return KeyType.KeyCtrlShiftHome;
      }
      if (shiftPressed) {
        return KeyType.KeyShiftHome;
      }
      if (ctrlPressed) {
        return KeyType.KeyCtrlHome;
      }
      return KeyType.KeyHome;
    case WINDOWS_VK_END:
      if (shiftPressed && ctrlPressed) {
        return KeyType.KeyCtrlShiftEnd;
      }
      if (shiftPressed) {
        return KeyType.KeyShiftEnd;
      }
      if (ctrlPressed) {
        return KeyType.KeyCtrlEnd;
      }
      return KeyType.KeyEnd;
    case WINDOWS_VK_PRIOR:
      return KeyType.KeyPgUp;
    case WINDOWS_VK_NEXT:
      return KeyType.KeyPgDown;
    case WINDOWS_VK_DELETE:
      return KeyType.KeyDelete;
    default:
      if (vk >= WINDOWS_VK_F1 && vk <= WINDOWS_VK_F20) {
        const offset = vk - WINDOWS_VK_F1;
        return (KeyType.KeyF1 - offset) as KeyType;
      }
      break;
  }
  return null;
};

const ctrlKeyFromCharCode = (charCode: number): KeyType | null => {
  switch (charCode) {
    case 0x40:
      return KeyType.KeyCtrlAt;
    case 0x01:
      return KeyType.KeyCtrlA;
    case 0x02:
      return KeyType.KeyCtrlB;
    case 0x03:
      return KeyType.KeyCtrlC;
    case 0x04:
      return KeyType.KeyCtrlD;
    case 0x05:
      return KeyType.KeyCtrlE;
    case 0x06:
      return KeyType.KeyCtrlF;
    case 0x07:
      return KeyType.KeyCtrlG;
    case 0x08:
      return KeyType.KeyCtrlH;
    case 0x09:
      return KeyType.KeyCtrlI;
    case 0x0a:
      return KeyType.KeyCtrlJ;
    case 0x0b:
      return KeyType.KeyCtrlK;
    case 0x0c:
      return KeyType.KeyCtrlL;
    case 0x0d:
      return KeyType.KeyCtrlM;
    case 0x0e:
      return KeyType.KeyCtrlN;
    case 0x0f:
      return KeyType.KeyCtrlO;
    case 0x10:
      return KeyType.KeyCtrlP;
    case 0x11:
      return KeyType.KeyCtrlQ;
    case 0x12:
      return KeyType.KeyCtrlR;
    case 0x13:
      return KeyType.KeyCtrlS;
    case 0x14:
      return KeyType.KeyCtrlT;
    case 0x15:
      return KeyType.KeyCtrlU;
    case 0x16:
      return KeyType.KeyCtrlV;
    case 0x17:
      return KeyType.KeyCtrlW;
    case 0x18:
      return KeyType.KeyCtrlX;
    case 0x19:
      return KeyType.KeyCtrlY;
    case 0x1a:
      return KeyType.KeyCtrlZ;
    case 0x1b:
      return KeyType.KeyCtrlOpenBracket;
    case 0x1c:
      return KeyType.KeyCtrlBackslash;
    case 0x1f:
      return KeyType.KeyCtrlUnderscore;
    default:
      break;
  }
  return null;
};

const keyTypeFromVirtualKeyFallback = (code: number): KeyType | null => {
  switch (code) {
    case WINDOWS_VK_OEM_4:
      return KeyType.KeyCtrlOpenBracket;
    case WINDOWS_VK_OEM_6:
      return KeyType.KeyCtrlCloseBracket;
    default:
      return null;
  }
};

const normalizeRepeatCount = (value: number | undefined): number => {
  if (!Number.isFinite(value) || value == null) {
    return 1;
  }
  const normalized = Math.max(1, Math.trunc(value));
  return normalized;
};

const createKeyMsg = (record: WindowsKeyInputRecord): KeyMsg | null => {
  const altPressed =
    hasFlag(record.controlKeyState, WINDOWS_LEFT_ALT_PRESSED) ||
    hasFlag(record.controlKeyState, WINDOWS_RIGHT_ALT_PRESSED);
  const shiftPressed = hasFlag(record.controlKeyState, WINDOWS_SHIFT_PRESSED);
  const leftCtrl = hasFlag(record.controlKeyState, WINDOWS_LEFT_CTRL_PRESSED);
  const rightCtrl = hasFlag(record.controlKeyState, WINDOWS_RIGHT_CTRL_PRESSED);
  const ctrlPressed = leftCtrl || rightCtrl;

  let keyType = determineWindowsKeyType(record, shiftPressed, ctrlPressed);
  if (keyType === null) {
    const rightAltPressed = hasFlag(record.controlKeyState, WINDOWS_RIGHT_ALT_PRESSED);
    if ((leftCtrl && rightAltPressed) || (!leftCtrl && !rightCtrl)) {
      keyType = KeyType.KeyRunes;
    } else {
      keyType = ctrlKeyFromCharCode(record.charCode) ?? keyTypeFromVirtualKeyFallback(record.virtualKeyCode);
    }
    if (keyType === null) {
      keyType = KeyType.KeyRunes;
    }
  }

  const key: KeyMsg = { type: keyType };
  if (altPressed) {
    key.alt = true;
  }
  if (keyType === KeyType.KeyRunes) {
    const rune = runeFromCharCode(record.charCode);
    if (rune) {
      key.runes = [rune];
    }
  }
  return key;
};

export const translateWindowsKeyRecord = (record: WindowsKeyInputRecord): KeyMsg[] => {
  if (!record.keyDown || record.virtualKeyCode === WINDOWS_VK_SHIFT) {
    return [];
  }
  const keyMsg = createKeyMsg(record);
  if (!keyMsg) {
    return [];
  }
  const repeatCount = normalizeRepeatCount(record.repeatCount);
  const results: KeyMsg[] = [];
  for (let i = 0; i < repeatCount; i += 1) {
    results.push({ ...keyMsg, runes: keyMsg.runes ? [...keyMsg.runes] : undefined });
  }
  return results;
};

const mouseEventButton = (
  previousState: number,
  currentState: number
): { button: MouseButton; action: MouseAction } => {
  const delta = previousState ^ currentState;
  const action =
    delta !== 0 && (delta & currentState) === 0 ? MouseAction.MouseActionRelease : MouseAction.MouseActionPress;
  let button = MouseButton.MouseButtonNone;

  if (delta === 0) {
    if (currentState & WINDOWS_FROM_LEFT_1ST_BUTTON) {
      button = MouseButton.MouseButtonLeft;
    } else if (currentState & WINDOWS_FROM_LEFT_2ND_BUTTON) {
      button = MouseButton.MouseButtonMiddle;
    } else if (currentState & WINDOWS_RIGHTMOST_BUTTON) {
      button = MouseButton.MouseButtonRight;
    } else if (currentState & WINDOWS_FROM_LEFT_3RD_BUTTON) {
      button = MouseButton.MouseButtonBackward;
    } else if (currentState & WINDOWS_FROM_LEFT_4TH_BUTTON) {
      button = MouseButton.MouseButtonForward;
    }
    return { button, action };
  }

  switch (delta) {
    case WINDOWS_FROM_LEFT_1ST_BUTTON:
      button = MouseButton.MouseButtonLeft;
      break;
    case WINDOWS_RIGHTMOST_BUTTON:
      button = MouseButton.MouseButtonRight;
      break;
    case WINDOWS_FROM_LEFT_2ND_BUTTON:
      button = MouseButton.MouseButtonMiddle;
      break;
    case WINDOWS_FROM_LEFT_3RD_BUTTON:
      button = MouseButton.MouseButtonBackward;
      break;
    case WINDOWS_FROM_LEFT_4TH_BUTTON:
      button = MouseButton.MouseButtonForward;
      break;
    default:
      button = MouseButton.MouseButtonNone;
      break;
  }

  return { button, action };
};

const signedHighWord = (value: number): number => {
  const high = (value >>> 16) & 0xffff;
  return high >= 0x8000 ? high - 0x10000 : high;
};

const wheelDirectionFromButtonState = (buttonState: number): number => {
  const delta = signedHighWord(buttonState);
  if (delta === 0) {
    return 0;
  }
  if (delta > 0) {
    return 1;
  }
  return -1;
};

const createBaseMouseMsg = (record: WindowsMouseInputRecord): MouseMsg => ({
  X: record.position.x,
  Y: record.position.y,
  Alt:
    hasFlag(record.controlKeyState, WINDOWS_LEFT_ALT_PRESSED) ||
    hasFlag(record.controlKeyState, WINDOWS_RIGHT_ALT_PRESSED),
  Ctrl:
    hasFlag(record.controlKeyState, WINDOWS_LEFT_CTRL_PRESSED) ||
    hasFlag(record.controlKeyState, WINDOWS_RIGHT_CTRL_PRESSED),
  Shift: hasFlag(record.controlKeyState, WINDOWS_SHIFT_PRESSED),
  Action: MouseAction.MouseActionPress,
  Button: MouseButton.MouseButtonNone,
  Type: MouseEventType.MouseUnknown
});

const assignButtonType = (msg: MouseMsg): void => {
  switch (msg.Button) {
    case MouseButton.MouseButtonLeft:
      msg.Type = MouseEventType.MouseLeft;
      break;
    case MouseButton.MouseButtonMiddle:
      msg.Type = MouseEventType.MouseMiddle;
      break;
    case MouseButton.MouseButtonRight:
      msg.Type = MouseEventType.MouseRight;
      break;
    case MouseButton.MouseButtonBackward:
      msg.Type = MouseEventType.MouseBackward;
      break;
    case MouseButton.MouseButtonForward:
      msg.Type = MouseEventType.MouseForward;
      break;
    default:
      msg.Type = MouseEventType.MouseUnknown;
      break;
  }
};

export const translateWindowsMouseRecord = (
  record: WindowsMouseInputRecord,
  previousButtonState: number
): { msg: MouseMsg | null; nextButtonState: number } => {
  const nextState = record.buttonState & 0xffff;
  const msg = createBaseMouseMsg(record);

  switch (record.eventFlags) {
    case WINDOWS_MOUSE_EVENT_CLICK:
    case WINDOWS_MOUSE_EVENT_DOUBLE_CLICK: {
      const { button, action } = mouseEventButton(previousButtonState, nextState);
      msg.Button = button;
      msg.Action = action;
      if (msg.Button === MouseButton.MouseButtonNone) {
        return { msg: null, nextButtonState: nextState };
      }
      if (action === MouseAction.MouseActionRelease) {
        msg.Type = MouseEventType.MouseRelease;
      } else {
        assignButtonType(msg);
      }
      return { msg, nextButtonState: nextState };
    }
    case WINDOWS_MOUSE_EVENT_WHEELED: {
      const direction = wheelDirectionFromButtonState(record.buttonState);
      if (direction === 0) {
        return { msg: null, nextButtonState: nextState };
      }
      msg.Button =
        direction > 0 ? MouseButton.MouseButtonWheelUp : MouseButton.MouseButtonWheelDown;
      msg.Type = direction > 0 ? MouseEventType.MouseWheelUp : MouseEventType.MouseWheelDown;
      return { msg, nextButtonState: nextState };
    }
    case WINDOWS_MOUSE_EVENT_HWHEELED: {
      const direction = wheelDirectionFromButtonState(record.buttonState);
      if (direction === 0) {
        return { msg: null, nextButtonState: nextState };
      }
      msg.Button =
        direction > 0 ? MouseButton.MouseButtonWheelRight : MouseButton.MouseButtonWheelLeft;
      msg.Type = direction > 0 ? MouseEventType.MouseWheelRight : MouseEventType.MouseWheelLeft;
      return { msg, nextButtonState: nextState };
    }
    case WINDOWS_MOUSE_EVENT_MOVED: {
      const { button } = mouseEventButton(previousButtonState, nextState);
      msg.Button = button;
      msg.Action = MouseAction.MouseActionMotion;
      msg.Type = MouseEventType.MouseMotion;
      return { msg, nextButtonState: nextState };
    }
    default:
      return { msg: null, nextButtonState: nextState };
  }
};
