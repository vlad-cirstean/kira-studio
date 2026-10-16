package localsock

import (
	"net"
	"sync"
	"sync/atomic"
	"testing"
)

func TestCloseWaitsForAcceptedConns(t *testing.T) {
	for range 50 {
		l, err := Listen(Options{DirPrefix: "kira-ls-", TokenBytes: 16})
		if err != nil {
			t.Fatal(err)
		}
		var running atomic.Int32
		go l.Serve(func(c net.Conn) {
			running.Add(1)
			defer running.Add(-1)
			_ = c.Close()
		})
		stop := make(chan struct{})
		var dialers sync.WaitGroup
		dialers.Add(1)
		go func() {
			defer dialers.Done()
			for {
				select {
				case <-stop:
					return
				default:
				}
				if c, err := net.Dial("unix", l.SockPath); err == nil {
					_ = c.Close()
				}
			}
		}()
		_ = l.Close()
		if n := running.Load(); n != 0 {
			t.Fatalf("%d handlers running after Close", n)
		}
		close(stop)
		dialers.Wait()
	}
}
