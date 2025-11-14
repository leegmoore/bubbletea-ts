import { describe, expect, it } from 'vitest';

import { NilRenderer } from '@bubbletea/tea';

describe('NilRenderer (nil_renderer_test.go parity)', () => {
  it('no-ops for every renderer control surface', () => {
    const renderer = new NilRenderer();

    renderer.start();
    renderer.stop();
    renderer.kill();
    renderer.write('a');
    renderer.repaint();

    renderer.enterAltScreen();
    expect(renderer.altScreen()).toBe(false);
    renderer.exitAltScreen();

    renderer.clearScreen();
    renderer.showCursor();
    renderer.hideCursor();

    renderer.enableMouseCellMotion();
    renderer.disableMouseCellMotion();
    renderer.enableMouseAllMotion();
    renderer.disableMouseAllMotion();
    renderer.enableMouseSGRMode();
    renderer.disableMouseSGRMode();

    renderer.enableBracketedPaste();
    renderer.disableBracketedPaste();
    expect(renderer.bracketedPasteActive()).toBe(false);

    renderer.enableReportFocus();
    renderer.disableReportFocus();
    expect(renderer.reportFocus()).toBe(false);

    renderer.setWindowTitle('noop');
    renderer.resetLinesRendered();
  });
});
