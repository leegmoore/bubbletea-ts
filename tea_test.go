package tea

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type ctxImplodeMsg struct {
	cancel context.CancelFunc
}

type incrementMsg struct{}

type panicMsg struct{}

type printfNestedDetails struct {
	Counts []int
	Tags   map[string]string
}

type printfNestedStruct struct {
	Title   string
	Details printfNestedDetails
}

type printfKeyStruct struct {
	Code  int
	Label string
}

func panicCmd() Msg {
	panic("testing goroutine panic behavior")
}

type testModel struct {
	executed atomic.Value
	counter  atomic.Value
}

func (m testModel) Init() Cmd {
	return nil
}

func (m *testModel) Update(msg Msg) (Model, Cmd) {
	switch msg := msg.(type) {
	case ctxImplodeMsg:
		msg.cancel()
		time.Sleep(100 * time.Millisecond)

	case incrementMsg:
		i := m.counter.Load()
		if i == nil {
			m.counter.Store(1)
		} else {
			m.counter.Store(i.(int) + 1)
		}

	case KeyMsg:
		return m, Quit

	case panicMsg:
		panic("testing panic behavior")
	}

	return m, nil
}

func (m *testModel) View() string {
	m.executed.Store(true)
	return "success\n"
}

func waitForModelExecution(t *testing.T, m *testModel) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		if m.executed.Load() != nil {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("model never executed")
		}
		time.Sleep(time.Millisecond)
	}
}

func TestTeaModel(t *testing.T) {
	var buf bytes.Buffer
	var in bytes.Buffer
	in.Write([]byte("q"))

	ctx, cancel := context.WithTimeout(context.TODO(), 3*time.Second)
	defer cancel()

	p := NewProgram(&testModel{}, WithInput(&in), WithOutput(&buf), WithContext(ctx))
	if _, err := p.Run(); err != nil {
		t.Fatal(err)
	}

	if buf.Len() == 0 {
		t.Fatal("no output")
	}
}

func TestTeaQuit(t *testing.T) {
	var buf bytes.Buffer
	var in bytes.Buffer

	m := &testModel{}
	p := NewProgram(m, WithInput(&in), WithOutput(&buf))
	go func() {
		for {
			time.Sleep(time.Millisecond)
			if m.executed.Load() != nil {
				p.Quit()
				return
			}
		}
	}()

	if _, err := p.Run(); err != nil {
		t.Fatal(err)
	}
}

func TestTeaWaitQuit(t *testing.T) {
	var buf bytes.Buffer
	var in bytes.Buffer

	progStarted := make(chan struct{})
	waitStarted := make(chan struct{})
	errChan := make(chan error, 1)

	m := &testModel{}
	p := NewProgram(m, WithInput(&in), WithOutput(&buf))

	go func() {
		_, err := p.Run()
		errChan <- err
	}()

	go func() {
		for {
			time.Sleep(time.Millisecond)
			if m.executed.Load() != nil {
				close(progStarted)

				<-waitStarted
				time.Sleep(50 * time.Millisecond)
				p.Quit()

				return
			}
		}
	}()

	<-progStarted

	var wg sync.WaitGroup
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			p.Wait()
			wg.Done()
		}()
	}
	close(waitStarted)
	wg.Wait()

	err := <-errChan
	if err != nil {
		t.Fatalf("Expected nil, got %v", err)
	}
}

func TestTeaWaitKill(t *testing.T) {
	var buf bytes.Buffer
	var in bytes.Buffer

	progStarted := make(chan struct{})
	waitStarted := make(chan struct{})
	errChan := make(chan error, 1)

	m := &testModel{}
	p := NewProgram(m, WithInput(&in), WithOutput(&buf))

	go func() {
		_, err := p.Run()
		errChan <- err
	}()

	go func() {
		for {
			time.Sleep(time.Millisecond)
			if m.executed.Load() != nil {
				close(progStarted)

				<-waitStarted
				time.Sleep(50 * time.Millisecond)
				p.Kill()

				return
			}
		}
	}()

	<-progStarted

	var wg sync.WaitGroup
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			p.Wait()
			wg.Done()
		}()
	}
	close(waitStarted)
	wg.Wait()

	err := <-errChan
	if !errors.Is(err, ErrProgramKilled) {
		t.Fatalf("Expected %v, got %v", ErrProgramKilled, err)
	}
}

func TestTeaWithFilter(t *testing.T) {
	testTeaWithFilter(t, 0)
	testTeaWithFilter(t, 1)
	testTeaWithFilter(t, 2)
}

func testTeaWithFilter(t *testing.T, preventCount uint32) {
	var buf bytes.Buffer
	var in bytes.Buffer

	m := &testModel{}
	shutdowns := uint32(0)
	p := NewProgram(m,
		WithInput(&in),
		WithOutput(&buf),
		WithFilter(func(_ Model, msg Msg) Msg {
			if _, ok := msg.(QuitMsg); !ok {
				return msg
			}
			if shutdowns < preventCount {
				atomic.AddUint32(&shutdowns, 1)
				return nil
			}
			return msg
		}))

	go func() {
		for atomic.LoadUint32(&shutdowns) <= preventCount {
			time.Sleep(time.Millisecond)
			p.Quit()
		}
	}()

	if err := p.Start(); err != nil {
		t.Fatal(err)
	}
	if shutdowns != preventCount {
		t.Errorf("Expected %d prevented shutdowns, got %d", preventCount, shutdowns)
	}
}

