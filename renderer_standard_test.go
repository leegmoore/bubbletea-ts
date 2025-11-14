package tea

import (
	"bytes"
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"
)

func newStdRendererForTest(t *testing.T) (*standardRenderer, *bytes.Buffer) {
	t.Helper()

	buf := &bytes.Buffer{}
	r := newRenderer(buf, false, defaultFPS)
	std, ok := r.(*standardRenderer)
	if !ok {
		t.Fatalf("newRenderer returned %T, want *standardRenderer", r)
	}
	return std, buf
}

func TestStandardRendererFlushAvoidsDuplicateFrames(t *testing.T) {
	r, out := newStdRendererForTest(t)

	r.write("first frame")
	r.flush()
	first := out.String()
	if first == "" {
		t.Fatalf("flush should write initial frame")
	}
	if !strings.Contains(first, "first frame") {
		t.Fatalf("got %q, want first frame content", first)
	}

	out.Reset()
	r.write("first frame")
	r.flush()
	if out.Len() != 0 {
		t.Fatalf("expected identical frame to be skipped, got %q", out.String())
	}

	out.Reset()
	r.write("second frame")
	r.flush()
	if !strings.Contains(out.String(), "second frame") {
		t.Fatalf("flush should render new content")
	}
}

func TestStandardRendererFlushQueuedMessages(t *testing.T) {
	r, out := newStdRendererForTest(t)

	r.handleMessages(printLineMessage{messageBody: "queued-one\nqueued-two"})
	r.write("view-line")
	r.flush()

	got := out.String()
	if !strings.HasPrefix(got, "queued-one\r\nqueued-two\r\n") {
		t.Fatalf("queued lines should flush before frame, got %q", got)
	}
	if !strings.Contains(got, "view-line") {
		t.Fatalf("expected rendered view after queued lines, got %q", got)
	}

	out.Reset()
	r.write("view-line")
	r.flush()
	if strings.Contains(out.String(), "queued") {
		t.Fatalf("queued messages should be cleared after flush")
	}
}

func TestStandardRendererQueuedMessagesIgnoredInAltScreen(t *testing.T) {
	r, out := newStdRendererForTest(t)

	r.enterAltScreen()
	out.Reset()

	r.handleMessages(printLineMessage{messageBody: "hidden"})
	r.write("frame")
	r.flush()

	if strings.Contains(out.String(), "hidden") {
		t.Fatalf("printLineMessage should be ignored while alt screen is active")
	}
}

func TestStandardRendererWindowSizeTriggersRepaint(t *testing.T) {
	r, out := newStdRendererForTest(t)

	const content = "repaint me now"
	r.write(content)
	r.flush()
	out.Reset()

	r.write(content)
	r.flush()
	if out.Len() != 0 {
		t.Fatalf("identical frame should be cached when no repaint is requested")
	}

	r.handleMessages(WindowSizeMsg{Width: 4, Height: 2})

	r.write(content)
	r.flush()

	got := out.String()
	if got == "" {
		t.Fatalf("window size change should force a repaint")
	}
	if !strings.Contains(got, "repa") {
		t.Fatalf("expected truncated output for width, got %q", got)
	}
	if strings.Contains(got, "repa") && strings.Contains(got, "repai") {
		t.Fatalf("output should be truncated to width 4, got %q", got)
	}
}

func TestStandardRendererAltScreenSequences(t *testing.T) {
	r, out := newStdRendererForTest(t)

	r.enterAltScreen()
	enter := out.String()
	if !strings.Contains(enter, ansi.SetAltScreenSaveCursorMode) {
		t.Fatalf("missing alt screen enable sequence in %q", enter)
	}
	if !strings.Contains(enter, ansi.EraseEntireScreen) {
		t.Fatalf("missing clear screen sequence in %q", enter)
	}
	if !strings.Contains(enter, ansi.CursorHomePosition) {
		t.Fatalf("missing cursor home sequence in %q", enter)
	}

	out.Reset()
	r.enterAltScreen()
	if out.Len() != 0 {
		t.Fatalf("enterAltScreen should be idempotent, got %q", out.String())
	}

	r.exitAltScreen()
	exitSeq := out.String()
	if !strings.Contains(exitSeq, ansi.ResetAltScreenSaveCursorMode) {
		t.Fatalf("missing alt screen reset sequence in %q", exitSeq)
	}

	out.Reset()
	r.exitAltScreen()
	if out.Len() != 0 {
		t.Fatalf("exitAltScreen should be idempotent, got %q", out.String())
	}
}

