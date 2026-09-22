package codeworkspace

import (
	"context"
	"fmt"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient"
)

// EnumerateAll lists every tracked-plus-untracked-but-not-ignored file in root (§6), unfiltered —
// C5 §7.1's own project tree needs this: a tree that must show README.md/Taskfile.yml alongside
// every parseable source file has no use for a parseable-extension filter. Moved here (P97) from
// the deleted code-index package: ListFiles (files.go) and Search (search.go) are its only two
// callers left once P97 drops the parse/index/graph machinery that package used to own — the argv,
// the gitclient.Spec shape and the tier-2 path-byte rule (git's own bytes, never NFC-normalized)
// are unchanged.
func EnumerateAll(ctx context.Context, runner gitclient.Runner, gitPath, root string) ([]string, error) {
	args := []string{"ls-files", "-z", "--cached", "--others", "--exclude-standard"}
	res, err := gitclient.Run(ctx, runner, gitPath, gitclient.Spec{Dir: root, Args: args, ReadOnly: true})
	if cerr := gitclient.Classify(ctx, args, res, err); cerr != nil {
		return nil, fmt.Errorf("codeworkspace: git ls-files: %w", cerr)
	}

	out := strings.TrimRight(string(res.Stdout), "\x00")
	if out == "" {
		return nil, nil
	}
	return strings.Split(out, "\x00"), nil
}
