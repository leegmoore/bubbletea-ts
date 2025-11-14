import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WindowsConsoleBinding } from '@bubbletea/tea/internal';
import { setWindowsConsoleBindingForTests } from '@bubbletea/tea/internal';
import {
  BubbleTeaWindowsBindingError,
  ensureWindowsConsoleBindingLoaded,
  resetWindowsConsoleBindingLoaderForTests,
  setWindowsBindingModuleLoaderForTests
} from '@bubbletea/tea/internal/windows/binding-loader';

const WINDOWS_BINDING_PATH_ENV = 'BUBBLETEA_WINDOWS_BINDING_PATH';
const WINDOWS_BINDING_MODE_ENV = 'BUBBLETEA_WINDOWS_BINDING_MODE';
const WINDOWS_BINDING_ALLOW_FFI_ENV = 'BUBBLETEA_WINDOWS_BINDING_ALLOW_FFI';

type StubBinding = WindowsConsoleBinding & { __bindingId: string };

const createStubBinding = (label: string): StubBinding => {
  return {
    __bindingId: label,
    getConsoleMode: () => 0,
    setConsoleMode: () => {},
    readConsoleInput: () => ({
      [Symbol.asyncIterator]: async function* () {
        return;
      }
    }),
    cancelIo: () => {},
    createPseudoConsole: () => ({ handle: 1, input: 2, output: 3 }),
    resizePseudoConsole: () => {},
    closePseudoConsole: () => {}
  } satisfies StubBinding;
};

const addonFactory = vi.fn<[], StubBinding>();
const ffiFactory = vi.fn<[], StubBinding>();

const nativeRequire = createRequire(import.meta.url);

const mockPlatform = (value: NodeJS.Platform) => vi.spyOn(process, 'platform', 'get').mockReturnValue(value);

const trackedEnvVars = [WINDOWS_BINDING_PATH_ENV, WINDOWS_BINDING_MODE_ENV, WINDOWS_BINDING_ALLOW_FFI_ENV] as const;

const tempPaths: string[] = [];

const createTempModule = (source: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bubbletea-windows-binding-'));
  const filePath = path.join(dir, 'binding.cjs');
  fs.writeFileSync(filePath, source, 'utf8');
  tempPaths.push(dir);
  return filePath;
};

