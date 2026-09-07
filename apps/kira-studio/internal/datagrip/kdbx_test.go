package datagrip

import (
	"strings"
	"testing"
)

const (
	kdbxFixtureUUID        = "99999999-0000-0000-0000-000000000001"
	kdbxFixtureEmptyPWUUID = "99999999-0000-0000-0000-000000000002"
	kdbxFixtureUsername    = "alice"
	kdbxFixturePassword    = "s3cret-fixture-password"
	kdbxFixtureUnknownUUID = "99999999-0000-0000-0000-00000000ffff"
)

// TestKDBXHappyPath is case 12's second half: c.kdbx unlocked with the fixture main key yields
// the fixture password for the known uuid.
func TestKDBXHappyPath(t *testing.T) {
	mainKey := []byte(fixtureMainKey)
	pw, un, err := readKDBXPassword("testdata/passwordsafe/c.kdbx", mainKey, serviceNameForDataSource(kdbxFixtureUUID))
	if err != nil {
		t.Fatalf("readKDBXPassword: %v", err)
	}
	if pw != kdbxFixturePassword {
		t.Errorf("password = %q, want %q", pw, kdbxFixturePassword)
	}
	if un != kdbxFixtureUsername {
		t.Errorf("username = %q, want %q", un, kdbxFixtureUsername)
	}
}

// TestKDBXWrongMainKey is case 16: decrypting with the wrong main key fails as the D12 layout/
// decode message, never a fallthrough to some other outcome.
func TestKDBXWrongMainKey(t *testing.T) {
	_, _, err := readKDBXPassword("testdata/passwordsafe/c.kdbx", []byte("definitely the wrong key"), serviceNameForDataSource(kdbxFixtureUUID))
	assertKDBXUnsupported(t, err)
}

// TestKDBXNoIntelliJPlatformGroup is case 17: a valid, decodable KDBX file with no "IntelliJ
// Platform" group reports the layout refusal, not "password not found".
func TestKDBXNoIntelliJPlatformGroup(t *testing.T) {
	mainKey := []byte(fixtureMainKey)
	_, _, err := readKDBXPassword("testdata/passwordsafe/c.kdbx.no-group", mainKey, serviceNameForDataSource(kdbxFixtureUUID))
	assertKDBXUnsupported(t, err)
}

func assertKDBXUnsupported(t *testing.T, err error) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected an error")
	}
	re, ok := err.(*RefusalError)
	if !ok {
		t.Fatalf("error is not a *RefusalError: %v", err)
	}
	if re.Code != ReasonCredentialStoreUnsupported {
		t.Errorf("Code = %q, want %q", re.Code, ReasonCredentialStoreUnsupported)
	}
}

// TestKDBXNoEntryForUUID is case 18: group present, no entry for this uuid — the one "clean
// miss", distinguishable from every decode/decrypt failure above.
func TestKDBXNoEntryForUUID(t *testing.T) {
	mainKey := []byte(fixtureMainKey)
	_, _, err := readKDBXPassword("testdata/passwordsafe/c.kdbx", mainKey, serviceNameForDataSource(kdbxFixtureUnknownUUID))
	if err != errPasswordNotFound {
		t.Errorf("err = %v, want errPasswordNotFound", err)
	}
}

// TestKDBXEmptyPassword is case 19: an entry whose password is "" reports password-not-found,
// same as a missing entry (D12's last bullet).
func TestKDBXEmptyPassword(t *testing.T) {
	mainKey := []byte(fixtureMainKey)
	_, _, err := readKDBXPassword("testdata/passwordsafe/c.kdbx", mainKey, serviceNameForDataSource(kdbxFixtureEmptyPWUUID))
	if err != errPasswordNotFound {
		t.Errorf("err = %v, want errPasswordNotFound", err)
	}
}

// TestKDBXMissingFile is the "file does not exist" edge D5/D12 also names explicitly.
func TestKDBXMissingFile(t *testing.T) {
	_, _, err := readKDBXPassword("testdata/passwordsafe/does-not-exist.kdbx", []byte("x"), "svc")
	if err == nil {
		t.Fatalf("expected an error")
	}
	re, ok := err.(*RefusalError)
	if !ok {
		t.Fatalf("error is not a *RefusalError: %v", err)
	}
	if re.Code != ReasonCredentialStoreNotFound {
		t.Errorf("Code = %q, want %q", re.Code, ReasonCredentialStoreNotFound)
	}
	if !strings.Contains(re.Message, "does-not-exist.kdbx") {
		t.Errorf("Message = %q, want it to name the missing path", re.Message)
	}
}
