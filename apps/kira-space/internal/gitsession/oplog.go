package gitsession

import (
	"context"
	"errors"
	"path/filepath"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/oplog"
)

func (e *RepoEntry) startOp(ctx context.Context, kind, source string) *oplog.Op {
	root := repoWorkingDir(e.Summary)
	return e.opLog.Start(ctx, oplog.Meta{Category: oplog.CategoryGit, Kind: kind, RepoRoot: root, RepoName: filepath.Base(root), Source: source})
}

// recordFailure logs one finished failure that no running op covers (auto-fetch stop, graph load).
func (e *RepoEntry) recordFailure(ctx context.Context, kind, source, message string) {
	root := repoWorkingDir(e.Summary)
	e.opLog.Record(ctx, oplog.Meta{Category: oplog.CategoryGit, Kind: kind, RepoRoot: root, RepoName: filepath.Base(root), Source: source}, oplog.StatusError, message)
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
