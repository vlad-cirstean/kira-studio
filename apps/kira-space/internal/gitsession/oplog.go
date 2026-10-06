package gitsession

import (
	"context"
	"errors"
	"path/filepath"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/oplog"
)

type opCtxKey struct{}

// withOp carries the op handle down to the write spawn sites, so each records its own argv.
func withOp(ctx context.Context, op *oplog.Op) context.Context {
	if op == nil {
		return ctx
	}
	return context.WithValue(ctx, opCtxKey{}, op)
}

func opFrom(ctx context.Context) *oplog.Op {
	op, _ := ctx.Value(opCtxKey{}).(*oplog.Op)
	return op
}

func (e *RepoEntry) startOp(kind, source string) *oplog.Op {
	root := repoWorkingDir(e.Summary)
	return e.opLog.Start(oplog.Meta{Kind: kind, RepoRoot: root, RepoName: filepath.Base(root), Source: source})
}

// recordFailure logs one finished failure that no running op covers (auto-fetch stop, graph load).
func (e *RepoEntry) recordFailure(kind, source, message string) {
	root := repoWorkingDir(e.Summary)
	e.opLog.Record(oplog.Meta{Kind: kind, RepoRoot: root, RepoName: filepath.Base(root), Source: source}, oplog.StatusError, message)
}

// noteWrite records argv on the op carried by ctx, immediately before a write spawn.
func (e *RepoEntry) noteWrite(ctx context.Context, argv []string) {
	opFrom(ctx).AddCommand(argv)
}

func connLabelOf(conn *Conn) string {
	if conn == nil {
		return ""
	}
	return conn.ClientLabel
}

// finishOp maps an entry point's outcome onto a log status. errKind is the classified error's
// Kind ("" when none); err is a genuine Go error.
func finishOp(op *oplog.Op, ok bool, errKind, errMsg string, err error) {
	switch {
	case errors.Is(err, gitclient.ErrCancelled), errors.Is(err, context.Canceled):
		op.Finish(oplog.StatusCancelled, "")
	case err != nil:
		op.Finish(oplog.StatusError, err.Error())
	case errKind == "Cancelled":
		op.Finish(oplog.StatusCancelled, "")
	case !ok:
		op.Finish(oplog.StatusError, errMsg)
	default:
		op.Finish(oplog.StatusOK, "")
	}
}

func finishOpResult(op *oplog.Op, r OpResult, err error) {
	kind, msg := "", ""
	if r.Error != nil {
		kind, msg = r.Error.Kind, r.Error.Message
	}
	finishOp(op, r.OK, kind, msg, err)
}

func finishRemoteResult(op *oplog.Op, r RemoteOpResult, err error) {
	kind, msg := "", ""
	if r.Error != nil {
		kind, msg = r.Error.Kind, r.Error.Message
	}
	finishOp(op, r.OK, kind, msg, err)
}

func finishRestackResult(op *oplog.Op, r RestackResult, err error) {
	kind, msg := "", ""
	if r.Error != nil {
		kind, msg = r.Error.Kind, r.Error.Message
	}
	finishOp(op, r.OK, kind, msg, err)
}
