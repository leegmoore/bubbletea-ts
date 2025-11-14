export enum MouseAction {
  MouseActionPress = 0,
  MouseActionRelease = 1,
  MouseActionMotion = 2
}

export enum MouseButton {
  MouseButtonNone = 0,
  MouseButtonLeft,
  MouseButtonMiddle,
  MouseButtonRight,
  MouseButtonWheelUp,
  MouseButtonWheelDown,
  MouseButtonWheelLeft,
  MouseButtonWheelRight,
  MouseButtonBackward,
  MouseButtonForward,
  MouseButton10,
  MouseButton11
}

export enum MouseEventType {
  MouseUnknown = 0,
  MouseLeft,
  MouseRight,
  MouseMiddle,
  MouseRelease,
  MouseWheelUp,
  MouseWheelDown,
  MouseWheelLeft,
  MouseWheelRight,
  MouseBackward,
  MouseForward,
  MouseMotion
}

export interface MouseEvent {
  readonly X: number;
  readonly Y: number;
  readonly Shift: boolean;
  readonly Alt: boolean;
  readonly Ctrl: boolean;
  readonly Action: MouseAction;
  readonly Button: MouseButton;
  readonly Type: MouseEventType;
}

export type MouseMsg = MouseEvent;
const MOUSE_ACTION_LABELS: Partial<Record<MouseAction, string>> = {
  [MouseAction.MouseActionPress]: 'press',
  [MouseAction.MouseActionRelease]: 'release',
  [MouseAction.MouseActionMotion]: 'motion'
};

const MOUSE_BUTTON_LABELS: Partial<Record<MouseButton, string>> = {
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

export const mouseEventToString = (event: MouseEvent): string => {
  let result = '';
  if (event.Ctrl) {
    result += 'ctrl+';
  }
  if (event.Alt) {
    result += 'alt+';
  }
  if (event.Shift) {
    result += 'shift+';
  }

  if (event.Button === MouseButton.MouseButtonNone) {
    if (
      event.Action === MouseAction.MouseActionMotion ||
      event.Action === MouseAction.MouseActionRelease
    ) {
      const label = MOUSE_ACTION_LABELS[event.Action] ?? 'unknown';
      result += label;
      return result;
    }
    result += 'unknown';
    return result;
  }

  if (isWheelButton(event.Button)) {
    const label = MOUSE_BUTTON_LABELS[event.Button] ?? 'unknown';
    result += label;
    return result;
  }

  const buttonLabel = MOUSE_BUTTON_LABELS[event.Button];
  if (buttonLabel) {
    result += buttonLabel;
  }

  const actionLabel = MOUSE_ACTION_LABELS[event.Action];
  if (actionLabel) {
    result += buttonLabel ? ` ${actionLabel}` : actionLabel;
  }

  return result;
};
