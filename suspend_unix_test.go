//go:build darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris || aix || zos
// +build darwin dragonfly freebsd linux netbsd openbsd solaris aix zos

package tea

import (
	"bytes"
	"io"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/creack/pty"
)

func newSuspendTestProgram(t *testing.T) *Program {
	t.Helper()

	var input bytes.Buffer
	p := NewProgram(nil, WithInput(&input), WithOutput(io.Discard), WithoutRenderer())
	p.msgs = make(chan Msg, 8)
	p.readLoopDone = make(chan struct{})
	close(p.readLoopDone)
	p.renderer = newSuspendTestRenderer()
	return p
}

func cleanupSuspendTestProgram(t *testing.T, p *Program) {
	t.Helper()

	if p.cancel != nil {
		p.cancel()
	}
	if p.cancelReader != nil {
		p.cancelReader.Cancel()
	}
	if p.readLoopDone != nil {
		p.waitForReadLoop()
	}
}

func waitWithTimeout(t *testing.T, wg *sync.WaitGroup, timeout time.Duration) {
	t.Helper()

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(timeout):
		t.Fatalf("operation timed out")
	}
}

type suspendTestRenderer struct {
	startCount     uint32
	stopCount      uint32
	altScreenState bool
	bracketedPaste bool
	focusReporting bool
}

func newSuspendTestRenderer() *suspendTestRenderer {
	return &suspendTestRenderer{
		altScreenState: true,
		bracketedPaste: true,
		focusReporting: true,
	}
}

func (r *suspendTestRenderer) start() {
	atomic.AddUint32(&r.startCount, 1)
}

func (r *suspendTestRenderer) stop() {
	atomic.AddUint32(&r.stopCount, 1)
}

func (r *suspendTestRenderer) kill() {}

func (r *suspendTestRenderer) write(string) {}

func (r *suspendTestRenderer) repaint() {}

func (r *suspendTestRenderer) clearScreen() {}

func (r *suspendTestRenderer) altScreen() bool {
	return r.altScreenState
}

func (r *suspendTestRenderer) enterAltScreen() {
	r.altScreenState = true
}

func (r *suspendTestRenderer) exitAltScreen() {
	r.altScreenState = false
}

func (r *suspendTestRenderer) showCursor() {}

func (r *suspendTestRenderer) hideCursor() {}

func (r *suspendTestRenderer) enableMouseCellMotion() {}

func (r *suspendTestRenderer) disableMouseCellMotion() {}

func (r *suspendTestRenderer) enableMouseAllMotion() {}

func (r *suspendTestRenderer) disableMouseAllMotion() {}

func (r *suspendTestRenderer) enableMouseSGRMode() {}

func (r *suspendTestRenderer) disableMouseSGRMode() {}

func (r *suspendTestRenderer) enableBracketedPaste() {
	r.bracketedPaste = true
}

func (r *suspendTestRenderer) disableBracketedPaste() {
	r.bracketedPaste = false
}

func (r *suspendTestRenderer) bracketedPasteActive() bool {
	return r.bracketedPaste
}

func (r *suspendTestRenderer) setWindowTitle(string) {}

func (r *suspendTestRenderer) reportFocus() bool {
	return r.focusReporting
}

func (r *suspendTestRenderer) enableReportFocus() {
	r.focusReporting = true
}

func (r *suspendTestRenderer) disableReportFocus() {
	r.focusReporting = false
}

func (r *suspendTestRenderer) resetLinesRendered() {}

func (r *suspendTestRenderer) startCalls() uint32 {
	return atomic.LoadUint32(&r.startCount)
}

func (r *suspendTestRenderer) stopCalls() uint32 {
	return atomic.LoadUint32(&r.stopCount)
}

func getSuspendTestRenderer(t *testing.T, p *Program) *suspendTestRenderer {
	t.Helper()

	renderer, ok := p.renderer.(*suspendTestRenderer)
	if !ok {
		t.Fatalf("expected suspend test renderer, got %T", p.renderer)
	}
	return renderer
}

func waitForAtomicValue(t *testing.T, ptr *uint32, want uint32, timeout time.Duration, field string) {
	t.Helper()

	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if atomic.LoadUint32(ptr) == want {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}

	t.Fatalf("expected %s to reach %d within %s; last value %d", field, want, timeout, atomic.LoadUint32(ptr))
}

func waitForWindowSizeMsgIgnoringOthers(t *testing.T, msgs <-chan Msg, timeout time.Duration) WindowSizeMsg {
	t.Helper()

	timer := time.NewTimer(timeout)
	defer timer.Stop()

	for {
		select {
		case msg := <-msgs:
			ws, ok := msg.(WindowSizeMsg)
			if ok {
				return ws
			}
		case <-timer.C:
			t.Fatalf("timed out waiting for WindowSizeMsg")
		}
	}
}