func TestTeaKill(t *testing.T) {
	var buf bytes.Buffer
	var in bytes.Buffer

	m := &testModel{}
	p := NewProgram(m, WithInput(&in), WithOutput(&buf))
	go func() {
		for {
			time.Sleep(time.Millisecond)
			if m.executed.Load() != nil {
				p.Kill()
				return
			}
		}
	}()

	_, err := p.Run()

	if !errors.Is(err, ErrProgramKilled) {
		t.Fatalf("Expected %v, got %v", ErrProgramKilled, err)
	}

	if errors.Is(err, context.Canceled) {
		// The end user should not know about the program's internal context state.
		// The program should only report external context cancellation as a context error.
		t.Fatalf("Internal context cancellation was reported as context error!")
	}
}

func TestTeaContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	var buf bytes.Buffer
	var in bytes.Buffer

	m := &testModel{}
	p := NewProgram(m, WithContext(ctx), WithInput(&in), WithOutput(&buf))
	go func() {
		for {
			time.Sleep(time.Millisecond)
			if m.executed.Load() != nil {
				cancel()
				return
			}
		}
	}()

	_, err := p.Run()

	if !errors.Is(err, ErrProgramKilled) {
		t.Fatalf("Expected %v, got %v", ErrProgramKilled, err)
	}

	if !errors.Is(err, context.Canceled) {
		// The end user should know that their passed in context caused the kill.
		t.Fatalf("Expected %v, got %v", context.Canceled, err)
	}
}

func TestTeaContextImplodeDeadlock(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	var buf bytes.Buffer
	var in bytes.Buffer

	m := &testModel{}
	p := NewProgram(m, WithContext(ctx), WithInput(&in), WithOutput(&buf))
	go func() {
		for {
			time.Sleep(time.Millisecond)
			if m.executed.Load() != nil {
				p.Send(ctxImplodeMsg{cancel: cancel})
				return
			}
		}
	}()

	if _, err := p.Run(); !errors.Is(err, ErrProgramKilled) {
		t.Fatalf("Expected %v, got %v", ErrProgramKilled, err)
	}
}

func TestTeaContextBatchDeadlock(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	var buf bytes.Buffer
	var in bytes.Buffer

	inc := func() Msg {
		cancel()
		return incrementMsg{}
	}

	m := &testModel{}
	p := NewProgram(m, WithContext(ctx), WithInput(&in), WithOutput(&buf))
	go func() {
		for {
			time.Sleep(time.Millisecond)
			if m.executed.Load() != nil {
				batch := make(BatchMsg, 100)
				for i := range batch {
					batch[i] = inc
				}
				p.Send(batch)
				return
			}
		}
	}()

	if _, err := p.Run(); !errors.Is(err, ErrProgramKilled) {
		t.Fatalf("Expected %v, got %v", ErrProgramKilled, err)
	}
}

func TestTeaBatchMsg(t *testing.T) {
	var buf bytes.Buffer
	var in bytes.Buffer

	inc := func() Msg {
		return incrementMsg{}
	}

	m := &testModel{}
	p := NewProgram(m, WithInput(&in), WithOutput(&buf))
	go func() {
		p.Send(BatchMsg{inc, inc})

		for {
			time.Sleep(time.Millisecond)
			i := m.counter.Load()
			if i != nil && i.(int) >= 2 {
				p.Quit()
				return
			}
		}
	}()

	if _, err := p.Run(); err != nil {
		t.Fatal(err)
	}

	if m.counter.Load() != 2 {
		t.Fatalf("counter should be 2, got %d", m.counter.Load())
	}
}

func TestTeaSequenceMsg(t *testing.T) {
	var buf bytes.Buffer
	var in bytes.Buffer

	inc := func() Msg {
		return incrementMsg{}
	}

	m := &testModel{}
	p := NewProgram(m, WithInput(&in), WithOutput(&buf))
	go p.Send(sequenceMsg{inc, inc, Quit})

	if _, err := p.Run(); err != nil {
		t.Fatal(err)
	}

	if m.counter.Load() != 2 {
		t.Fatalf("counter should be 2, got %d", m.counter.Load())
	}
}

func TestTeaSequenceMsgWithBatchMsg(t *testing.T) {
	var buf bytes.Buffer
	var in bytes.Buffer

	inc := func() Msg {
		return incrementMsg{}
	}
	batch := func() Msg {
		return BatchMsg{inc, inc}
	}

	m := &testModel{}
	p := NewProgram(m, WithInput(&in), WithOutput(&buf))
	go p.Send(sequenceMsg{batch, inc, Quit})

	if _, err := p.Run(); err != nil {
		t.Fatal(err)
	}

	if m.counter.Load() != 3 {
		t.Fatalf("counter should be 3, got %d", m.counter.Load())
	}
}

func TestTeaNestedSequenceMsg(t *testing.T) {
	var buf bytes.Buffer
	var in bytes.Buffer

	inc := func() Msg {
		return incrementMsg{}
	}

	m := &testModel{}
	p := NewProgram(m, WithInput(&in), WithOutput(&buf))
	go p.Send(sequenceMsg{inc, Sequence(inc, inc, Batch(inc, inc)), Quit})

	if _, err := p.Run(); err != nil {
		t.Fatal(err)
	}

	if m.counter.Load() != 5 {
		t.Fatalf("counter should be 5, got %d", m.counter.Load())
	}
}

func TestTeaSend(t *testing.T) {
	var buf bytes.Buffer
	var in bytes.Buffer

	m := &testModel{}
	p := NewProgram(m, WithInput(&in), WithOutput(&buf))

	// sending before the program is started is a blocking operation
	go p.Send(Quit())

	if _, err := p.Run(); err != nil {
		t.Fatal(err)
	}

	// sending a message after program has quit is a no-op
	p.Send(Quit())
}

