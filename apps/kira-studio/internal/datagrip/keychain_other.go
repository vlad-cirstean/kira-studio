//go:build !(darwin && cgo)

package datagrip

import (
	"fmt"
	"runtime"
)

// keychainSupported lets Scan (D9) classify a row's passwordOutlook without ever calling the
// query below — a compile-time platform fact, not an I/O probe.
const keychainSupported = false

// serviceNameForDataSource is F4's generateServiceName("DB", uuid) — kept identical on every
// platform (it is pure string formatting, not a keychain call) so configdir/kdbx code can build
// the same service name regardless of which keychain_*.go file is compiled in.
func serviceNameForDataSource(uuid string) string {
	return fmt.Sprintf("IntelliJ Platform DB — %s", uuid)
}

// readKeychainPassword has no implementation outside darwin+cgo (D1): the Linux default backend
// is the freedesktop Secret Service over libsecret, which needs cgo — this repo's Go is
// deliberately cgo-free (AGENTS.md) — and Windows does not ship this app at all. Both refuse by
// name (case 23) rather than silently reporting "not found", which would be indistinguishable
// from a real miss.
func readKeychainPassword(uuid string) (password, username string, err error) {
	if runtime.GOOS == "windows" {
		return "", "", &RefusalError{
			Code:    ReasonCredentialStoreUnsupported,
			Message: "Kira Studio does not ship on Windows, so the DataGrip password store there (CRYPT_32/DPAPI) can never be read here.",
		}
	}
	return "", "", &RefusalError{
		Code: ReasonCredentialStoreUnsupported,
		Message: "the system keychain is not reachable on " + runtime.GOOS + " in this build — the default " +
			"Linux backend (freedesktop Secret Service) needs libsecret over cgo, which Kira Studio's Go " +
			"code does not use. Set DataGrip's Passwords setting to \"In KeePass\" and re-save this " +
			"password to make the import work here.",
	}
}
