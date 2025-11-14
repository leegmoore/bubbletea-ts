# Windows Console Binding Loader Reference

_Last updated: 2025-11-14_

Bubble Tea’s TypeScript runtime now ships a real loader for the
`WindowsConsoleBinding` interface. All Windows-only features (VT enablement,
mouse tracking, pseudo-console resize events, etc.) flow through this loader, so
every production build and Vitest suite now shares the exact same discovery
surface.

## 1. What the Loader Does

1. **Platform guard.** The loader bails out immediately when
   `process.platform !== 'win32'`, returning `null` so Linux/macOS callers pay
   zero overhead.
2. **Test override.** `setWindowsConsoleBindingForTests(binding)` installs a
   deterministic fake for suites. When present, the loader returns that binding
   and never touches the filesystem. Clearing the override (`null`) restores the
   default behaviour.
3. **Path override.** When `BUBBLETEA_WINDOWS_BINDING_PATH` is set the loader
   resolves that path (relative to `process.cwd()` if needed), imports the module
   via `createRequire`, and expects it to expose either
   `createWindowsConsoleBinding()` or a default export that returns the binding.
4. **Addon default.** Absent overrides, we attempt to import
   `@bubbletea/windows-binding`, our future Node-API addon. Successful loads are
   cached for the lifetime of the process.
5. **FFI fallback.** If either `BUBBLETEA_WINDOWS_BINDING_MODE=ffi` or
   `BUBBLETEA_WINDOWS_BINDING_ALLOW_FFI=1|true` is present, loader failures fall
   back to `@bubbletea/windows-binding-ffi` (a pure-JS shim). Without those flags
   we surface the addon failure immediately so production builds don’t silently
   downgrade.
6. **Fatal errors.** When every resolution path fails on Windows we throw
   `BubbleTeaWindowsBindingError`, which records every attempt (mode + specifier)
   and retains the original cause stack for debugging.

The implementation lives in
`packages/tea/src/internal/windows/binding-loader.ts` and is fully specified by
`packages/tests/src/internal/windows-binding-loader.test.ts`.

## 2. Environment Flags

| Variable | Purpose |
| --- | --- |
| `BUBBLETEA_WINDOWS_BINDING_PATH` | Absolute or relative path to a module exporting `createWindowsConsoleBinding()` (handy for local builds or alternate bindings). |
| `BUBBLETEA_WINDOWS_BINDING_MODE` | Accepts `addon` (default) or `ffi`. `ffi` skips the addon import entirely. |
| `BUBBLETEA_WINDOWS_BINDING_ALLOW_FFI` | When set to `1` or `true`, allows the loader to fall back to the FFI shim if the addon import fails. |

Unset/blank values are ignored. Boolean-like envs are trimmed and case-insensitive.

## 3. Error Handling & Diagnostics

- `BubbleTeaWindowsBindingError` includes `attempts`, a list of `{kind, specifier,
  error}` entries describing every failed resolution step. The `.cause` field
  references the first failure (typically the addon import error) for easy stack
  inspection.
- Messages include `process.platform` and `process.arch` to simplify support
  requests (e.g., “Failed to load … on win32-x64”).
- Each fatal failure suggests trying `BUBBLETEA_WINDOWS_BINDING_PATH` or the FFI
  mode if a user needs a quick escape hatch.
- The new troubleshooting checklist in
  [`docs/windows-console.md#troubleshooting`](./windows-console.md#troubleshooting)
  links back here for details on interpreting the error.

## 4. Testing & Overrides

- `setWindowsConsoleBindingForTests(binding)` installs a fake binding and caches
  it immediately so runtime code skips IO entirely. Use this when a suite wants
  to focus purely on program behaviour (see
  `packages/tests/src/program/windows-console-mode.test.ts`).
- `setWindowsBindingModuleLoaderForTests(fn)` replaces `require()` for loader
  imports, making it easy to intercept `@bubbletea/windows-binding` and return a
  stub without touching the filesystem.
- `resetWindowsConsoleBindingLoaderForTests()` clears the override, cache, and
  custom module loader between tests.
- When you need to assert behaviour end-to-end (Program → loader → binding),
  write a temp module to disk and point `BUBBLETEA_WINDOWS_BINDING_PATH` at it so
  the real resolution path runs inside Vitest.

## 5. Troubleshooting Cheat Sheet

1. **“Failed to load … via @bubbletea/windows-binding”** – confirm the addon
   package is installed (or pass `BUBBLETEA_WINDOWS_BINDING_PATH` to a local
   `.node` build). During development set
   `BUBBLETEA_WINDOWS_BINDING_MODE=ffi` to unblock while the addon compiles.
2. **“Module at … did not return a valid WindowsConsoleBinding”** – ensure your
   module exports a function that instantiates the interface (all seven methods
   must exist).
3. **Pseudo console/mouse flows doing nothing on Windows** – run with
   `BUBBLETEA_DEBUG=windows-binding` (planned) and ensure
   `ensureWindowsConsoleBindingLoaded()` isn’t returning `null` because the
   loader bailed on a non-Windows platform.

## 6. Follow-ups

- Ship the actual `@bubbletea/windows-binding` addon and `@bubbletea/windows-binding-ffi`
  shim so the loader’s default paths resolve outside of tests.
- Capture breadcrumbs when the loader throws (e.g., `BUBBLETEA_DEBUG=windows-binding`).
- Keep `docs/windows-console.md` updated whenever loader semantics change so the
  troubleshooting guide stays aligned.
