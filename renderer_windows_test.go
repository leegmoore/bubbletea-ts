//go:build windows

package tea

import (
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"
)

func TestStandardRendererWindowsAltScreenReplaysCursorVisibility(t *testing.T) {
	r, out := newStdRendererForTest(t)

	r.hideCursor()
	out.Reset()

	r.enterAltScreen()
	seq := out.String()
	if !strings.Contains(seq, ansi.SetAltScreenSaveCursorMode) {
		t.Fatalf("enterAltScreen should emit alt-screen sequence, got %q", seq)
	}
	if !strings.Contains(seq, ansi.HideCursor) {
		t.Fatalf("enterAltScreen should reapply hide cursor on Windows, got %q", seq)
	}

	out.Reset()
	r.exitAltScreen()
	exitSeq := out.String()
	if !strings.Contains(exitSeq, ansi.ResetAltScreenSaveCursorMode) {
		t.Fatalf("exitAltScreen should emit reset sequence, got %q", exitSeq)
	}

	r.showCursor()
	out.Reset()

	r.enterAltScreen()
	showSeq := out.String()
	if !strings.Contains(showSeq, ansi.ShowCursor) {
		t.Fatalf("enterAltScreen should emit show cursor when cursor visible, got %q", showSeq)
	}
}

func TestStandardRendererWindowsQueuedPrintLinesUseCRLF(t *testing.T) {
	r, out := newStdRendererForTest(t)

	r.handleMessages(printLineMessage{messageBody: "alpha\nbeta"})
	r.write("view-line")
	r.flush()

	got := out.String()
	if !strings.Contains(got, "alpha\r\nbeta\r\n") {
		t.Fatalf("queued lines should use CRLF on Windows, got %q", got)
	}
	if strings.Contains(got, "alpha\nbeta\n") {
		t.Fatalf("queued lines should not render bare LF on Windows, got %q", got)
	}
}

func TestStandardRendererWindowsInputTogglesEmitSequences(t *testing.T) {
	r, out := newStdRendererForTest(t)
	out.Reset()

	r.enableBracketedPaste()
	r.enableReportFocus()
	r.enableMouseCellMotion()
	r.enableMouseAllMotion()
	r.enableMouseSGRMode()

	enableSeq := out.String()
	for name, seq := range map[string]string{
		"bracketed paste": ansi.SetBracketedPasteMode,
		"focus":           ansi.SetFocusEventMode,
		"cell mouse":      ansi.SetButtonEventMouseMode,
		"all mouse":       ansi.SetAnyEventMouseMode,
		"sgr mouse":       ansi.SetSgrExtMouseMode,
	} {
		if !strings.Contains(enableSeq, seq) {
			t.Fatalf("missing %s enable sequence in %q", name, enableSeq)
		}
	}

	out.Reset()
	r.disableMouseSGRMode()
	r.disableMouseAllMotion()
	r.disableMouseCellMotion()
	r.disableReportFocus()
	r.disableBracketedPaste()

	disableSeq := out.String()
	for name, seq := range map[string]string{
		"bracketed paste": ansi.ResetBracketedPasteMode,
		"focus":           ansi.ResetFocusEventMode,
		"cell mouse":      ansi.ResetButtonEventMouseMode,
		"all mouse":       ansi.ResetAnyEventMouseMode,
		"sgr mouse":       ansi.ResetSgrExtMouseMode,
	} {
		if !strings.Contains(disableSeq, seq) {
			t.Fatalf("missing %s disable sequence in %q", name, disableSeq)
		}
	}
}
