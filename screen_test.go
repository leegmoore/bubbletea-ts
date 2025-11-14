package tea

import (
	"bytes"
	"strings"
	"testing"
)

func TestClearMsg(t *testing.T) {
	tests := []struct {
		name     string
		cmds     sequenceMsg
		expected string
	}{
		{
			name:     "clear_screen",
			cmds:     []Cmd{ClearScreen},
			expected: "\x1b[?25l\x1b[?2004h\x1b[2J\x1b[H\rsuccess\x1b[K\r\n\x1b[K\r\x1b[2K\r\x1b[?2004l\x1b[?25h\x1b[?1002l\x1b[?1003l\x1b[?1006l",
		},
		{
			name:     "altscreen",
			cmds:     []Cmd{EnterAltScreen, ExitAltScreen},
			expected: "\x1b[?25l\x1b[?2004h\x1b[?1049h\x1b[2J\x1b[H\x1b[?25l\x1b[?1049l\x1b[?25l\rsuccess\x1b[K\r\n\x1b[K\r\x1b[2K\r\x1b[?2004l\x1b[?25h\x1b[?1002l\x1b[?1003l\x1b[?1006l",
		},
		{
			name:     "altscreen_autoexit",
			cmds:     []Cmd{EnterAltScreen},
			expected: "\x1b[?25l\x1b[?2004h\x1b[?1049h\x1b[2J\x1b[H\x1b[?25l\x1b[H\rsuccess\x1b[K\r\n\x1b[K\x1b[2;H\x1b[2K\r\x1b[?2004l\x1b[?25h\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1049l\x1b[?25h",
		},
		{
			name:     "mouse_cellmotion",
			cmds:     []Cmd{EnableMouseCellMotion},
			expected: "\x1b[?25l\x1b[?2004h\x1b[?1002h\x1b[?1006h\rsuccess\x1b[K\r\n\x1b[K\r\x1b[2K\r\x1b[?2004l\x1b[?25h\x1b[?1002l\x1b[?1003l\x1b[?1006l",
		},
		{
			name:     "mouse_allmotion",
			cmds:     []Cmd{EnableMouseAllMotion},
			expected: "\x1b[?25l\x1b[?2004h\x1b[?1003h\x1b[?1006h\rsuccess\x1b[K\r\n\x1b[K\r\x1b[2K\r\x1b[?2004l\x1b[?25h\x1b[?1002l\x1b[?1003l\x1b[?1006l",
		},
		{
			name:     "mouse_disable",
			cmds:     []Cmd{EnableMouseAllMotion, DisableMouse},
			expected: "\x1b[?25l\x1b[?2004h\x1b[?1003h\x1b[?1006h\x1b[?1002l\x1b[?1003l\x1b[?1006l\rsuccess\x1b[K\r\n\x1b[K\r\x1b[2K\r\x1b[?2004l\x1b[?25h\x1b[?1002l\x1b[?1003l\x1b[?1006l",
		},
		{
			name:     "cursor_hide",
			cmds:     []Cmd{HideCursor},
			expected: "\x1b[?25l\x1b[?2004h\x1b[?25l\rsuccess\x1b[K\r\n\x1b[K\r\x1b[2K\r\x1b[?2004l\x1b[?25h\x1b[?1002l\x1b[?1003l\x1b[?1006l",
		},
		{
			name:     "cursor_hideshow",
			cmds:     []Cmd{HideCursor, ShowCursor},
			expected: "\x1b[?25l\x1b[?2004h\x1b[?25l\x1b[?25h\rsuccess\x1b[K\r\n\x1b[K\r\x1b[2K\r\x1b[?2004l\x1b[?25h\x1b[?1002l\x1b[?1003l\x1b[?1006l",
		},
		{
			name:     "bp_stop_start",
			cmds:     []Cmd{DisableBracketedPaste, EnableBracketedPaste},
			expected: "\x1b[?25l\x1b[?2004h\x1b[?2004l\x1b[?2004h\rsuccess\x1b[K\r\n\x1b[K\r\x1b[2K\r\x1b[?2004l\x1b[?25h\x1b[?1002l\x1b[?1003l\x1b[?1006l",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var buf bytes.Buffer
			var in bytes.Buffer

			m := &testModel{}
			p := NewProgram(m, WithInput(&in), WithOutput(&buf))

			test.cmds = append([]Cmd{func() Msg { return WindowSizeMsg{80, 24} }}, test.cmds...)
			test.cmds = append(test.cmds, Quit)
			go p.Send(test.cmds)

			if _, err := p.Run(); err != nil {
				t.Fatal(err)
			}

			if buf.String() != test.expected {
				t.Errorf("expected embedded sequence:\n%q\ngot:\n%q", test.expected, buf.String())
			}
		})
	}
}

func runProgramForScreenTest(t *testing.T, opts []ProgramOption, cmds sequenceMsg) string {
	t.Helper()
	var buf bytes.Buffer
	var in bytes.Buffer

	allOpts := append([]ProgramOption{WithInput(&in), WithOutput(&buf)}, opts...)
	p := NewProgram(&testModel{}, allOpts...)

	sequence := append(sequenceMsg{func() Msg { return WindowSizeMsg{80, 24} }}, cmds...)
	sequence = append(sequence, Quit)

	go p.Send(sequence)

	if _, err := p.Run(); err != nil {
		t.Fatal(err)
	}

	return buf.String()
}

func TestReportFocusCommands(t *testing.T) {
	output := runProgramForScreenTest(t, nil, sequenceMsg{EnableReportFocus, DisableReportFocus})

	const enableSeq = "\x1b[?1004h"
	const disableSeq = "\x1b[?1004l"

	if !strings.Contains(output, enableSeq) {
		t.Fatalf("expected focus enable sequence %q in output: %q", enableSeq, output)
	}
	if !strings.Contains(output, disableSeq) {
		t.Fatalf("expected focus disable sequence %q in output: %q", disableSeq, output)
	}
	if strings.Index(output, enableSeq) > strings.LastIndex(output, disableSeq) {
		t.Fatalf("focus enable should be emitted before disable, got %q", output)
	}
}

func TestWithReportFocusOption(t *testing.T) {
	output := runProgramForScreenTest(t, []ProgramOption{WithReportFocus()}, nil)

	if !strings.Contains(output, "\x1b[?1004h") {
		t.Fatalf("WithReportFocus should enable focus events, got %q", output)
	}
	if !strings.Contains(output, "\x1b[?1004l") {
		t.Fatalf("WithReportFocus should disable focus events on exit, got %q", output)
	}
}

func TestMouseStartupOptions(t *testing.T) {
	tests := []struct {
		name     string
		opts     []ProgramOption
		enable   []string
	}{
		{
			name:   "cell_motion_option",
			opts:   []ProgramOption{WithMouseCellMotion()},
			enable: []string{"\x1b[?1002h", "\x1b[?1006h"},
		},
		{
			name:   "all_motion_option",
			opts:   []ProgramOption{WithMouseAllMotion()},
			enable: []string{"\x1b[?1003h", "\x1b[?1006h"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			output := runProgramForScreenTest(t, tt.opts, nil)
			for _, seq := range tt.enable {
				if !strings.Contains(output, seq) {
					t.Fatalf("expected to find sequence %q in output %q", seq, output)
				}
			}
		})
	}
}
