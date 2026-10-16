package gitsearch

import (
	"context"
	"errors"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient"
)

type fakeScanRunner struct{ proc *fakeScanProc }

func (r fakeScanRunner) Start(context.Context, string, gitclient.Spec) (gitclient.Process, error) {
	return r.proc, nil
}

// fakeScanProc serves stdout as head, then blocks (block) or ends; Wait reports res.
type fakeScanProc struct {
	head   string
	block  bool
	res    gitclient.Result
	once   sync.Once
	closed chan struct{}
	read   bool
}

func newFakeScanProc(head string, block bool, res gitclient.Result) *fakeScanProc {
	return &fakeScanProc{head: head, block: block, res: res, closed: make(chan struct{})}
}

func (p *fakeScanProc) Read(b []byte) (int, error) {
	if !p.read && p.head != "" {
		p.read = true
		return copy(b, p.head), nil
	}
	if p.block {
		<-p.closed
	}
	return 0, io.EOF
}
func (p *fakeScanProc) Stdout() io.ReadCloser           { return io.NopCloser(p) }
func (p *fakeScanProc) Stdin() io.WriteCloser           { return nil }
func (p *fakeScanProc) Wait() (gitclient.Result, error) { return p.res, nil }
func (p *fakeScanProc) Close() error                    { p.once.Do(func() { close(p.closed) }); return nil }

func fakeScanOptions(budget time.Duration) Options {
	m, err := Compile(Query{Text: "x"})
	if err != nil {
		panic(err)
	}
	return Options{Args: []string{"log"}, Matcher: m, Budget: budget}
}

// A scan whose git emits nothing still ends at the budget, Complete=false.
func TestScan_BudgetFiresWhileGitEmitsNothing(t *testing.T) {
	t.Parallel()
	proc := newFakeScanProc("", true, gitclient.Result{})
	done := make(chan struct{})
	var res Result
	var err error
	go func() {
		res, err = Scan(context.Background(), Deps{Runner: fakeScanRunner{proc}}, fakeScanOptions(50*time.Millisecond))
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Scan still blocked long after its budget")
	}
	if err != nil || res.Complete {
		t.Fatalf("res=%+v err=%v, want Complete=false and no error", res, err)
	}
}

// git's own failure outranks a partial trailing record.
func TestScan_GitFailureOutranksUnterminatedRecord(t *testing.T) {
	t.Parallel()
	proc := newFakeScanProc("abc\x00partial", false, gitclient.Result{ExitCode: 128, Stderr: []byte("fatal: bad object deadbeef")})
	_, err := Scan(context.Background(), Deps{Runner: fakeScanRunner{proc}}, fakeScanOptions(time.Minute))
	var gerr *gitclient.Error
	if !errors.As(err, &gerr) || !strings.Contains(gerr.Stderr, "bad object") {
		t.Fatalf("err = %v, want classified git failure carrying stderr", err)
	}
}
