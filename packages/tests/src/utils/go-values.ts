const GO_TYPE_SYMBOL = Symbol.for('bubbletea.goType');
const GO_POINTER_SYMBOL = Symbol.for('bubbletea.goPointer');
const GO_POINTER_ADDRESS_SYMBOL = Symbol.for('bubbletea.goPointerAddress');
const GO_CHANNEL_SYMBOL = Symbol.for('bubbletea.goChannel');

export const goStruct = <T extends Record<string, unknown>>(typeName: string, fields: T): T =>
  Object.defineProperty(fields, GO_TYPE_SYMBOL, { value: typeName, enumerable: false });

export const goPointer = <T>(value: T, address?: number) => {
  const pointer = Object.defineProperty({}, GO_POINTER_SYMBOL, { value, enumerable: false });
  if (typeof address === 'number') {
    Object.defineProperty(pointer, GO_POINTER_ADDRESS_SYMBOL, {
      value: address,
      enumerable: false
    });
  }
  return pointer;
};

export const goFunc = <T extends (...args: unknown[]) => unknown>(
  fn: T,
  typeName: string,
  address: number
): T => {
  Object.defineProperty(fn, GO_TYPE_SYMBOL, { value: typeName, enumerable: false });
  return withPointerAddress(fn, address);
};

export const goChannel = (typeName: string, address: number) => {
  const chan = Object.create(null);
  Object.defineProperty(chan, GO_TYPE_SYMBOL, { value: typeName, enumerable: false });
  Object.defineProperty(chan, GO_CHANNEL_SYMBOL, { value: true, enumerable: false });
  Object.defineProperty(chan, GO_POINTER_ADDRESS_SYMBOL, { value: address, enumerable: false });
  return chan;
};

export const withPointerAddress = <T extends object>(value: T, address: number): T => {
  Object.defineProperty(value, GO_POINTER_ADDRESS_SYMBOL, { value: address, enumerable: false });
  return value;
};