describe('ensureWindowsConsoleBindingLoaded', () => {
  let originalEnv: Map<string, string | undefined>;

  beforeEach(() => {
    originalEnv = new Map<string, string | undefined>();
    trackedEnvVars.forEach((name) => {
      originalEnv.set(name, process.env[name]);
      delete process.env[name];
    });
    addonFactory.mockReset();
    ffiFactory.mockReset();
    resetWindowsConsoleBindingLoaderForTests();
    setWindowsBindingModuleLoaderForTests((specifier) => {
      if (specifier === '@bubbletea/windows-binding') {
        return { createWindowsConsoleBinding: addonFactory };
      }
      if (specifier === '@bubbletea/windows-binding-ffi') {
        return { createWindowsConsoleBinding: ffiFactory };
      }
      return nativeRequire(specifier);
    });
  });

  afterEach(() => {
    setWindowsConsoleBindingForTests(null);
    resetWindowsConsoleBindingLoaderForTests();
    setWindowsBindingModuleLoaderForTests(null);
    vi.restoreAllMocks();
    addonFactory.mockReset();
    ffiFactory.mockReset();
    trackedEnvVars.forEach((name) => {
      const value = originalEnv.get(name);
      if (value == null) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    });
    while (tempPaths.length > 0) {
      const dir = tempPaths.pop();
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('returns null immediately on non-Windows platforms', () => {
    mockPlatform('linux');

    const binding = ensureWindowsConsoleBindingLoaded();

    expect(binding).toBeNull();
    expect(addonFactory).not.toHaveBeenCalled();
    expect(ffiFactory).not.toHaveBeenCalled();
  });

  it('prefers the test override binding before loading modules', () => {
    mockPlatform('win32');
    const override = createStubBinding('override');
    setWindowsConsoleBindingForTests(override);

    const binding = ensureWindowsConsoleBindingLoaded();

    expect(binding).toBe(override);
    expect(addonFactory).not.toHaveBeenCalled();
    expect(ffiFactory).not.toHaveBeenCalled();
  });

  it('resolves bindings from BUBBLETEA_WINDOWS_BINDING_PATH when set', () => {
    mockPlatform('win32');
    const modulePath = createTempModule(`
      'use strict';
      class InlineBinding {
        constructor() { this.__bindingId = 'path-override'; }
        getConsoleMode() { return 7; }
        setConsoleMode() {}
        readConsoleInput() { return { [Symbol.asyncIterator]: async function* () {} }; }
        cancelIo() {}
        createPseudoConsole() { return { handle: 1, input: 2, output: 3 }; }
        resizePseudoConsole() {}
        closePseudoConsole() {}
      }
      module.exports = {
        createWindowsConsoleBinding() {
          return new InlineBinding();
        }
      };
    `);
    process.env[WINDOWS_BINDING_PATH_ENV] = path.relative(process.cwd(), modulePath);

    const binding = ensureWindowsConsoleBindingLoaded();

    expect(binding).not.toBeNull();
    expect((binding as StubBinding).__bindingId).toBe('path-override');
    expect(addonFactory).not.toHaveBeenCalled();
    expect(ffiFactory).not.toHaveBeenCalled();
  });

  it('wraps path override failures in BubbleTeaWindowsBindingError', () => {
    mockPlatform('win32');
    const modulePath = createTempModule(`
      'use strict';
      module.exports = {
        createWindowsConsoleBinding() {
          throw new Error('boom from override');
        }
      };
    `);
    process.env[WINDOWS_BINDING_PATH_ENV] = path.relative(process.cwd(), modulePath);

    let error: unknown = undefined;
    try {
      ensureWindowsConsoleBindingLoaded();
    } catch (err) {
      error = err;
    }
    const typed = error as BubbleTeaWindowsBindingError;
    expect(typed).toBeInstanceOf(BubbleTeaWindowsBindingError);
    expect(typed.message).toMatch(/BUBBLETEA_WINDOWS_BINDING_PATH/);
    expect(typed.cause).toBeInstanceOf(Error);
    expect((typed.cause as Error).message).toContain('boom from override');
    expect(addonFactory).not.toHaveBeenCalled();
    expect(ffiFactory).not.toHaveBeenCalled();
  });

  it('loads the addon when no overrides are present and caches the instance', () => {
    mockPlatform('win32');
    const binding = createStubBinding('addon');
    addonFactory.mockReturnValue(binding);

    const first = ensureWindowsConsoleBindingLoaded();
    const second = ensureWindowsConsoleBindingLoaded();

    expect(first).toBe(binding);
    expect(second).toBe(binding);
    expect(addonFactory).toHaveBeenCalledTimes(1);
  });

  it('prefers the FFI shim when BUBBLETEA_WINDOWS_BINDING_MODE=ffi', () => {
    mockPlatform('win32');
    process.env[WINDOWS_BINDING_MODE_ENV] = 'ffi';
    const binding = createStubBinding('ffi');
    ffiFactory.mockReturnValue(binding);

    const resolved = ensureWindowsConsoleBindingLoaded();

    expect(resolved).toBe(binding);
    expect(addonFactory).not.toHaveBeenCalled();
    expect(ffiFactory).toHaveBeenCalledTimes(1);
  });

  it('throws BubbleTeaWindowsBindingError when addon fails and fallback is disabled', () => {
    mockPlatform('win32');
    addonFactory.mockImplementation(() => {
      throw new Error('addon exploded');
    });

    let error: unknown = undefined;
    try {
      ensureWindowsConsoleBindingLoaded();
    } catch (err) {
      error = err;
    }
    const typed = error as BubbleTeaWindowsBindingError;
    expect(typed).toBeInstanceOf(BubbleTeaWindowsBindingError);
    expect(typed.message).toContain('Failed to load Windows console binding');
    expect(typed.cause).toBeInstanceOf(Error);
    expect((typed.cause as Error).message).toContain('addon exploded');
    expect(ffiFactory).not.toHaveBeenCalled();
  });
});