func TestProgramSuspendReleasesTerminalPausesSignalsAndEmitsResumeMsg(t *testing.T) {
	p := newSuspendTestProgram(t)
	t.Cleanup(func() { cleanupSuspendTestProgram(t, p) })
	renderer := getSuspendTestRenderer(t, p)

	started := make(chan struct{})
	resume := make(chan struct{})
	original := suspendProcess
	suspendProcess = func() {
		close(started)
		<-resume
	}
	t.Cleanup(func() { suspendProcess = original })

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		p.suspend()
		wg.Done()
	}()

	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatalf("suspendProcess was not invoked")
	}

	if got := renderer.stopCalls(); got != 1 {
		t.Fatalf("renderer.stop should be invoked once before suspending, got %d", got)
	}

	if got := renderer.startCalls(); got != 0 {
		t.Fatalf("renderer.start should not run before resume, got %d", got)
	}

	if !p.altScreenWasActive {
		t.Fatalf("altscreen state should be captured while releasing the terminal")
	}

	if !p.bpWasActive {
		t.Fatalf("bracketed paste state should be captured while releasing the terminal")
	}

	if !p.reportFocus {
		t.Fatalf("focus reporting state should be captured while releasing the terminal")
	}

	if got := atomic.LoadUint32(&p.ignoreSignals); got == 0 {
		t.Fatalf("ignoreSignals should be set while suspended")
	}

	select {
	case msg := <-p.msgs:
		t.Fatalf("unexpected message before resume: %T", msg)
	default:
	}

	close(resume)
	waitWithTimeout(t, &wg, time.Second)

	if got := renderer.stopCalls(); got != 1 {
		t.Fatalf("renderer.stop should only run once for the cycle, got %d", got)
	}

	waitForAtomicValue(t, &renderer.startCount, 1, time.Second, "renderer.start")

	if got := atomic.LoadUint32(&p.ignoreSignals); got != 0 {
		t.Fatalf("ignoreSignals should be cleared after resuming")
	}

	select {
	case msg := <-p.msgs:
		if _, ok := msg.(ResumeMsg); !ok {
			t.Fatalf("expected ResumeMsg, got %T", msg)
		}
	case <-time.After(time.Second):
		t.Fatalf("ResumeMsg was not emitted after suspend")
	}
}

func TestProgramSuspendEmitsResumeMsgPerCycle(t *testing.T) {
	p := newSuspendTestProgram(t)
	t.Cleanup(func() { cleanupSuspendTestProgram(t, p) })
	renderer := getSuspendTestRenderer(t, p)

	original := suspendProcess
	blockers := make(chan chan struct{}, 2)
	suspendProcess = func() {
		ch := make(chan struct{})
		blockers <- ch
		<-ch
	}
	t.Cleanup(func() { suspendProcess = original })

	for i := 1; i <= 2; i++ {
		var wg sync.WaitGroup
		wg.Add(1)
		go func() {
			p.suspend()
			wg.Done()
		}()

		var unblock chan struct{}
		select {
		case unblock = <-blockers:
		case <-time.After(time.Second):
			t.Fatalf("suspend cycle %d did not invoke suspendProcess", i)
		}

		if got := renderer.stopCalls(); got != uint32(i) {
			t.Fatalf("renderer.stop should be invoked in cycle %d: got %d", i, got)
		}

		if got := atomic.LoadUint32(&p.ignoreSignals); got == 0 {
			t.Fatalf("ignoreSignals should be set during suspend cycle %d", i)
		}

		close(unblock)
		waitWithTimeout(t, &wg, time.Second)

		if got := atomic.LoadUint32(&p.ignoreSignals); got != 0 {
			t.Fatalf("ignoreSignals should be cleared after suspend cycle %d", i)
		}

		waitForAtomicValue(t, &renderer.startCount, uint32(i), time.Second, "renderer.start")

		if got := renderer.stopCalls(); got != uint32(i) {
			t.Fatalf("renderer.stop should not change after resuming cycle %d: got %d", i, got)
		}

		select {
		case msg := <-p.msgs:
			if _, ok := msg.(ResumeMsg); !ok {
				t.Fatalf("expected ResumeMsg after cycle %d, got %T", i, msg)
			}
		case <-time.After(time.Second):
			t.Fatalf("ResumeMsg #%d was not emitted", i)
		}
	}
}

func TestProgramSuspendRefreshesWindowSizeAfterResume(t *testing.T) {
	master, slave, err := pty.Open()
	if err != nil {
		t.Fatalf("pty.Open() failed: %v", err)
	}
	t.Cleanup(func() {
		_ = master.Close()
		_ = slave.Close()
	})

	p := newSuspendTestProgram(t)
	t.Cleanup(func() { cleanupSuspendTestProgram(t, p) })
	p.output = slave
	p.ttyOutput = slave

	setSize := func(width, height int) {
		ws := &pty.Winsize{Cols: uint16(width), Rows: uint16(height)}
		if err := pty.Setsize(master, ws); err != nil {
			t.Fatalf("pty.Setsize() failed: %v", err)
		}
	}

	setSize(80, 24)

	started := make(chan struct{})
	resume := make(chan struct{})
	original := suspendProcess
	suspendProcess = func() {
		close(started)
		<-resume
	}
	t.Cleanup(func() { suspendProcess = original })

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		p.suspend()
		wg.Done()
	}()

	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatalf("suspendProcess was not invoked")
	}

	setSize(132, 41)

	close(resume)
	waitWithTimeout(t, &wg, time.Second)

	msg := waitForWindowSizeMsgIgnoringOthers(t, p.msgs, time.Second)
	if msg.Width != 132 || msg.Height != 41 {
		t.Fatalf("window size after resume = (%d, %d), want (132, 41)", msg.Width, msg.Height)
	}
}