func TestTeaNoRun(t *testing.T) {
	var buf bytes.Buffer
	var in bytes.Buffer

	m := &testModel{}
	NewProgram(m, WithInput(&in), WithOutput(&buf))
}

func TestTeaPanic(t *testing.T) {
	var buf bytes.Buffer
	var in bytes.Buffer

	m := &testModel{}
	p := NewProgram(m, WithInput(&in), WithOutput(&buf))
	go func() {
		for {
			time.Sleep(time.Millisecond)
			if m.executed.Load() != nil {
				p.Send(panicMsg{})
				return
			}
		}
	}()

	_, err := p.Run()

	if !errors.Is(err, ErrProgramPanic) {
		t.Fatalf("Expected %v, got %v", ErrProgramPanic, err)
	}

	if !errors.Is(err, ErrProgramKilled) {
		t.Fatalf("Expected %v, got %v", ErrProgramKilled, err)
	}
}

func TestTeaGoroutinePanic(t *testing.T) {
	var buf bytes.Buffer
	var in bytes.Buffer

	m := &testModel{}
	p := NewProgram(m, WithInput(&in), WithOutput(&buf))
	go func() {
		for {
			time.Sleep(time.Millisecond)
			if m.executed.Load() != nil {
				batch := make(BatchMsg, 10)
				for i := 0; i < len(batch); i += 2 {
					batch[i] = Sequence(panicCmd)
					batch[i+1] = Batch(panicCmd)
				}
				p.Send(batch)
				return
			}
		}
	}()

	_, err := p.Run()

	if !errors.Is(err, ErrProgramPanic) {
		t.Fatalf("Expected %v, got %v", ErrProgramPanic, err)
	}

	if !errors.Is(err, ErrProgramKilled) {
		t.Fatalf("Expected %v, got %v", ErrProgramKilled, err)
	}
}

func TestTeaSendPrintlnCmd(t *testing.T) {
	var buf bytes.Buffer
	var in bytes.Buffer

	m := &testModel{}
	p := NewProgram(m, WithInput(&in), WithOutput(&buf))
	errChan := make(chan error, 1)

	go func() {
		_, err := p.Run()
		errChan <- err
	}()

	waitForModelExecution(t, m)

	p.Send(Println("queued-one\nqueued-two")())
	time.Sleep(25 * time.Millisecond)
	p.Quit()

	err := <-errChan
	if err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}

	out := buf.String()
	if !strings.Contains(out, "queued-one\r\nqueued-two") {
		t.Fatalf("expected queued lines to flush before the view, got %q", out)
	}
	printIdx := strings.Index(out, "queued-one")
	viewIdx := strings.Index(out, "success")
	if printIdx == -1 || viewIdx == -1 {
		t.Fatalf("expected output to contain queued lines and the rendered view, got %q", out)
	}
	if printIdx > viewIdx {
		t.Fatalf("queued lines should render before the view, got %q", out)
	}
}

func TestTeaSendPrintfCmd(t *testing.T) {
	var buf bytes.Buffer
	var in bytes.Buffer

	m := &testModel{}
	p := NewProgram(m, WithInput(&in), WithOutput(&buf))
	errChan := make(chan error, 1)

	go func() {
		_, err := p.Run()
		errChan <- err
	}()

	waitForModelExecution(t, m)

	p.Send(Printf("milliseconds: %03d", 7)())
	time.Sleep(25 * time.Millisecond)
	p.Quit()

	err := <-errChan
	if err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}

	out := buf.String()
	if !strings.Contains(out, "milliseconds: 007") {
		t.Fatalf("expected formatted line to flush before the view, got %q", out)
	}
	printIdx := strings.Index(out, "milliseconds: 007")
	viewIdx := strings.Index(out, "success")
	if printIdx == -1 || viewIdx == -1 {
		t.Fatalf("expected output to contain formatted line and rendered view, got %q", out)
	}
	if printIdx > viewIdx {
		t.Fatalf("formatted line should render before the view, got %q", out)
	}
}

func TestProgramPrintln(t *testing.T) {
	var buf bytes.Buffer
	var in bytes.Buffer

	m := &testModel{}
	p := NewProgram(m, WithInput(&in), WithOutput(&buf))
	errChan := make(chan error, 1)

	go func() {
		_, err := p.Run()
		errChan <- err
	}()

	waitForModelExecution(t, m)

	p.Println("queued-one\nqueued-two")
	time.Sleep(25 * time.Millisecond)
	p.Quit()

	err := <-errChan
	if err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}

	out := buf.String()
	if !strings.Contains(out, "queued-one\r\nqueued-two") {
		t.Fatalf("expected queued lines to flush before the view, got %q", out)
	}
	printIdx := strings.Index(out, "queued-one")
	viewIdx := strings.Index(out, "success")
	if printIdx == -1 || viewIdx == -1 {
		t.Fatalf("expected output to contain queued lines and the rendered view, got %q", out)
	}
	if printIdx > viewIdx {
		t.Fatalf("queued lines should render before the view, got %q", out)
	}
}

