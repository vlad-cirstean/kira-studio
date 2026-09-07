package porcelain

import (
	"bytes"
	"fmt"
	"regexp"
	"strconv"
)

// FileDiffArgs is one file's unified patch, from a commit against a chosen parent (probe P2's own
// pathspec rule: originalPath must be named alongside path for a rename to render as a rename
// rather than a whole-file add). from == nil selects a root commit's diff against the empty tree.
// No --no-optional-locks here — buildArgv already places it at git level for a ReadOnly spec.
func FileDiffArgs(from *string, to, path string, originalPath *string) []string {
	args := []string{
		"diff-tree", "-r", "-p", "-M", "-C", "--no-commit-id",
		"--no-color", "--no-ext-diff", "--no-textconv", "-z", "--unified=3",
	}
	args = appendRevPair(args, from, to)
	args = append(args, "--")
	if originalPath != nil {
		args = append(args, *originalPath, path)
	} else {
		args = append(args, path)
	}
	return args
}

// WorktreeDiffArgs is the drift re-map's own spawn (D4/D8): rev's version of path against the
// working tree, renames turned off (a re-map only ever tracks one path, never a rename it did not
// ask about). Probe P6: no --no-optional-locks — after the subcommand it is git-level only and
// exits 129; buildArgv already places it correctly ahead of "diff".
func WorktreeDiffArgs(rev, path string) []string {
	return []string{
		"diff", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", "-z", "--unified=3",
		rev, "--", path,
	}
}

// DiffLineKind mirrors @kira/git-ipc's own DiffLineKind verbatim.
type DiffLineKind string

const (
	LineContext DiffLineKind = "context"
	LineAdd     DiffLineKind = "add"
	LineDel     DiffLineKind = "del"
)

// DiffLine mirrors @kira/git-ipc's own DiffLine (D5) — OldLine/NewLine are Go pointers with
// omitempty (undefined on the wire when not meaningful for Kind).
type DiffLine struct {
	Kind           DiffLineKind `json:"kind"`
	Text           string       `json:"text"`
	OldLine        *int         `json:"oldLine,omitempty"`
	NewLine        *int         `json:"newLine,omitempty"`
	NoNewlineAtEof bool         `json:"noNewlineAtEof"`
}

// DiffHunk mirrors @kira/git-ipc's own DiffHunk verbatim.
type DiffHunk struct {
	OldStart int        `json:"oldStart"`
	OldLines int        `json:"oldLines"`
	NewStart int        `json:"newStart"`
	NewLines int        `json:"newLines"`
	Heading  string     `json:"heading"`
	Lines    []DiffLine `json:"lines"`
}

// ParsedBodyKind is ParsedBody's own discriminant — a narrower set than the wire's FileDiffBody
// (D5's §3.2 note): the binary arm here carries object ids, not byte sizes, and there is no
// tooLarge arm at all — both are decisions only gitsession.FileDiff (which owns the cat-file round
// trip and the size cap) can make.
type ParsedBodyKind string

const (
	ParsedText   ParsedBodyKind = "text"
	ParsedBinary ParsedBodyKind = "binary"
	// ParsedLFSPointer is the LFS sniff's own outcome: a single-hunk, whole-content add/replace
	// whose reconstructed new-side text matches the LFS pointer spec's first three required lines.
	ParsedLFSPointer ParsedBodyKind = "lfsPointer"
	ParsedEmpty      ParsedBodyKind = "empty"
)

// ParsedBody is ParseFileDiffBody's own result.
type ParsedBody struct {
	Kind ParsedBodyKind

	Hunks []DiffHunk // ParsedText

	OldOID, NewOID string // ParsedBinary — from the header's own `index <old>..<new>` line

	LFSOID   string // ParsedLFSPointer — verbatim after "oid " (e.g. "sha256:<hex>")
	LFSBytes int64  // ParsedLFSPointer — the pointer's own "size" field

	// EmptyReason is "modeChangeOnly" (old mode/new mode, nothing else) or "identical" (every
	// other empty-body case: a pure rename/copy with no content edit, or a header this package
	// could not find any content marker after).
	EmptyReason string
}

var indexLineRe = regexp.MustCompile(`^index ([0-9a-f]+)\.\.([0-9a-f]+)(?: \d+)?$`)
var hunkHeaderRe = regexp.MustCompile(`^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$`)

