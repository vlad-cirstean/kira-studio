package ade

import (
	"context"
	"log/slog"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/codeworkspace"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitreview"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
)

// review_working.go: review of the uncommitted work in a branch's worktree (P418). The worktree
// path comes from the branch row, never from the caller. This file reads bytes and hands them to
// gitsession, which owns the review logic.

// workingReview is one branch's worktree, resolved.
type workingReview struct {
	entry    *gitsession.RepoEntry
	worktree string
	head     string // worktree HEAD, "" when unborn
	branch   string // review session branch spelling
}

func (b *TaskBoard) workingReview(ctx context.Context, branchID string) (*workingReview, error) {
	entry, sb, worktree, err := b.reviewWorktree(ctx, branchID)
	if err != nil {
		return nil, err
	}
	if worktree == "" {
		return nil, invalid("the branch has no worktree")
	}
	branch, _, err := b.reviewSpellings(ctx, entry, sb)
	if err != nil {
		return nil, err
	}
	_, head, err := entry.WorktreeHead(ctx, worktree)
	if err != nil {
		return nil, err
	}
	return &workingReview{entry: entry, worktree: worktree, head: head, branch: branch}, nil
}

// workingSide maps a diff side to review content: text within the snapshot cap, else its kind.
func workingSide(s codeworkspace.DiffSide) gitsession.WorkingContent {
	switch s.Kind {
	case "found":
		if len(s.Text) > gitreview.MaxSnapshotBytes {
			return gitsession.NewWorkingContent(gitreview.ContentTooLarge, nil, len(s.Text))
		}
		return gitsession.NewWorkingContent(gitreview.ContentText, []byte(s.Text), len(s.Text))
	case "binary":
		return gitsession.NewWorkingContent(gitreview.ContentBinary, nil, s.Bytes)
	case "tooLarge":
		return gitsession.NewWorkingContent(gitreview.ContentTooLarge, nil, s.Bytes)
	}
	return gitsession.NewWorkingContent(gitreview.ContentAbsent, nil, 0)
}

// read returns path's HEAD side and current worktree content.
func (w *workingReview) read(ctx context.Context, path string) (head, cur gitsession.WorkingContent, err error) {
	if _, err := codeworkspace.ValidateRelPath(w.worktree, path); err != nil {
		return head, cur, invalid("bad path: %v", err)
	}
	cf := w.entry.CatFile()
	if cf == nil {
		return head, cur, invalid("the repo is closing")
	}
	d, err := codeworkspace.ReadDiffAt(ctx, cf, w.worktree, w.head, path)
	if err != nil {
		return head, cur, err
	}
	return workingSide(d.Head), workingSide(d.Worktree), nil
}

func (w *workingReview) current(ctx context.Context, path string) (gitsession.WorkingContent, error) {
	_, cur, err := w.read(ctx, path)
	return cur, err
}

// promote moves uncommitted review state onto commits made since it was taken.
func (w *workingReview) promote(ctx context.Context) ([]string, error) {
	paths, err := w.entry.PromoteWorkingReview(ctx, w.branch, w.head)
	if paths == nil {
		paths = []string{}
	}
	return paths, err
}

// promoteBranchReview runs promotion for a branch row; used where a window opens or comments leave.
func (b *TaskBoard) promoteBranchReview(ctx context.Context, sb model.AdeTaskBranch) error {
	entry, err := b.openRepo(ctx, sb.CodeRepoID)
	if err != nil {
		return err
	}
	branch, _, err := b.reviewSpellings(ctx, entry, sb)
	if err != nil {
		return err
	}
	worktree, err := b.worktreeOf(ctx, sb)
	if err != nil || worktree == "" {
		return err
	}
	_, head, err := entry.WorktreeHead(ctx, worktree)
	if err != nil {
		return err
	}
	_, err = entry.PromoteWorkingReview(ctx, branch, head)
	return err
}