func TestProgramPrintf(t *testing.T) {
	var buf bytes.Buffer
	var in bytes.Buffer

	m := &testModel{}
	p := NewProgram(m, WithInput(&in), WithOutput(&buf))
	errChan := make(chan error, 1)

	go func() {
		_, err := p.Run()
		errChan <- err
	}()

	waitForModelExecution(t, m)

	p.Printf("milliseconds: %03d", 7)
	time.Sleep(25 * time.Millisecond)
	p.Quit()

	err := <-errChan
	if err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}

	out := buf.String()
	if !strings.Contains(out, "milliseconds: 007") {
		t.Fatalf("expected formatted line to flush before the view, got %q", out)
	}
	printIdx := strings.Index(out, "milliseconds: 007")
	viewIdx := strings.Index(out, "success")
	if printIdx == -1 || viewIdx == -1 {
		t.Fatalf("expected output to contain formatted line and rendered view, got %q", out)
	}
	if printIdx > viewIdx {
		t.Fatalf("formatted line should render before the view, got %q", out)
	}
}

func TestPrintfFormattingVariants(t *testing.T) {
	assertPrintfResult := func(t *testing.T, template string, args []interface{}, expected string) {
		t.Helper()
		msg := Printf(template, args...)()
		printMsg, ok := msg.(printLineMessage)
		if !ok {
			t.Fatalf("expected printLineMessage, got %T", msg)
		}
		actual := normalizePointerPlaceholders(printMsg.messageBody)
		expectedNormalized := normalizePointerPlaceholders(expected)
		if actual != expectedNormalized {
			t.Fatalf("expected %q, got %q", expectedNormalized, actual)
		}
	}

	typeStructValue := printfNestedStruct{
		Title: "type chai",
		Details: printfNestedDetails{
			Counts: []int{7, 9},
			Tags: map[string]string{
				"origin": "assam",
			},
		},
	}
	structPlusValue := printfNestedStruct{
		Title: "plus chai",
		Details: printfNestedDetails{
			Counts: []int{4},
			Tags: map[string]string{
				"style":  "milk",
				"origin": "darjeeling",
			},
		},
	}
	structPointerDetails := withPointerPlaceholder(&printfNestedStruct{
		Title: "pointer chai",
		Details: printfNestedDetails{
			Counts: []int{3, 8},
			Tags: map[string]string{
				"origin": "nilgiri",
				"style":  "masala",
			},
		},
	}, 0x4)

	pointerHot := newPrintfKeyStructPointer(1, "hot", 0x1)
	pointerIced := newPrintfKeyStructPointer(2, "iced", 0x2)
	pointerIface := newPrintfKeyStructPointer(3, "ptr", 0x3)
	pointerDeadBeef := newPrintfKeyStructPointer(4, "padded", 0xdeadbeef)

	testCases := []struct {
		name     string
		template string
		args     []interface{}
		expected string
	}{
		{
			name:     "hexWithFlags",
			template: "hex padded: %#08x",
			args:     []interface{}{48879},
			expected: "hex padded: 0x0000beef",
		},
		{
			name:     "leftAlignedString",
			template: "left aligned: |%-8s|",
			args:     []interface{}{"tea"},
			expected: "left aligned: |tea     |",
		},
		{
			name:     "stringPrecision",
			template: "precision: %.5s",
			args:     []interface{}{"bubbletea"},
			expected: "precision: bubbl",
		},
		{
			name:     "floatWithFlags",
			template: "float: %+08.2f",
			args:     []interface{}{3.5},
			expected: "float: +0003.50",
		},
		{
			name:     "dynamicWidthPrecision",
			template: "dynamic: %*.*f",
			args:     []interface{}{8, 3, 1.25},
			expected: "dynamic:    1.250",
		},
		{
			name:     "quotedString",
			template: "quoted: %q",
			args:     []interface{}{"tea & crumpets"},
			expected: "quoted: \"tea & crumpets\"",
		},
		{
			name:     "percentLiteral",
			template: "percent: %d%%",
			args:     []interface{}{42},
			expected: "percent: 42%",
		},
		{
			name:     "boolValue",
			template: "bool: %t",
			args:     []interface{}{false},
			expected: "bool: false",
		},
		{
			name:     "richSlice",
			template: "slice: %#v",
			args:     []interface{}{[]string{"tea", "milk"}},
			expected: "slice: []string{\"tea\", \"milk\"}",
		},
		{
			name:     "nestedStruct",
			template: "struct: %#v",
			args: []interface{}{printfNestedStruct{
				Title: "chai",
				Details: printfNestedDetails{
					Counts: []int{1, 2},
					Tags:   map[string]string{"origin": "assam"},
				},
			}},
			expected: "struct: tea.printfNestedStruct{Title:\"chai\", Details:tea.printfNestedDetails{Counts:[]int{1, 2}, Tags:map[string]string{\"origin\":\"assam\"}}}",
		},
		{
			name:     "nestedMap",
			template: "map: %#v",
			args: []interface{}{map[string]map[string]int{
				"counts": map[string]int{
					"steep": 2,
				},
			}},
			expected: "map: map[string]map[string]int{\"counts\":map[string]int{\"steep\":2}}",
		},
		{
			name:     "nestedMapMultipleKeys",
			template: "map multi: %#v",
			args: []interface{}{map[string]map[string]int{
				"temps": map[string]int{
					"hot":  98,
					"cold": 65,
				},
				"counts": map[string]int{
					"steep": 2,
					"rest":  1,
				},
			}},
			expected: "map multi: map[string]map[string]int{\"counts\":map[string]int{\"rest\":1, \"steep\":2}, \"temps\":map[string]int{\"cold\":65, \"hot\":98}}",
		},
		{
			name:     "boolMapKeys",
			template: "bool map: %#v",
			args: []interface{}{map[bool]string{
				true:  "hot",
				false: "iced",
			}},
			expected: "bool map: map[bool]string{false:\"iced\", true:\"hot\"}",
		},
		{
			name:     "intMapKeys",
			template: "int map: %#v",
			args: []interface{}{map[int]string{
				5:  "high",
				-7: "low",
				0:  "zero",
			}},
			expected: "int map: map[int]string{-7:\"low\", 0:\"zero\", 5:\"high\"}",
		},
		{
			name:     "floatMapKeys",
			template: "float map: %#v",
			args: []interface{}{map[float64]string{
				math.NaN():   "nan",
				math.Inf(-1): "neg",
				0:            "zero",
				math.Inf(1):  "pos",
			}},
			expected: "float map: map[float64]string{NaN:\"nan\", -Inf:\"neg\", 0:\"zero\", +Inf:\"pos\"}",
		},
		{
			name:     "floatMapValues",
			template: "float map values: %#v",
			args: []interface{}{map[string]float64{
				"zero": 0,
				"pos":  math.Inf(1),
				"neg":  math.Inf(-1),
				"nan":  math.NaN(),
			}},
			expected: "float map values: map[string]float64{\"nan\":NaN, \"neg\":-Inf, \"pos\":+Inf, \"zero\":0}",
		},
		{
			name:     "interfaceMapKeys",
			template: "iface map: %#v",
			args: []interface{}{map[interface{}]string{
				true:         "boolTrue",
				false:        "boolFalse",
				int8(-2):     "int8",
				int32(5):     "int32",
				float64(3.5): "float",
				"tea":        "string",
			}},
			expected: "iface map: map[interface {}]string{\"tea\":\"string\", -2:\"int8\", 5:\"int32\", 3.5:\"float\", false:\"boolFalse\", true:\"boolTrue\"}",
		},
		{
			name:     "interfaceMapValues",
			template: "iface map values: %#v",
			args: []interface{}{map[string]interface{}{
				"string": "chai",
				"int":    7,
				"float":  3.5,
				"bool":   true,
				"nil":    interface{}(nil),
			}},
			expected: "iface map values: map[string]interface {}{\"bool\":true, \"float\":3.5, \"int\":7, \"nil\":interface {}(nil), \"string\":\"chai\"}",
		},
		{
			name:     "pointerMapKeys",
			template: "pointer key map: %#v",
			args: []interface{}{map[*printfKeyStruct]string{
				pointerIced: "iced",
				pointerHot:  "hot",
			}},
			expected: "pointer key map: map[*tea.printfKeyStruct]string{(*tea.printfKeyStruct)(0x1):\"hot\", (*tea.printfKeyStruct)(0x2):\"iced\"}",
		},
		{
			name:     "pointerMapValues",
			template: "pointer value map: %#v",
			args: []interface{}{map[string]*printfKeyStruct{
				"hot":  pointerHot,
				"iced": pointerIced,
				"zero": (*printfKeyStruct)(nil),
			}},
			expected: "pointer value map: map[string]*tea.printfKeyStruct{\"hot\":(*tea.printfKeyStruct)(0x1), \"iced\":(*tea.printfKeyStruct)(0x2), \"zero\":(*tea.printfKeyStruct)(nil)}",
		},
		{
			name:     "interfacePointerValues",
			template: "iface pointer map: %#v",
			args: []interface{}{map[string]interface{}{
				"note": "chai",
				"ptr":  pointerIface,
			}},
			expected: "iface pointer map: map[string]interface {}{\"note\":\"chai\", \"ptr\":(*tea.printfKeyStruct)(0x3)}",
		},
		{
			name:     "structMapKeys",
			template: "struct key map: %#v",
			args: []interface{}{map[printfKeyStruct]string{
				printfKeyStruct{Code: 2, Label: "iced"}: "cold",
				printfKeyStruct{Code: 1, Label: "hot"}:  "warm",
			}},
			expected: "struct key map: map[tea.printfKeyStruct]string{tea.printfKeyStruct{Code:1, Label:\"hot\"}:\"warm\", tea.printfKeyStruct{Code:2, Label:\"iced\"}:\"cold\"}",
		},
		{
			name:     "pointerValue",
			template: "pointer: %p",
			args:     []interface{}{pointerDeadBeef},
			expected: "pointer: 0xdeadbeef",
		},
		{
			name:     "pointerSlice",
			template: "pointer slice: %#v",
			args: []interface{}{[]*printfKeyStruct{
				pointerHot,
				pointerIced,
				(*printfKeyStruct)(nil),
			}},
			expected: "pointer slice: []*tea.printfKeyStruct{(*tea.printfKeyStruct)(0x1), (*tea.printfKeyStruct)(0x2), (*tea.printfKeyStruct)(nil)}",
		},
		{
			name:     "interfacePointerSlice",
			template: "iface slice: %#v",
			args: []interface{}{[]interface{}{
				pointerHot,
				"chai",
				interface{}(nil),
			}},
			expected: "iface slice: []interface {}{(*tea.printfKeyStruct)(0x1), \"chai\", interface {}(nil)}",
		},
		{
			name:     "interfaceNestedPointerMap",
			template: "iface nested pointer map: %#v",
			args: []interface{}{map[string]interface{}{
				"note": "chai",
				"ptrs": map[string]*printfKeyStruct{
					"hot":  pointerHot,
					"iced": pointerIced,
				},
			}},
			expected: "iface nested pointer map: map[string]interface {}{\"note\":\"chai\", \"ptrs\":map[string]*tea.printfKeyStruct{\"hot\":(*tea.printfKeyStruct)(0x1), \"iced\":(*tea.printfKeyStruct)(0x2)}}",
		},
		{
			name:     "interfaceNestedPointerSlice",
			template: "iface nested pointer slice: %#v",
			args: []interface{}{[]interface{}{
				"chai",
				[]*printfKeyStruct{pointerHot, pointerIced},
				[]interface{}{pointerIface, "milk", interface{}(nil)},
			}},
			expected: "iface nested pointer slice: []interface {}{\"chai\", []*tea.printfKeyStruct{(*tea.printfKeyStruct)(0x1), (*tea.printfKeyStruct)(0x2)}, []interface {}{(*tea.printfKeyStruct)(0x3), \"milk\", interface {}(nil)}}",
		},
		{
			name:     "interfacePointerMapAndStruct",
			template: "iface pointer map struct: %#v",
			args: []interface{}{map[string]interface{}{
				"details": printfNestedStruct{
					Title: "chai mix",
					Details: printfNestedDetails{
						Counts: []int{6, 1},
						Tags: map[string]string{
							"origin": "assam",
						},
					},
				},
				"ptrs": map[string]*printfKeyStruct{
					"hot":  pointerHot,
					"iced": pointerIced,
				},
			}},
			expected: "iface pointer map struct: map[string]interface {}{\"details\":tea.printfNestedStruct{Title:\"chai mix\", Details:tea.printfNestedDetails{Counts:[]int{6, 1}, Tags:map[string]string{\"origin\":\"assam\"}}}, \"ptrs\":map[string]*tea.printfKeyStruct{\"hot\":(*tea.printfKeyStruct)(0x1), \"iced\":(*tea.printfKeyStruct)(0x2)}}",
		},
		{
			name:     "interfacePointerSliceWithStruct",
			template: "iface pointer slice struct: %#v",
			args: []interface{}{[]interface{}{
				map[string]*printfKeyStruct{
					"hot":  pointerHot,
					"iced": pointerIced,
				},
				printfNestedStruct{
					Title: "chai pointer",
					Details: printfNestedDetails{
						Counts: []int{2},
						Tags: map[string]string{
							"origin": "darjeeling",
						},
					},
				},
			}},
			expected: "iface pointer slice struct: []interface {}{map[string]*tea.printfKeyStruct{\"hot\":(*tea.printfKeyStruct)(0x1), \"iced\":(*tea.printfKeyStruct)(0x2)}, tea.printfNestedStruct{Title:\"chai pointer\", Details:tea.printfNestedDetails{Counts:[]int{2}, Tags:map[string]string{\"origin\":\"darjeeling\"}}}}",
		},
		{
			name:     "interfacePointerMapNestedSliceStruct",
			template: "iface pointer map nested slice struct: %#v",
			args: []interface{}{map[string]interface{}{
				"mix": map[string]interface{}{
					"details": structPointerDetails,
					"ptrSlice": []*printfKeyStruct{
						pointerHot,
						pointerIced,
						(*printfKeyStruct)(nil),
					},
					"ptrs": map[string]*printfKeyStruct{
						"hot":  pointerHot,
						"iced": pointerIced,
					},
				},
				"note": "masala",
			}},
			expected: "iface pointer map nested slice struct: map[string]interface {}{\"mix\":map[string]interface {}{\"details\":(*tea.printfNestedStruct)(0x4), \"ptrSlice\":[]*tea.printfKeyStruct{(*tea.printfKeyStruct)(0x1), (*tea.printfKeyStruct)(0x2), (*tea.printfKeyStruct)(nil)}, \"ptrs\":map[string]*tea.printfKeyStruct{\"hot\":(*tea.printfKeyStruct)(0x1), \"iced\":(*tea.printfKeyStruct)(0x2)}}, \"note\":\"masala\"}",
		},
		{
			name:     "interfacePointerSliceNestedMapPointer",
			template: "iface pointer slice nested map ptr: %#v",
			args: []interface{}{[]interface{}{
				map[string]*printfKeyStruct{
					"hot":  pointerHot,
					"iced": pointerIced,
				},
				[]*printfKeyStruct{
					pointerHot,
					pointerIced,
					(*printfKeyStruct)(nil),
				},
				[]interface{}{
					structPointerDetails,
					map[string]*printfKeyStruct{
						"ptr": pointerIface,
					},
				},
			}},
			expected: "iface pointer slice nested map ptr: []interface {}{map[string]*tea.printfKeyStruct{\"hot\":(*tea.printfKeyStruct)(0x1), \"iced\":(*tea.printfKeyStruct)(0x2)}, []*tea.printfKeyStruct{(*tea.printfKeyStruct)(0x1), (*tea.printfKeyStruct)(0x2), (*tea.printfKeyStruct)(nil)}, []interface {}{(*tea.printfNestedStruct)(0x4), map[string]*tea.printfKeyStruct{\"ptr\":(*tea.printfKeyStruct)(0x3)}}}",
		},
		{
			name:     "interfacePointerMapOfMapPointerSlice",
			template: "iface pointer map of map slice: %#v",
			args: []interface{}{map[string]interface{}{
				"note": "outer",
				"outer": map[string]interface{}{
					"inner": map[string]interface{}{
						"nested": map[string]interface{}{
							"details": structPointerDetails,
							"ptrSlice": []*printfKeyStruct{
								pointerHot,
								pointerIced,
								(*printfKeyStruct)(nil),
							},
							"ptrSliceMix": []interface{}{
								[]*printfKeyStruct{
									pointerHot,
								},
								map[string]*printfKeyStruct{
									"ptr": pointerIface,
								},
							},
						},
						"note": "inner",
					},
					"ptrs": map[string]*printfKeyStruct{
						"hot":  pointerHot,
						"iced": pointerIced,
					},
				},
			}},
			expected: "iface pointer map of map slice: map[string]interface {}{\"note\":\"outer\", \"outer\":map[string]interface {}{\"inner\":map[string]interface {}{\"nested\":map[string]interface {}{\"details\":(*tea.printfNestedStruct)(0x4), \"ptrSlice\":[]*tea.printfKeyStruct{(*tea.printfKeyStruct)(0x1), (*tea.printfKeyStruct)(0x2), (*tea.printfKeyStruct)(nil)}, \"ptrSliceMix\":[]interface {}{[]*tea.printfKeyStruct{(*tea.printfKeyStruct)(0x1)}, map[string]*tea.printfKeyStruct{\"ptr\":(*tea.printfKeyStruct)(0x3)}}}, \"note\":\"inner\"}, \"ptrs\":map[string]*tea.printfKeyStruct{\"hot\":(*tea.printfKeyStruct)(0x1), \"iced\":(*tea.printfKeyStruct)(0x2)}}}",
		},
		{
			name:     "interfacePointerSliceMapRefs",
			template: "iface pointer slice map refs: %#v",
			args: []interface{}{func() []interface{} {
				chPrimary := newIncrementChannelPlaceholder(0xe0)
				fnPrimary := withPointerPlaceholder(func() incrementMsg { return incrementMsg{} }, 0xe1)
				chNested := newIncrementChannelPlaceholder(0xe2)
				fnNested := withPointerPlaceholder(func() incrementMsg { return incrementMsg{} }, 0xe3)
				return []interface{}{
					map[string]*printfKeyStruct{
						"hot":  pointerHot,
						"iced": pointerIced,
					},
					chPrimary,
					fnPrimary,
					[]interface{}{
						map[string]*printfKeyStruct{
							"ptr": pointerIface,
						},
						chNested,
						fnNested,
					},
				}
			}()},
			expected: "iface pointer slice map refs: []interface {}{map[string]*tea.printfKeyStruct{\"hot\":(*tea.printfKeyStruct)(0x1), \"iced\":(*tea.printfKeyStruct)(0x2)}, (chan tea.incrementMsg)(0xe0), (func() tea.incrementMsg)(0xe1), []interface {}{map[string]*tea.printfKeyStruct{\"ptr\":(*tea.printfKeyStruct)(0x3)}, (chan tea.incrementMsg)(0xe2), (func() tea.incrementMsg)(0xe3)}}",
		},
		{
			name:     "pointerWidth",
			template: "pointer padded: %20p",
			args:     []interface{}{pointerDeadBeef},
			expected: "pointer padded:           0xdeadbeef",
		},
		{
			name:     "pointerZeroPadded",
			template: "pointer zero padded: %020p",
			args:     []interface{}{pointerDeadBeef},
			expected: "pointer zero padded: 0x000000000000deadbeef",
		},
		{
			name:     "nilPointer",
			template: "pointer: %p",
			args:     []interface{}{(*testModel)(nil)},
			expected: "pointer: 0x0",
		},
		{
			name:     "pointerStructDetailed",
			template: "pointer struct: %#v",
			args: []interface{}{&printfNestedStruct{
				Title: "chai",
				Details: printfNestedDetails{
					Counts: []int{3},
					Tags:   map[string]string{"origin": "assam"},
				},
			}},
			expected: "pointer struct: &tea.printfNestedStruct{Title:\"chai\", Details:tea.printfNestedDetails{Counts:[]int{3}, Tags:map[string]string{\"origin\":\"assam\"}}}",
		},
		{
			name:     "typeStruct",
			template: "type: %T",
			args:     []interface{}{typeStructValue},
			expected: fmt.Sprintf("type: %T", typeStructValue),
		},
		{
			name:     "typePointer",
			template: "type pointer: %T",
			args:     []interface{}{(*printfKeyStruct)(nil)},
			expected: fmt.Sprintf("type pointer: %T", (*printfKeyStruct)(nil)),
		},
		{
			name:     "structPlusV",
			template: "struct plus: %+v",
			args:     []interface{}{structPlusValue},
			expected: fmt.Sprintf("struct plus: %+v", structPlusValue),
		},
		{
			name:     "structTagsMap",
			template: "struct tags: %#v",
			args: []interface{}{printfNestedStruct{
				Title: "chai",
				Details: printfNestedDetails{
					Counts: []int{5, 8},
					Tags: map[string]string{
						"origin": "assam",
						"grade":  "ftgfop",
					},
				},
			}},
			expected: "struct tags: tea.printfNestedStruct{Title:\"chai\", Details:tea.printfNestedDetails{Counts:[]int{5, 8}, Tags:map[string]string{\"grade\":\"ftgfop\", \"origin\":\"assam\"}}}",
		},
		{
			name:     "unicodeRune",
			template: "rune: %c",
			args:     []interface{}{rune('⌘')},
			expected: "rune: ⌘",
		},
		{
			name:     "unicodeCodePoint",
			template: "code point: %U",
			args:     []interface{}{rune('⌘')},
			expected: "code point: U+2318",
		},
		{
			name:     "unicodeVerbose",
			template: "verbose rune: %#U",
			args:     []interface{}{rune('⌘')},
			expected: "verbose rune: U+2318 '⌘'",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			assertPrintfResult(t, tc.template, tc.args, tc.expected)
		})
	}

	t.Run("pointerMapReference", func(t *testing.T) {
		value := withPointerPlaceholder(map[string]int{"steep": 2}, 0x50)
		expected := "map pointer: 0x50"
		assertPrintfResult(t, "map pointer: %p", []interface{}{value}, expected)
	})

	t.Run("pointerSliceReference", func(t *testing.T) {
		value := withPointerPlaceholder([]int{1, 2, 3}, 0x60)
		expected := "slice pointer: 0x60"
		assertPrintfResult(t, "slice pointer: %p", []interface{}{value}, expected)
	})

	t.Run("pointerFuncReference", func(t *testing.T) {
		value := withPointerPlaceholder(func() {}, 0x70)
		expected := "func pointer: 0x70"
		assertPrintfResult(t, "func pointer: %p", []interface{}{value}, expected)
	})

	t.Run("channelDetailed", func(t *testing.T) {
		ch := newIncrementChannelPlaceholder(0x80)
		expected := "channel literal: (chan tea.incrementMsg)(0x80)"
		assertPrintfResult(t, "channel literal: %#v", []interface{}{ch}, expected)
	})

	t.Run("funcDetailed", func(t *testing.T) {
		value := withPointerPlaceholder(func() Msg { return incrementMsg{} }, 0x90)
		expected := "func literal: (func() tea.Msg)(0x90)"
		assertPrintfResult(t, "func literal: %#v", []interface{}{value}, expected)
	})

	t.Run("interfaceMapChannelAndFunc", func(t *testing.T) {
		ch := newIncrementChannelPlaceholder(0xa0)
		fn := withPointerPlaceholder(func() incrementMsg { return incrementMsg{} }, 0xa1)
		value := map[string]interface{}{
			"chan": ch,
			"func": fn,
			"note": "chai",
		}
		expected := "iface ref map: map[string]interface {}{\"chan\":(chan tea.incrementMsg)(0xa0), \"func\":(func() tea.incrementMsg)(0xa1), \"note\":\"chai\"}"
		assertPrintfResult(t, "iface ref map: %#v", []interface{}{value}, expected)
	})

	t.Run("interfaceSliceChannelAndFunc", func(t *testing.T) {
		ch := newIncrementChannelPlaceholder(0xb0)
		fn := withPointerPlaceholder(func() incrementMsg { return incrementMsg{} }, 0xb1)
		value := []interface{}{ch, fn, "chai"}
		expected := "iface ref slice: []interface {}{(chan tea.incrementMsg)(0xb0), (func() tea.incrementMsg)(0xb1), \"chai\"}"
		assertPrintfResult(t, "iface ref slice: %#v", []interface{}{value}, expected)
	})

	t.Run("channelType", func(t *testing.T) {
		ch := make(chan incrementMsg)
		expected := fmt.Sprintf("type channel: %T", ch)
		assertPrintfResult(t, "type channel: %T", []interface{}{ch}, expected)
	})

	t.Run("funcType", func(t *testing.T) {
		fn := func() incrementMsg { return incrementMsg{} }
		expected := fmt.Sprintf("type func: %T", fn)
		assertPrintfResult(t, "type func: %T", []interface{}{fn}, expected)
	})

	t.Run("interfaceMapType", func(t *testing.T) {
		ch := make(chan incrementMsg)
		fn := func() incrementMsg { return incrementMsg{} }
		value := map[string]interface{}{
			"chan": ch,
			"func": fn,
			"note": "chai",
		}
		expected := fmt.Sprintf("iface ref map type: %T", value)
		assertPrintfResult(t, "iface ref map type: %T", []interface{}{value}, expected)
	})

	t.Run("interfaceSliceType", func(t *testing.T) {
		ch := make(chan incrementMsg)
		fn := func() incrementMsg { return incrementMsg{} }
		value := []interface{}{ch, fn, "chai"}
		expected := fmt.Sprintf("iface ref slice type: %T", value)
		assertPrintfResult(t, "iface ref slice type: %T", []interface{}{value}, expected)
	})

	t.Run("channelVerbose", func(t *testing.T) {
		ch := newIncrementChannelPlaceholder(0xd0)
		expected := "channel plus: 0xd0"
		assertPrintfResult(t, "channel plus: %+v", []interface{}{ch}, expected)
	})

	t.Run("funcVerbose", func(t *testing.T) {
		fn := withPointerPlaceholder(func() incrementMsg { return incrementMsg{} }, 0xd1)
		expected := "func plus: 0xd1"
		assertPrintfResult(t, "func plus: %+v", []interface{}{fn}, expected)
	})

	t.Run("interfaceMapVerbose", func(t *testing.T) {
		ch := newIncrementChannelPlaceholder(0xd2)
		fn := withPointerPlaceholder(func() incrementMsg { return incrementMsg{} }, 0xd3)
		value := map[string]interface{}{
			"chan": ch,
			"func": fn,
			"note": "chai",
		}
		expected := "iface ref map plus: map[chan:0xd2 func:0xd3 note:chai]"
		assertPrintfResult(t, "iface ref map plus: %+v", []interface{}{value}, expected)
	})

	t.Run("interfaceSliceVerbose", func(t *testing.T) {
		ch := newIncrementChannelPlaceholder(0xd4)
		fn := withPointerPlaceholder(func() incrementMsg { return incrementMsg{} }, 0xd5)
		value := []interface{}{ch, fn, "chai"}
		expected := "iface ref slice plus: [0xd4 0xd5 chai]"
		assertPrintfResult(t, "iface ref slice plus: %+v", []interface{}{value}, expected)
	})
}
