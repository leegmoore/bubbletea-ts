//go:build windows

package tea

import (
	"bytes"
	"io"
	"log"
	"os"
	"path/filepath"
	"testing"
)

type trackingWriter struct {
	bytes.Buffer
	closed bool
}

func (w *trackingWriter) Close() error {
	w.closed = true
	return nil
}

func TestLogToFileWindowsSequentialPrograms(t *testing.T) {
	path := filepath.Join(t.TempDir(), "win-sequential.log")

	logger1 := log.New(io.Discard, "", log.Lmsgprefix)
	first, err := LogToFileWith(path, "proc1", logger1)
	if err != nil {
		t.Fatal(err)
	}
	logger1.Println("first entry")
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}

	logger2 := log.New(io.Discard, "", log.Lmsgprefix)
	second, err := LogToFileWith(path, "proc2", logger2)
	if err != nil {
		t.Fatal(err)
	}
	logger2.Println("second entry")
	if err := second.Close(); err != nil {
		t.Fatal(err)
	}

	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	const want = "proc1 first entry\nproc2 second entry\n"
	if string(contents) != want {
		t.Fatalf("unexpected sequential log contents: %q", string(contents))
	}
}

func TestLogToFileWindowsFanOutDoesNotCloseTargets(t *testing.T) {
	path := filepath.Join(t.TempDir(), "win-fanout.log")
	extra := &trackingWriter{}
	logger := newMultiWriterLogger(extra)
	file, err := LogToFileWith(path, "stderr", logger)
	if err != nil {
		t.Fatal(err)
	}
	if err := logger.Println("fan-out entry"); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	if extra.closed {
		t.Fatalf("extra writer should not be closed")
	}
	if extra.String() != "stderr fan-out entry\n" {
		t.Fatalf("fan-out buffer mismatch: %q", extra.String())
	}
}

func TestLogToFileWindowsPreservesCarriageReturns(t *testing.T) {
	path := filepath.Join(t.TempDir(), "win-crlf.log")
	logger := newMultiWriterLogger(nil)
	file, err := LogToFileWith(path, "win", logger)
	if err != nil {
		t.Fatal(err)
	}
	payload := "line one\r\nline two"
	if err := logger.Println(payload); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	const want = "win line one\r\nline two\n"
	if string(contents) != want {
		t.Fatalf("unexpected CRLF normalization: %q", string(contents))
	}
}
