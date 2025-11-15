package tea

import (
	"errors"
	"sync/atomic"
	"testing"
)

type ttyInputKind int

const (
	defaultTTYInput ttyInputKind = iota
	customTTYInput
	forcedTTYInput
)

type fakeTTYInput struct {
	isTTY        bool
	isRaw        bool
	rawModeCalls []bool
	failOn       map[bool]error
}

func newFakeTTYInput(initialRaw bool) *fakeTTYInput {
	return &fakeTTYInput{
		isTTY:  true,
		isRaw:  initialRaw,
		failOn: make(map[bool]error),
	}
}

func (f *fakeTTYInput) setRawMode(next bool) error {
	f.rawModeCalls = append(f.rawModeCalls, next)
	if err := f.failOn[next]; err != nil {
		return err
	}
	f.isRaw = next
	return nil
}

type ttyHarness struct {
	input        *fakeTTYInput
	inputKind    ttyInputKind
	rendererOn   bool
	openInputTTY func() (*fakeTTYInput, error)
	cleanup      func()
}

func newTTYHarness() *ttyHarness {
	return &ttyHarness{
		rendererOn:   true,
		inputKind:    defaultTTYInput,
		openInputTTY: func() (*fakeTTYInput, error) { return newFakeTTYInput(false), nil },
	}
}

func (h *ttyHarness) resolveInput() error {
	assign := func() error {
		tty, err := h.openInputTTY()
		if err != nil {
			return panicErr(err)
		}
		h.input = tty
		return nil
	}

	switch h.inputKind {
	case customTTYInput:
		return nil
	case forcedTTYInput:
		return assign()
	case defaultTTYInput:
		if h.input == nil {
			return assign()
		}
		if !h.input.isTTY {
			return assign()
		}
		return nil
	default:
		return nil
	}
}

func (h *ttyHarness) setupRawMode() error {
	if !h.rendererOn {
		return nil
	}
	if h.input == nil || !h.input.isTTY {
		return nil
	}
	startRaw := h.input.isRaw
	if err := h.input.setRawMode(true); err != nil {
		return panicErr(err)
	}
	h.cleanup = func() {
		_ = h.input.setRawMode(startRaw)
	}
	return nil
}

func (h *ttyHarness) restoreRawMode() {
	if h.cleanup != nil {
		h.cleanup()
		h.cleanup = nil
	}
}

func panicErr(err error) error {
	return errors.Join(ErrProgramPanic, err)
}

func TestTTYRawModeEnablesAndRestores(t *testing.T) {
	harness := newTTYHarness()
	harness.input = newFakeTTYInput(false)

	if err := harness.setupRawMode(); err != nil {
		t.Fatalf("setupRawMode() returned %v", err)
	}
	harness.restoreRawMode()

	if got, want := harness.input.rawModeCalls, []bool{true, false}; !slicesEqual(got, want) {
		t.Fatalf("raw mode calls = %v, want %v", got, want)
	}
	if harness.input.isRaw {
		t.Fatalf("raw mode should be disabled after restore")
	}
}

func TestTTYRawModeRestoresInitialState(t *testing.T) {
	harness := newTTYHarness()
	harness.input = newFakeTTYInput(true)

	if err := harness.setupRawMode(); err != nil {
		t.Fatalf("setupRawMode() returned %v", err)
	}
	harness.restoreRawMode()

	if len(harness.input.rawModeCalls) == 0 {
		t.Fatalf("expected raw-mode enable call, got none")
	}
	for _, next := range harness.input.rawModeCalls {
		if !next {
			t.Fatalf("raw mode should never be disabled, got %v", harness.input.rawModeCalls)
		}
	}
	if !harness.input.isRaw {
		t.Fatalf("raw mode should remain enabled after restore")
	}
}

func TestTTYRawModeSkipsNonTTYInputs(t *testing.T) {
	harness := newTTYHarness()
	harness.input = &fakeTTYInput{isTTY: false}

	if err := harness.setupRawMode(); err != nil {
		t.Fatalf("setupRawMode() returned %v", err)
	}
	harness.restoreRawMode()

	if len(harness.input.rawModeCalls) != 0 {
		t.Fatalf("raw mode should not toggle for non-tty inputs")
	}
}

