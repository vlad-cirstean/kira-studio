package porcelain

import "bytes"

// WorktreeListArgs is worktree.list's own spawn (D1): `git worktree list --porcelain -z`
// unconditionally — probe P2: `-z` shipped in git 2.36.0, below this app's 2.38 floor, so there is
// no fallback branch to maintain. `--porcelain -v` is rejected outright (probe P3: "fatal: options
// '--verbose' and '--porcelain' cannot be used together"), so this is the only flag combination
// that exists.
func WorktreeListArgs() []string {
	return []string{"worktree", "list", "--porcelain", "-z"}
}

// WorktreeRecord is one `worktree list --porcelain -z` record — a direct read of D1's own
// WorktreeEntry shape, minus the two fields (isCurrent, openElsewhere) that are not this package's
// job to compute (gitsession cross-references those against, respectively, this entry's own repo
// root and Registry.IsOpen).
type WorktreeRecord struct {
	Path           string
	Head           string // "" when the worktree has no commits yet (a fresh `worktree add --orphan` — not offered by this phase, but the parser must not choke on it).
	Branch         string // "" when detached or bare.
	Bare           bool
	Detached       bool
	LockedReason   string // "" when not locked; Locked distinguishes "locked with no reason given" from "not locked".
	Locked         bool
	PrunableReason string
	Prunable       bool
}

// ParseWorktreeList parses WorktreeListArgs' own raw stdout (probe P1): each attribute line is
// NUL-terminated (never LF — `-z` changes ALL of this subcommand's line terminators, not just the
// record separator), and one extra NUL ends each record, so two consecutive NUL bytes mark a
// record boundary. Splitting the whole byte stream on a single NUL delimiter therefore yields the
// attribute lines directly, with an empty token appearing exactly at each record boundary (and a
// final trailing empty token after the stream's own closing double-NUL) — no RecordSplitter/
// allRecords framing here, since those assume exactly one NUL per record, not one per attribute.
// An unrecognised attribute (a future git version's addition) is ignored, per D1's own doc comment
// on WorktreeEntry — never an error.
func ParseWorktreeList(raw []byte) ([]WorktreeRecord, error) {
	tokens := bytes.Split(raw, []byte{0})
	// The final split token is always "" (the stream's own closing double-NUL produces two
	// zero-length tokens in a row: the record terminator's empty attribute line, and everything
	// after the very last NUL, which is itself empty for a well-formed stream). Drop it so the loop
	// below never manufactures a phantom trailing zero-value record from it.
	if len(tokens) > 0 && len(tokens[len(tokens)-1]) == 0 {
		tokens = tokens[:len(tokens)-1]
	}

	var records []WorktreeRecord
	cur := WorktreeRecord{}
	has := false
	flush := func() {
		if has {
			records = append(records, cur)
		}
		cur = WorktreeRecord{}
		has = false
	}
	for _, tok := range tokens {
		line := string(tok)
		if line == "" {
			flush()
			continue
		}
		has = true
		key, value, _ := cutFirstSpace(line)
		switch key {
		case "worktree":
			cur.Path = value
		case "HEAD":
			cur.Head = value
		case "branch":
			cur.Branch = value
		case "bare":
			cur.Bare = true
		case "detached":
			cur.Detached = true
		case "locked":
			cur.Locked = true
			cur.LockedReason = value
		case "prunable":
			cur.Prunable = true
			cur.PrunableReason = value
		default:
			// Unknown attribute — ignored, not an error (D1's doc comment on WorktreeEntry).
		}
	}
	flush()
	return records, nil
}

// cutFirstSpace splits "key value" (worktree list's own attribute shape) on the first space —
// value is "" for a bare flag attribute ("bare", "detached") that carries no value at all, and
// found reports whether a space was present (the two-worded "locked <reason>"/"prunable <reason>"
// attributes may legally have an empty reason, so callers key off the attribute name, never off
// found).
func cutFirstSpace(s string) (key, value string, found bool) {
	for i := 0; i < len(s); i++ {
		if s[i] == ' ' {
			return s[:i], s[i+1:], true
		}
	}
	return s, "", false
}
