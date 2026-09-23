package codeworkspace

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient/catfile"
)

// DiffSide is one side of a HEAD-vs-worktree diff (C6 §5) — the same four-value classification
// FileContent already gives the worktree side, so a caller sees one consistent vocabulary for
// "what happened to this file" everywhere in the app.
type DiffSide struct {
	Kind       string `json:"kind"` // found | binary | tooLarge | missing
	Text       string `json:"text"`
	Bytes      int    `json:"bytes"`
	LimitBytes int    `json:"limitBytes"`
}

// DiffContent is ReadDiff's own wire shape — no status field (D12): the two sides already say what
// happened (HEAD missing means added, worktree missing means deleted, both present means
// modified), so a second `git status` spawn to restate that would be cost for nothing.
type DiffContent struct {
	Path     string   `json:"path"`
	Language string   `json:"language"`
	Head     DiffSide `json:"head"`
	Worktree DiffSide `json:"worktree"`
}

// ReadDiff reads relPath's own HEAD and worktree content for a diff tab (C6 §5) — validating
// relPath against the session's own root itself (§11's boundary), the one path-safety check every
// other read primitive already performs before ever touching disk.
func ReadDiff(ctx context.Context, s *Session, relPath string) (DiffContent, error) {
	absPath, err := ValidateRelPath(s.Root, relPath)
	if err != nil {
		return DiffContent{}, fmt.Errorf("codeworkspace: read diff: %w", err)
	}

	worktree, err := ReadFile(absPath, relPath)
	if err != nil {
		return DiffContent{}, fmt.Errorf("codeworkspace: read diff worktree side: %w", err)
	}

	head, err := readHeadSide(ctx, s, relPath)
	if err != nil {
		return DiffContent{}, fmt.Errorf("codeworkspace: read diff HEAD side: %w", err)
	}

	return DiffContent{
		Path:     relPath,
		Language: languageFor(relPath),
		Head:     head,
		Worktree: DiffSide{Kind: worktree.Kind, Text: worktree.Text, Bytes: worktree.Bytes, LimitBytes: worktree.LimitBytes},
	}, nil
}

// readHeadSide reads relPath as it stood at HEAD via the session's own lazily-constructed
// catfile.Session — the same 8 MiB gate as the worktree side (MaxReadBytes), not catfile's own
// larger default, so the two sides can never disagree about what is too large.
func readHeadSide(ctx context.Context, s *Session, relPath string) (DiffSide, error) {
	cf := s.catfileSession()
	rev := "HEAD:" + relPath

	var info catfile.ObjectInfo
	var data []byte
	var err error
	if strings.Contains(rev, "\n") {
		// gitsession.Blob's own guard, carried here verbatim: a newline anywhere in the request
		// desynchronises the one-line-in/one-line-out batch protocol for the life of the session,
		// so a path containing one must go through the one-shot, argv-only path instead.
		info, data, err = cf.ReadOneShot(ctx, rev)
	} else {
		info, data, err = cf.Read(ctx, rev)
	}

	switch {
	case errors.Is(err, catfile.ErrMissing):
		// A new file, an untracked file, or an unborn HEAD — all "no original" from the diff's
		// own point of view.
		return DiffSide{Kind: "missing", LimitBytes: MaxReadBytes}, nil
	case errors.Is(err, catfile.ErrTooLarge):
		return DiffSide{Kind: "tooLarge", LimitBytes: MaxReadBytes}, nil
	case err != nil:
		return DiffSide{}, err
	}

	sniffLen := len(data)
	if sniffLen > binarySniffBytes {
		sniffLen = binarySniffBytes
	}
	if strings.IndexByte(string(data[:sniffLen]), 0) >= 0 {
		return DiffSide{Kind: "binary", Bytes: int(info.Size), LimitBytes: MaxReadBytes}, nil
	}

	return DiffSide{Kind: "found", Text: string(data), Bytes: int(info.Size), LimitBytes: MaxReadBytes}, nil
}
