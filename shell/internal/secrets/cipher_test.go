package secrets

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/kirathecat/kira-studio/shell/internal/bridge/ipcerr"
)

var fakeErr = errors.New("keychain unavailable")

func fakeLoadOK() ([]byte, error)   { return bytes.Repeat([]byte{0x01}, 32), nil }
func fakeLoadFail() ([]byte, error) { return nil, fakeErr }

func TestProbeStatusShapes(t *testing.T) {
	tests := []struct {
		name        string
		goos        string
		insecureEnv string
		loadKey     func() ([]byte, error)
		want        Status
	}{
		{"darwin ok", "darwin", "", fakeLoadOK, Status{Available: true, Backend: BackendKeychain}},
		{"darwin fail", "darwin", "", fakeLoadFail, Status{Available: false, Backend: BackendUnavailable, Reason: reason(darwinUnavailableReason)}},
		{"linux with env", "linux", "1", fakeLoadFail, Status{Available: true, Backend: BackendBasicText, InsecureFallback: true}},
		{"linux no env", "linux", "", fakeLoadFail, Status{Available: false, Backend: BackendUnavailable, Reason: reason(linuxUnavailableReason)}},
		{"other platform", "windows", "", fakeLoadFail, Status{Available: false, Backend: BackendUnavailable, Reason: reason(otherPlatformReason)}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, _ := probe(tt.goos, tt.insecureEnv, tt.loadKey)
			if diff := cmp.Diff(tt.want, got); diff != "" {
				t.Errorf("probe() mismatch (-want +got):\n%s", diff)
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

func unavailableCipher() *Cipher {
	status, _ := probe("linux", "", fakeLoadFail)
	return &Cipher{status: status}
}

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

func TestRejectsNonEnvelopedValue(t *testing.T) {
	c := availableCipher(t)
	for _, v := range []string{"hunter2", "", "kira:v1:AAAA"} {
		_, err := c.Decrypt(v)
		ie := asIpcErr(t, err)
		if ie.Code != "E_SECRET_STORE" || !strings.Contains(ie.Message, "envelope") {
			t.Errorf("Decrypt(%q) error = %+v, want an envelope-format error", v, ie)
		}
	}
}

func TestUnavailableBackendRefuses(t *testing.T) {
	c := unavailableCipher()
	_, err := c.Encrypt("x")
	ie := asIpcErr(t, err)
	if ie.Code != "E_SECRET_STORE" || ie.Message != linuxUnavailableReason {
		t.Errorf("Encrypt on unavailable cipher = %+v, want reason %q", ie, linuxUnavailableReason)
	}

	_, err = c.Decrypt(envelopePrefix + "AAAA")
	ie = asIpcErr(t, err)
	if ie.Code != "E_SECRET_STORE" || ie.Message != linuxUnavailableReason {
		t.Errorf("Decrypt on unavailable cipher = %+v, want reason %q", ie, linuxUnavailableReason)
	}
}

func asIpcErr(t *testing.T, err error) *ipcerr.Error {
	t.Helper()
	var ie *ipcerr.Error
	if !errors.As(err, &ie) {
		t.Fatalf("error %v (%T) is not an *ipcerr.Error", err, err)
	}
	return ie
}

func TestErrorsAreStructured(t *testing.T) {
	c := unavailableCipher()
	_, err := c.Encrypt("x")
	ie := asIpcErr(t, err)
	if strings.Contains(ie.Error(), "[") {
		t.Errorf("Error() = %q, must not contain the retired [CODE] prefix folding", ie.Error())
	}
	var decoded map[string]string
	if err := json.Unmarshal([]byte(ie.Error()), &decoded); err != nil {
		t.Fatalf("Error() is not valid JSON: %v", err)
	}
}
