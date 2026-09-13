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

// Enumerate lists every tracked-plus-untracked-but-not-ignored file in root (§6): tracked plus
// untracked-but-not-ignored is exactly the set worth indexing, and .gitignore semantics are git's
// own — a second implementation (or a third-party matcher) would drift. Filtered to §3.1's
// extension map inline: anything git reports that Detect doesn't recognise is not enumerated, not
// parsed, and gets no row.
//
// gitPath and runner come from the caller rather than this package running discovery itself:
// gitclient's own locator is macOS-only, and injection is what lets a test run against the git on
// PATH here.
func Enumerate(ctx context.Context, runner gitclient.Runner, gitPath, root string) ([]EnumeratedFile, error) {
	args := []string{"ls-files", "-z", "--cached", "--others", "--exclude-standard"}
	res, err := gitclient.Run(ctx, runner, gitPath, gitclient.Spec{Dir: root, Args: args, ReadOnly: true})
	if cerr := gitclient.Classify(ctx, args, res, err); cerr != nil {
		return nil, fmt.Errorf("codeindex: git ls-files: %w", cerr)
	}

	out := strings.TrimRight(string(res.Stdout), "\x00")
	if out == "" {
		return nil, nil
	}

	paths := strings.Split(out, "\x00")
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
