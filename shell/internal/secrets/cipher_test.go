package secrets

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"errors"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/shell/internal/bridge/ipcerr"
)

func fakeLoadOK() ([]byte, error) { return bytes.Repeat([]byte{0x01}, 32), nil }

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

// TestEncryptDecryptRoundTrip covers the envelope across the input edges that break naive
// implementations — empty, multi-byte UTF-8, 4 KiB — and asserts the nonce is fresh per call, so
// two encryptions of the same credential never produce the same ciphertext.
func TestEncryptDecryptRoundTrip(t *testing.T) {
	c := availableCipher(t)
	tests := []string{"", "hello", "pässwörd 🔐", strings.Repeat("x", 4096)}
	for _, plain := range tests {
		enc1, err := c.Encrypt(plain)
		if err != nil {
			t.Fatalf("Encrypt(%q): %v", plain, err)
		}
		if !strings.HasPrefix(enc1, envelopePrefix) {
			t.Errorf("Encrypt(%q) = %q, want kira:v2: prefix", plain, enc1)
		}
		got, err := c.Decrypt(enc1)
		if err != nil {
			t.Fatalf("Decrypt: %v", err)
		}
		if got != plain {
			t.Errorf("round trip = %q, want %q", got, plain)
		}

		enc2, err := c.Encrypt(plain)
		if err != nil {
			t.Fatalf("Encrypt again: %v", err)
		}
		if enc1 == enc2 && plain != "" {
			t.Errorf("two encryptions of %q produced identical envelopes, want a fresh nonce", plain)
		}
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
