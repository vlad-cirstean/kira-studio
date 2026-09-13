package codeworkspace

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeindex"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
)

// MaxListedFiles is §7.1's own honest cap on a single IPC payload.
const MaxListedFiles = 200_000

// MaxReadBytes is §8.1's viewer cap — deliberately larger than C1's 2 MiB parse cap: showing a big
// file costs one allocation, parsing it costs symbols.
const MaxReadBytes = 8 * 1024 * 1024

// binarySniffBytes mirrors C1 §5.4's own rule: a NUL byte in the first 8 KiB marks a file binary.
const binarySniffBytes = 8 * 1024

// FileListing is §7.1's own wire shape — Paths as git reported them (repository-relative, never
// NFC-normalized), Status from one porcelain snapshot taken alongside the listing.
type FileListing struct {
	Paths     []string          `json:"paths"`
	Status    map[string]string `json:"status"`
	Truncated bool              `json:"truncated"`
}

// ListFiles lists every tracked-plus-untracked-but-not-ignored file in the session's root
// (codeindex.EnumerateAll, D6) plus one `git status --porcelain=v2` snapshot collapsed to the
// tree's four-value glyph — one ls-files spawn, one status spawn, run sequentially (this is a
// side-panel refresh, not a hot path worth the concurrency Read/Write's own gate exists for).
func ListFiles(ctx context.Context, s *Session) (FileListing, error) {
	paths, err := codeindex.EnumerateAll(ctx, s.Runner, s.GitPath, s.Root)
	if err != nil {
		return FileListing{}, fmt.Errorf("codeworkspace: list files: %w", err)
	}

	truncated := false
	if len(paths) > MaxListedFiles {
		paths = paths[:MaxListedFiles]
		truncated = true
	}

	status, err := statusOverlay(ctx, s)
	if err != nil {
		return FileListing{}, fmt.Errorf("codeworkspace: list files: %w", err)
	}

	return FileListing{Paths: paths, Status: status, Truncated: truncated}, nil
}

// statusOverlay runs one `git status --porcelain=v2 -z` and collapses every entry to the tree's
// own four-value status glyph, keyed by repository-relative path.
func statusOverlay(ctx context.Context, s *Session) (map[string]string, error) {
	args := porcelain.StatusArgs()
	res, err := gitclient.Run(ctx, s.Runner, s.GitPath, gitclient.Spec{Dir: s.Root, Args: args, ReadOnly: true})
	if cerr := gitclient.Classify(ctx, args, res, err); cerr != nil {
		return nil, fmt.Errorf("git status: %w", cerr)
	}
	splitter := porcelain.NewRecordSplitter(0)
	records, err := splitter.Push(res.Stdout)
	if err != nil {
		return nil, fmt.Errorf("split status: %w", err)
	}
	if flushed := splitter.Flush(); flushed != nil {
		return nil, fmt.Errorf("split status: unterminated trailing bytes: %q", flushed)
	}
	result, err := porcelain.ParseStatus(records)
	if err != nil {
		return nil, fmt.Errorf("parse status: %w", err)
	}

	out := map[string]string{}
	for _, e := range result.Entries {
		switch e.Kind {
		case "untracked":
			out[e.Path] = "?"
		case "ordinary", "renamed":
			// XY collapsed to the tree's own four-value set: 'A'/'D' win over a plain 'M' when
			// either the staged or unstaged code says so, since either one is a real difference
			// from HEAD worth calling out distinctly from an ordinary edit.
			out[e.Path] = collapseXY(e.Staged, e.Unstaged)
		case "unmerged":
			// A conflict has no dedicated glyph in this four-value set (M/A/D/?) — 'M' is the
			// honest nearest value: real content differs from HEAD, which is what the tree's
			// coloring communicates either way.
			out[e.Path] = "M"
		}
	}
	return out, nil
}

func collapseXY(staged, unstaged byte) string {
	for _, c := range [2]byte{staged, unstaged} {
		switch c {
		case 'A':
			return "A"
		case 'D':
			return "D"
		}
	}
	return "M"
}

