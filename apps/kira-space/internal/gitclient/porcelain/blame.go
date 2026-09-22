package porcelain

import (
	"bufio"
	"bytes"
	"fmt"
	"strconv"
)

// UncommittedBlameSHA is the sentinel commit git itself uses (probed directly, git 2.43.0) for a
// line whose content is not in any commit yet — a plain, on-disk, unstaged edit. Recognised by
// value, never by a separate boolean field on BlameLine (P5): both this package's own callers and
// @kira/git-ipc's wire consumer compare a blame result's SHA against this same literal.
const UncommittedBlameSHA = "0000000000000000000000000000000000000000"

// BlameLineArgs is P5's own single-line spawn: `git blame --line-porcelain -L <line>,<line> --
// <path>`. Probed directly: a range of exactly one line always produces exactly one, fully-headered
// hunk — the "same commit mentioned twice, second mention abbreviated" complication real
// `--porcelain` output can have never arises for a one-line request, which is what keeps
// ParseBlameLine (below) a single-hunk parser rather than a general multi-hunk one. `--` before
// path is load-bearing the same way it is in FileDiffArgs: a path this app receives is never
// trusted not to start with `-`, and `--` makes the following token unambiguously a pathspec
// regardless of its content — no separate option-injection guard is needed for path the way
// validRefArg guards a sha/rev string in gitrpc (path's own safety is filepath.Rel/escape-checked
// one layer up, in gitsession, the same way GoToTarget already is). `-z` was probed and confirmed
// to have no effect on blame's own output framing (unlike `worktree list -z`), so it is not part of
// this argv at all.
func BlameLineArgs(path string, line int) []string {
	return []string{
		"blame", "--line-porcelain", "-L", fmt.Sprintf("%d,%d", line, line), "--", path,
	}
}

// BlameLine is P5's own narrow result — only what the status bar renders, not every field
// --line-porcelain emits (previous/filename/boundary are read and discarded by ParseBlameLine,
// never surfaced here).
type BlameLine struct {
	SHA               string `json:"sha"`
	Author            string `json:"author"`
	AuthorTimeSeconds int64  `json:"authorTimeSeconds"`
	Summary           string `json:"summary"`
}

// ParseBlameLine parses exactly one hunk — the shape a `-L <n>,<n>` request always produces. The
// first line is the commit-info line (`<sha> <origLine> <finalLine> [<groupLineCount>]`), parsed by
// field position; every line after it is a `key value` attribute (cutFirstSpace, worktree.go, same
// package) until the tab-prefixed content line, which ends the record. Unrecognised attribute keys
// (author-mail, author-tz, committer*, previous, boundary, filename) are read only far enough to be
// skipped — the identical "unknown attribute ignored" contract ParseWorktreeList already documents,
// since none of them is anything the status bar renders, and a future git version's own new
// attribute line must not break this parser.
func ParseBlameLine(raw []byte) (BlameLine, error) {
	scanner := bufio.NewScanner(bytes.NewReader(raw))
	scanner.Buffer(make([]byte, 0, 4096), 1<<20)

	if !scanner.Scan() {
		return BlameLine{}, fmt.Errorf("porcelain: blame: empty output")
	}
	header := scanner.Text()
	sha, _, ok := cutFirstSpace(header)
	if !ok || len(sha) == 0 {
		return BlameLine{}, fmt.Errorf("porcelain: blame: malformed commit-info line %q", header)
	}

	line := BlameLine{SHA: sha}
	for scanner.Scan() {
		text := scanner.Text()
		if len(text) > 0 && text[0] == '\t' {
			// The tab-prefixed content line — ends this hunk's record. Nothing follows it in a
			// single-line (-L n,n) request.
			return line, nil
		}
		key, value, _ := cutFirstSpace(text)
		switch key {
		case "author":
			line.Author = value
		case "author-time":
			seconds, err := strconv.ParseInt(value, 10, 64)
			if err != nil {
				return BlameLine{}, fmt.Errorf("porcelain: blame: bad author-time %q: %w", value, err)
			}
			line.AuthorTimeSeconds = seconds
		case "summary":
			line.Summary = value
		default:
			// Unrecognised attribute (author-mail, author-tz, committer*, previous, boundary,
			// filename, or a future git version's own addition) — ignored, not an error.
		}
	}
	if err := scanner.Err(); err != nil {
		return BlameLine{}, fmt.Errorf("porcelain: blame: %w", err)
	}
	return BlameLine{}, fmt.Errorf("porcelain: blame: no content line found in %q", raw)
}
