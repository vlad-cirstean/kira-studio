package secrets

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"log/slog"
	"os"
	"runtime"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge/ipcerr"
)

// envelopePrefix bumps to kira:v2: (P52 §6.4): the cipher genuinely changes (AES-256-GCM under
// our own key, vs Chromium safeStorage's AES-128-CBC), so reusing kira:v1: would let a v1 value
// reach a v2 decrypt and fail confusingly.
const envelopePrefix = "kira:v2:"

// insecureKeyMaterial is a hardcoded compile-time constant, deliberately (P52 §6.5): the Linux
// development fallback has the same threat model and the same honesty as Chromium's
// basic_text — obfuscation under a key anyone can read, not encryption. A file-backed keyring
// would look more secure than it is and would need a passphrase prompt in a headless container.
const insecureKeyMaterial = "kira-studio:v2:insecure-development-key"

// Cipher is the Go analogue of secret-cipher.ts's SecretCipher. It never fails to construct: an
// unavailable backend is a valid Cipher whose Encrypt/Decrypt refuse with E_SECRET_STORE.
type Cipher struct {
	status Status
	aead   cipher.AEAD // nil when status.Available is false
}

// New probes once and returns a Cipher whose Status never changes for the life of the process
// (secret-cipher.ts's createSecretCipher, called once after startup with no Electron
// app.whenReady() analogue needed — P52 §6.5).
func New() *Cipher {
	status, key := probe(runtime.GOOS, os.Getenv("KIRA_INSECURE_SECRETS"), loadOrCreateKey)

	suffix := ""
	if status.InsecureFallback {
		suffix = " — Linux development fallback (KIRA_INSECURE_SECRETS=1): credentials are obfuscated with a hardcoded key, not a real keychain"
	}
	msg := fmt.Sprintf("secret storage: backend=%s available=%t%s", status.Backend, status.Available, suffix)
	if status.InsecureFallback {
		slog.Warn(msg, "scope", "secrets")
	} else {
		slog.Info(msg, "scope", "secrets")
	}

	c := &Cipher{status: status}
	if status.Available {
		block, err := aes.NewCipher(key)
		if err != nil {
			// The only ways aes.NewCipher can fail are a wrong key length, which both key
			// sources here always produce (32 bytes) — this is a real invariant violation, not
			// a recoverable runtime condition.
			panic(fmt.Sprintf("secrets: invalid key length: %v", err))
		}
		aead, err := cipher.NewGCM(block)
		if err != nil {
			panic(fmt.Sprintf("secrets: invalid GCM configuration: %v", err))
		}
		c.aead = aead
	}
	return c
}

func (c *Cipher) Status() Status { return c.status }

// Encrypt satisfies repos.Cipher.
func (c *Cipher) Encrypt(plain string) (string, error) {
	if !c.status.Available {
		return "", ipcerr.SecretStore(*c.status.Reason)
	}
	nonce := make([]byte, c.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", ipcerr.SecretStore(fmt.Sprintf("could not generate a nonce (%s)", err))
	}
	sealed := c.aead.Seal(nonce, nonce, []byte(plain), nil)
	return envelopePrefix + base64.StdEncoding.EncodeToString(sealed), nil
}

// Decrypt satisfies repos.Cipher.
func (c *Cipher) Decrypt(stored string) (string, error) {
	if !strings.HasPrefix(stored, envelopePrefix) {
		// P52 §6.4 retires the pre-P25 plaintext passthrough: a non-enveloped value is an error
		// naming the problem, never returned verbatim.
		return "", ipcerr.SecretStore("The stored credential is not in this app's kira:v2: envelope format and cannot be decrypted — re-enter it to fix this connection.")
	}
	if !c.status.Available {
		return "", ipcerr.SecretStore(*c.status.Reason)
	}

	raw, err := base64.StdEncoding.DecodeString(stored[len(envelopePrefix):])
	if err != nil {
		return "", decryptFailure(err)
	}
	nonceSize := c.aead.NonceSize()
	if len(raw) < nonceSize {
		return "", decryptFailure(fmt.Errorf("ciphertext too short"))
	}
	nonce, sealed := raw[:nonceSize], raw[nonceSize:]
	plain, err := c.aead.Open(nil, nonce, sealed, nil)
	if err != nil {
		return "", decryptFailure(err)
	}
	return string(plain), nil
}

func decryptFailure(err error) error {
	return ipcerr.SecretStore(fmt.Sprintf(
		"The stored credential could not be decrypted (%s). It may have been written on a different machine or after a keychain reset — re-enter it to fix this connection.",
		err,
	))
}

// probe is New's whole platform switch, with the OS key source injected so every branch is
// testable off its own platform (P55 §2 D3) — the darwin key source itself stays a real Keychain
// call in production; only this function's caller decides which loadKey to pass.
func probe(goos, insecureEnv string, loadKey func() ([]byte, error)) (Status, []byte) {
	switch goos {
	case "darwin":
		key, err := loadKey()
		if err != nil {
			return Status{Available: false, Backend: BackendUnavailable, Reason: reason(darwinUnavailableReason)}, nil
		}
		return Status{Available: true, Backend: BackendKeychain}, key
	case "linux":
		if insecureEnv != "" {
			sum := sha256.Sum256([]byte(insecureKeyMaterial))
			return Status{Available: true, Backend: BackendBasicText, InsecureFallback: true}, sum[:]
		}
		return Status{Available: false, Backend: BackendUnavailable, Reason: reason(linuxUnavailableReason)}, nil
	default:
		return Status{Available: false, Backend: BackendUnavailable, Reason: reason(otherPlatformReason)}, nil
	}
}
