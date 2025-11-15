//go:build darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris || aix || zos
// +build darwin dragonfly freebsd linux netbsd openbsd solaris aix zos

package tea

import (
	"context"
	"os"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"github.com/creack/pty"
)

type resizeTestHarness struct {
	t       *testing.T
	program *Program
	master  *os.File
	slave   *os.File
}

func newResizeTestHarness(t *testing.T) *resizeTestHarness {
	t.Helper()

	master, slave, err := pty.Open()
	if err != nil {
		t.Fatalf("pty.Open() failed: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	p := &Program{
		ctx:       ctx,
		cancel:    cancel,
		msgs:      make(chan Msg, 8),
		errs:      make(chan error, 1),
		ttyOutput: slave,
	}

	return &resizeTestHarness{
		t:       t,
		program: p,
		master:  master,
		slave:   slave,
	}
}

func (h *resizeTestHarness) close() {
	_ = h.master.Close()
	_ = h.slave.Close()
}

func (h *resizeTestHarness) setSize(width, height int) {
	h.t.Helper()

	ws := &pty.Winsize{
		Cols: uint16(width),
		Rows: uint16(height),
	}
	if err := pty.Setsize(h.master, ws); err != nil {
		h.t.Fatalf("pty.Setsize() failed: %v", err)
	}
}

func waitForWindowSizeMsg(t *testing.T, msgs <-chan Msg, timeout time.Duration) WindowSizeMsg {
	t.Helper()

	timer := time.NewTimer(timeout)
	defer timer.Stop()

	select {
	case msg := <-msgs:
		ws, ok := msg.(WindowSizeMsg)
		if !ok {
			t.Fatalf("expected WindowSizeMsg, got %T", msg)
		}
		return ws
	case <-timer.C:
		t.Fatalf("timed out waiting for WindowSizeMsg")
		return WindowSizeMsg{}
	}
}

func expectNoWindowSizeMsg(t *testing.T, msgs <-chan Msg, timeout time.Duration) {
	t.Helper()

	timer := time.NewTimer(timeout)
	defer timer.Stop()

	select {
	case msg := <-msgs:
		t.Fatalf("expected no WindowSizeMsg, got %T", msg)
	case <-timer.C:
	}
}

func waitForHandler(t *testing.T, done <-chan struct{}) {
	t.Helper()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatalf("resize handler did not stop in time")
	}
}

func sendSigwinch(t *testing.T) {
	t.Helper()
	if err := syscall.Kill(syscall.Getpid(), syscall.SIGWINCH); err != nil {
		t.Fatalf("syscall.Kill failed: %v", err)
	}
}

func TestHandleResizeEmitsInitialWindowSize(t *testing.T) {
	h := newResizeTestHarness(t)
	defer h.close()

	h.setSize(88, 33)
	done := h.program.handleResize()
	defer func() {
		h.program.cancel()
		waitForHandler(t, done)
	}()

	msg := waitForWindowSizeMsg(t, h.program.msgs, time.Second)
	if msg.Width != 88 || msg.Height != 33 {
		t.Fatalf("initial window size = (%d, %d), want (88, 33)", msg.Width, msg.Height)
	}
}

func TestListenForResizePropagatesSizeChanges(t *testing.T) {
	h := newResizeTestHarness(t)
	defer h.close()

	h.setSize(90, 40)
	done := h.program.handleResize()
	defer func() {
		h.program.cancel()
		waitForHandler(t, done)
	}()

	_ = waitForWindowSizeMsg(t, h.program.msgs, time.Second)

	h.setSize(120, 55)
	sendSigwinch(t)

	msg := waitForWindowSizeMsg(t, h.program.msgs, time.Second)
	if msg.Width != 120 || msg.Height != 55 {
		t.Fatalf("resize message = (%d, %d), want (120, 55)", msg.Width, msg.Height)
	}
}

func TestHandleResizeSkipsWhenOutputIsNotTTY(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	p := &Program{
		ctx:    ctx,
		cancel: cancel,
		msgs:   make(chan Msg, 1),
	}

	done := p.handleResize()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatalf("handleResize should exit immediately when ttyOutput is nil")
	}

	select {
	case msg := <-p.msgs:
		t.Fatalf("expected no messages when ttyOutput is nil, got %T", msg)
	default:
	}
}

func TestListenForResizeHonorsIgnoreSignals(t *testing.T) {
	h := newResizeTestHarness(t)
	defer h.close()

	h.setSize(80, 24)
	done := h.program.handleResize()
	defer func() {
		h.program.cancel()
		waitForHandler(t, done)
	}()

	_ = waitForWindowSizeMsg(t, h.program.msgs, time.Second)

	h.setSize(96, 30)
	atomic.StoreUint32(&h.program.ignoreSignals, 1)
	sendSigwinch(t)
	expectNoWindowSizeMsg(t, h.program.msgs, 150*time.Millisecond)

	h.setSize(144, 50)
	atomic.StoreUint32(&h.program.ignoreSignals, 0)
	sendSigwinch(t)

	msg := waitForWindowSizeMsg(t, h.program.msgs, time.Second)
	if msg.Width != 144 || msg.Height != 50 {
		t.Fatalf("resumed window size = (%d, %d), want (144, 50)", msg.Width, msg.Height)
	}
}
