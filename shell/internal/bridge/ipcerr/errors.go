// Package ipcerr is the Go analogue of src/main/ipc/errors.ts — retired, not ported (P52 §5.3).
// The `[CODE] message` folding existed solely because Electron's IPC error serialisation
// preserves only `.message`; Wails has no such constraint, so every bound service method here
// returns a structured {code, message} error instead.
package ipcerr

import "encoding/json"

// Error is the one error type every bound service method returns on failure. Its Error() method
// returns the JSON encoding {"code":"...","message":"..."} — the single shape the renderer's
// control.ts wrapper parses back into {code, message} (P52 §5.3).
type Error struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *Error) Error() string {
	b, err := json.Marshal(e)
	if err != nil {
		// json.Marshal on this struct cannot fail (both fields are plain strings) — this branch
		// exists only so Error() satisfies the `error` interface without a panic in the theoretical
		// case, not because it is expected to run.
		return e.Message
	}
	return string(b)
}

func New(code, message string) *Error { return &Error{Code: code, Message: message} }

func Internal(message string) *Error   { return New("E_INTERNAL", message) }
func BadRequest(message string) *Error { return New("E_BAD_REQUEST", message) }
func EngineDown() *Error               { return New("E_ENGINE_DOWN", "the engine process is not running") }

// Disconnected mirrors tree-service.ts:77's exact message (P55 D11 — this constructor had zero
// callers before P55, so the message correction is free).
func Disconnected(name string) *Error { return New("E_DISCONNECTED", name+" is not connected") }

// SecretStore mirrors secret-cipher.ts's SecretStoreError code.
func SecretStore(message string) *Error { return New("E_SECRET_STORE", message) }
