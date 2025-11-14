# Structured Logging (TypeScript)

_Last updated: 2025-11-14_

The TypeScript port exposes the same structured logging surface as the Go
runtime by re-exporting `LogToFile`, `createMultiWriterLogOptions`, and the
internal `FanOutWritable`. The APIs are designed so you can wire logs to any
`Writable` while still letting Bubble Tea take control of stdout for your UI.

## Quick start

```ts
import { LogToFile } from '@bubbletea/tea';

const logfile = LogToFile('debug.log', '[tea] ');

console.log('Program booted');
console.warn('Warnings also pick up the prefix');

process.on('exit', () => logfile.end());
```

`LogToFile` opens (or creates) a file in append-only mode, rewires
`console.log/info/warn/error` so every call is prefixed, and hands you back a
`WriteStream`. Nothing else in your program needs to change.

## Mirroring logs to stderr (fan-out targets)

When you want live log output without sacrificing the log file, wrap the logging
options with `createMultiWriterLogOptions`:

```ts
import { LogToFile, createMultiWriterLogOptions } from '@bubbletea/tea';

const fanOut = createMultiWriterLogOptions([process.stderr]);
const logfile = LogToFile('debug.log', '[tea] ', fanOut);

console.log('This line hits both debug.log and stderr');
```

Fan-out targets stay open for their entire lifetime—passing `process.stderr` is
safe because Bubble Tea never closes externals. The helper also normalizes CRLF
for the mirrored targets on Windows while keeping the log file LF-only.

## Windows guarantees

1. The renderer and logger both detect `process.platform === 'win32'` and
   normalize `\n` → `\r\n` when writing to consoles or fan-out targets. This is
   true for full frames, partial frame diffs, and `bubbletea/print-line`
   messages.
2. `LogToFile` always writes LF so Git-friendly log history stays unchanged on
   Windows.
3. `createMultiWriterLogOptions` never closes external streams and mirrors data
   *after* the log file flushes, preserving Go’s ordering guarantees.
4. Existing CRLF sequences you log are preserved; the adapter rewrites only lone
   `\n` characters.

## Example

See `examples-ts/logging/windows-mirror.ts` for a runnable script that enables
stderr mirroring and prints the observed newline sequences on Windows. Run it
with any TypeScript runner, for example:

```
pnpm dlx tsx examples-ts/logging/windows-mirror.ts
```