// lfsPointerRe matches the LFS pointer spec's three required lines, at the start of the
// reconstructed new-side text — trailing custom extension lines (the spec allows them) are not
// required to be absent.
var lfsPointerRe = regexp.MustCompile(`^version https://git-lfs\.github\.com/spec/v1\noid (sha256:[0-9a-f]{64})\nsize (\d+)(?:\n|$)`)

// ParseFileDiffBody parses one file's unified patch (FileDiffArgs' own stdout — always exactly one
// file, since the argv always pathspecs to it) into ParsedBody. The hunk state machine enforces
// its own counts invariant: a hunk whose header disagrees with its actual line counts is an error,
// never a half-rendered result (AGENTS.md's "no skipped validation").
func ParseFileDiffBody(raw []byte) (ParsedBody, error) {
	if len(raw) == 0 {
		return ParsedBody{Kind: ParsedEmpty, EmptyReason: "identical"}, nil
	}

	lines := bytes.Split(bytes.TrimSuffix(raw, []byte("\n")), []byte("\n"))

	var oldOID, newOID string
	var sawOldMode, sawNewMode bool
	i := 0
	for ; i < len(lines); i++ {
		line := lines[i]
		switch {
		case bytes.HasPrefix(line, []byte("Binary files ")) && bytes.HasSuffix(line, []byte(" differ")):
			if oldOID == "" || newOID == "" {
				return ParsedBody{}, fmt.Errorf("porcelain: binary diff with no index line")
			}
			return ParsedBody{Kind: ParsedBinary, OldOID: oldOID, NewOID: newOID}, nil
		case bytes.HasPrefix(line, []byte("@@ ")):
			hunks, err := parseHunks(lines[i:])
			if err != nil {
				return ParsedBody{}, err
			}
			return lfsOrText(hunks), nil
		case bytes.HasPrefix(line, []byte("index ")):
			m := indexLineRe.FindSubmatch(line)
			if m == nil {
				return ParsedBody{}, fmt.Errorf("porcelain: unrecognised index line %q", line)
			}
			oldOID, newOID = string(m[1]), string(m[2])
		case bytes.HasPrefix(line, []byte("old mode ")):
			sawOldMode = true
		case bytes.HasPrefix(line, []byte("new mode ")):
			sawNewMode = true
		}
	}

	if sawOldMode && sawNewMode {
		return ParsedBody{Kind: ParsedEmpty, EmptyReason: "modeChangeOnly"}, nil
	}
	return ParsedBody{Kind: ParsedEmpty, EmptyReason: "identical"}, nil
}

// lfsOrText applies the LFS sniff to a fully-parsed hunk list: exactly one hunk, every line a
// deletion or an addition (a pure add — a brand-new pointer file — or a pure replace — an existing
// pointer's oid changing; never a partial edit, which real LFS tooling never produces), whose
// reconstructed new-side text matches the pointer spec.
func lfsOrText(hunks []DiffHunk) ParsedBody {
	if len(hunks) == 1 {
		hunk := hunks[0]
		allAddOrDel := true
		var newText bytes.Buffer
		var lastAdd *DiffLine
		for i := range hunk.Lines {
			line := &hunk.Lines[i]
			if line.Kind == LineContext {
				allAddOrDel = false
				break
			}
			if line.Kind == LineAdd {
				newText.WriteString(line.Text)
				newText.WriteByte('\n')
				lastAdd = line
			}
		}
		if allAddOrDel && lastAdd != nil {
			text := newText.String()
			if lastAdd.NoNewlineAtEof {
				text = text[:len(text)-1]
			}
			if m := lfsPointerRe.FindStringSubmatch(text); m != nil {
				size, err := strconv.ParseInt(m[2], 10, 64)
				if err == nil {
					return ParsedBody{Kind: ParsedLFSPointer, LFSOID: m[1], LFSBytes: size}
				}
			}
		}
	}
	return ParsedBody{Kind: ParsedText, Hunks: hunks}
}

// parseHunks parses lines (starting at the first "@@" header) into DiffHunk. Caller already
// trimmed any trailing empty split-artifact element.
func parseHunks(lines [][]byte) ([]DiffHunk, error) {
	var hunks []DiffHunk
	i := 0
	for i < len(lines) {
		m := hunkHeaderRe.FindSubmatch(lines[i])
		if m == nil {
			return nil, fmt.Errorf("porcelain: expected a hunk header, got %q", lines[i])
		}
		hunk, consumed, err := parseOneHunk(m, lines[i+1:])
		if err != nil {
			return nil, err
		}
		hunks = append(hunks, hunk)
		i += 1 + consumed
	}
	return hunks, nil
}

