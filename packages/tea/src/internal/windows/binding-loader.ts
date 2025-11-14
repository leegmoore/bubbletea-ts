import { createRequire } from 'node:module';
import path from 'node:path';

import type { WindowsConsoleBinding } from './binding';

const WINDOWS_BINDING_PATH_ENV = 'BUBBLETEA_WINDOWS_BINDING_PATH';
const WINDOWS_BINDING_MODE_ENV = 'BUBBLETEA_WINDOWS_BINDING_MODE';
const WINDOWS_BINDING_ALLOW_FFI_ENV = 'BUBBLETEA_WINDOWS_BINDING_ALLOW_FFI';

type BindingAttemptKind = 'path' | 'addon' | 'ffi';

interface BindingAttemptFailure {
  readonly kind: BindingAttemptKind;
  readonly specifier: string;
  readonly error: unknown;
}

const dynamicRequire = createRequire(import.meta.url);

type ModuleResolver = (specifier: string) => unknown;

let moduleResolverOverride: ModuleResolver | null = null;

const resolveModule = (specifier: string): unknown => {
  if (moduleResolverOverride) {
    return moduleResolverOverride(specifier);
  }
  return dynamicRequire(specifier);
};

const isWindowsPlatform = (): boolean => process.platform === 'win32';

const normalizeEnvValue = (value: string | undefined): string | null => {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

const shouldAllowFfiFallback = (): boolean => {
  const allowValue = normalizeEnvValue(process.env[WINDOWS_BINDING_ALLOW_FFI_ENV]);
  return allowValue === '1' || allowValue === 'true';
};

const resolvePathOverride = (value: string): string => {
  if (path.isAbsolute(value)) {
    return value;
  }
  return path.resolve(process.cwd(), value);
};

const platformSummary = (): string => `${process.platform}-${process.arch}`;

const isWindowsConsoleBinding = (candidate: unknown): candidate is WindowsConsoleBinding => {
  if (candidate == null || typeof candidate !== 'object') {
    return false;
  }
  const value = candidate as WindowsConsoleBinding;
  return (
    typeof value.getConsoleMode === 'function' &&
    typeof value.setConsoleMode === 'function' &&
    typeof value.readConsoleInput === 'function' &&
    typeof value.cancelIo === 'function' &&
    typeof value.createPseudoConsole === 'function' &&
    typeof value.resizePseudoConsole === 'function' &&
    typeof value.closePseudoConsole === 'function'
  );
};

const extractBindingFactory = (moduleExport: unknown, specifier: string): (() => WindowsConsoleBinding) => {
  if (typeof moduleExport === 'function') {
    return moduleExport as () => WindowsConsoleBinding;
  }
  if (moduleExport && typeof moduleExport === 'object') {
    const withFactory = moduleExport as { createWindowsConsoleBinding?: () => WindowsConsoleBinding; default?: unknown };
    if (typeof withFactory.createWindowsConsoleBinding === 'function') {
      return withFactory.createWindowsConsoleBinding.bind(withFactory);
    }
    if (typeof withFactory.default === 'function') {
      return withFactory.default as () => WindowsConsoleBinding;
    }
    const defaultExport = withFactory.default as { createWindowsConsoleBinding?: () => WindowsConsoleBinding } | undefined;
    if (defaultExport && typeof defaultExport.createWindowsConsoleBinding === 'function') {
      return defaultExport.createWindowsConsoleBinding.bind(defaultExport);
    }
  }
  throw new Error(`Module "${specifier}" does not export createWindowsConsoleBinding()`);
};

const loadBindingFromSpecifier = (specifier: string): WindowsConsoleBinding => {
  const moduleExport = resolveModule(specifier);
  const factory = extractBindingFactory(moduleExport, specifier);
  const binding = factory();
  if (!isWindowsConsoleBinding(binding)) {
    throw new Error(`Module "${specifier}" did not return a valid WindowsConsoleBinding`);
  }
  return binding;
};

const loadBindingFromPath = (overrideValue: string): WindowsConsoleBinding => {
  const resolved = resolvePathOverride(overrideValue);
  const specifier = resolved;
  const moduleExport = resolveModule(specifier);
  const factory = extractBindingFactory(moduleExport, specifier);
  const binding = factory();
  if (!isWindowsConsoleBinding(binding)) {
    throw new Error(
      `Module at "${specifier}" did not return a valid WindowsConsoleBinding implementation`
    );
  }
  return binding;
};

export class BubbleTeaWindowsBindingError extends Error {
  readonly attempts: ReadonlyArray<BindingAttemptFailure>;

  constructor(message: string, options: { cause?: unknown; attempts?: BindingAttemptFailure[] } = {}) {
    super(message, { cause: options.cause });
    this.name = 'BubbleTeaWindowsBindingError';
    this.attempts = options.attempts ?? [];
  }
}

let cachedBinding: WindowsConsoleBinding | null | undefined;
let overrideBinding: WindowsConsoleBinding | null = null;
let overrideActive = false;

const cacheBinding = (binding: WindowsConsoleBinding | null): WindowsConsoleBinding | null => {
  cachedBinding = binding;
  return binding;
};

export const resetWindowsConsoleBindingLoaderForTests = (): void => {
  cachedBinding = undefined;
  overrideBinding = null;
  overrideActive = false;
  moduleResolverOverride = null;
};

export const setWindowsConsoleBindingOverride = (binding: WindowsConsoleBinding | null): void => {
  if (binding == null) {
    overrideBinding = null;
    overrideActive = false;
    cachedBinding = undefined;
    return;
  }
  overrideBinding = binding;
  overrideActive = true;
  cacheBinding(binding);
};

const attemptPathOverride = (): WindowsConsoleBinding | null => {
  const overridePath = normalizeEnvValue(process.env[WINDOWS_BINDING_PATH_ENV]);
  if (!overridePath) {
    return null;
  }
  try {
    return loadBindingFromPath(overridePath);
  } catch (error) {
    throw new BubbleTeaWindowsBindingError(
      `Failed to load Windows console binding from ${WINDOWS_BINDING_PATH_ENV} (resolved to "${resolvePathOverride(
        overridePath
      )}")`,
      {
        cause: error,
        attempts: [
          {
            kind: 'path',
            specifier: overridePath,
            error
          }
        ]
      }
    );
  }
};

const loadAddonBinding = (): WindowsConsoleBinding => loadBindingFromSpecifier('@bubbletea/windows-binding');

const loadFfiBinding = (): WindowsConsoleBinding => loadBindingFromSpecifier('@bubbletea/windows-binding-ffi');

const normalizeBindingMode = (): 'addon' | 'ffi' => {
  const modeValue = normalizeEnvValue(process.env[WINDOWS_BINDING_MODE_ENV]);
  if (modeValue?.toLowerCase() === 'ffi') {
    return 'ffi';
  }
  return 'addon';
};

const createFailure = (
  message: string,
  cause: unknown,
  attempts: BindingAttemptFailure[]
): BubbleTeaWindowsBindingError => new BubbleTeaWindowsBindingError(message, { cause, attempts });

export const setWindowsBindingModuleLoaderForTests = (loader: ModuleResolver | null): void => {
  moduleResolverOverride = loader;
};

export const ensureWindowsConsoleBindingLoaded = (): WindowsConsoleBinding | null => {
  if (!isWindowsPlatform()) {
    return cacheBinding(null);
  }

  if (overrideActive) {
    return overrideBinding;
  }

  if (cachedBinding !== undefined) {
    return cachedBinding;
  }

  const bindingFromPath = attemptPathOverride();
  if (bindingFromPath) {
    return cacheBinding(bindingFromPath);
  }

  const attempts: BindingAttemptFailure[] = [];
  const bindingMode = normalizeBindingMode();
  const allowFfiFallback = shouldAllowFfiFallback() || bindingMode === 'ffi';

  if (bindingMode !== 'ffi') {
    try {
      const binding = loadAddonBinding();
      return cacheBinding(binding);
    } catch (error) {
      attempts.push({ kind: 'addon', specifier: '@bubbletea/windows-binding', error });
      if (!allowFfiFallback) {
        throw createFailure(
          `Failed to load Windows console binding via @bubbletea/windows-binding on ${platformSummary()}`,
          error,
          attempts
        );
      }
    }
  }

  try {
    const binding = loadFfiBinding();
    return cacheBinding(binding);
  } catch (error) {
    attempts.push({ kind: 'ffi', specifier: '@bubbletea/windows-binding-ffi', error });
    const cause = attempts[0]?.error ?? error;
    throw createFailure(
      `Failed to load Windows console binding (${platformSummary()}), attempted: ${attempts
        .map((attempt) => `${attempt.kind}:${attempt.specifier}`)
        .join(', ')}`,
      cause,
      attempts
    );
  }
};
