//go:build !windows
// +build !windows

package tea

import (
	"sync/atomic"
	"syscall"
	"testing"
	"time"
)

func newSignalTestProgram(t *testing.T) *Program {
	t.Helper()
	p := NewProgram(nil, WithoutRenderer())
	p.msgs = make(chan Msg, 1)
	t.Cleanup(func() {
		p.cancel()
	})
	return p
}

func waitForSignalHandlerReady() {
	time.Sleep(10 * time.Millisecond)
}

func waitForSignalHandler(t *testing.T, done chan struct{}) {
	t.Helper()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatalf("signal handler did not terminate in time")
	}
}

func sendSignal(t *testing.T, sig syscall.Signal) {
	t.Helper()
	if err := syscall.Kill(syscall.Getpid(), sig); err != nil {
		t.Fatalf("syscall.Kill failed: %v", err)
	}
}

func TestHandleSignalsDeliversInterruptAndQuit(t *testing.T) {
	p := newSignalTestProgram(t)

	// First run: expect InterruptMsg on SIGINT.
	done := p.handleSignals()
	waitForSignalHandlerReady()
	sendSignal(t, syscall.SIGINT)

	select {
	case msg := <-p.msgs:
		if _, ok := msg.(InterruptMsg); !ok {
			t.Fatalf("expected InterruptMsg, got %T", msg)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for InterruptMsg")
	}
	waitForSignalHandler(t, done)

	// Second run: expect QuitMsg on SIGTERM.
	done = p.handleSignals()
	waitForSignalHandlerReady()
	sendSignal(t, syscall.SIGTERM)

	select {
	case msg := <-p.msgs:
		if _, ok := msg.(QuitMsg); !ok {
			t.Fatalf("expected QuitMsg, got %T", msg)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for QuitMsg")
	}
	waitForSignalHandler(t, done)
}

func TestHandleSignalsHonorsIgnoreSignals(t *testing.T) {
	p := newSignalTestProgram(t)
	atomic.StoreUint32(&p.ignoreSignals, 1)

	done := p.handleSignals()
	waitForSignalHandlerReady()
	sendSignal(t, syscall.SIGINT)

	select {
	case msg := <-p.msgs:
		t.Fatalf("expected no message while signals ignored, got %T", msg)
	case <-time.After(100 * time.Millisecond):
	}

	p.cancel()
	waitForSignalHandler(t, done)
}