func TestTTYRawModeSkipsWhenRendererDisabled(t *testing.T) {
	harness := newTTYHarness()
	harness.rendererOn = false
	harness.input = newFakeTTYInput(false)

	if err := harness.setupRawMode(); err != nil {
		t.Fatalf("setupRawMode() returned %v", err)
	}
	if len(harness.input.rawModeCalls) != 0 {
		t.Fatalf("raw mode should be skipped when renderer is disabled")
	}
}

func TestTTYInputFallbackOpensNewTTY(t *testing.T) {
	harness := newTTYHarness()
	harness.input = &fakeTTYInput{isTTY: false}
	opened := false
	fallback := newFakeTTYInput(false)
	harness.openInputTTY = func() (*fakeTTYInput, error) {
		opened = true
		return fallback, nil
	}

	if err := harness.resolveInput(); err != nil {
		t.Fatalf("resolveInput() returned %v", err)
	}
	if !opened {
		t.Fatalf("expected openInputTTY to be called")
	}
	if harness.input != fallback {
		t.Fatalf("program should switch to fallback tty input")
	}
}

func TestTTYInputForcedFallbackIgnoresExistingTTY(t *testing.T) {
	harness := newTTYHarness()
	harness.inputKind = forcedTTYInput
	manual := newFakeTTYInput(true)
	harness.input = manual

	fallback := newFakeTTYInput(false)
	harness.openInputTTY = func() (*fakeTTYInput, error) {
		return fallback, nil
	}

	if err := harness.resolveInput(); err != nil {
		t.Fatalf("resolveInput() returned %v", err)
	}
	if harness.input != fallback {
		t.Fatalf("WithInputTTY should replace manual input with fallback tty")
	}
	if len(manual.rawModeCalls) != 0 {
		t.Fatalf("manual input should be untouched")
	}
}

func TestTTYInputFallbackErrorsSurfaceAsProgramPanic(t *testing.T) {
	harness := newTTYHarness()
	harness.input = &fakeTTYInput{isTTY: false}
	expected := errors.New("boom")
	harness.openInputTTY = func() (*fakeTTYInput, error) {
		return nil, expected
	}

	err := harness.resolveInput()
	if !errors.Is(err, ErrProgramPanic) {
		t.Fatalf("expected ErrProgramPanic, got %v", err)
	}
	if !errors.Is(err, expected) {
		t.Fatalf("expected original error to be wrapped, got %v", err)
	}
}

func TestTTYRawModeFailuresSurfaceAsProgramPanic(t *testing.T) {
	harness := newTTYHarness()
	input := newFakeTTYInput(false)
	failure := errors.New("setRawMode failed")
	input.failOn[true] = failure
	harness.input = input

	err := harness.setupRawMode()
	if !errors.Is(err, ErrProgramPanic) {
		t.Fatalf("expected ErrProgramPanic, got %v", err)
	}
	if !errors.Is(err, failure) {
		t.Fatalf("expected original error to be wrapped, got %v", err)
	}
}

func TestReleaseTerminalTogglesIgnoreSignals(t *testing.T) {
	p := NewProgram(nil, WithoutRenderer())

	if got := atomic.LoadUint32(&p.ignoreSignals); got != 0 {
		t.Fatalf("ignoreSignals should start unset, got %d", got)
	}

	if err := p.ReleaseTerminal(); err != nil {
		t.Fatalf("ReleaseTerminal() returned %v", err)
	}
	if got := atomic.LoadUint32(&p.ignoreSignals); got == 0 {
		t.Fatalf("ignoreSignals should be set after ReleaseTerminal")
	}

	if err := p.RestoreTerminal(); err != nil {
		t.Fatalf("RestoreTerminal() returned %v", err)
	}
	if got := atomic.LoadUint32(&p.ignoreSignals); got != 0 {
		t.Fatalf("ignoreSignals should be cleared after RestoreTerminal, got %d", got)
	}
}

func slicesEqual[T comparable](a, b []T) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
