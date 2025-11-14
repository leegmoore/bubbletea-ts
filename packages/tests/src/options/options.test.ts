import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import {
  InputType,
  NewProgram,
  NilRenderer,
  StartupFlag,
  WithAltScreen,
  WithANSICompressor,
  WithContext,
  WithFilter,
  WithInput,
  WithInputTTY,
  WithMouseAllMotion,
  WithMouseCellMotion,
  WithOutput,
  WithoutBracketedPaste,
  WithoutCatchPanics,
  WithoutRenderer,
  WithoutSignalHandler,
  WithoutSignals
} from '@bubbletea/tea';

type OptionFactory = ReturnType<typeof WithInputTTY>;

describe('Program options', () => {
  const makeProgram = (...opts: OptionFactory[]) => NewProgram(null, ...opts);

  it('WithOutput replaces the default output writer', () => {
    const customOutput = new PassThrough();
    const program = makeProgram(WithOutput(customOutput));
    expect(program.output).toBe(customOutput);
  });

  it('WithInput replaces the default input reader and sets custom input mode', () => {
    const customInput = new PassThrough();
    const program = makeProgram(WithInput(customInput));
    expect(program.input).toBe(customInput);
    expect(program.inputType).toBe(InputType.Custom);
  });

  it('WithoutRenderer swaps in the nil renderer', () => {
    const program = makeProgram(WithoutRenderer());
    expect(program.renderer).toBeInstanceOf(NilRenderer);
  });

  it('WithoutSignals flips the ignoreSignals flag', () => {
    const program = makeProgram(WithoutSignals());
    expect(program.ignoreSignals).toBe(true);
  });

  it('WithFilter installs a filter function', () => {
    const filter = vi.fn((_, msg: unknown) => msg);
    const program = makeProgram(WithFilter(filter));
    expect(program.filter).toBe(filter);
  });

  it('WithContext stores the external context reference', () => {
    const controller = new AbortController();
    const program = makeProgram(WithContext(controller));
    expect(program.externalContext).toBe(controller);
  });

  describe('input options', () => {
    const expectInputType = (option: OptionFactory, expected: InputType) => {
      const program = makeProgram(option);
      expect(program.inputType).toBe(expected);
    };

    it('sets tty mode when WithInputTTY is provided', () => {
      expectInputType(WithInputTTY(), InputType.Tty);
    });

    it('sets custom mode when WithInput is provided', () => {
      expectInputType(WithInput(new PassThrough()), InputType.Custom);
    });
  });

  describe('startup options', () => {
    const expectFlag = (option: OptionFactory, flag: StartupFlag) => {
      const program = makeProgram(option);
      expect(program.startupOptions.has(flag)).toBe(true);
    };

    it('enables alt screen', () => {
      expectFlag(WithAltScreen(), StartupFlag.AltScreen);
    });

    it('disables bracketed paste at startup', () => {
      expectFlag(WithoutBracketedPaste(), StartupFlag.WithoutBracketedPaste);
    });

    it('enables ANSI compressor', () => {
      expectFlag(WithANSICompressor(), StartupFlag.ANSICompressor);
    });

    it('disables panic catching', () => {
      expectFlag(WithoutCatchPanics(), StartupFlag.WithoutCatchPanics);
    });

    it('disables the default signal handler', () => {
      expectFlag(WithoutSignalHandler(), StartupFlag.WithoutSignalHandler);
    });

    it('handles mouse cell motion precedence correctly', () => {
      const program = makeProgram(WithMouseAllMotion(), WithMouseCellMotion());
      expect(program.startupOptions.has(StartupFlag.MouseCellMotion)).toBe(true);
      expect(program.startupOptions.has(StartupFlag.MouseAllMotion)).toBe(false);
    });

    it('handles mouse all motion precedence correctly', () => {
      const program = makeProgram(WithMouseCellMotion(), WithMouseAllMotion());
      expect(program.startupOptions.has(StartupFlag.MouseAllMotion)).toBe(true);
      expect(program.startupOptions.has(StartupFlag.MouseCellMotion)).toBe(false);
    });
  });

  it('can combine multiple options', () => {
    const program = makeProgram(
      WithMouseAllMotion(),
      WithoutBracketedPaste(),
      WithAltScreen(),
      WithInputTTY()
    );

    expect(program.startupOptions.has(StartupFlag.MouseAllMotion)).toBe(true);
    expect(program.startupOptions.has(StartupFlag.WithoutBracketedPaste)).toBe(true);
    expect(program.startupOptions.has(StartupFlag.AltScreen)).toBe(true);
    expect(program.inputType).toBe(InputType.Tty);
  });
});
