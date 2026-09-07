package datagrip

import (
	"crypto/sha256"
	"fmt"
	"os"

	"github.com/tobischo/gokeepasslib/v3"
)

// kdbxRootGroupName is BaseKeePassCredentialStore.kt's ROOT_GROUP_NAME = SERVICE_NAME_PREFIX —
// every IntelliJ Platform credential sits in one group, directly under the KDBX root, named
// exactly this (F8).
const kdbxRootGroupName = "IntelliJ Platform"

// readKDBXPassword opens the KDBX file at path, unlocks it with mainKey via F8/F9's composite key
// (gokeepasslib.DBCredentials{Passphrase: sha256(mainKey)}, which buildCompositeKey then hashes
// again — byte-exactly KdbxPassword's sha256(sha256(mainKey))), and looks up serviceName inside
// the single "IntelliJ Platform" group. Every failure is one of D12's named refusals — a decode
// error is never retried with a different key and never downgraded to "password not found".
func readKDBXPassword(path string, mainKey []byte, serviceName string) (password, username string, err error) {
	f, openErr := os.Open(path)
	if openErr != nil {
		if os.IsNotExist(openErr) {
			return "", "", &RefusalError{
				Code:    ReasonCredentialStoreNotFound,
				Message: fmt.Sprintf("%s does not exist", path),
			}
		}
		return "", "", openErr
	}
	defer f.Close()

	sum := sha256.Sum256(mainKey)
	db := gokeepasslib.NewDatabase()
	db.Credentials = &gokeepasslib.DBCredentials{Passphrase: sum[:]}

	if decodeErr := gokeepasslib.NewDecoder(f).Decode(db); decodeErr != nil {
		return "", "", kdbxLayoutFailure(path)
	}
	if db.Content == nil || db.Content.Root == nil {
		return "", "", kdbxLayoutFailure(path)
	}
	if unlockErr := db.UnlockProtectedEntries(); unlockErr != nil {
		return "", "", kdbxLayoutFailure(path)
	}

	var group *gokeepasslib.Group
	for i := range db.Content.Root.Groups {
		if db.Content.Root.Groups[i].Name == kdbxRootGroupName {
			group = &db.Content.Root.Groups[i]
			break
		}
	}
	if group == nil {
		return "", "", &RefusalError{
			Code: ReasonCredentialStoreUnsupported,
			Message: fmt.Sprintf(
				"could not read %s — unsupported KeePass database version or an unexpected layout for this IDE version (no %q group).",
				path, kdbxRootGroupName),
		}
	}

	for i := range group.Entries {
		e := &group.Entries[i]
		if e.GetTitle() != serviceName {
			continue
		}
		pw := e.GetPassword()
		if pw == "" {
			// D12's last bullet: an empty stored password is indistinguishable from a
			// successful import of a wrong value, so it is reported as a miss.
			return "", "", errPasswordNotFound
		}
		return pw, e.GetContent("UserName"), nil
	}
	return "", "", errPasswordNotFound
}

func kdbxLayoutFailure(path string) error {
	return &RefusalError{
		Code: ReasonCredentialStoreUnsupported,
		Message: fmt.Sprintf(
			"could not read %s — unsupported KeePass database version or an unexpected layout for this IDE version.",
			path),
	}
}
