package codeindex

import (
	"context"
	"fmt"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeparse"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
)

// EnumeratedFile is one path git reported, already resolved to the language it will be parsed as.
type EnumeratedFile struct {
	// Path is repository-relative, exactly as git reported it — never NFC-normalized (gitpath's
	// tier 2 rule): every one of these bytes is handed back to git later (a check-ignore call in
	// §7.1, a future cat-file lookup), where git does its own byte comparison against the index.
	Path     string
	Language codeparse.ID
}

// Enumerate lists every tracked-plus-untracked-but-not-ignored file in root that codeparse.Detect
// recognises (§3.1's extension map) — Enumerate is now a thin filter over EnumerateAll (D6),
// keeping exactly one `ls-files` invocation shape in the codebase rather than two independently
// drifting ones.
func Enumerate(ctx context.Context, runner gitclient.Runner, gitPath, root string) ([]EnumeratedFile, error) {
	paths, err := EnumerateAll(ctx, runner, gitPath, root)
	if err != nil {
		return nil, err
	}
	files := make([]EnumeratedFile, 0, len(paths))
	for _, p := range paths {
		lang, ok := codeparse.Detect(p)
		if !ok {
			continue
		}
		files = append(files, EnumeratedFile{Path: p, Language: lang})
	}
	return files, nil
}

// EnumerateAll lists every tracked-plus-untracked-but-not-ignored file in root (§6), unfiltered —
// C5 §7.1's own project tree needs this: a tree that must show README.md/Taskfile.yml alongside
// every parseable source file has no use for C1's parseable-extension filter, but the argv, the
// gitclient.Spec shape and the tier-2 path-byte rule (D2: git's own bytes, never NFC-normalized)
// stay identical to Enumerate's — .gitignore semantics are git's own, and a second implementation
// (or a third-party matcher) would drift.
func EnumerateAll(ctx context.Context, runner gitclient.Runner, gitPath, root string) ([]string, error) {
	args := []string{"ls-files", "-z", "--cached", "--others", "--exclude-standard"}
	res, err := gitclient.Run(ctx, runner, gitPath, gitclient.Spec{Dir: root, Args: args, ReadOnly: true})
	if cerr := gitclient.Classify(ctx, args, res, err); cerr != nil {
		return nil, fmt.Errorf("codeindex: git ls-files: %w", cerr)
	}

	out := strings.TrimRight(string(res.Stdout), "\x00")
	if out == "" {
		return nil, nil
	}
	return strings.Split(out, "\x00"), nil
}
