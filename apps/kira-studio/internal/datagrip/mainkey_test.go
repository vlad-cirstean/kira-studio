package datagrip

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const fixtureMainKey = "kira-p25-fixture-main-key-4f7c9a1e2b3d5f608192a3b4c5d6e7f809"

// TestReadMainKeyHappyPath is part of case 12: c.pwd decrypts to the exact main key the fixture
// generator encrypted.
func TestReadMainKeyHappyPath(t *testing.T) {
	got, err := ReadMainKey("testdata/passwordsafe")
	if err != nil {
		t.Fatalf("ReadMainKey: %v", err)
	}
	if string(got) != fixtureMainKey {
		t.Errorf("ReadMainKey = %q, want %q", got, fixtureMainKey)
	}
}

// TestReadMainKeyLegacyPdbPwd is case 13: pdb.pwd (raw envelope, no YAML) is read when c.pwd is
// absent.
func TestReadMainKeyLegacyPdbPwd(t *testing.T) {
	dir := t.TempDir()
	data, err := os.ReadFile("testdata/passwordsafe/pdb.pwd")
	if err != nil {
		t.Fatalf("read fixture pdb.pwd: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "pdb.pwd"), data, 0o644); err != nil {
		t.Fatalf("write pdb.pwd: %v", err)
	}
	got, err := ReadMainKey(dir)
	if err != nil {
		t.Fatalf("ReadMainKey: %v", err)
	}
	if string(got) != fixtureMainKey {
		t.Errorf("ReadMainKey = %q, want %q", got, fixtureMainKey)
	}
}

// TestReadMainKeyUnsupportedEncryption is case 14: CRYPT_32 and PGP_KEY both refuse by name,
// naming the encryption type.
func TestReadMainKeyUnsupportedEncryption(t *testing.T) {
	tests := []struct {
		file string
		want string
	}{
		{"c.pwd.crypt32", "CRYPT_32"},
		{"c.pwd.pgp", "PGP_KEY"},
	}
	for _, tt := range tests {
		t.Run(tt.file, func(t *testing.T) {
			dir := t.TempDir()
			data, err := os.ReadFile(filepath.Join("testdata/passwordsafe", tt.file))
			if err != nil {
				t.Fatalf("read fixture: %v", err)
			}
			if err := os.WriteFile(filepath.Join(dir, "c.pwd"), data, 0o644); err != nil {
				t.Fatalf("write c.pwd: %v", err)
			}
			_, err = ReadMainKey(dir)
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
			if !strings.Contains(re.Message, tt.want) {
				t.Errorf("Message = %q, want it to name %q", re.Message, tt.want)
			}
		})
	}
}

// TestReadMainKeyTruncatedOrBadPadding is case 15: a truncated/bad-IV-length c.pwd fails with the
// D12 main-key message — never a password-not-found.
func TestReadMainKeyTruncatedOrBadPadding(t *testing.T) {
	dir := t.TempDir()
	data, err := os.ReadFile("testdata/passwordsafe/c.pwd.truncated")
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "c.pwd"), data, 0o644); err != nil {
		t.Fatalf("write c.pwd: %v", err)
	}
	_, err = ReadMainKey(dir)
	if err == nil {
		t.Fatalf("expected an error")
	}
	re, ok := err.(*RefusalError)
	if !ok {
		t.Fatalf("error is not a *RefusalError: %v", err)
	}
	if re.Code != ReasonCredentialStoreUnsupported {
		t.Errorf("Code = %q, want %q (never password-not-found)", re.Code, ReasonCredentialStoreUnsupported)
	}
	if !strings.Contains(re.Message, "could not decrypt") {
		t.Errorf("Message = %q, want it to mention decrypt failure", re.Message)
	}
}

// TestReadMainKeyNeitherFileExists is D5/D12's "neither c.pwd nor pdb.pwd" case.
func TestReadMainKeyNeitherFileExists(t *testing.T) {
	_, err := ReadMainKey(t.TempDir())
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
}
