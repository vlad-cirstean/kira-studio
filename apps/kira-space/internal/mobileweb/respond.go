package mobileweb

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

type errorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Reason  string `json:"reason,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Debug("mobileweb: write response", "scope", "mobileweb", "err", err)
	}
}

// writeError uses the `{code, message}` shape ipcerr.Error marshals to, which the shared
// toCodedError parses on the phone.
func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, errorBody{Code: code, Message: message})
}

func writeRateLimited(w http.ResponseWriter) {
	w.Header().Set("Retry-After", "10")
	writeError(w, http.StatusTooManyRequests, codeRateLimited, "too many requests")
}

// writeServiceError maps a bridge error to a status. Internal failures are logged and answered
// with a generic message: the phone never sees paths or driver text.
func writeServiceError(w http.ResponseWriter, err error) {
	var ie *ipcerr.Error
	if errors.As(err, &ie) {
		switch ie.Code {
		case "E_BAD_REQUEST":
			writeError(w, http.StatusBadRequest, ie.Code, ie.Message)
			return
		case "E_NOT_FOUND":
			writeError(w, http.StatusNotFound, ie.Code, ie.Message)
			return
		case "E_INVALID":
			writeError(w, http.StatusUnprocessableEntity, ie.Code, ie.Message)
			return
		case "E_STALE", "E_PREPARING", "E_TERMINAL_BUSY", "E_NO_WINDOW":
			writeError(w, http.StatusConflict, ie.Code, ie.Message)
			return
		case "E_LAUNCH_TIMEOUT":
			writeError(w, http.StatusGatewayTimeout, ie.Code, ie.Message)
			return
		}
	}
	slog.Warn("mobileweb: service error", "scope", "mobileweb", "err", err)
	writeError(w, http.StatusInternalServerError, "E_INTERNAL", "internal error")
}
