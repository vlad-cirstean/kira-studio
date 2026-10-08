package importer

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/go-git/go-git/v5/plumbing/format/gitignore"
)

const (
	KindMarkdown = "markdown"
	KindText     = "text"
)

// Caps bound one scan.
type Caps struct {
	MaxFileBytes int64
	MaxFiles     int
}

var DefaultCaps = Caps{MaxFileBytes: 256 << 10, MaxFiles: 2000}

// Candidate is a file that can be imported. Hash is the SHA-256 of its normalised text.
type Candidate struct {
	Path, Rel, Kind, Hash string
	Size                  int64
}

// Skip is a supported file that will not be imported, with the reason shown to the user.
type Skip struct {
	Path, Rel, Kind, Reason string
	Size                    int64
}

type ScanResult struct {
	Base  string
	Files []Candidate
	// Skipped lists supported-extension files left out, one reason each.
	Skipped []Skip
	// Ignored counts files with an unsupported extension, gitignored files and files inside skipped
	// directories. They are counted, not listed.
	Ignored   int
	Truncated bool
}

var kindByExt = map[string]string{
	".md": KindMarkdown, ".markdown": KindMarkdown, ".mdx": KindMarkdown,
	".txt": KindText, ".text": KindText, ".rst": KindText, ".adoc": KindText,
}

var skippedDirs = map[string]bool{
	"node_modules": true, "vendor": true, "dist": true, "build": true, "out": true, "target": true,
	"__pycache__": true, "venv": true,
}

func kindOf(name string) (string, bool) {
	k, ok := kindByExt[strings.ToLower(filepath.Ext(name))]
	return k, ok
}

var errTruncated = errors.New("scan stopped at file cap")

type scanner struct {
	ctx  context.Context
	caps Caps
	base string
	seen map[string]bool
	res  *ScanResult
}

// Scan walks the picked files and folders. Symlinks are never followed; hidden entries, common
// build and dependency directories and gitignored paths are skipped. Gitignore semantics come
// from each folder's own .gitignore files (global excludes are not read).
func Scan(ctx context.Context, roots []string, caps Caps) (ScanResult, error) {
	if len(roots) == 0 {
		return ScanResult{}, errors.New("importer: nothing to scan")
	}
	abs := make([]string, 0, len(roots))
	dirs := make([]string, 0, len(roots))
	isDir := make(map[string]bool, len(roots))
	for _, r := range roots {
		p, err := filepath.Abs(r)
		if err != nil {
			return ScanResult{}, err
		}
		if real, err := filepath.EvalSymlinks(p); err == nil {
			p = real
		}
		info, err := os.Stat(p)
		if err != nil {
			return ScanResult{}, fmt.Errorf("importer: %s: %w", r, err)
		}
		abs = append(abs, p)
		isDir[p] = info.IsDir()
		if info.IsDir() {
			dirs = append(dirs, p)
		} else {
			dirs = append(dirs, filepath.Dir(p))
		}
	}
	res := ScanResult{Base: commonDir(dirs)}
	s := &scanner{ctx: ctx, caps: caps, base: res.Base, seen: map[string]bool{}, res: &res}
	for _, p := range abs {
		var err error
		if isDir[p] {
			err = s.walk(p, nil, nil)
		} else {
			err = s.file(p, filepath.Base(p), true)
		}
		if errors.Is(err, errTruncated) {
			res.Truncated = true
			break
		}
		if err != nil {
			return ScanResult{}, err
		}
	}
	slices.SortFunc(res.Files, func(a, b Candidate) int { return strings.Compare(a.Rel, b.Rel) })
	slices.SortFunc(res.Skipped, func(a, b Skip) int { return strings.Compare(a.Rel, b.Rel) })
	return res, nil
}

func commonDir(dirs []string) string {
	common := strings.Split(dirs[0], string(filepath.Separator))
	for _, d := range dirs[1:] {
		parts := strings.Split(d, string(filepath.Separator))
		n := 0
		for n < len(common) && n < len(parts) && common[n] == parts[n] {
			n++
		}
		common = common[:n]
	}
	out := strings.Join(common, string(filepath.Separator))
	if out == "" {
		return string(filepath.Separator)
	}
	return out
}

