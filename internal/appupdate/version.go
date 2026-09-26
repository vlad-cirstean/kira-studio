package appupdate

import (
	"strings"

	"golang.org/x/mod/semver"
)

// devVersions are the three literals a build that is NOT a tagged release can report
// (buildinfo.go:17, Taskfile.yml:18-22, build/config.yml:17). A build reporting any of them
// performs no check and makes no request: there is nothing meaningful to compare against, and a
// `go test` run or a `wails3 task dev` session must never reach the network.
var devVersions = map[string]struct{}{
	"0.0.0":         {},
	"0.0.0-dev":     {},
	"0.0.0-unknown": {},
}

// isReleaseBuild reports whether v is a version a tagged release could have produced — anything
// else (one of the three dev sentinels, or a string that isn't valid semver at all) means no
// network request is ever made for it.
func isReleaseBuild(v string) bool {
	if _, dev := devVersions[v]; dev {
		return false
	}
	return semver.IsValid(normalize(v))
}

// normalize turns both "1.3.0" (buildinfo's shape) and "v1.3.0" (a tag's shape) into "v1.3.0",
// which is the only form x/mod/semver accepts.
func normalize(v string) string { return "v" + strings.TrimPrefix(v, "v") }

// updateAvailable reports whether latest is a validly-formed, strictly newer semver than running.
// An unparseable version on either side yields no update, not a guess.
func updateAvailable(running, latest string) bool {
	r, l := normalize(running), normalize(latest)
	return semver.IsValid(r) && semver.IsValid(l) && semver.Compare(l, r) > 0
}
