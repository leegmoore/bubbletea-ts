# Windows Pseudo Console Binding Implementation Plan

_Last updated: 2025-11-14_

## 1. Goals & Constraints

- Deliver a real `WindowsConsoleBinding` backed by Win32 Pseudo Console APIs so the runtime stops depending on `FakeWindowsConsoleBinding` outside Vitest.
- Keep the tests-first mandate intact by spelling out which Go/TS specs must pass before production code changes land.
- Leverage Node-API for the primary addon (stable ABI, prebuilt binary distribution) while keeping the pure JS/`ffi-napi` shim as a documented fallback.

## 2. Behavioural Source of Truth & Test Coverage

- **Go references:** `tty_windows.go`, `inputreader_windows.go`, `tea.go` (release/restore) inform mode toggles and pseudo-console lifecycle expectations even though upstream Go does not expose pseudo consoles directly.
- **Translated/authoritative TS suites:**  
  - `packages/tests/src/internal/windows-console-binding.test.ts` (console mode toggles, cancelation semantics).  
  - `packages/tests/src/input/windows-console-input.test.ts` (key/mouse/window-buffer-size translation).  
  - `packages/tests/src/program/windows-console-mode.test.ts` (mode capture/restore).  
  - `packages/tests/src/signals/windows-resize.test.ts` (resize watcher contract).
- **New Windows-only integration suites (to be added once the addon exists):** `packages/tests/src/native/windows-console-binding.integration.test.ts` exercised via `vitest --run windows` on GitHub Actions Windows agents to assert that the addon streams real `INPUT_RECORD` events, respects cancelation, and mirrors pseudo-console resizes.
- Tests must continue to run cross-platform by default by stubbing the addon via `setWindowsConsoleBindingForTests`; the real binding only loads on Windows CI/manual verification runs.

## 3. Node-API Surface & Data Contracts

All exports live in `packages/windows-binding/src/addon.cc` and are wrapped in a JS factory (`packages/windows-binding/src/index.ts`) that returns the TypeScript `WindowsConsoleBinding`.

| Method | Win32 API(s) | Notes |
| --- | --- | --- |
| `getConsoleMode(handle: number): number` | `GetConsoleMode` | Throws `WindowsBindingNativeError` when `GetConsoleMode` fails; returns a 32-bit unsigned integer. |
| `setConsoleMode(handle: number, mode: number): void` | `SetConsoleMode` | Accepts bitmask, propagates failure as `WindowsBindingNativeError`. |
| `createPseudoConsole({ columns, rows })` | `CreatePseudoConsole`, `CreatePipe` | Returns `{ handle, input, output }`. Wraps handles via `_get_osfhandle` for Node compatibility and tracks them in a `PseudoConsoleRegistry`. |
| `resizePseudoConsole(handle, size)` | `ResizePseudoConsole` | Also enqueues a `WINDOW_BUFFER_SIZE` record into the pseudo console input pipe. |
| `closePseudoConsole(handle)` | `ClosePseudoConsole`, `CloseHandle` | Disposes associated pipes, cancels record readers, removes registry entry. |
| `readConsoleInput(handle)` | `ReadConsoleInputW`, `CancelIoEx` | Exposed to JS as an async iterator. A worker thread blocks on `ReadConsoleInputW`, converts `KEY_EVENT_RECORD`, `MOUSE_EVENT_RECORD`, and `WINDOW_BUFFER_SIZE_RECORD` structures to the TS-friendly JSON payloads, and pushes them via a `napi_threadsafe_function`. |
| `cancelIo(handle)` | `CancelIoEx` | Cancels pending `ReadConsoleInputW` calls and triggers iterator completion. |

### Data marshalling

- `WindowsHandle` is represented as a signed 32-bit integer in JS; conversion to/from `HANDLE` is centralized to avoid accidental double-closes.
- Input records are serialized into plain objects that exactly match `packages/tea/src/internal/windows/binding.ts` (ensuring existing Vitest assertions remain unchanged).
- Every native error is wrapped with `{ code, winapi, message }` so `BubbleTeaWindowsBindingError` can surface actionable context in TS.

## 4. Threading & Lifetime Model

1. **Reader workers:** For every handle passed to `readConsoleInput()`, start a dedicated std::thread that:  
   - Calls `ReadConsoleInputW` in a blocking loop.  
   - On success, coalesces key repeat counts into per-message payloads and forwards them via a `ThreadSafeFunction` to the JS iterator.  
   - Terminates when `cancelIo()` runs or when the iterator calls `return()`.  
2. **Resource tracking:** `PseudoConsoleRegistry` stores `{ pseudoHandle, inputHandle, outputHandle, reader }` records. Destructors close handles via `CloseHandle`, join threads, and unregister from the registry.  
3. **Cancelation:** `cancelIo(handle)` looks up the reader tied to the handle, calls `CancelIoEx` against the underlying file HANDLE, signals the worker thread, and resolves the iterator with `done: true`.  
4. **Resize flow:** `resizePseudoConsole()` updates the pseudo console, then emits a synthetic `WINDOW_BUFFER_SIZE` record through the registry’s queue so the JS side can dispatch `WindowSizeMsg` immediately (parity with the fake binding).  
5. **Safety:** All exported functions guard against stale handles by consulting the registry first and throwing `WindowsBindingInvalidHandleError` when mismatched pairs appear.

