package gitops

import (
	"bufio"
	"bytes"
	"fmt"
	"strings"
)

// PushArgs builds `git push --porcelain --progress [--set-upstream] <remote>
// refs/heads/<local>:refs/heads/<remote-side>` (D12). --porcelain (F10/P5): the exact,
// tab-separated, locale-independent statement of each ref's outcome and rejection reason,
// available far below this chapter's 2.38 floor. A fully-qualified refspec on both sides (F14) —
// so neither push.default nor a same-named tag can redirect what gets pushed. `localBranch` and
// `remoteBranch` are deliberately separate params (G32 round-3 functional-correctness review,
// finding #3): a branch already tracking a differently-named upstream (`git checkout -b feat
// origin/main`) must push to THAT branch, never silently create a new same-named one — callers
// resolve `remoteBranch` via gitsession's own resolveUpstreamRemoteBranch, which falls back to
// `localBranch` for the ordinary first-push case.
func PushArgs(remote, localBranch, remoteBranch string, setUpstream bool) []string {
	argv := []string{"push", "--porcelain", "--progress"}
	if setUpstream {
		argv = append(argv, "--set-upstream")
	}
	return append(argv, remote, branchRefspec(localBranch, remoteBranch))
}

// ForcePushArgs builds the force-push family (D12, upstream D48): bare
// --force-with-lease --force-if-includes by default — an explicit --force-with-lease=<ref>:<sha>
// is not used here because the residual hazard it would close (a lease satisfied by a background
// auto-fetch between dialog-open and spawn) is instead closed by gitsession re-reading the remote
// tip immediately before this spawns and comparing it with RemoteOpParams.expectedRemoteTip — or
// plain --force when plain is true. `localBranch`/`remoteBranch` split for the same reason as
// PushArgs above.
func ForcePushArgs(remote, localBranch, remoteBranch string, plain bool) []string {
	argv := []string{"push", "--porcelain", "--progress"}
	if plain {
		argv = append(argv, "--force")
	} else {
		argv = append(argv, "--force-with-lease", "--force-if-includes")
	}
	return append(argv, remote, branchRefspec(localBranch, remoteBranch))
}

// DeleteRemoteBranchArgs builds `git push --porcelain --progress <remote> --delete
// refs/heads/<branch>` — a fully-qualified ref (D12), so a same-named tag can never be ambiguous.
func DeleteRemoteBranchArgs(remote, branch string) []string {
	return []string{"push", "--porcelain", "--progress", remote, "--delete", "refs/heads/" + branch}
}

func branchRefspec(localBranch, remoteBranch string) string {
	return "refs/heads/" + localBranch + ":refs/heads/" + remoteBranch
}

// PushStatus is one parsed line of --porcelain's own output (D13): `<flag>\t<src>:<dst>\t<summary>`.
type PushStatus struct {
	// Flag is one of ' ' (fast-forward), '+' (forced), '*' (new), '-' (deleted), '!' (rejected),
	// '=' (up to date).
	Flag byte
	Src  string
	Dst  string
	// Summary is `<from>..<to>`, `<from>...<to> (forced update)`, `[new branch]`, `[deleted]`, or
	// `[rejected] (<reason>)`.
	Summary string
	// Reason is the parenthesised text at Summary's own end, "" when there is none.
	Reason string
}

// ParsePushPorcelain parses `git push --porcelain`'s stdout — empty input (probe P8: `--delete` of
// a ref that does not exist) is not an error, it is zero statuses; the caller reads stderr in that
// case (D14). The leading "To <url>" line and the trailing "Done" line are recognised and skipped.
func ParsePushPorcelain(stdout []byte) ([]PushStatus, error) {
	if len(bytes.TrimSpace(stdout)) == 0 {
		return nil, nil
	}
	var out []PushStatus
	scanner := bufio.NewScanner(bytes.NewReader(stdout))
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" || line == "Done" || strings.HasPrefix(line, "To ") {
			continue
		}
		status, ok := parsePushPorcelainLine(line)
		if !ok {
			// --set-upstream injects its own human-readable aside into this same block (probed
			// here: "branch 'x' set up to track 'origin/x'." — no tabs at all, sandwiched between
			// the ref line and "Done") — not itself a ref outcome, skipped rather than an error.
			continue
		}
		out = append(out, status)
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("gitops: scan push --porcelain output: %w", err)
	}
	return out, nil
}

func parsePushPorcelainLine(line string) (PushStatus, bool) {
	fields := strings.Split(line, "\t")
	if len(fields) != 3 || len(fields[0]) != 1 {
		return PushStatus{}, false
	}
	refspec := fields[1]
	srcDst := strings.SplitN(refspec, ":", 2)
	if len(srcDst) != 2 {
		return PushStatus{}, false
	}
	summary := fields[2]
	return PushStatus{
		Flag: fields[0][0], Src: srcDst[0], Dst: srcDst[1], Summary: summary,
		Reason: extractParenthesised(summary),
	}, true
}

// extractParenthesised returns the text inside a trailing "(...)" in s, or "" when s does not end
// that way.
func extractParenthesised(s string) string {
	if !strings.HasSuffix(s, ")") {
		return ""
	}
	open := strings.LastIndexByte(s, '(')
	if open == -1 {
		return ""
	}
	return s[open+1 : len(s)-1]
}

// fromTo parses a fast-forward/forced summary's own "<from>..<to>" or "<from>...<to> (forced
// update)" shape — the "(...)" suffix, if any, is stripped first.
func fromTo(summary string) (from, to *string, ok bool) {
	body := summary
	if idx := strings.Index(body, " ("); idx != -1 {
		body = body[:idx]
	}
	sep := ".."
	if strings.Contains(body, "...") {
		sep = "..."
	}
	parts := strings.SplitN(body, sep, 2)
	if len(parts) != 2 {
		return nil, nil, false
	}
	f, t := parts[0], parts[1]
	return &f, &t, true
}

// PushUpdates derives RefUpdate[] from a parsed --porcelain block (D13) — the exact statement of
// each ref's outcome, straight from git's own machine-readable output. A rejected ('!') or
// up-to-date ('=') line moved nothing and contributes no entry. A new ('*') or deleted ('-') line
// carries no sha in the porcelain summary itself, so both ends are reported null — precision
// nothing downstream reads (F1: RemoteOpResult.updates has no consumer in the migrated UI today).
func PushUpdates(statuses []PushStatus) []RefUpdate {
	var out []RefUpdate
	for _, s := range statuses {
		switch s.Flag {
		case ' ':
			if from, to, ok := fromTo(s.Summary); ok {
				out = append(out, RefUpdate{Ref: s.Dst, From: from, To: to, Forced: false})
			}
		case '+':
			if from, to, ok := fromTo(s.Summary); ok {
				out = append(out, RefUpdate{Ref: s.Dst, From: from, To: to, Forced: true})
			}
		case '*', '-':
			out = append(out, RefUpdate{Ref: s.Dst, From: nil, To: nil, Forced: false})
		}
		// '!' (rejected) and '=' (up to date): nothing moved.
	}
	return out
}
