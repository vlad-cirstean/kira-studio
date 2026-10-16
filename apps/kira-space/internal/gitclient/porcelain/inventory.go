package porcelain

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitpath"
)

// InventoryFormat is BranchInventory's own for-each-ref format (P129 Part 2 §3): refname, tip,
// committer date, author identity, worktree path (empty for a review branch that only exists on the
// remote) and upstream tracking, %00-delimited — RefsFormat's own reasoning applies verbatim (NUL is
// the one byte git guarantees never appears inside a field value). NUL-terminated per field and framed
// by field count (splitNULRecords): %(worktreepath) can carry a raw newline.
// authoremail uses the :trim modifier -- %(authoremail) alone prints the raw "<addr>" envelope
// (angle brackets included), which would never match a plain `git config user.email` read and so
// would silently defeat every isMine comparison this format exists to feed (§0.11).
const InventoryFormat = "%(refname)%00%(objectname)%00%(committerdate:unix)%00%(authorname)%00" +
	"%(authoremail:trim)%00%(worktreepath)%00%(upstream)%00%(upstream:track)%00"

const inventoryFieldCount = 8

// InventoryArgs is BranchInventory's own spawn: every local and remote-tracking branch, newest
// commit first, excluding refs/remotes/*/HEAD's own symbolic pointer — HeadsRefsArgs' own exclusion
// pattern and reasoning (a phantom "HEAD" row is never a real branch to queue).
func InventoryArgs() []string {
	return []string{
		"for-each-ref", "--format=" + InventoryFormat, "--sort=-committerdate",
		"--exclude=refs/remotes/*/HEAD", "refs/heads", "refs/remotes",
	}
}

// InventoryRef is one parsed BranchInventory row (gitsession.RepoEntry.BranchInventory's own return
// element).
type InventoryRef struct {
	Ref, Short, Tip string // Ref: refs/heads/<b> | refs/remotes/<remote>/<b>; Short: <b>
	Remote          string // "" for a local branch
	CommitterUnix   int64
	AuthorName      string
	AuthorEmail     string
	WorktreePath    string // %(worktreepath); "" when not checked out anywhere
	Upstream        string // %(upstream) refname; "" when none
	UpstreamAhead   int
	UpstreamBehind  int
	UpstreamGone    bool
}

// splitInventoryRef mirrors classifyRef's own refs/heads-vs-refs/remotes split, but additionally
// peels a remote-tracking ref's own leading remote name off its short name (classifyRef's
// "remoteBranch" shortName keeps it on, the shape refs.list's own wire wants; BranchInventory's
// callers want the same short name space local and remote-only branches ever key on, §0.14).
func splitInventoryRef(refname string) (short, remote string) {
	switch {
	case strings.HasPrefix(refname, "refs/heads/"):
		return refname[len("refs/heads/"):], ""
	case strings.HasPrefix(refname, "refs/remotes/"):
		rest := refname[len("refs/remotes/"):]
		if i := strings.IndexByte(rest, '/'); i >= 0 {
			return rest[i+1:], rest[:i]
		}
		return rest, ""
	default:
		return refname, ""
	}
}

func parseInventoryRow(fields [][]byte) (InventoryRef, error) {
	if len(fields) != inventoryFieldCount {
		return InventoryRef{}, fmt.Errorf("porcelain: inventory record has %d fields, want %d", len(fields), inventoryFieldCount)
	}
	refname := string(fields[0])
	tip := string(fields[1])
	committerUnix, _ := strconv.ParseInt(string(fields[2]), 10, 64)
	authorName := string(fields[3])
	authorEmail := string(fields[4])
	// G27 D5c's own normalization (refs.go): agrees with gitsession's already-composed Root.
	worktreePath := gitpath.NFC(string(fields[5]))
	upstream := string(fields[6])
	trackRaw := string(fields[7])

	short, remote := splitInventoryRef(refname)
	ref := InventoryRef{
		Ref: refname, Short: short, Tip: tip, Remote: remote,
		CommitterUnix: committerUnix, AuthorName: authorName, AuthorEmail: authorEmail,
		WorktreePath: worktreePath, Upstream: upstream,
	}
	switch t := parseTrack(trackRaw).(type) {
	case RefTrack:
		ref.UpstreamAhead, ref.UpstreamBehind = t.Ahead, t.Behind
	case string: // "gone"
		ref.UpstreamGone = true
	}
	return ref, nil
}

// ParseInventory parses InventoryArgs' own NUL-framed stream (splitNULRecords); empty input is zero
// rows, not an error.
func ParseInventory(raw []byte) ([]InventoryRef, error) {
	records, err := splitNULRecords(raw, inventoryFieldCount)
	if err != nil {
		return nil, fmt.Errorf("porcelain: inventory stream: %w", err)
	}
	if records == nil {
		return nil, nil
	}
	rows := make([]InventoryRef, 0, len(records))
	for _, fields := range records {
		row, err := parseInventoryRow(fields)
		if err != nil {
			return nil, err
		}
		rows = append(rows, row)
	}
	return rows, nil
}
