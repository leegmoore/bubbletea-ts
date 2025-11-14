import { once } from 'node:events';
import { PassThrough } from 'node:stream';

import { LogToFile, createMultiWriterLogOptions } from '@bubbletea/tea';

async function main(): Promise<void> {
  const transcript = new PassThrough();
  transcript.setEncoding('utf8');

  let mirrored = '';
  transcript.on('data', (chunk) => {
    mirrored += chunk;
  });

  // Fan out to stderr (so you can watch logs live) plus an in-memory buffer.
  const fanOut = createMultiWriterLogOptions([process.stderr, transcript]);
  const logfile = LogToFile('debug.log', '[ts example] ', fanOut);

  console.log('first log line');
  console.log('second log line');

  logfile.end();
  await once(logfile, 'close');

  process.stdout.write(
    `Mirrored transcript on ${process.platform}: ${JSON.stringify(mirrored)}\n`
  );
  process.stdout.write('Inspect debug.log to confirm it stayed LF-only.\n');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
