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
