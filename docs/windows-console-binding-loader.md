# Windows Console Binding Loader Plan

_Last updated: 2025-11-14_

## 1. Context

- The TypeScript runtime already routes every Windows-only code path through the `WindowsConsoleBinding` interface (`packages/tea/src/internal/windows/binding.ts`).
- Tests inject a fake implementation via `setWindowsConsoleBindingForTests(...)`, but production builds still return `null`, so all Windows-specific flows are effectively no-ops outside of unit tests.
- Before we can ship mouse/resize/VT features on Windows we need a loader that can discover a real binding, surface configuration errors clearly, and keep the tests-first workflow intact.

## 2. Goals & Non-goals

**Goals**
- Resolve a concrete `WindowsConsoleBinding` at runtime on Windows hosts without burdening non-Windows users.
- Support both a compiled Node-API addon (preferred for performance and access to Pseudo Console APIs) and a pure-FFI fallback (handy for prototyping or environments without a compiler toolchain).
- Allow tests (and downstream consumers) to inject fakes deterministically.
- Fail loudly when the binding is required but missing/misconfigured, with actionable guidance in the error.

**Non-goals**
- Implement the native bindings themselves (covered by the next progress-log item).
- Ship cross-platform binaries or release automation—those stay out of scope for this loop.

## 3. Loader Architecture

1. **Module layout**
   - Keep `binding.ts` as the shared type surface plus the `setWindowsConsoleBindingForTests` helper.
   - Add `packages/tea/src/internal/windows/binding-loader.ts` that exports:
     - `ensureWindowsConsoleBindingLoaded(): WindowsConsoleBinding | null`
     - `setWindowsConsoleBindingOverride(binding: WindowsConsoleBinding | null)` (internal helper invoked by the public test hook).
   - Update `getWindowsConsoleBinding()` in `binding.ts` to lazily call the loader the first time it is requested outside of tests.

2. **Loader responsibilities**
   - Determine whether the current platform is Windows (`process.platform === 'win32'`). Return `null` immediately on other platforms so Linux/macOS consumers pay zero overhead.
   - If tests already installed a fake binding via `setWindowsConsoleBindingForTests`, honor it and bypass dynamic loading.
   - Support three discovery channels, in order:
     1. **Explicit path override** (`BUBBLETEA_WINDOWS_BINDING_PATH=/absolute/or/relative/path`), allowing advanced users to point at a custom `.node`/JS module.
     2. **Addon package lookup**: attempt to `require()` / dynamic-import `@bubbletea/windows-binding` (planned Node-API addon built with `node-addon-api`). Resolve platform/arch-specific builds via the package’s `exports` map.
     3. **FFI fallback**: if `BUBBLETEA_WINDOWS_BINDING_MODE=ffi` (or the addon fails with the specific `MODULE_NOT_FOUND` family of errors), lazy-load a JS shim implemented with `ffi-napi` that surfaces the same interface. This allows development in environments without a prebuilt addon, albeit with slower performance.
   - Cache the successful binding instance so repeated calls are cheap and so fatal failures are raised only once per process.

3. **node-addon-api vs FFI decision**
   - **Node-API addon (primary path)**
     - Pros: direct access to Win32 headers (`GetConsoleMode`, `SetConsoleMode`, `ReadConsoleInputW`, `CreatePseudoConsole`, etc.), best performance, no dependency on external npm modules at runtime.
     - Cons: requires a full MSVC toolchain to build from source; needs prebuilds for each `arch`/`node-abi` pair.
   - **FFI fallback (secondary path)**
     - Pros: pure-JS distribution, great for prototyping or running tests on Windows without compiling native code.
     - Cons: slower, limited type safety, `ffi-napi` sometimes lags behind new Node releases.
   - **Decision**: ship the Node-API addon as the default resolution (`@bubbletea/windows-binding` package) and keep the FFI shim strictly opt-in via `BUBBLETEA_WINDOWS_BINDING_MODE=ffi`. This gives us deterministic performance in production while retaining an escape hatch for constrained dev boxes.

