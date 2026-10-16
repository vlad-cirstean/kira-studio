package ipcerr

import (
	"fmt"

	"github.com/kirathecat/kira-studio/packages/theme/src/i18n"
)

// T builds an error whose user-visible message is catalog text for key.
func T(code Code, key string, params map[string]string) *Error {
	return New(string(code), i18n.T(key, params))
}

// Contract reports a caller bug: the UI always sets the value, so a violation is a Kira defect.
// Developer text stays English; the UI wraps it in common.error.contract.body.
func Contract(format string, args ...any) *Error {
	return New(string(CodeContract), fmt.Sprintf(format, args...))
}

// Required reports a missing field the UI always sets.
func Required(field string) *Error { return Contract("%s is required", field) }
