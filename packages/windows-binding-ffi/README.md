# @bubbletea/windows-binding-ffi

Planned ffi-napi fallback for the Bubble Tea TypeScript Windows console
binding. This package will eventually expose the same
`createWindowsConsoleBinding()` factory as the Node-API addon, but implemented
in pure TypeScript using ffi bindings for Kernel32 entrypoints.

## Status

The shim is not implemented yet. The stub export exists so tests and the
upcoming loader can resolve the package name before native bindings land.