## 5. Implementation Steps

1. **Scaffolding:** Create `packages/windows-binding` with `node-addon-api` dependency, `binding.gyp`, `tsconfig.json`, and `src/addon.cc`. Wire `pnpm build` to run `node-gyp-build` (dev) and `prebuildify --napi --platform win32 --arch x64,arm64` for releases.
2. **Type bindings:** Define `struct InputRecord`, `struct Point`, `struct Size` helpers plus converters to/from JS objects using `Napi::Object`.
3. **Pseudo console registry:** Implement a RAII-managed registry that stores handles, pipes, and worker thread references.
4. **Async iterator glue:** Expose a JS `createInputRecordStream(handle)` returning an object with `[Symbol.asyncIterator]` implemented in TS on top of a native `RecordStream` class with `next`/`return` methods.
5. **Error taxonomy:** Introduce `WindowsBindingNativeError`, `WindowsBindingInvalidHandleError`, and `WindowsBindingResourceError` classes surfaced through the addon for consistent TS error handling.
6. **Docs & samples:** Update `docs/windows-console.md` with troubleshooting steps once the addon compiles; link from README.

## 6. pnpm Workspace & Package Layout

```
packages/
  tea/                              # existing runtime
  tests/                            # Vitest specs
  windows-binding/                  # NEW Node-API addon (primary)
    package.json                    # name: @bubbletea/windows-binding, type: module
    binding.gyp
    tsconfig.json                   # TS types for the JS wrapper
    src/
      addon.cc                      # Node-API entrypoint
      binding.cc/h                  # Win32 helpers, registry classes
      record-stream.cc/h            # Async iterator glue
      win32.hpp                     # shared structs
    README.md                       # build prerequisites + troubleshooting
    scripts/
      build-native.mjs              # wraps node-gyp-build/prebuildify
  windows-binding-ffi/              # NEW fallback shim (pure TS)
    package.json                    # name: @bubbletea/windows-binding-ffi
    src/index.ts                    # ffi-napi wiring + dlopen handles
    src/win32.ts                    # type definitions for ffi structs
    README.md                       # describes opt-in env vars + perf trade-offs
```

- `pnpm-workspace.yaml` already matches `packages/*`; no change needed beyond creating the directories.
- **Scripts:**  
  - `pnpm --filter @bubbletea/windows-binding build` → `node-gyp-build --debug && tsc --emitDeclarationOnly`.  
  - `pnpm --filter @bubbletea/windows-binding prebuild` → `prebuildify --napi --platform win32 --arch x64,arm64 --tag-libc msvc`.  
  - `pnpm --filter @bubbletea/windows-binding-ffi build` → `tsup src/index.ts --format esm,cjs`.  
  - Shared `clean` script removes `build/`, `dist/`, and `prebuilds/`.

## 7. Vitest & Harness Integration

- Tests that need the fake binding continue to call `setWindowsConsoleBindingForTests(new FakeWindowsConsoleBinding())`; the loader will respect overrides per D-047.
- To exercise the addon, add `packages/tests/src/native/windows-console-binding.integration.test.ts` guarded by `if (process.platform !== 'win32') { it.skip(...) }`. Use real `@bubbletea/windows-binding` imports and spawn a pseudo console to assert actual Win32 behaviour.
- Provide `vi.mock('@bubbletea/windows-binding', ...)` helpers under `packages/tests/src/utils/mock-windows-binding.ts` so existing suites can simulate loader failures or enforce fallback behaviour without editing runtime code.

## 8. CI & Distribution Plan

- **Build matrix:** Extend `.github/workflows/ci.yml` with a `windows-addons` job (`windows-latest`, Node 20.x, pnpm). Steps: `pnpm install`, `pnpm --filter @bubbletea/windows-binding build`, run Windows-only Vitest suites, and upload `prebuilds/` as artifacts.
- **Release packaging:** Once the addon is verified, publish `@bubbletea/windows-binding` with embedded `prebuilds/win32-x64/node.napi.node` & `win32-arm64` assets. Document manual `npm prebuildify --upload` instructions.
- **Fallback verification:** Add a nightly job that forces `BUBBLETEA_WINDOWS_BINDING_MODE=ffi` and runs the same Vitest suites to catch drift between the Node-API addon and the FFI shim.

## 9. Open Questions / Follow-ups

1. Decide whether the addon should expose a public `createWindowsConsoleBinding(options?: { debug?: boolean })` so the loader can pass verbose logging flags.
2. Finalize which additional Win32 entry points (e.g., `GetNumberOfConsoleInputEvents`) are worth exposing for diagnostics.
3. Determine whether to vendor the minimal subset of Windows headers (`um/wincon.h`, `um/consoleapi3.h`) to avoid depending on the system SDK for the FFI shim’s type declarations.