// ReviewWorkingFile is one uncommitted file's diff with its reviewed ranges.
func (b *TaskBoard) ReviewWorkingFile(ctx context.Context, branchID, path string) (adewire.ReviewWorkingFileReview, error) {
	w, err := b.workingReview(ctx, branchID)
	if err != nil {
		return adewire.ReviewWorkingFileReview{}, err
	}
	head, cur, err := w.read(ctx, path)
	if err != nil {
		return adewire.ReviewWorkingFileReview{}, err
	}
	res, err := w.entry.WorkingFileReview(ctx, w.branch, path, head, cur)
	if err != nil {
		return adewire.ReviewWorkingFileReview{}, err
	}
	return adewire.ReviewWorkingFileReview{
		Path: res.Path, Body: res.Body, ReviewedRanges: res.ReviewedRanges, LineCount: res.LineCount, ContentKind: res.ContentKind,
		ContentHash: cur.Hash,
	}, nil
}

// ReviewWorkingMark marks or unmarks uncommitted files, whole or by ranges.
func (b *TaskBoard) ReviewWorkingMark(ctx context.Context, args adewire.ReviewWorkingMarkArgs) (adewire.ReviewWorkingMarkResult, error) {
	w, err := b.workingReview(ctx, args.BranchID)
	if err != nil {
		return adewire.ReviewWorkingMarkResult{}, err
	}
	// A commit since the last refresh must land before this mark rewrites the record's head.
	if _, err := w.promote(ctx); err != nil {
		return adewire.ReviewWorkingMarkResult{}, err
	}
	files := make([]adewire.ReviewWorkingMarkFile, 0, len(args.Paths))
	for _, path := range args.Paths {
		_, cur, err := w.read(ctx, path)
		if err != nil {
			return adewire.ReviewWorkingMarkResult{}, err
		}
		if args.ContentHash != "" && args.ContentHash != cur.Hash {
			return adewire.ReviewWorkingMarkResult{}, ErrWorkingChanged
		}
		st, err := w.entry.MarkWorkingFile(ctx, w.branch, path, cur, w.head, args.Reviewed, args.Ranges)
		if err != nil {
			return adewire.ReviewWorkingMarkResult{}, err
		}
		files = append(files, adewire.ReviewWorkingMarkFile{Path: path, Review: st})
	}
	return adewire.ReviewWorkingMarkResult{Files: files}, nil
}

// ReviewWorkingComments lists the uncommitted-origin comments anchored to the current worktree.
func (b *TaskBoard) ReviewWorkingComments(ctx context.Context, branchID string) (adewire.ReviewWorkingCommentsResult, error) {
	w, err := b.workingReview(ctx, branchID)
	if err != nil {
		return adewire.ReviewWorkingCommentsResult{}, err
	}
	if _, err := w.promote(ctx); err != nil {
		return adewire.ReviewWorkingCommentsResult{}, err
	}
	cs, err := w.entry.ListWorkingComments(ctx, w.branch, func(path string) (gitsession.WorkingContent, error) {
		return w.current(ctx, path)
	})
	if err != nil {
		return adewire.ReviewWorkingCommentsResult{}, err
	}
	return adewire.ReviewWorkingCommentsResult{Comments: cs}, nil
}

// ReviewWorkingCommentAdd adds a comment on uncommitted text.
func (b *TaskBoard) ReviewWorkingCommentAdd(ctx context.Context, args adewire.ReviewWorkingCommentAddArgs) (gitsession.CommentEntry, error) {
	w, err := b.workingReview(ctx, args.BranchID)
	if err != nil {
		return gitsession.CommentEntry{}, err
	}
	if _, err := w.promote(ctx); err != nil {
		return gitsession.CommentEntry{}, err
	}
	cur, err := w.current(ctx, args.Path)
	if err != nil {
		return gitsession.CommentEntry{}, err
	}
	if args.ContentHash != "" && args.ContentHash != cur.Hash {
		return gitsession.CommentEntry{}, ErrWorkingChanged
	}
	return w.entry.AddWorkingComment(ctx, w.branch, args.Path, cur, w.head, args.Range, args.Body, args.Kind)
}

// warnPromote logs a promotion failure where it must not block the caller.
func warnPromote(branchID string, err error) {
	slog.Warn("ade: promote uncommitted review", "scope", "ade", "branch", branchID, "err", err)
}
