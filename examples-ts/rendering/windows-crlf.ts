import { PassThrough } from 'node:stream';

import { NewProgram, Renderer, WithOutput } from '@bubbletea/tea';

type RendererHarness = Renderer & { flush(): void };

const transcript = new PassThrough();
transcript.setEncoding('utf8');

let buffer = '';
transcript.on('data', (chunk) => {
  buffer += chunk;
});

const consume = (): string => {
  const next = buffer;
  buffer = '';
  return next;
};

const program = NewProgram(null, WithOutput(transcript));
const renderer = program.renderer as RendererHarness;

renderer.start();
renderer.write('alpha\nbeta');
renderer.flush();
const first = consume();

renderer.write('alpha\ngamma');
renderer.flush();
const second = consume();

renderer.handleMessage?.({ type: 'bubbletea/print-line', body: 'print-line demo' });
renderer.flush();
const printed = consume();

renderer.stop();

process.stdout.write(`First frame (${process.platform}): ${JSON.stringify(first)}\n`);
process.stdout.write(`Diff frame: ${JSON.stringify(second)}\n`);
process.stdout.write(`print-line payload: ${JSON.stringify(printed)}\n`);
