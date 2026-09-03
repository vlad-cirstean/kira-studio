package secrets

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"errors"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge/ipcerr"
)

func fakeLoadOK() ([]byte, error) { return bytes.Repeat([]byte{0x01}, 32), nil }

func fakeLoadErr() ([]byte, error) { return nil, errors.New("no keychain") }

// TestProbe covers probe's three goos branches against the insecureEnv values a user might
// plausibly set — in particular P29 F5's regression: "0" and "false" must read as *off*, matching
// config.IsDev()'s own parsing convention for KIRA_DEV, not silently enable the insecure fallback.
func TestProbe(t *testing.T) {
	tests := []struct {
		name        string
		goos        string
		insecureEnv string
		loadKey     func() ([]byte, error)
		wantBackend string
	}{
		{"darwin ignores insecureEnv, key available", "darwin", "1", fakeLoadOK, BackendKeychain},
		{"darwin ignores insecureEnv, key unavailable", "darwin", "1", fakeLoadErr, BackendUnavailable},
		{"linux unset", "linux", "", fakeLoadOK, BackendUnavailable},
		{"linux empty stays unset", "linux", "", fakeLoadErr, BackendUnavailable},
		{`linux "0" is off`, "linux", "0", fakeLoadOK, BackendUnavailable},
		{`linux "false" is off`, "linux", "false", fakeLoadOK, BackendUnavailable},
		{`linux "1" is on`, "linux", "1", fakeLoadOK, BackendBasicText},
		{`linux any non-empty is on`, "linux", "yes", fakeLoadOK, BackendBasicText},
		{"other platform", "windows", "1", fakeLoadOK, BackendUnavailable},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status, _ := probe(tt.goos, tt.insecureEnv, tt.loadKey)
			if status.Backend != tt.wantBackend {
				t.Errorf("probe(%q, %q) backend = %v, want %v", tt.goos, tt.insecureEnv, status.Backend, tt.wantBackend)
			}
			wantInsecure := tt.wantBackend == BackendBasicText
			if status.InsecureFallback != wantInsecure {
				t.Errorf("probe(%q, %q) InsecureFallback = %v, want %v", tt.goos, tt.insecureEnv, status.InsecureFallback, wantInsecure)
			}
		})
	}
}

func availableCipher(t *testing.T) *Cipher {
	t.Helper()
	status, key := probe("darwin", "", fakeLoadOK)
	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatalf("build cipher: %v", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatalf("build GCM: %v", err)
	}
	return &Cipher{status: status, aead: aead}
}

func asIpcErr(t *testing.T, err error) *ipcerr.Error {
	t.Helper()
	var ie *ipcerr.Error
	if !errors.As(err, &ie) {
		t.Fatalf("error %v (%T) is not an *ipcerr.Error", err, err)
	}
	return ie
}

// TestEncryptUsesAFreshNoncePerCall is the property that makes the envelope safe to store: two
// encryptions of the same credential must never produce the same ciphertext, or a reused nonce
// leaks the plaintext relationship between two stored secrets.
func TestEncryptUsesAFreshNoncePerCall(t *testing.T) {
	c := availableCipher(t)
	const plain = "pässwörd 🔐"

	enc1, err := c.Encrypt(plain)
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	enc2, err := c.Encrypt(plain)
	if err != nil {
		t.Fatalf("Encrypt again: %v", err)
	}
	if enc1 == enc2 {
		t.Error("two encryptions of the same value produced identical envelopes, want a fresh nonce")
	}
	got, err := c.Decrypt(enc1)
	if err != nil || got != plain {
		t.Errorf("Decrypt = (%q, %v), want (%q, nil)", got, err, plain)
	}
}

// TestTamperDetectionFailsAuthentication is the property AES-GCM is chosen for: a stored
// credential whose nonce, ciphertext or auth tag has been altered — or that has simply been
// truncated — must fail authentication with a named error, never decrypt to garbage.
func TestTamperDetectionFailsAuthentication(t *testing.T) {
	c := availableCipher(t)
	enc, err := c.Encrypt("hunter2")
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	raw, err := base64.StdEncoding.DecodeString(enc[len(envelopePrefix):])
	if err != nil {
		t.Fatalf("decode: %v", err)
	}

	tamper := func(b []byte, i int) string {
		cp := append([]byte(nil), b...)
		cp[i] ^= 0xFF
		return envelopePrefix + base64.StdEncoding.EncodeToString(cp)
	}

	tests := []struct {
		name  string
		value string
	}{
		{"flip nonce byte", tamper(raw, 0)},
		{"flip ciphertext byte", tamper(raw, 20)},
		{"flip tag byte", tamper(raw, len(raw)-1)},
		{"truncated", envelopePrefix + base64.StdEncoding.EncodeToString(raw[:len(raw)-5])},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := c.Decrypt(tt.value)
			ie := asIpcErr(t, err)
			if ie.Code != "E_SECRET_STORE" || !strings.Contains(ie.Message, "could not be decrypted") {
				t.Errorf("Decrypt(%s) error = %+v, want the decrypt-failure sentence", tt.name, ie)
			}
		})
	}
}
