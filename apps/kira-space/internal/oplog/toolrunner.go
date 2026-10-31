package oplog

import (
	"context"
	"errors"
	"path/filepath"
	"strings"

	"github.com/kirathecat/kira-studio/internal/toolexec"
)

// ToolRunner is the spawn seam of a read-only CLI such as acli.
type ToolRunner interface {
	Run(ctx context.Context, path string, args []string) ([]byte, error)
}

// RecordingToolRunner decorates a ToolRunner so every call lands in the log as its own background
// row (a tracker read), which a failure promotes into the persisted history.
type RecordingToolRunner struct {
	Inner  ToolRunner
	Log    *Log
	Source string
}

func NewRecordingToolRunner(inner ToolRunner, l *Log, source string) *RecordingToolRunner {
	return &RecordingToolRunner{Inner: inner, Log: l, Source: source}
}

func (r *RecordingToolRunner) Run(ctx context.Context, path string, args []string) ([]byte, error) {
	if r.Log == nil {
		return r.Inner.Run(ctx, path, args)
	}
	op := r.Log.Start(ctx, Meta{Category: CategoryTracker, Kind: toolKind(args), Source: r.Source, Background: true})
	op.SetCommand(renderTool(filepath.Base(path), RedactArgv(args)))
	out, err := r.Inner.Run(ctx, path, args)
	switch {
	case err == nil:
		op.Finish(StatusOK, "")
	case ctx.Err() != nil || errors.Is(err, context.Canceled):
		op.Finish(StatusCancelled, "")
	default:
		var exec *toolexec.ExecError
		if errors.As(err, &exec) {
			op.Finish(StatusError, errorText(&exec.ExitCode, exec.Stderr))
		} else {
			op.Finish(StatusError, err.Error())
		}
	}
	return out, err
}

// toolKind is the subcommand path: `--version` reads "version", `jira workitem view KEY` reads "workitem view".
func toolKind(args []string) string {
	if len(args) > 0 && args[0] == "--version" {
		return "version"
	}
	if len(args) > 0 && args[0] == "jira" {
		args = args[1:]
	}
	var words []string
	for _, a := range args {
		if strings.HasPrefix(a, "-") || len(words) == 2 {
			break
		}
		words = append(words, a)
	}
	return strings.Join(words, " ")
}
