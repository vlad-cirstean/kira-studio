package porcelain

import (
	"fmt"
	"regexp"
	"strconv"
)

// StatusArgs is status.get's own spawn (D11). --untracked-files=normal, never "all": with
// "normal" an ignored file never appears in status, so it never enters the checkout-preflight
// intersection, matching git's own checkout behaviour exactly (an "all" scan would drag every
// build artefact into the dirty set and block checkouts a real terminal `git switch` would not).
func StatusArgs() []string {
	return []string{"status", "--porcelain=v2", "--branch", "--untracked-files=normal", "-z"}
}

// StatusBranchInfo is the "#" header's own parsed shape — OID's absence (Unborn) is probe P11's
// own "(initial)" signal, never a rev-parse spawn of its own.
type StatusBranchInfo struct {
	OID            string // "" when Unborn.
	Unborn         bool
	Detached       bool
	HeadName       string // "" when Detached.
	Upstream       string // "" when HasUpstream is false.
	HasUpstream    bool
	Ahead          int
	Behind         int
	HasAheadBehind bool
}

// StatusEntry is one non-header status record — deliberately narrower than upstream's own
// per-kind types (D11): only the fields something in this chapter reads (XY codes, path,
// original path, rename-vs-copy, similarity). Modes and object ids are framed and skipped, never
// parsed — nothing in G5/G12/G13 reads them.
type StatusEntry struct {
	Kind         string // "ordinary" | "renamed" | "unmerged" | "untracked" | "ignored"
	Staged       byte   // XY[0], '.' when unchanged in that position.
	Unstaged     byte   // XY[1].
	Path         string
	OriginalPath string // renamed only.
	RenameOrCopy string // "rename" | "copy" — renamed only.
	Similarity   int    // renamed only.
}

type StatusResult struct {
	Branch  StatusBranchInfo
	Entries []StatusEntry
}

var branchABRe = regexp.MustCompile(`^branch\.ab \+(\d+) -(\d+)$`)

func parseBranchHeader(lines []string) StatusBranchInfo {
	info := StatusBranchInfo{Detached: true}
	for _, line := range lines {
		switch {
		case hasField(line, "branch.oid "):
			value := line[len("branch.oid "):]
			if value == "(initial)" {
				info.Unborn = true
			} else {
				info.OID = value
			}
		case hasField(line, "branch.head "):
			value := line[len("branch.head "):]
			if value == "(detached)" {
				info.Detached = true
			} else {
				info.Detached = false
				info.HeadName = value
			}
		case hasField(line, "branch.upstream "):
			info.Upstream = line[len("branch.upstream "):]
			info.HasUpstream = true
		case hasField(line, "branch.ab "):
			if m := branchABRe.FindStringSubmatch(line); m != nil {
				info.Ahead, _ = strconv.Atoi(m[1])
				info.Behind, _ = strconv.Atoi(m[2])
				info.HasAheadBehind = true
			}
		}
	}
	return info
}

func hasField(line, prefix string) bool {
	return len(line) >= len(prefix) && line[:len(prefix)] == prefix
}

func codeAt(xy string, i int) byte {
	if i < len(xy) {
		return xy[i]
	}
	return '.'
}

func parseOrdinaryEntry(rec []byte) (StatusEntry, error) {
	fields := SplitLimitedFields(rec, ' ', 9)
	if len(fields) != 9 {
		return StatusEntry{}, fmt.Errorf("porcelain: status '1' record has %d fields, want 9", len(fields))
	}
	xy := string(fields[1])
	return StatusEntry{Kind: "ordinary", Staged: codeAt(xy, 0), Unstaged: codeAt(xy, 1), Path: string(fields[8])}, nil
}

func parseRenamedEntry(rec []byte, originalPath string) (StatusEntry, error) {
	fields := SplitLimitedFields(rec, ' ', 10)
	if len(fields) != 10 {
		return StatusEntry{}, fmt.Errorf("porcelain: status '2' record has %d fields, want 10", len(fields))
	}
	xy := string(fields[1])
	score := string(fields[8])
	renameOrCopy := "rename"
	similarity := 0
	if len(score) > 0 {
		if score[0] == 'C' {
			renameOrCopy = "copy"
		}
		if v, err := strconv.Atoi(score[1:]); err == nil {
			similarity = v
		}
	}
	return StatusEntry{
		Kind: "renamed", Staged: codeAt(xy, 0), Unstaged: codeAt(xy, 1),
		Path: string(fields[9]), OriginalPath: originalPath,
		RenameOrCopy: renameOrCopy, Similarity: similarity,
	}, nil
}

func parseUnmergedEntry(rec []byte) (StatusEntry, error) {
	fields := SplitLimitedFields(rec, ' ', 11)
	if len(fields) != 11 {
		return StatusEntry{}, fmt.Errorf("porcelain: status 'u' record has %d fields, want 11", len(fields))
	}
	xy := string(fields[1])
	return StatusEntry{Kind: "unmerged", Staged: codeAt(xy, 0), Unstaged: codeAt(xy, 1), Path: string(fields[10])}, nil
}

// ParseStatus parses StatusArgs' own already-NUL-split records. The '2' marker's rename/copy row
// carries its originalPath as a SEPARATE following record — consumed here even though only
// OriginalPath is read from it, since skipping it would misframe every record after it. An
// unrecognised marker is an error, not a skipped line.
func ParseStatus(records [][]byte) (StatusResult, error) {
	var headerLines []string
	var entries []StatusEntry
	for i := 0; i < len(records); i++ {
		rec := records[i]
		if len(rec) == 0 {
			continue
		}
		switch rec[0] {
		case '#':
			if len(rec) >= 2 {
				headerLines = append(headerLines, string(rec[2:]))
			}
		case '1':
			e, err := parseOrdinaryEntry(rec)
			if err != nil {
				return StatusResult{}, err
			}
			entries = append(entries, e)
		case '2':
			i++
			if i >= len(records) {
				return StatusResult{}, fmt.Errorf("porcelain: status '2' record missing its originalPath chunk")
			}
			e, err := parseRenamedEntry(rec, string(records[i]))
			if err != nil {
				return StatusResult{}, err
			}
			entries = append(entries, e)
		case 'u':
			e, err := parseUnmergedEntry(rec)
			if err != nil {
				return StatusResult{}, err
			}
			entries = append(entries, e)
		case '?':
			if len(rec) >= 2 {
				entries = append(entries, StatusEntry{Kind: "untracked", Path: string(rec[2:])})
			}
		case '!':
			if len(rec) >= 2 {
				entries = append(entries, StatusEntry{Kind: "ignored", Path: string(rec[2:])})
			}
		default:
			return StatusResult{}, fmt.Errorf("porcelain: unrecognised status record marker %q", string(rec[0]))
		}
	}
	return StatusResult{Branch: parseBranchHeader(headerLines), Entries: entries}, nil
}
