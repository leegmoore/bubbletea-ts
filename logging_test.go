package tea

import (
	"bytes"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"testing"
)

func TestLogToFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "log.txt")
	prefix := "logprefix"
	f, err := LogToFile(path, prefix)
	if err != nil {
		t.Error(err)
	}
	log.SetFlags(log.Lmsgprefix)
	log.Println("some test log")
	if err := f.Close(); err != nil {
		t.Error(err)
	}
	out, err := os.ReadFile(path)
	if err != nil {
		t.Error(err)
	}
	if string(out) != prefix+" some test log\n" {
		t.Fatalf("wrong log msg: %q", string(out))
	}
}

type multiWriterLogger struct {
	writers []io.Writer
	prefix  string
	extra   io.Writer
}

func newMultiWriterLogger(extra io.Writer) *multiWriterLogger {
	return &multiWriterLogger{extra: extra}
}

func (l *multiWriterLogger) SetOutput(w io.Writer) {
	l.writers = []io.Writer{w}
	if l.extra != nil {
		l.writers = append(l.writers, l.extra)
	}
}

func (l *multiWriterLogger) SetPrefix(prefix string) {
	l.prefix = prefix
}

func (l *multiWriterLogger) Println(msg string) error {
	if len(l.writers) == 0 {
		return fmt.Errorf("output not configured")
	}
	line := l.prefix + msg + "\n"
	for _, writer := range l.writers {
		if _, err := io.WriteString(writer, line); err != nil {
			return err
		}
	}
	return nil
}

func TestLogToFileWithMultiWriterLogger(t *testing.T) {
	path := filepath.Join(t.TempDir(), "multi-writer-log.txt")
	var buffer bytes.Buffer
	logger := newMultiWriterLogger(&buffer)
	f, err := LogToFileWith(path, "multi", logger)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if cerr := f.Close(); cerr != nil {
			t.Error(cerr)
		}
	})
	if err := logger.Println("structured log entry"); err != nil {
		t.Fatal(err)
	}
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "multi structured log entry\n" {
		t.Fatalf("file writer mismatch: %q", string(contents))
	}
	if buffer.String() != "multi structured log entry\n" {
		t.Fatalf("fan-out writer mismatch: %q", buffer.String())
	}
}

func TestLogToFileAppendsExistingContents(t *testing.T) {
	path := filepath.Join(t.TempDir(), "append-log.txt")
	if err := os.WriteFile(path, []byte("legacy entry\n"), 0o600); err != nil {
		t.Fatalf("failed to seed log file: %v", err)
	}
	logger := log.New(io.Discard, "", log.Lmsgprefix)
	f, err := LogToFileWith(path, "append", logger)
	if err != nil {
		t.Fatal(err)
	}
	closed := false
	t.Cleanup(func() {
		if closed {
			return
		}
		if cerr := f.Close(); cerr != nil {
			t.Error(cerr)
		}
	})
	logger.Println("new entry")
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	closed = true
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	const want = "legacy entry\nappend new entry\n"
	if string(contents) != want {
		t.Fatalf("log file mismatch: %q", string(contents))
	}
}

func TestLogToFileSupportsMultipleWriters(t *testing.T) {
	path := filepath.Join(t.TempDir(), "shared-log.txt")
	logger1 := log.New(io.Discard, "", log.Lmsgprefix)
	logger2 := log.New(io.Discard, "", log.Lmsgprefix)
	f1, err := LogToFileWith(path, "proc1", logger1)
	if err != nil {
		t.Fatal(err)
	}
	f2, err := LogToFileWith(path, "proc2", logger2)
	if err != nil {
		t.Fatal(err)
	}
	closed1 := false
	closed2 := false
	t.Cleanup(func() {
		if !closed1 {
			if cerr := f1.Close(); cerr != nil {
				t.Error(cerr)
			}
		}
		if !closed2 {
			if cerr := f2.Close(); cerr != nil {
				t.Error(cerr)
			}
		}
	})
	logger1.Println("first entry")
	logger2.Println("second entry")
	if err := f1.Close(); err != nil {
		t.Fatal(err)
	}
	closed1 = true
	if err := f2.Close(); err != nil {
		t.Fatal(err)
	}
	closed2 = true
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	const want = "proc1 first entry\nproc2 second entry\n"
	if string(contents) != want {
		t.Fatalf("unexpected log aggregation: %q", string(contents))
	}
}

func TestLogToFileWithMultiWriterLoggerToPipe(t *testing.T) {
	path := filepath.Join(t.TempDir(), "stderr-fanout.txt")
	pr, pw, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pr.Close()
		pw.Close()
	})
	logger := newMultiWriterLogger(pw)
	f, err := LogToFileWith(path, "stderr", logger)
	if err != nil {
		t.Fatal(err)
	}
	closed := false
	t.Cleanup(func() {
		if closed {
			return
		}
		if cerr := f.Close(); cerr != nil {
			t.Error(cerr)
		}
	})
	if err := logger.Println("mirrored log entry"); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	closed = true
	if err := pw.Close(); err != nil {
		t.Fatal(err)
	}
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	pipeContents, err := io.ReadAll(pr)
	if err != nil {
		t.Fatal(err)
	}
	const want = "stderr mirrored log entry\n"
	if string(contents) != want {
		t.Fatalf("file writer mismatch: %q", string(contents))
	}
	if string(pipeContents) != want {
		t.Fatalf("pipe writer mismatch: %q", string(pipeContents))
	}
}