// walk reads dir's entries in name order. rootRel is dir's path under its picked root (the
// gitignore domain); patterns from this dir's .gitignore apply to everything below it.
func (s *scanner) walk(dir string, rootRel []string, inherited []gitignore.Pattern) error {
	if err := s.ctx.Err(); err != nil {
		return err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("importer: read %s: %w", dir, err)
	}
	patterns := append(slices.Clone(inherited), readGitignore(filepath.Join(dir, ".gitignore"), rootRel)...)
	matcher := gitignore.NewMatcher(patterns)
	for _, e := range entries {
		name := e.Name()
		rel := append(slices.Clone(rootRel), name)
		full := filepath.Join(dir, name)
		switch {
		case e.Type()&os.ModeSymlink != 0:
			if _, ok := kindOf(name); ok && !strings.HasPrefix(name, ".") {
				if err := s.addSkip(full, name, "symlink", 0); err != nil {
					return err
				}
			} else {
				s.res.Ignored++
			}
		case e.IsDir():
			if strings.HasPrefix(name, ".") || skippedDirs[name] || matcher.Match(rel, true) {
				s.res.Ignored += countFiles(full)
				continue
			}
			if err := s.walk(full, rel, patterns); err != nil {
				return err
			}
		case e.Type().IsRegular():
			if strings.HasPrefix(name, ".") || matcher.Match(rel, false) {
				s.res.Ignored++
				continue
			}
			if err := s.file(full, name, false); err != nil {
				return err
			}
		}
	}
	return nil
}

// countFiles is a bounded count of the files under a skipped directory, for the "ignored" tally.
func countFiles(dir string) int {
	n := 0
	_ = filepath.WalkDir(dir, func(_ string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			n++
		}
		if n >= 100000 {
			return filepath.SkipAll
		}
		return nil
	})
	return n
}

func readGitignore(path string, domain []string) []gitignore.Pattern {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var ps []gitignore.Pattern
	for _, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSuffix(line, "\r")
		if strings.HasPrefix(line, "#") || strings.TrimSpace(line) == "" {
			continue
		}
		ps = append(ps, gitignore.ParsePattern(line, domain))
	}
	return ps
}

// file classifies one regular file. picked is true for a file the user chose directly.
func (s *scanner) file(full, name string, picked bool) error {
	if err := s.ctx.Err(); err != nil {
		return err
	}
	kind, ok := kindOf(name)
	if !ok {
		s.res.Ignored++
		return nil
	}
	if s.seen[full] {
		return nil
	}
	s.seen[full] = true
	_, hash, reason, err := ReadText(full, s.caps.MaxFileBytes)
	if err != nil {
		return s.addSkip(full, name, "unreadable: "+err.Error(), 0)
	}
	if reason != "" {
		size := int64(0)
		if info, err := os.Stat(full); err == nil {
			size = info.Size()
		}
		return s.addSkip(full, name, reason, size)
	}
	if len(s.res.Files) >= s.caps.MaxFiles {
		return errTruncated
	}
	info, err := os.Stat(full)
	if err != nil {
		return s.addSkip(full, name, "unreadable: "+err.Error(), 0)
	}
	s.res.Files = append(s.res.Files, Candidate{Path: full, Rel: s.rel(full), Kind: kind, Hash: hash, Size: info.Size()})
	return nil
}

func (s *scanner) addSkip(full, name, reason string, size int64) error {
	kind, _ := kindOf(name)
	if len(s.res.Skipped) >= s.caps.MaxFiles {
		s.res.Ignored++
		return nil
	}
	s.res.Skipped = append(s.res.Skipped, Skip{Path: full, Rel: s.rel(full), Kind: kind, Reason: reason, Size: size})
	return nil
}

func (s *scanner) rel(full string) string {
	r, err := filepath.Rel(s.base, full)
	if err != nil {
		return filepath.ToSlash(full)
	}
	return filepath.ToSlash(r)
}
