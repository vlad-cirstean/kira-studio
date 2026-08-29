package connections

import (
	"strings"

	"github.com/kirathecat/kira-studio/shell/internal/bridge/ipcerr"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

// fileKinds mirrors connection.ts's FILE_KINDS: fields mode repurposes `database` for an absolute
// local file path.
var fileKinds = map[string]bool{"sqlite": true}

// awsStyleKinds mirrors connection.ts's AWS_STYLE_KINDS: no host/port at all.
var awsStyleKinds = map[string]bool{"sqs": true, "s3": true}

// Input is connectionInputSchema's Go shape. It lives here, not in internal/storage/model, so
// P53's D9 invariant — "no password field anywhere in the model package" — stays literally true.
type Input struct {
	model.ConnectionFields
	Password *string `json:"password"`
}

// Validate ports connectionInputSchema's superRefine plus the field constraints zod enforced by
// shape (P52 §4.2: "an explicit guard at the top of the method, returning E_BAD_REQUEST").
func (in Input) Validate() error {
	name := strings.TrimSpace(in.Name)
	if name == "" || len(name) > 120 {
		return ipcerr.BadRequest("name must be 1-120 characters")
	}
	if !model.ValidConnectionKind(in.Kind) {
		return ipcerr.BadRequest("invalid connection kind")
	}
	if !model.ValidConnectionColor(in.Color) {
		return ipcerr.BadRequest("invalid connection color")
	}
	if !model.ValidConnectionMode(in.Mode) {
		return ipcerr.BadRequest("invalid connection mode")
	}
	if in.Port != nil && (*in.Port < 1 || *in.Port > 65535) {
		return ipcerr.BadRequest("port must be between 1 and 65535")
	}
	if in.Preconnect != nil {
		trimmed := strings.TrimSpace(*in.Preconnect)
		if trimmed == "" || len(*in.Preconnect) > 2000 {
			return ipcerr.BadRequest("preconnect must be 1-2000 characters")
		}
	}

	if in.Mode == "fields" {
		if fileKinds[in.Kind] {
			path := ""
			if in.Database != nil {
				path = strings.TrimSpace(*in.Database)
			}
			if path == "" {
				return ipcerr.BadRequest("A database file is required.")
			}
			if !strings.HasPrefix(path, "/") {
				return ipcerr.BadRequest("The database file must be an absolute path.")
			}
		} else {
			if !awsStyleKinds[in.Kind] && (in.Host == nil || *in.Host == "") {
				return ipcerr.BadRequest("Host is required.")
			}
			if !awsStyleKinds[in.Kind] && in.Port == nil {
				return ipcerr.BadRequest("Port is required.")
			}
		}
	} else {
		if in.URI == nil || strings.TrimSpace(*in.URI) == "" {
			return ipcerr.BadRequest("A connection URI is required.")
		}
	}

	return nil
}
