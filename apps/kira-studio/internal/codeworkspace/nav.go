package codeworkspace

import (
	"context"
	"os"
	"path/filepath"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codegraph"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeindex"
)

// NavTarget is one definition candidate, carrying codegraph's own Rule/Confidence through
// untouched (C6 §6) — the renderer follows internal/repomap/render.go's discipline that a
// repoWide guess must never read like a fact.
type NavTarget struct {
	Path       string `json:"path"`
	Language   string `json:"language"`
	Kind       string `json:"kind"`
	Name       string `json:"name"`
	Container  string `json:"container"`
	Rule       string `json:"rule"`       // codegraph's own, e.g. "sameFile.enclosing"
	Confidence string `json:"confidence"` // exact | scoped | repoWide

	// The identifier's own span, 1-based line, 1-based UTF-16 column — a Monaco IRange as-is.
	StartLine   int `json:"startLine"`
	StartColumn int `json:"startColumn"`
	EndLine     int `json:"endLine"`
	EndColumn   int `json:"endColumn"`
}

// NavResult is Definitions's own wire shape.
type NavResult struct {
	Status  string      `json:"status"` // ready | indexing | unavailable
	Name    string      `json:"name"`
	Targets []NavTarget `json:"targets"`
}

// Definitions resolves the name at (line, column) in relPath to its definition(s) (C6 §6). line
// and column are Monaco's own 1-based line and 1-based UTF-16 column.
func Definitions(ctx context.Context, s *Session, store *codeindex.Store, relPath string, line, column int) (NavResult, error) {
	absPath, err := ValidateRelPath(s.Root, relPath)
	if err != nil {
		return NavResult{}, err
	}

	graph, ready := s.graphAndReady()
	if graph == nil || ready == nil {
		return NavResult{Status: "indexing"}, nil
	}
	select {
	case <-ready:
	default:
		// D8: never wait — a hover that hangs is worse than one that says "still building" and
		// gets asked again on the next dwell.
		return NavResult{Status: "indexing"}, nil
	}

	if _, ok, err := store.GetFile(ctx, s.IndexRepoID, relPath); err != nil {
		return NavResult{}, err
	} else if !ok {
		// Not in the index at all: an unparsed language, a file over C1's 2 MiB parse cap, or a
		// path added since the last sync — a real lookup, not a string match on codegraph's own
		// error text.
		return NavResult{Status: "unavailable"}, nil
	}

	data, err := os.ReadFile(absPath) //nolint:gosec // absPath already validated (ValidateRelPath).
	if err != nil {
		return NavResult{}, err
	}
	li := NewLineIndex(data)
	off := li.ByteOffset(line, column)

	targets, err := graph.DefinitionOf(ctx, codegraph.Query{Path: relPath, Byte: off})
	if err != nil {
		return NavResult{}, err
	}
	if len(targets) == 0 {
		return NavResult{Status: "ready"}, nil
	}

	lineIndexes := map[string]*LineIndex{relPath: li}
	navTargets := make([]NavTarget, len(targets))
	name := targets[0].Name
	for i, t := range targets {
		fileLI, ok := lineIndexes[t.Path]
		if !ok {
			if fileData, err := os.ReadFile(filepath.Join(s.Root, t.Path)); err == nil { //nolint:gosec // t.Path is codegraph's own indexed, repository-relative path.
				fileLI = NewLineIndex(fileData)
			}
			lineIndexes[t.Path] = fileLI
		}

		var startLine, startColumn, endLine, endColumn int
		if fileLI != nil {
			startLine, startColumn = fileLI.Position(t.NameSpan.Start.Row, t.NameSpan.Start.Column)
			endLine, endColumn = fileLI.Position(t.NameSpan.End.Row, t.NameSpan.End.Column)
		} else {
			// The target file could not be read (deleted since the index last saw it, a
			// permission error) — fall back rather than failing the whole call.
			startLine, startColumn = t.NameSpan.Start.Row+1, 1
			endLine, endColumn = t.NameSpan.End.Row+1, 1
		}

		navTargets[i] = NavTarget{
			Path:        t.Path,
			Language:    t.Language,
			Kind:        t.Kind,
			Name:        t.Name,
			Container:   t.Container,
			Rule:        t.Rule,
			Confidence:  string(t.Confidence),
			StartLine:   startLine,
			StartColumn: startColumn,
			EndLine:     endLine,
			EndColumn:   endColumn,
		}
	}

	return NavResult{Status: "ready", Name: name, Targets: navTargets}, nil
}
