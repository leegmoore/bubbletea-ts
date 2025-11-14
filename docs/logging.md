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
safe because Bubble Tea never closes externals.
