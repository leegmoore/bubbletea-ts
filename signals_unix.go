//go:build darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris || aix || zos
// +build darwin dragonfly freebsd linux netbsd openbsd solaris aix zos

package tea

import (
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"
)

// listenForResize sends messages (or errors) when the terminal resizes.
// Argument output should be the file descriptor for the terminal; usually
// os.Stdout.
func (p *Program) listenForResize(done chan struct{}) {
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGWINCH)

	defer func() {
		signal.Stop(sig)
		close(done)
	}()

	for {
		select {
		case <-p.ctx.Done():
			return
		case <-sig:
		}

		if atomic.LoadUint32(&p.ignoreSignals) == 1 {
			continue
		}

		p.checkResize()
	}
}
