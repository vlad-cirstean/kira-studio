// Package loginshell picks the user shell and builds the argv that runs one script text through it.
package loginshell

import (
	"os"
	"path/filepath"
)

// DefaultShell is D9/F16's own fallback — used whenever $SHELL is unset, not an absolute path, or
// not resolvable as an executable file. Never given "-l": /bin/sh is not asked to act as a login
// shell (D9's own argv table).
const DefaultShell = "/bin/sh"

// IsExecutableFile reports whether path names a regular (non-directory) file with at least one
// execute bit set — ResolveShell's own "resolvable as executable" test. A missing path, a
// directory, or a non-executable file all answer false, falling through to DefaultShell.
func IsExecutableFile(path string) bool {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return false
	}
	return info.Mode()&0o111 != 0
}

// ResolveShell is D9/D16's own shell-selection table, expressed as pure functions of an injected
// getenv/isExecutable pair so it is fully testable without touching the real environment or
// filesystem: $SHELL is used, with the login-shell flag, when it is set, an ABSOLUTE path (a bare
// command name would need a PATH lookup this app has no business doing on the user's behalf), and
// passes isExecutable; otherwise DefaultShell, with no login-shell flag (F16: a Finder/launchd-
// launched server inherits a minimal environment where $SHELL may be unset entirely or point
// somewhere the process cannot exec — a login shell resolves `npm`/`pnpm`/Homebrew for the common
// case; the documented cost is the profile-sourcing time this trades against the timeout budget).
func ResolveShell(getenv func(string) string, isExecutable func(string) bool) (shell string, loginShell bool) {
	sh := getenv("SHELL")
	if sh != "" && filepath.IsAbs(sh) && isExecutable(sh) {
		return sh, true
	}
	return DefaultShell, false
}

// BuildArgv is D9's own argv table, and the single most safety-critical function in this whole
// phase: scriptText is appended as the LAST element of a slice built from nothing but the shell
// path and string constants that precede it — never Sprintf'd, concatenated with "+", or
// strings.Join'd into anything. This is what makes "the script text travels as one argv element,
// verbatim, character for character" a property the compiler's own composite-literal-plus-append
// shape makes visually obvious, not merely a claim a test asserts (though TestBuildArgv_Golden
// asserts it too, byte for byte, in both shell branches).
func BuildArgv(shell string, loginShell bool, scriptText string) []string {
	if loginShell {
		return []string{shell, "-l", "-c", scriptText}
	}
	return []string{shell, "-c", scriptText}
}