func parseHunkCount(numStr, countStr []byte) (start, count int, err error) {
	start, err = strconv.Atoi(string(numStr))
	if err != nil {
		return 0, 0, fmt.Errorf("porcelain: hunk header start %q: %w", numStr, err)
	}
	if len(countStr) == 0 {
		return start, 1, nil
	}
	count, err = strconv.Atoi(string(countStr))
	if err != nil {
		return 0, 0, fmt.Errorf("porcelain: hunk header count %q: %w", countStr, err)
	}
	return start, count, nil
}

// parseOneHunk parses one hunk's header (already matched, m) plus exactly as many content lines
// (from rest) as its own oldLines/newLines counts call for — a `\ No newline at end of file` marker
// attaches to the line before it and is not itself counted. Returns how many of rest were
// consumed. A hunk whose header count is never satisfied by rest's actual content (EOF or the next
// "@@" reached first) is an error — the counts invariant AGENTS.md's "no skipped validation" rule
// exists for.
func parseOneHunk(m [][]byte, rest [][]byte) (DiffHunk, int, error) {
	oldStart, oldLines, err := parseHunkCount(m[1], m[2])
	if err != nil {
		return DiffHunk{}, 0, err
	}
	newStart, newLines, err := parseHunkCount(m[3], m[4])
	if err != nil {
		return DiffHunk{}, 0, err
	}
	hunk := DiffHunk{OldStart: oldStart, OldLines: oldLines, NewStart: newStart, NewLines: newLines, Heading: string(m[5])}

	oldLineNo, newLineNo := oldStart, newStart
	oldSeen, newSeen := 0, 0
	consumed := 0
	for consumed < len(rest) {
		line := rest[consumed]
		// A "\ No newline at end of file" marker always attaches to the line immediately before
		// it — checked ahead of the counts-satisfied break below, since it can trail the very
		// last line a satisfied count already accepted (probe: both sides of a modified
		// no-trailing-newline file each carry their own marker).
		if len(line) > 0 && line[0] == '\\' {
			if len(hunk.Lines) == 0 {
				return DiffHunk{}, 0, fmt.Errorf("porcelain: %q with no preceding line", line)
			}
			hunk.Lines[len(hunk.Lines)-1].NoNewlineAtEof = true
			consumed++
			continue
		}
		if oldSeen >= oldLines && newSeen >= newLines {
			break
		}
		if len(line) == 0 {
			return DiffHunk{}, 0, fmt.Errorf("porcelain: empty content line inside a hunk")
		}
		marker, text := line[0], string(line[1:])
		switch marker {
		case ' ':
			old, new := oldLineNo, newLineNo
			hunk.Lines = append(hunk.Lines, DiffLine{Kind: LineContext, Text: text, OldLine: &old, NewLine: &new})
			oldLineNo++
			newLineNo++
			oldSeen++
			newSeen++
		case '-':
			old := oldLineNo
			hunk.Lines = append(hunk.Lines, DiffLine{Kind: LineDel, Text: text, OldLine: &old})
			oldLineNo++
			oldSeen++
		case '+':
			new := newLineNo
			hunk.Lines = append(hunk.Lines, DiffLine{Kind: LineAdd, Text: text, NewLine: &new})
			newLineNo++
			newSeen++
		default:
			return DiffHunk{}, 0, fmt.Errorf("porcelain: unrecognised hunk line marker %q in %q", marker, line)
		}
		consumed++
	}
	if oldSeen != oldLines || newSeen != newLines {
		return DiffHunk{}, 0, fmt.Errorf(
			"porcelain: hunk @@ -%d,%d +%d,%d @@ counts disagreed with its content (saw -%d +%d)",
			oldStart, oldLines, newStart, newLines, oldSeen, newSeen,
		)
	}
	return hunk, consumed, nil
}

// HasDeletedPostImage reports whether raw (WorktreeDiffArgs' own stdout) shows a real, on-disk
// deletion — "deleted file mode" or "+++ /dev/null" appearing before the first hunk header — the
// un-indexed-but-on-disk case (a never-tracked path, or an identical file) never sets either.
func HasDeletedPostImage(raw []byte) bool {
	lines := bytes.Split(raw, []byte("\n"))
	for _, line := range lines {
		if bytes.HasPrefix(line, []byte("@@ ")) {
			return false
		}
		if bytes.HasPrefix(line, []byte("deleted file mode")) || bytes.Equal(line, []byte("+++ /dev/null")) {
			return true
		}
	}
	return false
}