## 4. Discovery & Error Surfacing Flow

1. **Platform gate**: if `process.platform !== 'win32'`, return `null` and skip the rest.
2. **Test override**: if `activeBinding` is already set by `setWindowsConsoleBindingForTests`, return it.
3. **Path override**: when `BUBBLETEA_WINDOWS_BINDING_PATH` is defined, resolve it relative to `process.cwd()` (if not absolute), `import()` it, and expect a default export or named `createWindowsConsoleBinding()` factory returning the interface. Wrap resolution errors with a message that repeats the provided path.
4. **Addon lookup**: attempt to `import('@bubbletea/windows-binding')`. Expect it to expose `createWindowsConsoleBinding()` that returns the binding. If the module is not found or fails to initialize, capture the `cause` and continue to the fallback.
5. **FFI fallback**: only attempt when `BUBBLETEA_WINDOWS_BINDING_MODE=ffi` (or when `BUBBLETEA_WINDOWS_BINDING_ALLOW_FFI=1` for emergency fallback). Load a local helper such as `packages/tea/src/internal/windows/ffi-binding.ts` that wires `ffi-napi` to the Kernel32 entrypoints.
6. **Terminal failure**: if all discovery attempts fail on Windows, throw a `BubbleTeaWindowsBindingError` that:
   - Includes the platform/arch, attempted resolution modes, and the first error stack as `cause`.
   - Suggests setting `BUBBLETEA_WINDOWS_BINDING_PATH` or `BUBBLETEA_WINDOWS_BINDING_MODE=ffi` as mitigation.
   - Cross-links to `docs/windows-console-binding-loader.md#troubleshooting` (to be added when the implementation lands).

## 5. Test Strategy

- Add `packages/tests/src/internal/windows-binding-loader.test.ts` with the following cases (Vitest):
  1. **Non-Windows bypass**: mock `process.platform` to `linux`, ensure loader returns `null` and never attempts dynamic imports.
  2. **Test override precedence**: call `setWindowsConsoleBindingForTests(fake)` and confirm loader returns it without touching module resolution.
  3. **Path override success/failure**: mock `import()` via `vi.mock` to return a fake module; verify failures surface sanitized errors mentioning the bad path.
  4. **Addon happy path**: mock the addon module to return a stub binding and ensure caching prevents duplicate imports.
  5. **FFI opt-in**: set `BUBBLETEA_WINDOWS_BINDING_MODE=ffi`, mock the shim, and verify loader prefers it over the addon.
  6. **Fatal error**: simulate addon throw + missing fallback and assert `BubbleTeaWindowsBindingError` message/cause structure matches the doc.
- Reuse the existing `setWindowsConsoleBindingForTests(null)` cleanup in `afterEach` to avoid leaking state between tests.

## 6. Implementation Steps

1. Author the loader module + helper error class (tests-first using the suite above).
2. Update `binding.ts`, `tty.ts`, and `Program` internals to rely on the loader instead of assuming `activeBinding` is already populated.
3. Land the docs (this file plus a short “Troubleshooting Windows bindings” section in `docs/windows-console.md`).
4. Wire pnpm scripts so that the addon package can be built locally (placeholder shell script now, actual implementation later).

## 7. Open Questions / Follow-ups

- Determine the final package name for the addon (`@bubbletea/windows-binding` vs `@bubbletea/tea-windows`). The doc currently assumes the former—rename here once the package layout is confirmed.
- Confirm whether we want an additional env var (`BUBBLETEA_WINDOWS_BINDING_DISABLE=1`) to help diagnose issues by forcing the loader to throw.
- Decide where to stash instrumentation (e.g., debug logs) so we can ask users to enable `BUBBLETEA_DEBUG=windows-binding` when gathering bug reports.

This plan unblocks the next progress-log item (pseudo-console binding implementation) by spelling out how the runtime will discover and vet the binding once a real implementation exists.
