package codeworkspace

import (
	"context"
	"os"

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

// resolveQueryPoint runs Definitions/Implementations/References' own shared preamble (C6 §6, P78
// §7.2): validate relPath, check the workspace's own graph exists and is ready (never blocking —
// D8: a hover that hangs is worse than one that says "still building" and gets asked again on the
// next dwell), confirm the index actually has relPath, read its current bytes and convert
// (line, column) to a byte offset.
//
// status is "" when the caller should proceed — graph, li and off are then valid. Otherwise it's
// "indexing" or "unavailable" (or err is set), and the caller returns its own Status-only result
// immediately without touching graph/li, which are nil/zero in that case.
func resolveQueryPoint(ctx context.Context, s *Session, store *codeindex.Store, relPath string, line, column int) (graph *codegraph.Graph, li *LineIndex, off int, status string, err error) {
	absPath, err := ValidateRelPath(s.Root, relPath)
	if err != nil {
		return nil, nil, 0, "", err
	}

	graph, ready := s.graphAndReady()
	if graph == nil || ready == nil {
		return nil, nil, 0, "indexing", nil
	}
	select {
	case <-ready:
	default:
		return nil, nil, 0, "indexing", nil
	}

	if _, ok, err := store.GetFile(ctx, s.IndexRepoID, relPath); err != nil {
		return nil, nil, 0, "", err
	} else if !ok {
		// Not in the index at all: an unparsed language, a file over C1's 2 MiB parse cap, or a
		// path added since the last sync — a real lookup, not a string match on codegraph's own
		// error text.
		return nil, nil, 0, "unavailable", nil
	}

	data, err := os.ReadFile(absPath) //nolint:gosec // absPath already validated (ValidateRelPath).
	if err != nil {
		return nil, nil, 0, "", err
	}
	fileLI := NewLineIndex(data)
	return graph, fileLI, fileLI.ByteOffset(line, column), "", nil
}

// resolvePosition converts one result's own NameSpan to a 1-based line/1-based UTF-16 column pair
// — Definitions/Implementations/References' identical per-result step. lineIndexes caches a
// *LineIndex per path already read this call (relPath's own is seeded by the caller before the
// loop); a path not yet in it is read here.
//
// C13-13: path is codegraph's own indexed path, not re-validated on this read like relPath is in
// resolveQueryPoint above — a tracked/untracked symlink escaping s.Root at index time would
// otherwise have its target's bytes read here (only to count line breaks for a position, never
// returned to the caller, but still a real containment gap; the same class C13-8 already closed in
// codeindex/sync.go). ValidateRelPath's own failure is handled exactly like a missing/unreadable
// file: fileLI stays nil and the position falls back to one derived from NameSpan's own byte
// offset instead of failing the whole call.
func resolvePosition(s *Session, lineIndexes map[string]*LineIndex, path string, nameSpan codegraph.Span) (startLine, startColumn, endLine, endColumn int) {
	fileLI, ok := lineIndexes[path]
	if !ok {
		if targetAbs, err := ValidateRelPath(s.Root, path); err == nil {
			if fileData, err := os.ReadFile(targetAbs); err == nil { //nolint:gosec // targetAbs already validated (ValidateRelPath).
				fileLI = NewLineIndex(fileData)
			}
		}
		lineIndexes[path] = fileLI
	}

	if fileLI != nil {
		startLine, startColumn = fileLI.Position(nameSpan.Start.Row, nameSpan.Start.Column)
		endLine, endColumn = fileLI.Position(nameSpan.End.Row, nameSpan.End.Column)
		return startLine, startColumn, endLine, endColumn
	}
	// The target file could not be read (deleted since the index last saw it, a permission error)
	// — fall back rather than failing the whole call.
	return nameSpan.Start.Row + 1, 1, nameSpan.End.Row + 1, 1
}

// Definitions resolves the name at (line, column) in relPath to its definition(s) (C6 §6). line
// and column are Monaco's own 1-based line and 1-based UTF-16 column.
func Definitions(ctx context.Context, s *Session, store *codeindex.Store, relPath string, line, column int) (NavResult, error) {
	graph, li, off, status, err := resolveQueryPoint(ctx, s, store, relPath, line, column)
	if err != nil {
		return NavResult{}, err
	}
	if status != "" {
		return NavResult{Status: status}, nil
	}

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
		startLine, startColumn, endLine, endColumn := resolvePosition(s, lineIndexes, t.Path, t.NameSpan)
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

// Implementations resolves the name at (line, column) in relPath to its implementation(s) (P78
// §7.2) — a structural copy of Definitions with codegraph.ImplementationsOf in place of
// DefinitionOf; the wire shape is identical (NavTarget/NavResult), so no new type is needed.
func Implementations(ctx context.Context, s *Session, store *codeindex.Store, relPath string, line, column int) (NavResult, error) {
	graph, li, off, status, err := resolveQueryPoint(ctx, s, store, relPath, line, column)
	if err != nil {
		return NavResult{}, err
	}
	if status != "" {
		return NavResult{Status: status}, nil
	}

	targets, err := graph.ImplementationsOf(ctx, codegraph.Query{Path: relPath, Byte: off})
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
		startLine, startColumn, endLine, endColumn := resolvePosition(s, lineIndexes, t.Path, t.NameSpan)
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

// RefSite is one reference occurrence — References's own per-entry wire shape (P78 §7.2), codegraph.
// Site carried across the wire the same way NavTarget carries codegraph.Target: Rule has no
// counterpart here (Site itself has none), but Confidence and Enclosing do.
type RefSite struct {
	Path       string `json:"path"`
	Language   string `json:"language"`
	Kind       string `json:"kind"`
	Name       string `json:"name"`
	Enclosing  string `json:"enclosing"`  // innermost enclosing definition's name, "" at file top level
	Confidence string `json:"confidence"` // exact | scoped | repoWide

	StartLine   int `json:"startLine"`
	StartColumn int `json:"startColumn"`
	EndLine     int `json:"endLine"`
	EndColumn   int `json:"endColumn"`
}

// RefResult is References's own wire shape (P78 §7.2).
type RefResult struct {
	Status       string    `json:"status"` // ready | indexing | unavailable
	Name         string    `json:"name"`
	Sites        []RefSite `json:"sites"`
	Total        int       `json:"total"`
	Truncated    bool      `json:"truncated"`
	Unattributed int       `json:"unattributed"`
}

// References finds occurrences of the name at (line, column) in relPath (P78 §7.2) — Mode is always
// Resolved (§8.1: NameOnly is the MCP server's own recall-over-precision mode, wrong for a UI that
// cannot caveat an unattributed occurrence). includeDeclaration maps straight to
// RefOpts.IncludeDefinition, Monaco's own flag on ReferenceContext.
//
// Unlike Definitions/Implementations, an empty Sites slice does not short-circuit before Total/
// Truncated/Unattributed are set — those three can be non-zero (every occurrence unattributed, say)
// even when nothing is listed, and §7.3's status readout needs them regardless.
func References(ctx context.Context, s *Session, store *codeindex.Store, relPath string, line, column int, includeDeclaration bool) (RefResult, error) {
	graph, li, off, status, err := resolveQueryPoint(ctx, s, store, relPath, line, column)
	if err != nil {
		return RefResult{}, err
	}
	if status != "" {
		return RefResult{Status: status}, nil
	}

	refs, err := graph.ReferencesTo(ctx, codegraph.Query{Path: relPath, Byte: off}, codegraph.RefOpts{
		Mode: codegraph.Resolved, IncludeDefinition: includeDeclaration,
	})
	if err != nil {
		return RefResult{}, err
	}

	name := ""
	if len(refs.Sites) > 0 {
		name = refs.Sites[0].Name
	}

	lineIndexes := map[string]*LineIndex{relPath: li}
	refSites := make([]RefSite, len(refs.Sites))
	for i, site := range refs.Sites {
		startLine, startColumn, endLine, endColumn := resolvePosition(s, lineIndexes, site.Path, site.NameSpan)
		refSites[i] = RefSite{
			Path:        site.Path,
			Language:    site.Language,
			Kind:        site.Kind,
			Name:        site.Name,
			Enclosing:   site.Enclosing,
			Confidence:  string(site.Confidence),
			StartLine:   startLine,
			StartColumn: startColumn,
			EndLine:     endLine,
			EndColumn:   endColumn,
		}
	}

	return RefResult{
		Status: "ready", Name: name, Sites: refSites,
		Total: refs.Total, Truncated: refs.Truncated, Unattributed: refs.Unattributed,
	}, nil
}
