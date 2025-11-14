# @bubbletea/windows-binding

Native Windows console binding for the Bubble Tea TypeScript port. This
package will eventually ship a Node-API addon that wraps Pseudo Console and
console input APIs (`ReadConsoleInputW`, `CreatePseudoConsole`, etc.).

## Status

The addon is not implemented yet. The current module only exposes a
placeholder `createWindowsConsoleBinding()` that throws at runtime. The test
suite uses this stub so the package name and export surface are locked down
before we commit to native code.
