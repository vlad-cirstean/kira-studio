package bridge

import (
	"regexp"
	"strings"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/repos"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

// adeMaxMessageBytes bounds a message sent to or launched in a session: generous for a prompt, small
// enough that the quoted launch command stays under MaxCommandBytes.
const adeMaxMessageBytes = 32 * 1024

// adeMaxBranchBytes bounds a branch or item id.
const adeMaxBranchBytes = 255

var (
	adeJiraKeyRe = regexp.MustCompile(`^[A-Z][A-Z0-9]+-\d+$`)
	adeEstRe     = regexp.MustCompile(`^\d+(\.\d+)?[hd]$`)
)

const (
	adeMaxNotesBytes = 1 << 20 // 1 MiB
	adeMaxNameBytes  = 500
	adeMaxURLBytes   = 2048
)

// validateAdeBranchName checks a value that must name a real git ref (branch/branchName/
// startFrom): non-empty, no NUL/space/`:`/leading `-`, <= 255 bytes — real ref validity is git's
// own (an unresolved branch comes back `exists: false` rather than erroring here).
func validateAdeBranchName(value, field string) error {
	if value == "" {
		return ipcerr.New("E_INVALID", field+" is required")
	}
	if len(value) > adeMaxBranchBytes {
		return ipcerr.New("E_INVALID", field+" is too long")
	}
	if strings.ContainsAny(value, "\x00 :") || strings.HasPrefix(value, "-") {
		return ipcerr.New("E_INVALID", field+" is invalid")
	}
	return nil
}

// validateAdeItemID checks a value naming a queue item (a branch, or a new-work id — "nw:<uuid>",
// which itself carries a `:` — so this is deliberately looser than validateAdeBranchName's own
// git-ref shape: item and after (§5.3's own "Items in SetPlan/SetQueuedAfter..." rule) name either
// kind of item, never only a branch).
func validateAdeItemID(value, field string) error {
	if value == "" {
		return ipcerr.New("E_INVALID", field+" is required")
	}
	if len(value) > adeMaxBranchBytes {
		return ipcerr.New("E_INVALID", field+" is too long")
	}
	if strings.ContainsAny(value, "\x00\n") {
		return ipcerr.New("E_INVALID", field+" must not contain NUL or newline")
	}
	return nil
}

func validateAdeName(value, field string) error {
	if len(value) > adeMaxNameBytes {
		return ipcerr.New("E_INVALID", field+" is too long")
	}
	return nil
}

func validateAdeNotes(notes string) error {
	if len(notes) > adeMaxNotesBytes {
		return ipcerr.New("E_INVALID", "notes is too long")
	}
	return nil
}

func validateAdeEst(est string) error {
	if est == "" {
		return nil
	}
	if !adeEstRe.MatchString(est) {
		return ipcerr.New("E_INVALID", "est is invalid")
	}
	if repos.EstOverCap(est) {
		return ipcerr.New("E_INVALID", "est is too long: at most 480h or 60d")
	}
	return nil
}

func validateAdeURL(value, field string) error {
	if value == "" {
		return nil
	}
	if len(value) > adeMaxURLBytes {
		return ipcerr.New("E_INVALID", field+" is too long")
	}
	if !strings.HasPrefix(value, "http://") && !strings.HasPrefix(value, "https://") {
		return ipcerr.New("E_INVALID", field+" must be http or https")
	}
	return nil
}

func validateAdeJira(key, url string) error {
	if key != "" && !adeJiraKeyRe.MatchString(key) {
		return ipcerr.New("E_INVALID", "jiraKey is invalid")
	}
	return validateAdeURL(url, "jiraUrl")
}

func validateAdeISODate(value string) error {
	if _, err := time.Parse("2006-01-02", value); err != nil {
		return ipcerr.New("E_INVALID", "date must be YYYY-MM-DD")
	}
	return nil
}