// FileContent is §8.1's own wire shape, mirroring the git contract's own `file.read` result shape
// (found/tooLarge) plus `missing` (a path git listed that no longer exists) and `language` (this
// app's own id, §9.4 — resolved from the extension only, never sniffed).
type FileContent struct {
	Kind       string `json:"kind"` // found | binary | tooLarge | missing
	Text       string `json:"text"`
	Bytes      int    `json:"bytes"`
	LimitBytes int    `json:"limitBytes"`
	Language   string `json:"language"`
}

// ReadFile reads relPath (already validated by ValidateRelPath) and classifies it per §8.1: a NUL
// byte in the first 8 KiB is binary (C1 §5.4's own rule), a file above MaxReadBytes is tooLarge
// (checked via a stat before reading its bytes, not after loading it whole), a missing file
// (deleted since ListFiles ran) reports `missing` rather than erroring the whole call.
func ReadFile(absPath, relPath string) (FileContent, error) {
	limit := FileContent{LimitBytes: MaxReadBytes, Language: languageFor(relPath)}

	info, err := os.Stat(absPath)
	if os.IsNotExist(err) {
		limit.Kind = "missing"
		return limit, nil
	}
	if err != nil {
		return FileContent{}, fmt.Errorf("codeworkspace: stat %s: %w", relPath, err)
	}
	if info.IsDir() {
		limit.Kind = "missing"
		return limit, nil
	}
	if info.Size() > MaxReadBytes {
		limit.Kind = "tooLarge"
		limit.Bytes = int(info.Size())
		return limit, nil
	}

	data, err := os.ReadFile(absPath) //nolint:gosec // absPath already validated (ValidateRelPath).
	if err != nil {
		if os.IsNotExist(err) {
			limit.Kind = "missing"
			return limit, nil
		}
		return FileContent{}, fmt.Errorf("codeworkspace: read %s: %w", relPath, err)
	}

	sniffLen := len(data)
	if sniffLen > binarySniffBytes {
		sniffLen = binarySniffBytes
	}
	if strings.IndexByte(string(data[:sniffLen]), 0) >= 0 {
		limit.Kind = "binary"
		limit.Bytes = len(data)
		return limit, nil
	}

	limit.Kind = "found"
	limit.Bytes = len(data)
	limit.Text = string(data)
	return limit, nil
}

// languageFor resolves this app's own language id from relPath's extension only (§8.1: "never
// sniffed") — the exact vocabulary §9.4 registers as a Monarch contribution, plus 'plaintext' for
// everything else. Independent of codeparse's own (Go-side, parse-coverage) table and of
// views/repo/language.ts (frontend-side, by design — §9.4: "different sets for different
// purposes... pretending otherwise would drag one to the other's shape"); this is a third,
// intentionally small copy that exists only to answer this one wire field.
func languageFor(relPath string) string {
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(relPath), "."))
	base := strings.ToLower(filepath.Base(relPath))
	switch base {
	case "dockerfile":
		return "dockerfile"
	}
	switch ext {
	case "ts", "tsx", "mts", "cts":
		return "typescript"
	case "js", "jsx", "mjs", "cjs":
		return "javascript"
	case "vue", "svelte":
		// §9.4: no Monaco grammar exists for either — both color with the HTML grammar.
		return "html"
	case "json", "jsonc":
		return "json"
	case "java":
		return "java"
	case "py":
		return "python"
	case "go":
		return "go"
	case "rs":
		return "rust"
	case "html", "htm":
		return "html"
	case "css":
		return "css"
	case "scss":
		return "scss"
	case "less":
		return "less"
	case "md", "markdown":
		return "markdown"
	case "yaml", "yml":
		return "yaml"
	case "xml":
		return "xml"
	case "sh", "bash", "zsh":
		return "shell"
	case "sql":
		return "sql"
	case "ini", "cfg", "toml":
		return "ini"
	case "graphql", "gql":
		return "graphql"
	case "proto":
		return "protobuf"
	default:
		return "plaintext"
	}
}
