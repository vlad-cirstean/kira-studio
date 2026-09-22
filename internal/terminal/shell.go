package terminal

import (
	"bufio"
	"os"
	"os/user"
	"strings"
)

// TermProgram and TermProgramVersion are process-constant, set once by each app's main.go before
// the first Registry.Open (P103 Part 3: this package is now shared, and sessionEnv is called per-
// spawn from deep inside newSession — a Config struct threaded through every OpenParams call site
// would be needless plumbing for a value that never varies for the life of the process).
var (
	TermProgram        = "Kira"
	TermProgramVersion = ""
)

// loginShell resolves the shell a new session starts (P83 §2.3): $SHELL when it names an
// executable file, else the current user's /etc/passwd entry, else /bin/sh. No dscl/getent
// subprocess — a fallback shell is not worth a spawn.
func loginShell() string {
	if s := os.Getenv("SHELL"); s != "" {
		if info, err := os.Stat(s); err == nil && !info.IsDir() && info.Mode()&0o111 != 0 {
			return s
		}
	}
	if u, err := user.Current(); err == nil && u.Username != "" {
		if s := passwdShell(u.Username); s != "" {
			return s
		}
	}
	return "/bin/sh"
}

// passwdShell reads /etc/passwd's seventh field for username, "" when the file is missing or
// carries no entry for it — on macOS a directory-service user has none, which is why
// loginShell's $SHELL branch is what answers in practice.
func passwdShell(username string) string {
	f, err := os.Open("/etc/passwd")
	if err != nil {
		return ""
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		fields := strings.Split(scanner.Text(), ":")
		if len(fields) >= 7 && fields[0] == username {
			return fields[6]
		}
	}
	return ""
}

// sessionEnv is §2.3's env table, appended to os.Environ() — LANG is never set here since it is
// already inherited from os.Environ(), and inventing one would risk a wrong locale breaking UTF-8
// output.
func sessionEnv() []string {
	return []string{
		"TERM=xterm-256color",
		"COLORTERM=truecolor",
		"TERM_PROGRAM=" + TermProgram,
		"TERM_PROGRAM_VERSION=" + TermProgramVersion,
	}
}
