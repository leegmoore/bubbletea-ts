import { describe, expect, it, vi } from 'vitest';

import { createWindowsRendererHarness } from '../utils/windows-terminal';

const mockWindowsPlatform = () => vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');

describe('StandardRenderer (Windows parity)', () => {
  it('replays cursor visibility when toggling alt screen', () => {
    const spy = mockWindowsPlatform();
    const { renderer, terminal } = createWindowsRendererHarness();

    try {
      renderer.hideCursor();
      terminal.consume();

      renderer.enterAltScreen();
      const enter = terminal.consume();
      expect(enter).toContain('\x1b[?1049h');
      expect(enter).toContain('\x1b[?25l');

      renderer.exitAltScreen();
      const exit = terminal.consume();
      expect(exit).toContain('\x1b[?1049l');

      renderer.showCursor();
      terminal.consume();

      renderer.enterAltScreen();
      const show = terminal.consume();
      expect(show).toContain('\x1b[?25h');
    } finally {
      spy.mockRestore();
    }
  });

  it('flushes queued print lines using CRLF order', () => {
    const spy = mockWindowsPlatform();
    const { renderer, terminal } = createWindowsRendererHarness();

    try {
      renderer.handleMessage?.({ type: 'bubbletea/print-line', body: 'alpha\nbeta' });
      renderer.write('view-line');
      renderer.flush();

      const output = terminal.consume();
      expect(output).toContain('alpha\r\nbeta\r\n');
      expect(output.includes('alpha\nbeta\n')).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('normalizes partial frame updates to CRLF when unchanged lines are skipped', () => {
    const spy = mockWindowsPlatform();
    const { renderer, terminal } = createWindowsRendererHarness();

    try {
      renderer.write('alpha\nbeta');
      renderer.flush();
      terminal.consume();

      renderer.write('alpha\ngamma');
      renderer.flush();

      const output = terminal.consume();
      expect(output.includes('\x1b[1A\n\r')).toBe(false);
      expect(output.includes('\x1b[1A\r\n')).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('emits mouse, paste, and focus toggle sequences', () => {
    const spy = mockWindowsPlatform();
    const { renderer, terminal } = createWindowsRendererHarness();

    try {
      renderer.enableBracketedPaste();
      renderer.enableReportFocus();
      renderer.enableMouseCellMotion();
      renderer.enableMouseAllMotion();
      renderer.enableMouseSGRMode();
      const enableSeq = terminal.consume();
      expect(enableSeq).toContain('\x1b[?2004h');
      expect(enableSeq).toContain('\x1b[?1004h');
      expect(enableSeq).toContain('\x1b[?1002h');
      expect(enableSeq).toContain('\x1b[?1003h');
      expect(enableSeq).toContain('\x1b[?1006h');

      renderer.disableMouseSGRMode();
      renderer.disableMouseAllMotion();
      renderer.disableMouseCellMotion();
      renderer.disableReportFocus();
      renderer.disableBracketedPaste();
      const disableSeq = terminal.consume();
      expect(disableSeq).toContain('\x1b[?2004l');
      expect(disableSeq).toContain('\x1b[?1004l');
      expect(disableSeq).toContain('\x1b[?1002l');
      expect(disableSeq).toContain('\x1b[?1003l');
      expect(disableSeq).toContain('\x1b[?1006l');
    } finally {
      spy.mockRestore();
    }
  });
});
