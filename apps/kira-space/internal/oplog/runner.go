package oplog

import (
	"context"
	"errors"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient"
)

// RecordingRunner decorates the one shared gitclient.Runner so every git spawn lands in the log:
// as a step of the enclosing op in ctx, else as its own row.
type RecordingRunner struct {
	Inner gitclient.Runner
	Log   *Log
}

func NewRecordingRunner(inner gitclient.Runner, l *Log) gitclient.Runner {
	return &RecordingRunner{Inner: inner, Log: l}
}

func (r *RecordingRunner) Start(ctx context.Context, gitPath string, spec gitclient.Spec) (gitclient.Process, error) {
	// A persistent cat-file pair serves many requests; one row would read "running" for hours.
	if r.Log == nil || spec.Stdin {
		return r.Inner.Start(ctx, gitPath, spec)
	}
	argv := RedactArgv(spec.Args)
	if step := OpFrom(ctx).BeginStep(argv, spec.ReadOnly); step != nil {
		p, err := r.Inner.Start(ctx, gitPath, spec)
		if err != nil {
			step.End(spawnStatus(ctx, err), nil, err.Error())
			return nil, err
		}
		return &recordedProcess{Process: p, ctx: ctx, spec: spec, finish: step.End}, nil
	}
	o, _ := OriginFrom(ctx)
	op := r.Log.Start(ctx, Meta{
		Category:   CategoryGit,
		Kind:       spawnKind(spec.Args),
		RepoRoot:   spec.Dir,
		RepoName:   filepath.Base(spec.Dir),
		Background: o.Background || spec.ReadOnly,
	})
	cmd := renderCommand(argv)
	op.SetCommand(cmd)
	p, err := r.Inner.Start(ctx, gitPath, spec)
	if err != nil {
		op.Finish(spawnStatus(ctx, err), err.Error())
		return nil, err
	}
	return &recordedProcess{Process: p, ctx: ctx, spec: spec, finish: func(status string, exit *int, stderr string) {
		msg := ""
		if status == StatusError {
			msg = errorText(exit, stderr)
		}
		op.Finish(status, msg)
	}}, nil
}

type recordedProcess struct {
	gitclient.Process
	ctx    context.Context
	spec   gitclient.Spec
	finish func(status string, exit *int, stderr string)
	once   sync.Once
}

func (p *recordedProcess) Wait() (gitclient.Result, error) {
	res, err := p.Process.Wait()
	p.once.Do(func() {
		switch {
		case err != nil:
			p.finish(spawnStatus(p.ctx, err), nil, err.Error())
		case p.ctx.Err() != nil:
			exit := res.ExitCode
			p.finish(StatusCancelled, &exit, "")
		case res.ExitCode == 0 || slices.Contains(p.spec.OKExits, res.ExitCode):
			exit := res.ExitCode
			p.finish(StatusOK, &exit, "")
		default:
			exit := res.ExitCode
			p.finish(StatusError, &exit, string(res.Stderr))
		}
	})
	return res, err
}

// Close without a Wait is a streaming reader stopping early.
func (p *recordedProcess) Close() error {
	err := p.Process.Close()
	p.once.Do(func() {
		if p.ctx.Err() != nil {
			p.finish(StatusCancelled, nil, "")
			return
		}
		p.finish(StatusOK, nil, "")
	})
	return err
}

func spawnStatus(ctx context.Context, err error) string {
	if ctx.Err() != nil || errors.Is(err, gitclient.ErrCancelled) || errors.Is(err, context.Canceled) {
		return StatusCancelled
	}
	return StatusError
}

func errorText(exit *int, stderr string) string {
	var b strings.Builder
	if exit != nil {
		b.WriteString("exit ")
		b.WriteString(strconv.Itoa(*exit))
	}
	if s := strings.TrimSpace(stderr); s != "" {
		if b.Len() > 0 {
			b.WriteString("\n\n")
		}
		b.WriteString(tail(s, maxStderrTail))
	}
	return b.String()
}

// spawnKind is the git subcommand: the first argument that is not an option or an option's value.
func spawnKind(args []string) string {
	for i := 0; i < len(args); i++ {
		a := args[i]
		if a == "-c" || a == "-C" || a == "--git-dir" || a == "--work-tree" {
			i++
			continue
		}
		if strings.HasPrefix(a, "-") {
			continue
		}
		return a
	}
	return "git"
}