func TestStandardRendererSetIgnoredLinesSkipsRendering(t *testing.T) {
	r, out := newStdRendererForTest(t)

	r.write("line0\nline1\nline2")
	r.flush()
	out.Reset()

	r.setIgnoredLines(1, 3)

	seq := out.String()
	if strings.Count(seq, ansi.EraseEntireLine) != 2 {
		t.Fatalf("expected erase sequences for ignored lines, got %q", seq)
	}
	if strings.Count(seq, ansi.CUU1) != r.lastLinesRendered() {
		t.Fatalf("cursor should move up for each rendered line, got %q", seq)
	}
	if !strings.Contains(seq, ansi.CursorPosition(0, r.lastLinesRendered())) {
		t.Fatalf("should restore cursor position, got %q", seq)
	}

	out.Reset()
	r.write("line0-new\nline1-new\nline2-new")
	r.flush()
	got := out.String()
	if strings.Contains(got, "line1-new") || strings.Contains(got, "line2-new") {
		t.Fatalf("ignored lines should be skipped during flush, got %q", got)
	}
	if !strings.Contains(got, "line0-new") {
		t.Fatalf("non-ignored lines should still render, got %q", got)
	}

	r.clearIgnoredLines()
	out.Reset()
	r.write("line0-final\nline1-final\nline2-final")
	r.flush()
	got = out.String()
	if !strings.Contains(got, "line1-final") {
		t.Fatalf("clearing ignored lines should resume rendering, got %q", got)
	}
}

func TestStandardRendererSyncScrollArea(t *testing.T) {
	r, out := newStdRendererForTest(t)

	r.handleMessages(WindowSizeMsg{Width: 80, Height: 24})
	r.write("one\ntwo\nthree")
	r.flush()
	out.Reset()

	cmd := SyncScrollArea([]string{"alpha", "beta"}, 3, 6)
	if cmd == nil {
		t.Fatalf("SyncScrollArea returned nil cmd")
	}
	if msg := cmd(); msg != nil {
		r.handleMessages(msg)
	}

	got := out.String()
	if !strings.Contains(got, ansi.SetTopBottomMargins(3, 6)) {
		t.Fatalf("expected scroll margins in output, got %q", got)
	}
	if !strings.Contains(got, ansi.CursorPosition(0, 3)) {
		t.Fatalf("expected cursor positioned at top boundary, got %q", got)
	}
	if !strings.Contains(got, ansi.InsertLine(2)) {
		t.Fatalf("expected insert line sequence, got %q", got)
	}
	if !strings.Contains(got, "alpha\r\nbeta") {
		t.Fatalf("expected inserted lines, got %q", got)
	}
	if !strings.Contains(got, ansi.SetTopBottomMargins(0, 24)) {
		t.Fatalf("expected margins to reset to window height, got %q", got)
	}
	if r.ignoreLines == nil {
		t.Fatalf("ignored lines should be initialized")
	}
	for i := 3; i < 6; i++ {
		if _, ok := r.ignoreLines[i]; !ok {
			t.Fatalf("line %d should be ignored", i)
		}
	}

	r.handleMessages(ClearScrollArea())
	if r.ignoreLines != nil {
		t.Fatalf("clear scroll area should reset ignored lines")
	}
}

func TestStandardRendererScrollCommands(t *testing.T) {
	r, out := newStdRendererForTest(t)

	r.handleMessages(WindowSizeMsg{Width: 100, Height: 20})
	r.write("a\nb\nc\nd")
	r.flush()
	out.Reset()

	scrollUp := ScrollUp([]string{"top-1", "top-2"}, 2, 6)
	if scrollUp == nil {
		t.Fatalf("ScrollUp returned nil cmd")
	}
	if msg := scrollUp(); msg != nil {
		r.handleMessages(msg)
	}
	upOut := out.String()
	if !strings.Contains(upOut, ansi.SetTopBottomMargins(2, 6)) {
		t.Fatalf("scroll up should set margins, got %q", upOut)
	}
	if !strings.Contains(upOut, ansi.CursorPosition(0, 2)) {
		t.Fatalf("scroll up should move cursor to top boundary, got %q", upOut)
	}
	if !strings.Contains(upOut, ansi.InsertLine(2)) {
		t.Fatalf("scroll up should insert lines, got %q", upOut)
	}
	if !strings.Contains(upOut, "top-1\r\ntop-2") {
		t.Fatalf("scroll up should write new lines, got %q", upOut)
	}

	out.Reset()
	scrollDown := ScrollDown([]string{"bottom"}, 2, 6)
	if scrollDown == nil {
		t.Fatalf("ScrollDown returned nil cmd")
	}
	if msg := scrollDown(); msg != nil {
		r.handleMessages(msg)
	}
	downOut := out.String()
	if !strings.Contains(downOut, ansi.CursorPosition(0, 6)) {
		t.Fatalf("scroll down should move cursor to bottom boundary, got %q", downOut)
	}
	if !strings.Contains(downOut, "\r\nbottom") {
		t.Fatalf("scroll down should append lines, got %q", downOut)
	}
	if !strings.Contains(downOut, ansi.SetTopBottomMargins(0, 20)) {
		t.Fatalf("scroll down should reset margins, got %q", downOut)
	}
}
